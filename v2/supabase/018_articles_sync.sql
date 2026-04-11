-- ══════════════════════════════════════════════
-- Migration 018: Articles sync
-- Таблицы: articles, rename_log
-- Storage bucket: article-refs (для референс-изображений артикулов)
-- ══════════════════════════════════════════════

-- ── Таблица артикулов ──────────────────────────
CREATE TABLE IF NOT EXISTS articles (
  id          text        NOT NULL,
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sku         text        NOT NULL,
  category    text,
  color       text,
  status      text        NOT NULL DEFAULT 'unmatched', -- unmatched | matched | verified
  card_idx    int         NOT NULL DEFAULT -1,
  ref_image_path text,    -- путь в Storage bucket article-refs (если загружено)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, project_id)
);

-- ── Таблица лога переименований ────────────────
CREATE TABLE IF NOT EXISTS rename_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id     text,
  card_idx       int,
  original_name  text,
  new_name       text,
  trigger        text        DEFAULT 'verify',  -- verify | manual | ai
  renamed_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Индексы ────────────────────────────────────
CREATE INDEX IF NOT EXISTS articles_project_id_idx ON articles(project_id);
CREATE INDEX IF NOT EXISTS rename_log_project_id_idx ON rename_log(project_id);

-- ── RLS для articles ───────────────────────────
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- Владелец: полный доступ
CREATE POLICY "articles_owner_all" ON articles
  FOR ALL
  USING (project_id IN (SELECT get_my_project_ids()))
  WITH CHECK (project_id IN (SELECT get_my_project_ids()));

-- Участники проекта: только чтение
CREATE POLICY "articles_member_select" ON articles
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- По токену (share): только чтение через share_links
CREATE POLICY "articles_share_select" ON articles
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM share_links WHERE token = current_setting('request.jwt.claims', true)::json->>'share_token'
    )
  );

-- ── RLS для rename_log ─────────────────────────
ALTER TABLE rename_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rename_log_owner_all" ON rename_log
  FOR ALL
  USING (project_id IN (SELECT get_my_project_ids()))
  WITH CHECK (project_id IN (SELECT get_my_project_ids()));

-- ── Storage bucket article-refs ────────────────
-- Запустить вручную в Supabase Dashboard > Storage:
--   Bucket name: article-refs
--   Public: false
--   Allowed MIME types: image/*
--
-- После создания bucket добавить Storage policies:
--   Owner upload/read: storage.foldername(name)[1] = auth.uid()::text
--   (путь: {projectId}/{artId}.jpg)
--
-- INSERT INTO storage.buckets (id, name, public) VALUES ('article-refs', 'article-refs', false);

-- ── RPC: сохранить артикулы батчем ─────────────
CREATE OR REPLACE FUNCTION save_articles_batch(
  p_project_id uuid,
  p_articles   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  art jsonb;
BEGIN
  -- Проверить что caller является владельцем проекта
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Удалить артикулы которых нет в новом списке
  DELETE FROM articles
  WHERE project_id = p_project_id
    AND id NOT IN (
      SELECT (a->>'id') FROM jsonb_array_elements(p_articles) a
    );

  -- Upsert каждый артикул
  FOR art IN SELECT * FROM jsonb_array_elements(p_articles)
  LOOP
    INSERT INTO articles (id, project_id, sku, category, color, status, card_idx, ref_image_path, updated_at)
    VALUES (
      art->>'id',
      p_project_id,
      art->>'sku',
      art->>'category',
      art->>'color',
      COALESCE(art->>'status', 'unmatched'),
      COALESCE((art->>'card_idx')::int, -1),
      art->>'ref_image_path',
      now()
    )
    ON CONFLICT (id, project_id) DO UPDATE SET
      sku            = EXCLUDED.sku,
      category       = EXCLUDED.category,
      color          = EXCLUDED.color,
      status         = EXCLUDED.status,
      card_idx       = EXCLUDED.card_idx,
      ref_image_path = EXCLUDED.ref_image_path,
      updated_at     = now();
  END LOOP;
END;
$$;

-- ── RPC: сохранить лог переименований ──────────
CREATE OR REPLACE FUNCTION save_rename_log_batch(
  p_project_id uuid,
  p_entries    jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  entry jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO rename_log (project_id, article_id, card_idx, original_name, new_name, trigger, renamed_at)
    VALUES (
      p_project_id,
      entry->>'article_id',
      COALESCE((entry->>'card_idx')::int, -1),
      entry->>'original_name',
      entry->>'new_name',
      COALESCE(entry->>'trigger', 'manual'),
      COALESCE((entry->>'renamed_at')::timestamptz, now())
    );
  END LOOP;
END;
$$;
