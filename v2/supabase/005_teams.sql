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
