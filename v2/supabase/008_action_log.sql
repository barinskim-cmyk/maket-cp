-- Migration 008: Action log — audit trail for photo/card/container operations
-- Tracks WHO did WHAT and WHEN for accountability and dispute resolution.
--
-- Two actor types:
--   1. Authorized user  → actor_id = auth.uid(), actor_token = NULL
--   2. Magic link guest  → actor_id = NULL, actor_token = share_token

CREATE TABLE IF NOT EXISTS public.action_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Who
  actor_id    uuid,                          -- auth.uid() for logged-in users
  actor_token text,                          -- share_token for magic-link guests
  actor_name  text NOT NULL DEFAULT '',      -- display name (email / "Клиент (ссылка)")
  actor_role  text NOT NULL DEFAULT 'owner', -- owner | client | retoucher | editor

  -- What
  action      text NOT NULL,                 -- add_to_card, remove_from_card,
                                             -- add_to_container, remove_from_container,
                                             -- approve_card, reject_card,
                                             -- add_to_slot, remove_from_slot,
                                             -- create_container, delete_container,
                                             -- rename_container, move_to_container

  -- Where / what
  target_type text,                          -- card | container | slot | project
  target_id   text,                          -- card.id or container.id
  target_name text,                          -- card name or container name (snapshot)
  photo_name  text,                          -- file name of the photo (if applicable)
  details     jsonb                          -- extra context (e.g. old/new values)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_action_log_project   ON public.action_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_actor     ON public.action_log(actor_id)    WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_action_log_token     ON public.action_log(actor_token) WHERE actor_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_action_log_photo     ON public.action_log(project_id, photo_name) WHERE photo_name IS NOT NULL;

-- RLS: project owner sees all logs; token users see only their project's logs
ALTER TABLE public.action_log ENABLE ROW LEVEL SECURITY;

-- Policy: owner can read/insert logs for their projects
CREATE POLICY action_log_owner_read ON public.action_log
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
  );

CREATE POLICY action_log_owner_insert ON public.action_log
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
  );

-- Policy: anonymous (token) users can insert logs via RPC (see below)
-- We use a SECURITY DEFINER function so anon users can write logs

CREATE OR REPLACE FUNCTION public.log_action(
  p_project_id  uuid,
  p_share_token text DEFAULT NULL,
  p_actor_name  text DEFAULT '',
  p_actor_role  text DEFAULT 'owner',
  p_action      text DEFAULT '',
  p_target_type text DEFAULT NULL,
  p_target_id   text DEFAULT NULL,
  p_target_name text DEFAULT NULL,
  p_photo_name  text DEFAULT NULL,
  p_details     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_has_access boolean := false;
BEGIN
  -- Determine actor
  v_actor_id := auth.uid();

  -- Verify access: either owner or valid share token
  IF v_actor_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = v_actor_id
    ) INTO v_has_access;
    -- Also check team membership
    IF NOT v_has_access THEN
      SELECT EXISTS(
        SELECT 1 FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        JOIN projects p ON p.owner_id = t.owner_id
        WHERE tm.user_id = v_actor_id AND p.id = p_project_id
      ) INTO v_has_access;
    END IF;
  END IF;

  IF NOT v_has_access AND p_share_token IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM project_shares
      WHERE project_id = p_project_id
        AND token = p_share_token
        AND (expires_at IS NULL OR expires_at > now())
    ) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'No access to project';
  END IF;

  INSERT INTO action_log (
    project_id, actor_id, actor_token, actor_name, actor_role,
    action, target_type, target_id, target_name, photo_name, details
  ) VALUES (
    p_project_id, v_actor_id, p_share_token, p_actor_name, p_actor_role,
    p_action, p_target_type, p_target_id, p_target_name, p_photo_name, p_details
  );
END;
$$;

-- Grant execute to anon (for magic link users) and authenticated
GRANT EXECUTE ON FUNCTION public.log_action TO anon, authenticated;

-- Policy: anon can read logs for projects they have a valid share token for
-- (reading is done via RPC or direct query with token check)
CREATE POLICY action_log_anon_read ON public.action_log
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM public.project_shares
      WHERE token = current_setting('request.headers', true)::json->>'x-share-token'
        AND (expires_at IS NULL OR expires_at > now())
    )
  );
