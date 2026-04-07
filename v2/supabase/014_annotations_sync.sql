-- 014: Annotations + Comments sync — store as JSONB on projects table
-- Annotations format: { "photo_name.jpg": [ { shape, text, tags, x, y, rx, ry, points, ... } ] }
-- Comments format: { "card:<card_id>": [ { id, text, author, created } ], "cnt:<cnt_id>": [...] }

-- Add annotations column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT '{}'::jsonb;

-- Add comments column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS comments jsonb DEFAULT '{}'::jsonb;

-- Add checkpoints column to projects (pipeline timeline events)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS checkpoints jsonb DEFAULT '[]'::jsonb;

-- ══════════════════════════════════════════════
--  Update save_cards_by_token to accept annotations
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_cards_by_token(
  share_token text,
  cards_data jsonb,
  oc_data text DEFAULT '[]',
  oc_containers_data text DEFAULT '[]',
  annotations_data jsonb DEFAULT '{}'::jsonb,
  comments_data jsonb DEFAULT '{}'::jsonb,
  checkpoints_data jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  card_row jsonb;
  slot_row jsonb;
  new_card_id text;
  c_pos int;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;

  -- Update project metadata (OC + containers + annotations + comments)
  UPDATE projects SET
    other_content = oc_data,
    oc_containers = oc_containers_data,
    annotations = COALESCE(annotations_data, '{}'::jsonb),
    comments = COALESCE(comments_data, '{}'::jsonb),
    checkpoints = COALESCE(checkpoints_data, '[]'::jsonb),
    updated_at = now()
  WHERE id = pid;

  -- Delete old cards (cascades to slots)
  DELETE FROM cards WHERE project_id = pid;

  -- Insert new cards + slots
  c_pos := 0;
  FOR card_row IN SELECT * FROM jsonb_array_elements(cards_data)
  LOOP
    new_card_id := 'card_' || substring(pid::text, 1, 8) || '_' || c_pos || '_' || extract(epoch from now())::bigint;

    INSERT INTO cards (id, project_id, position, status, has_hero, h_aspect, v_aspect, lock_rows)
    VALUES (
      new_card_id,
      pid,
      COALESCE((card_row->>'position')::int, c_pos),
      COALESCE(card_row->>'status', 'draft'),
      COALESCE((card_row->>'has_hero')::boolean, true),
      COALESCE(card_row->>'h_aspect', '3/2'),
      COALESCE(card_row->>'v_aspect', '2/3'),
      COALESCE((card_row->>'lock_rows')::boolean, false)
    );

    -- Insert slots for this card
    IF card_row->'slots' IS NOT NULL AND jsonb_typeof(card_row->'slots') = 'array' THEN
      FOR slot_row IN SELECT * FROM jsonb_array_elements(card_row->'slots')
      LOOP
        INSERT INTO slots (card_id, project_id, position, orient, weight, row_num, rotation, file_name)
        VALUES (
          new_card_id,
          pid,
          COALESCE((slot_row->>'position')::int, 0),
          COALESCE(slot_row->>'orient', 'v'),
          COALESCE((slot_row->>'weight')::int, 1),
          (slot_row->>'row_num')::int,
          COALESCE((slot_row->>'rotation')::int, 0),
          slot_row->>'file_name'
        );
      END LOOP;
    END IF;

    c_pos := c_pos + 1;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════
--  Update get_project_by_token to return annotations
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_project_by_token(share_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  result jsonb;
  proj_row record;
  cards_arr jsonb;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, name, stage, other_content, oc_containers, annotations, comments, checkpoints
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
        FROM slots s WHERE s.card_id = c.id
      ), '[]'::jsonb)
    ) ORDER BY c.position
  ), '[]'::jsonb)
  INTO cards_arr
  FROM cards c
  WHERE c.project_id = pid;

  result := jsonb_build_object(
    'project_id', proj_row.id,
    'name', proj_row.name,
    'stage', proj_row.stage,
    'other_content', proj_row.other_content,
    'oc_containers', proj_row.oc_containers,
    'annotations', COALESCE(proj_row.annotations, '{}'::jsonb),
    'comments', COALESCE(proj_row.comments, '{}'::jsonb),
    'checkpoints', COALESCE(proj_row.checkpoints, '[]'::jsonb),
    'cards', cards_arr
  );

  RETURN result;
END;
$$;
