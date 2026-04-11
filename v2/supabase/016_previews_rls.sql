-- ══════════════════════════════════════════════
-- 016: Fix previews table RLS — allow owners to read their previews
-- ══════════════════════════════════════════════
--
-- Problem: previews table has RLS enabled but no policy for authenticated owners,
-- so direct queries from sbDownloadPreviews() return 0 rows for logged-in users.
-- This causes empty card slots in the web/mobile version.
--
-- Migration 015 fixed share links (anonymous) via RPC.
-- This migration fixes authenticated user access via direct table query.
-- ══════════════════════════════════════════════

-- Убедимся что RLS включён (на случай если он был выключен)
ALTER TABLE previews ENABLE ROW LEVEL SECURITY;

-- Удаляем старые политики если есть (идемпотентность)
DROP POLICY IF EXISTS "previews_owner_all" ON previews;
DROP POLICY IF EXISTS "previews_via_project" ON previews;
DROP POLICY IF EXISTS "previews_member_select" ON previews;

-- Владелец проекта видит и изменяет свои превью
CREATE POLICY "previews_owner_all" ON previews
  FOR ALL
  USING (project_id IN (SELECT get_my_project_ids()));

-- Участники проекта (клиенты, ретушёры) — только чтение
CREATE POLICY "previews_member_select" ON previews
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
