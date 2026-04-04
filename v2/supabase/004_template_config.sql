-- 004: Add template_config JSONB column to projects
-- Stores the full template configuration (slots, aspects, hero, lockRows)
-- so it persists across cloud load/save cycles.
-- A project may use multiple templates — this stores the "active" one
-- used as default for new cards.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS template_config JSONB DEFAULT NULL;

COMMENT ON COLUMN projects.template_config IS
  'Full template config object: {id, name, hAspect, vAspect, lockRows, hasHero, slots[{orient, weight}]}';
