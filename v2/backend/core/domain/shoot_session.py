"""ShootSession — domain object for an active Capture One session.

Lifecycle:
    active -> completed | aborted

Times are always ISO 8601 UTC strings (Z-suffixed). The frontend persists
to Supabase `shoot_sessions` and the AppAPI just shuttles dataclasses.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class ShootSession:
    """One C1 session bound to a Maket CP project."""

    id: str
    project_id: Optional[str]
    session_path: str
    start_time: str  # ISO 8601 UTC, e.g. "2026-04-30T20:00:00Z"
    end_time: Optional[str] = None
    status: str = "active"  # active | completed | aborted
    created_at: Optional[str] = None
    events: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
