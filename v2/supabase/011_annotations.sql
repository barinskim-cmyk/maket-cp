-- ══════════════════════════════════════════════
-- Migration 011: Аннотации к фото (кружки + текст)
-- ══════════════════════════════════════════════
-- Запускать в Supabase SQL Editor

CREATE TABLE IF NOT EXISTS annotations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  photo_name    text NOT NULL,

  -- Контент
  type          text NOT NULL DEFAULT 'attention'
                CHECK (type IN ('remove', 'soften', 'attention')),
  text          text DEFAULT '',
  tags          jsonb DEFAULT '[]'::jsonb,

  -- Кружок (nullable — текстовые комментарии без кружка)
  has_circle    boolean DEFAULT false,
  x             numeric,        -- % позиция (0-100)
  y             numeric,        -- % позиция (0-100)
  r             numeric DEFAULT 5, -- % радиус от ширины

  -- Мета
  author_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author        text DEFAULT 'team',  -- 'team' | 'client'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_project ON annotations(project_id);
CREATE INDEX IF NOT EXISTS idx_annotations_photo ON annotations(project_id, photo_name);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

-- RLS: доступ через project (владелец или участник)
CREATE POLICY "annotations_select" ON annotations FOR SELECT
  USING (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

CREATE POLICY "annotations_insert" ON annotations FOR INSERT
  WITH CHECK (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

CREATE POLICY "annotations_update" ON annotations FOR UPDATE
  USING (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

CREATE POLICY "annotations_delete" ON annotations FOR DELETE
  USING (project_id IN (SELECT get_my_project_ids())
    OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));
