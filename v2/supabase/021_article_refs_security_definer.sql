-- ════════════════════════════════════════════════════════════
-- Миграция 021: RLS для article-refs/ai-pdf-pages через
--               SECURITY DEFINER helper-функцию
-- ════════════════════════════════════════════════════════════
--
-- Проблема, с которой мы столкнулись:
--   Миграция 020 использовала внутри WITH CHECK подзапрос
--     (storage.foldername(name))[1]::uuid
--     IN (SELECT id FROM projects WHERE owner_id = auth.uid())
--   Политики и bucket-ы были настроены верно: bucket публичный,
--   политики есть, проект принадлежит вызывающему пользователю,
--   auth.uid() в браузере матчит owner_id. Но INSERT всё равно
--   падал с "new row violates row-level security policy".
--
-- Причина (почти наверняка):
--   Storage service в Supabase использует свою сессию и JWT
--   прокидывается через неё, но SELECT на projects внутри
--   storage-policy неочевидно взаимодействует с RLS на
--   projects (projects_owner_all + projects_member_or_team_select).
--   В каких-то версиях Supabase Storage subquery просто
--   возвращает пусто — даже для владельца.
--
-- Решение — SECURITY DEFINER:
--   Вынесем проверку "проект принадлежит текущему пользователю"
--   в отдельную функцию с SECURITY DEFINER. Такая функция
--   выполняется от лица её владельца (postgres), поэтому
--   RLS на projects её не трогает, и select всегда честно
--   находит запись. Авторизация при этом не ослабляется:
--   мы по-прежнему сверяем auth.uid() с owner_id.
--
-- Параллельно чистим старые политики и пересоздаём их через
-- новую функцию.
-- ════════════════════════════════════════════════════════════


-- ── 1. SECURITY DEFINER helper: is_my_project ───────────────
-- Возвращает TRUE, если проект p принадлежит текущему
-- аутентифицированному пользователю (auth.uid() = owner_id).
-- SECURITY DEFINER => обходит RLS на projects при SELECT.
CREATE OR REPLACE FUNCTION public.is_my_project(p uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p AND owner_id = auth.uid()
  );
$$;

-- Дать выполнять всем аутентифицированным (и анону тоже —
-- он всё равно вернёт FALSE, т.к. auth.uid() = null).
GRANT EXECUTE ON FUNCTION public.is_my_project(uuid) TO anon, authenticated;


-- ── 2. Пересоздаём policies на article-refs ─────────────────
DROP POLICY IF EXISTS "article_refs_insert_owner" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_delete_owner" ON storage.objects;

CREATE POLICY "article_refs_insert_owner"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "article_refs_update_owner"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "article_refs_delete_owner"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );


-- ── 3. Пересоздаём policies на ai-pdf-pages ─────────────────
DROP POLICY IF EXISTS "ai_pdf_pages_insert_owner" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_owner" ON storage.objects;

CREATE POLICY "ai_pdf_pages_insert_owner"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "ai_pdf_pages_update_owner"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "ai_pdf_pages_delete_owner"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.is_my_project(
      ((storage.foldername(name))[1])::uuid
    )
  );
