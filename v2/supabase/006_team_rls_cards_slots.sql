-- ══════════════════════════════════════════════
-- Migration 006: Update cards/slots RLS for team access
-- ══════════════════════════════════════════════
-- После 005: участники команды видят проекты, но cards/slots
-- ещё проверяют только owner + project_members. Нужно добавить team_members.

-- ── Cards: обновить политику ──
DROP POLICY IF EXISTS "cards_via_project" ON cards;

CREATE POLICY "cards_via_project" ON cards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = cards.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Slots: обновить политику ──
DROP POLICY IF EXISTS "slots_via_project" ON slots;

CREATE POLICY "slots_via_project" ON slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = slots.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Comments: обновить политику ──
DROP POLICY IF EXISTS "comments_via_project" ON comments;

CREATE POLICY "comments_via_project" ON comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = comments.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "comments_insert" ON comments;

CREATE POLICY "comments_insert" ON comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = comments.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- ── Stage events: обновить политику ──
DROP POLICY IF EXISTS "stage_events_via_project" ON stage_events;

CREATE POLICY "stage_events_via_project" ON stage_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = stage_events.project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
          OR (
            p.team_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = p.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );
