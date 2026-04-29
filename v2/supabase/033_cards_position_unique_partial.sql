-- 033_cards_position_unique_partial.sql
-- Applied: 2026-04-29 via Supabase MCP
-- Author: Claude (PA agent)
--
-- Make cards_project_position_unique partial: ignore soft-deleted rows.
-- Soft-deleted cards (deleted_at IS NOT NULL) should NOT occupy positions
-- in the unique constraint. Otherwise re-creating or restoring a card on
-- the same position throws PostgrestError 409 duplicate key.
--
-- Bug 2026-04-29 (cards.cN23 deleted): re-upsert of cards after soft-delete
-- failed with "duplicate key value violates unique constraint
-- cards_project_position_unique" because the deleted row still had its
-- position locked.
--
-- Rollback (if ever needed):
--   DROP INDEX IF EXISTS cards_project_position_unique;
--   CREATE UNIQUE INDEX cards_project_position_unique
--     ON public.cards (project_id, "position");
--   (но это вернёт исходный баг)

DROP INDEX IF EXISTS cards_project_position_unique;
CREATE UNIQUE INDEX cards_project_position_unique
  ON public.cards (project_id, "position")
  WHERE deleted_at IS NULL;
