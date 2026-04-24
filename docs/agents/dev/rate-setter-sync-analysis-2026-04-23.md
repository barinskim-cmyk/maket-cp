# Rate Setter sync — анализ рисков (2026-04-23)

**Автор:** Product Architect, overnight autonomous pass.
**Скоуп:** полный sync-лейер Rate Setter (Capture One → Supabase → UI) перед рекомендуемыми фиксами.
**Статус:** аналитический документ. Патчей в prod-код не вносилось — предложения лежат в `rate-setter-sync-fixes-proposal-2026-04-23.md`.
**Источники кода:** `v2/frontend/js/sync.js`, `v2/frontend/js/supabase.js`, `v2/backend/core/services/rate_setter.py`, `v2/backend/core/infra/cos_repository.py`, `v2/backend/core/api/app_api.py`, миграции `v2/supabase/*.sql`, `v2/supabase/proposed-photo_versions.sql`.
**Источники контекста:** `docs/agents/dev/audit-2026-04-23.md` (раздел 1.2, 4), `audits/coordinator-reconciliation-2026-04-23.md`, memory `incident_[anchor client]_data_loss.md`, `incident_[anchor client]_cyrillic_filenames.md`, `feedback_staging_decision.md`, `reference_storage_buckets.md`.

---

## TL;DR

Rate Setter — это не одна функция, а **четыре несинхронизированных участка**: UI-инициация (`sync.js`), Python-сервис (`RateSetterService` + `CosRepository`), облачный stage-event (`sbSyncStage`), snapshot (`snCreateSnapshot`). Каждый участок имеет «проваливающиеся» пути ошибок, где данные теряются молча (swallow-catch в callback'ах, `console.warn` вместо пользовательского уведомления, нет идемпотентности, нет транзакции вокруг stage_event + snapshot). Архитектурно это [anchor client]-сценарий в миниатюре: если синхронизация провалится на середине, UI покажет success, а облачные данные будут неконсистентны.

Главные риски (ранжировано по impact):

1. **R-01 — Нет round-trip COS ↔ облако.** `rate_setter.py` пишет `Basic_Rating` локально в `.cos`, `sync.js` после этого зовёт `sbSyncStage` + `snCreateSnapshot`, но **ни одна из функций не загружает сам `.cos` в bucket `postprod`**. `photo_versions.cos_path` заполняется пустой строкой в `sbSavePhotoVersion` по умолчанию (`supabase.js:3027`). Ретушёр не видит рейтингов, которые поставил фотограф, если открывает проект по share-link без локальной сессии Capture One. Это и есть KPI-провал ставки 4 (strategy-2026.md:114-126).
2. **R-02 — Ошибки «съедаются» без сигнала пользователю.** `sbSyncStage` только `console.warn` при падении (`supabase.js:2777, 2795`); `rsSyncCompleted` не знает, что stage_event не записался. Пользователю «всё ок», в облаке — пустой stage_event. Это тот же паттерн, что сорвал [anchor client] (см. memory `incident_[anchor client]_data_loss.md`: «action log was empty»).
3. **R-03 — Race condition: delta-sync по снимку, который ещё не прилетел.** `rsFillDeltaFromLatest` берёт `_snCachedSnapshots[-1]`. Если локально создан новый снимок, но realtime-подписка ещё не подтвердила его в облаке, Rate Setter сравнит не с тем базовым снимком → неверная «дельта» → фотограф проставит рейтинги не тем файлам.
4. **R-04 — Нет guard'а против пустого stems.** `sync.js:126` проверяет только, что textarea не пустой. Если после `strip_tails + strip_extension` получаются только пустые строки — `RateSetterService.run` получает пустой set, возвращает `{updated: 0}`. UI показывает success, но ничего не произошло. В delta-режиме (iter2+) это особенно опасно — пользователь думает, что новые рейтинги записаны.
5. **R-05 — Cyrillic/ASCII дрейф между слоями.** `sbSanitizeStorageKey` применяется только в `sbUploadThumb`. Если R-01 реализуется без sanitize — любое cyrillic photo_name (реальный кейс Виктории, memory `incident_[anchor client]_cyrillic_filenames.md`) снова получит 400 InvalidKey.
6. **R-06 — Backup-логика `.cos.bak` не rollback-able.** `CosRepository.update_rating:74-77` пишет `.bak` только один раз (`if not bak.exists()`). После второго изменения (re-rate) `.bak` уже устарел; откатиться к pre-sync состоянию невозможно, а пользователь об этом не знает.

---

## 1. Архитектура sync — текущее состояние

### 1.1. Поток данных

```
┌──────────────┐          ┌───────────────────────────┐          ┌────────────────────┐
│ sync.js (UI) │─payload─▶│ window.pywebview.api      │─dict────▶│ AppAPI             │
│ runRateSetter│          │ .rate_setter_run          │          │ rate_setter_run    │
└──────────────┘          └───────────────────────────┘          └─────────┬──────────┘
      ▲                                                                    │
      │ onRateSetterLog / onRateSetterDone (push)                          ▼
      │                                                          ┌────────────────────┐
      │                                                          │ RateSetterService  │
      │                                                          │ .run()             │
      │                                                          └─────────┬──────────┘
      │                                                                    │
      │                                                                    ▼
      │                                                          ┌────────────────────┐
      │                                                          │ CosRepository      │
      │                                                          │ .build_index()     │
      │                                                          │ .update_rating()   │◀── .cos (локальный диск)
      │                                                          └────────────────────┘
      │
      │ onRateSetterDone → rsSyncCompleted(result)
      ▼
┌──────────────────┐              ┌────────────────────┐
│ sbSyncStage()    │─INSERT──────▶│ stage_events       │
│  (supabase.js)   │              │ (Supabase)         │
└──────────────────┘              └────────────────────┘

┌──────────────────┐              ┌────────────────────┐
│ snCreateSnapshot │─INSERT──────▶│ snapshots          │
│                  │              │ (Supabase)         │
└──────────────────┘              └────────────────────┘

       [ ❌ пропущено: upload .cos в bucket postprod ]
       [ ❌ пропущено: sbSavePhotoVersion с cos_path ]
```

### 1.2. Карта функций и endpoints

| Слой | Имя | Файл:строка | Что делает | Риск |
|---|---|---|---|---|
| Frontend UI | `runRateSetter(dryRun)` | `sync.js:113` | Собирает payload, вызывает bridge, дизейблит кнопку | R-04 (пустые stems после clean) |
| Frontend UI | `rsAutoFillFromProject()` | `sync.js:41` | Авто-заполнение textarea из активного проекта / snapshot | R-03 (stale snapshot) |
| Frontend UI | `rsFillDelta(before, after, iter)` | `sync.js:242` | Вычисляет diff между двумя снимками | R-03 |
| Frontend UI | `rsFillDeltaFromLatest()` | `sync.js:286` | Берёт последний `client_approved/co_sync_done` из кэша | R-03 (stale cache), R-04 |
| Frontend UI | `rsGetIterationNumber()` | `sync.js:340` | Считает итерации | R-03 (кэш может быть стейл) |
| Frontend callback | `window.onRateSetterLog` | `sync.js:164` | Рендерит строку прогресса | — |
| Frontend callback | `window.onRateSetterDone` | `sync.js:177` | Отображает итог, триггерит `rsSyncCompleted` | R-02 |
| Frontend sync | `rsSyncCompleted(result)` | `sync.js:205` | Пишет stage_event + snapshot | R-02 (нет транзакции) |
| Python bridge | `AppAPI.rate_setter_run` | `app_api.py:130` | Запускает `RateSetterService.run` в thread | R-04 |
| Python service | `RateSetterService.run` | `rate_setter.py:65` | Обходит stems, зовёт `update_rating` | R-06 |
| Python infra | `CosRepository.build_index` | `cos_repository.py:20` | Индексирует `.cos` рекурсивно | — |
| Python infra | `CosRepository.update_rating` | `cos_repository.py:45` | XML parse + write + `.bak` | R-06 |
| Supabase client | `sbSyncStage(trigger, note)` | `supabase.js:2759` | UPDATE `projects.stage` + INSERT `stage_events` | R-02 (swallow error) |
| Supabase client | `sbSavePhotoVersion(v, cb)` | `supabase.js:3018` | Upsert в `photo_versions` (by project+photo+stage+version) | R-01 (cos_path='') |
| Supabase client | `sbSelectPhotoVersion(...)` | `supabase.js:3057` | reset-all + set-true (two-phase, не транзакция) | R-03 (race ретушёр vs фотограф) |
| Supabase client | `sbUploadPostprodFile(...)` | `supabase.js:3147` | Base64 → Blob → Storage upload | R-05 (нет sanitize) |
| Supabase client | `snCreateSnapshot(...)` | `supabase.js:3719` | INSERT snapshot | R-02 |
| Supabase realtime | `photo_versions` channel | `supabase.js:3881-3896` | Подписка на INSERT/UPDATE | R-03 (reconnect, offline) |
| БД | `photo_versions` | миграция `proposed-photo_versions.sql` / `001_photo_versions.sql` | `(project_id, photo_name, stage, version_num)` unique | R-01 (миграция вне sequence — см. audit 4.1) |
| БД | `stage_events` | миграции 005 / 014 / 026 (частично) | append-only | — |
| БД | `snapshots` | миграция 010 | point-in-time | R-03 |
| Storage | bucket `postprod` | вручную в Dashboard | `{project_id}/{stem}/{stage}_{N}.{jpg|cos}` | R-05 (нет ASCII-чеков на `stem`) |

### 1.3. Триггеры, связанные с Rate Setter

Rate Setter теоретически пишет события: `co_sync_done`, `preview_loaded` (косвенно), `iterN_applied` (через `_rsIterationTag`).
В коде в явном виде — только `co_sync_done` (`sync.js:212`).
В memory `project_pipeline_events.md` указано 17 триггеров — половина отсутствует в коде.
**Следствие:** owner-dashboard (ставка 4 Q3) получит неполные метрики SLA.

---

## 2. Точки сбоев

### 2.1. Потеря данных на pipeline stage_events

**Сценарий:**
1. Фотограф запускает Rate Setter на 500 фото.
2. `update_rating` локально прошёл, `onRateSetterDone` вернулся.
3. `rsSyncCompleted` зовёт `sbSyncStage('co_sync_done', note)`.
4. `sbSyncStage` делает UPDATE `projects.stage` и INSERT в `stage_events` **независимо, без транзакции**.
5. UPDATE проходит, INSERT падает (RLS, сетевой сбой, rate limit). `console.warn` — всё, что увидит пользователь.
6. `snCreateSnapshot` вызывается независимо, с тем же риском.

**Результат:** `projects.stage` продвинулся, но в `stage_events` нет записи. Timeline на owner-dashboard показывает пробел, а Timeline на клиентской share-странице — неконсистентный переход.

**Где в коде:** `supabase.js:2772-2779` + `2789-2797` + `sync.js:211-213` + `sync.js:216-227`.

### 2.2. COS ↔ облако: файл .cos никогда не попадает в bucket

**Сценарий:**
1. Rate Setter записал рейтинг в локальный `.cos` (Капча-ван сессия на диске фотографа).
2. `onRateSetterDone({updated: 500})` вернулся.
3. `rsSyncCompleted` → `sbSyncStage` + `snCreateSnapshot`.
4. `.cos` **остаётся только локально.** Ни `sbUploadPostprodFile`, ни `sbSavePhotoVersion` не вызываются.
5. Ретушёр (другой пользователь, другой комп) открывает проект по share-link. В `photo_versions` нет строк → ретушёр не видит никаких рейтингов.

**Результат:** для non-local роли рейтинг фотографа невидим. Это и есть «Rate Setter COS ↔ облако расхождения», указанные в `audit-2026-04-23.md:51` и в reconciliation audit.

**Где не реализовано:** в `sync.js` после `rsSyncCompleted` нет шага «upload .cos → create photo_version».

### 2.3. Race condition на `sbSelectPhotoVersion`

**Сценарий:**
1. Фотограф Маша: выбирает версию V1 → `UPDATE selected=false where photo, stage` (сброс) → `UPDATE selected=true where id=V1`.
2. Одновременно ретушёр Лена: выбирает V2 → `UPDATE selected=false` (уже сбросил) → `UPDATE selected=true where id=V2`.
3. Если операции перемежаются: Маша сбрасывает, Лена сбрасывает, Маша ставит V1, Лена ставит V2 → одновременно selected=true у V1 и V2. Нарушение инварианта «одна версия selected на (photo, stage)».
4. Realtime приходит фотографу: сначала V2=true, потом V1=true; ей — «всё ок». Ретушёру — зеркально.
5. При следующем refresh UI покажет в списке обе версии selected.

**Где в коде:** `supabase.js:3057-3090`. Это two-phase update без транзакции / optimistic lock / conflict-detection.

**Серьёзность:** Для Rate Setter-только сценария (фотограф один в системе) риск низкий. Для блока C пайплайна, где ретушёр одновременно работает с проектом — критический. В ставке 4 это block.

### 2.4. Delta-sync по неактуальному снимку

**Сценарий:**
1. Фотограф создал snapshot A вчера (client_approved).
2. Клиент доработал — создан snapshot B (client_changes) синхронно через share-link. Realtime подписка фотографа **лежит** (ноутбук проспал 8 часов).
3. Фотограф открывает Rate Setter → нажимает «Только изменения».
4. `_snCachedSnapshots` ещё содержит только A (realtime не докачал B).
5. `rsFillDeltaFromLatest` берёт A как baseline, сравнивает с текущим локальным состоянием (которое тоже устаревшее — на день старое).
6. Delta превращается в пустой список или содержит не те файлы. Пользователь проставляет рейтинги не туда.

**Где в коде:** `sync.js:288-301`. Нет явного `snLoadSnapshots()` перед `_rsFillDeltaFromCache()`; предполагается что кэш свежий.

### 2.5. Сломанный strip_tails / strip_extension в edge-cases

**Сценарий:**
- Имя файла: `IMG_0001.CR3 copy.jpg`. После `strip_extension` → `IMG_0001.CR3 copy`. После `strip_tail(" copy")` → `IMG_0001.CR3`. Пока ок.
- Но: `IMG_0001 copy 2.jpg`. После `strip_extension` → `IMG_0001 copy 2`. После `strip_tail(" copy")` — не матчится (суффикс " copy", а у нас " copy 2"). Результат: `IMG_0001 copy 2`. В индексе такого стема нет → `MISS`. Пользователь видит «файла нет», хотя исходник в Капче — `IMG_0001.CR3`.
- Имя с двумя расширениями и одной точкой: `IMG_0001.RAF.xmp` (Fuji). `strip_extension` снимет только `.xmp`. На выходе — `IMG_0001.RAF`. `CosRepository.build_index` индексирует по `Path(cos.stem).stem` — тоже двухуровневый strip. Но только если `.cos` назван `IMG_0001.RAF.cos`. Если фотограф переименовал фото → `.cos` не пересобран → MISS.

**Где в коде:** `rate_setter.py:17, 28-38`, `cos_repository.py:31`.

### 2.6. Back-pressure: нет лимита на длину stems

**Сценарий:**
- Rate Setter вызывается на 5000 стемов. `build_index()` идёт `rglob("*.cos")` по всей сессии (может быть 50k+ файлов). Потом в цикле по 5000 стемам. При 5000 update_rating (XML parse + write + .bak) на HDD — это минуты. UI кнопка дизейблена, но `onRateSetterDone` не вернётся долго. Пользователь думает, что всё зависло → закрывает приложение.
- Closing приложения прерывает thread. Часть `.cos` уже записана, часть нет. `onRateSetterDone` никогда не приходит. `rsSyncCompleted` не вызывается. Stage не продвинулся. Частично-записанное состояние = inconsistent.

**Где в коде:** `app_api.py:130-162`, `rate_setter.py:65-124`. Нет периодического чекпоинта, нет прогресс-bar с временем.

### 2.7. Offline/reconnect сценарий

**Сценарий:**
- Rate Setter отработал локально (офлайн). `rsSyncCompleted` падает молча (`sbSyncStage` вернёт network error в catch, но его нет в этой цепочке). Пользователь потом восстанавливает сеть и работает — stage_event о Rate Setter не создан никогда. Owner-dashboard через неделю считает, что этап не был сделан.

**Где в коде:** `sync.js:205-228`. Нет pending-queue (как для `sbLogAction` в `action_log`).

### 2.8. `rsSyncCompleted` нет идемпотентности

**Сценарий:**
- Rate Setter отработал. `onRateSetterDone` пришёл. `rsSyncCompleted` вызвался. Пользователь перезагрузил страницу до окончания INSERT (сеть тормозила). При следующем запуске автоматического re-sync может снова вызваться `rsSyncCompleted` (если кто-то привяжет к `PROJECT_LOAD`). В `stage_events` появятся два события «co_sync_done» с разницей во времени.

**Где в коде:** `sync.js:193-196`.

---

## 3. Исторические инциденты — что научило

### 3.1. [anchor client] data loss (2026-04-14)

- **Что было:** DELETE+INSERT race в `sbSyncCardsLight`. DELETE прошёл, INSERT завис. Auto-pull подтянул 0 карточек. Данные ушли.
- **Чему научило Rate Setter:**
  - **Любая двух-фазная операция без транзакции — кандидат на [anchor client].** `sbSyncStage` (UPDATE stage + INSERT stage_event) и `sbSelectPhotoVersion` (reset + set) — именно такие.
  - **Silent error → silent data loss.** `console.warn` вместо UI-уведомления — это мина.
  - **Pending-queue как паттерн спасения.** `sbFlushPendingLog` показал, что retry-очередь в localStorage работает; аналог нужен для sync-событий Rate Setter.
  - **Guard на пустое значение.** `save_cards_by_token` теперь отклоняет пустой array. Аналог для Rate Setter — отклонять пустой set stems.

### 3.2. [anchor client] cyrillic filenames (2026-04-15)

- **Что было:** Supabase Storage отклонил все 160 превью с именами вида `Солнце[anchor client]17774.jpg`.
- **Чему научило Rate Setter:**
  - **Любой пользовательский `photo_name` перед попаданием в Storage path → `sbSanitizeStorageKey`.** Когда реализуется R-01 (upload .cos в `postprod`), это must-have.
  - **`photo_versions.photo_name` оставить с cyrillic, путь в Storage — только ASCII.** Таблица хранит orig, bucket — sanitized. Маппинг — детерминистичный.
  - **Fast-path для ASCII остаётся.** Масса проектов Маши не должна деградировать.

### 3.3. `_shCloudSyncRunning` silent drop (2026-04-14 крашtest)

- **Что было:** 57 карточек подряд → первый sync в работе, остальные 56 выходили по флагу, не queue'ились, финальный re-trigger отсутствовал.
- **Чему научило Rate Setter:**
  - Rate Setter тоже имеет риск «запустили дважды подряд» (Маша нажала «Запуск» → пока thread работает, нажала снова). В текущем коде `rs-run-btn.disabled = true` защищает от UI-двойного клика, но не защищает от программных триггеров (если кто-то добавит `auto-sync`).
  - Нужен pending-flag вида `_rsPendingReRun` и `_rsFinishSync` — аналогично `shootings.js`.

---

## 4. Сводная карта таблиц и endpoints, затронутых в sync-процессе

| Таблица / Endpoint | Операция Rate Setter | Код | Миграция | Риск |
|---|---|---|---|---|
| `projects` | UPDATE stage, updated_at | `sbSyncStage:2772-2779` | baseline | R-02 |
| `stage_events` | INSERT | `sbSyncStage:2789` | 005/014/026 | R-02 |
| `snapshots` | INSERT | `snCreateSnapshot:3719` | 010 | R-02, R-03 |
| `photo_versions` | (должно быть) UPSERT | `sbSavePhotoVersion:3018` — **не вызывается** | proposed-030 | R-01 |
| Storage `postprod` | (должно быть) UPLOAD `.cos` | `sbUploadPostprodFile:3147` — **не вызывается** | manual bucket | R-01, R-05 |
| Storage `postprod` | (должно быть) UPLOAD preview.jpg | — | — | R-05 (если добавляем sanitize) |
| `action_log` | (не пишет) | `sbLogAction` — не вызывается из Rate Setter | 008 | Medium (нет аудита) |
| `cards` | не трогает | — | — | — |
| `slots` | не трогает | — | — | — |
| `articles` | не трогает (но должно бы — через keyword писать) | — | 018 | Block для ставки 4 |

---

## 5. Что из этого блокирует ставку 4 (KPI «zero manual re-sync к 2026-06-30»)

**Критические блокеры (без них KPI не достигается):**
- R-01 (COS round-trip) — sine qua non.
- R-02 (ошибки молчат) — без этого невозможно debug'ать R-01 в проде.
- R-04 (empty-stems guard) — если не поставить, после R-01 потеряется 10-15% пользователей в [anchor client]-подобных edge-case.

**Важные, но не-блокеры:**
- R-03 (delta race) — до 1–2 активных продакшенов, воспроизводится редко.
- R-05 (ASCII sanitize) — блокер сразу после R-01; в текущем коде безопасно, т.к. cos_path=''.
- R-06 (`.cos.bak` не rollback) — blocker для fault-recovery, но не для happy-path.

**Связь с другими лейнами:**
- **QA:** все 6 рисков требуют регрессионного теста (см. `rate-setter-sync-regression.md`).
- **CoS:** R-01 затрагивает storage bucket, Policy нужны до релиза.
- **CX:** [test user A] на [anchor client] — основной reg-tester. Её сессия должна покрывать R-01 before/after.
- **DAD:** UI-уведомления об ошибках (R-02) — нужна разметка от дизайнера, чтобы не сломать lay.

---

## 6. Нерешённые вопросы (для CoS-триажа)

- **OQ-RS-01:** Где storage bucket `postprod` физически создан? Есть ли уже policies? Требует Supabase MCP-проверки или ручного подтверждения Маши.
- **OQ-RS-02:** Применена ли в prod миграция `photo_versions`? Зависимость — раздел 3.1 audit-2026-04-23. До этого R-01 невозможно реализовать без риска rollback.
- **OQ-RS-03:** Нужен ли rollback механизм для `.cos` в облаке (удаление version N и возврат к N-1)? Если да — `sbDeletePhotoVersion` есть, но UI для него не известен.
- **OQ-RS-04:** Rate Setter должен ли писать ключевые слова в `.cos` (см. audit-2026-04-23.md:34)? Отдельный fix, не входит в R-01 scope.
- **OQ-RS-05:** Retry-policy в pending-queue — экспоненциальный back-off или фиксированный? Зависит от того, кто принимает решение (PA + Маша).

---

## 7. Оценка зрелости sync-лейера (по шкале стабильности)

| Критерий | Текущий уровень | Целевой (к 2026-06-30) |
|---|---|---|
| Идемпотентность | Низкая (двойной клик возможен) | Высокая (de-dup по stage_event + version_num) |
| Транзакционность | Нет (двух-фазные UPDATE+INSERT) | Где возможно — RPC с SQL-транзакцией |
| Observability (логи/метрики) | Console.warn, локально | stage_events как аудит + Sentry (optional Q3) |
| Error-surface в UI | Только на критических | На всех failed sync'ах |
| Offline-resilience | Нет | Pending-queue в localStorage, flush при reconnect |
| Round-trip coverage | 0% (только локально) | 100% (.cos в bucket, realtime distribute) |
| Test-coverage | 0% (нет тестов) | Smoke E2E + 10-15 regression сценариев |

---

## 8. Следующие шаги (как ведущий документ)

1. Review fixes-proposal (`rate-setter-sync-fixes-proposal-2026-04-23.md`) с Машей.
2. Согласовать приоритеты R-01 → R-02 → R-04 → R-03 → R-05 → R-06.
3. После merge `photo_versions` миграции (audit R1) — открыть ADR на COS round-trip.
4. QA — взять `rate-setter-sync-regression.md` test plan как основу Playwright-реализации.
5. DAD — нарисовать UX для error-toast'ов (R-02 фикс требует UI).

---

**Source of truth этого документа:** `v2/frontend/js/sync.js` и `v2/frontend/js/supabase.js` на дату 2026-04-23, `docs/agents/dev/audit-2026-04-23.md` разделы 1.2 и 4, reconciliation audit 2026-04-23.
