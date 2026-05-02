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
from pathlib import Path
from typing import Callable, Optional

from ..domain.shoot_session import ShootSession
from ..infra.c1_bridge import CaptureOneBridge
from ..infra.cos_repository import CosRepository
from .session_watcher import SessionWatcher
from .hotkey_service import HotkeyService


def _utc_now_iso() -> str:
    """ISO 8601 UTC string with explicit Z suffix.

    `datetime.utcnow()` is naive and would round-trip wrong; we use
    `datetime.now(timezone.utc)` and replace the +00:00 with Z so the
    result matches the rest of the event log format.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class ShootingService:
    """Manage shoot sessions in-process; persistence handled in JS."""

    def __init__(
        self,
        event_logger: Optional[Callable[[str, dict], None]] = None,
        bridge: Optional[CaptureOneBridge] = None,
    ):
        self._sessions: dict[str, ShootSession] = {}
        self._active_id: Optional[str] = None
        self._log = event_logger  # (event_name, payload) -> None
        self._bridge = bridge or CaptureOneBridge()
        # Per-session watcher / hotkey instances (lazy-created on start_session).
        self._watcher: Optional[SessionWatcher] = None
        self._hotkey: Optional[HotkeyService] = None

    # ── public API ──

    def start_session(
        self, session_path: str, project_id: Optional[str] = None
    ) -> ShootSession:
        """Open a new session. Aborts any currently-active session first.

        Side effects:
          - Spawns a SessionWatcher on `<session_path>` (recursive .cos
            watching). Failures are surfaced as `watcher_error` events but
            don't fail the session start — manual operation still works.
          - Activates the global "Add to Card" hotkey.
        """
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

        # Watcher
        try:
            session_root = Path(session_path)
            cos_repo = CosRepository(session_root)
            self._watcher = SessionWatcher(
                session_root=session_root,
                on_event=lambda evt, payload: self._forward_watcher_event(
                    sid, evt, payload
                ),
            )
            ok = self._watcher.start()
            if not ok:
                self._watcher = None
        except Exception as e:
            self._emit("watcher_error", {"session_id": sid, "error": str(e)})
            cos_repo = CosRepository(Path(session_path))

        # Hotkey
        try:
            self._hotkey = HotkeyService(
                bridge=self._bridge,
                cos_repo=cos_repo,
                on_card_created=lambda res: self._forward_hotkey_event(sid, res),
            )
            status = self._hotkey.activate()
            if not status.get("ok"):
                self._emit("hotkey_error", {"session_id": sid, **status})
                self._hotkey = None
        except Exception as e:
            self._emit("hotkey_error", {"session_id": sid, "error": str(e)})

        return session

    def end_session(self, session_id: str) -> ShootSession:
        """Close a session normally. End-time recorded in UTC."""
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Unknown shoot session: {session_id}")
        if session.status != "active":
            return session
        self._teardown_helpers()
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
        self._teardown_helpers()
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

    def _teardown_helpers(self) -> None:
        """Stop watcher + hotkey. Idempotent."""
        if self._watcher is not None:
            try:
                self._watcher.stop()
            except Exception:
                pass
            self._watcher = None
        if self._hotkey is not None:
            try:
                self._hotkey.deactivate()
            except Exception:
                pass
            self._hotkey = None

    # ── Forwarding ──

    def _forward_watcher_event(self, sid: str, evt: str, payload: dict) -> None:
        """Append + emit a watcher event tied to the active session."""
        try:
            print(
                f"[shoot] watcher.{evt} stem={payload.get('stem')!r} "
                f"rating={payload.get('rating') if 'rating' in payload else payload.get('rating_after')} "
                f"image_path={payload.get('image_path')!r}",
                flush=True,
            )
        except Exception:
            pass
        session = self._sessions.get(sid)
        if session is not None and evt not in ("watcher_started", "watcher_stopped"):
            session.events.append({
                "type": evt,
                "timestamp": _utc_now_iso(),
                "payload": payload,
            })
        self._emit(f"watcher.{evt}", {"session_id": sid, **payload})

    def _forward_hotkey_event(self, sid: str, result: dict) -> None:
        try:
            print(
                f"[shoot] hotkey.card_created card={result.get('card_id')!r} "
                f"count={result.get('count')} errors={result.get('errors')!r}",
                flush=True,
            )
        except Exception:
            pass
        session = self._sessions.get(sid)
        if session is not None:
            session.events.append({
                "type": "hotkey_card_created",
                "timestamp": _utc_now_iso(),
                "payload": result,
            })
        self._emit("hotkey.card_created", {"session_id": sid, **result})

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
