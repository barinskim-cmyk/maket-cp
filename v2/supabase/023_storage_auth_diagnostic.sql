-- ════════════════════════════════════════════════════════════
-- Миграция 023: ДИАГНОСТИЧЕСКАЯ — захват JWT-контекста при
--               storage INSERT, чтобы понять почему 021/022
--               не пропускают загрузку ref-картинок
-- ════════════════════════════════════════════════════════════
--
-- ВНИМАНИЕ: эта миграция временно делает bucket article-refs
-- открытым для любой загрузки (через debug-функцию, которая
-- всегда возвращает true). После диагностики её отменяет
-- миграция 024 или ручной откат в SQL Editor.
--
-- Что она делает:
--   1. Создаёт таблицу public.debug_log для захвата контекста
--   2. Создаёт функцию debug_capture_and_pass(p uuid), которая
--      при каждом вызове пишет в debug_log всё что знает об
--      auth-контексте и возвращает TRUE (пропускает INSERT)
--   3. Временно заменяет политику article_refs_insert_member
--      на article_refs_insert_diag, использующую эту функцию
--
-- Как пользоваться:
--   1. Применить в SQL Editor
--   2. Попробовать загрузить через браузер пробный png
--   3. Выполнить:
--        SELECT * FROM public.debug_log ORDER BY id DESC LIMIT 5;
--      и прислать вывод
-- ════════════════════════════════════════════════════════════


-- ── 1. Таблица лога ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.debug_log (
  id         bigserial PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  context    text,
  data       jsonb
);

ALTER TABLE public.debug_log ENABLE ROW LEVEL SECURITY;

-- Открытая политика: любой читает/пишет debug_log
DROP POLICY IF EXISTS "debug_log_all" ON public.debug_log;
CREATE POLICY "debug_log_all"
  ON public.debug_log FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.debug_log TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.debug_log_id_seq TO anon, authenticated;


-- ── 2. Debug-функция: логирует контекст, возвращает TRUE ───
CREATE OR REPLACE FUNCTION public.debug_capture_and_pass(p uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  info jsonb;
  owner_match boolean;
  member_match boolean;
BEGIN
  -- Сверка в обход RLS (SECURITY DEFINER)
  owner_match := EXISTS (
    SELECT 1 FROM projects
    WHERE id = p
    AND owner_id = (nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid
  );
  member_match := EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p
    AND user_id = (nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid
  );

  info := jsonb_build_object(
    'project_id', p,
    'auth_uid', auth.uid(),
    'auth_role', auth.role(),
    'claim_sub', current_setting('request.jwt.claim.sub', true),
    'claim_role', current_setting('request.jwt.claim.role', true),
    'claims_raw', current_setting('request.jwt.claims', true),
    'current_user', current_user::text,
    'session_user', session_user::text,
    'owner_match', owner_match,
    'member_match', member_match,
    'project_exists', EXISTS (SELECT 1 FROM projects WHERE id = p)
  );

  INSERT INTO public.debug_log (context, data) VALUES ('storage_insert', info);

  RETURN TRUE;  -- ДИАГНОСТИКА: пропускаем INSERT всегда
END;
$$;

GRANT EXECUTE ON FUNCTION public.debug_capture_and_pass(uuid) TO anon, authenticated;


-- ── 3. Временная политика на article-refs INSERT ───────────
DROP POLICY IF EXISTS "article_refs_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_insert_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_insert_diag"   ON storage.objects;

CREATE POLICY "article_refs_insert_diag"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'article-refs'
    AND public.debug_capture_and_pass(
      ((storage.foldername(name))[1])::uuid
    )
  );
