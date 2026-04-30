-- ============================================================
-- Migration 034: photo_originals — линк source RAW/TIFF → внешний storage.
-- Author: Claude (worktree trusting-brahmagupta-9b71f4, 2026-04-30).
-- Status: PROPOSED — apply вручную через Studio / supabase db push.
-- ============================================================
--
-- Зачем отдельная таблица, а не колонка на photo_versions:
--   photo_versions хранит ПОСТПРОДАКШНОВЫЕ версии (color_correction / retouch /
--   grading) — JPEG-превью + .cos в Supabase Storage bucket postprod.
--   Source-файл (CR3/TIFF, 30–80 MB) — другая сущность: один на фото, лежит во
--   внешнем backend'е (Google Drive — для начала; S3/B2 — потенциально позже).
--   Класть file_id оригинала в photo_versions значит дублировать его на каждой
--   версии и ломать инвариант «одна строка = один артефакт постпрода».
--
-- Почему storage_backend как enum-через-CHECK, а не FK на отдельную таблицу:
--   На обозримом горизонте у нас 1–3 backend'а. CHECK-constraint проще,
--   расширяется ALTER'ом, не требует JOIN'а на запросах.
--
-- Связь с кодом:
--   v2/backend/core/infra/gdrive.py — GDriveRepository.upload() возвращает
--     file_id, web_view_link, size, mime_type. Эти поля и хранятся здесь.
--   v2/backend/setup_gdrive.py — OAuth-flow (одноразовый, перед первым upload).
--
-- Идемпотентно. Безопасно к повторному запуску.
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- 0. Prerequisites — RLS-функции (создаются повторно как CREATE OR REPLACE
--    на случай свежего окружения; см. 030_photo_versions.sql).
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM projects WHERE owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_shared_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT project_id FROM share_links
   WHERE is_active = true
     AND (expires_at IS NULL OR expires_at > now());
$$;


-- ──────────────────────────────────────────────────────────────
-- 1. Таблица photo_originals.
-- ──────────────────────────────────────────────────────────────
-- Один оригинал = одна строка в рамках (project_id, photo_name, storage_backend).
-- photo_name — каноническое имя файла как на диске (IMG_0001.CR3); не stem,
--   потому что для разных расширений (CR3 vs TIFF vs DNG) нужен раздельный учёт.
-- file_id — opaque-id у backend'а: для Drive это files.id (string),
--   для будущего S3 будет object key. Таблица не интерпретирует его.

CREATE TABLE IF NOT EXISTS public.photo_originals (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    photo_name        text        NOT NULL,                       -- IMG_0001.CR3
    storage_backend   text        NOT NULL
                      CHECK (storage_backend IN ('gdrive', 's3', 'b2')),
    file_id           text        NOT NULL,                       -- Drive files.id или object key
    parent_folder_id  text,                                        -- Drive folder; NULL для backend'ов без папок
    file_size_bytes   bigint      CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    mime_type         text,                                        -- 'image/x-canon-cr3', 'image/tiff', etc.
    web_view_link     text,                                        -- Drive webViewLink — для UI «Открыть в Drive»
    metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,    -- exif, checksum, batch_id и пр. без ALTER
    uploaded_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Уникальность: одна запись на (проект, имя файла, backend).
-- Несколько backend'ов на один файл = миграция/копия — допустимый сценарий.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'photo_originals_project_photo_backend_key'
       AND conrelid = 'public.photo_originals'::regclass
  ) THEN
    ALTER TABLE public.photo_originals
      ADD CONSTRAINT photo_originals_project_photo_backend_key
      UNIQUE (project_id, photo_name, storage_backend);
  END IF;
END$$;


-- ──────────────────────────────────────────────────────────────
-- 2. Индексы.
-- ──────────────────────────────────────────────────────────────
-- Паттерны запросов:
--   * по (project_id) — список оригиналов проекта
--   * по (project_id, photo_name) — джойн с photo_versions при отдаче UI
--   * по (file_id) — обратный поиск при webhook'ах от Drive (когда подключим)

CREATE INDEX IF NOT EXISTS idx_photo_originals_project
    ON public.photo_originals (project_id);

CREATE INDEX IF NOT EXISTS idx_photo_originals_project_photo
    ON public.photo_originals (project_id, photo_name);

CREATE INDEX IF NOT EXISTS idx_photo_originals_file_id
    ON public.photo_originals (storage_backend, file_id);


-- ──────────────────────────────────────────────────────────────
-- 3. Row-Level Security — паттерн идентичен photo_versions (см. 030).
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.photo_originals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_originals_owner          ON public.photo_originals;
DROP POLICY IF EXISTS photo_originals_member_select  ON public.photo_originals;
DROP POLICY IF EXISTS photo_originals_member_insert  ON public.photo_originals;
DROP POLICY IF EXISTS photo_originals_member_update  ON public.photo_originals;
DROP POLICY IF EXISTS photo_originals_anon_select    ON public.photo_originals;

-- Владелец: всё.
CREATE POLICY photo_originals_owner
  ON public.photo_originals
  FOR ALL
  USING      (project_id IN (SELECT public.get_my_project_ids()))
  WITH CHECK (project_id IN (SELECT public.get_my_project_ids()));

-- Участник проекта: SELECT + INSERT + UPDATE.
-- DELETE остаётся за владельцем (ниже только SELECT/INSERT/UPDATE для memberов).
CREATE POLICY photo_originals_member_select
  ON public.photo_originals
  FOR SELECT
  USING (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY photo_originals_member_insert
  ON public.photo_originals
  FOR INSERT
  WITH CHECK (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY photo_originals_member_update
  ON public.photo_originals
  FOR UPDATE
  USING      (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

-- Анонимный гость по share-ссылке: только SELECT (для UI «открыть оригинал»).
CREATE POLICY photo_originals_anon_select
  ON public.photo_originals
  FOR SELECT
  USING (project_id IN (SELECT public.get_shared_project_ids()));


-- ──────────────────────────────────────────────────────────────
-- 4. Trigger — auto-touch updated_at.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._photo_originals_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_originals_touch_updated_at ON public.photo_originals;

CREATE TRIGGER trg_photo_originals_touch_updated_at
  BEFORE UPDATE ON public.photo_originals
  FOR EACH ROW
  EXECUTE FUNCTION public._photo_originals_touch_updated_at();


-- ──────────────────────────────────────────────────────────────
-- 5. Комментарии.
-- ──────────────────────────────────────────────────────────────

COMMENT ON TABLE  public.photo_originals
  IS 'Source RAW/TIFF файлы во внешнем storage (Google Drive и т.п.). Один оригинал = одна строка в рамках (project_id, photo_name, storage_backend). photo_versions ссылается на эту таблицу неявно через project_id+photo_name.';
COMMENT ON COLUMN public.photo_originals.storage_backend
  IS 'Какой backend хранит файл. Сейчас только gdrive; s3/b2 зарезервированы для будущего.';
COMMENT ON COLUMN public.photo_originals.file_id
  IS 'Идентификатор файла у backend''а: Drive files.id (string) или S3 object key. Таблица не интерпретирует.';
COMMENT ON COLUMN public.photo_originals.parent_folder_id
  IS 'Drive folder, в котором лежит файл (для UI «открыть в Drive» и для batch upload). NULL для backend''ов без иерархии.';
COMMENT ON COLUMN public.photo_originals.metadata
  IS 'JSONB для расширений без ALTER TABLE: exif, sha256, batch_id, original_path и т.д.';

-- ============================================================
-- END of 034_photo_originals.sql
-- ============================================================
