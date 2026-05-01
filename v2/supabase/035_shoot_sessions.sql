-- 035_shoot_sessions.sql
-- Author: Claude (overnight 2026-04-30, Block B)
-- Status: PENDING — apply manually or via Supabase MCP. The MCP isn't
-- connected in this worktree's environment.
--
-- Creates `shoot_sessions` for the desktop Shooting Mode lifecycle.
-- One row per "user clicked Start shooting" → "user clicked End shooting"
-- (or aborted by closing the app / switching projects).
--
-- Times MUST be timestamptz (UTC). Maket CP standardizes on ISO-8601 UTC
-- everywhere; converting at the boundary would lose information.

CREATE TYPE shoot_session_status AS ENUM ('active', 'completed', 'aborted');

CREATE TABLE IF NOT EXISTS public.shoot_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  team_id       uuid        REFERENCES public.teams(id) ON DELETE SET NULL,
  session_path  text        NOT NULL,
  start_time    timestamptz NOT NULL,
  end_time      timestamptz,
  status        shoot_session_status NOT NULL DEFAULT 'active',
  events        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shoot_sessions_project_idx
  ON public.shoot_sessions (project_id, start_time DESC);

CREATE INDEX IF NOT EXISTS shoot_sessions_user_idx
  ON public.shoot_sessions (user_id, start_time DESC);

-- RLS: same pattern as cards/projects — owner or team member can read/write
-- their own sessions.
ALTER TABLE public.shoot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY shoot_sessions_owner_rw ON public.shoot_sessions
  FOR ALL
  USING (auth.uid() = user_id OR auth.uid() IS NULL)
  WITH CHECK (auth.uid() = user_id OR auth.uid() IS NULL);

-- updated_at touch trigger (matches existing tables in the schema).
CREATE OR REPLACE FUNCTION public.shoot_sessions_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shoot_sessions_touch ON public.shoot_sessions;
CREATE TRIGGER shoot_sessions_touch
  BEFORE UPDATE ON public.shoot_sessions
  FOR EACH ROW EXECUTE FUNCTION public.shoot_sessions_touch_updated_at();

-- Rollback:
--   DROP TABLE IF EXISTS public.shoot_sessions;
--   DROP TYPE IF EXISTS shoot_session_status;
