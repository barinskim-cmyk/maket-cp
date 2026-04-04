-- Migration 002: Soft delete for projects
-- Добавляет поле deleted_at для soft delete проектов.
-- Запустить в Supabase Dashboard → SQL Editor.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Индекс для быстрой фильтрации активных проектов
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects (deleted_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN projects.deleted_at IS 'Soft delete timestamp. NULL = active, set = hidden/deleted.';
