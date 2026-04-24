-- 029: Fix share-link RPC functions
--
-- Problems found:
--   1) get_project_by_token (overwritten by migration 026) was missing:
--      brand, shoot_date, template_id, template_config, role, previews,
--      card.name -- AND referenced non-existent column name in projects.
--      Client link showed error 42703.
--   2) get_snapshots_by_token accepted p_token uuid, but share_links.token
--      is text (hex strings, not uuid format).
--   3) Old save_cards_by_token overloads (2-5 args) did not check
--      is_active/expires_at and used physical DELETE. Dead code.
--
-- Applied: 2026-04-20

-- 1. get_project_by_token: full restore with soft-delete filter

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

  SELECT id, brand, shoot_date, template_id, template_config,
         stage, other_content, oc_containers, annotations, comments, checkpoints
    INTO proj_row
    FROM projects
   WHERE id = pid
     AND deleted_at IS NULL;

  IF proj_row.id IS NULL THEN
    RETURN NULL;
  END IF;

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
        FROM slots s
         WHERE s.card_id = c.id
           AND s.project_id = pid
           AND s.deleted_at IS NULL
      ), '[]'::jsonb)
    ) ORDER BY c.position
  ), '[]'::jsonb)
  INTO cards_arr
  FROM cards c
  WHERE c.project_id = pid
    AND c.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'file_name', p.file_name,
      'thumb_path', p.thumb_path,
      'preview_path', p.preview_path,
      'rating', p.rating,
      'orient', p.orient,
      'rotation', p.rotation,
      'position', p.position
    ) ORDER BY p.position
  ), '[]'::jsonb)
  INTO previews_arr
  FROM previews p
  WHERE p.project_id = pid;

  result := jsonb_build_object(
    'project_id', proj_row.id,
    'brand', proj_row.brand,
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

-- 2. get_snapshots_by_token: fix parameter type uuid to text

DROP FUNCTION IF EXISTS get_snapshots_by_token(uuid);

CREATE OR REPLACE FUNCTION get_snapshots_by_token(p_token text)
RETURNS SETOF snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  v_project_id := _find_project_by_share_token(p_token);

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;

  RETURN QUERY
    SELECT * FROM snapshots
    WHERE project_id = v_project_id
    ORDER BY created_at ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_snapshots_by_token(text) TO anon, authenticated;

-- 3. Drop dead save_cards_by_token overloads (2-5 args)

DROP FUNCTION IF EXISTS save_cards_by_token(text, text);
DROP FUNCTION IF EXISTS save_cards_by_token(text, jsonb, text);
DROP FUNCTION IF EXISTS save_cards_by_token(text, jsonb, text, text);
DROP FUNCTION IF EXISTS save_cards_by_token(text, jsonb, text, text, jsonb);
