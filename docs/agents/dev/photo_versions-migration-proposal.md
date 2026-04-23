# photo_versions — proposal по миграции

**Дата:** 2026-04-23
**Автор:** Claude (autonomous cleanup)
**Owner по решению:** PA
**Референс:** `audits/coordinator-reconciliation-2026-04-23.md` п.2.2 и п.4.5

---

## TL;DR

Таблица `photo_versions` активно используется в коде (`v2/frontend/js/supabase.js` и `previews.js`), но **отсутствует в номерной последовательности миграций `v2/supabase/002-029`**. Reconciliation audit расценил это как potential blocker для QA / staging.

Реальность: миграция **существует** в двух местах:
1. `v2/backend/migrations/001_photo_versions.sql` — standalone, вне numbered sequence `v2/supabase/`.
2. Внутри `v2/supabase/all_pending_migrations.sql` (агрегированный dump для первичного наката).

**Риск:** при настройке нового окружения «с нуля» разработчик, следующий `v2/supabase/001-029` по порядку, `photo_versions` не создаст. Storage bucket `postprod` тоже не создастся — он нужен вручную в Dashboard.

**Proposal:** сложить canonical версию в `v2/supabase/proposed-photo_versions.sql` (этот autonomous-cleanup делает), после ревью Маши/PA — переименовать в `030_photo_versions.sql` и включить в основную последовательность. Существующую `v2/backend/migrations/001_photo_versions.sql` — оставить как исторический артефакт или удалить после консенсуса.

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

## Дифф против существующего 001_photo_versions.sql

Proposed `v2/supabase/proposed-photo_versions.sql` добавляет поверх существующего:

1. **Idempotent-защиту на `get_my_project_ids()` и `get_shared_project_ids()`** — чтобы миграция не падала, если эти RPC не ещё определены.
2. **`WITH CHECK` в policy `photo_versions_owner`** — без этого владелец может SELECT, но не INSERT/UPDATE через owner-policy (мелкий баг в оригинале).
3. **Комментарии про realtime-publication** — чтобы не забыть добавить таблицу в `supabase_realtime` после создания.
4. **Раздел «Открытые вопросы»** — stage values, extension для per-photo pipeline (см. ниже).

---

## Открытые вопросы для Маши

### 4.5-a. Существует ли таблица в prod сейчас?

Нужна проверка через MCP:

```
mcp__supabase__execute_sql({
  query: "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name = 'photo_versions' ORDER BY ordinal_position;"
})
```

Возможные сценарии:
- **(A) Таблица существует, DDL совпадает.** → proposed-миграция проверяется на staging (branch) и затем только переименовывается в `030_photo_versions.sql` как historical marker; применение на prod — no-op благодаря `IF NOT EXISTS`.
- **(B) Таблица существует, DDL расходится.** → требуется diff и ручной merge. Скорее всего без дропа данных (через `ALTER TABLE`).
- **(C) Таблицы нет — код обращается к несуществующей.** → в supabase.js возвращается ошибка в `console.warn('sbSavePhotoVersion:', res.error.message)`. Это должно было бы сломать продакшн сценарий сохранения версий (ЦК/Ретушь). Если не ломает — значит таблица есть.

Гипотеза: сценарий (A). Код использует `photo_versions` как рабочую функциональность, и если бы таблицы не было, отдача Rate Setter → Retouch цикла не работала бы.

### 4.5-b. Расширение stage-значений для per-photo pipeline?

Реконcилиация показывает (п.2.1 и 3.2), что продукт сдвинулся от container-centric к photo-centric. Поле `_stage` уже на фото (supabase.js:170, 219, 229, 304), и в будущем может потребоваться писать в `photo_versions` другие стадии («select», «approved», «delivered»). Сейчас CHECK-constraint жёстко ограничен тремя значениями.

Опции:
- Оставить как есть — при добавлении новой стадии отдельной миграцией расширять constraint.
- Ослабить constraint до «любая text-строка» — гибко, но теряется валидация.
- Сделать lookup-таблицу `pipeline_stages` с FK — правильно, но overengineering для Q2.

Рекомендация: оставить жёстким, расширять constraint одноразовой миграцией при добавлении per-photo stage в roadmap.

### 4.5-c. Storage bucket `postprod` существует?

Независимый вопрос. Без bucket'а `preview_path` будет указывать на несуществующие объекты и отдача превью в UI ломается. Нужна проверка через:

```
mcp__supabase__execute_sql({
  query: "SELECT id, name, public FROM storage.buckets WHERE id = 'postprod';"
})
```

Если нет — создать через Dashboard или через REST API к Supabase.

### 4.5-d. Realtime публикация?

Код (supabase.js:3881-3896) подписывается на `postgres_changes` для `photo_versions` — это работает только если таблица в publication `supabase_realtime`. Проверить:

```
mcp__supabase__execute_sql({
  query: "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'photo_versions';"
})
```

Если строк 0 — добавить:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE photo_versions;
```

---

## Рекомендуемый порядок действий

1. **PA** запускает 4 проверочных SQL-запроса (4.5-a, c, d выше) через `mcp__supabase__execute_sql`.
2. **Маша** ревьюит `v2/supabase/proposed-photo_versions.sql` — особенно раздел «WITH CHECK» и список stage-значений.
3. Если всё ок — переименовать файл в `030_photo_versions.sql` (или в следующий свободный номер), убрать префикс `proposed-`.
4. Прогнать через staging-ветку Supabase (см. memory feedback_staging_decision.md — ветвление в Supabase).
5. Применить на prod через `mcp__supabase__apply_migration`.
6. Удалить `v2/backend/migrations/001_photo_versions.sql` либо оставить с комментарием «merged into v2/supabase/030_photo_versions.sql on YYYY-MM-DD».

**Deadline:** по audit-приоритизации — до 2026-04-30 (blocker для QA).

---

## Changelog

- **2026-04-23** v1 — черновик proposal по результатам reconciliation audit. Автор: Claude (autonomous cleanup). Не применялся к prod.
