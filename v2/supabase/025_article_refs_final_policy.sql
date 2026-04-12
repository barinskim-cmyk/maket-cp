-- ════════════════════════════════════════════════════════════
-- Миграция 025: Финальные RLS-политики для article-refs
--               и ai-pdf-pages (owner + project_members)
-- ════════════════════════════════════════════════════════════
--
-- Что выяснилось из 023/024:
--   • 023 (диагностика) — функция debug_capture_and_pass бросала
--     исключение в контексте storage, из-за чего транзакция
--     откатывалась и debug_log оставался пустым.
--   • 024 (trivial) — политика `bucket_id = 'article-refs'`
--     для `TO authenticated` РАБОТАЕТ. Значит:
--     – auth.role() в storage-контексте = 'authenticated' ✅
--     – проблема 022 была в `current_uid()` / чтении JWT
--       внутри SECURITY DEFINER функции, а НЕ в auth-контексте
--       как таковом.
--
-- Стратегия:
--   1. auth.uid() вызываем ПРЯМО в политике — не в функции.
--      В storage-контексте `TO authenticated` роль присутствует,
--      значит и uid должен подниматься стандартным путём.
--   2. SECURITY DEFINER функция is_project_accessible(p, u)
--      получает uid ПАРАМЕТРОМ и делает только одно:
--      проверяет владение, обходя RLS на projects/project_members.
--      Никаких current_setting, никаких auth.uid() внутри.
--   3. Это минимизирует поверхность, где что-то может сломаться:
--      если auth.uid() в политике = NULL, политика честно вернёт
--      false (не throw), и мы это увидим.
--
-- Идемпотентна. Применяется после 024.
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Чистая функция: проверка доступа по переданному uid ──
-- Берёт project_id и user_id как параметры. Никакого JWT-чтения.
-- SECURITY DEFINER нужен ТОЛЬКО чтобы обойти RLS на projects и
-- project_members (иначе EXISTS вернёт false из-за их собственных
-- RLS-политик).
CREATE OR REPLACE FUNCTION public.is_project_accessible(p uuid, u uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    CASE
      WHEN p IS NULL OR u IS NULL THEN FALSE
      ELSE EXISTS (
        SELECT 1 FROM public.projects
        WHERE id = p AND owner_id = u
      ) OR EXISTS (
        SELECT 1 FROM public.project_members
        WHERE project_id = p AND user_id = u
      )
    END;
$$;

GRANT EXECUTE ON FUNCTION public.is_project_accessible(uuid, uuid)
  TO anon, authenticated;


-- ── 2. Снимаем тривиальные политики из 024 ─────────────────
DROP POLICY IF EXISTS "article_refs_insert_trivial" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_select_trivial" ON storage.objects;

-- ── 3. Снимаем старые member-политики из 022 ───────────────
-- (они тоже ссылаются на can_access_project из 022, который сломан)
DROP POLICY IF EXISTS "article_refs_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_update_member" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_delete_member" ON storage.objects;

-- ── 4. Финальные политики article-refs ─────────────────────
-- Формат пути: article-refs/<project_id>/ar_<ts>_<artid>.jpg
-- foldername(name)[1] = <project_id>

CREATE POLICY "article_refs_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'article-refs'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

CREATE POLICY "article_refs_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'article-refs'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'article-refs'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

CREATE POLICY "article_refs_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'article-refs'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

-- SELECT: бакет публичный (public=true), но для upsert и для
-- логина через supabase-js всё равно нужна политика на SELECT.
-- Делаем доступной для всех participants этого проекта +
-- оставляем публичный доступ через bucket public flag.
CREATE POLICY "article_refs_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'article-refs'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );


-- ── 5. То же самое для ai-pdf-pages ────────────────────────
DROP POLICY IF EXISTS "ai_pdf_pages_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_member" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_member" ON storage.objects;

CREATE POLICY "ai_pdf_pages_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

CREATE POLICY "ai_pdf_pages_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ai-pdf-pages'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

CREATE POLICY "ai_pdf_pages_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ai-pdf-pages'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

CREATE POLICY "ai_pdf_pages_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ai-pdf-pages'
    AND public.is_project_accessible(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

COMMIT;

-- ════════════════════════════════════════════════════════════
-- Как проверить после применения:
--
--   1. В DevTools консоли запустить:
--        arUploadRefImagesToCloud(getActiveProject())
--      Ожидаем: "загружено 35 из 35" — как и с тривиальной
--      политикой, потому что ты owner этого проекта.
--
--   2. Зайти под вторым аккаунтом, добавить этого юзера в
--      project_members текущего проекта (через отдельный UI
--      или напрямую: INSERT INTO project_members(project_id,
--      user_id, role) VALUES (...)). Потом повторить аплоад
--      от имени второго юзера — тоже должно работать.
--
--   3. Третий аккаунт БЕЗ membership не должен смочь
--      загрузить: 400 RLS violation (это уже желаемое
--      поведение).
--
-- Если шаг 1 внезапно падает — значит auth.uid() в storage-
-- контексте возвращает NULL, и is_project_accessible(uuid, NULL)
-- корректно возвращает FALSE. Тогда пишем отдельную диагностику.
-- ════════════════════════════════════════════════════════════
