-- ════════════════════════════════════════════════════════════
-- Миграция 022: RLS для article-refs/ai-pdf-pages с поддержкой
--               owner + project_members и надёжным чтением JWT
-- ════════════════════════════════════════════════════════════
--
-- Предыстория:
--   Миграция 020 использовала subquery на projects в storage-
--   политике — Supabase Storage возвращал "row violates RLS".
--   Миграция 021 ввела SECURITY DEFINER helper is_my_project(),
--   который читал auth.uid(). В RPC-контексте helper работает
--   корректно (SELECT public.is_my_project(...) = true), но
--   внутри политики на storage.objects возвращает false.
--
-- Причина:
--   Supabase storage-api в некоторых версиях не прокидывает в
--   GUC полный набор JWT claims так, как их ожидает auth.uid().
--   auth.role() при этом остаётся доступен (политика до нашего
--   helper-а доходит — иначе мы бы не видели "violates RLS",
--   а видели бы "permission denied").
--
-- Решение:
--   1. Новая helper-функция public.current_uid() читает JWT
--      через current_setting() напрямую — с двойным fallback
--      на 'request.jwt.claim.sub' и 'request.jwt.claims'->>sub.
--      Это надёжнее, чем полагаться на auth.uid().
--   2. Новая helper-функция public.can_access_project(p) —
--      та же SECURITY DEFINER-проверка, но через current_uid()
--      и с включённой поддержкой project_members. Возвращает
--      true если текущий юзер — owner ИЛИ входит в members
--      этого проекта (любая роль).
--   3. Политики на article-refs и ai-pdf-pages пересоздаются
--      через can_access_project. Имена переименованы на _member
--      чтобы старые owner-only политики 021 были явно снесены.
--
-- Применяется после миграции 021. Идемпотентна.
-- ════════════════════════════════════════════════════════════


-- ── 1. current_uid(): прямое чтение JWT без auth.uid() ──────
-- auth.uid() в Supabase Storage может возвращать NULL даже при
-- валидной сессии. Читаем claim напрямую из GUC и как fallback
-- из request.jwt.claims (жёсткий legacy-формат).
CREATE OR REPLACE FUNCTION public.current_uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid_text text;
BEGIN
  -- Основной путь: отдельный claim 'request.jwt.claim.sub'
  uid_text := nullif(current_setting('request.jwt.claim.sub', true), '');

  -- Fallback: JSON 'request.jwt.claims'->>'sub'
  IF uid_text IS NULL THEN
    BEGIN
      uid_text := (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub';
    EXCEPTION WHEN others THEN
      uid_text := NULL;
    END;
  END IF;

  IF uid_text IS NULL OR uid_text = '' THEN
    RETURN NULL;
  END IF;

  RETURN uid_text::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_uid() TO anon, authenticated;


-- ── 2. can_access_project(): owner OR project_members ──────
-- SECURITY DEFINER обходит RLS на projects/project_members,
-- что позволяет помощнику честно выполнить SELECT. Авторизация
-- не ослабляется: сравниваем с current_uid() из JWT.
CREATE OR REPLACE FUNCTION public.can_access_project(p uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.current_uid();
  IF uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Owner
  IF EXISTS (
    SELECT 1 FROM projects pr
    WHERE pr.id = p AND pr.owner_id = uid
  ) THEN
    RETURN TRUE;
  END IF;

  -- Member (любая роль: client, editor, retoucher, ...)
  IF EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p AND pm.user_id = uid
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO anon, authenticated;


-- ── 3. Пересоздаём политики на article-refs ────────────────
-- Снимаем owner-only политики из 021 (и 020 заодно, на всякий).
DROP POLICY IF EXISTS "article_refs_insert_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_update_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_delete_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_update_member" ON storage.objects;
DROP POLICY IF EXISTS "article_refs_delete_member" ON storage.objects;

CREATE POLICY "article_refs_insert_member"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "article_refs_update_member"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "article_refs_delete_member"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );


-- ── 4. Пересоздаём политики на ai-pdf-pages ────────────────
DROP POLICY IF EXISTS "ai_pdf_pages_insert_owner"  ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_owner"  ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_owner"  ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_member" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_member" ON storage.objects;

CREATE POLICY "ai_pdf_pages_insert_member"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "ai_pdf_pages_update_member"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "ai_pdf_pages_delete_member"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND public.can_access_project(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- SELECT не ограничиваем — bucket-ы публичные, и это нужно,
-- чтобы OpenAI Vision мог скачивать ref-картинки по URL.
