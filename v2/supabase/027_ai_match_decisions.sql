-- ============================================================
-- Migration 027: AI Match Decisions
--
-- Immutable log of user decisions on (card x article) pairs.
-- Two purposes:
--   1) AI behavior: re-running matching excludes pairs the
--      user previously rejected.
--   2) ML training data: snapshots and AI context form the
--      labeled dataset for future matching model.
--
-- Records are immutable. Undoing a verification adds a new
-- 'unverified' record (history is not overwritten).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_match_decisions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id      text        NOT NULL,
  sku             text,
  card_idx        int         NOT NULL,
  decision        text        NOT NULL,
  ai_confidence   text,
  ai_reason       text,
  ref_image_path  text,
  card_image_path text,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid        DEFAULT auth.uid(),
  CONSTRAINT ai_match_decisions_decision_chk
    CHECK (decision IN ('rejected', 'verified', 'manual_link', 'unverified'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS ai_match_decisions_project_idx
  ON ai_match_decisions(project_id);
CREATE INDEX IF NOT EXISTS ai_match_decisions_project_decision_idx
  ON ai_match_decisions(project_id, decision);
CREATE INDEX IF NOT EXISTS ai_match_decisions_pair_idx
  ON ai_match_decisions(project_id, card_idx, article_id);

-- RLS
ALTER TABLE ai_match_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_match_decisions_owner_all" ON ai_match_decisions
  FOR ALL
  USING (project_id IN (SELECT get_my_project_ids()))
  WITH CHECK (project_id IN (SELECT get_my_project_ids()));

CREATE POLICY "ai_match_decisions_member_select" ON ai_match_decisions
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- RPC: add a decision
CREATE OR REPLACE FUNCTION add_ai_match_decision(
  p_project_id      uuid,
  p_article_id      text,
  p_sku             text,
  p_card_idx        int,
  p_decision        text,
  p_ai_confidence   text DEFAULT NULL,
  p_ai_reason       text DEFAULT NULL,
  p_ref_image_path  text DEFAULT NULL,
  p_card_image_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM project_members WHERE project_id = p_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_decision NOT IN ('rejected', 'verified', 'manual_link', 'unverified') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  INSERT INTO ai_match_decisions (
    project_id, article_id, sku, card_idx,
    decision, ai_confidence, ai_reason,
    ref_image_path, card_image_path
  ) VALUES (
    p_project_id, p_article_id, p_sku, p_card_idx,
    p_decision, p_ai_confidence, p_ai_reason,
    p_ref_image_path, p_card_image_path
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- RPC: get active rejections for a project
-- Returns pairs whose latest decision is 'rejected'
CREATE OR REPLACE FUNCTION get_active_rejections(p_project_id uuid)
RETURNS TABLE (
  card_idx     int,
  article_id   text,
  rejected_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (card_idx, article_id)
      card_idx, article_id, decision, decided_at
    FROM ai_match_decisions
    WHERE project_id = p_project_id
    ORDER BY card_idx, article_id, decided_at DESC
  )
  SELECT card_idx, article_id, decided_at AS rejected_at
  FROM latest
  WHERE decision = 'rejected'
    AND (
      EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p_project_id AND pm.user_id = auth.uid())
    );
$$;
