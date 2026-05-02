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

**2026-05-01 rewrite — pyobjc instead of pynput:**

`pynput` on macOS 26.4 crashes the Python process via SIGTRAP from
`dispatch_assert_queue` because its keyboard listener calls
`TSMGetInputSourceProperty` from a background thread. Apple requires that
TSM call to happen on the main thread.

We now use `NSEvent.addGlobalMonitorForEventsMatchingMask:handler:` from
`pyobjc-framework-Cocoa`. NSEvent dispatches the handler on the main
NSApplication run loop (which pywebview already drives), so no
cross-thread TSM access happens. We then hand the actual work off to a
background thread so the run loop stays responsive even if the bridge
call is slow.

Caveat: a "global" monitor only fires when *another* application is in
front of Maket CP. That is exactly what we want — the user is in Capture
One when they press Cmd+Shift+C, not in Maket CP itself.
"""
from __future__ import annotations

import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Callable, Optional

from ..infra.c1_bridge import CaptureOneBridge
from ..infra.cos_repository import CosRepository

# pyobjc — main-thread-safe alternative to pynput. Imports may fail in
# non-Darwin environments; we degrade to a soft "unsupported" status.
try:
    from Cocoa import NSEvent  # type: ignore[import]
    _PYOBJC_AVAILABLE = True
except Exception:
    _PYOBJC_AVAILABLE = False
    NSEvent = None  # type: ignore[assignment]


# Apple key-code (kVK_ANSI_*) and modifier-flag constants. Values are stable
# across macOS releases; we hard-code them rather than chase the right
# pyobjc constant name (different submodules expose different aliases).
KVK_ANSI_C: int = 8

NSEventMaskKeyDown: int = 1 << 10  # NSKeyDown
NSEventModifierFlagShift: int = 1 << 17
NSEventModifierFlagControl: int = 1 << 18
NSEventModifierFlagOption: int = 1 << 19
NSEventModifierFlagCommand: int = 1 << 20

# Mask of "user-visible" modifiers — strips fn, caps lock, numeric pad, etc.
NSEventModifierFlagDeviceIndependentFlagsMask: int = 0xFFFF0000

CARD_KEYWORD_PREFIX = "_card:"
SLOT_KEYWORD_PREFIX = "_slot:"


class HotkeyService:
    """Bind a global hotkey to "add selected C1 variants as a new card".

    Defaults to Cmd+Shift+C (kVK_ANSI_C with NSCommand|NSShift modifiers).
    """

    DEFAULT_KEYCODE: int = KVK_ANSI_C
    DEFAULT_MODIFIERS: int = NSEventModifierFlagCommand | NSEventModifierFlagShift
    DEFAULT_LABEL: str = "Cmd+Shift+C"

    def __init__(
        self,
        bridge: CaptureOneBridge,
        cos_repo: CosRepository,
        on_card_created: Callable[[dict], None],
        keycode: int = DEFAULT_KEYCODE,
        modifiers: int = DEFAULT_MODIFIERS,
        label: str = DEFAULT_LABEL,
    ) -> None:
        self.bridge = bridge
        self.cos_repo = cos_repo
        self.on_card_created = on_card_created
        self.keycode = keycode
        self.modifiers = modifiers
        self.label = label
        self._monitor = None

    # ── Lifecycle ──

    def activate(self) -> dict:
        """Register the global hotkey via NSEvent. Returns status dict."""
        if sys.platform != "darwin":
            return {"ok": False, "error": "Hotkey is macOS-only in this build"}
        if not _PYOBJC_AVAILABLE:
            return {
                "ok": False,
                "error": "pyobjc-framework-Cocoa not available",
                "remedy": "pip3 install pyobjc-framework-Cocoa",
            }
        if self._monitor is not None:
            return {"ok": True, "hotkey": self.label, "note": "already active"}

        try:
            mask = NSEventMaskKeyDown
            self._monitor = NSEvent.addGlobalMonitorForEventsMatchingMask_handler_(
                mask, self._handle_event
            )
        except Exception as e:
            self._monitor = None
            return {
                "ok": False,
                "error": f"NSEvent.addGlobalMonitor failed: {e}",
                "remedy": "Grant Maket CP / Terminal Input Monitoring "
                          "in System Settings → Privacy & Security.",
            }

        if self._monitor is None:
            # NSEvent returns None when permission is missing — it does not
            # raise. Treat that as a soft failure with a helpful remedy.
            return {
                "ok": False,
                "error": "NSEvent monitor returned None (permission missing?)",
                "remedy": "Grant Maket CP / Terminal Input Monitoring "
                          "in System Settings → Privacy & Security.",
            }

        return {"ok": True, "hotkey": self.label}

    def deactivate(self) -> None:
        """Stop listening. Idempotent."""
        if self._monitor is not None and _PYOBJC_AVAILABLE:
            try:
                NSEvent.removeMonitor_(self._monitor)
            except Exception:
                pass
            self._monitor = None

    def is_active(self) -> bool:
        return self._monitor is not None

    # ── Event handling ──

    def _handle_event(self, event) -> None:
        """NSEvent handler — runs on the main NSApplication run loop.

        We do the cheapest possible filter here, then hand off to a worker
        thread so the run loop never blocks on AppleScript or disk I/O.
        """
        try:
            keycode = int(event.keyCode())
            mods = int(event.modifierFlags()) & NSEventModifierFlagDeviceIndependentFlagsMask
        except Exception:
            return

        if keycode != self.keycode:
            return
        # Require ALL configured modifiers and forbid any extras (Ctrl/Option).
        if (mods & self.modifiers) != self.modifiers:
            return
        extra = mods & ~self.modifiers
        if extra & (NSEventModifierFlagControl | NSEventModifierFlagOption):
            return

        threading.Thread(target=self._fire, daemon=True).start()

    # ── Core action ──

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
                "orient": self._probe_orient(v.get("path")),
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
    def _probe_orient(image_path: Optional[str]) -> str:
        """Return 'h' or 'v' based on the C1 thumbnail dimensions.

        Reads <session>/Capture/CaptureOne/Cache/Thumbnails/<name>.<uuid>.cot
        which is C1's already-rotated preview, so orientation matches what
        the user sees in the C1 viewer (no need to read .cos rotation).
        Defaults to 'v' on any failure — the slot will still render, just
        in a vertical container.
        """
        if not image_path:
            return "v"
        try:
            p = Path(image_path)
            thumbs = p.parent / "CaptureOne" / "Cache" / "Thumbnails"
            if thumbs.is_dir():
                for f in sorted(thumbs.glob(p.name + ".*.cot")):
                    if f.name.startswith("._"):
                        continue
                    from PIL import Image
                    img = Image.open(f)
                    return "h" if img.width > img.height else "v"
        except Exception:
            pass
        # Fallback: read source dimensions if the cot cache hasn't built yet.
        try:
            from PIL import Image
            img = Image.open(image_path)
            return "h" if img.width > img.height else "v"
        except Exception:
            return "v"

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
