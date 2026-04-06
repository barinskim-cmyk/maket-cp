-- ══════════════════════════════════════════════
-- Migration 012: Комментарии к OC-контейнерам
-- ══════════════════════════════════════════════
-- Запускать в Supabase SQL Editor

CREATE TABLE IF NOT EXISTS oc_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  container_id  text NOT NULL,        -- id контейнера из oc_containers JSONB

  -- Контент
  text          text NOT NULL,
  author_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author        text DEFAULT 'team',  -- 'team' | 'client'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oc_comments_project ON oc_comments(project_id, container_id);

ALTER TABLE oc_comments ENABLE ROW LEVEL SECURITY;

-- RLS: доступ через project (владелец или участник)
CREATE POLICY "oc_comments_select" ON oc_comments FOR SELECT
  USING (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

CREATE POLICY "oc_comments_insert" ON oc_comments FOR INSERT
  WITH CHECK (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

CREATE POLICY "oc_comments_delete" ON oc_comments FOR DELETE
  USING (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));
