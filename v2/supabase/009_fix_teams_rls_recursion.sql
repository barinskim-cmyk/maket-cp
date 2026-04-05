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
