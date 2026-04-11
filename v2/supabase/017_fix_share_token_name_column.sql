-- ══════════════════════════════════════════════
-- 017: Fix get_project_by_token — remove non-existent "name" column
--
-- Problem: Migration 015 added `name` to the SELECT from projects,
-- but projects table has no `name` column (it uses `brand`).
-- This breaks ALL share links with "column name does not exist" error.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_project_by_token(share_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  link_role text;
  result jsonb;
  proj_row record;
  cards_arr jsonb;
  previews_arr jsonb;
BEGIN
  -- Find project and role from share link
  SELECT sl.project_id, sl.role
    INTO pid, link_role
    FROM share_links sl
   WHERE sl.token = share_token
     AND sl.is_active = true
     AND (sl.expires_at IS NULL OR sl.expires_at > now())
   LIMIT 1;

  IF pid IS NULL THEN
    RETURN NULL;
  END IF;

  -- NOTE: projects table has no "name" column — removed from SELECT
  SELECT id, brand, shoot_date, template_id, template_config,
         stage, other_content, oc_containers,
         COALESCE(annotations, '{}'::jsonb)  AS annotations,
         COALESCE(comments,    '{}'::jsonb)  AS comments,
         COALESCE(checkpoints, '[]'::jsonb)  AS checkpoints
    INTO proj_row
    FROM projects
   WHERE id = pid;

  -- Build cards array with nested slots
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'position', c.position,
      'status', c.status,
      'has_hero', c.has_hero,
      'h_aspect', c.h_aspect,
      'v_aspect', c.v_aspect,
      'lock_rows', c.lock_rows,
      'name', c.name,
      'slots', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'position', s.position,
            'orient', s.orient,
            'weight', s.weight,
            'row_num', s.row_num,
            'rotation', s.rotation,
            'file_name', s.file_name,
            'thumb_path', s.thumb_path
          ) ORDER BY s.position
        )
        FROM slots s WHERE s.card_id = c.id AND s.project_id = pid
      ), '[]'::jsonb)
    ) ORDER BY c.position
  ), '[]'::jsonb)
  INTO cards_arr
  FROM cards c
  WHERE c.project_id = pid;

  -- Build previews array
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'file_name', p.file_name,
      'thumb_path', p.thumb_path,
      'preview_path', p.preview_path,
      'rating', p.rating,
      'orient', p.orient,
      'position', p.position
    ) ORDER BY p.position
  ), '[]'::jsonb)
  INTO previews_arr
  FROM previews p
  WHERE p.project_id = pid;

  result := jsonb_build_object(
    'project_id', proj_row.id,
    'brand',       proj_row.brand,
    'shoot_date',  proj_row.shoot_date,
    'template_id', proj_row.template_id,
    'template_config', proj_row.template_config,
    'stage',       proj_row.stage,
    'role',        link_role,
    'other_content',  proj_row.other_content,
    'oc_containers',  proj_row.oc_containers,
    'annotations',    proj_row.annotations,
    'comments',       proj_row.comments,
    'checkpoints',    proj_row.checkpoints,
    'cards',       cards_arr,
    'previews',    previews_arr
  );

  RETURN result;
END;
$$;

-- Сохраняем GRANTs (на случай если они слетели)
GRANT EXECUTE ON FUNCTION public.get_project_by_token(text) TO anon, authenticated;
