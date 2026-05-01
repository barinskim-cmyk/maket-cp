"""ShootingService — start/end of a Capture One shoot session.

The service owns an in-memory `_sessions` dict and emits structured events
into a project event log (kept on the Project domain object via a callback).
Persistence to Supabase `shoot_sessions` is the frontend's job — Python is
the source of truth only for the active in-process session.

Times are UTC ISO 8601, suffixed with `Z`. We never store local time.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from ..domain.shoot_session import ShootSession


def _utc_now_iso() -> str:
    """ISO 8601 UTC string with explicit Z suffix.

    `datetime.utcnow()` is naive and would round-trip wrong; we use
    `datetime.now(timezone.utc)` and replace the +00:00 with Z so the
    result matches the rest of the event log format.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class ShootingService:
    """Manage shoot sessions in-process; persistence handled in JS."""

    def __init__(self, event_logger: Optional[Callable[[str, dict], None]] = None):
        self._sessions: dict[str, ShootSession] = {}
        self._active_id: Optional[str] = None
        self._log = event_logger  # (event_name, payload) -> None

    # ── public API ──

    def start_session(
        self, session_path: str, project_id: Optional[str] = None
    ) -> ShootSession:
        """Open a new session. Aborts any currently-active session first."""
        if self._active_id and self._active_id in self._sessions:
            self.abort_session(self._active_id)

        sid = str(uuid.uuid4())
        now = _utc_now_iso()
        session = ShootSession(
            id=sid,
            project_id=project_id,
            session_path=session_path,
            start_time=now,
            status="active",
            created_at=now,
        )
        self._sessions[sid] = session
        self._active_id = sid
        self._emit("shoot_session.started", {
            "session_id": sid,
            "project_id": project_id,
            "session_path": session_path,
            "start_time": now,
        })
        return session

    def end_session(self, session_id: str) -> ShootSession:
        """Close a session normally. End-time recorded in UTC."""
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Unknown shoot session: {session_id}")
        if session.status != "active":
            return session
        end = _utc_now_iso()
        session.end_time = end
        session.status = "completed"
        if self._active_id == session_id:
            self._active_id = None
        self._emit("shoot_session.ended", {
            "session_id": session_id,
            "end_time": end,
        })
        return session

    def abort_session(self, session_id: str) -> ShootSession:
        """Abort a session (user closed app, switched project, etc.)."""
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Unknown shoot session: {session_id}")
        end = _utc_now_iso()
        session.end_time = end
        session.status = "aborted"
        if self._active_id == session_id:
            self._active_id = None
        self._emit("shoot_session.aborted", {
            "session_id": session_id,
            "end_time": end,
        })
        return session

    def get_active(self) -> Optional[ShootSession]:
        if not self._active_id:
            return None
        return self._sessions.get(self._active_id)

    def get_session(self, session_id: str) -> Optional[ShootSession]:
        return self._sessions.get(session_id)

    def append_event(self, session_id: str, event_type: str, payload: dict) -> dict:
        """Append a watcher-emitted event (file added, hotkey pressed, etc.).

        Returns the event dict so the AppAPI caller can ship it to JS.
        """
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Unknown shoot session: {session_id}")
        evt = {
            "type": event_type,
            "timestamp": _utc_now_iso(),
            "payload": payload,
        }
        session.events.append(evt)
        self._emit(f"shoot.{event_type}", {"session_id": session_id, **payload})
        return evt

    # ── helpers ──

    def _emit(self, name: str, payload: dict) -> None:
        if self._log:
            try:
                self._log(name, payload)
            except Exception:
                pass
