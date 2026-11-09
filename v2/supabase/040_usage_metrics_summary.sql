-- Migration 040: Usage metrics summary (read-only owner analytics)
--
-- Task: audit0702-usage-metrics (backlog.html) — backend slice.
-- Provides the aggregation engine behind the weekly usage summary Masha wants:
-- DAU, active projects, top actions, activity by role, and top client errors.
--
-- Design notes:
--   * Read-only (STABLE). Touches no write paths — zero risk to client saves.
--   * SECURITY DEFINER but strictly scoped to the caller: every aggregate is
--     computed only over projects owned by auth.uid(). An anonymous caller
--     (auth.uid() IS NULL) owns nothing and therefore gets empty results, never
--     another owner's data.
--   * search_path pinned to public (consistent with 038 hardening).
--   * EXECUTE granted to authenticated only; revoked from anon/public.
--
-- Sources:
--   action_log   (migration 008) — who did what, when, in which project.
--   client_errors               — client-side JS errors shipped by error-reporter.js.

CREATE OR REPLACE FUNCTION public.usage_metrics_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  bounds AS (
    -- clamp window to a sane range (1..730 days)
    SELECT GREATEST(1, LEAST(COALESCE(p_days, 30), 730)) AS days
  ),
  owned AS (
    SELECT p.id
    FROM projects p, me
    WHERE me.uid IS NOT NULL
      AND p.owner_id = me.uid
  ),
  al AS (
    SELECT a.*,
           COALESCE(a.actor_id::text, 'link:' || a.actor_token) AS actor_key
    FROM action_log a, bounds b
    WHERE a.project_id IN (SELECT id FROM owned)
      AND a.created_at >= now() - make_interval(days => b.days)
  ),
  ce AS (
    SELECT c.*
    FROM client_errors c, bounds b, me
    WHERE c.ts >= now() - make_interval(days => b.days)
      AND (c.project_cloud_id IN (SELECT id FROM owned)
           OR (me.uid IS NOT NULL AND c.user_id = me.uid))
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'window_days', (SELECT days FROM bounds),
    'owner_id', (SELECT uid FROM me),
    'totals', jsonb_build_object(
      'actions',          (SELECT count(*) FROM al),
      'active_users',     (SELECT count(DISTINCT actor_key) FROM al),
      'active_projects',  (SELECT count(DISTINCT project_id) FROM al),
      'owned_projects',   (SELECT count(*) FROM owned),
      'active_days',      (SELECT count(DISTINCT date_trunc('day', created_at)) FROM al),
      'errors',           (SELECT count(*) FROM ce),
      'error_signatures', (SELECT count(DISTINCT COALESCE(hash, left(message, 80))) FROM ce)
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(d ORDER BY d->>'day')
      FROM (
        SELECT jsonb_build_object(
          'day',             to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
          'active_users',    count(DISTINCT actor_key),
          'active_projects', count(DISTINCT project_id),
          'actions',         count(*)
        ) AS d
        FROM al
        GROUP BY date_trunc('day', created_at)
      ) q
    ), '[]'::jsonb),
    'top_actions', COALESCE((
      SELECT jsonb_agg(a ORDER BY (a->>'count')::int DESC)
      FROM (
        SELECT jsonb_build_object('action', action, 'count', count(*)) AS a
        FROM al
        GROUP BY action
        ORDER BY count(*) DESC
        LIMIT 15
      ) q
    ), '[]'::jsonb),
    'by_role', COALESCE((
      SELECT jsonb_agg(r ORDER BY (r->>'actions')::int DESC)
      FROM (
        SELECT jsonb_build_object(
          'role',         actor_role,
          'actions',      count(*),
          'active_users', count(DISTINCT actor_key)
        ) AS r
        FROM al
        GROUP BY actor_role
      ) q
    ), '[]'::jsonb),
    'top_errors', COALESCE((
      SELECT jsonb_agg(e ORDER BY (e->>'count')::int DESC)
      FROM (
        SELECT jsonb_build_object(
          'signature',  COALESCE(hash, left(message, 80)),
          'error_type', max(error_type),
          'message',    max(left(message, 200)),
          'count',      count(*),
          'last_seen',  max(ts)
        ) AS e
        FROM ce
        GROUP BY COALESCE(hash, left(message, 80))
        ORDER BY count(*) DESC
        LIMIT 15
      ) q
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.usage_metrics_summary(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.usage_metrics_summary(integer) TO authenticated;

COMMENT ON FUNCTION public.usage_metrics_summary(integer) IS
  'Owner-scoped read-only usage summary (DAU, active projects, top actions, by-role, top errors) over the last p_days (1..730). Aggregates only over auth.uid() owned projects.';
