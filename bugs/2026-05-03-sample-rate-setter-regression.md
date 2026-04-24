---
id: BUG-2026-001
date: 2026-05-03
reporter: [test user A]
severity: critical
area: rate-setter-sync
status: verified
source: live-test
---

> **ВНИМАНИЕ: это mock-пример.** Данные, имена клиентов, project_id, коммит-хэши, логи — все вымышлены. Используй этот файл как шаблон: скопируй, переименуй, замени содержимое на реальное. Не добавляй в finder никакого bug-кода, основанного на этом содержимом.

## Summary

После запуска Rate Setter на проекте [anchor client]-SS26 (360 файлов) в облаке осталось 180 `.cos`-файлов вместо 360, при этом локально в Capture One session все файлы переименованы и ключевые слова выставлены корректно. Rate Setter в логах написал «Upload complete: 360 ok, 0 failed», но `photo_versions` в БД содержит только 180 записей для этого запуска. Совпадение: пропущенные файлы — все с кириллическими именами вида `Солнце_17774.CR3`.

## Steps to reproduce

1. Войти в Maket CP под owner-аккаунтом `qa-owner@maket.test`.
2. Создать проект «BUG-sample-[anchor client]» (либо открыть существующий с такими же параметрами).
3. Загрузить фикстуру `tests/e2e/fixtures/[anchor client]-mixed-names/` (360 файлов — 180 латиницей `IMG_*.CR3`, 180 кириллицей `Солнце_*.CR3`, `Ветер_*.CR3`).
4. Обработать в Capture One, расставить рейтинги, сохранить session.
5. В Maket CP перейти на экран Rate Setter (`#rs`).
6. Указать session-directory.
7. Нажать «Auto-fill» → «Run (не dry)».
8. Подождать, пока лог покажет «Upload complete».
9. Открыть Supabase SQL editor, выполнить:
   ```sql
   SELECT count(*) FROM photo_versions
   WHERE project_id = '<project_id>' AND stage = 'color_correction';
   ```

## Expected

- В БД 360 записей в `photo_versions` для этого запуска.
- В Supabase Storage `postprod` бакете 360 `.cos` файлов.
- Лог отражает фактический результат: если часть не ушла — число `failed` > 0.

Источник ожиданий: `docs/agents/qa/test-plans/rate-setter-sync-regression.md` тест RS-REG-08 (Cyrillic sanitize).

## Actual

- `photo_versions`: 180 записей (только латиница).
- Storage bucket `postprod`: 180 файлов (только латиница).
- Лог UI: «Upload complete: 360 ok, 0 failed» — ложно-положительный.
- В браузерной консоли 180 запросов вида:
  ```
  PUT https://<supabase>.supabase.co/storage/v1/object/postprod/...
  → 400 InvalidKey
  ```
  Но в UI про это ни слова.

## Impact

- Затронут как минимум 1 живой клиент ([anchor client], активный проект SS26, 360 фото).
- Потеря данных: нет (локальные `.cos` целы), но **ретушёр не видит** половину фотографий, и процесс стоит.
- Workaround: переименовать кириллицу в латиницу перед импортом в Maket CP, но это ломает всю идею продукта (кириллические артикулы — половина целевого рынка).
- Бета-онбординг блокируется: нельзя пускать российские бренды, пока кириллица не работает. **Запускать T-01.**

## Logs / attachments

- Supabase log (UTC 2026-05-03 14:22:07 .. 14:25:44): `docs/agents/qa/attachments/BUG-2026-001/supabase-storage-400.log`.
- Скриншот консоли Chrome DevTools: `docs/agents/qa/attachments/BUG-2026-001/devtools-network-400.png`.
- Video 32 сек (оформляет баг): `docs/agents/qa/attachments/BUG-2026-001/reproduce.mp4`.
- Выжимка stack trace (первая из 180 одинаковых ошибок):
  ```
  POST https://<supabase>.supabase.co/storage/v1/object/postprod/Солнце_17774.cos
  Status: 400 Bad Request
  Response body: {"statusCode":"400","error":"InvalidKey","message":"Invalid key: Солнце_17774.cos"}
  ```

## Timeline

- 2026-05-03 14:25 UTC — reported by [test user A] (обнаружено при live-тесте на [anchor client], ретушёр Оля пожаловалась в Telegram).
- 2026-05-03 14:40 UTC — triaged by CX, severity=critical, area=rate-setter-sync. Основание: потенциальная потеря видимости данных + блокировка российского рынка.
- 2026-05-03 14:42 UTC — T-01 запущен CoS. Outbound бета-писем поставлен на паузу. Уведомление Маше в Telegram.
- 2026-05-03 15:05 UTC — reproduced by QA на staging (такой же результат: 180 из 360).
- 2026-05-03 15:30 UTC — in-progress by PA (patch в `v2/frontend/js/supabase.js` в функции `sbSanitizeStorageKey`, плюс surfacing upload errors в UI).
- 2026-05-03 18:10 UTC — fixed, commit `a1b2c3d`. PR description: исправление path-sanitize + correct `failed` counter в логе + toast при ≥1 failed.
- 2026-05-03 19:00 UTC — verified by QA на staging (все 360 файлов прошли, лог корректный, 0 failed).
- 2026-05-03 19:05 UTC — T-01 снят CoS, outbound возобновлён.
- 2026-05-04 10:00 UTC — closed (test coverage добавлен — см. Resolution).

## Resolution

**Root cause:** функция `sbSanitizeStorageKey` в `v2/frontend/js/supabase.js` обрабатывала только основные слэши и пробелы, но не транслитерировала кириллицу. Supabase Storage отвергал ключи с non-ASCII символами с ошибкой 400 InvalidKey. Дополнительно — функция `rsSyncCompleted` в `v2/frontend/js/sync.js` не учитывала результаты storage-upload'а при формировании итогового log-сообщения, поэтому даже 180 ошибок не влияли на счётчик `ok`.

**Fix:**
1. Расширена `sbSanitizeStorageKey`: кириллица транслитерируется через таблицу GOST-R-52535 (упрощённая для имён файлов), далее path фильтруется по `^[A-Za-z0-9._/-]+$`.
2. `rsSyncCompleted` теперь получает реальные результаты из `Promise.allSettled`, счётчик `failed` отражает HTTP-ошибки Storage.
3. При `failed > 0` — UI показывает красный toast с кнопкой «Показать failed» (модалка со списком).
4. В `photo_versions.photo_name` сохраняется оригинальное имя (кириллица), а в `cos_path` — санитизированное.

**Regression coverage:**
- Активирован draft `tests/e2e/pending/rate-setter-sync.spec.ts.draft` тест RS-REG-08 → перенесён в `tests/e2e/rate-setter-sync.spec.ts` (после merge F-03 и F-04).
- Добавлен mini-test в `v2/frontend/js/__tests__/sanitize.test.js` на 20 разных кириллических input'ов.

**Scope of collateral:** проверить, нет ли такой же дыры в `auto-rename` (возможно, cyrillic файлы при переименовании теряются тихо). Создан отдельный bug-файл: `2026-05-03-auto-rename-cyrillic-check.md` со статусом `in-triage` для follow-up.

## Related

- `incident_[anchor client]_cyrillic_filenames.md` — оригинальный инцидент 2026-04-15, тогда починили частично.
- `docs/agents/dev/rate-setter-sync-fixes-proposal-2026-04-23.md` — F-04 — именно этот случай был в плане фиксов.
- PR `#142` (mock) — сам фикс.
- `tests/e2e/pending/rate-setter-sync.spec.ts.draft` — RS-REG-08.
