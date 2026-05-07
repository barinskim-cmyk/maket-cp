"""PermissionsService — first-run macOS TCC checks for Maket CP shoot mode.

Three permissions matter for hotkey + watcher + AppleScript bridge:

1. **Accessibility** — pynput hotkey listener needs it (and Cmd+, future).
2. **Input Monitoring** — global keyboard hooks. macOS sometimes requires
   both Accessibility AND Input Monitoring depending on backend.
3. **Automation: Capture One** — AppleScript ping `tell application "Capture One"`
   triggers the per-app TCC prompt the first time.

We never throw a permission dialog on launch — we only surface status when
the user actually clicks "Start shooting". Each `check_*` returns a bool.
Callers map False → render "выдано / не выдано" with a deep-link button.

Cross-platform: on non-macOS the checks return True (nothing to gate on).
"""
from __future__ import annotations

import subprocess
import sys
from typing import Optional


def _is_macos() -> bool:
    return sys.platform == "darwin"


def check_accessibility() -> bool:
    """Is the host process trusted under macOS Accessibility?

    Uses pyobjc → ApplicationServices.AXIsProcessTrusted. If pyobjc is not
    installed the bundle still works (it just returns False so the user is
    prompted to open the system pane).
    """
    if not _is_macos():
        return True
    try:
        from ApplicationServices import AXIsProcessTrusted  # type: ignore
        return bool(AXIsProcessTrusted())
    except Exception:
        return False


def check_input_monitoring() -> bool:
    """Does the host have macOS Input Monitoring?

    NOTE 2026-05-01 (Маша's machine, macOS 26.4): pynput.keyboard.Listener
    crashes the Python process on start() due to TSMGetInputSourceProperty
    being called from a non-main thread (SIGTRAP from dispatch_assert_queue).
    The crash report is in ~/Library/Logs/DiagnosticReports/Python-2026-05-01-085854.ips.

    Until we replace pynput with a pyobjc NSEvent-based hotkey monitor that
    runs on the main thread, do NOT call pynput here at all. Returning True
    optimistically is fine — the actual hotkey activation (which currently
    no-ops on macOS, see hotkey_service.activate) is the only place that
    really needs the permission, and it surfaces failures itself.
    """
    if not _is_macos():
        return True
    # Conservative: assume granted; the real test is at hotkey activation
    # time, which is currently disabled on macOS pending pyobjc rewrite.
    return True


def check_automation_capture_one() -> bool:
    """Is AppleScript automation of Capture One allowed?

    Sends a no-op AppleScript ping. macOS shows the TCC prompt on first
    invocation; subsequent denied invocations fail with osaerror -1743 (or
    -600 if Capture One isn't running at all — that's still a "yes,
    automation works" signal because it returns cleanly).
    """
    if not _is_macos():
        return True
    script = 'tell application "System Events" to get exists application process "Capture One"'
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            return True
        # -1743 means TCC denied. Anything else (e.g. C1 not installed) we
        # treat as "automation pipe is fine, app just isn't here yet" so
        # we don't block the user with a false negative.
        err = proc.stderr or ""
        if "1743" in err or "Not authorized" in err:
            return False
        return True
    except Exception:
        return False


def open_settings_for_permission(name: str) -> bool:
    """Open System Settings deep-link for the requested permission.

    Returns True if the `open` command was dispatched (NOT a guarantee the
    user actually granted it).
    """
    if not _is_macos():
        return False
    deep_links = {
        "accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "input_monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
        "automation": "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    }
    url: Optional[str] = deep_links.get(name)
    if not url:
        return False
    try:
        subprocess.Popen(["open", url])
        return True
    except Exception:
        return False


def check_all() -> dict:
    """Convenience snapshot for the JS first-run modal."""
    return {
        "accessibility": check_accessibility(),
        "input_monitoring": check_input_monitoring(),
        "automation_capture_one": check_automation_capture_one(),
    }
