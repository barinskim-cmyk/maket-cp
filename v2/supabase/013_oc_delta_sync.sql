-- 013: Delta OC sync — atomic add/remove for other_content
-- Prevents full-state overwrites when multiple tabs are open (photographer + client)

-- ══════════════════════════════════════════════
--  Owner path (authenticated, RLS by user_id)
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

  -- Only add if not already present
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

-- ══════════════════════════════════════════════
--  Client path (anonymous, by share_token)
-- ══════════════════════════════════════════════

-- Add single item via share token
CREATE OR REPLACE FUNCTION oc_add_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM projects WHERE share_token = p_share_token;
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid share token';
  END IF;
  PERFORM oc_add_item(pid, p_file_name);
END;
$$;

-- Remove single item via share token
CREATE OR REPLACE FUNCTION oc_remove_item_by_token(p_share_token text, p_file_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM projects WHERE share_token = p_share_token;
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid share token';
  END IF;
  PERFORM oc_remove_item(pid, p_file_name);
END;
$$;
