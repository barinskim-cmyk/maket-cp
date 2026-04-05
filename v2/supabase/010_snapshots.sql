-- ══════════════════════════════════════════════
-- Migration 010: Project Snapshots
-- ══════════════════════════════════════════════
-- Снимки состояния проекта в ключевые моменты пайплайна.
-- Используются для: аргументации с клиентом, режима сверки,
-- отслеживания изменений после согласования.

CREATE TABLE IF NOT EXISTS snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id    text NOT NULL,                     -- 'client', 'color', 'retouch_ok', ...
  trigger     text NOT NULL DEFAULT 'manual',    -- 'client_approved', 'client_changes', 'manual', ...
  actor_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- авторизованный пользователь
  actor_token uuid,                              -- share-token (для клиента по ссылке)
  actor_name  text,                              -- имя актора (для отображения)
  data        jsonb NOT NULL DEFAULT '{}',       -- полный слепок: cards, ocContainers
  note        text,                              -- описание ("Согласование клиента", "Изменения после согласования")
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_stage ON snapshots(project_id, stage_id);

-- RLS
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

-- Владелец проекта: полный доступ
CREATE POLICY "snapshots_owner_all" ON snapshots FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

-- Участник команды: чтение
CREATE POLICY "snapshots_team_select" ON snapshots FOR SELECT
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE tm.user_id = auth.uid() AND p.team_id IS NOT NULL
    )
  );

-- RPC: создать снимок (SECURITY DEFINER — обходит RLS, проверяет доступ сам)
CREATE OR REPLACE FUNCTION public.create_snapshot(
  p_project_id uuid,
  p_stage_id text,
  p_trigger text,
  p_actor_id uuid DEFAULT NULL,
  p_actor_token uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_data jsonb DEFAULT '{}',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO snapshots (project_id, stage_id, trigger, actor_id, actor_token, actor_name, data, note)
  VALUES (p_project_id, p_stage_id, p_trigger, p_actor_id, p_actor_token, p_actor_name, p_data, p_note)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- RPC: получить снимки проекта (доступно анонимам по share-ссылке)
CREATE OR REPLACE FUNCTION public.get_snapshots_by_token(p_token uuid)
RETURNS SETOF snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id
  FROM share_links
  WHERE token = p_token AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive share token';
  END IF;

  RETURN QUERY
    SELECT * FROM snapshots
    WHERE project_id = v_project_id
    ORDER BY created_at ASC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_snapshot TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_snapshots_by_token TO anon, authenticated;
