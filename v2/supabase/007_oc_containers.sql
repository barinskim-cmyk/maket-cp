-- Migration 007: Add oc_containers column to projects
-- Stores OC container structure: [{id, name, items: [photoName, ...]}]
-- Allows grouping Other Content photos into named containers (SMM, PR, banners, etc.)

-- Add column (idempotent: skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'oc_containers'
  ) THEN
    ALTER TABLE public.projects
      ADD COLUMN oc_containers jsonb DEFAULT '[]'::jsonb;
  END IF;
END$$;

-- Also ensure other_content column exists (may have been added manually)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'other_content'
  ) THEN
    ALTER TABLE public.projects
      ADD COLUMN other_content jsonb DEFAULT '[]'::jsonb;
  END IF;
END$$;
