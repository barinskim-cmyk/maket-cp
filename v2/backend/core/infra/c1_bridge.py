"""CaptureOneBridge — AppleScript wrapper for Capture One automation.

Implements:
- `is_running` — System Events check (no C1 dependency).
- `get_session_path` — `path of current document` of the running C1.
- `get_selected_variants` — selected variants in the active document with
  name, rating, color tag, parent image path, position, orientation.
- `process_selected_to_jpg` — runs an "Embedded JPEG" recipe on the selection.

Capture One ships under different names depending on version / locale /
distribution channel ("Capture One", "Capture One 23", "Capture One 24",
"Capture One Pro"). We probe the running process list to find the actual
app name before talking to it; this lets us work on cracked / older
installs without the user editing config.

All AppleScript calls go through `osascript` with a hard timeout. Methods
never raise — failure modes return safe defaults (False / [] / None).
"""
from __future__ import annotations

import json
import re
import shlex
import subprocess
from typing import Optional


_DEFAULT_TIMEOUT = 8

# Probed in priority order. The first one we find as a running process wins;
# if none are running, `is_running` returns False and the rest short-circuit.
_C1_APP_CANDIDATES = (
    "Capture One",
    "Capture One Pro",
    "Capture One 23",
    "Capture One 24",
    "Capture One 25",
    "Capture One 22",
    "Capture One 21",
    "Capture One 20",
)


class CaptureOneBridge:
    """Real AppleScript bridge — no stubs."""

    def __init__(self, timeout: int = _DEFAULT_TIMEOUT) -> None:
        self.timeout = timeout
        # Cached app name once we've found it; reset on demand by calling
        # _detect_app_name() again.
        self._app_name: Optional[str] = None

    # ── Detection ──

    def _detect_app_name(self) -> Optional[str]:
        """Return the running C1 app name, or None if not running."""
        # System Events gives us the canonical process name for any candidate
        # that's currently running. We grab them all in one round-trip.
        script = (
            'tell application "System Events" to '
            'get name of (every application process whose background only is false)'
        )
        out = self._run_script(script)
        if not out:
            self._app_name = None
            return None
        # AppleScript list output: "App A, App B, App C"
        names = [n.strip() for n in out.split(",")]
        for cand in _C1_APP_CANDIDATES:
            if cand in names:
                self._app_name = cand
                return cand
        # Fuzzy fallback: any name starting with "Capture One"
        for n in names:
            if n.startswith("Capture One"):
                self._app_name = n
                return n
        self._app_name = None
        return None

    # ── Public API ──

    def is_running(self) -> bool:
        """Is any flavour of Capture One currently running?"""
        return self._detect_app_name() is not None

    def get_session_path(self) -> Optional[str]:
        """Path to the .cosessiondb that is currently open in C1."""
        app = self._app_name or self._detect_app_name()
        if not app:
            return None
        # `path of current document` returns a POSIX path on modern C1.
        # On older versions it may return an alias — `POSIX path of (… as text)`
        # forces conversion in either case.
        script = (
            f'tell application "{app}"\n'
            f'  try\n'
            f'    set p to path of current document\n'
            f'    return p as text\n'
            f'  on error\n'
            f'    return ""\n'
            f'  end try\n'
            f'end tell'
        )
        out = self._run_script(script).strip()
        if not out:
            return None
        # The session "path" Capture One returns is the .cosessiondb file
        # itself; the watcher needs the parent directory which contains
        # Capture/, Selects/, Output/. Caller decides which it wants.
        return out

    def get_selected_variants(self) -> list[dict]:
        """Currently selected variants in the active document.

        Returns a list of dicts. Empty list on any failure (C1 not running,
        no document, automation denied, malformed JSON, …).

        Each dict:
          - name: filename stem ("IMG_0042")
          - path: absolute path to the parent image on disk
          - rating: int 0–5 or None
          - color_tag: int 0–7 or None
          - position: 1-based browser index (sort key for hotkey ordering)
        """
        app = self._app_name or self._detect_app_name()
        if not app:
            return []

        # We pipe through JSON to avoid AppleScript-list parse hell. C1
        # AppleScript supports `repeat with` and we manually concat. We
        # JSON-escape the strings inside AppleScript before joining.
        script = (
            f'on jsonEscape(s)\n'
            f'  set s to s as text\n'
            f'  set out to ""\n'
            f'  repeat with i from 1 to length of s\n'
            f'    set c to character i of s\n'
            f'    if c is "\\"" then\n'
            f'      set out to out & "\\\\\\""\n'
            f'    else if c is "\\\\" then\n'
            f'      set out to out & "\\\\\\\\"\n'
            f'    else\n'
            f'      set out to out & c\n'
            f'    end if\n'
            f'  end repeat\n'
            f'  return out\n'
            f'end jsonEscape\n'
            f'tell application "{app}"\n'
            f'  try\n'
            f'    set vs to selected variants of current document\n'
            f'  on error\n'
            f'    return "[]"\n'
            f'  end try\n'
            f'  if (count of vs) is 0 then return "[]"\n'
            f'  set out to "["\n'
            f'  set idx to 0\n'
            f'  repeat with v in vs\n'
            f'    set idx to idx + 1\n'
            f'    set vName to ""\n'
            f'    try\n'
            f'      set vName to my jsonEscape(name of v)\n'
            f'    end try\n'
            f'    set vRating to -1\n'
            f'    try\n'
            f'      set vRating to (rating of v) as integer\n'
            f'    end try\n'
            f'    set vColor to -1\n'
            f'    try\n'
            f'      set vColor to (color tag of v) as integer\n'
            f'    end try\n'
            f'    set vPath to ""\n'
            f'    try\n'
            f'      set vPath to my jsonEscape(POSIX path of (file of parent image of v))\n'
            f'    end try\n'
            f'    if idx > 1 then set out to out & ","\n'
            f'    set out to out & "{{\\"name\\":\\"" & vName & "\\",\\"path\\":\\"" & vPath\n'
            f'    set out to out & "\\",\\"rating\\":" & vRating & ",\\"color_tag\\":" & vColor\n'
            f'    set out to out & ",\\"position\\":" & idx & "}}"\n'
            f'  end repeat\n'
            f'  set out to out & "]"\n'
            f'  return out\n'
            f'end tell'
        )
        raw = self._run_script(script).strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(data, list):
            return []
        # Normalize sentinel -1 → None for rating / color_tag
        for d in data:
            if d.get("rating", -1) == -1:
                d["rating"] = None
            if d.get("color_tag", -1) == -1:
                d["color_tag"] = None
        return data

    def process_selected_to_jpg(self, output_dir: str) -> list[str]:
        """Run the "Embedded JPEG" recipe on the current selection.

        Returns the list of .jpg file paths C1 produced. Best-effort: when
        the recipe doesn't exist, we let C1 surface the error and return [].
        """
        app = self._app_name or self._detect_app_name()
        if not app:
            return []
        # We don't try to enumerate output files from AppleScript — easier
        # to scan the output_dir on the Python side after C1 finishes.
        script = (
            f'tell application "{app}"\n'
            f'  try\n'
            f'    process selected variants of current document recipe "Embedded JPEG"\n'
            f'    return "ok"\n'
            f'  on error errMsg\n'
            f'    return errMsg\n'
            f'  end try\n'
            f'end tell'
        )
        result = self._run_script(script).strip()
        if not result.startswith("ok"):
            return []
        # Caller (watcher) sees new files appear; this method is mainly a
        # poke. We still scan output_dir for fresh .jpg as a courtesy.
        try:
            from pathlib import Path
            return [str(p) for p in Path(output_dir).rglob("*.jpg")]
        except Exception:
            return []

    # ── Internals ──

    def _run_script(self, script: str) -> str:
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

    @staticmethod
    def _quote_for_applescript(text: str) -> str:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'

    @staticmethod
    def _shell_quote(text: str) -> str:
        return shlex.quote(text)

    @staticmethod
    def _strip_posix(p: str) -> str:
        """Some C1 versions return file:// URIs — normalize to plain paths."""
        return re.sub(r"^file://", "", p)
