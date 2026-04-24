# QA — Тактическая стратегия Q2 2026

**Дата:** 2026-04-23
**Автор:** QA / Test Engineer (Phase 5 — тактика Q2)
**Period:** 2026-04-28 → 2026-07-20 (12 недель, с перехлёстом в начало Q3)
**Source of truth:** `strategy-2026.md` (Ставка 4 + Риск Р4), `docs/agents/qa/audit-2026-04-23.md`, `docs/agents/qa/understanding-2026-04-23.md`, `docs/agents/dev/photo_versions-migration-proposal.md`, 21 решение Маши по baseline от 2026-04-23.

---

## 1. TL;DR

QA-лейн в Q2 строится с нуля под одну главную цель — не допустить регрессий в «продаваемом ядре» Ставки 4 (автопереименование, Rate Setter sync, share-link, канал-адаптация, owner-dashboard). Масштаб усилий зафиксирован решением Маши: опция **c** — 10+ часов в спринт на автотесты, Playwright/Cypress в CI с blocking gate, плюс advisory-слой от Chrome-agent. Это не идеальная test pyramid, а тактический выбор: автотесты ловят регрессии, реальные тестеры ([test user A] + будущие) ловят новое.

Первые три недели — расчистка блокера `photo_versions` совместно с PA, setup Playwright и первый smoke-suite под share-link и автопереименование. К концу мая — regression-suite под Rate Setter sync закрыт и работает в CI как blocking gate. К концу Q2 — Chrome-agent прогоняется daily + weekly full-cycle на Машином снапшоте, `/bugs/` процесс с CX финализирован, release review gate запущен. Release cadence — continuous: QA green = релиз идёт в прод.

Критических зависимостей от Маши три: acceptance criteria по customer-facing фичам (по 15 мин на каждую), снапшот тестового проекта до 10 мая и решение по спорным багам по факту.

---

## 2. Goal alignment — как QA обеспечивает Ставку 4

**Ставка 4 (strategy-2026.md:108-134)** — стабилизация продаваемого ядра. Маша явно жертвует функциями ради надёжности. Для QA это значит: моя работа — не ловить максимум багов, а защитить четыре блока от ломания при каждом цикле PA-разработки. Переводя в метрики:

- **Rate Setter sync** (Critical, strategy-2026.md:18, :115). Zero ручных пересинхронизаций к 2026-06-30 — KPI Ставки 4. QA обеспечивает это через regression-suite в CI, который блокирует merge при любом расхождении COS ↔ облако на тест-корпусе.
- **Автопереименование** (приоритет №1 по решению Маши). Хук для Ставки 5 (photographer-led motion). QA обеспечивает через test plan + автотесты по S1-S5 и E1-E7 из аудита раздел 2.
- **Share-link** (вход клиента в проект без логина). Если сломан — разрушается demo и onboarding в Ставке 3. QA обеспечивает через smoke-suite на каждом релизе.
- **Channel adaptation** (Q3 демо-готово) — test plans подготовлены в Q2, но сами тесты активируются, когда PA выдаст MVP.
- **Owner-dashboard** (Q3 MVP) — те же условия, тесты на data integrity готовлю заранее.

Связь с Риском Р4 «Rate Setter sync не закрывается к концу Q2»: именно QA-суита делает возможной уверенность PA «можно релизить». Без неё Маша вынуждена ручками прогонять 10-минутный чек-лист каждый раз — это bottleneck уже сегодня.

---

## 3. 12-недельный план (апрель — июль)

### Неделя 1: 28 апреля — 4 мая

**Тема недели:** разблокировка + setup.

- **photo_versions blocker закрыт совместно с PA.** PA прогоняет 4 SQL-проверки из `docs/agents/dev/photo_versions-migration-proposal.md` раздел 4.5-a/c/d через MCP. QA проверяет результаты, совместно с PA принимает решение по сценариям A/B/C. Если A — применяем миграцию на staging-ветку Supabase. Дедлайн по аудиту PA — 2026-04-30.
- **Playwright setup в CI.** Выбор между Playwright и Cypress решён в пользу Playwright (desktop + браузер, dual-mode поддержка). Установка `@playwright/test`, настройка `playwright.config.ts`, первый прогон локально, выход в GitHub Actions через workflow на `push` в main. Blocking gate конфигурируется, но включается в режиме `continue-on-error: true` до окончания W3 — чтобы разобрать flaky-тесты.
- **Первый smoke-suite: 2 теста.** (1) Share-link — открытие проекта по ссылке без логина, видимость карточек с фото. (2) Автопереименование happy path — загрузка 5 фото, прогон через Rate Setter, переименование по артикулам.
- **Chrome-agent фикстура.** Запрос Маше: снапшот её тестового проекта (не [test user A] — её данные) в формате экспорта Supabase проекта. Создаётся bucket `test-fixtures` с версионированием, подключается как golden-dataset для Chrome-agent. Дедлайн Маши — 10 мая (см. раздел 5).

**Выход недели:** `photo_versions` миграция применена на staging. Playwright локально запускается. Первые 2 smoke-теста есть.

### Недели 2-3: 5 — 18 мая

**Тема:** Rate Setter sync regression-suite ([anchor client]-class protection).

- **10-тестовый regression-suite Rate Setter sync.** Покрывает invariants I1-I7 из аудита раздел 3.1. Структура:
  - I1/I2: rating → COS + облако в срок (2 теста).
  - I3: keyword → COS (1 тест).
  - I4: photo ID сохраняется через rename (1 тест).
  - I5: retry queue после сетевого обрыва (1 тест).
  - I6: last-write-wins на конфликте (1 тест).
  - I7: soft-delete + restore (1 тест).
  - Cyrillic filename через `sbSanitizeStorageKey` (1 тест) — регрессия [anchor client] 15.04.
  - COS ↔ cloud diff на 50 фото (1 тест) — общая consistency проверка.
  - Bi-directional sync desktop ↔ web (1 тест).
- **Автопереименование end-to-end.** Развитие smoke-теста W1: все 5 сценариев S1-S5 + 7 edge cases E1-E7 из аудита раздел 2. Итого 12 автотестов для автопереименования.
- **CI gate включён как blocking.** С 18 мая Playwright-фейлы блокируют merge в main. PA выставляет `status:blocked` в `/dev/status.md`, QA возвращает релиз через `/tasks/dev/qa-return-<date>.md` (rule T-07).
- **Первый release review по полной.** Когда PA готовит релиз с Rate Setter sync фиксами — QA прогоняет полный regression + выставляет status card approve/block.

**Выход недель:** 22 автотеста в CI, Rate Setter sync защищён от регрессий, автопереименование покрыто по всем сценариям из аудита.

### Недели 4-6: 19 мая — 8 июня

**Тема:** Chrome-agent golden-path + `/bugs/` процесс с CX.

- **Chrome-agent golden-path scripts.** 3-5 сценариев на снапшоте Машиного проекта:
  - GP-1: full-cycle пайплайн — upload → rate → артикулы → rename → share → отбор клиента → retouch → final. Раз в неделю (weekly full-cycle).
  - GP-2: share-link flow — создание ссылки → открытие в incognito → проверка видимости карточек. Daily утром.
  - GP-3: автопереименование — загрузка тест-корпуса, прогон rate setter, проверка имён. Daily днём.
  - GP-4: Rate Setter sync sanity — 5 рейтингов, keywords, проверка COS + облака. Daily вечером.
  - GP-5: owner-dashboard smoke — открыть dashboard, проверить, что цифры совпадают с проектом. Daily вечером (активируется, когда PA выдаст MVP).
- **Daily runs начались.** Расписание через GitHub Actions cron (`0 9 * * *`, `0 14 * * *`, `0 19 * * *` MSK). Weekly full-cycle — каждый понедельник 10:00 MSK. Отчёт автоматически падает в `/qa/chrome-agent/YYYY-MM-DD.md`.
- **Bug process с CX финализирован.** Создан `/bugs/` шаблон, теги по аудиту раздел 7.2, SLA таблица согласована с CX-лейном. Первый тестовый инцидент прогнан через rule T-01: от [test user A] → CX → пауза → QA воспроизведение → PA fix → QA verify → снятие паузы. Документирован в `/qa/releases/t01-dry-run-YYYY-MM-DD.md`.
- **Pre-release checklist финализирован.** Шаблон из аудита раздел 6 превращается в `/qa/releases/_template.md` с 25-30 пунктами, подсвечены блокирующие vs. warning.
- **Release review status card.** Один экран, формат: scope, regression status, smoke status, edge cases covered, known issues, approve/block/partial. Добавлен в `_template.md`.

**Выход недель:** Chrome-agent прогоняет daily + weekly full-cycle. `/bugs/` живой, хотя бы один реальный инцидент прошёл через полный loop. Pre-release checklist применяется к каждому релизу.

### Недели 7-9: 9 — 29 июня

**Тема:** Channel adaptation regression + owner-dashboard testing.

- **Channel adaptation test plan → автотесты.** Когда PA выдаст MVP (по графику Q3 демо-готово, но первый прогон может быть в июне) — активируются тесты из аудита раздел 4.1: CA1-CA6. Первые 6 автотестов. Фокус — строгое соответствие спецификации канала (размер, формат, цветовой профиль).
- **Owner-dashboard testing.** По аудиту раздел 5 — тесты OD1-OD6. Ключевой — OD1 data integrity: dashboard vs source-of-truth. При любом расхождении — block релиз. Автотесты: 6 штук (некоторые комбинируются — например, realtime update через WebSocket).
- **Расширение Chrome-agent.** Добавить GP-5 (owner-dashboard smoke) в daily rotation, когда dashboard MVP выкатится.
- **Второй release review gate кейс.** Прогон review на крупном релизе (Rate Setter sync final или channel adaptation MVP). Цель — отработать процесс «QA почти всегда активируется, всегда хотя бы базовое sanity».

**Выход недель:** channel adaptation + dashboard покрыты автотестами при наличии MVP от PA. Release review gate отработан минимум 2 раза. Bug-процесс через CX работает без разногласий.

### Недели 10-12: 30 июня — 20 июля

**Тема:** maturation + retrospective.

- **Расширение покрытия.** Добавление edge cases, которые всплыли за Q2. Цель — покрытие не «всех сценариев», а «всех сценариев, которые могут сломаться при следующем цикле PA».
- **Retrospective на bug stats.** Подсчёт: сколько багов поймали автотесты, сколько — Chrome-agent, сколько — [test user A], сколько — Маша сама. Это даёт эмпирическую калибровку формулы «автотесты для регрессий, люди для нового». При дисбалансе (например, автотесты поймали 80%, [test user A] 10%) — пересмотр приоритизации test coverage.
- **Q3 roadmap финализирован.** На базе retrospective — план Q3: расширение автотестов на mobile web (когда появится), load testing на проекте 500+ фото, возможно интеграция с Storybook для компонентных тестов. Документируется в `q3-tactical-strategy-YYYY-MM-DD.md`.
- **Release cadence стабилизирована.** Continuous-модель работает: каждый merge в main проходит regression, зелёный билд идёт в прод. Известные исключения (hotfix, пауза бета-потока) документированы.

**Выход недель:** QA-лейн в штатном режиме. Retrospective зафиксирована. Q3 план готов.

---

## 4. Конкретные deliverables Q2

| Deliverable | Путь | Готовность |
|---|---|---|
| Playwright setup в CI | `v2/tests/playwright.config.ts`, `.github/workflows/qa.yml` | W1 |
| Первые 5-7 smoke-тестов | `v2/tests/smoke/*.spec.ts` | W1-W2 |
| Rate Setter sync regression-suite (10-15 тестов) | `v2/tests/regression/rate-setter-sync.spec.ts` + `/qa/regression/rate-setter-sync.md` | W3 |
| Автопереименование test plan + автотесты | `v2/tests/features/auto-renaming.spec.ts` + `/qa/test-plans/auto-renaming.md` | W3 |
| Share-link access tests | `v2/tests/features/share-link.spec.ts` | W2 |
| Chrome-agent golden-path scripts (3-5 сценариев) | `/qa/chrome-agent/scripts/GP-1..GP-5.md` | W4-W6 |
| `/bugs/` процесс с CX (формат, теги, SLA) | `/bugs/README.md` + `/qa/bug-process.md` | W5 |
| Pre-release checklist (25-30 пунктов) | `/qa/releases/_template.md` | W6 |
| Release review status card template | встроен в `_template.md` | W6 |
| Channel adaptation тесты (6 штук) | `v2/tests/features/channel-adaptation.spec.ts` | W7-W9 (завязано на PA MVP) |
| Owner-dashboard тесты (6 штук) | `v2/tests/features/owner-dashboard.spec.ts` | W7-W9 (завязано на PA MVP) |
| Q2 retrospective + Q3 roadmap | `/qa/retrospective-Q2-2026.md`, `q3-tactical-strategy-YYYY-MM-DD.md` | W12 |

Итого на конец Q2 — около 35-40 автотестов в CI, Chrome-agent golden path с 3-5 сценариями daily, `/bugs/` процесс live, release review gate применён минимум 2 раза.

---

## 5. Что требует Машу

Минимально, но критично. Каждый пункт — с дедлайном и оценкой времени.

### 5.1. Acceptance criteria по customer-facing фичам

Маша — owner по customer-facing фичам (решение 2026-04-23). По operational фичам owner — CoS. Customer-facing список: автопереименование, share-link, owner-dashboard. Формат — по 15 минут на каждую:

1. Что видит клиент/фотограф при happy path (1-2 строки).
2. Что недопустимо (1-2 строки, чёткие negative-кейсы).
3. Как понять, что фича сломана (1-2 строки, наблюдаемый сигнал).

Запись — в `/qa/acceptance-criteria/<feature>.md`. Дедлайны:

- **Автопереименование AC** — к 2026-05-10 (до того, как W2-3 регрессия-suite финализируется).
- **Share-link AC** — к 2026-05-05 (W1 smoke-тест зависит).
- **Owner-dashboard AC** — к 2026-06-15 (до начала W7-9, с запасом на обсуждение).

### 5.2. Снапшот тестового проекта для Chrome-agent

**Дедлайн: 2026-05-10.** Формат — экспорт из Supabase (через Dashboard → Export) + папка с исходниками фото. Не [test user A]-проект (риск задеть прод), а Машин собственный на реальной съёмке. Минимальный состав: 1 проект, 2-3 карточки, 15-20 фото, prepared артикулы, как минимум одна карточка в статусе `matched`. Этот снапшот становится golden-dataset для Chrome-agent — его не меняем, Chrome-agent прогоняет каждый день против свежей копии.

Если Маша не успевает к 10 мая — fallback: сгенерированный синтетический датасет без кириллицы. Покрывает happy path, но пропускает edge cases (incident [anchor client] 15.04).

### 5.3. Решения по acceptance criteria спорных багов

По факту — когда баг всплывает, severity не очевидна, и CX + QA не могут сами согласовать, это блокер или known issue. Ожидаемая частота — 1-2 раза в Q2. Формат: текстовое сообщение «Это блокер, жду фикса» или «Это known issue, отпускаем». 5 минут, не 15.

---

## 6. Release review gate — роль QA

### 6.1. Когда активируется

**По умолчанию — активируюсь всегда.** Решение Маши 2026-04-23: release review dynamic, QA обязателен почти во всех релизах для базового sanity. Исключения — hotfix без изменений в core (автопереименование, Rate Setter sync, share-link). Решение о скипе принимает CoS, не PA.

Trigger: PA пишет в `/qa/status.md` release-candidate announcement с перечнем изменённых файлов и затронутых сценариев. В этот момент я переключаюсь из standby в active.

### 6.2. Что ревьюю

Единый чек-лист на каждый релиз:

1. **Regression clean.** Playwright CI-прогон весь зелёный. Если красный — block.
2. **Smoke-test passed.** 5-7 базовых сценариев (share-link, rename, rate setter sync basic, upload photo, login/logout). Ручной прогон в 10 минут.
3. **Edge cases проверены.** Если релиз трогает область, покрытую edge cases (например, rename — значит E1-E7), — прогнать их все. Если не трогает — пропустить.
4. **[test user A]-флоу imagery.** Имитация полного цикла [anchor client] на staging. Критерий — не сломалось ни одно действие, которое [test user A] делает каждый день.
5. **[anchor client]-class invariants.** Soft-delete работает, anti-wipe guards активны, sbSanitizeStorageKey покрыт.
6. **Chrome-agent последний daily прогон green.** Если красный за последние 24 часа и не воспроизведено на тест-corpus — block до объяснения.
7. **Data integrity.** `photo_versions` orphan = 0, COS ↔ cloud diff на тест-корпусе = 0.
8. **PA commit log vs scope announcement.** Нет ли расширения скоупа «втихую» — PA обязан заявить все изменения.

Всё это помещается в release review status card (один экран).

### 6.3. Status card — approve / block / partial

Шаблон добавлен в `/qa/releases/_template.md`:

```
## Release review status card — <release>
Дата: YYYY-MM-DD
QA: Claude (QA-лейн)

Regression: pass / fail (N tests failed: ...)
Smoke: pass / fail (N scenarios failed: ...)
Edge cases: n/a / pass / partial (N of M)
[test user A]-флоу: pass / fail
[anchor client] invariants: pass / fail
Chrome-agent daily: green / red (reason: ...)
Data integrity: pass / fail

Verdict: APPROVE / BLOCK / PARTIAL
Reason: <1-2 строки>
Known issues to log: <список или пусто>
```

- **Approve** — релиз идёт в прод в рамках continuous cadence.
- **Block** — релиз откладывается, PA получает `/tasks/dev/qa-return-<date>.md` с деталями, CoS уведомлён.
- **Partial** — обсуждается с CoS + Машей совместно: известная проблема допустима или блокер.

Цель Q2 — минимум 2 раза закрыть релиз через block, чтобы gate работал не формально.

---

## 7. Handoffs

### 7.1. С PA (Product Architect)

Формат — `/qa/status.md` + `/tasks/dev/`.

- **PA → QA:** release-candidate announcement с:
  - Список изменённых файлов (`v2/backend/...`, `v2/frontend/...`).
  - Затронутые сценарии («переписал `renamePhotoBatch`, затрагивает автопереименование и COS-write»).
  - Ссылка на коммит и ADR (если был).
  - Дополнительный smoke-запрос (если PA хочет быстрый ручной тест конкретного сценария).
- **QA → PA:** release verdict — approve в `/qa/releases/YYYY-MM-DD-<feature>.md` или block через `/tasks/dev/qa-return-<date>.md` с шагами воспроизведения.
- **PA → QA proactive:** при крупном рефакторинге sync-лейера — ADR + запрос на расширение regression-suite до merge. Не «после релиза узнали, что сломалось».

### 7.2. С CX (Client Experience)

Формат — `/bugs/YYYY-MM-DD.md`, ownership файла у CX.

- **CX → QA:** баг-репорт от [test user A]/клиентов с тегами `from:*`, `severity:*`, `area:*`, `status:open`. SLA по severity — таблица из аудита раздел 7.3.
- **QA → CX:** воспроизведение на staging, шаги в том же bug-файле, перевод `status:open` → `status:verified-bug` или `status:cannot-reproduce`.
- **QA ↔ CX triage.** Severity проставляет CX (ближе к клиенту), QA утверждает при воспроизведении. Разногласия — к Маше (раздел 5.3).
- **После fix:** PA ставит `status:fixed`, QA verify → `status:verified`, CX сообщает клиенту, CoS снимает паузу бета-потока.

### 7.3. С DAD (Design / Art Director)

Формат — `/design/status.md` + spec в `/design/specs/`.

- **DAD → QA:** design spec с visual acceptance criteria для UI-фичи. Нужны контрольные точки («кнопка sync в верхнем правом углу», «modal перекрывает fond, не tooltip»).
- **QA → DAD:** при visual regression — screenshot-дифф в `/qa/visual/YYYY-MM-DD-<feature>.md` + алерт DAD. Visual regression не блокирует релиз автоматически (решение DAD + Маши).

### 7.4. С GS (Growth Strategist)

Формат — `/growth/status.md` + outbound plan.

- **GS → QA:** announcement outbound-волны с перечнем фич, которые будут демонстрироваться. За 48 часов до волны.
- **QA → GS:** smoke-pass на демо-сценариях. Если smoke fail — GS откладывает волну (приоритет stability > outbound). Сценарий: «пошёл outbound на фотографов с хуком автопереименования, а фича сломана» — неприемлем.

### 7.5. С CoS (Chief of Staff)

Формат — `/cos/status.md` + эскалация по email/чат при severity:critical.

- **QA → CoS:** эскалация при серьёзном блокере (photo_versions не применяется, PA не отвечает 48 часов на critical bug, infrastructure outage). CoS активирует cross-lane coordination.
- **CoS → QA:** решение по partial release, утверждение изменений pre-release checklist, operational acceptance criteria (review от CoS по operational фичам).

---

## 8. Risk register

Top-5 рисков QA-лейна на Q2.

### R1. photo_versions blocker не закрывается к 30 апреля

**Вероятность:** низкая (у PA есть чёткий proposal с 4 SQL-проверками и рекомендуемым порядком). **Impact:** высокий — staging не работает, regression-suite невозможно прогнать на чистом окружении, автотесты работают только на prod (риск второго [anchor client]).

**Митигация.** В W1 QA пишет PA'у явный ping — просит результаты 4 SQL-проверок до 29 апреля. Если PA не успевает — эскалация в CoS 30 апреля. План B: запуск первых тестов на prod-read-only (SELECT запросы, без INSERT/UPDATE), задержка Rate Setter sync regression до staging готов.

### R2. Playwright setup занимает больше времени, чем запланировано

**Вероятность:** средняя (dual-mode desktop + браузер, pywebview имеет особенности, CI на GitHub Actions не всегда стабилен). **Impact:** средний — сдвиг всех последующих недель на 3-5 дней.

**Митигация.** W1 делать setup локально, не сразу в CI — проверить, что framework работает. GitHub Actions — во вторую очередь. Если задержка очевидна к 3 мая — переписать план недель 2-3 с приоритетом на ручной regression-suite, автоматизация догоняет в W4-6.

### R3. Chrome-agent токены подросли, scheduled runs надо урезать

**Вероятность:** средняя (Chrome-agent на full-cycle сценарии может жрать 20-50k токенов, daily × 3 = 100k+ в день). **Impact:** средний — снижение частоты daily до 1 раза в день или пропуск full-cycle weekly.

**Митигация.** W4-6 — замер фактического токен-consumption. Если бюджет нарушен — приоритизация: daily только GP-2 (share-link) и GP-3 (rename), GP-1 weekly оставляем обязательно. GP-4 и GP-5 перевести на trigger — запускать только при PA-коммите в core.

### R4. [test user A] перестаёт давать feedback

**Вероятность:** средняя (один человек, много своей работы, может пропадать на 1-2 недели). **Impact:** высокий — теряется единственный канал «новых багов». Автотесты + Chrome-agent ловят регрессии, но не новые сценарии.

**Митигация.** Этот риск — не в моём лейне (Tester Relations у CX), но он меня касается. Если [test user A] молчит >7 дней — QA пишет CX: «нужен proactive-ping или расширение тест-базы». План B: Маша сама как тестер на собственных съёмках + открыть open-list 2-3 ранних фотографов через GS на выходе W6.

### R5. PA релизы приходят пачками, QA не успевает

**Вероятность:** низкая-средняя (Маша + PA работают в continuous cadence, но могут накопить 3-4 готовых фичи к концу W6 и засыпать сразу). **Impact:** средний — QA становится bottleneck, release cadence нарушается.

**Митигация.** Continuous cadence означает: каждый merge в main — это потенциальный релиз. Если PA пытается объединить 3 фичи в один релиз — QA просит разделить (один релиз = одна фича или связная группа). Pre-release checklist масштабируется плохо: 25-30 пунктов × 3 фичи = 90 минут ручной работы.

---

## 9. Success criteria Q2

Измеряемые KPI, проверяются на Q2 retrospective (W12, конец июня):

1. **Rate Setter sync zero regressions с автотестами в продакшене.** 10-15 автотестов в CI, каждый merge проходит через них, 0 расхождений COS ↔ облако на тест-corpus за всю квартал. Если ≥1 регрессия — анализ root cause, расширение suite.
2. **Автопереименование stable — 95%+ success rate на happy path.** Замер на реальных съёмках Маши и [anchor client]. 95% означает: из 20 прогонов переименования 19 прошли без вмешательства, 1 имел minor issue (пропущенный алерт, медленная синхронизация). 0 случаев silent data loss.
3. **Daily Chrome-agent runs с full-cycle workflow.** Минимум 3 golden path сценария daily + 1 weekly full-cycle. Отчёты в `/qa/chrome-agent/` накапливаются, retrospective показывает accuracy (сколько багов поймано vs. сколько false positive).
4. **`/bugs/` процесс работает.** Минимум 3 реальных бага прошли полный loop T-01 ([test user A] → CX → QA → PA → QA verify → CX communicate → CoS unpause). Замер: средний time-to-verify < 4 часов для high severity, <24 часов для medium.
5. **Release review gate закрывает релиз 2+ раз за Q2.** Не для галочки — реальные случаи, когда `BLOCK` verdict спас регрессию. Это proof, что gate работает как фильтр, а не как формальность.

Дополнительные (не обязательные, но желательные):

- Pre-release checklist применён к ≥8 релизам.
- Release cadence continuous: ≥12 релизов за Q2 (минимум 1 в неделю в среднем).
- 0 инцидентов уровня [anchor client] data loss (strategy-2026.md:200).

---

## 10. Q3 roadmap

В Q3 (июль-сентябрь) QA-лейн расширяется по трём направлениям:

### 10.1. Расширение автотестов

- **Channel adaptation full coverage.** По мере MVP → прод (strategy-2026.md:117, демо-готово Q3, прод Q4). Дополнительные 10-15 тестов: строгое соответствие спецификации WB, Ozon, сайт. Атомарность экспорта (rule: либо все карточки, либо алерт).
- **Owner-dashboard full coverage.** MVP выкатывается в Q3 (strategy-2026.md:118). Тесты OD1-OD6 → расширение на realtime обновление, SLA-метрики, data integrity при соавторах.
- **Mobile client tests** (если появится к Q3). Из memory `project_mobile_client.md` — card feed carousel + gallery. Playwright has mobile viewport support.

### 10.2. Load testing

- **Проект 500+ фото.** Из аудита раздел 5.1 OD5 — acceptance criteria «dashboard < 3 секунд». В Q3 масштабируем на реальные проекты уровня [anchor client] (может быть 500-1000 фото в одной съёмке). Playwright + K6 для генерации нагрузки.
- **Параллельные пользователи.** Пилот Беларуси стартует в сентябре (strategy-2026.md:97) — новое окружение, потенциально 2-3 одновременных активных клиента на одном проекте. Тесты race conditions.
- **Storage bucket stress.** Upload 100+ фото в batch, проверка sanitize на полном objekt-space.

### 10.3. Process maturation

- **Storybook для компонентов** (если DAD подтвердит необходимость). Компонентные тесты снимают часть нагрузки с E2E.
- **Visual regression** (Percy или Chromatic). Для лендинга и ключевых UI-экранов.
- **Accessibility audit** (skill `design:accessibility-review`). WCAG 2.1 AA для клиентского UI — photographer-led motion требует работать и на старых компьютерах фотографов.

Q3 roadmap финализируется в W12 Q2 на retrospective — на базе фактических bug stats и понимания, где реально тонко.

---

## Отчёт

**Путь:** `docs/agents/qa/q2-tactical-strategy-2026-04-23.md`.

**Топ-3 приоритета первых 2 недель (28 апреля — 11 мая):**

1. **photo_versions blocker закрыт до 30 апреля.** Без миграции на staging regression-suite — это прод-тесты, риск второго [anchor client]. Совместная работа с PA на 4 SQL-проверках и apply на staging-ветку.
2. **Playwright setup + первые 5 smoke-тестов в CI.** К 11 мая blocking gate включён в `continue-on-error: true` режиме, 5 тестов зелёные локально и на CI. Share-link, автопереименование happy path, upload, login, Rate Setter sync basic.
3. **Получить от Маши снапшот тестового проекта и acceptance criteria по share-link.** Снапшот — фундамент для Chrome-agent фикстуры (дедлайн 10 мая). AC по share-link — фундамент для первого smoke-теста (нужен к 5 мая).

**Топ-3 acceptance criteria, которые нужны от Маши к середине мая (до 2026-05-15):**

1. **Share-link AC** (дедлайн 5 мая) — что клиент видит при открытии ссылки без логина, когда ссылка считается «работающей», когда «сломанной». 15 минут.
2. **Автопереименование AC** (дедлайн 10 мая) — что значит «переименование прошло успешно» с точки зрения клиента/фотографа, какой единственный negative-кейс абсолютно недопустим (кандидат — silent data loss), как наблюдаемо понять поломку. 15 минут.
3. **Rate Setter sync AC operational-sanity** (дедлайн 15 мая) — не самой фичи (это ясно из аудита), а того, что значит «операционно прошло» для Маши как пользователя: «открыл COS — рейтинг там». Это AC нужна для release review status card.

Готово к активации при первом release-candidate от PA.
