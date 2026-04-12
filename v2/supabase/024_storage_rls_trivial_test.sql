-- Migration 024: Trivial RLS policy for article-refs bucket (diagnostic)
--
-- Purpose: Isolate whether the SECURITY DEFINER diagnostic function from 023
-- was throwing an exception (causing transaction rollback and empty debug_log).
--
-- Strategy: Replace the diagnostic policy with the simplest possible check —
-- just `bucket_id = 'article-refs'` for authenticated role. No function calls,
-- no SECURITY DEFINER, no current_setting.
--
-- Expected outcomes:
--   A) Upload succeeds → the previous SECURITY DEFINER function was throwing.
--      Next step: migration 025 with proper owner + project_members check.
--   B) Upload still fails with RLS violation → problem is deeper (grants,
--      bucket ACLs, role resolution). Pivot investigation.
--
-- Also adds a trivial SELECT policy, which was missing for article-refs bucket
-- (confirmed via previous diagnostic CSV 14). SELECT is required for upsert()
-- and for clients reading back their own uploads.

BEGIN;

-- Remove the diagnostic policy from 023 (it used the throwing function)
DROP POLICY IF EXISTS "article_refs_insert_diag" ON storage.objects;

-- Also clean up any prior trivial attempts if re-running
DROP POLICY IF EXISTS "article_refs_insert_trivial" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_select_trivial" ON storage.objects;

-- Trivial INSERT policy: any authenticated user can upload to article-refs
CREATE POLICY "article_refs_insert_trivial"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'article-refs');

-- Trivial SELECT policy: any authenticated user can read article-refs
-- (bucket is public=true anyway, but explicit policy needed for RLS)
CREATE POLICY "article_refs_select_trivial"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'article-refs');

COMMIT;

-- After applying this migration:
-- 1. In browser DevTools console run:
--      arUploadRefImagesToCloud(getActiveProject())
-- 2. Watch the Network tab for POST .../storage/v1/object/article-refs/...
-- 3. Expected: 200 OK (trivial check should always pass for logged-in user)
-- 4. If still 400 RLS violation → the issue is NOT in our policy logic but
--    in auth context / grants / bucket-level permissions.
