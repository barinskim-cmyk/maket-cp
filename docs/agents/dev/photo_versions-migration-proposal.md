# photo_versions — proposal по миграции

**Дата:** 2026-04-23 (update: 2026-04-23 overnight — финализирован 030)
**Автор:** Claude (autonomous cleanup) → PA (overnight batch)
**Owner по решению:** PA
**Референс:** `audits/coordinator-reconciliation-2026-04-23.md` п.2.2 и п.4.5

---

## TL;DR

Таблица `photo_versions` активно используется в коде (`v2/frontend/js/supabase.js` и `previews.js`), но **отсутствует в номерной последовательности миграций `v2/supabase/002-029`**. Reconciliation audit расценил это как potential blocker для QA / staging.

Реальность: миграция **существует** в двух местах:
1. `v2/backend/migrations/001_photo_versions.sql` — standalone, вне numbered sequence `v2/supabase/`.
2. Внутри `v2/supabase/all_pending_migrations.sql` (агрегированный dump для первичного наката).

**Риск:** при настройке нового окружения «с нуля» разработчик, следующий `v2/supabase/001-029` по порядку, `photo_versions` не создаст. Storage bucket `postprod` тоже не создастся — он нужен вручную в Dashboard.

**Proposal (v1):** сложить canonical версию в `v2/supabase/proposed-photo_versions.sql`, после ревью Маши/PA — переименовать в `030_photo_versions.sql` и включить в основную последовательность.

**Статус (2026-04-23 overnight, v2):** canonical версия финализирована в `v2/supabase/030_photo_versions.sql` (идемпотентная, безопасна к запуску на prod). Требует прогонки 6 SQL-проверок на prod перед apply — см. раздел «SQL-проверки перед apply» ниже. После успешного apply — удалить `v2/supabase/proposed-photo_versions.sql` и пометить `v2/backend/migrations/001_photo_versions.sql` как merged.

---

## Как выведена схема

### Источник 1 — существующий DDL

`v2/backend/migrations/001_photo_versions.sql` (84 строки) — авторский файл от более ранней фазы продукта. Содержит:
- `CREATE TABLE photo_versions` с 9 колонками.
- Индекс `idx_photo_versions_project`.
- RLS policies (owner / member / anon).
- Функция `get_shared_project_ids()`.
- Комментарий про bucket `postprod`.

### Источник 2 — фактическое использование в коде

`v2/frontend/js/supabase.js`:

| Строка | Операция | Колонки |
|---|---|---|
| 2886-2888 | `.select('photo_name, stage, preview_path').eq('project_id', ...)` | photo_name, stage, preview_path |
| 2934-2936 | `.select('*').eq('project_id', ...)` | все колонки |
| 2992-2997 | `.select('*').eq('project_id',...).eq('stage', ...).order('photo_name').order('version_num')` | подтверждает stage, version_num, photo_name |
| 3018-3045 (sbSavePhotoVersion) | `.upsert(row, {onConflict: 'project_id,photo_name,stage,version_num'})` | project_id, photo_name, stage, version_num, preview_path, cos_path, selected |
| 3061-3080 | `.update({selected: false/true}).eq('project_id',...).eq('photo_name',...).eq('stage',...)` | подтверждает selected |
| 3108-3112 | `.delete().eq('id', ...)` | подтверждает id UUID |
| 3881-3896 | Realtime channel на INSERT событиях для project_id=eq.X | подтверждает realtime-ready |

`v2/frontend/js/previews.js:911`:
- «Загрузить версии (ЦК/Ретушь) из photo_versions и привязать к превью» — подтверждает stage-values «color_correction» и «retouch».

### Сведение

Схема в `v2/backend/migrations/001_photo_versions.sql` **полностью соответствует** использованию в коде. Никаких колонок кода нет, которые бы отсутствовали в DDL, и наоборот.

---

## Изменения в 030 по сравнению с 001_photo_versions.sql и all_pending_migrations.sql

### Что добавлено (форвард-совместимое расширение)

1. **Идемпотентность везде.**
   - `CREATE TABLE IF NOT EXISTS` для основной таблицы.
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для новых колонок (`updated_at`, `created_by`, `metadata`).
   - `DO $$ ... IF NOT EXISTS ... END$$` для unique-constraint'а и для регистрации в `supabase_realtime`.
   - `DROP POLICY IF EXISTS` + `CREATE POLICY` — RLS-политики пересоздаются, позволяет починить расхождение в prod без ручного cleanup.
   - `CREATE OR REPLACE FUNCTION` для prerequisite-функций `get_my_project_ids()` / `get_shared_project_ids()`.
   - `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` для auto-update `updated_at`.

2. **Новые колонки (forward-looking).**
   - `updated_at timestamptz NOT NULL DEFAULT now()` — нужен BEFORE UPDATE-триггер.
   - `created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL` — для аудита «кто создал версию» (owner/member/ретушёр); NULL допустим для исторических записей и анонимных импортов через RPC.
   - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` — расширение без ALTER TABLE (exif, checksum, batch_id, ai_score).

3. **Новая политика `photo_versions_member_insert`.**
   В 001 member имел только SELECT+UPDATE. Теперь также INSERT — нужно ретушёру / клиенту при upload в браузере. DELETE по-прежнему остаётся только у owner-политики.

4. **`WITH CHECK` в owner-policy.**
   В оригинале был только `USING`, из-за чего INSERT/UPDATE проходили только через общий `FOR ALL` без проверки write-стороны. Добавлено.

5. **`get_shared_project_ids()` ужесточена.**
   Теперь фильтрует `is_active = true AND (expires_at IS NULL OR expires_at > now())`. Раньше отдавала любые share_links — даже деактивированные и истёкшие. Соответствует паттерну `029_fix_share_rpcs.sql`.

6. **Регистрация в `supabase_realtime`.**
   Условный `ALTER PUBLICATION ... ADD TABLE` через DO-блок (пропускается, если таблица уже в publication или если publication отсутствует в self-hosted сетапе).

7. **Trigger `trg_photo_versions_touch_updated_at`.**
   BEFORE UPDATE — автоматически обновляет `updated_at`. Без триггера колонка застывает после INSERT.

8. **Три индекса вместо одного.**
   - `idx_photo_versions_project` — одиночный `project_id` (для realtime-фильтра и массовых выборок).
   - `idx_photo_versions_project_photo` — (project_id, photo_name) для `sbLoadPhotoVersionsByPhoto`.
   - `idx_photo_versions_project_photo_stage` — (project_id, photo_name, stage) для основного load-паттерна.
   В 001 был только последний; Postgres его использует и для первых двух префиксов, но отдельные индексы убирают cost на узких выборках.

9. **Комментарии к таблице и колонкам.**
   `COMMENT ON TABLE` / `COMMENT ON COLUMN` — самодокументация в БД, видно в `\d+ photo_versions` и в Supabase Dashboard.

### Что НЕ изменено (backward-compatible)

- **Все существующие колонки сохранены с теми же типами и дефолтами** (`id`, `project_id`, `photo_name`, `stage`, `version_num`, `preview_path`, `cos_path`, `selected`, `created_at`). Нет ALTER TYPE, нет переименований.
- **CHECK-constraint на `stage` сохранён как был:** `('color_correction','retouch','grading')`. Задача PA упоминала альтернативный набор `('cc','retouch','tech')` — он НЕ соответствует коду, поэтому не применён. Расширение набора — отдельной миграцией при появлении per-photo pipeline этапов.
- **UNIQUE-ключ `(project_id, photo_name, stage, version_num)`** — тот же, что в 001. Совпадает с `onConflict` в `supabase.js:3032`.
- **Name колонки `storage_path`** — НЕ создана. В коде используется `preview_path` + `cos_path`, generic `storage_path` создал бы третий путь и разошёлся бы с кодом. Отражено в комментарии в 030-файле.
- **Storage bucket `postprod` и Storage policies** — не создаются миграцией, остаются ручной операцией Маши (feedback_supabase_storage_rls.md).

---

## SQL-проверки перед apply

**Владелец:** Маша. Выполнить в Supabase SQL Editor на **prod** (или через `mcp__supabase__execute_sql` на staging-branch), скопировать результаты в PR к 030, проверить ожидаемые значения.

```sql
-- Проверка 1: существует ли таблица photo_versions в prod и какой её DDL?
-- Ожидание: таблица есть, 9 колонок (id, project_id, photo_name, stage, version_num,
-- preview_path, cos_path, selected, created_at). Если колонок больше — 030 добавит
-- их идемпотентно, это ок. Если типы/constraints расходятся — остановиться и сверить.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'photo_versions'
 ORDER BY ordinal_position;

-- Проверка 2: какие stage-значения реально встречаются в данных?
-- Ожидание: только из набора ('color_correction','retouch','grading').
-- Если есть другие — значит CHECK-constraint уже ослаблен где-то в проде;
-- остановиться и расширить 030 до нужного enum.
SELECT stage, count(*) AS n
  FROM public.photo_versions
 GROUP BY stage
 ORDER BY n DESC;

-- Проверка 3: таблица photo_versions уже в publication supabase_realtime?
-- Ожидание: 1 строка (realtime уже включён) либо 0 строк (030 добавит сама).
SELECT schemaname, tablename
  FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime'
   AND tablename = 'photo_versions';

-- Проверка 4: существует ли bucket postprod в Storage?
-- Ожидание: 1 строка с public = false. Если нет — создать ДО apply 030,
-- иначе preview_path/cos_path будут указывать на несуществующий bucket.
SELECT id, name, public
  FROM storage.buckets
 WHERE id = 'postprod';

-- Проверка 5: какие RLS-политики сейчас стоят на photo_versions?
-- Ожидание: минимум owner + member_select + anon_select (как в 001).
-- 030 сделает DROP POLICY IF EXISTS + пересоздаст; будущий набор —
-- owner / member_select / member_insert / member_update / anon_select.
SELECT policyname, permissive, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'photo_versions'
 ORDER BY policyname;

-- Проверка 6: функция get_my_project_ids() существует и возвращает SETOF uuid?
-- Ожидание: 1 строка, return_type = 'SETOF uuid'. Без неё RLS-политики сломаются.
SELECT proname, pg_get_function_result(oid) AS return_type
  FROM pg_proc
 WHERE proname IN ('get_my_project_ids', 'get_shared_project_ids')
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
```

Если **все 6 проверок** дают ожидаемый результат — применять 030. Если хоть одна расходится — остановиться и разобраться, не накатывать.

---

## Открытые вопросы для Маши (historical — v1)

### 4.5-a. Существует ли таблица в prod сейчас?

Покрывается проверкой #1 из SQL-проверок выше. Ожидаемый сценарий (A) — таблица уже есть, DDL совпадает с 001; 030 применяется idempotent-пасами.

### 4.5-b. Расширение stage-значений для per-photo pipeline?

Реконcилиация показывает (п.2.1 и 3.2), что продукт сдвинулся от container-centric к photo-centric. Поле `_stage` уже на фото (supabase.js:170, 219, 229, 304), и в будущем может потребоваться писать в `photo_versions` другие стадии («select», «approved», «delivered»). Сейчас CHECK-constraint жёстко ограничен тремя значениями.

Опции:
- Оставить как есть — при добавлении новой стадии отдельной миграцией расширять constraint.
- Ослабить constraint до «любая text-строка» — гибко, но теряется валидация.
- Сделать lookup-таблицу `pipeline_stages` с FK — правильно, но overengineering для Q2.

**Решение (v2):** оставить жёстким в 030, расширять constraint одноразовой 031-миграцией при добавлении per-photo stage в roadmap. Задачу PA'а (с альтернативным enum 'cc'/'retouch'/'tech') НЕ применяем — он расходится с кодом.

### 4.5-c. Storage bucket `postprod` существует?

Покрывается проверкой #4. Миграция 030 bucket не создаёт (это ручная операция Маши).

### 4.5-d. Realtime публикация?

Покрывается проверкой #3. Миграция 030 сама добавляет таблицу в publication через DO-блок, если её там нет.

---

## Порядок применения

1. **Backup текущего prod.** В Supabase Dashboard → Database → Backups → Create backup (или подтвердить, что автоматический дневной backup свежий, ≤24ч).
2. **Staging-branch prechecks.** Создать Supabase branch из prod (через UI или MCP), прогнать 030 там, убедиться что миграция завершается без ошибок и проверки 1–6 на бранче дают разумные значения.
3. **Apply на prod.** Через Supabase Dashboard → SQL Editor (или `mcp__supabase__apply_migration` с name='030_photo_versions'). Должно пройти без ошибок; все `IF NOT EXISTS` / `DO $$` блоки делают миграцию безопасной к повторному запуску.
4. **Monitoring 24ч.** Смотреть `console.warn('sbSavePhotoVersion'/'sbLoadPhotoVersions'...)` в браузерных логах. Проверить, что realtime-канал `photo_versions_{project_id}` подписывается без ошибок.
5. **Cleanup после 24ч без инцидентов:**
   - Удалить `v2/supabase/proposed-photo_versions.sql`.
   - Добавить комментарий в `v2/backend/migrations/001_photo_versions.sql`: «Merged into v2/supabase/030_photo_versions.sql on 2026-04-XX. Kept as historical artefact.»
   - Обновить `v2/supabase/all_pending_migrations.sql` секцию с photo_versions, если она там есть.

**Deadline:** по audit-приоритизации — до 2026-04-30 (blocker для QA).

---

## Риск-матрица

| Сценарий | Вероятность | Что делает 030 | Что делать, если сломается |
|---|---|---|---|
| **(A) Таблица уже есть, DDL совпадает с 001** (ожидаемое) | Высокая | `CREATE TABLE IF NOT EXISTS` пропускается. `ADD COLUMN IF NOT EXISTS` добавляет updated_at/created_by/metadata. RLS-политики пересоздаются. Realtime регистрируется, если ещё нет. | — штатный сценарий, ничего не делать |
| **(B) Таблица есть, но CHECK-constraint на stage другой** (например уже расширен до 'select'/'approved') | Низкая | `CREATE TABLE IF NOT EXISTS` пропускается → старый CHECK сохранён. ALTER COLUMN тип не трогает. Миграция не падает. | Остановиться на проверке #2: если результаты показывают `stage NOT IN ('color_correction','retouch','grading')` — сделать отдельную 031-миграцию для расширения CHECK. НЕ менять 030. |
| **(C) Таблица есть, но RLS-политики имеют другие имена** | Средняя | `DROP POLICY IF EXISTS photo_versions_*` дропает только те, что по именам совпадают. Чужие политики остаются и могут конфликтовать. | Перед apply вручную проверить проверкой #5. Если есть нештатные политики — решить: дропнуть вручную или переименовать 030-политики под существующие. |
| **(D) Realtime publication уже содержит photo_versions** | Высокая | DO-блок `IF NOT EXISTS` пропускает `ALTER PUBLICATION`. Ошибки нет. | — штатный сценарий |
| **(E) Publication `supabase_realtime` не существует** (редкий self-hosted кейс) | Очень низкая | `EXCEPTION WHEN undefined_object` ловит, RAISE NOTICE, миграция продолжается. | — штатный сценарий |
| **(F) Функция `get_my_project_ids()` была создана с другим телом** | Низкая | `CREATE OR REPLACE FUNCTION` ПЕРЕЗАПИСЫВАЕТ. Если существующая логика отличалась — получим регрессию в других RLS, использующих ту же функцию. | Перед apply сравнить тело функции: `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_my_project_ids'`. Если расхождение — НЕ применять 030 без согласования. |
| **(G) Unique constraint уже есть с другим именем** (не `photo_versions_project_id_photo_name_stage_version_num_key`) | Низкая | DO-блок проверяет по имени, не по колонкам. Создаст второй дубликат → ошибка "relation already exists". | Проверить: `SELECT conname FROM pg_constraint WHERE conrelid = 'photo_versions'::regclass AND contype = 'u';` Если имя другое — либо переименовать вручную, либо адаптировать DO-блок под фактическое имя. |
| **(H) `auth.users` ссылка на несуществующую схему** (нестандартный Supabase setup) | Очень низкая | `ADD COLUMN created_by ... REFERENCES auth.users(id)` упадёт. | Удалить FK на auth.users и оставить просто `uuid`, либо подставить актуальную схему идентичности. |
| **(I) Таблица `photo_versions` отсутствует вообще** (свежий prod) | Низкая | `CREATE TABLE` создаёт всё полностью, constraint добавится через DO-блок, RLS создастся. | — штатный сценарий «пустого» окружения |

---

## Changelog

- **2026-04-23** v1 — черновик proposal по результатам reconciliation audit. Автор: Claude (autonomous cleanup). Не применялся к prod.
- **2026-04-23** v2 (overnight) — финализирован `v2/supabase/030_photo_versions.sql`. Добавлены идемпотентность, updated_at + trigger, created_by, metadata, member_insert policy, `get_shared_project_ids()` с фильтром активных ссылок. Proposal дополнен разделами «Изменения в 030», «SQL-проверки перед apply», «Порядок применения», риск-матрицей. Автор: PA (overnight batch).
