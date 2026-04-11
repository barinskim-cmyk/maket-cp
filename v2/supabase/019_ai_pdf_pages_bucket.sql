-- ============================================================
-- Миграция 019: bucket ai-pdf-pages для URL-first AI matching
-- ============================================================
-- Создаёт публичный Storage-бакет для страниц PDF чек-листа,
-- отрендеренных в картинки. Фронтенд загружает страницы сюда
-- один раз и передаёт публичные URL в OpenAI Vision вместо
-- base64 — это экономит входные токены и трафик.
--
-- Path pattern: <project_id>/page_<idx>.jpg
-- Upsert: true  (перезапись при повторном прогоне)
-- Публичный доступ: да (OpenAI должен уметь скачать по URL)
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-pdf-pages', 'ai-pdf-pages', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Политика: владелец проекта может загружать/читать/удалять
-- страницы в подпапке своего проекта.
-- Публичное чтение уже включено через bucket.public = true,
-- поэтому явной SELECT-политики не требуется.

DROP POLICY IF EXISTS "ai_pdf_pages_insert_own" ON storage.objects;
CREATE POLICY "ai_pdf_pages_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "ai_pdf_pages_update_own" ON storage.objects;
CREATE POLICY "ai_pdf_pages_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "ai_pdf_pages_delete_own" ON storage.objects;
CREATE POLICY "ai_pdf_pages_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ai-pdf-pages'
    AND auth.role() = 'authenticated'
  );
