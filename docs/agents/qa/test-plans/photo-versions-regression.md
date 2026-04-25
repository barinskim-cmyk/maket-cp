---
type: test-plan
status: active
owner: QA
created: 2026-04-24
updated: 2026-04-25
tags:
  - qa
  - regression
  - photo-versions
  - compare-view
related:
  - "[[photo_versions-migration-proposal]]"
  - "[[compare-view-integration-notes]]"
  - "[[agent-team-v2]]"
priority: high
cycle: pre-release
---

> **TL;DR:** Regression-план PV-01..PV-10 для `photo_versions` (миграции 030 + 031) и compare view. PA и DAD идут параллельно — план покрывает оба лейна одним прогоном после merge. До merge — manual smoke по топ-3.

# photo_versions + compare view — regression test plan

**Автор:** QA, retry 2026-04-25.
**Companion skeleton:** `tests/e2e/pending/photo-versions-full.spec.ts.draft`.
**Источники:**
- `docs/agents/dev/photo_versions-migration-proposal.md`
- `docs/agents/dev/compare-view-integration-notes.md`
- `v2/supabase/030_photo_versions.sql`
- `v2/supabase/031_share_link_photo_versions_write.sql`
- `v2/frontend/js/supabase.js` (`sbGetPhotoVersions`, `sbSelectPhotoVersion`, `sbSavePhotoVersion`, realtime канал)
- `v2/frontend/compare-view.html`, `v2/frontend/js/compare-view.js`
- `v2/frontend/js/previews.js` (lightbox wire-up под `_compareViewEnabled()`)

---

## Контекст

`photo_versions` — таблица версий ЦК / ретуши / грейдинга. Migration 030 — canonical схема с идемпотентностью. Migration 031 — fix RLS на UPDATE для share-link гостей (раньше клиент по ссылке получал «ошибка сохранения» при попытке выбрать версию).

Поверх стабилизированной схемы PA добавляет compare view как stand-alone страницу за фича-флагом `DEBUG_COMPARE_VIEW`. DAD доделает финальный визуал отдельной веткой. Активация автоматизированных тестов — после merge обоих лейнов; до merge все `test.fixme`.

---

## Сводная таблица сценариев

| ID    | Scenario                                              | Pre-condition                                                                                              | Steps                                                                                                                                                                              | Expected                                                                                                                                                              | Automated |
|-------|-------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| PV-01 | Select toggle (owner)                                 | Залогинен owner. Проект в облаке, у фото ≥2 версии stage=`color_correction` (v1 selected=true, v2 false).   | 1. Открыть проект. 2. Открыть photo в preview-panel. 3. Click «Selected» на v2. 4. Дождаться `PATCH /rest/v1/photo_versions?id=eq.<v2>`. 5. SQL: select id, selected по photo.    | v1.selected=false, v2.selected=true. Ровно одна `selected=true` на (project, photo, stage). UI обновляется без F5, нет ошибок в console.                              | yes       |
| PV-02 | Share-link guest UPDATE (post-031 fix)                | Активная share-link, аноним без auth. Фото с ≥2 версии. Migration 031 применена.                            | 1. Открыть share-link в инкогнито. 2. Открыть photo, click «Selected» на v2. 3. Прочитать сетевой ответ. 4. Service-role SQL: selected на v2.                                     | До 031 — 403/«ошибка сохранения». После 031 — 200, v2.selected=true, v1.selected=false. Деактивированная ссылка (is_active=false) — UPDATE отвергнут.                  | yes       |
| PV-03 | Unique constraint `(project_id, photo_name, stage, version_num)` | Fixture baseline с photo и version_num=1.                                                       | 1. Service-role: сырой INSERT с тем же ключом и другим preview_path → ожидается ошибка 23505. 2. Через `sbSavePhotoVersion` upsert с onConflict — обновление того же ключа.       | Сырой INSERT падает с unique_violation на имени `photo_versions_project_id_photo_name_stage_version_num_key`. Upsert проходит, count(*) по ключу = 1, preview_path обновлён. | yes       |
| PV-04 | RLS boundary — чужой проект                           | Owner A с активной share-link. Проект B (другой owner, без share-link для A). photo_versions есть в обоих. | 1. Из контекста A: `supa.from('photo_versions').select('*').eq('project_id', B.id)`. 2. Попытаться UPDATE selected на строке проекта B. 3. Service-role: сверка состояния B.        | SELECT в проекте B возвращает []. UPDATE — 0 affected rows. Данные B не меняются. WITH CHECK не позволяет менять project_id строки.                                    | yes       |
| PV-05 | Cascade delete при удалении проекта                   | Service-role доступ. Тестовый проект с 5 photo × 3 версии = 15 строк photo_versions.                       | 1. SQL: count(*) в photo_versions по project_id → 15. 2. `DELETE FROM projects WHERE id=…`. 3. SQL: count(*) в photo_versions → 0. 4. Storage: count `postprod/<p>/%`.            | БД: 0 строк photo_versions (ON DELETE CASCADE). Storage: файлы остаются (документированный gap, отдельный storage-cleanup job — OQ-QA-05).                              | yes       |
| PV-06 | Realtime subscribe на UPDATE                          | Проект открыт в двух сессиях (owner A + member B). Оба подписаны на канал `photo_versions_{project_id}`.    | 1. Обе сессии открыли photo с 2 версиями. 2. На A — click «Selected» на v2. 3. Сессия B — без F5 наблюдать обновление UI. 4. Измерить latency.                                     | Сессия B получает событие `UPDATE` с new={id, selected:true} за <3 сек (целевой <1). UI обновляется. Подписка с фильтром `project_id=eq.<p>` не утекает на чужие проекты. | yes       |
| PV-07 | Compare view toggle через feature flag                | Чистый localStorage. Owner в облачном проекте, photo с ≥1 версией.                                          | 1. Открыть lightbox — кнопки «Сравнить версии» нет. 2. `localStorage.setItem('DEBUG_COMPARE_VIEW','1')`, F5. 3. Открыть lightbox — кнопка появилась. 4. `removeItem`, F5.          | Без флага кнопки нет ни в DOM, ни в обработчиках. С флагом кнопка появляется (только если у проекта есть `_cloudId`). После снятия — снова нет. JS-ошибок 0 в обоих режимах. | yes       |
| PV-08 | Compare select — UPDATE + распространение в галерею  | Флаг ON. Photo с ≥2 версиями, v1 selected=true. Открыт compare-view URL.                                    | 1. В слоте A видеть v1 «Выбрано». 2. В слоте B выбрать v2 → click «Выбрать». 3. Дождаться UPDATE. 4. Закрыть compare-view, открыть preview-panel в галерее. 5. Service-role SQL.   | UPDATE один (без дубля). После закрытия preview-panel показывает v2 как selected без F5. Realtime в параллельной сессии тоже обновился. compare-view и preview-panel идут через тот же `sbSelectPhotoVersion`. | yes       |
| PV-09 | Mobile — compare-view не вшит, lightbox жив          | Mobile viewport (`devices['iPhone 13']`, 390×844). Флаг ON и OFF.                                          | 1. Открыть `_pvLbOpenMobile` — без кнопки «Сравнить» в любом режиме. 2. Открыть `compare-view.html` напрямую на мобильном. 3. Скриншот, проверка overflow-x.                       | Мобильный lightbox без compare-кнопки в обоих режимах флага (PA сознательно не вшил). compare-view.html открывается, без overflow-x. Финальный mobile-UX — после DAD spec. | yes (smoke) |
| PV-10 | Feature flag OFF — full fallback                      | Чистый localStorage. Существующий photo_versions flow (Rate Setter, panel ЦК, web-клиент).                  | 1. Открыть проект. 2. Open lightbox. 3. Выбрать ЦК-версию через panel ЦК. 4. На share-link — выбор кадра. 5. Открыть `compare-view.html` напрямую.                                  | Существующий flow `photo_versions` идентичен пред-релизному поведению. compare-view.html без флага показывает «в разработке». 0 JS-ошибок в console (любая = блок релиза). | yes       |

---

## Покрытие требований из брифа

- select toggle → PV-01
- share-link guest UPDATE (post-031 fix) → PV-02
- unique constraint → PV-03
- RLS boundary → PV-04
- cascade delete → PV-05
- realtime subscribe → PV-06
- compare view toggle → PV-07
- compare select → PV-08
- mobile → PV-09
- feature flag off → PV-10

---

## Топ-3 manual-проверки перед 7 мая

Эти три кейса блокирующие — без зелёного manual-результата релиз 7 мая не идёт. Автоматизация подтянется после merge PA + DAD.

1. **PV-02 — share-link guest UPDATE.** Регрессия-якорь для 031. Проверить на двух share-ссылках: активной (UPDATE проходит) и деактивированной с `is_active=false` (UPDATE отвергается, проверка `get_shared_project_ids()` фильтрует по `is_active=true AND (expires_at IS NULL OR expires_at > now())`). Если PV-02 покраснеет — клиент не может подтверждать кадры по ссылке, прямой блок продаж.
2. **PV-10 — feature flag OFF, full fallback.** Подтвердить что без `DEBUG_COMPARE_VIEW` production flow `photo_versions` идентичен пред-релизу. Проверить и desktop-app, и web-клиента (share-link). Любая JS-ошибка в console = блок релиза. Это страховка против случайной утечки compare-view к клиенту 7 мая.
3. **PV-06 — realtime subscribe.** Регистрация в `supabase_realtime` идёт через DO-блок в 030; на prod может быть уже включено (см. SQL-проверка #3 из proposal). Прогнать в двух сессиях: вторая получает обновление за <3 сек. Без realtime ломается UX «сейчас обновится список ЦК-версий» в Rate Setter.

---

## Pre-release SQL data integrity checks

Перед каждым prod-релизом, затрагивающим `photo_versions` или compare view, прогнать в Supabase SQL Editor:

```sql
-- 1. Инвариант: одна selected=true на (project, photo, stage)
SELECT project_id, photo_name, stage, COUNT(*) AS selected_count
  FROM public.photo_versions
 WHERE selected = true
 GROUP BY project_id, photo_name, stage
HAVING COUNT(*) > 1;
-- Ожидание: 0 строк.

-- 2. Migration 031 применена: есть update-политика для share-link
SELECT policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'photo_versions' AND cmd = 'UPDATE'
 ORDER BY policyname;
-- Ожидание: минимум 2 политики (member_update + photo_versions_update_by_share_link).

-- 3. Realtime publication содержит photo_versions
SELECT 1 FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename = 'photo_versions';
-- Ожидание: 1 строка.

-- 4. cos_path / preview_path ASCII-only (incident_ekonika_cyrillic_filenames)
SELECT id, cos_path, preview_path
  FROM public.photo_versions
 WHERE (cos_path <> '' AND cos_path !~ '^[A-Za-z0-9._/-]+$')
    OR (preview_path <> '' AND preview_path !~ '^[A-Za-z0-9._/-]+$');
-- Ожидание: 0 строк.
```

---

## Активация автоматизации

```
# До merge PA + DAD
ls tests/e2e/pending/photo-versions-full.spec.ts.draft

# После merge (ориентир: после 7 мая)
mv tests/e2e/pending/photo-versions-full.spec.ts.draft tests/e2e/active/photo-versions-full.spec.ts
# Снять test.fixme → test, прогнать локально, подогнать селекторы под финальную DAD-вёрстку.
```

Порядок реализации в волнах:

- **Wave 1** (после merge 031, уже сейчас): PV-01..PV-06 — regression на стабилизированную схему.
- **Wave 2** (после merge compare view, ETA 2026-05-01..07): PV-07, PV-08, PV-10.
- **Wave 3** (responsive smoke перед 7 мая): PV-09 manual + Playwright screenshot.

---

## Что вне scope

- Storage bucket `postprod` и storage-policies — ручная операция Маши, не покрывается e2e (см. SQL-проверка #4 в proposal).
- Расширение `stage`-enum за пределы `('color_correction','retouch','grading')` — будущая 032+ миграция.
- DAD-визуал: swipe / onion-skin overlay, синхронный zoom/pan — после merge DAD добавится отдельный план `compare-view-visual.md`.
- Cross-stage compare («финальный грейдинг против сырого ЦК») — открытый вопрос для Маши/DAD, не покрывается PV-01..PV-10.
- Storage cleanup после cascade delete (PV-05 caveat) — отдельный ticket OQ-QA-05.

---

## Открытые вопросы для QA

- **OQ-QA-10:** DAD-selector'ы для compare view. Сейчас в `.draft` стоят TODO под `[data-compare="pane-a"]`, `[data-compare="pane-b"]`, `[data-compare="select-button"]`.
- **OQ-QA-11:** Fixture seed-скрипт `tests/e2e/fixtures/seed-photo-versions.sql` — кто пишет, QA или PA. Предложение: QA пишет, PA review.
- **OQ-QA-12:** Staging Supabase branch. Пока не создан — на 7 мая работаем feature-flag в prod с тестовыми проектами `qa-*`.
- **OQ-QA-13:** Column-level RLS для share-link UPDATE. 031 ограничивает только команду; menacing payload может попытаться менять `cos_path`/`preview_path`. Не блокер для 7 мая, но открыть bug `2026-04-XX-photo-versions-anon-column-scope.md` severity=medium.

---

## Changelog

- **2026-04-24** v1 — QA, начальный 12-сценарный план после merge 030 + 031.
- **2026-04-25** v2 (retry) — пересобран в табличный формат PV-01..PV-10 под бриф «PA + DAD параллельно». Покрытие: select toggle, share-link UPDATE, unique constraint, RLS boundary, cascade delete, realtime, compare-toggle, compare-select, mobile, feature-flag-off. Прежняя расширенная версия (PV-04b, PV-07 leak, PV-11 comments, PV-12 mobile-detailed) — переехала в backlog, можно вернуть отдельным расширением после Wave 2.
