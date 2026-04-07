-- ══════════════════════════════════════════════
-- 015: Fix share link loading — include previews in get_project_by_token
--
-- Problem: sbDownloadPreviews() does a direct query on `previews` table,
-- but anonymous users (share link) are blocked by RLS.
-- Solution: Add previews directly to get_project_by_token RPC result.
-- ══════════════════════════════════════════════

-- Also add `role` from share_links to the result (was missing).

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

  SELECT id, name, brand, shoot_date, template_id, template_config,
         stage, other_content, oc_containers, annotations, comments, checkpoints
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
      'width', p.width,
      'height', p.height,
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
    'brand', proj_row.brand,
    'name', proj_row.name,
    'shoot_date', proj_row.shoot_date,
    'template_id', proj_row.template_id,
    'template_config', proj_row.template_config,
    'stage', proj_row.stage,
    'role', link_role,
    'other_content', proj_row.other_content,
    'oc_containers', proj_row.oc_containers,
    'annotations', COALESCE(proj_row.annotations, '{}'::jsonb),
    'comments', COALESCE(proj_row.comments, '{}'::jsonb),
    'checkpoints', COALESCE(proj_row.checkpoints, '[]'::jsonb),
    'cards', cards_arr,
    'previews', previews_arr
  );

  RETURN result;
END;
$$;

-- ══════════════════════════════════════════════
-- GRANTs для анонимных пользователей (клиенты по share-ссылке)
-- Без этих GRANT клиент по ссылке получит ошибку "permission denied"
-- ══════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.get_project_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._find_project_by_share_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_cards_by_token(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_add_item_by_token(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_remove_item_by_token(text, text) TO anon, authenticated;
