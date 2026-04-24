---
id: BUG-2026-001
date: 2026-04-24
reporter: Маша
severity: high
area: share-link
status: fixed
source: client-reported
---

## Summary
Share-link guest can't save photo selection in slots. UI shows "ошибка сохранения"
when a client opens a share-link and taps a photo to mark it as selected in a slot.
Owner (Masha, authenticated) works correctly; the failure is scoped to guest sessions.

## Root cause
Migration 030 created RLS policies for `photo_versions` that allowed only
authenticated members/owners to UPDATE:

- `photo_versions_member_update` — UPDATE, checks `project_members` for `auth.uid()`
- `photo_versions_owner` — ALL, checks `get_my_project_ids()`

Share-link guest context (resolved via `get_shared_project_ids()` / `share_links`)
had a SELECT policy (`photo_versions_anon_select`) but no UPDATE policy, so all
writes from guest sessions were blocked by RLS.

## Fix
Migration `031_share_link_photo_versions_write`: add an UPDATE policy on
`public.photo_versions` for the share-link context:

```sql
CREATE POLICY "photo_versions_update_by_share_link" ON public.photo_versions
  FOR UPDATE
  TO public
  USING (project_id IN (SELECT get_shared_project_ids()))
  WITH CHECK (project_id IN (SELECT get_shared_project_ids()));
```

File: `v2/supabase/031_share_link_photo_versions_write.sql`.

## Verification
DB query:

```sql
SELECT policyname FROM pg_policies
WHERE tablename = 'photo_versions'
  AND policyname = 'photo_versions_update_by_share_link';
```

Returns 1 row — confirmed applied in prod on 2026-04-24.

## User-side verification pending
Masha tests:
1. Open share-link of an existing project in Incognito (no auth).
2. Tap a photo in a slot to mark it as selected.
3. Expected: saves without error; the selection persists on reload.

## Timeline
- 2026-04-24 15:XX: reported by Masha (demo prep for Эконика, 7 May).
- 2026-04-24 15:XX: diagnosed (RLS hypothesis — UPDATE policy missing for guest).
- 2026-04-24 15:XX: fixed via migration 031 applied to prod DB.
- Pending: Masha's Incognito verification.

## Scope / risk
- Migration touches only `photo_versions` policies.
- Existing SELECT/INSERT/DELETE policies not modified.
- Risk: allows any share-link holder to flip `selected` on any photo in the project.
  Matches the product intent — clients are explicitly given the right to pick photos.
