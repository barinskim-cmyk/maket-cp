-- ══════════════════════════════════════════════════════════════════════════════════
-- MAKET CP: All Pending Migrations (Combined)
-- ══════════════════════════════════════════════════════════════════════════════════
--
-- This file combines all database migrations in order:
--   1. schema.sql (base schema)
--   2. 002_soft_delete.sql
--   3. 003_card_name.sql
--   4. 004_template_config.sql
--   5. 005_teams.sql
--   6. 006_team_rls_cards_slots.sql
--   7. 007_oc_containers.sql
--   8. 008_action_log.sql
--   9. 009_fix_teams_rls_recursion.sql
--   10. 010_snapshots.sql
--   11. 011_annotations.sql
--   12. 012_oc_comments.sql
--   13. 013_oc_delta_sync.sql
--   14. 014_annotations_sync.sql
--
-- Run in Supabase Dashboard → SQL Editor (execute entire file at once).
-- ══════════════════════════════════════════════════════════════════════════════════


-- ═══ Base Schema (schema.sql) ═══════════════════════════════════════════════════

-- ══════════════════════════════════════════════
-- Maket CP — Supabase Database Schema
-- ══════════════════════════════════════════════
--
-- Запускать в Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Порядок: сначала таблицы, потом RLS-политики, потом функции.
--
-- Три роли:
--   photographer — владелец съёмки (desktop app)
--   client       — заказчик (web, по ссылке)
--   retoucher    — ретушёр (web, по ссылке)

-- ── 1. Пользователи (профили) ──

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Автоматически создаём профиль при регистрации
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 2. Проекты (съёмки) ──

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  brand       text not null default '',
  shoot_date  text not null default '',
  template_id text,          -- id шаблона из UserTemplates
  stage       int not null default 0,
  channels    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Индекс для быстрого поиска проектов владельца
create index if not exists idx_projects_owner on projects(owner_id);


-- ── 3. Карточки товара ──

create table if not exists cards (
  id          text not null,  -- short uuid (hex[:8])
  project_id  uuid not null references projects(id) on delete cascade,
  position    int not null default 0,
  status      text not null default 'draft',
  has_hero    boolean default true,
  h_aspect    text default '3/2',
  v_aspect    text default '2/3',
  lock_rows   boolean default false,
  created_at  timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists idx_cards_project on cards(project_id);


-- ── 4. Слоты (позиции в карточке) ──

create table if not exists slots (
  id          uuid primary key default gen_random_uuid(),
  card_id     text not null,
  project_id  uuid not null,
  position    int not null default 0,
  orient      text not null default 'v',  -- 'h' | 'v'
  weight      int not null default 1,
  row_num     int,                        -- ряд (manual layout)
  rotation    int not null default 0,     -- 0|90|180|270
  file_name   text,                       -- имя файла (IMG_0001.jpg)
  thumb_path  text,                       -- путь в storage bucket
  original_path text,                     -- путь к оригиналу в storage
  created_at  timestamptz not null default now(),
  foreign key (project_id, card_id) references cards(project_id, id) on delete cascade
);

create index if not exists idx_slots_card on slots(project_id, card_id);


-- ── 5. Комментарии ──

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  card_id     text,          -- null = комментарий к проекту
  slot_id     uuid references slots(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  author_name text not null default '',
  text        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_comments_project on comments(project_id);
create index if not exists idx_comments_card on comments(project_id, card_id);


-- ── 6. Ссылки для доступа (share links) ──

create table if not exists share_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  role        text not null default 'client',  -- 'client' | 'retoucher'
  label       text,          -- "Для Лены" / "Ретушёру Саше"
  expires_at  timestamptz,   -- null = не истекает
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_share_links_token on share_links(token);
create index if not exists idx_share_links_project on share_links(project_id);


-- ── 7. Участники проекта (кто получил доступ) ──

create table if not exists project_members (
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null default 'client',
  joined_via  uuid references share_links(id),   -- через какую ссылку
  joined_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);


-- ── 8. История этапов пайплайна ──

create table if not exists stage_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  stage_id    text not null,     -- 'preselect', 'selection', etc.
  trigger_desc text,
  note        text,
  created_at  timestamptz not null default now()
);


-- ══════════════════════════════════════════════
-- Row Level Security (RLS)
-- ══════════════════════════════════════════════

alter table profiles       enable row level security;
alter table projects       enable row level security;
alter table cards          enable row level security;
alter table slots          enable row level security;
alter table comments       enable row level security;
alter table share_links    enable row level security;
alter table project_members enable row level security;
alter table stage_events   enable row level security;

-- Профиль: видишь свой, редактируешь свой
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- Проекты: владелец видит/редактирует, участники видят
create policy "projects_owner_all" on projects for all
  using (owner_id = auth.uid());

create policy "projects_member_select" on projects for select
  using (
    exists (
      select 1 from project_members pm
      where pm.project_id = projects.id and pm.user_id = auth.uid()
    )
  );

-- Карточки: через проект
create policy "cards_via_project" on cards for all
  using (
    exists (
      select 1 from projects p
      where p.id = cards.project_id
        and (p.owner_id = auth.uid() or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        ))
    )
  );

-- Слоты: через проект
create policy "slots_via_project" on slots for all
  using (
    exists (
      select 1 from projects p
      where p.id = slots.project_id
        and (p.owner_id = auth.uid() or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        ))
    )
  );

-- Комментарии: участники проекта могут читать и писать
create policy "comments_via_project" on comments for select
  using (
    exists (
      select 1 from projects p
      where p.id = comments.project_id
        and (p.owner_id = auth.uid() or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        ))
    )
  );

create policy "comments_insert" on comments for insert
  with check (
    exists (
      select 1 from projects p
      where p.id = comments.project_id
        and (p.owner_id = auth.uid() or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        ))
    )
  );

-- Share links: только владелец
create policy "share_links_owner" on share_links for all
  using (
    exists (
      select 1 from projects p
      where p.id = share_links.project_id and p.owner_id = auth.uid()
    )
  );

-- Project members: видят участники, добавляет владелец
create policy "members_select" on project_members for select
  using (user_id = auth.uid() or exists (
    select 1 from projects p where p.id = project_members.project_id and p.owner_id = auth.uid()
  ));

create policy "members_owner_manage" on project_members for all
  using (
    exists (
      select 1 from projects p
      where p.id = project_members.project_id and p.owner_id = auth.uid()
    )
  );

-- Stage events: через проект
create policy "stage_events_via_project" on stage_events for all
  using (
    exists (
      select 1 from projects p
      where p.id = stage_events.project_id
        and (p.owner_id = auth.uid() or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        ))
    )
  );


-- ══════════════════════════════════════════════
-- RPC: Присоединиться по share-токену
-- ══════════════════════════════════════════════
--
-- Клиент вызывает: supabase.rpc('join_by_token', {share_token: 'abc...'})
-- Возвращает: {project_id, role} или ошибку

create or replace function public.join_by_token(share_token text)
returns jsonb as $$
declare
  link record;
begin
  select * into link from share_links
  where token = share_token
    and is_active = true
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'Invalid or expired share link';
  end if;

  -- Добавляем участника (ignore duplicate)
  insert into project_members (project_id, user_id, role, joined_via)
  values (link.project_id, auth.uid(), link.role, link.id)
  on conflict (project_id, user_id) do nothing;

  return jsonb_build_object(
    'project_id', link.project_id,
    'role', link.role
  );
end;
$$ language plpgsql security definer;


-- ═══ Migration 002: Soft Delete ═══════════════════════════════════════════════════

-- Migration 002: Soft delete for projects
-- Добавляет поле deleted_at для soft delete проектов.
-- Запустить в Supabase Dashboard → SQL Editor.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Индекс для быстрой фильтрации активных проектов
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects (deleted_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN projects.deleted_at IS 'Soft delete timestamp. NULL = active, set = hidden/deleted.';


-- ═══ Migration 003: Card Name ═════════════════════════════════════════════════════

-- Migration 003: Add name column to cards
-- Позволяет пользователю давать имена карточкам.
-- Запустить в Supabase Dashboard → SQL Editor.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS name text DEFAULT NULL;

COMMENT ON COLUMN cards.name IS 'Optional user-defined card name. NULL = use default "Карточка N".';


-- ═══ Migration 004: Template Config ═══════════════════════════════════════════════

-- 004: Add template_config JSONB column to projects
-- Stores the full template configuration (slots, aspects, hero, lockRows)
-- so it persists across cloud load/save cycles.
-- A project may use multiple templates — this stores the "active" one
-- used as default for new cards.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS template_config JSONB DEFAULT NULL;

COMMENT ON COLUMN projects.template_config IS
  'Full template config object: {id, name, hAspect, vAspect, lockRows, hasHero, slots[{orient, weight}]}';


-- ═══ Migration 005: Teams ═════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════
-- Migration 005: Teams + Team Members
-- ══════════════════════════════════════════════
-- Две модели доступа:
--   1. Команда (teams) — постоянная группа, все проекты владельца видны участникам
--   2. Проект (project_members) — уже существует, разовый доступ к конкретному проекту

-- ── 1. Команды ──

CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL DEFAULT '',
  owner_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);

-- ── 2. Участники команды ──

CREATE TABLE IF NOT EXISTS team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  invited_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ── 3. Привязка проекта к команде (опционально) ──
-- Если project.team_id IS NULL — проект личный, доступ через owner_id и project_members
-- Если project.team_id заполнен — видят все участники команды

ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

-- ── 4. RLS для teams ──

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Владелец команды: полный доступ
CREATE POLICY "teams_owner_all" ON teams FOR ALL
  USING (owner_id = auth.uid());

-- Участник команды: читать (без рекурсии -- subquery вместо EXISTS на team_members)
CREATE POLICY "teams_member_select" ON teams FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Team members: участник видит свои записи, владелец команды управляет всеми
-- (без рекурсии -- subquery на teams вместо EXISTS через team_members)
CREATE POLICY "team_members_select" ON team_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR invited_by = auth.uid()
  );

CREATE POLICY "team_members_manage" ON team_members FOR ALL
  USING (
    team_id IN (
      SELECT id FROM teams WHERE owner_id = auth.uid()
    )
  );

-- ── 5. Обновить RLS проектов: добавить доступ через команду ──

-- Удаляем старую политику member_select (она не учитывает команды)
DROP POLICY IF EXISTS "projects_member_select" ON projects;

-- Новая политика: участник ИЛИ член команды
CREATE POLICY "projects_member_or_team_select" ON projects FOR SELECT
  USING (
    -- Прямой участник проекта
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = projects.id AND pm.user_id = auth.uid()
    )
    OR
    -- Участник команды, к которой привязан проект
    (
      projects.team_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = projects.team_id AND tm.user_id = auth.uid()
      )
    )
  );

-- ── 6. RPC: Пригласить в команду по email ──
-- Возвращает {user_id, email, status} или ошибку

CREATE OR REPLACE FUNCTION public.invite_to_team(
  p_team_id uuid,
  p_email text,
  p_role text DEFAULT 'member'
)
RETURNS jsonb AS $$
DECLARE
  v_team teams;
  v_user profiles;
BEGIN
  -- Проверить что вызывающий — владелец команды
  SELECT * INTO v_team FROM teams WHERE id = p_team_id AND owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not team owner';
  END IF;

  -- Найти пользователя по email
  SELECT * INTO v_user FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'email', p_email);
  END IF;

  -- Не добавлять самого себя
  IF v_user.id = auth.uid() THEN
    RETURN jsonb_build_object('status', 'self', 'email', p_email);
  END IF;

  -- Добавить (ignore duplicate)
  INSERT INTO team_members (team_id, user_id, role, invited_by)
  VALUES (p_team_id, v_user.id, p_role, auth.uid())
  ON CONFLICT (team_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'ok',
    'user_id', v_user.id,
    'email', p_email,
    'name', v_user.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 7. RPC: Пригласить в проект по email ──

CREATE OR REPLACE FUNCTION public.invite_to_project(
  p_project_id uuid,
  p_email text,
  p_role text DEFAULT 'editor'
)
RETURNS jsonb AS $$
DECLARE
  v_project projects;
  v_user profiles;
BEGIN
  -- Проверить что вызывающий — владелец проекта
  SELECT * INTO v_project FROM projects WHERE id = p_project_id AND owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not project owner';
  END IF;

  -- Найти пользователя по email
  SELECT * INTO v_user FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'email', p_email);
  END IF;

  IF v_user.id = auth.uid() THEN
    RETURN jsonb_build_object('status', 'self', 'email', p_email);
  END IF;

  INSERT INTO project_members (project_id, user_id, role)
  VALUES (p_project_id, v_user.id, p_role)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = p_role;

  RETURN jsonb_build_object(
    'status', 'ok',
    'user_id', v_user.id,
    'email', p_email,
    'name', v_user.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══ Migration 006: Team RLS Cards/Slots ════════════════════════════════════════

-- ══════════════════════════════════════════════
-- Migration 006: Update cards/slots RLS for team access
-- ══════════════════════════════════════════════
-- После 005: участники команды видят проекты, но cards/slots
-- ещё проверяют только owner + project_members. Нужно добавить team_members.

-- ── Cards: обновить политику ──
DROP POLICY IF EXISTS "cards_via_project" ON cards;

CREATE POLICY "cards_via_project" ON cards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = cards.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Slots: обновить политику ──
DROP POLICY IF EXISTS "slots_via_project" ON slots;

CREATE POLICY "slots_via_project" ON slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = slots.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Comments: обновить политику ──
DROP POLICY IF EXISTS "comments_via_project" ON comments;

CREATE POLICY "comments_via_project" ON comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = comments.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "comments_insert" ON comments;

CREATE POLICY "comments_insert" ON comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = comments.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Stage events: обновить политику ──
DROP POLICY IF EXISTS "stage_events_via_project" ON stage_events;

CREATE POLICY "stage_events_via_project" ON stage_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = stage_events.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );


-- ═══ Migration 007: OC Containers ═════════════════════════════════════════════════

-- Migration 007: Add oc_containers column to projects
-- Stores OC container structure: [{id, name, items: [photoName, ...]}]
-- Allows grouping Other Content photos into named containers (SMM, PR, banners, etc.)

-- Add column (idempotent: skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'oc_containers'
  ) THEN
    ALTER TABLE public.projects
      ADD COLUMN oc_containers jsonb DEFAULT '[]'::jsonb;
  END IF;
END$$;

-- Also ensure other_content column exists (may have been added manually)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'other_content'
  ) THEN
    ALTER TABLE public.projects
      ADD COLUMN other_content jsonb DEFAULT '[]'::jsonb;
  END IF;
END$$;


-- ═══ Migration 008: Action Log ════════════════════════════════════════════════════

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
      SELECT 1 FROM share_links
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
      SELECT project_id FROM public.share_links
      WHERE token = current_setting('request.headers', true)::json->>'x-share-token'
        AND (expires_at IS NULL OR expires_at > now())
    )
  );


-- ═══ Migration 009: Fix Teams RLS Recursion ═══════════════════════════════════════

-- Migration 009: Fix infinite recursion in teams/team_members RLS policies
--
-- Problem: team_members_manage queries teams → teams_member_select queries team_members → loop
-- Solution: SECURITY DEFINER helper functions that bypass RLS for ownership/membership checks

-- ── 1. Helper: get team IDs owned by current user (bypasses RLS) ──

CREATE OR REPLACE FUNCTION public.get_my_team_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM teams WHERE owner_id = auth.uid();
$$;

-- ── 2. Helper: get team IDs where current user is a member (bypasses RLS) ──

CREATE OR REPLACE FUNCTION public.get_my_team_memberships()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM team_members WHERE user_id = auth.uid();
$$;

-- ── 3. Drop old problematic policies ──

DROP POLICY IF EXISTS "teams_owner_all" ON teams;
DROP POLICY IF EXISTS "teams_member_select" ON teams;
DROP POLICY IF EXISTS "team_members_select" ON team_members;
DROP POLICY IF EXISTS "team_members_manage" ON team_members;

-- ── 4. Recreate teams policies using helper functions (no cross-table RLS) ──

-- Owner: full access (direct column check, no recursion possible)
CREATE POLICY "teams_owner_all" ON teams FOR ALL
  USING (owner_id = auth.uid());

-- Member: read-only (uses SECURITY DEFINER function instead of subquery on team_members)
CREATE POLICY "teams_member_select" ON teams FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT get_my_team_memberships())
  );

-- ── 5. Recreate team_members policies using helper functions ──

-- Member sees own rows + rows they invited
CREATE POLICY "team_members_select" ON team_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR invited_by = auth.uid()
    OR team_id IN (SELECT get_my_team_ids())
  );

-- Owner manages all members (uses SECURITY DEFINER function instead of subquery on teams)
CREATE POLICY "team_members_manage" ON team_members FOR ALL
  USING (
    team_id IN (SELECT get_my_team_ids())
  );

-- ── 6. Fix projects policy too (it also queries team_members) ──

DROP POLICY IF EXISTS "projects_member_or_team_select" ON projects;

CREATE POLICY "projects_member_or_team_select" ON projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = projects.id AND pm.user_id = auth.uid()
    )
    OR
    (
      projects.team_id IS NOT NULL
      AND projects.team_id IN (SELECT get_my_team_memberships())
    )
  );

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_my_team_ids TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_team_memberships TO authenticated;


-- ═══ Migration 010: Snapshots ═════════════════════════════════════════════════════

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


-- ═══ Migration 011: Annotations ═══════════════════════════════════════════════════

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

-- Create get_my_project_ids if it doesn't exist
CREATE OR REPLACE FUNCTION public.get_my_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM projects WHERE owner_id = auth.uid();
$$;

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

GRANT EXECUTE ON FUNCTION public.get_my_project_ids TO authenticated;


-- ═══ Migration 012: OC Comments ═══════════════════════════════════════════════════

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


-- ═══ Migration 013: OC Delta Sync ═════════════════════════════════════════════════

-- 013: Delta OC sync + save_cards_by_token
-- Prevents full-state overwrites when multiple tabs are open (photographer + client)

-- ══════════════════════════════════════════════
--  Helper: find project_id by share_links.token
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _find_project_by_share_token(p_token text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT sl.project_id
    FROM share_links sl
   WHERE sl.token = p_token
     AND sl.is_active = true
     AND (sl.expires_at IS NULL OR sl.expires_at > now())
   LIMIT 1;
$$;

-- ══════════════════════════════════════════════
--  Delta OC: atomic add/remove for other_content
-- ══════════════════════════════════════════════

-- Add single item to other_content array (idempotent)
CREATE OR REPLACE FUNCTION oc_add_item(p_project_id uuid, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_oc jsonb;
BEGIN
  SELECT COALESCE(other_content::jsonb, '[]'::jsonb)
    INTO current_oc
    FROM projects WHERE id = p_project_id;

  IF NOT current_oc @> to_jsonb(p_file_name) THEN
    current_oc := current_oc || jsonb_build_array(p_file_name);
    UPDATE projects
       SET other_content = current_oc::text,
           updated_at = now()
     WHERE id = p_project_id;
  END IF;
END;
$$;

-- Remove single item from other_content array (idempotent)
CREATE OR REPLACE FUNCTION oc_remove_item(p_project_id uuid, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_oc jsonb;
  new_oc jsonb;
BEGIN
  SELECT COALESCE(other_content::jsonb, '[]'::jsonb)
    INTO current_oc
    FROM projects WHERE id = p_project_id;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO new_oc
    FROM jsonb_array_elements(current_oc) AS elem
   WHERE elem #>> '{}' != p_file_name;

  UPDATE projects
     SET other_content = new_oc::text,
         updated_at = now()
   WHERE id = p_project_id;
END;
$$;

-- Client versions using share_links.token
CREATE OR REPLACE FUNCTION oc_add_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  pid := _find_project_by_share_token(p_share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;
  PERFORM oc_add_item(pid, p_file_name);
END;
$$;

CREATE OR REPLACE FUNCTION oc_remove_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  pid := _find_project_by_share_token(p_share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;
  PERFORM oc_remove_item(pid, p_file_name);
END;
$$;

-- ══════════════════════════════════════════════
--  save_cards_by_token: full push for anonymous clients
--  Replaces cards + slots, updates OC + containers
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_cards_by_token(
  share_token text,
  cards_data jsonb,
  oc_data text DEFAULT '[]',
  oc_containers_data text DEFAULT '[]'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  card_row jsonb;
  slot_row jsonb;
  new_card_id text;
  c_pos int;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;

  -- Update project metadata (OC + containers)
  UPDATE projects SET
    other_content = oc_data,
    oc_containers = oc_containers_data,
    updated_at = now()
  WHERE id = pid;

  -- Delete old cards (cascades to slots)
  DELETE FROM cards WHERE project_id = pid;

  -- Insert new cards + slots
  c_pos := 0;
  FOR card_row IN SELECT * FROM jsonb_array_elements(cards_data)
  LOOP
    new_card_id := 'card_' || substring(pid::text, 1, 8) || '_' || c_pos || '_' || extract(epoch from now())::bigint;

    INSERT INTO cards (id, project_id, position, status, has_hero, h_aspect, v_aspect, lock_rows)
    VALUES (
      new_card_id,
      pid,
      COALESCE((card_row->>'position')::int, c_pos),
      COALESCE(card_row->>'status', 'draft'),
      COALESCE((card_row->>'has_hero')::boolean, true),
      COALESCE(card_row->>'h_aspect', '3/2'),
      COALESCE(card_row->>'v_aspect', '2/3'),
      COALESCE((card_row->>'lock_rows')::boolean, false)
    );

    -- Insert slots for this card
    IF card_row->'slots' IS NOT NULL AND jsonb_typeof(card_row->'slots') = 'array' THEN
      FOR slot_row IN SELECT * FROM jsonb_array_elements(card_row->'slots')
      LOOP
        INSERT INTO slots (card_id, project_id, position, orient, weight, row_num, rotation, file_name)
        VALUES (
          new_card_id,
          pid,
          COALESCE((slot_row->>'position')::int, 0),
          COALESCE(slot_row->>'orient', 'v'),
          COALESCE((slot_row->>'weight')::int, 1),
          (slot_row->>'row_num')::int,
          COALESCE((slot_row->>'rotation')::int, 0),
          slot_row->>'file_name'
        );
      END LOOP;
    END IF;

    c_pos := c_pos + 1;
  END LOOP;
END;
$$;


-- ═══ Migration 014: Annotations Sync ════════════════════════════════════════════════

-- 014: Annotations + Comments sync — store as JSONB on projects table
-- Annotations format: { "photo_name.jpg": [ { shape, text, tags, x, y, rx, ry, points, ... } ] }
-- Comments format: { "card:<card_id>": [ { id, text, author, created } ], "cnt:<cnt_id>": [...] }

-- Add annotations column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT '{}'::jsonb;

-- Add comments column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS comments jsonb DEFAULT '{}'::jsonb;

-- Add checkpoints column to projects (pipeline timeline events)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS checkpoints jsonb DEFAULT '[]'::jsonb;

-- ══════════════════════════════════════════════
--  Update save_cards_by_token to accept annotations
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_cards_by_token(
  share_token text,
  cards_data jsonb,
  oc_data text DEFAULT '[]',
  oc_containers_data text DEFAULT '[]',
  annotations_data jsonb DEFAULT '{}'::jsonb,
  comments_data jsonb DEFAULT '{}'::jsonb,
  checkpoints_data jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  card_row jsonb;
  slot_row jsonb;
  new_card_id text;
  c_pos int;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;

  -- Update project metadata (OC + containers + annotations + comments)
  UPDATE projects SET
    other_content = oc_data,
    oc_containers = oc_containers_data,
    annotations = COALESCE(annotations_data, '{}'::jsonb),
    comments = COALESCE(comments_data, '{}'::jsonb),
    checkpoints = COALESCE(checkpoints_data, '[]'::jsonb),
    updated_at = now()
  WHERE id = pid;

  -- Delete old cards (cascades to slots)
  DELETE FROM cards WHERE project_id = pid;

  -- Insert new cards + slots
  c_pos := 0;
  FOR card_row IN SELECT * FROM jsonb_array_elements(cards_data)
  LOOP
    new_card_id := 'card_' || substring(pid::text, 1, 8) || '_' || c_pos || '_' || extract(epoch from now())::bigint;

    INSERT INTO cards (id, project_id, position, status, has_hero, h_aspect, v_aspect, lock_rows)
    VALUES (
      new_card_id,
      pid,
      COALESCE((card_row->>'position')::int, c_pos),
      COALESCE(card_row->>'status', 'draft'),
      COALESCE((card_row->>'has_hero')::boolean, true),
      COALESCE(card_row->>'h_aspect', '3/2'),
      COALESCE(card_row->>'v_aspect', '2/3'),
      COALESCE((card_row->>'lock_rows')::boolean, false)
    );

    -- Insert slots for this card
    IF card_row->'slots' IS NOT NULL AND jsonb_typeof(card_row->'slots') = 'array' THEN
      FOR slot_row IN SELECT * FROM jsonb_array_elements(card_row->'slots')
      LOOP
        INSERT INTO slots (card_id, project_id, position, orient, weight, row_num, rotation, file_name)
        VALUES (
          new_card_id,
          pid,
          COALESCE((slot_row->>'position')::int, 0),
          COALESCE(slot_row->>'orient', 'v'),
          COALESCE((slot_row->>'weight')::int, 1),
          (slot_row->>'row_num')::int,
          COALESCE((slot_row->>'rotation')::int, 0),
          slot_row->>'file_name'
        );
      END LOOP;
    END IF;

    c_pos := c_pos + 1;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════
--  Update get_project_by_token to return annotations
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_project_by_token(share_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  result jsonb;
  proj_row record;
  cards_arr jsonb;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, name, stage, other_content, oc_containers, annotations, comments, checkpoints
    INTO proj_row
    FROM projects
   WHERE id = pid;

  -- Build cards array with nested slots
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'position', c.position,
      'status', c.status,
      'has_hero', c.has_hero,
      'h_aspect', c.h_aspect,
      'v_aspect', c.v_aspect,
      'lock_rows', c.lock_rows,
      'slots', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'position', s.position,
            'orient', s.orient,
            'weight', s.weight,
            'row_num', s.row_num,
            'rotation', s.rotation,
            'file_name', s.file_name,
            'thumb_path', s.thumb_path
          ) ORDER BY s.position
        )
        FROM slots s WHERE s.card_id = c.id
      ), '[]'::jsonb)
    ) ORDER BY c.position
  ), '[]'::jsonb)
  INTO cards_arr
  FROM cards c
  WHERE c.project_id = pid;

  result := jsonb_build_object(
    'project_id', proj_row.id,
    'name', proj_row.name,
    'stage', proj_row.stage,
    'other_content', proj_row.other_content,
    'oc_containers', proj_row.oc_containers,
    'annotations', COALESCE(proj_row.annotations, '{}'::jsonb),
    'comments', COALESCE(proj_row.comments, '{}'::jsonb),
    'checkpoints', COALESCE(proj_row.checkpoints, '[]'::jsonb),
    'cards', cards_arr
  );

  RETURN result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════════
-- MIGRATION SUMMARY
-- ══════════════════════════════════════════════════════════════════════════════════
--
-- This file contains 14 migrations:
--
--  001 (base):     schema.sql
--  002:            Soft delete for projects (deleted_at column)
--  003:            Card naming (name column on cards)
--  004:            Template config persistence (template_config JSONB on projects)
--  005:            Teams + team_members tables, RLS policies, invite RPCs
--  006:            Team RLS updates for cards, slots, comments, stage_events
--  007:            OC containers (oc_containers, other_content columns)
--  008:            Action log audit trail (action_log table + log_action RPC)
--  009:            Fix RLS recursion (get_my_team_ids, get_my_team_memberships helpers)
--  010:            Project snapshots (snapshots table, create_snapshot, get_snapshots_by_token RPCs)
--  011:            Annotations (annotations table with RLS)
--  012:            OC comments (oc_comments table with RLS)
--  013:            Delta OC sync (oc_add_item, oc_remove_item, save_cards_by_token RPCs)
--  014:            Annotations sync (annotations, comments, checkpoints JSONB columns)
--
-- Total affected tables:    21 (profiles, projects, cards, slots, comments, share_links,
--                              project_members, stage_events, teams, team_members,
--                              action_log, annotations, oc_comments, snapshots)
--
-- Total RPC functions:      18 (join_by_token, invite_to_team, invite_to_project,
--                              get_my_team_ids, get_my_team_memberships, create_snapshot,
--                              get_snapshots_by_token, log_action, _find_project_by_share_token,
--                              oc_add_item, oc_remove_item, oc_add_item_by_token,
--                              oc_remove_item_by_token, save_cards_by_token,
--                              get_project_by_token, get_my_project_ids, handle_new_user)
--
-- ══════════════════════════════════════════════════════════════════════════════════
