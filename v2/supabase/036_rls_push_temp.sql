-- Migration 036: enable RLS on _push_temp (advisors ERROR, audit 2026-07-02)
-- Applied to prod 2026-07-02 via MCP.
-- Table is a staging area for github_patch_push(); accessed via service role /
-- SECURITY DEFINER only, so no policies needed — RLS with no policy = deny all
-- for anon/authenticated, service role bypasses RLS.
ALTER TABLE public._push_temp ENABLE ROW LEVEL SECURITY;
TRUNCATE public._push_temp;
