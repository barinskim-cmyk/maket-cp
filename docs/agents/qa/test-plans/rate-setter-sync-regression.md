# Rate Setter sync — регрессионный test plan

**Автор:** Product Architect, overnight autonomous pass (2026-04-23).
**Для:** QA-лейн, как основа Playwright-реализации.
**Companion:** `docs/agents/dev/rate-setter-sync-analysis-2026-04-23.md`, `docs/agents/dev/rate-setter-sync-fixes-proposal-2026-04-23.md`.
**Формат:** human-readable сценарии, которые QA переведёт в `.spec.ts`. Сценарии нумеруются `RS-REG-XX` и соответствуют `it(...)` блокам в `tests/e2e/pending/rate-setter-sync.spec.ts.draft`.

---

## Цель

Покрыть Rate Setter sync-лейер сценариями, которые:
1. Воспроизводят [anchor client]-подобные инциденты (14.04 data loss, 15.04 cyrillic).
2. Верифицируют корректность каждого предложенного фикса F-01 … F-10.
3. Защищают ставку 4 KPI «zero manual re-sync к 2026-06-30».
4. Обнаруживают регрессии в `sync.js`, `supabase.js:2759-3131`, `rate_setter.py`, `cos_repository.py`.

---

## Предусловия для всех сценариев

- Supabase staging-проект или feature-flagged prod (после audit R3).
- Тестовый Capture One session с 20 демо-`.cos` файлами (fixture: `tests/e2e/fixtures/capture-one-session/`).
- Тестовый проект в облаке с `photo_versions` уже применённой миграцией.
- Авторизованный owner-пользователь `qa-owner@maket.test`.
- Вторичный user `qa-client@maket.test` для share-link сценариев.
- Browser: Chrome (Playwright default) + desktop build pywebview (где применимо).

---

## Happy path сценарии (regression baseline)

### RS-REG-01 — Базовый run в text-режиме

**Связано с:** F-01, F-02 (guards), baseline.

**Pre-condition:**
- Проект открыт, в облаке есть 10 карточек с назначенными файлами (IMG_0001…IMG_0010).
- Capture One session папка с 10 `.cos` файлами.

**Steps:**
1. Navigate to `#rs` tab (sync page).
2. Click «Автозаполнить из проекта».
3. Verify textarea contains 10 stems, one per line.
4. Enter session folder path.
5. Click «Запуск (dry run)».
6. Verify log contains «DRY IMG_0001 -> IMG_0001.CR3.cos» × 10.
7. Click «Запуск».
8. Wait for `onRateSetterDone`.

**Expected:**
- Result line: «Обновлено: 10 | Без изменений: 0 | Не найдено: 0 | Ошибок: 0».
- В Supabase `stage_events` новая строка с `trigger_desc = 'co_sync_done'`.
- В Supabase `snapshots` новая строка для текущего этапа.

**Acceptance criteria:**
- Нет ошибок в console.
- Все 10 `.cos` файлов содержат `<E K="Basic_Rating" V="5"/>`.
- Response time < 30 сек на 10 файлов.

---

### RS-REG-02 — Dry run не меняет облако и не пишет `.bak`

**Связано с:** F-02, F-07.

**Pre-condition:** см. RS-REG-01.

**Steps:**
1. Clean state: нет `.bak` файлов в session папке, `stage_events` пустой.
2. Run Rate Setter с `dry_run=true`.

**Expected:**
- UI показывает «DRY» строки.
- В сессии нет новых `.bak`.
- В `stage_events` новых строк нет.
- `photo_versions` без изменений.

**Acceptance criteria:** idempotent, no side effects.

---

### RS-REG-03 — COS round-trip (upload в bucket + photo_versions)

**Связано с:** F-03, F-04.

**Pre-condition:**
- `photo_versions` миграция применена.
- Bucket `postprod` создан с policies (см. OQ-RS-01).
- Проект с 5 карточками + 5 `.cos` файлов.

**Steps:**
1. Run Rate Setter (production mode).
2. Wait `onRateSetterDone`.
3. В UI log видны строки «Upload .cos files: 5 (iter 1)».
4. Wait upload complete.
5. Query Supabase: `SELECT * FROM photo_versions WHERE project_id = '{test_project_id}' AND stage = 'color_correction'`.

**Expected:**
- 5 строк photo_versions со stage='color_correction', version_num=1, cos_path не пустой.
- В Storage bucket `postprod` лежат 5 `.cos` файлов по пути `{project_id}/{stem}/color_correction_1.cos`.
- UI log показывает «Upload complete: 5 ok, 0 failed».

**Acceptance criteria:**
- cos_path в Storage совпадает с cos_path в photo_versions.
- Размер файла в Storage = размеру локального `.cos`.

---

### RS-REG-04 — Повторный run — delta iter 2

**Связано с:** F-03, F-06.

**Pre-condition:** RS-REG-03 выполнен (iter1 сохранён).

**Steps:**
1. Модифицировать 2 из 5 карточек (сменить slot.file).
2. Create snapshot `client_changes` вручную или через UI.
3. Click «Только изменения» в Rate Setter.
4. Textarea содержит только 2 стема.
5. Run Rate Setter.

**Expected:**
- photo_versions получает 2 новые строки с version_num=2 для изменённых фото.
- Остальные 3 фото остаются с version_num=1.
- Storage содержит `/color_correction_2.cos` × 2.

**Acceptance criteria:**
- Unique constraint `(project_id, photo_name, stage, version_num)` не нарушен.
- iter номер определяется `rsGetIterationNumber()` корректно.

---

### RS-REG-05 — Ретушёр видит рейтинги через share-link

**Связано с:** F-03, R-01.

**Pre-condition:** RS-REG-03 выполнен. Share-link создан для проекта.

**Steps:**
1. В новой incognito-вкладке открыть share-link.
2. Wait page load.
3. Call `sbLoadPhotoVersions(projectId)` (через devtools or UI-кнопку).

**Expected:**
- Возвращается 5 версий.
- В UI (preview panel) рядом с каждой фотографией отображается рейтинг 5.

**Acceptance criteria:**
- Клиент (anon) может скачать `.cos` через `sbLoadPhotoVersions`.
- Политика `photo_versions_anon_select` срабатывает корректно.

---

## Edge cases

### RS-REG-06 — Пустой stems после clean (F-02 guard)

**Связано с:** F-02.

**Pre-condition:** Проект открыт.

**Steps:**
1. В textarea ввести `.\n..\n...` (три строки из точек).
2. Click «Запуск».

**Expected:**
- Alert «После очистки имён список пустой».
- Rate Setter не запускается.
- `stage_events` без новых строк.

**Acceptance criteria:** graceful abort, no side effects.

---

### RS-REG-07 — 60% строк отфильтровано — warning dialog

**Связано с:** F-02.

**Pre-condition:** Проект с 10 файлами.

**Steps:**
1. В textarea: 10 валидных имён + 15 строк-мусора (`/path/to/`, пустые, точки).
2. Click «Запуск».

**Expected:**
- `confirm()` диалог: «Из 25 строк распознано только 10 имён. Продолжить?».
- При Yes — Rate Setter запускается с 10 стемами.
- При No — abort.

**Acceptance criteria:** пользователь явно принимает решение на подозрительном ratio.

---

### RS-REG-08 — Cyrillic photo_name в проекте (F-04)

**Связано с:** F-04, R-05, incident 2026-04-15.

**Pre-condition:**
- Проект с 3 файлами: `Солнце_17774.CR3`, `Солнце_17775.CR3`, `IMG_0001.CR3`.
- Для каждого есть соответствующий `.cos` в session.

**Steps:**
1. Run Rate Setter в text-режиме с этими 3 именами.
2. Wait `onRateSetterDone`.
3. Wait upload complete.
4. Query Supabase: `SELECT photo_name, cos_path FROM photo_versions WHERE project_id = '{test_project_id}'`.

**Expected:**
- 3 строки в photo_versions.
- `photo_name` содержит оригинальную кириллицу (`Солнце_17774.CR3`).
- `cos_path` содержит только ASCII (`{uuid}/Solntse_17774.CR3/color_correction_1.cos` или аналог).
- В bucket `postprod` файлы существуют по ASCII-путям (без 400 InvalidKey).
- Console.warn был для каждого cyrillic имени («sbUploadPostprodFile: ASCII-sanitize»).

**Acceptance criteria:** воспроизведение [anchor client]-cyrillic инцидента теперь проходит.

---

### RS-REG-09 — Strip tails edge case

**Связано с:** R-04 analysis.

**Pre-condition:** session содержит `IMG_0001.CR3.cos`, `IMG_0002 copy.CR3.cos`.

**Steps:**
1. Textarea: `IMG_0001_preview.jpg\nIMG_0002 copy 2.jpg`.
2. Enable `strip_tails`.
3. Run.

**Expected:**
- `IMG_0001_preview` → strip → `IMG_0001` → MATCH → update OK.
- `IMG_0002 copy 2` → strip_tail регулярка не матчит (только " copy" без " copy 2") → остаётся `IMG_0002 copy 2` → MISS.
- Log показывает «MISS IMG_0002 copy 2».

**Acceptance criteria:** корректно проявляется известный edge case; результат детерминирован.

**Comment for QA:** это документирование текущего поведения, а не ожидание корректности. Возможно, потребуется отдельный фикс — рекурсивный strip_tail (`" copy N"` → `" copy"` → `""`).

---

### RS-REG-10 — Offline run + reconnect flush (F-01)

**Связано с:** F-01, R-02.

**Pre-condition:** Проект открыт online.

**Steps:**
1. В Chrome DevTools → Network → Offline.
2. Run Rate Setter на 5 файлах.
3. Verify log: local update OK, но UI показывает toast «Событие отложено. Повтор при восстановлении связи».
4. Check `localStorage['maket_pending_stage_events_v1']` — содержит 1 запись.
5. Включить сеть.
6. Trigger `sbFlushStageQueue()` (через reconnect-listener или ручная кнопка).
7. Wait 2–3 сек.
8. Query Supabase: `SELECT * FROM stage_events WHERE project_id = ... ORDER BY created_at DESC LIMIT 1`.

**Expected:**
- Ровно 1 новая строка в `stage_events` (не 0, не 2).
- `localStorage` очередь пустая после flush.

**Acceptance criteria:** offline не теряет события.

---

### RS-REG-11 — Concurrent select photo version (F-08)

**Связано с:** F-08, R-03.

**Pre-condition:**
- photo_versions содержит 3 версии для одного (project, photo, stage).
- 2 user-сессии: owner-photographer и member-retoucher.

**Steps:**
1. Оба юзера одновременно (в разных Playwright contexts) вызывают `sbSelectPhotoVersion` — owner для V1, retoucher для V2.
2. Wait 2 сек.
3. Query: `SELECT id, selected FROM photo_versions WHERE project_id = ... AND photo_name = ...`.

**Expected (после внедрения F-08):**
- Ровно одна версия имеет selected=true.
- Другие две — selected=false.
- Какая именно выиграла — зависит от race, но инвариант «одна selected» сохранён.

**Acceptance criteria:** `pg_advisory_xact_lock` или аналог препятствует двум одновременным selected=true.

---

### RS-REG-12 — Double-click «Запуск» в 1 секунду (F-01 idempotency)

**Связано с:** F-01, R-02.

**Steps:**
1. Run Rate Setter, затем в течение 1 сек снова кликнуть «Запуск» программно (bypass disabled).
2. Wait both `onRateSetterDone`.
3. Query `stage_events` count.

**Expected:**
- UI-кнопка disabled после первого клика — ожидаемо только 1 run.
- Даже если bypass — `sbSyncStage` idempotency-guard пропустит второй вызов (3 сек cooldown).
- В `stage_events` — 1 строка, не 2.

**Acceptance criteria:** defense in depth работает.

---

### RS-REG-13 — Interrupted upload — частичная запись не создаёт ложных photo_versions

**Связано с:** F-03.

**Steps:**
1. Run Rate Setter на 10 файлах.
2. После 4-го upload — разорвать соединение (DevTools → Offline).
3. Wait timeout.
4. Query photo_versions.

**Expected:**
- В photo_versions строки только для успешно загруженных (≤ 4).
- В Storage тоже 4 файла.
- UI log показывает «Upload complete: 4 ok, 6 failed».
- Нет «висячих» photo_versions со пустым cos_path.

**Acceptance criteria:** партиальное состояние детектируется, UI его показывает.

---

### RS-REG-14 — Stale snapshot cache (F-06)

**Связано с:** F-06, R-03.

**Pre-condition:**
- Local кэш `_snCachedSnapshots` — 2 снимка (A, B), последний B = `client_approved`.
- В облаке есть 3-й снимок C (`client_changes`, создан через share-link с другого устройства).

**Steps:**
1. Click «Только изменения» (Rate Setter, delta mode).
2. Wait refresh snapshots (F-06 fresh-snapshot refresh).
3. Verify `_snCachedSnapshots.length === 3`.
4. Verify baseline snapshot = C (не B).

**Expected:**
- Delta вычислена относительно C, не B.
- textarea заполнен изменениями, которые релевантны для iter 3.

**Acceptance criteria:** никакой «old baseline» race.

---

### RS-REG-15 — Rate Setter с 500 файлами — back-pressure

**Связано с:** R-06 analysis.

**Pre-condition:** session с 500 `.cos` файлами.

**Steps:**
1. Run Rate Setter на 500 файлах.
2. В UI видим лог, прогресс.
3. В процессе — попытка закрыть вкладку → `beforeunload` должен предупредить.
4. Не закрывать; дождаться завершения.

**Expected:**
- Run завершается за < 10 мин.
- В `rate-setter-sync-analysis-2026-04-23.md` п.2.6: добавить `beforeunload` guard — это часть F-01 или отдельный фикс F-11.
- После завершения — `photo_versions` содержит 500 строк.

**Acceptance criteria:**
- Нет memory leak (UI responsive).
- Результат детерминирован.

**Comment for QA:** это нагрузочный тест, в Playwright implement с увеличенным timeout.

---

## Матрица: риск → сценарий

| Risk | Сценарии | Статус |
|---|---|---|
| R-01 (COS round-trip) | RS-REG-03, RS-REG-04, RS-REG-05, RS-REG-13 | критические |
| R-02 (silent errors) | RS-REG-10, RS-REG-12 | критические |
| R-03 (race conditions) | RS-REG-11, RS-REG-14 | важные |
| R-04 (empty stems) | RS-REG-06, RS-REG-07 | важные |
| R-05 (cyrillic) | RS-REG-08 | важный, воспроизводит [anchor client] 15.04 |
| R-06 (backup) | RS-REG-15 (частично), отдельный manual test по `.bak` | документация + manual |

---

## Data integrity checks (для manual verification при release)

До каждого prod-релиза Rate Setter, QA запускает следующие SQL-проверки (раздел 2.3 в release-checklist'е):

```sql
-- 1. Не должно быть двух selected=true для одного (project, photo, stage)
SELECT project_id, photo_name, stage, COUNT(*) as selected_count
FROM photo_versions
WHERE selected = true
GROUP BY project_id, photo_name, stage
HAVING COUNT(*) > 1;
-- Ожидается: 0 строк.

-- 2. Все cos_path должны быть ASCII
SELECT id, cos_path
FROM photo_versions
WHERE cos_path != '' AND cos_path !~ '^[A-Za-z0-9._/-]+$';
-- Ожидается: 0 строк.

-- 3. stage_events монотонны по created_at в рамках проекта
SELECT project_id, stage_id, created_at,
  LAG(created_at) OVER (PARTITION BY project_id ORDER BY created_at) as prev
FROM stage_events
WHERE trigger_desc = 'co_sync_done';
-- Ожидается: prev < created_at для всех строк.

-- 4. pending-queue в localStorage — не анализируется через SQL, но после смены клиента QA запустит JS-проверку:
--   localStorage.getItem('maket_pending_stage_events_v1') === null || длина < 10
```

---

## Mapping сценариев на Playwright `.spec.ts` блоки

Смотреть `tests/e2e/pending/rate-setter-sync.spec.ts.draft` — там `describe` блоки ссылаются на RS-REG-XX номера.

---

## Открытые вопросы для QA

- **OQ-QA-01:** Fixture Capture One session — где брать? Victor (CX) имеет реальные данные на [anchor client], но не выдаст.
- **OQ-QA-02:** Тестовый Supabase проект — staging не существует (audit R3). До того — feature flag, изолированные юзеры в prod.
- **OQ-QA-03:** Как симулировать одновременность в Playwright? — два browser context'а в одном test, `Promise.all([act1, act2])`.
- **OQ-QA-04:** UI-toast (F-01) пока заглушка. DAD должен дать разметку до реализации F-01.

---

**Owner test plan:** QA lane.
**Следующий шаг:** QA принимает, транслирует в `.spec.ts` (см. skeleton), согласует с DAD по UI-toast'ам.
