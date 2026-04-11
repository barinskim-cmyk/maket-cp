-- ════════════════════════════════════════════════════════════
-- Миграция 020: чиним bucket article-refs + создаём ai-pdf-pages
-- ════════════════════════════════════════════════════════════
--
-- Что было не так с article-refs:
--   В миграции 018 подсказка по storage policies предлагала
--   сверять auth.uid() с первым сегментом пути. Но фактически
--   во фронте путь формируется как {projectId}/{artId}.jpg, а
--   не {uid}/{artId}.jpg. Из-за этого INSERT блокировался
--   с "new row violates row-level security policy".
--
-- Решение:
--   1. Делаем bucket публичным (чтобы OpenAI Vision мог качать
--      картинки по getPublicUrl — это ключевое для URL-first).
--   2. Policies INSERT/UPDATE/DELETE разрешают только владельцу
--      проекта — проверяем, что первый сегмент пути — это
--      project_id, принадлежащий вызывающему пользователю.
--   3. SELECT не ограничиваем (bucket публичный).
--
-- Параллельно создаём bucket ai-pdf-pages с аналогичными
-- политиками — для кэша отрендеренных страниц PDF чек-листа.
-- ════════════════════════════════════════════════════════════


-- ── 1. Bucket article-refs: сделать публичным ───────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('article-refs', 'article-refs', true)
ON CONFLICT (id) DO UPDATE SET public = true;


-- ── 2. Чистим старые policies на article-refs ───────────────
DROP POLICY IF EXISTS "article_refs_insert_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_update_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_delete_owner"  ON storage.objects;
DROP POLICY IF EXISTS "article_refs_select_public" ON storage.objects;

-- Также снимаем любые устаревшие policies с совпадающим префиксом,
-- которые могли быть созданы вручную через Dashboard раньше.
DROP POLICY IF EXISTS "article-refs upload"   ON storage.objects;
DROP POLICY IF EXISTS "article-refs read"     ON storage.objects;
DROP POLICY IF EXISTS "Owner upload ref"      ON storage.objects;
DROP POLICY IF EXISTS "Owner read ref"        ON storage.objects;


-- ── 3. Новые policies для article-refs ─────────────────────
-- INSERT: пользователь может писать только в свою "папку"
--         (первый сегмент пути = project_id, которым он владеет)
CREATE POLICY "article_refs_insert_owner"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

-- UPDATE: те же правила (upsert использует UPDATE при conflict)
CREATE POLICY "article_refs_update_owner"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

-- DELETE: то же самое
CREATE POLICY "article_refs_delete_owner"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'article-refs'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

-- SELECT: не нужно — bucket публичный, любой может читать по URL.
-- Это критично: OpenAI Vision скачивает картинки по публичному URL.


-- ── 4. Bucket ai-pdf-pages: создаём + политики ──────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-pdf-pages', 'ai-pdf-pages', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "ai_pdf_pages_insert_owner" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_owner" ON storage.objects;
-- Совместимость с миграцией 019 (если применялась)
DROP POLICY IF EXISTS "ai_pdf_pages_insert_own"   ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_update_own"   ON storage.objects;
DROP POLICY IF EXISTS "ai_pdf_pages_delete_own"   ON storage.objects;

CREATE POLICY "ai_pdf_pages_insert_owner"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "ai_pdf_pages_update_owner"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "ai_pdf_pages_delete_owner"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
    )
  );
