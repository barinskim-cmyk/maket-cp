-- Migration 031: Allow share-link guests to UPDATE photo_versions.selected
-- Date: 2026-04-24
-- Bug: clients via share-link couldn't save photo selection, getting "ошибка сохранения"
-- Root cause: migration 030 added UPDATE policy only for members/owners; share-link
--             guest context (via get_shared_project_ids()) had no UPDATE permission.
-- Fix: add UPDATE policy on photo_versions for the share-link context.
-- Scope: photo_versions only; does not touch SELECT/INSERT/DELETE policies.

-- Drop existing policy if rerun (idempotent)
DROP POLICY IF EXISTS "photo_versions_update_by_share_link" ON public.photo_versions;

-- Create new policy: guests can UPDATE on projects they have share-link access to
CREATE POLICY "photo_versions_update_by_share_link" ON public.photo_versions
  FOR UPDATE
  TO public
  USING (project_id IN (SELECT get_shared_project_ids()))
  WITH CHECK (project_id IN (SELECT get_shared_project_ids()));

COMMENT ON POLICY "photo_versions_update_by_share_link" ON public.photo_versions IS
  'Allows share-link guests to update photo_versions.selected in projects accessible via share-link. Added 2026-04-24 to fix share-link save bug.';
