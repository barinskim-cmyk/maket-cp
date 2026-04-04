-- Migration 003: Add name column to cards
-- Позволяет пользователю давать имена карточкам.
-- Запустить в Supabase Dashboard → SQL Editor.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS name text DEFAULT NULL;

COMMENT ON COLUMN cards.name IS 'Optional user-defined card name. NULL = use default "Карточка N".';
