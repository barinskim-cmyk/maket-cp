-- ============================================================
-- Миграция: photo_versions + Storage бакеты
-- Запустить в Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Таблица photo_versions
-- Хранит метаданные версий фото на этапах постпродакшна.
-- Сами файлы (превью JPEG + COS) лежат в Supabase Storage.
create table if not exists photo_versions (
    id            uuid default gen_random_uuid() primary key,
    project_id    uuid not null references projects(id) on delete cascade,
    photo_name    text not null,                     -- IMG_0001.CR3
    stage         text not null check (stage in ('color_correction', 'retouch', 'grading')),
    version_num   int  not null check (version_num > 0),
    preview_path  text not null default '',           -- путь в Storage: {project_id}/{stem}/{stage}_{N}.jpg
    cos_path      text not null default '',           -- путь в Storage: {project_id}/{stem}/{stage}_{N}.cos
    selected      boolean not null default false,
    created_at    timestamptz not null default now(),

    -- Уникальность: одно фото, один этап, один номер версии
    unique (project_id, photo_name, stage, version_num)
);

-- Индекс для быстрой выборки версий фото в проекте
create index if not exists idx_photo_versions_project
    on photo_versions (project_id, photo_name, stage);

-- 2. RLS политики
alter table photo_versions enable row level security;

-- Владелец проекта: полный доступ
create policy photo_versions_owner on photo_versions
    for all
    using (project_id in (select get_my_project_ids()));

-- Участники проекта (клиенты по share link): чтение + обновление selected
create policy photo_versions_member_select on photo_versions
    for select
    using (project_id in (
        select project_id from project_members where user_id = auth.uid()
    ));

create policy photo_versions_member_update on photo_versions
    for update
    using (project_id in (
        select project_id from project_members where user_id = auth.uid()
    ))
    with check (project_id in (
        select project_id from project_members where user_id = auth.uid()
    ));

-- Анонимный доступ по share link (для клиентов без регистрации)
-- Через RPC функцию, аналогично существующим share_links
create or replace function get_shared_project_ids()
returns setof uuid
language sql
security definer
stable
as $$
    select distinct project_id from share_links
$$;

create policy photo_versions_anon_select on photo_versions
    for select
    using (project_id in (select get_shared_project_ids()));

-- 3. Storage бакеты
-- ВАЖНО: бакеты нужно создать в Supabase Dashboard → Storage
-- или через API. SQL ниже -- для справки.
--
-- Бакет: postprod
--   Структура файлов:
--     {project_id}/{photo_stem}/color_correction_1.jpg   (превью)
--     {project_id}/{photo_stem}/color_correction_1.cos   (COS файл)
--     {project_id}/{photo_stem}/retouch_1.jpg
--     {project_id}/{photo_stem}/retouch_1.cos
--
-- Storage policies (настроить в Dashboard → Storage → Policies):
--   - Владелец проекта: upload, download, delete
--   - Анонимный доступ: download только для превью (.jpg)
--
-- insert into storage.buckets (id, name, public)
-- values ('postprod', 'postprod', false);
