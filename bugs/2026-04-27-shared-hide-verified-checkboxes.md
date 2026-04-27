---
id: BUG-2026-003
date: 2026-04-27
reporter: Masha
severity: medium
area: articles / matching UI
status: fixed
source: live-test
commit: f0366df6dab79173cf8732d773993dd296bdd1d7
---

## Summary
В UI вкладки «Артикулы» три отдельных меню имеют чекбокс скрытия
верифицированных/подтверждённых элементов: «Чек-лист», «Сопоставление»
(секция «Карточки») и «Верификация». Все три были связаны: тогл одного
чекбокса менял отображение во всех трёх. Хуже — Маша словила состояние,
в котором рядом с каждым меню галочки **не стояли**, но в одном меню
артикулы были скрыты, а в другом показаны (visual checkbox state
decoupled от actual hide/show state).

## Steps to reproduce
1. Открыть проект с верифицированными артикулами (хотя бы 1 verified).
2. Зайти на вкладку «Артикулы» (`#page-articles`).
3. Снять чекбокс «Скрывать верифицированные» в чек-листе.
4. Прокрутить ниже до меню «Сопоставление» — verified карточки тоже
   стали видны (хотя чекбокс там не трогали).
5. Если в этот момент перевернуть verified-статус артикула или нажать
   что-то, вызывающее ререндер только одной секции — состояние чекбокса
   в этой секции сбрасывается на актуальный flag, а в других секциях
   старая HTML-копия с уже неактуальным `checked`-атрибутом остаётся.
   Получаем: «галочки не стоят» — но `_arHideVerified === true` →
   класс `ar-hide-verified` на `#page-articles` → ряды скрыты.

## Expected
- Каждая галочка относится только к своему меню.
- Тогл одной галочки не меняет состояние ни визуально, ни логически
  в двух других меню.
- Состояние чекбокса всегда матчится актуальному hide/show в его секции.

## Actual (до фикса)
- Один общий `_arHideVerified` (default `true`) в `articles.js`.
- Один общий handler `arToggleHideVerified()`.
- Один CSS-класс `ar-hide-verified` на `#page-articles`, который своим
  правилом скрывает сразу три селектора:
  `tr.ar-row.ar-verified`, `.ar-match-row.ar-verified`,
  `.ar-vfy-row.ar-vfy-verified`.
- Любой тогл переключал отображение во всех трёх блоках одновременно.
- Под некоторыми ререндерами (innerHTML одной секции при изменении
  данных) checked-атрибут чекбокса в той секции пересинкается с flag,
  а в других — нет: visual decoupling.

## Impact
- Затронут любой проект с >0 verified артикулов.
- Потери данных нет — чисто UI-баг.
- Workaround: ручной refresh страницы (восстанавливает консистентность,
  потому что все три ререндерятся с актуальным flag).
- Раздражает в multi-pass workflow: «сопоставил часть → подтвердил →
  скрыл → продолжил». Маше пришлось разбираться, почему в одном меню
  «всё пусто» при якобы «снятых» галочках.

## Logs / attachments
- `bugs/_artifacts/2026-04-27-shared-hide-verified/verify_decoupling.mjs`
  — Node-проверка логики (20/20 assertions pass).
- `bugs/_artifacts/2026-04-27-shared-hide-verified/visual_demo.html` +
  `screenshot_after.png` — все 3 ON, у каждой секции скрыты свои verified.
- `bugs/_artifacts/2026-04-27-shared-hide-verified/visual_demo_mixed.html` +
  `screenshot_mixed.png` — checkbox 1 OFF, 2 ON, 3 OFF: каждая секция
  отвечает ТОЛЬКО на свой чекбокс. Прямое визуальное доказательство
  decoupling.

## Timeline
- 2026-04-27 02:30 UTC — reported by Masha (live-test).
- 2026-04-27 02:35 UTC — triaged: in-memory state coupling +
  shared CSS-rule.
- 2026-04-27 02:50 UTC — fixed, commit `f0366df`. Push к `origin/main`.
- 2026-04-27 02:55 UTC — verified node-проверкой (20/20) и двумя
  скриншотами через headless Chrome.

## Resolution
**Root cause.** В `v2/frontend/js/articles.js`:
- Один in-memory flag `var _arHideVerified = true;` (line 42)
  читался во всех трёх `arRender*` функциях (`arRenderChecklist` ~750,
  `arRenderMatching` ~3160, `arRenderVerification` ~4640).
- Один handler `arToggleHideVerified()` тогглил этот flag и единственный
  CSS-класс `ar-hide-verified` на `#page-articles`.

В `v2/frontend/css/style.css`:
- Один CSS-блок:
  ```css
  #page-articles.ar-hide-verified .ar-vfy-row.ar-vfy-verified,
  #page-articles.ar-hide-verified .ar-match-row.ar-verified,
  #page-articles.ar-hide-verified tr.ar-row.ar-verified { display: none; }
  ```
  скрывал ряды трёх типов одним классом.

Visual decoupling возникал, потому что `arToggleHideVerified` после
тогла обновлял ТОЛЬКО текст счётчиков (точечно через querySelector),
не пересобирая DOM с обновлённым `checked` — для UX (чтобы не было
blink/прыжка скролла). Если в этот момент произвольный другой код
вызывал `arRenderChecklist()` или `arRenderMatching()`/`arRenderVerification()`
(например, после `arToggleVerify`), ОДНА секция перерисовывалась с
актуальным `checked`, а ДВЕ другие — нет. Так и собиралось состояние
«галочка не стоит, но ряды скрыты».

**Fix** (commit `f0366df`):
1. `v2/frontend/js/articles.js`:
   - Заменили `_arHideVerified` на 3 независимых flag:
     `_arHideVerifiedChecklist`, `_arHideVerifiedMatching`,
     `_arHideVerifiedVerification` (все default `true` — поведение
     по умолчанию сохранено).
   - Заменили `arToggleHideVerified()` на 3 handler:
     `arToggleHideVerifiedChecklist`, `arToggleHideVerifiedMatching`,
     `arToggleHideVerifiedVerification`. Каждый тогглит ТОЛЬКО свой flag
     и свой класс на `#page-articles`, обновляет ТОЛЬКО свой
     filter-bar counter. Verification-handler счётчик не обновляет
     (его тулбар не показывает «N скрыто»).
   - Каждый `arRender*` пишет свой `checked`-атрибут от своего flag и
     ставит/снимает свой класс на `#page-articles`.
2. `v2/frontend/css/style.css`:
   - Заменили один комбинированный селектор на 3 независимых:
     ```css
     #page-articles.ar-hide-verified-checklist    tr.ar-row.ar-verified         { display: none; }
     #page-articles.ar-hide-verified-matching     .ar-match-row.ar-verified     { display: none; }
     #page-articles.ar-hide-verified-verification .ar-vfy-row.ar-vfy-verified   { display: none; }
     ```
3. `v2/frontend/index.html`:
   - Bump cache: `style.css?v=18 → ?v=19`, `articles.js?v=18 → ?v=19`.

**Persistence.** В коде persistence (localStorage) никогда не было — это
in-memory flag со значением по умолчанию `true`. Каждый из 3 новых flag
тоже default `true`, поведение «по умолчанию скрываем verified» сохранено
для всех трёх блоков. Если в будущем понадобится persistence — каждый
flag сохраняется отдельным ключом (`maketcp_hideverified_checklist` и т.д.).

**Что протестировано:**
- `node --check v2/frontend/js/articles.js` — синтаксис чистый.
- `node bugs/_artifacts/2026-04-27-shared-hide-verified/verify_decoupling.mjs`
  — 20/20 проверок прошли:
  - 3 проверки initial state (все скрыты).
  - 5 проверок toggle Checklist → matching/verification flag и class
    не изменились.
  - 3 проверки toggle Matching не трогает другие.
  - 3 проверки toggle Verification не трогает другие.
  - 3 проверки toggle Verification обратно on не трогает другие.
  - 3 проверки финального состояния «все 3 чекбокса off» — ни одного
    `ar-hide-verified-*` класса на `#page-articles` (≡ Машино «галочки
    не стоят и ряды показаны» — теперь невозможен decouple).
- 2 screenshot'а через headless Chrome (`Google Chrome.app/.../Chrome
  --headless=new --screenshot ... file://.../visual_demo*.html`):
  - `screenshot_after.png` — все 3 ON: каждая секция показывает только
    свои unverified ряды.
  - `screenshot_mixed.png` — chk1 OFF, chk2 ON, chk3 OFF: секция 1
    показывает verified, секция 2 скрывает свои verified, секция 3
    показывает verified. Доказательство, что 3 чекбокса работают
    независимо.

**Acceptance criteria** (все ✓):
- ✓ Каждый из трёх чекбоксов работает независимо.
- ✓ Toggling одной не влияет на другие.
- ✓ Visually checkbox state matches actual hide/show state в его меню
  (CSS-класс зависит от того же flag, который определяет `checked` —
  ререндер любой одной секции не может теперь рассинхронизировать
  состояние двух других).
- ✓ Persistence — отдельно для каждого (когда добавится).
- ✓ No regressions: те же 3 default `true`, тот же CSS-механизм
  скрытия (через class на `#page-articles`), тот же UX без blink/прыжка
  скролла.

## Related
- `v2/frontend/js/articles.js` функции `arRenderChecklist` /
  `arRenderMatching` / `arRenderVerification` + новые handler.
- `v2/frontend/css/style.css` блок около строки 2670 (multi-pass фильтр).
- `bugs/_artifacts/2026-04-27-shared-hide-verified/` — артефакты
  верификации (Node-проверка, HTML-демо, скриншоты).
