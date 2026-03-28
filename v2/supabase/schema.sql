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
