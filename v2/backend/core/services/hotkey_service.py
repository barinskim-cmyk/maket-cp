"""HotkeyService — global "Add to Card" shortcut for Shoot mode.

When active, presses of `Cmd+Shift+C` (configurable) trigger a callback in
the main shoot flow:

    1. Ask the C1 bridge for `selected variants` (sorted by browser position).
    2. Mint a new card UUID.
    3. For each selected variant, write `_card:<uuid>` + `_slot:<i>` keywords
       to its .cos via CosRepository.update_keywords. SessionWatcher will
       pick those up and emit a "card_signal" event back to the JS layer,
       so the UI updates without us caring about the bridge layer.
    4. Optionally show a macOS notification banner.

Why pynput: the alternative is `pyobjc + NSEvent.addGlobalMonitorFor*`,
which is more macOS-native but adds ~120 lines of Cocoa runloop wrangling.
pynput already abstracts both code paths, accepts macOS modifier semantics,
and degrades cleanly when Accessibility access is denied (returns an
exception we can catch and surface to the UI).

Threading: pynput's `GlobalHotKeys` runs its own listener thread; we hand
it a callback that posts a non-blocking `threading.Thread` to do the actual
work so the listener stays responsive even if the bridge call is slow.
"""
from __future__ import annotations

import subprocess
import threading
import uuid
from pathlib import Path
from typing import Callable, Optional

try:
    from pynput import keyboard as _kb  # type: ignore[import]
    _PYNPUT_AVAILABLE = True
except Exception:
    _PYNPUT_AVAILABLE = False
    _kb = None  # type: ignore[assignment]

from ..infra.c1_bridge import CaptureOneBridge
from ..infra.cos_repository import CosRepository


# pynput format: <keys> joined with `+`, modifiers in `<...>` brackets.
DEFAULT_HOTKEY = "<cmd>+<shift>+c"

CARD_KEYWORD_PREFIX = "_card:"
SLOT_KEYWORD_PREFIX = "_slot:"


class HotkeyService:
    """Bind a global hotkey to "add selected C1 variants as a new card"."""

    def __init__(
        self,
        bridge: CaptureOneBridge,
        cos_repo: CosRepository,
        on_card_created: Callable[[dict], None],
        hotkey: str = DEFAULT_HOTKEY,
    ) -> None:
        self.bridge = bridge
        self.cos_repo = cos_repo
        self.on_card_created = on_card_created
        self.hotkey = hotkey
        self._listener = None

    # ── Lifecycle ──

    def activate(self) -> dict:
        """Register the global hotkey. Returns status dict.

        On success: {"ok": True, "hotkey": "<cmd>+<shift>+c"}.
        On failure: {"ok": False, "error": "...", "remedy": "..."}.

        NOTE 2026-05-01 (macOS 26.4): pynput.keyboard.GlobalHotKeys.start()
        crashes the entire Python process via SIGTRAP from
        dispatch_assert_queue (TSMGetInputSourceProperty called off
        main thread). See ~/Library/Logs/DiagnosticReports/Python-2026-05-01-*.ips.
        Until we rewrite this on top of pyobjc NSEvent.addGlobalMonitorFor*
        (runs on main thread cleanly), pynput is disabled on macOS. The
        Shoot-mode flow (rating watcher) keeps working — only the
        Cmd+Shift+C "Add to Card" hotkey is unavailable for now.
        """
        import sys
        if sys.platform == "darwin":
            return {
                "ok": False,
                "error": "Hotkey временно отключён на macOS",
                "remedy": "Будет включено после переписывания на pyobjc NSEvent (без pynput).",
                "platform_blocked": True,
            }
        if not _PYNPUT_AVAILABLE:
            return {"ok": False, "error": "pynput not installed",
                    "remedy": "pip install pynput"}
        if self._listener is not None:
            return {"ok": True, "hotkey": self.hotkey, "note": "already active"}
        try:
            self._listener = _kb.GlobalHotKeys({self.hotkey: self._fire_async})
            self._listener.start()
        except Exception as e:
            self._listener = None
            return {
                "ok": False,
                "error": str(e),
                "remedy": "Grant Maket CP Accessibility + Input Monitoring "
                          "in System Settings → Privacy & Security.",
            }
        return {"ok": True, "hotkey": self.hotkey}

    def deactivate(self) -> None:
        if self._listener is not None:
            try:
                self._listener.stop()
            except Exception:
                pass
            self._listener = None

    def is_active(self) -> bool:
        return self._listener is not None

    # ── Trigger ──

    def _fire_async(self) -> None:
        """Hand off the actual work to a worker thread so the listener
        thread doesn't block on AppleScript / file I/O."""
        threading.Thread(target=self._fire, daemon=True).start()

    def _fire(self) -> None:
        try:
            variants = self.bridge.get_selected_variants()
        except Exception as e:
            self.on_card_created({"error": f"bridge failure: {e}"})
            return
        if not variants:
            self.on_card_created({"error": "no variants selected", "soft": True})
            return

        # Sort by browser position so slot indexing is deterministic
        # (top-left first, row-major).
        variants.sort(key=lambda v: v.get("position", 1_000_000))

        card_id = str(uuid.uuid4())
        tagged: list[dict] = []
        errors: list[str] = []

        for slot_idx, v in enumerate(variants):
            stem = self._stem_from_variant(v)
            if not stem:
                errors.append(f"missing stem for variant {v.get('name')}")
                continue
            cos_files = self.cos_repo.find_by_stem(stem)
            if not cos_files:
                errors.append(f"no .cos for {stem}")
                continue
            tags = [
                f"{CARD_KEYWORD_PREFIX}{card_id}",
                f"{SLOT_KEYWORD_PREFIX}{slot_idx}",
            ]
            for cos_path in cos_files:
                try:
                    self.cos_repo.update_keywords(cos_path, tags, backup=True)
                except Exception as e:
                    errors.append(f"{stem}: {e}")
                    continue
            tagged.append({
                "stem": stem,
                "slot": slot_idx,
                "rating": v.get("rating"),
                "path": v.get("path"),
            })

        result = {
            "card_id": card_id,
            "variants": tagged,
            "errors": errors,
            "count": len(tagged),
        }
        self.on_card_created(result)
        self._notify(f"В карточку добавлено {len(tagged)} фото")

    # ── Helpers ──

    @staticmethod
    def _stem_from_variant(v: dict) -> Optional[str]:
        """Extract photo stem from a bridge variant dict.

        Variants give us either `path` (preferred) or just `name`. The .cos
        index is keyed by stem-of-stem (IMG_0001.CR3.cos → IMG_0001), so we
        replicate that.
        """
        path = v.get("path") or ""
        name = v.get("name") or ""
        candidate = path or name
        if not candidate:
            return None
        return Path(Path(candidate).name).stem.split(".")[0] or None

    @staticmethod
    def _notify(message: str) -> None:
        """Show a transient macOS notification banner.

        Falls back silently when osascript is unavailable; the JS UI receives
        the structured result regardless.
        """
        try:
            script = (
                f'display notification {HotkeyService._asq(message)} '
                f'with title "Maket CP"'
            )
            subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except Exception:
            pass

    @staticmethod
    def _asq(text: str) -> str:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
