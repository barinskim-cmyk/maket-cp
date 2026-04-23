-- ============================================================
-- ВНИМАНИЕ: это предложенная миграция, ещё не применённая.
-- Реверс-инжиниринг на основе:
--   1. Существующего файла `v2/backend/migrations/001_photo_versions.sql`
--      (вне numbered-сequence v2/supabase/, но возможно уже запущен в prod).
--   2. Использования в `v2/frontend/js/supabase.js` (строки 909-913, 2873-3111, 3870-3896)
--      и `v2/frontend/js/previews.js` (строка 911).
--   3. Паттернов из существующих миграций `002_soft_delete.sql`...`029_fix_share_rpcs.sql`.
--
-- Цель: зафиксировать `photo_versions` как номерную миграцию
-- `030_photo_versions.sql` в `v2/supabase/`, чтобы при поднятии окружения
-- с нуля таблица создавалась в том же порядке, что и в prod.
--
-- Перед применением:
--   1. PA — проверить `mcp__supabase__execute_sql('SELECT table_name FROM information_schema.tables WHERE table_name = ''photo_versions''')`.
--      Если таблица УЖЕ существует в prod — мигрировать только отсутствующие индексы/policies (idempotent CREATE IF NOT EXISTS уже включены ниже).
--      Если НЕ существует — запустить целиком.
--   2. Проверить существует ли RPC-функция `get_my_project_ids()` (по all_pending_migrations.sql:1085-1094 определяется inline при первичном накате).
--      Если нет — сначала её создать (DDL ниже в разделе 0).
--   3. Проверить bucket `postprod` в Storage Dashboard (см. раздел 3).
--   4. Тест на staging-branch перед prod (см. `docs/agents/dev/photo_versions-migration-proposal.md`).
--
-- Сгенерировано: 2026-04-23 autonomous cleanup, Claude.
-- Референс: `audits/coordinator-reconciliation-2026-04-23.md` п.2.2 и п.4.5.
-- ============================================================


-- 0. Prerequisites — функции, на которые опирается RLS.
-- Обе функции исторически были определены inline в all_pending_migrations.sql
-- (get_my_project_ids в районе строки 1085; get_shared_project_ids в 001_photo_versions.sql).
-- Здесь — idempotent дефиниции на случай, если миграция применяется первой.

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
  SELECT DISTINCT project_id FROM share_links;
$$;


-- 1. Таблица photo_versions
-- Хранит метаданные версий фото на этапах постпродакшна (ЦК / Ретушь / Грейдинг).
-- Сами файлы (превью JPEG + COS) лежат в Supabase Storage, бакет `postprod`.
-- Пути в preview_path/cos_path — относительно бакета.
--
-- Колонки подтверждены кодом v2/frontend/js/supabase.js:3018-3045 (sbSavePhotoVersion),
-- строки 2886-2888 (load by project), 2963-2967 (load all by project),
-- 3031-3032 (upsert с onConflict), 3061-3065 (update selected).

CREATE TABLE IF NOT EXISTS photo_versions (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    photo_name    text NOT NULL,                     -- напр. IMG_0001.CR3
    stage         text NOT NULL CHECK (stage IN ('color_correction', 'retouch', 'grading')),
    version_num   int  NOT NULL CHECK (version_num > 0),
    preview_path  text NOT NULL DEFAULT '',           -- {project_id}/{stem}/{stage}_{N}.jpg
    cos_path      text NOT NULL DEFAULT '',           -- {project_id}/{stem}/{stage}_{N}.cos
    selected      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),

    -- Уникальность: одно фото, один этап, один номер версии.
    -- Код использует onConflict: 'project_id,photo_name,stage,version_num' (supabase.js:3032).
    UNIQUE (project_id, photo_name, stage, version_num)
);


-- 2. Индексы
-- Основной паттерн запросов (supabase.js:2886-2897, 2994-2997):
--   SELECT ... WHERE project_id = ? [AND stage = ?]
--     ORDER BY photo_name ASC, version_num ASC
-- Индекс покрывает project_id + photo_name + stage — достаточно для всех текущих запросов.

CREATE INDEX IF NOT EXISTS idx_photo_versions_project
    ON photo_versions (project_id, photo_name, stage);

-- Отдельный индекс для запросов realtime-подписки
-- (supabase.js:3882-3888 — filter по project_id=eq.X)
-- Не добавлен отдельно — покрыт idx_photo_versions_project.


-- 3. Row-Level Security
-- Паттерн идентичен тому, что применяется в 011_annotations.sql, 012_oc_comments.sql,
-- 016_previews_rls.sql: владелец через get_my_project_ids(), участники через project_members,
-- анонимный доступ через get_shared_project_ids() (для клиентов без регистрации по share-ссылке).

ALTER TABLE photo_versions ENABLE ROW LEVEL SECURITY;

-- Владелец проекта: полный доступ
CREATE POLICY photo_versions_owner ON photo_versions
    FOR ALL
    USING (project_id IN (SELECT get_my_project_ids()))
    WITH CHECK (project_id IN (SELECT get_my_project_ids()));

-- Участники проекта (зарегистрированные по приглашению): SELECT + UPDATE.
-- UPDATE нужен, чтобы заказчик мог менять selected (supabase.js:3074 — sbSelectPhotoVersion).
CREATE POLICY photo_versions_member_select ON photo_versions
    FOR SELECT
    USING (project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
    ));

CREATE POLICY photo_versions_member_update ON photo_versions
    FOR UPDATE
    USING (project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
    ))
    WITH CHECK (project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
    ));

-- Анонимный доступ по share-ссылке: только SELECT.
-- Важно: анонимные клиенты НЕ могут менять selected через эту политику.
-- Если требуется — оформить через RPC-функцию с проверкой share_token (паттерн из 015_share_previews.sql).
CREATE POLICY photo_versions_anon_select ON photo_versions
    FOR SELECT
    USING (project_id IN (SELECT get_shared_project_ids()));


-- 4. Storage бакеты
-- ВАЖНО: бакеты создаются вручную в Supabase Dashboard → Storage
-- или через Supabase Management API (через MCP tool `mcp__supabase__apply_migration` нельзя).
--
-- Бакет: postprod
--   Публичный: нет
--   Структура файлов:
--     {project_id}/{photo_stem}/color_correction_1.jpg   (превью)
--     {project_id}/{photo_stem}/color_correction_1.cos   (COS файл)
--     {project_id}/{photo_stem}/retouch_1.jpg
--     {project_id}/{photo_stem}/retouch_1.cos
--     {project_id}/{photo_stem}/grading_1.jpg
--
-- Storage policies (настроить в Dashboard → Storage → Policies или через MCP):
--   - Владелец проекта: upload/download/delete
--   - Участники: download
--   - Анонимный (share-link): download только .jpg (не .cos)
--
-- SQL для создания бакета (если поддерживается вашим окружением):
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('postprod', 'postprod', false)
-- ON CONFLICT (id) DO NOTHING;


-- 5. Realtime
-- Код использует postgres_changes realtime подписку (supabase.js:3881-3896).
-- Realtime должен быть включён для таблицы — в Supabase Dashboard → Database → Replication
-- добавить photo_versions в publication `supabase_realtime`.
--
-- SQL (если нужно включить программно):
-- ALTER PUBLICATION supabase_realtime ADD TABLE photo_versions;


-- 6. Открытые вопросы перед применением (см. docs/agents/dev/photo_versions-migration-proposal.md)
-- - Существует ли таблица в prod уже (запущен ли ранее v2/backend/migrations/001_photo_versions.sql)?
-- - Регион Supabase-проекта (для landing-claim «EU серверы», см. audit п.4.6)?
-- - Набор stage-значений в prod данных: должен быть ('color_correction', 'retouch', 'grading').
--   Проверить: SELECT stage, count(*) FROM photo_versions GROUP BY stage;
-- - Нужно ли расширять CHECK-constraint stage до ('color_correction', 'retouch', 'grading', 'select', 'approved')
--   — это зависит от будущих фаз per-photo pipeline (см. `pipeline_backlog.md` блок H1).
