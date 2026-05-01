"""CaptureOneBridge — AppleScript wrapper for Capture One automation.

This is the **stub** version (overnight 2026-04-30). The Python surface is
final; AppleScript bodies are placeholders that return safe defaults so the
rest of Maket CP can import and call this without exploding when Capture
One isn't available.

The real bridge will replace each `_run_script` call with a vetted .scpt
that talks to Capture One's scripting dictionary. Until then:

- `is_running` is real (uses System Events, no C1 dependency).
- `get_session_path` and `get_selected_variants` return None / [] with a
  TODO marker.
- `process_selected_to_jpg` returns [] and logs intent.

All methods use `subprocess.run(["osascript", "-e", script], timeout=...)`
and never raise — caller gets a structured result.
"""
from __future__ import annotations

import json
import shlex
import subprocess
from typing import Optional


_DEFAULT_TIMEOUT = 8  # seconds; AppleScript shouldn't take longer for these reads


class CaptureOneBridge:
    """Thin facade over osascript. Stub bodies marked TODO."""

    def __init__(self, timeout: int = _DEFAULT_TIMEOUT) -> None:
        self.timeout = timeout

    # ── public API ──

    def is_running(self) -> bool:
        """Is Capture One in the macOS process list right now?"""
        script = (
            'tell application "System Events" to '
            'return (exists application process "Capture One")'
        )
        out = self._run_script(script)
        return out.strip().lower() == "true"

    def get_session_path(self) -> Optional[str]:
        """Path to the currently-open .cosessiondb in Capture One.

        TODO: real implementation must read `path of current document`.
        Stub returns None so callers fall back to manual session pick.
        """
        # Placeholder — scripting dictionary call goes here once vetted.
        # tell application "Capture One" to return path of current document
        return None

    def get_selected_variants(self) -> list[dict]:
        """Currently selected variants in Capture One's browser.

        TODO: real implementation iterates `selected variants` and emits
        dicts with name, rating, color tag, parent image path, EXIF time.
        Stub returns [] so the watcher doesn't choke on import.
        """
        # tell application "Capture One"
        #   set out to {}
        #   repeat with v in (selected variants of current document)
        #     set end of out to {name:(name of v), rating:(rating of v)}
        #   end repeat
        # end tell
        return []

    def process_selected_to_jpg(self, output_dir: str) -> list[str]:
        """Trigger C1 "Process" of currently selected variants to JPEG.

        TODO: real implementation invokes a process recipe; returns the
        absolute paths of resulting .jpg files. Stub logs and returns [].
        """
        return []

    # ── internals ──

    def _run_script(self, script: str) -> str:
        """Execute osascript with a timeout. Returns stdout, "" on error."""
        try:
            proc = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
            if proc.returncode != 0:
                return ""
            return proc.stdout or ""
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return ""

    def _run_script_json(self, script: str) -> dict | list | None:
        """Run a script that prints JSON; parse and return.

        Used by the future real implementations of get_selected_variants /
        get_session_path so they can return structured data.
        """
        raw = self._run_script(script).strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _quote_for_applescript(text: str) -> str:
        """Escape a string for embedding into an AppleScript literal."""
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'

    @staticmethod
    def _shell_quote(text: str) -> str:
        """Escape a path for inclusion in an `osascript -e` shell command."""
        return shlex.quote(text)
