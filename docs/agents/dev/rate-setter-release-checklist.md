---
type: doc
status: active
owner: PA
created: 2026-04-24
updated: 2026-04-24
tags:
  - product
  - ongoing
  - dev
related:
  - "[[agent-team-v2]]"
  - "[[strategy-2026]]"
  - "[[release-review-playbook]]"
priority: medium
cycle: ongoing
---

> **TL;DR:** **Автор:** Product Architect, overnight pass 2026-04-23. **Назначение:** обязательный прогон перед любым релизом (push в main), который затрагивает Rate Setter sync-лейер. **Companion:** `rate-setter-sync-analysis-2026-04-23.md`, `rate-setter-sync-fixes-proposal-2026-04-23.md`, `qa/test-plans/rate-setter-sync-regression.md`.

# Rate Setter — Pre-Release Checklist

**Автор:** Product Architect, overnight pass 2026-04-23.
**Назначение:** обязательный прогон перед любым релизом (push в main), который затрагивает Rate Setter sync-лейер.
**Companion:** `rate-setter-sync-analysis-2026-04-23.md`, `rate-setter-sync-fixes-proposal-2026-04-23.md`, `qa/test-plans/rate-setter-sync-regression.md`.

---

## Когда применять

Этот чек-лист обязателен, если релиз трогает хотя бы один из файлов:

- `v2/frontend/js/sync.js`
- `v2/frontend/js/supabase.js` (функции `sbSyncStage`, `sbSavePhotoVersion`, `sbSelectPhotoVersion`, `sbUploadPostprodFile`, `snCreateSnapshot`, realtime subscription `photo_versions_*`)
- `v2/backend/core/services/rate_setter.py`
- `v2/backend/core/infra/cos_repository.py`
- `v2/backend/core/api/app_api.py` — функция `rate_setter_run`
- Миграции Supabase: `photo_versions`, `stage_events`, `snapshots`, `projects.stage`
- Storage bucket `postprod` или его policies

Для мелких изменений (например, правка текста в UI Rate Setter) можно использовать сокращённый чек-лист (раздел 7).

---

## 1. Ручные проверки (человеком, в Maket CP UI)

Эти 8 шагов — обязательный smoke-тест перед любым релизом. Тайминг ≈ 20 минут.

### 1.1. Happy path в text-режиме
- [ ] Открыть проект (любой из тестовых).
- [ ] Перейти на вкладку «Rate Setter».
- [ ] Нажать «Автозаполнить из проекта» → textarea заполняется именами.
- [ ] Указать путь к тестовой сессии Capture One с соответствующими `.cos`.
- [ ] Нажать «Запуск (dry run)» → log показывает «DRY X -> X.cos» для всех файлов, `rs-result` скрыт.
- [ ] Нажать «Запуск» → log показывает «OK X -> X.cos», `rs-result` виден с корректными цифрами.
- [ ] В `.cos` файле локально присутствует `<E K="Basic_Rating" V="5"/>`.
- [ ] В `.cos.bak` (или `.maket_backups/`) лежит оригинал.

### 1.2. Delta-режим
- [ ] Создать snapshot в проекте (вручную или через UI).
- [ ] Модифицировать 2 карточки (поменять фото в слотах).
- [ ] Вернуться в Rate Setter → «Только изменения».
- [ ] Проверить, что textarea заполнен только изменёнными стемами.
- [ ] Запустить. В log: только строки для этих 2 файлов, iter-номер в `rs-auto-info`.

### 1.3. Empty stems guard (F-02)
- [ ] В textarea: только точки и пустые строки.
- [ ] Нажать «Запуск» → alert с текстом про пустой список. Rate Setter не запускается.
- [ ] В облаке stage_events без новых строк.

### 1.4. Error surfacing (F-01)
- [ ] В DevTools Network → Offline.
- [ ] Запустить Rate Setter.
- [ ] В UI должен появиться toast «Событие отложено».
- [ ] В DevTools: `localStorage.getItem('maket_pending_stage_events_v1')` содержит 1 запись.
- [ ] Вернуть сеть.
- [ ] Вручную вызвать `sbFlushStageQueue()` или дождаться auto-flush.
- [ ] Через 5 сек: в DB `stage_events` есть запись, localStorage пуст.

### 1.5. Cyrillic file names (F-04)
- [ ] Создать проект с файлом, содержащим кириллицу (например, «Солнце_17774.jpg»).
- [ ] Запустить Rate Setter (если F-03 merged — проверить upload).
- [ ] В Supabase: `photo_versions.photo_name` содержит кириллицу, `cos_path` — только ASCII.
- [ ] В bucket `postprod` файл на месте, отдаётся без 400 InvalidKey.

### 1.6. Round-trip (F-03) — если включено
- [ ] Запустить Rate Setter на проекте online.
- [ ] В log видны строки «Upload .cos files: N» и «Upload complete: N ok, 0 failed».
- [ ] В `photo_versions` — N строк с `stage='color_correction'`, `version_num>0`, `cos_path !== ''`.
- [ ] Открыть share-link в incognito → фотографии и рейтинги видны ретушёру.

### 1.7. Двойной клик (F-01 idempotency)
- [ ] Запустить Rate Setter.
- [ ] Немедленно (без ожидания) кликнуть «Запуск» второй раз.
- [ ] Кнопка disabled — ок.
- [ ] Через 5 сек: в `stage_events` ровно одна новая строка (не две).

### 1.8. Snapshot cache refresh (F-06)
- [ ] Открыть проект, содержащий snapshots.
- [ ] Искусственно «забить» кэш устаревшим (через DevTools: `_snCachedSnapshots = [...первые два элемента...]`).
- [ ] Нажать «Только изменения».
- [ ] Проверить в console: `_snCachedSnapshots.length === фактическому числу в DB`.

---

## 2. Regression тесты (Playwright)

До момента когда `tests/e2e/*.spec.ts` будут активированы — заменяем на ручной прогон `qa/test-plans/rate-setter-sync-regression.md`. После — автоматически:

- [ ] `npx playwright test rate-setter-sync` — все Wave 1 тесты проходят (RS-REG-01, 02, 06, 07, 10, 12).
- [ ] Если merged F-03: Wave 2 тесты проходят (RS-REG-03, 04, 05, 08, 13).
- [ ] Если merged F-06/F-08: Wave 3 проходят (RS-REG-11, 14).
- [ ] Нет новых сообщений в console.error в Playwright trace.

**Если какой-то тест помечен `test.fixme` и ещё не реализован** — это не блокер, но QA фиксирует в своём tracker'е.

---

## 3. Data-integrity checks (SQL)

Выполнить в Supabase SQL Editor перед релизом на staging; после релиза на prod — в течение 24 часов.

### 3.1. Инвариант «одна selected версия на (photo, stage)»

```sql
SELECT project_id, photo_name, stage, COUNT(*) as selected_count
FROM photo_versions
WHERE selected = true
GROUP BY project_id, photo_name, stage
HAVING COUNT(*) > 1;
```
- [ ] Ожидается: **0 строк.** Если не 0 — race condition в `sbSelectPhotoVersion` (см. F-08).

### 3.2. Все `cos_path` — ASCII

```sql
SELECT id, project_id, photo_name, cos_path
FROM photo_versions
WHERE cos_path != ''
  AND cos_path !~ '^[A-Za-z0-9._/-]+$'
LIMIT 100;
```
- [ ] Ожидается: **0 строк.** Если не 0 — нарушение F-04 sanitize.

### 3.3. `stage_events` монотонны по проекту

```sql
WITH ordered AS (
  SELECT project_id, stage_id, created_at,
    LAG(created_at) OVER (PARTITION BY project_id ORDER BY created_at) AS prev_at
  FROM stage_events
  WHERE trigger_desc = 'co_sync_done'
)
SELECT * FROM ordered WHERE prev_at IS NOT NULL AND prev_at >= created_at;
```
- [ ] Ожидается: 0 строк (или только строки, созданные в одну мс — безопасно).

### 3.4. Нет «осиротевших» `photo_versions` без cos_path (если F-03 включён)

```sql
SELECT project_id, photo_name, stage, version_num, created_at
FROM photo_versions
WHERE stage = 'color_correction'
  AND cos_path = ''
  AND created_at > now() - interval '1 day';
```
- [ ] Ожидается: 0 строк. Если есть — `sbSavePhotoVersion` был вызван без cos_path = partial failure.

### 3.5. Нет версий со `stage` вне допустимого набора

```sql
SELECT DISTINCT stage FROM photo_versions
WHERE stage NOT IN ('color_correction', 'retouch', 'grading');
```
- [ ] Ожидается: 0 строк. Если есть — CHECK constraint не применён или обойден.

### 3.6. Проверка pending-queue у активных пользователей (sampling)

Запустить в DevTools-консоли каждого тест-юзера:

```javascript
JSON.parse(localStorage.getItem('maket_pending_stage_events_v1') || '[]').length
```
- [ ] Ожидается: < 10 (нормально — могут копиться при offline; > 10 — застряли).

---

## 4. Проверки Storage (вручную через Supabase Dashboard)

- [ ] Bucket `postprod` существует.
- [ ] Policy «owner upload» присутствует.
- [ ] Policy «anon download only .jpg» присутствует (не `.cos`).
- [ ] Количество файлов в bucket в разумных пределах (не взрывается экспоненциально).
- [ ] Размер bucket < 10 GB (для free tier; для Pro — < лимита).

---

## 5. Rollback criteria

**Откатить релиз немедленно, если:**

1. В первые 2 часа после прода обнаружен хотя бы один photo_version с cos_path, указывающий на несуществующий в bucket файл (broken ref).
2. В pending-queue накапливается >50 событий у любого активного пользователя без признаков retry-flush.
3. [test user A] ([anchor client]) сообщает через `/bugs/`: «рейтинги пропали» или «в Capture One не все рейтинги».
4. В `error_log` (если F-09 merged) > 20 критических записей за час.
5. `photo_versions` получил UPDATE/DELETE от не-owner (проверить RLS через `SELECT auth.uid(), ... FROM photo_versions`).
6. Data integrity check 3.1 или 3.2 показал хотя бы 1 строку нарушения.

### Rollback procedure

```bash
# 1. Откатиться на предыдущий коммит
git revert <release-commit>
git push origin main

# 2. Если были миграции — откатить (если есть rollback SQL)
# (у Rate Setter миграции additive, rollback = DROP нового, не трогать существующее)

# 3. Уведомить активных пользователей
#    - [test user A] (через /bugs/ или Telegram)
#    - Belarus-пилот (через в Telegram)
#    - Masha (root)

# 4. Post-incident:
#    - Добавить регрессионный тест на случившееся
#    - Обновить этот чек-лист (новый шаг проверки)
```

---

## 6. Feature flag status check

Если релиз использует feature flags (audit R3):

- [ ] Флаг `enable_cos_sync` установлен в целевое значение для target-юзеров.
- [ ] Флаг `use_photo_versions` = true для всех.
- [ ] Флаг `enable_pending_queue` = true после F-01 merge.
- [ ] localStorage override для dev не пролетает к prod-юзерам.

---

## 7. Сокращённый чек-лист (minor changes)

Если изменение — только UI-текст, стиль, комментарии в коде, форматирование:

- [ ] `git diff` не затрагивает функции из раздела «Когда применять».
- [ ] Ручной smoke: шаг 1.1 (happy path).
- [ ] Шаг 3.1 (инвариант selected).
- [ ] Запушить в main.

**Всё остальное из чек-листа — опционально.**

---

## 8. Ownership

| Шаг | Owner | Fallback |
|---|---|---|
| Ручные проверки (раздел 1) | Masha | QA |
| Playwright (раздел 2) | QA | PA |
| Data integrity (раздел 3) | PA | Masha |
| Storage (раздел 4) | PA | Masha |
| Rollback decision (раздел 5) | Masha | PA |
| Feature flags (раздел 6) | PA | Masha |

---

## 9. Post-release monitoring (24 часа после)

В течение 24 часов после релиза:

- [ ] Каждые 4 часа — прогон SQL раздела 3.
- [ ] Утро следующего дня — ручная проверка `error_log` (F-09) или console.warn sampling у [test user A].
- [ ] Если в `stage_events` меньше событий, чем ожидалось (например, < 50% от предыдущего периода) — возможен silent failure, investigating.
- [ ] CX (через [test user A]) собирает фидбек: «что-то поменялось в Rate Setter, заметили?»

---

## 10. Обновление этого чек-листа

После каждого incident'а, связанного с Rate Setter sync:

1. Добавить новый шаг проверки, специфичный для incident'а.
2. Обновить раздел «Rollback criteria», если появился новый failure mode.
3. Коммитить как `docs: update rate-setter-release-checklist after incident <YYYY-MM-DD>`.

Цель — чтобы каждый следующий релиз был безопаснее предыдущего.

---

**Source of truth:** этот документ + `rate-setter-sync-analysis-2026-04-23.md`. При конфликте приоритет у analysis-документа (он подкреплён кодом).
