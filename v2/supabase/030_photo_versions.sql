-- ============================================================
-- Migration 030: photo_versions canonical.
-- Author: PA (overnight batch 2026-04-23).
-- Status: PROPOSED — требует SQL-проверки на prod перед применением.
-- Source of truth: см. docs/agents/dev/photo_versions-migration-proposal.md.
-- После apply: удалить proposed-photo_versions.sql из v2/supabase/.
-- ============================================================
--
-- Идемпотентная миграция. Безопасна к повторному запуску и к
-- запуску на окружении, где таблица photo_versions уже существует
-- (накаченная через v2/backend/migrations/001_photo_versions.sql
-- или через v2/supabase/all_pending_migrations.sql).
--
-- Связь с кодом:
--   - v2/frontend/js/supabase.js:2886-3132 (CRUD), 3874-3896 (realtime).
--   - v2/frontend/js/previews.js:895-918 (_pvSyncVersionsToCloud).
--
-- Примечание по именам колонок:
--   В спецификации PA-задачи обсуждалась колонка "storage_path" для .cos,
--   но в работающем коде уже используются ДВА поля: preview_path (JPEG)
--   и cos_path (.cos). Миграция сохраняет их как source of truth,
--   чтобы не ломать прод. Generic storage_path НЕ создаётся.
--
-- Stage-значения:
--   Фиксирую enum ('color_correction', 'retouch', 'grading') — ровно тот набор,
--   что используется в коде (previews.js:895, supabase.js:2986).
--   Задача упомянула альтернативный набор ('cc','retouch','tech') — он НЕ отражает
--   фактическое состояние, применять нельзя. Расширение enum — отдельной
--   миграцией при появлении per-photo pipeline этапов (см. backlog H1).
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- 0. Prerequisites — функции, на которые опирается RLS.
-- ──────────────────────────────────────────────────────────────
-- Исторически get_my_project_ids() и get_shared_project_ids() создаются
-- в all_pending_migrations.sql и 001_photo_versions.sql соответственно.
-- Ниже — идемпотентные CREATE OR REPLACE на случай, если 030 применяется
-- на свежем окружении первой.

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
-- 1. Таблица photo_versions — базовый набор колонок.
-- ──────────────────────────────────────────────────────────────
-- Создаётся только если её ещё нет. Если таблица уже существует
-- (что типично для prod), этот блок no-op'ом пройдёт, а дополнительные
-- колонки подтянутся в разделе 2 через ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.photo_versions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    photo_name    text        NOT NULL,                   -- IMG_0001.CR3
    stage         text        NOT NULL
                  CHECK (stage IN ('color_correction', 'retouch', 'grading')),
    version_num   int         NOT NULL CHECK (version_num > 0),
    preview_path  text        NOT NULL DEFAULT '',        -- {project_id}/{stem}/{stage}_{N}.jpg
    cos_path      text        NOT NULL DEFAULT '',        -- {project_id}/{stem}/{stage}_{N}.cos
    selected      boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Уникальность (project_id, photo_name, stage, version_num) — соответствует
-- onConflict-ключу в supabase.js:3032 (sbSavePhotoVersion upsert).
-- Идемпотентно: если constraint уже есть — DO-блок не упадёт.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'photo_versions_project_id_photo_name_stage_version_num_key'
       AND conrelid = 'public.photo_versions'::regclass
  ) THEN
    ALTER TABLE public.photo_versions
      ADD CONSTRAINT photo_versions_project_id_photo_name_stage_version_num_key
      UNIQUE (project_id, photo_name, stage, version_num);
  END IF;
END$$;


-- ──────────────────────────────────────────────────────────────
-- 2. Расширение схемы: forward-looking колонки.
-- ──────────────────────────────────────────────────────────────
-- updated_at — для триггера auto-update (см. раздел 6).
-- created_by — кто создал версию (owner/member/retoucher); NULL допустим для
--              исторических записей до миграции и для анонимных импортов.
-- metadata   — JSONB для расширений (обменник для будущих полей без миграций:
--              напр. exif, checksum, batch_id, ai_score).

ALTER TABLE public.photo_versions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.photo_versions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.photo_versions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ──────────────────────────────────────────────────────────────
-- 3. Индексы.
-- ──────────────────────────────────────────────────────────────
-- Паттерн запросов (supabase.js:2886-2897, 2963-2976, 2992-2997):
--   SELECT ... WHERE project_id = ? [AND photo_name = ?] [AND stage = ?]
--     ORDER BY photo_name ASC, version_num ASC
-- Один композитный индекс по (project_id, photo_name, stage) покрывает все эти
-- кейсы плюс realtime-фильтр project_id=eq.X (supabase.js:3887).

CREATE INDEX IF NOT EXISTS idx_photo_versions_project
    ON public.photo_versions (project_id);

CREATE INDEX IF NOT EXISTS idx_photo_versions_project_photo
    ON public.photo_versions (project_id, photo_name);

CREATE INDEX IF NOT EXISTS idx_photo_versions_project_photo_stage
    ON public.photo_versions (project_id, photo_name, stage);


-- ──────────────────────────────────────────────────────────────
-- 4. Row-Level Security.
-- ──────────────────────────────────────────────────────────────
-- Паттерн идентичен 011_annotations.sql и 016_previews_rls.sql.
-- Политики пересоздаются через DROP POLICY IF EXISTS, чтобы миграция
-- была идемпотентной и позволяла поправить расхождение в prod.

ALTER TABLE public.photo_versions ENABLE ROW LEVEL SECURITY;

-- Очистить старые политики (если проект уже был накачен 001_photo_versions.sql).
DROP POLICY IF EXISTS photo_versions_owner           ON public.photo_versions;
DROP POLICY IF EXISTS photo_versions_member_select   ON public.photo_versions;
DROP POLICY IF EXISTS photo_versions_member_insert   ON public.photo_versions;
DROP POLICY IF EXISTS photo_versions_member_update   ON public.photo_versions;
DROP POLICY IF EXISTS photo_versions_anon_select     ON public.photo_versions;

-- 4.1. Владелец/manager проекта: полный доступ (SELECT/INSERT/UPDATE/DELETE).
CREATE POLICY photo_versions_owner
  ON public.photo_versions
  FOR ALL
  USING     (project_id IN (SELECT public.get_my_project_ids()))
  WITH CHECK (project_id IN (SELECT public.get_my_project_ids()));

-- 4.2. Участники проекта (member/editor/retoucher через project_members):
--      SELECT + INSERT + UPDATE. DELETE — только у владельца (см. 4.1).
-- Зарегистрированный заказчик/ретушёр должен уметь добавлять версии
-- (upload из браузера) и менять selected (supabase.js:3074).
CREATE POLICY photo_versions_member_select
  ON public.photo_versions
  FOR SELECT
  USING (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY photo_versions_member_insert
  ON public.photo_versions
  FOR INSERT
  WITH CHECK (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY photo_versions_member_update
  ON public.photo_versions
  FOR UPDATE
  USING      (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  ));

-- 4.3. Анонимный guest по активной share-ссылке: только SELECT.
-- Изменения идут через RPC save_cards_by_token / специализированные функции,
-- не через прямой UPDATE (см. паттерн 015_share_previews.sql, 029_fix_share_rpcs.sql).
CREATE POLICY photo_versions_anon_select
  ON public.photo_versions
  FOR SELECT
  USING (project_id IN (SELECT public.get_shared_project_ids()));


-- ──────────────────────────────────────────────────────────────
-- 5. Realtime publication.
-- ──────────────────────────────────────────────────────────────
-- Код подписывается на postgres_changes (supabase.js:3881-3896).
-- Добавляем таблицу в publication supabase_realtime только если её там ещё нет,
-- чтобы повторный запуск миграции не падал с "relation already member of publication".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'photo_versions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_versions';
  END IF;
EXCEPTION
  -- Publication может отсутствовать в self-hosted окружении без realtime.
  -- В таком случае просто пропускаем — не блокируем миграцию.
  WHEN undefined_object THEN
    RAISE NOTICE 'publication supabase_realtime не найден — пропускаю realtime-регистрацию';
END$$;


-- ──────────────────────────────────────────────────────────────
-- 6. Trigger: auto-update updated_at при UPDATE.
-- ──────────────────────────────────────────────────────────────
-- Паттерн соответствует использованию updated_at в projects/articles
-- (schema.sql:50, 018_articles_sync.sql:18).

CREATE OR REPLACE FUNCTION public._photo_versions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_versions_touch_updated_at ON public.photo_versions;

CREATE TRIGGER trg_photo_versions_touch_updated_at
  BEFORE UPDATE ON public.photo_versions
  FOR EACH ROW
  EXECUTE FUNCTION public._photo_versions_touch_updated_at();


-- ──────────────────────────────────────────────────────────────
-- 7. Комментарии к объектам (для самодокументации в БД).
-- ──────────────────────────────────────────────────────────────

COMMENT ON TABLE  public.photo_versions
  IS 'Версии фото на этапах постпродакшна (color_correction / retouch / grading). Файлы лежат в Storage bucket postprod; здесь только метаданные.';
COMMENT ON COLUMN public.photo_versions.stage
  IS 'Этап пайплайна. Enum: color_correction | retouch | grading. Расширять через отдельную миграцию с ALTER CONSTRAINT.';
COMMENT ON COLUMN public.photo_versions.preview_path
  IS 'Путь в bucket postprod до JPEG-превью: {project_id}/{photo_stem}/{stage}_{version_num}.jpg';
COMMENT ON COLUMN public.photo_versions.cos_path
  IS 'Путь в bucket postprod до .cos файла (метаданные Capture One). Пусто для этапов без COS.';
COMMENT ON COLUMN public.photo_versions.selected
  IS 'Какая из версий этапа выбрана owner-ом/клиентом. Уникальна в рамках (project_id, photo_name, stage) на уровне приложения, не БД.';
COMMENT ON COLUMN public.photo_versions.metadata
  IS 'JSONB для будущих расширений (exif, checksum, batch_id, ai_score) без ALTER TABLE.';


-- ──────────────────────────────────────────────────────────────
-- 8. Storage bucket postprod — напоминание.
-- ──────────────────────────────────────────────────────────────
-- Бакет создаётся отдельно (Dashboard → Storage или REST API):
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('postprod', 'postprod', false)
--   ON CONFLICT (id) DO NOTHING;
--
-- Storage policies — через Dashboard или отдельную миграцию (паттерн 020/021/025).
-- Эта миграция (030) их не создаёт, т.к. Маша зафиксировала практику ручного
-- управления storage policies (feedback_supabase_storage_rls.md).
-- ============================================================
-- END of 030_photo_versions.sql
-- ============================================================
