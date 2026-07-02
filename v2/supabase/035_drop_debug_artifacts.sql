-- Migration 035: remove diagnostic artifacts from 023 (audit 2026-07-02, item 3.2)
-- Applied to prod 2026-07-02 via MCP.
-- debug_log had GRANT ALL TO anon — anonymous read/write on a public table.
-- Storage policies from 023/024 were already superseded by 025 (verified live).
DROP FUNCTION IF EXISTS public.debug_capture_and_pass(uuid);
DROP TABLE IF EXISTS public.debug_log;
