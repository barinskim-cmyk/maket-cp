"""SessionWatcher — watch a Capture One session for rating / keyword changes.

Architecture:
    SessionWatcher(session_root, on_event)
        .start()           # spawn background thread (watchdog Observer)
        .stop()            # join thread

`on_event(event_type, payload)` is called for every interesting change:
    - "photo_added"         {stem, path, rating, keywords}
    - "photo_changed"       {stem, path, rating_before, rating_after,
                             keywords_added, keywords_removed}
    - "selection_added"     {stem, rating}      # rating crossed >= threshold
    - "selection_removed"   {stem, rating}      # rating dropped below
    - "card_signal"         {card_id, slot, stem}  # _card:<uuid> _slot:<n>

Threshold for selection inclusion is configurable; the default mirrors the
"highlight starting at 2 stars" heuristic the rate-setter uses elsewhere.

The watcher reads .cos files (XML) directly via CosRepository — no exiftool
dependency. Capture One writes the .cos file fully on every metadata change
so we don't need to debounce.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer
    _WATCHDOG_AVAILABLE = True
except ImportError:
    _WATCHDOG_AVAILABLE = False
    FileSystemEventHandler = object  # type: ignore[misc,assignment]
    Observer = None  # type: ignore[assignment]

from ..infra.cos_repository import CosRepository


# Capture One stores per-photo .cos files in <session>/Capture/CaptureOne/Settings82/
# but they can also live in subfolders (e.g. AlbumName/CaptureOne/Settings82/).
# Watchdog's recursive=True means we don't have to enumerate.
COS_SUFFIX = ".cos"
SELECTION_RATING_THRESHOLD = 2

CARD_KEYWORD_PREFIX = "_card:"
SLOT_KEYWORD_PREFIX = "_slot:"
STATUS_KEYWORD_PREFIX = "_status:"


@dataclass
class _PhotoState:
    rating: Optional[int] = None
    keywords: list[str] = field(default_factory=list)


class _CosEventHandler(FileSystemEventHandler):
    """Translates raw filesystem events into semantic "photo changed" calls."""

    def __init__(self, watcher: "SessionWatcher"):
        super().__init__()
        self.watcher = watcher

    # watchdog's "modified" fires twice per save (xattrs + content) on macOS,
    # so we just react to both create and modify; idempotent state diff in
    # the watcher itself handles dedup.
    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(COS_SUFFIX):
            self.watcher._on_cos_event(Path(event.src_path), kind="created")

    def on_modified(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(COS_SUFFIX):
            self.watcher._on_cos_event(Path(event.src_path), kind="modified")

    def on_moved(self, event):
        if getattr(event, "dest_path", "").endswith(COS_SUFFIX):
            self.watcher._on_cos_event(Path(event.dest_path), kind="modified")


class SessionWatcher:
    """Observe a C1 session folder; emit semantic events to a callback."""

    def __init__(
        self,
        session_root: Path,
        on_event: Callable[[str, dict], None],
        rating_threshold: int = SELECTION_RATING_THRESHOLD,
    ) -> None:
        self.session_root = Path(session_root)
        self.on_event = on_event
        self.rating_threshold = rating_threshold
        self.cos_repo = CosRepository(self.session_root)
        # photo_stem → last known state. Used for diffing on each cos write.
        self._states: dict[str, _PhotoState] = {}
        self._observer = None
        self._lock = threading.Lock()

    # ── Lifecycle ──

    def start(self) -> bool:
        """Spawn a watchdog observer. Returns True if it started successfully."""
        if not _WATCHDOG_AVAILABLE:
            self.on_event("watcher_error", {
                "error": "watchdog not installed",
                "remedy": "pip install watchdog",
            })
            return False
        if not self.session_root.exists():
            self.on_event("watcher_error", {
                "error": f"session root not found: {self.session_root}",
            })
            return False
        # Seed state from existing .cos files so we emit "changed" only on
        # real diffs, not for every existing photo on startup.
        self._seed_initial_state()
        try:
            handler = _CosEventHandler(self)
            self._observer = Observer()
            self._observer.schedule(handler, str(self.session_root), recursive=True)
            self._observer.start()
        except Exception as e:
            self.on_event("watcher_error", {"error": str(e)})
            return False
        self.on_event("watcher_started", {
            "session_root": str(self.session_root),
            "tracked_photos": len(self._states),
        })
        return True

    def stop(self) -> None:
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=3)
            except Exception:
                pass
            self._observer = None
            self.on_event("watcher_stopped", {})

    def is_running(self) -> bool:
        return self._observer is not None and self._observer.is_alive()

    # ── Internals ──

    def _seed_initial_state(self) -> None:
        """Pre-populate self._states from .cos files already on disk."""
        for cos in self.session_root.rglob("*" + COS_SUFFIX):
            try:
                stem = Path(cos.stem).stem  # strip the second .ext
                meta = self.cos_repo.read_metadata(cos)
                self._states[stem] = _PhotoState(
                    rating=meta["rating"],
                    keywords=list(meta["keywords"]),
                )
            except Exception:
                continue

    def _on_cos_event(self, cos_path: Path, kind: str) -> None:
        """Diff the new .cos against last known state; emit semantic events."""
        try:
            stem = Path(cos_path.stem).stem
            meta = self.cos_repo.read_metadata(cos_path)
        except Exception as e:
            self.on_event("watcher_error", {
                "error": f"failed to read {cos_path}: {e}",
            })
            return

        new_rating: Optional[int] = meta["rating"]
        new_keywords: list[str] = list(meta["keywords"])

        with self._lock:
            prev = self._states.get(stem)
            if prev is None:
                # New photo — even on "modified" we may not have seen it yet
                # because Capture writes the raw before its .cos.
                self._states[stem] = _PhotoState(rating=new_rating, keywords=new_keywords)
                self.on_event("photo_added", {
                    "stem": stem,
                    "path": str(cos_path),
                    "rating": new_rating,
                    "keywords": new_keywords,
                })
                self._maybe_emit_selection(stem, None, new_rating)
                self._maybe_emit_card_signal(stem, [], new_keywords)
                return

            # Rating diff
            rating_changed = prev.rating != new_rating
            kw_added = [k for k in new_keywords if k not in prev.keywords]
            kw_removed = [k for k in prev.keywords if k not in new_keywords]

            if rating_changed or kw_added or kw_removed:
                self.on_event("photo_changed", {
                    "stem": stem,
                    "path": str(cos_path),
                    "rating_before": prev.rating,
                    "rating_after": new_rating,
                    "keywords_added": kw_added,
                    "keywords_removed": kw_removed,
                })

            if rating_changed:
                self._maybe_emit_selection(stem, prev.rating, new_rating)
            if kw_added:
                self._maybe_emit_card_signal(stem, prev.keywords, new_keywords)

            # Update cached state
            prev.rating = new_rating
            prev.keywords = new_keywords

    def _maybe_emit_selection(
        self, stem: str, before: Optional[int], after: Optional[int]
    ) -> None:
        """Emit selection_added / removed when rating crosses threshold."""
        was_in = (before or 0) >= self.rating_threshold
        is_in = (after or 0) >= self.rating_threshold
        if was_in == is_in:
            return
        if is_in:
            self.on_event("selection_added", {"stem": stem, "rating": after})
        else:
            self.on_event("selection_removed", {"stem": stem, "rating": after})

    def _maybe_emit_card_signal(
        self, stem: str, prev_keywords: list[str], new_keywords: list[str]
    ) -> None:
        """Detect _card:<id> + _slot:<n> markers added by HotkeyService."""
        prev_set = set(prev_keywords)
        new_card = next(
            (k[len(CARD_KEYWORD_PREFIX):] for k in new_keywords
             if k.startswith(CARD_KEYWORD_PREFIX) and k not in prev_set),
            None,
        )
        new_slot = next(
            (k[len(SLOT_KEYWORD_PREFIX):] for k in new_keywords
             if k.startswith(SLOT_KEYWORD_PREFIX) and k not in prev_set),
            None,
        )
        if new_card is None and new_slot is None:
            return
        try:
            slot_int: Optional[int] = int(new_slot) if new_slot is not None else None
        except ValueError:
            slot_int = None
        self.on_event("card_signal", {
            "stem": stem,
            "card_id": new_card,
            "slot": slot_int,
        })
