-- 013: Delta OC sync + save_cards_by_token
-- Prevents full-state overwrites when multiple tabs are open (photographer + client)

-- ══════════════════════════════════════════════
--  Helper: find project_id by share_links.token
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _find_project_by_share_token(p_token text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT sl.project_id
    FROM share_links sl
   WHERE sl.token = p_token
     AND sl.is_active = true
     AND (sl.expires_at IS NULL OR sl.expires_at > now())
   LIMIT 1;
$$;

-- ══════════════════════════════════════════════
--  Delta OC: atomic add/remove for other_content
-- ══════════════════════════════════════════════

-- Add single item to other_content array (idempotent)
CREATE OR REPLACE FUNCTION oc_add_item(p_project_id uuid, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_oc jsonb;
BEGIN
  SELECT COALESCE(other_content::jsonb, '[]'::jsonb)
    INTO current_oc
    FROM projects WHERE id = p_project_id;

  IF NOT current_oc @> to_jsonb(p_file_name) THEN
    current_oc := current_oc || jsonb_build_array(p_file_name);
    UPDATE projects
       SET other_content = current_oc::text,
           updated_at = now()
     WHERE id = p_project_id;
  END IF;
END;
$$;

-- Remove single item from other_content array (idempotent)
CREATE OR REPLACE FUNCTION oc_remove_item(p_project_id uuid, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_oc jsonb;
  new_oc jsonb;
BEGIN
  SELECT COALESCE(other_content::jsonb, '[]'::jsonb)
    INTO current_oc
    FROM projects WHERE id = p_project_id;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO new_oc
    FROM jsonb_array_elements(current_oc) AS elem
   WHERE elem #>> '{}' != p_file_name;

  UPDATE projects
     SET other_content = new_oc::text,
         updated_at = now()
   WHERE id = p_project_id;
END;
$$;

-- Client versions using share_links.token
CREATE OR REPLACE FUNCTION oc_add_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  pid := _find_project_by_share_token(p_share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;
  PERFORM oc_add_item(pid, p_file_name);
END;
$$;

CREATE OR REPLACE FUNCTION oc_remove_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  pid := _find_project_by_share_token(p_share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;
  PERFORM oc_remove_item(pid, p_file_name);
END;
$$;

-- ══════════════════════════════════════════════
--  save_cards_by_token: full push for anonymous clients
--  Replaces cards + slots, updates OC + containers
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_cards_by_token(
  share_token text,
  cards_data jsonb,
  oc_data text DEFAULT '[]',
  oc_containers_data text DEFAULT '[]'
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

  -- Update project metadata (OC + containers)
  UPDATE projects SET
    other_content = oc_data,
    oc_containers = oc_containers_data,
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
