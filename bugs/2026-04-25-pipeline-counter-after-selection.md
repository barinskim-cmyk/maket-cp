---
id: BUG-2026-002
date: 2026-04-25
reporter: Masha
severity: medium
area: pipeline
status: fixed
source: live-test
---

## Summary
В pipeline-карточке проекта после завершения этапа «Отбор клиента» все
последующие этапы (ЦК, ретушь и далее) и нижняя строка «Масштаб» считаются
от полного числа превью, а не от количества фото, которые клиент отобрал
в работу. Это вводит в заблуждение: владелец видит «Цветокоррекция: 453 на
этапе» даже если клиент оставил, например, 134 фото.

## Steps to reproduce
1. Открыть проект с `proj.previews.length = 453` и заполненными карточками
   (в `proj.cards[*].slots[*].file` упоминаются ~134 уникальных файла).
2. Завершить этап «Отбор клиента» (триггер `client_approved` →
   `shClientApprove()` в `v2/frontend/js/shootings.js`). Все фото в текущей
   реализации перемещаются на стадию 3 (ЦК).
3. Перейти на pipeline-вью проекта (`renderPipeline`).

## Expected
- Этап «Отбор клиента» (done) — `selected/total_preview`, например `134/453`.
- Этап «Цветокоррекция» (active) — `134 на этапе` (новый knownLowerBound от
  отобранных, а не от исходного объёма превью).
- Нижняя строка масштаба — `Масштаб: 134 фото (из 453 превью)`.

## Actual
- Этап «Цветокоррекция» (active) — `453 на этапе`.
- Нижняя строка — `Масштаб: 453 фото`, без указания исходного объёма
  превью.

## Impact
- Затронуты все проекты, где этап «Отбор клиента» закрыт.
- Потери данных нет — это исключительно проблема представления.
- Workaround: не показывать счётчик — нерелевантно (числа уже видны).
- Бета-онбординг не блокирует.

## Logs / attachments
- Скриншоты Маши:
  `agent/.../uploads/019dc3da-...20260425__01.55.03.png` (галерея 106 фото)
  `agent/.../uploads/019dc3da-...20260425__01.55.09.png`
  (Pipeline: «Отбор клиента 453/453», «Цветокоррекция 453 на этапе»,
  «Масштаб: 453 фото»).

## Timeline
- 2026-04-25 01:55 — reported by Masha
- 2026-04-25 12:30 — in-progress by PA (Claude)
- 2026-04-25 13:10 — fixed (v1), commit `531b8eb` —
  `fix(pipeline): post-selection stages count from selected, not preview`
- 2026-04-25 13:40 — reopened by Masha: «Отбор клиента» всё ещё показывает
  `453/453` (cum == passedTeam после массового advance, числитель не менялся).
- 2026-04-25 13:55 — fixed (v2), commit `269cf11` —
  `fix(pipeline): client done shows selectedCount/passedTeam, not cum/passedPreselect`

## Resolution
**Root cause.** `shCumulativeMetrics()` (в `v2/frontend/js/shootings.js`)
определял «Масштаб» как `cumulative[0]` (фото с `_stage > 0`, т.е. прошедшие
преотбор). После `shClientApprove()` все 453 фото переезжают на стадию 3,
поэтому `cumulative[0]` возвращал 453 — вне зависимости от того, сколько
из них на самом деле отобрал клиент.

Знаменатель для всех этапов после нулевого был `metrics.scale` — и для
«Цветокоррекции» это давало `cum/453`, а активный счётчик брал
`photoCounts[i]` напрямую (после массового advance также 453).

**Fix.** В `v2/frontend/js/shootings.js`:

1. Добавлен helper `shSelectedCount(proj)` — кол-во уникальных
   `slot.file` в `proj.cards[*].slots[*]`. Это «selected count» —
   фактическое число фото, помещённых в карточки, по which клиент работает
   после отбора.
2. `shCumulativeMetrics()` расширен:
   - вычисляет `selectedCount`,
   - определяет `clientStageDone` по `_stageHistory['client_approved']`
     (или по факту опустевшего стэйджа `client` при наличии фото дальше),
   - переопределяет `scale`:
     - до отбора клиента — `passedPreselect` (как раньше),
     - после отбора — `selectedCount` (fallback на `passedClient`,
       а затем `passedPreselect`, если карточки ещё не заполнены).
3. `renderPipeline()` использует разные знаменатели:
   - стадия 0 (преотбор) done — `cum/potential` (без изменений),
   - стадии 1..clientStageIndex (отбор команды, отбор клиента) done —
     `cum/passedPreselect`,
   - стадии > clientStageIndex (ЦК и далее) done —
     `cum/scale` (после отбора `scale = selectedCount`).
4. Активный счётчик «N на этапе» на пост-клиентских стадиях клампится
   к `metrics.scale`, если `cnt > scale` (защита от данных, где
   все фото механически переехали вперёд без партиальной фильтрации).

**Follow-up fix v2 (commit `269cf11`):** v1 поменял знаменатель и активные
счётчики, но числитель для done-стадии «Отбор клиента» оставался `cum =
cumulative[2] = passedTeam`, что после массового advance всех фото равно
`passedPreselect` — и снова получалось `453/453`. v2 переопределяет
числитель и знаменатель именно для стадии client done:

- numerator = `selectedCount` (фото в карточках) если `clientStageDone`
  и `selectedCount > 0`; иначе fallback на `cum`
- denominator = `passedTeam` (фото, прошедшие team selection); если team
  не использовался, `passedTeam == passedPreselect`, и формула даёт
  `selectedCount/passedPreselect` = `134/453` по концепции Маши.

Также `shCumulativeMetrics()` теперь экспортирует `passedTeam`,
`passedClient`, `teamStageIndex` для удобства.

**Регрессия покрыта тестом:** TODO — добавить unit-тест на
`shCumulativeMetrics()` (test pending). Сделана ручная проверка в Node
через изолированный harness (3 сценария после v2: Маша's кейс,
team-used кейс, client-not-done кейс — см. секцию Tests ниже).

**Что ещё потенциально затронуто.** Логика `shClientApprove()`
по-прежнему перемещает ВСЕ фото на стадию 3 — это требует отдельного
фикса: только отобранные фото (по `slot.file`) должны переходить на ЦК.
До тех пор display-логика клампит активный счётчик к `scale`, чтобы не
показывать инфлированное число.

### Tests (manual harness)
**v1 (метрика scale):**
1. До отбора, все на стадии 0 → `scale=0`, `potential=5`.
2. До отбора, преотбор пройден → `scale=passedPreselect=5` (legacy).
3. Пост-отбор, все 5 advanced на стадию 3, 3 в карточках →
   `scale=3` (selectedCount), `clientStageDone=true`. ✓
4. Пост-отбор, partial advance → `scale=3`.
5. Пост-отбор, 0 selected → fallback на `passedClient`.
6. Пустой проект → `scale=0`.

**v2 (per-stage display, точные числа):**
- Сценарий Маши (453 превью, все advanced, 134 в карточках):
  Преотбор `453/453` ✓; Отбор команды `453/453` ✓ (team не использован);
  **Отбор клиента `134/453` ✓** (было `453/453`).
- Team используется (453 → 200 после team → 134 selected):
  Отбор команды `200/453` ✓; **Отбор клиента `134/200` ✓**.
- Client не done: Отбор команды `200/453` ✓; Отбор клиента активен.

## Related
- Связано с `shClientApprove()` — массовое перемещение всех фото на стадию
  3 без фильтрации по «selected». Требует отдельной задачи для частичного
  advance.
- `pipeline_backlog.md` — концепция «потенциал vs масштаб».

---

## v3 fix — `shSelectedCount` теперь считает все контейнеры

**Дата:** 2026-04-25
**Триггер:** Маша после v2 заметила что счётчик отбора занижен — pipeline показывал 134 (только из карточек), но в проекте есть ещё доп.контент (контейнеры + свободные фото).

**Что изменено:**
`v2/frontend/js/shootings.js:702` — `shSelectedCount(proj)` теперь суммирует unique имена файлов из ТРЁХ источников (как `acGetAllContent()` в `previews.js:3473`):
1. `proj.cards[].slots[].file` — фото в карточках товара
2. `proj.ocContainers[].items[].name` — контейнеры доп.контента
3. `proj.otherContent[].name` — свободные фото доп.контента

Дедупликация по имени файла через `seen[name]`.

**Verified node-харнесом:**
- cards only (2 unique из 3 records): 2 ✓
- containers only (2): 2 ✓
- otherContent only (2): 2 ✓
- mix all 3 with overlap (a/b в карточках, b/c в контейнерах, c/d в otherContent): 4 (a,b,c,d) ✓
- null/empty: 0 ✓

**Что Маше проверить:**
1. На странице «Отбор» счётчик «N фото» должен совпадать с pipeline «Отбор клиента: N/превью».
2. Проект только с карточками — без regression.
3. Проект с контейнерами доп.контента — pipeline теперь учитывает их.
