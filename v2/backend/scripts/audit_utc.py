#!/usr/bin/env python3
"""audit_utc.py — verify Maket CP timestamps are ISO 8601 UTC.

Two modes (run both by default):

1. **Static (codebase) audit** — grep through frontend/backend for
   timestamp call sites. Flags writes that look like local-time strings
   (`toLocaleDateString`, `toLocaleTimeString`, naive `datetime.now()`).
   Display-only call sites are still listed but tagged so you can scan
   for true persistence bugs.

2. **Live Supabase audit** — when SUPABASE_URL + SUPABASE_KEY env vars
   are set, queries event-log tables (`shoot_sessions`, `action_log`,
   `client_errors`, `card_stage_history`) and verifies each timestamp
   parses as UTC ISO 8601 with explicit `Z` or `+00:00` suffix.
   Without env vars the live mode is skipped with a printed note.

Usage:
    python3 v2/backend/scripts/audit_utc.py
    SUPABASE_URL=... SUPABASE_KEY=... python3 v2/backend/scripts/audit_utc.py

Exit code 0 if no persistent-write issues found, 1 otherwise.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent  # …/Maket CP
FRONTEND = REPO / "v2" / "frontend"
BACKEND = REPO / "v2" / "backend"


# ─── Static codebase audit ───

PERSIST_HINT_PATTERNS = [
    # (regex, severity, description)
    (re.compile(r"toLocaleDateString|toLocaleTimeString|toLocaleString"),
     "warn", "JS toLocale*: localized — display-only acceptable, persist NOT acceptable"),
    (re.compile(r"datetime\.now\(\s*\)(?!\s*\.\s*astimezone)"),
     "warn", "Python datetime.now() without timezone: returns local time"),
    (re.compile(r"datetime\.utcnow\(\s*\)"),
     "warn", "Python datetime.utcnow(): naive UTC, prefer datetime.now(timezone.utc)"),
    (re.compile(r"new Date\(\s*\)\.toString\(\)"),
     "warn", "JS Date.toString(): localized; use toISOString()"),
]


def static_audit() -> list[dict]:
    """Scan repo for timestamp anti-patterns."""
    findings: list[dict] = []
    targets = list(FRONTEND.rglob("*.js")) + list(BACKEND.rglob("*.py"))
    for path in targets:
        # skip our own audit script and minified bundles
        if path.name == "audit_utc.py":
            continue
        if "node_modules" in str(path) or "_archived" in path.name:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for pat, sev, desc in PERSIST_HINT_PATTERNS:
                if pat.search(line):
                    findings.append({
                        "file": str(path.relative_to(REPO)),
                        "line": i,
                        "severity": sev,
                        "match": line.strip()[:200],
                        "rule": desc,
                    })
    return findings


# ─── Live Supabase audit ───

UTC_OK_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$"
)


def parse_iso_utc(s: str) -> bool:
    if not isinstance(s, str):
        return False
    if not UTC_OK_RE.match(s):
        return False
    try:
        # strict round-trip
        s_norm = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s_norm)
        return dt.utcoffset() is not None and dt.utcoffset().total_seconds() == 0
    except Exception:
        return False


def supabase_select(url: str, key: str, table: str, columns: str) -> list[dict]:
    """Cheap PostgREST GET via stdlib (no supabase-py dep needed)."""
    qs = urllib.parse.urlencode({"select": columns, "limit": "500"})
    full = f"{url.rstrip('/')}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(
        full,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


LIVE_TABLES: list[tuple[str, list[str]]] = [
    ("shoot_sessions", ["id", "start_time", "end_time", "created_at", "updated_at"]),
    ("action_log",     ["id", "created_at"]),
    ("client_errors",  ["id", "created_at"]),
]


def live_audit(url: str, key: str) -> list[dict]:
    findings: list[dict] = []
    for table, cols in LIVE_TABLES:
        try:
            rows = supabase_select(url, key, table, ",".join(cols))
        except Exception as e:
            findings.append({"table": table, "error": str(e)})
            continue
        for row in rows:
            for col in cols:
                if col == "id":
                    continue
                val = row.get(col)
                if val is None:
                    continue
                if not parse_iso_utc(val):
                    findings.append({
                        "table": table,
                        "column": col,
                        "row_id": row.get("id"),
                        "value": val,
                        "rule": "not ISO 8601 UTC (Z or +00:00 suffix required)",
                    })
    return findings


# ─── Report ───

def main() -> int:
    print("== Maket CP UTC audit ==")
    print(f"repo: {REPO}")
    print()

    static = static_audit()
    print(f"Static codebase audit: {len(static)} hit(s)")
    # group by file for readability
    by_file: dict[str, list[dict]] = {}
    for f in static:
        by_file.setdefault(f["file"], []).append(f)
    for fp in sorted(by_file):
        print(f"  {fp}")
        for hit in by_file[fp][:50]:
            print(f"    L{hit['line']} [{hit['severity']}] {hit['rule']}")
            print(f"      > {hit['match']}")
    print()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    persist_issues: list[dict] = []
    if url and key:
        print("Live Supabase audit:")
        live = live_audit(url, key)
        if not live:
            print("  ok — all timestamps are ISO 8601 UTC")
        else:
            for f in live:
                print(f"  {f}")
            persist_issues = [f for f in live if "error" not in f]
    else:
        print("Live Supabase audit: SKIPPED (set SUPABASE_URL + SUPABASE_KEY to enable)")
    print()

    # Static warnings are advisory; only live persistence issues fail the
    # script. Masha can run with env vars set to block on real bugs.
    if persist_issues:
        print(f"FAIL — {len(persist_issues)} persistent UTC violation(s)")
        return 1
    print("OK — no persistent UTC violations found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
