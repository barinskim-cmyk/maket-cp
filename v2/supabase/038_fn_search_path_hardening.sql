-- ============================================================
-- Migration 038: Pin search_path on all public app functions.
-- Date: 2026-10-10 (autonomous session)
-- Task: audit0702-share-role-db (security slice) + Supabase
--       security advisor lint 0011 (function_search_path_mutable).
--
-- Why: 27 functions in schema public had a role-mutable search_path.
-- For SECURITY DEFINER functions this is a privilege-escalation vector:
-- the function runs with the definer's (owner's) rights but resolves
-- unqualified object names via the CALLER's search_path, so a caller
-- who creates a shadowing object in a schema earlier on their path can
-- make the elevated function call their object instead. The anon-callable
-- share-token RPCs (save_cards_by_token, get_project_by_token,
-- _find_project_by_share_token, oc_*_by_token, join_by_token) are the
-- highest-risk surface — all SECURITY DEFINER, reachable without login.
--
-- Fix: pin search_path on every flagged function. Logic is unchanged;
-- only name resolution is fixed. `public, extensions, pg_catalog`
-- preserves current behavior: all app tables live in public, the `http`
-- extension is installed in public, any other extension lives in
-- extensions, and builtins in pg_catalog. Nonexistent schemas in a
-- search_path are ignored at resolution time, so this is safe.
--
-- Idempotent: ALTER FUNCTION ... SET is a no-op to re-run.
-- Extension-owned functions (http_*, urlencode, bytea_to_text,
-- text_to_bytea) are intentionally NOT touched — they belong to the
-- `http` extension, not the app.
--
-- Verification: Supabase advisor (security) lint
-- function_search_path_mutable drops from 27 to 0; share RPC
-- get_project_by_token still resolves a valid token.
--
-- NOT addressed here (flagged for Masha — need her decision):
--   * github_push* / _stage_* are SECURITY DEFINER AND executable by
--     anon/authenticated (advisor lint 0028/0029). Combined with the
--     public._secrets table this may let an unauthenticated caller
--     trigger a GitHub push. Revoking EXECUTE is behavior-changing and
--     may touch secrets — left for review.
--   * public._secrets / public._push_temp have RLS enabled but no
--     policy (deny-all by default; confirm intended).
--   * share-link view-vs-edit ROLE MODEL (who may write cards vs read
--     only) is a product decision — the frontend currently routes both
--     client and retoucher links through save_cards_by_token.
-- ============================================================

ALTER FUNCTION public._find_project_by_share_token(p_token text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public._maketcp_soft_delete_cards() SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public._maketcp_soft_delete_slots() SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public._photo_originals_touch_updated_at() SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public._stage_from_github(p_owner text, p_repo text, p_branch text, p_path text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public._stage_patched(p_path text, p_old text, p_new text, p_owner text, p_repo text, p_branch text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.add_ai_match_decision(p_project_id uuid, p_article_id text, p_sku text, p_card_idx integer, p_decision text, p_ai_confidence text, p_ai_reason text, p_ref_image_path text, p_card_image_path text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.get_active_rejections(p_project_id uuid) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.get_project_by_token(share_token text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.github_patch_push(p_message text, p_patches jsonb, p_owner text, p_repo text, p_branch text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.github_push(p_owner text, p_repo text, p_branch text, p_message text, p_files jsonb) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.github_push_mixed(p_owner text, p_repo text, p_branch text, p_message text, p_files jsonb) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.github_push_staged(p_message text, p_owner text, p_repo text, p_branch text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.handle_new_user() SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.invite_to_project(p_project_id uuid, p_email text, p_role text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.invite_to_team(p_team_id uuid, p_email text, p_role text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.join_by_token(share_token text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.natural_key(s text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.oc_add_item(p_project_id uuid, p_file_name text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.oc_add_item_by_token(p_share_token text, p_file_name text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.oc_remove_item(p_project_id uuid, p_file_name text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.oc_remove_item_by_token(p_share_token text, p_file_name text) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.restore_deleted_cards(p_project_id uuid, p_since timestamp with time zone) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.save_articles_batch(p_project_id uuid, p_articles jsonb) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.save_cards_by_token(share_token text, cards_data jsonb, oc_data text, oc_containers_data text, annotations_data jsonb, comments_data jsonb, checkpoints_data jsonb) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.save_rename_log_batch(p_project_id uuid, p_entries jsonb) SET search_path = public, extensions, pg_catalog;
ALTER FUNCTION public.shoot_sessions_touch_updated_at() SET search_path = public, extensions, pg_catalog;

-- END of 038_fn_search_path_hardening.sql
