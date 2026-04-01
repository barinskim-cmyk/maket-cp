-- Fix: populate slots.thumb_path from previews table
-- Slots were inserted via SQL without thumb_path, but previews have them
-- This UPDATE matches slots to previews by file_name within the same project

UPDATE public.slots s
SET thumb_path = p.thumb_path
FROM public.previews p
WHERE s.project_id = 'a8af4256-e2c6-40ec-8549-10179d80286b'
  AND s.project_id = p.project_id
  AND s.file_name = p.file_name
  AND s.thumb_path IS NULL
  AND p.thumb_path IS NOT NULL;
