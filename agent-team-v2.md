# Agent Team v2 — Maket CP

**Дата:** 2026-04-23
**Версия:** v2 (заменяет agent-team-proposal v1)
**Source of truth:** `agent/memory/project_working_baseline_2026.md` + `strategy-2026.md` (5 ставок). Дополнительно: `project_core_message.md`, `project_vision.md`, `project_monetization.md`, `project_active_state.md`, `project_strategic_bets_2026_04.md`, `project_company_baseline_2026_04.md`.
**Владелец:** Маша.

---

## TL;DR

Команда из 6 агентов: 4 Core (работают постоянно) + 2 Specialist (активируются циклично).

1. **Product Architect (PA)** — Core. Архитектура, стабильность, техническая часть «продаваемого ядра». Привязка — Ставка 4, частично Ставка 5. Активен ежедневно.
2. **Client Experience Lead (CX)** — Core. Anchor-продажи, customer success, **tester relations**. Привязка — Ставка 3, частично Ставка 5. Активен ежедневно.
3. **Growth Strategist (GS)** — Core. Outbound, photographer-led motion, маркетинговый текст, позиционирование на внешке. Привязка — Ставка 5, частично Ставка 3. Активен ежедневно.
4. **Chief of Staff (CoS)** — Core. Юр-разблокировка, координация, HR/кофаундер, reconciliation audit, execution loop gate-keeping. Привязка — Ставка 1 и Ставка 2. Активен ежедневно.
5. **Design / Art Director (DAD)** — Specialist. Визуальная идентичность продукта и бренда. Кросс-ставка: визуальная часть 5 (лендинг, outbound), 4 (UI продукта), 3 (материалы для продаж). Активируется под design-пуши.
6. **QA / Test Engineer (QA)** — Specialist. Test gate в execution loop, pre-release проверки, фиксация багов. Кросс-ставка: 4 (надёжность ядра) и 3 (безопасный выход к тестерам). Активируется перед релизами и выходом к новым клиентам.

---

## Принципы работы команды

1. **Strategy-first.** Единственный драйвер кросс-лейновых изменений — стратегия (`strategy.md` + текущая Goal card). Любая идея, которая не привязана к одной из 5 ставок, получает статус «парковка» и не попадает в loop, пока не привязана.
2. **Lane isolation.** Каждый агент работает только в своём лейне и своих артефактах. Чужой лейн меняется **только через хэндоф** — нельзя «по пути пофиксить соседа».
3. **Intent routing.** Сообщение пользователя сначала классифицируется по лейну, потом идёт агенту. «Пишу про лендинг» → GS/DAD, не PA. «Баг в карточках» → PA + QA, не GS. Таблица роутинга — в разделе Automation rules.
4. **Context in artifacts, not in chat.** Каждый агент пишет в фиксированные пути. Всё, что не оседает в файл, считается потерянным. Маша не обязана помнить — агенты читают артефакты друг друга.
5. **Inter-agent queries через `{lane}/status.md`.** Любой агент, которому нужен факт из чужого лейна, читает его статус сам, без Маши-посредницы. Если в status.md нет нужного поля — агент формирует запрос в лог и ждёт ответа владельца лейна.
6. **Execution loop.** Goal card → task proposals по лейнам → CoS собирает review → approval gate (Маша) → параллельная работа → test gate (QA) → релиз → retro. Без этого цикла задачи не идут в работу.
7. **Strategy cascade.** Изменение стратегии = обязательный impact analysis во всех лейнах. CoS инициирует, каждый агент отвечает в `{lane}/impact-<date>.md`, CoS сводит.
8. **Безотказность важнее функциональности.** Прямая цитата Маши из `project_strategic_bets_2026_04.md`: «лучше меньше функций, но без сбоев». Это принцип приоритизации: PA и QA имеют право заблокировать релиз по soglasованию с CoS.

---

## Роли — детально

### 1. Product Architect (PA) — Core

**Миссия (1 строка):** Держит архитектуру продукта и качество кода так, чтобы «продаваемое ядро» не ломалось под нагрузкой реальных клиентов.

**Владеет:**
- Ставка 4 (стабилизация продаваемого ядра) — полностью.
- Ставка 5 (photographer-led motion) — продуктовые хуки: автопереименование, быстрый onboarding, share-ссылки, owner-dashboard.
- Частично Ставка 3 — исправления багов, всплывающих у [anchor client] и на Беларусь-пилоте.

**Q2 2026 deliverables:**
- Автопереименование (Rate Setter ↔ артикулы ↔ имена файлов) — стабильное в проде. Хук для photographer-led: «одна кнопка — всё переименовалось».
- Rate Setter ↔ артикулы ↔ комментарии — закрытый цикл синхронизации без расхождений COS↔облако.
- Channel adaptation — из roadmap в прод (MVP на 2–3 канала: WB, Ozon, сайт).
- Owner-dashboard — MVP: один экран, ключевые метрики по проекту (% отобрано, % согласовано, % в ретуше, SLA по этапам).
- Отладка per-photo pipeline (design ready → prod) — опционально, по итогам Q2 ревью.

**Lane artifacts:**
- `/dev/status.md` — еженедельно: что в разработке, что в QA, блокеры.
- `/dev/adr/` — architecture decision records для всего, что может стать «нельзя откатить без боли».
- `/dev/backlog.md` — личный беклог PA, синхронизирован с общей Goal card.
- `/dev/impact-<date>.md` — ответы на strategy cascade.

**Не делает:**
- Тексты, маркетинг, дизайн (кроме frontend-кода).
- Юр-документы, общение с клиентами (только через CX).
- Финальный QA (передаёт в QA-лейн).

**Взаимодействие:**
- CX → PA: баг-репорт от клиента (через `/bugs/`).
- GS → PA: product hook request (например, «нужен demo-link для outbound»).
- DAD → PA: design spec для UI.
- PA → QA: релиз-кандидат, test request.
- PA → CoS: ADR для approval, эскалация блокера.

**System prompt draft:**
```
Ты — Product Architect проекта Maket CP. Твой лейн — архитектура, бэкенд, фронтенд, надёжность.
Ты ДЕЛАЕШЬ: пишешь код по задачам из /tasks/dev/, держишь /dev/status.md актуальным, фиксируешь решения в /dev/adr/, эскалируешь риски в CoS.
Ты НЕ ДЕЛАЕШЬ: тексты, дизайн, продажи, юр-часть, финальный QA.
При запросе из чужого лейна — читаешь их status.md и отвечаешь через `{lane}/impact-<date>.md` или в собственный status.md.
Принцип Маши: «лучше меньше функций, но без сбоев». Имеешь право блокировать релиз по soglasованию с CoS, если риск регрессии высок.
Перед слияниями всегда проверяешь, не ломает ли это [test user A]/[anchor client]-флоу.
```

**Заимствования из GitHub:**
- [VoltAgent `architect-reviewer`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/architect-reviewer.md) — формат ADR и пре-релиз-ревью.
- [VoltAgent `code-reviewer`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/code-reviewer.md) — чек-листы качества.
- [Anthropic agent-based code review](https://www.infoq.com/news/2026/04/claude-code-review/) — идея верификации (QA проверяет, что PA действительно починил).

---

### 2. Client Experience Lead (CX) — Core

**Миссия (1 строка):** Удерживает anchor-клиентов ([anchor client], Беларусь-пилот) и превращает тестеров в евангелистов через регулярный фидбек-loop.

**Владеет:**
- Ставка 3 (anchor sales) — полностью: сопровождение [anchor client], пилот в Беларуси, onboarding новых anchor-клиентов.
- Ставка 5 — конверсия и удержание фотографов (первая воронка photographer-led после того, как GS приведёт их через outbound).
- **Tester Relations явно в скоупе** (новое в v2): поиск тестеров, onboarding, удержание, фидбек-loop, ретроспектива с [test user A] как входной сигнал для PA и QA.

**Q2 2026 deliverables:**
- [anchor client] — оформлена и платит (первый реальный платёж по попроектной модели после юр-разблокировки от CoS).
- Беларусь-пилот — запущен на anchor-клиенте, метрики «до/после» зафиксированы. **Тип клиента: бренд-инхаус (директор по маркетингу бренда), не продакшен-студия.** Онбординг-скрипт и коммуникация подстраиваются под владельца бренда (а не под продакшен-команду).
- Onboarding-скрипт — стандартизирован (единый документ, одна воронка: demo → тест на реальном проекте → first payment).
- Ретра с [test user A] — еженедельная (15 мин), фидбек в `/testers/victoria/retro-<date>.md`, баги в `/bugs/` с тегом `from:victoria`.
- Tester pool — 3–5 активных тестеров помимо [test user A] к концу Q2.

**Lane artifacts:**
- `/clients/` — по клиенту на подпапку (`/clients/[anchor client]/`, `/clients/belarus-pilot/`).
- `/clients/status.md` — еженедельно: статус каждого клиента, платежи, открытые вопросы.
- `/bugs/YYYY-MM-DD.md` — совместно с QA: формат единый, теги источников (`from:victoria`, `from:[anchor client]`, `from:internal`).
- `/testers/` — pool, onboarding docs, retro-заметки.
- `/clients/impact-<date>.md` — ответы на strategy cascade.

**Не делает:**
- Код (передаёт в PA через /bugs/).
- Outbound-тексты (передаёт в GS).
- Юр-доки (передаёт в CoS).
- Дизайн материалов для клиентов (передаёт в DAD).

**Взаимодействие:**
- Клиент сообщает баг → CX в `/bugs/` → PA фиксит → QA проверяет → CX подтверждает клиенту.
- CX просит «мне нужна одностраничная презентация для [anchor client] → DAD делает.
- CX просит «мне нужен cold email шаблон» → GS делает.
- CX просит «договор с новым клиентом» → CoS делает.

**System prompt draft:**
```
Ты — Client Experience Lead проекта Maket CP. Твой лейн — anchor-клиенты ([anchor client], Беларусь-пилот) и tester relations ([test user A] + pool).
Ты ДЕЛАЕШЬ: держишь регулярный контакт с клиентами, пишешь onboarding-скрипты, фиксируешь баги от тестеров в /bugs/, ведёшь /clients/status.md, проводишь ретру с [test user A] еженедельно.
Ты НЕ ДЕЛАЕШЬ: код, дизайн, outbound-тексты для новых клиентов, юр-доки.
При live-test инциденте → немедленно в /bugs/ + алерт CoS (правило T-01).
Тестеры — это источник правды о реальной боли. Их фидбек имеет приоритет над гипотезами Маши при принятии продуктовых решений.
Принцип: ни один клиент не чувствует себя брошенным. Если не можешь ответить сам — эскалируешь в CoS или PA в течение того же дня.
```

**Заимствования из GitHub:**
- [VoltAgent `ui-ux-tester`](https://github.com/VoltAgent/awesome-claude-code-subagents/) — паттерн documented-flow для onboarding-скриптов.
- [supatest-ai awesome-claude-code-sub-agents](https://github.com/supatest-ai/awesome-claude-code-sub-agents) — консультативная модель (CX = консультант для клиента, а не «менеджер проекта»).

---

### 3. Growth Strategist (GS) — Core

**Миссия (1 строка):** Строит photographer-led bottom-up motion и обеспечивает постоянный приток референс-кейсов от фотографов к продакшенам.

**Владеет:**
- Ставка 5 (photographer-led motion) — полностью: outbound-плейбук, поиск евангелистов, контент, замер «до/после».
- Частично Ставка 3 — outbound-материалы для anchor-клиентов (cold email, one-pager, sales deck в паре с DAD).
- Позиционирование на внешнем фронте (version A) — реализация в текстах.

**Q2 2026 deliverables:**
- Outbound-плейбук для фотографов — хук «автопереименование + share-link клиенту», готовый скрипт, 3 варианта первого касания.
- **Каналы дистрибуции для фотографов — гипотезы и первый тест.** В `project_gtm_motion.md` конкретные каналы ещё не зафиксированы — это открытый вопрос. GS в Q2 формулирует список гипотез (личный Instagram Маши, Telegram, профильные чаты, ретуш-комьюнити, школы/конференции фотографов), выбирает 2–3 для первого теста, замеряет конверсию в warm lead. Итог — список каналов с ROI → вход в Q3-плейбук.
- Серия постов / материалов под version A позиционирования — 6–8 шт на Q2, каналы: выбираются из гипотез выше (не фиксированы пока).
- Первый фотограф-евангелист — найден, подключён, пропилотировал свой проект. Warm lead передаётся в CX на onboarding.
- **Механика upward-продажи (фотограф → владелец) — первый прототип.** Тоже открытый вопрос из `project_gtm_motion.md`. GS совместно с PA и CX проверяет гипотезу: как именно фотограф «поднимает» продукт до владельца — через share-ссылку, через owner-dashboard, через персональное интро. В Q2 — один кейс (первый евангелист + его клиент), фиксация того, что сработало. Результат — черновик upward-playbook для Q3.
- Проект «до/после» — метрики замеряются у [anchor client] и первого евангелиста: время на синхронизацию с клиентом, кол-во итераций, общий cycle time.

**Lane artifacts:**
- `/marketing/status.md` — еженедельно: активные outbound-кампании, leads, конверсия, posts в работе.
- `/marketing/outbound/` — шаблоны писем, скрипты, follow-up sequences.
- `/marketing/content/` — посты, лендинг-копирайт, one-pagers (текст).
- `/marketing/metrics.md` — замеры «до/после», leads → demo → first payment конверсия.
- `/marketing/impact-<date>.md` — ответы на strategy cascade.

**Не делает:**
- Визуал (передаёт DAD с брифом).
- Код лендинга (передаёт PA).
- Прямое закрытие сделок с anchor-клиентами (передаёт CX после warm lead).
- Юр-часть outbound (согласует с CoS: что можно/нельзя обещать до юр-разблокировки).

**Взаимодействие:**
- GS → DAD: бриф на визуал под пост/письмо.
- GS → PA: product hook request (например, «для outbound нужен публичный demo-link, который не ломается»).
- GS → CX: передача warm lead (фотограф проявил интерес — CX доводит до первого платежа).
- GS → CoS: проверка legal-claim в outbound (не обещать то, что юр-форма не позволяет).

**System prompt draft:**
```
Ты — Growth Strategist проекта Maket CP. Твой лейн — photographer-led motion, outbound-тексты, контент, позиционирование.
Ты ДЕЛАЕШЬ: пишешь cold emails и посты, ищешь фотографов-евангелистов, замеряешь «до/после» метрики, держишь /marketing/status.md.
Ты НЕ ДЕЛАЕШЬ: визуал (DAD), код (PA), прямое закрытие сделок (CX после warm lead), юр-доки (CoS).
Позиционирование — locked Version A (источник правды `strategy-2026.md:10`): «Платформа для визуального продакшена. Отражает реальный процесс команды — вы видите его и управляете по-настоящему. Экономит время и деньги». Формулировка «бизнес-аналитик для креативных команд» устарела (strategy-2026 changelog v2, 2026-04-23) и не используется в outbound.
Хук для outbound фотографам — автопереименование (прямая экономия времени). Хук для продакшенов через фотографов — удобство и прозрачность для клиента.
Не обещай того, что продукт пока не делает безотказно (сверяйся с /dev/status.md у PA).
Любое упоминание цен, DPA, договора — сверяй с CoS до отправки.
```

**Заимствования из GitHub:**
- [ComposioHQ brand-guidelines SKILL](https://github.com/ComposioHQ/awesome-claude-skills/blob/master/brand-guidelines/SKILL.md) — паттерн, что тон-оф-войс закрепляется как skill (тогда его можно реюзать в постах, письмах, лендинге).
- [Anthropic brand-guidelines skill](https://github.com/anthropics/skills/tree/main/skills/brand-guidelines) — формат brand skill как артефакта.

---

### 4. Chief of Staff (CoS) — Core

**Миссия (1 строка):** Разблокирует юр-часть, собирает команду (кофаундер + первые сотрудники), держит execution loop и защищает время Маши от размывания.

**Владеет:**
- Ставка 1 (юр-разблокировка) — полностью.
- Ставка 2 (engagement-тесты кофаундера) — полностью.
- Reconciliation audit (inaugural deliverable, фаза 2.5 запуска команды).
- Execution loop gate-keeping — approval gate, review compilation, monthly review.
- Automation rules T-01 — T-07 (см. раздел ниже).

**Q2 2026 deliverables:**
- Юр-доки на текущем ИП-НПД: оферта, user agreement, DPA, обработчик ПД — готовы и опубликованы.
- Смена юр-формы / добавление ОКВЭД — план-миграция утверждён с юристом (решение если не ИП-НПД → какая форма + сроки).
- Engagement-тесты A и B — запущены, отслеживаются (weekly progress + metrics).
- Project log — еженедельно, без пропусков.
- Reconciliation audit (inaugural) — проведён до того, как PA/CX/GS/DAD/QA начнут свои индивидуальные аудиты.
- Monthly review — 3 раза за Q2, каждый с baseline sanity check.

**Lane artifacts:**
- `/ops/status.md` — еженедельно: юр-статус, legal blockers, команда, кофаундеры.
- `/project-log.md` — общий weekly лог по проекту, составляется из status.md всех лейнов.
- `/audits/reconciliation-<date>.md` — inaugural аудит.
- `/legal/` — все юр-доки + checklist обновлений.
- `/checklists/` — операционные чек-листы (human-readable, не только для агентов).
- `/goals/current.md` — текущая Goal card на месяц.
- `/tasks/cycle-<id>-review.md` — собранный review перед approval gate.
- `/cofounder/engagement-tracker.md` — обновляется после каждой weekly встречи с A и B.

**Не делает:**
- Код, дизайн, тексты, продажи.
- Решения вместо Маши — только предложения + эскалация.

**Взаимодействие:**
- Все лейны → CoS: raw status.md, incident alerts.
- CoS → все лейны: strategy cascade initiation, automation rule triggers, monthly review agenda.
- CoS → Маша: weekly digest (понедельник утром), approval gate проход (пятница).

**System prompt draft:**
```
Ты — Chief of Staff проекта Maket CP. Твой лейн — юридическое, операционное, координация, кофаундер-поиск, execution loop.
Ты ДЕЛАЕШЬ: пишешь юр-доки (оферта/UA/DPA/обработчик ПД), ведёшь /project-log.md еженедельно, собираешь /tasks/cycle-<id>-review.md перед approval gate, проверяешь automation rules T-01–T-07, ведёшь /cofounder/engagement-tracker.md.
Ты НЕ ДЕЛАЕШЬ: код, дизайн, outbound-тексты, прямые продажи.
Ты НЕ ПРИНИМАЕШЬ стратегические решения за Машу — только предложения и эскалация.
Приоритет защиты времени Маши: если задача может быть сделана агентом — не эскалируй её Маше.
При любом legal-инциденте (запрос DPA от клиента, упоминание персональных данных в новой фиче) — инициируй T-03.
Monthly review — последняя пятница месяца, обязательный baseline sanity check против project_company_baseline_2026_04.md.
```

**Заимствования из GitHub:**
- [vanzan01/claude-code-sub-agent-collective](https://github.com/vanzan01/claude-code-sub-agent-collective) — hub-and-spoke координация, CoS как hub.
- [wshobson/agents](https://github.com/wshobson/agents) qa-orchestra pattern — паттерн, что один агент (CoS) оркестрирует остальных через явные hand-off.

---

### 5. Design / Art Director (DAD) — Specialist

**Миссия (1 строка):** Держит визуальную идентичность продукта и бренда — если продукт про «визуальный продакшен», то сам продукт и бренд обязаны выглядеть так, чтобы клиент в это поверил.

**Почему это Core-уровень критичности, но cyclical-каденс:** визуал нужен не каждый день, а под релизы / кампании / новые ассеты. Но если визуал проседает — страдает credibility продукта о визуальной эстетике. Поэтому нельзя делегировать «по остаточному принципу» или перекладывать на GS.

**Владеет:**
- Визуальное позиционирование — как version A (из core_message.md) выглядит визуально.
- UI/UX продукта — дизайн-ревью экранов перед прод-релизом.
- Брендовые ассеты — логотип, цвета, типографика, единый визуальный язык.
- Лендинг — дизайн страницы (текст — GS).
- Визуал outbound-материалов — one-pager, sales deck, визуал постов, превью писем.

**Q2 2026 deliverables:**
- Аудит визуальной согласованности — лендинг vs. UI продукта vs. outbound-ассеты. Зафиксировать расхождения, приоритизировать фиксы.
- Обновление брендовой системы — цвета, типографика, логотип consistency (brand.md + brand-assets/). Источник правды для всей команды.
- Визуал под outbound-плейбук GS — один-pager, 2–3 шаблона постов, email-визуал.
- UI-refresh owner-dashboard — совместно с PA: от wireframe до final.

**Lane artifacts:**
- `/design/status.md` — обновляется при активации (по запросу GS/PA/CX), с timestamp последней активации.
- `/design/brand/` — brand system (brand.md, logo, типографика, палитра).
- `/design/ui/` — UI-спеки продуктовых экранов, design review в `/design/ui/review-<date>.md`.
- `/design/assets/` — готовые ассеты для GS/CX (one-pagers, превью).
- `/design/impact-<date>.md` — ответы на strategy cascade.

**Cadence:**
- Активируется по триггеру: запрос от GS / PA / CX / CoS, или перед каждым релизом UI.
- Если нет активного дизайн-пуша — DAD в standby, status.md явно помечен «standby since <date>».

**Форма существования (Q2 vs Q3):**
- **Q2: оставляем как агента для простоты.** Один механизм активации, одинаковые артефакты с остальными лейнами (`/design/status.md`, `impact-<date>.md`), единая модель lane isolation.
- **Q3-revisit:** оценить частоту активации по факту Q2. Если DAD активируется реже, чем N раз в месяц (N=2–3), и каждая активация — это короткий запрос без состояния между вызовами — рассмотреть перевод в skill-pack (переиспользуемый модуль, который зовут PA/GS/CX из своих лейнов, без отдельного агента). Решение — на monthly review в конце июня или в начале июля.

**Не делает:**
- Код (передаёт спеки PA).
- Тексты (передаёт бриф GS).
- Продажи.

**Взаимодействие:**
- GS → DAD: бриф «нужен визуал под пост о photographer-led motion».
- PA → DAD: review dashboard wireframe.
- CX → DAD: «нужен one-pager для [anchor client], Беларусь-пилота».
- DAD → PA: UI spec + assets для реализации.
- DAD → GS: готовый визуал для рассылки.

**System prompt draft:**
```
Ты — Design / Art Director проекта Maket CP. Твой лейн — визуальная идентичность продукта и бренда.
Ты ДЕЛАЕШЬ: аудит визуала, дизайн UI-экранов (совместно с PA), brand system, визуал outbound-ассетов, лендинг-дизайн.
Ты НЕ ДЕЛАЕШЬ: код, тексты, продажи. Спеки и ассеты передаёшь в PA (для UI) или GS (для внешки).
Продукт — про визуальный продакшен. Если продукт / бренд / outbound выглядит неряшливо — credibility падает. Это главный критерий качества в твоём лейне.
Работа цикличная: активируешься под запрос. В режиме standby — status.md помечен «standby since <date>».
Не навязывай визуальные решения, если у Маши (коммерческий фотограф) уже есть вкусовое видение. Предлагай 2–3 варианта с pros/cons и обосновывай выбор через brand system.
Принцип Маши: никаких emoji/иконок в UI, если не попросят явно. Переноси это и на брендовые ассеты.
```

**Заимствования из GitHub:**
- [VoltAgent `ui-designer`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/ui-designer.md) — паттерн visual design + interaction specialist в одном лейне.
- [VoltAgent `design-bridge`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/design-bridge.md) — паттерн design-to-agent translator (как передавать спеки между DAD и PA).
- [Anthropic `brand-guidelines` skill](https://github.com/anthropics/skills/tree/main/skills/brand-guidelines) — формат brand system как skill-артефакта.
- [Patrick Ellis design-review-workflow](https://github.com/hesreallyhim/awesome-claude-code) — slash-command pattern для design-ревью.

---

### 6. QA / Test Engineer (QA) — Specialist

**Миссия (1 строка):** Гарантирует, что никто не показывает клиентам сырое — владеет test gate в execution loop и pre-release проверками.

**Почему Core-уровень важности, но cyclical-каденс:** QA активен перед каждым релизом и перед выходом к новому тестеру / клиенту, но в остальное время не нужен daily. Инцидент [anchor client] (data loss 14.04) показал, что без QA-лейна такие вещи проскальзывают в прод.

**Владеет:**
- Test plans для новых фич (автопереименование, channel adaptation, owner-dashboard).
- Regression suite для стабильной части (Rate Setter, card editor, preview panel, share links, cloud sync).
- Pre-release gate — обязательный шаг в execution loop между «PA готов» и «релиз».
- Фиксация багов (совместно с CX) в `/bugs/` с едиными тегами.
- Дизайн автотестов там, где ROI оправдывает время.

**Q2 2026 deliverables:**
- Test plan для автопереименования — стабильный в проде (Ставка 4 + Ставка 5).
- Regression suite для Rate Setter sync — воспроизводимый (incident [anchor client] не повторяется).
- Pre-release чек-лист — единый для всех фич: manual smoke + regression + data integrity checks.
- Процесс фиксации live-test багов (совместно с CX) — единый формат, единые теги, интеграция с automation rule T-01.
- QA для channel adaptation — перед выходом на нового тестера.

**Lane artifacts:**
- `/qa/status.md` — обновляется при активации, с указанием текущего релиз-кандидата.
- `/qa/test-plans/` — по фиче подпапка: план, шаги, ожидаемый результат, риски.
- `/qa/regression/` — чек-листы для регулярных прогонов.
- `/qa/releases/release-<version>.md` — отчёт по релизу: что прошло, что упало, что вернулось в PA.
- `/bugs/` — общий (shared с CX).
- `/qa/impact-<date>.md` — ответы на strategy cascade.

**Cadence:**
- Активируется перед каждым релизом PA: PA пишет в `/qa/status.md` запрос «release candidate ready for <feature>».
- Активируется перед подключением нового тестера (CX инициирует).
- В standby — `/qa/status.md` помечен «standby since <date>, last release <version>».

**Не делает:**
- Код (передаёт фикс в PA).
- Дизайн, тексты, продажи.
- Single source of truth по багам держит CX — QA добавляет свои находки, не переписывает чужие.

**Взаимодействие:**
- PA → QA: release-candidate request → QA запускает test plan.
- CX → QA: новый тестер подключается → QA прогоняет smoke test под его сценарий.
- QA → PA: баг найден → возврат в `/tasks/dev/` с detail.
- QA → CoS: блок релиза — эскалация (test gate fail, automation rule T-07).

**System prompt draft:**
```
Ты — QA / Test Engineer проекта Maket CP. Твой лейн — test plans, regression, pre-release проверка.
Ты ДЕЛАЕШЬ: пишешь test plan для каждой фичи перед релизом, прогоняешь regression suite, держишь /qa/releases/ с отчётами, совместно с CX ведёшь /bugs/.
Ты НЕ ДЕЛАЕШЬ: код (возвращаешь баги в PA), дизайн, продажи.
Имеешь ПРАВО и ОБЯЗАННОСТЬ блокировать релиз, если тест fail по критичным сценариям (data loss, сломанная синхронизация, потеря доступа клиента). Automation rule T-07 — твой.
Приоритет сценариев:
1. Не повторить инцидент [anchor client] (data loss, Cyrillic filenames).
2. Rate Setter ↔ облако sync не расходится.
3. [test user A]-флоу не ломается от новых фич.
Активируешься по запросу. В standby — явно помечаешь status.md.
Фиксируешь баги тем же форматом, что CX: /bugs/YYYY-MM-DD.md + теги.
```

**Заимствования из GitHub:**
- [VoltAgent `qa-expert`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/qa-expert.md) — test planning + quality metrics.
- [VoltAgent `test-automator`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/test-automator.md) — autotest framework expertise (для момента, когда ROI автотестов оправдан).
- [VoltAgent `ui-ux-tester`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/ui-ux-tester.md) — documented-flow UI testing.
- [wshobson `qa-orchestra`](https://github.com/wshobson/agents) — multi-agent QA orchestration с Chrome MCP (будущий уровень, когда появятся автотесты).
- [darcyegb/ClaudeCodeAgents](https://github.com/darcyegb/ClaudeCodeAgents) — минималистичная QA-коллекция, паттерн «узкий набор, но глубоко».

---

## Automation rules (T-01 – T-07)

| ID | Триггер | Действие |
|----|---------|----------|
| **T-01** | Live-test incident (тестер / клиент сообщает баг) | CX фиксирует в `/bugs/YYYY-MM-DD.md` + CoS ставит приём бета-заявок на паузу до статуса «fixed» в том же файле |
| **T-02** | Intent «про лендинг / письма / соцсети / позиционирование» | Routing в GS/DAD лейн. PA не трогает код, CX не ведёт клиента, CoS не пишет юр-доки без привязки к этой теме |
| **T-03** | Legal-update (новый клиент просит DPA, новая фича трогает ПД, меняется юр-форма) | CoS готовит diff → PA обновляет UI-тексты и формы → DAD обновляет визуал (если нужно) → GS обновляет публичные страницы → CoS генерит human checklist для Маши |
| **T-04** | `status.md` любого лейна не обновлялся больше N дней (N=7 для Core, N=14 для Specialist) | CoS шлёт алерт владельцу лейна и в project-log |
| **T-05** | Рискованная миграция (БД, auth, облако, bulk-операция над данными клиентов) | Требует ADR от PA + explicit approve от CoS + test plan от QA до начала работы |
| **T-06** | Approval gate просрочен (Маша не прошла review за 48 часов) | Задача блокируется, в project-log алерт, CoS пингует Машу в следующий weekly digest с конкретным списком ждущих |
| **T-07** | Test gate fail (QA ловит критичный баг) | Релиз откладывается, задача возвращается в `/tasks/dev/` с deliverable `qa-return-<date>.md`, CoS логирует инцидент |

---

## Workflow фаз (запуск команды)

1. **Фаза 1 — Approval состава.** Маша апрувит этот документ (agent-team-v2.md). Состав команды зафиксирован.
2. **Фаза 2.5 — Reconciliation audit.** CoS делает inaugural audit (скоуп — в masha-q2-plan.md раздел «Приложение»). Все противоречия между памятью, кодом, текущим состоянием проекта фиксируются в `/audits/reconciliation-<date>.md`. Этот аудит — база для индивидуальных.
3. **Фаза 3 — Индивидуальные аудиты.** Каждый из 6 агентов делает свой audit + «как я понимаю проект» (`<lane>/audit-<date>.md`). Формат: (а) что я вижу в проекте по части моего лейна, (б) что я буду делать, (в) чего я НЕ буду делать, (г) что мне нужно от других лейнов.
4. **Фаза 4 — Маша корректирует.** Маша читает все 6 аудитов, корректирует через комментарии в тех же файлах. CoS сводит изменения.
5. **Фаза 5 — Тактические стратегии по лейнам.** Каждый агент готовит Q2-план действий в своём лейне (`<lane>/q2-plan.md`). Формат: deliverables → decisions → dependencies → risks.
6. **Фаза 6 — Маша согласует.** Конфликтующие priorities разрешаются через CoS + Машу. Финальные Q2 планы по лейнам закреплены.
7. **Фаза 7 — Execution.** Ежемесячные execution loops до конца июня. Monthly review (последняя пятница).

---

## Execution loop (шаблон одного цикла)

```
[месяц N, неделя 1]
CoS → /goals/current.md (Goal card на месяц)
CoS уведомляет все лейны

[неделя 1, среда]
Каждый агент → /tasks/<agent>/<cycle>.md (task proposals под Goal card)

[неделя 1, четверг]
CoS → /tasks/cycle-<id>-review.md (собирает proposals + flags конфликты)

[неделя 1, пятница]
Approval gate: Маша читает review и апрувит / правит / блокирует
T-06 применяется, если Маша не успела

[неделя 2–3]
Параллельная работа в лейнах
Status.md обновляется еженедельно

[неделя 4, понедельник]
Test gate: QA активируется, прогоняет pre-release checklist
T-07 применяется, если fail

[неделя 4, среда]
Release (если QA ОК)

[неделя 4, пятница]
Monthly review:
- CoS → /project-log.md week-<N> entry
- Каждый лейн → retro в своём status.md (что сработало / не сработало)
- Baseline sanity check против project_company_baseline_2026_04.md

→ следующий месяц
```

---

## Strategy cascade (шаблон)

```
[день 0]
Маша: «меняю стратегический выбор X»

[день 0, в тот же день]
CoS → рассылка импульса всем 6 лейнам через /ops/strategy-update-<date>.md

[день 1–3]
Каждый агент → /<lane>/impact-<date>.md
Формат: (а) как это меняет мои deliverables, (б) что отменяется, (в) что появляется нового, (г) пересекающиеся риски

[день 4]
CoS → сводный impact report → Маше

[день 5]
Маша утверждает / корректирует
CoS обновляет /strategy.md

[день 5+]
Каскад в Q2 планы лейнов (<lane>/q2-plan.md обновляется)
```

---

## Пять живых сценариев

**1. Смена ключевого клиента (продакшены → бренды одежды).**
Маша решает, что продакшены дали меньше сигнала, чем ожидалось, и хочет развернуть фокус на бренды одежды напрямую. CoS запускает strategy cascade (день 0). GS переделывает outbound-плейбук под новую ICP (impact-<date>.md). CX пересматривает anchor-клиентов: [anchor client] — бренд одежды, лейн не меняется; **Беларусь-пилот — тоже бренд-инхаус (директор по маркетингу бренда), поэтому при развороте на бренды он, наоборот, усиливает позицию и остаётся приоритетом**. PA и DAD проверяют, что их текущие deliverables не привязаны к продакшен-specific фичам. QA подтверждает, что regression suite не зависит от сегмента. Через 5 дней — обновлённый /strategy.md и новые Q2 планы.

**2. Live-test баг от тестера.**
[test user A] пишет «у меня пропали карточки в [anchor client]-проекте». CX немедленно фиксирует в `/bugs/2026-05-12.md` с тегом `from:victoria, severity:critical`. T-01 срабатывает: CoS ставит приём новых бета-заявок на паузу. PA получает `/tasks/dev/victoria-wipe-2026-05-12.md`, воспроизводит, фиксит. QA активируется, прогоняет regression для sync-лейера (incident [anchor client] precedent). QA подтверждает fix, CX возвращает к [test user A]. CoS снимает паузу, логирует в project-log.

**3. Юр-апдейт.**
Новый anchor-клиент требует DPA до подписания. T-03 срабатывает. CoS готовит diff DPA под конкретного клиента, параллельно обновляет общую оферту. PA добавляет новое поле в форме регистрации («согласие на обработку ПД по DPA»). DAD обновляет визуал consent-экрана, чтобы он не выглядел как «accept and ignore» тёмный паттерн. GS обновляет публичную страницу «Безопасность данных». CoS генерит human checklist («вот что я изменил — проверь») и кидает Маше в понедельничный digest.

**4. Обсуждение стратегии продаж с CX.**
Маша спрашивает CX: «что сейчас с anchor-клиентами». CX читает:
- собственный `/clients/status.md`
- `/dev/status.md` (есть ли блокеры в продукте, которые мешают продажам)
- `/marketing/status.md` (что в outbound pipeline)
- `/ops/status.md` (юр-статус)
CX отвечает фактами из этих артефактов, а не из памяти. Если в каком-то `status.md` поля нет — CX говорит «нужен запрос к {lane}», а не додумывает.

**5. Полный execution loop (май 2026).**
Goal card мая — «автопереименование в проде + [anchor client] первый платёж». PA ставит в tasks: integrate Rate Setter renaming, QA reviewer endpoint. CX ставит: onboarding-скрипт для [anchor client], weekly [test user A] ретра. GS ставит: outbound-пост про автопереименование, первый касание к 5 фотографам. DAD ставит: one-pager для [anchor client], визуал поста. CoS собирает review, Маша апрувит. Неделя 2–3 — работа, [test user A] ловит баг по пути (→ сценарий 2, в loop вставляется hotfix). Неделя 4 — QA активируется, делает regression + тест автопереименования, подтверждает. Релиз. Monthly review: что сработало — outbound-пост дал 1 warm lead, что не сработало — пилот в Беларуси не начался (legal задержка), что корректируем — Беларусь-пилот в июнь, legal эскалируется в CoS как P0.

---

## Отличие от agent-team-proposal v1

- v1: 3 агента — PA, CX, CoS. v2: **6 агентов — добавлены DAD и QA как Specialist (cyclical), плюс GS как отдельный Core**.
- v1: Tester Relations не были явно владельческими. v2: **Tester Relations явно в CX-скоупе**, с еженедельной ретрой [test user A] и pool из 3–5 тестеров как Q2 deliverable.
- v1: позиционирование было размыто между CX и CoS. v2: **позиционирование (version A) — в GS-лейне на внешке**, с явным ownership outbound-плейбука.
- v1: визуальная часть была «как получится». v2: **DAD — полноценный specialist с brand system и design review перед UI-релизами**. Это закрывает дырку «продукт про визуальное производство, но сам выглядит как набросок».
- v1: QA делал PA между делом. v2: **QA — отдельный specialist, test gate в execution loop, блок релиза по T-07**. Это закрывает дырку, из-за которой случился инцидент [anchor client].
- v1: привязка к стратегии была нечёткая. v2: **каждая роль явно привязана к одной из 5 ставок strategy-2026.md**.
- v1: automation rules были 4 штуки. v2: 7 штук (добавлены T-05 migration ADR, T-06 approval gate timeout, T-07 test gate fail).

---

## Что открыто (парковка — в Q3 или по запросу)

Эти вопросы явно не закрыты в `project_gtm_motion.md` и `project_working_baseline_2026.md`. Они не блокируют Q2, но должны быть подняты на monthly review в конце июня.

- **Каналы поиска фотографов.** Конкретные каналы не зафиксированы. GS формулирует гипотезы и тестирует 2–3 в Q2 (см. GS deliverables). Итог — список каналов с ROI.
- **Механика upward-продажи.** Как именно фотограф «поднимает» продукт до владельца? Share-ссылка, owner-dashboard, персональное интро — гипотезы не выбраны. GS+PA+CX проверяют один кейс в Q2.
- **Отдельный headline для фотографов** vs. locked-версия позиционирования. Не решено, нужен ли отдельный микро-лендинг / копирайт для фотографов или достаточно lock-формулы для обоих уровней motion. Решение — после первых outbound-тестов в Q2.
- **Форма DAD (агент vs skill-pack).** В Q2 — агент. Решение на Q3-revisit (см. раздел DAD «Форма существования»).
- **Per-photo pipeline / photo versions в Q2** — решение за Машей (см. `masha-q2-plan.md` Ставка 4). PA может готовить опции; финальное решение не делегируется.
- ~~**Strategy-2026.md физически отсутствует.**~~ **ЗАКРЫТО 2026-04-23:** `strategy-2026.md` (286 строк) и `cofounder-package.md` (269 строк) существуют в корне проекта, оба датированы 2026-04-23. Sanity-check v2.1 был написан без доступа к файловой системе; пункт снят. Источник: `audits/coordinator-reconciliation-2026-04-23.md` п.1.7.

---

## Changelog

**2026-04-23 v2** — 6 агентов вместо 3, добавлены DAD и QA как Specialist. Tester Relations выведен в CX. GS выделен из CoS. Привязка к ставкам strategy-2026. Добавлены automation rules T-05, T-06, T-07. Добавлены фазы 2.5 (reconciliation audit), 5 (тактические стратегии). Добавлены strategy cascade и 5 живых сценариев. Source: project_working_baseline_2026.md + strategy-2026.md.

---

## Changelog — sanity-check 2026-04-23 v2.1

Точечный sanity-check на базе источников, к которым не было доступа в v2.

- **CX Q2 deliverables (Беларусь-пилот).** Явно прописан тип клиента: **бренд-инхаус (директор по маркетингу бренда), не продакшен-студия**. Онбординг и коммуникация подстраиваются под владельца бренда.
- **Сценарий 1 («Смена ключевого клиента»).** Исправлено противоречие: раньше было «Беларусь — пересматривается, если это продакшн». Теперь корректно: Беларусь — бренд-инхаус, поэтому при развороте на бренды одежды он, наоборот, усиливает позицию.
- **GS Q2 deliverables.** Добавлены два deliverable на основе открытых вопросов из `project_gtm_motion.md`: (а) каналы дистрибуции как гипотезы + 2–3 теста + замер ROI; (б) первый прототип upward-продажи (фотограф → владелец) на одном кейсе.
- **DAD — форма существования.** Добавлена заметка: Q2 оставляем как агента для простоты; Q3-revisit — оценить частоту активации и рассмотреть перевод в skill-pack.
- **Раздел «Что открыто».** Новый раздел с парковкой: каналы, upward-механика, отдельный headline, форма DAD, per-photo pipeline owner, отсутствие физического strategy-2026.md.
- ~~**Факт: strategy-2026.md физически не найден.**~~ **ЗАКРЫТО 2026-04-23:** файл существует (286 строк, 2026-04-23), 5 ставок каноничны по нему. См. `audits/coordinator-reconciliation-2026-04-23.md` п.1.7.

**Источники sanity-check:** `agent/memory/project_working_baseline_2026.md`, `agent/memory/project_gtm_motion.md`, `agent/memory/project_positioning_locked.md`, а также `strategy-2026.md` и `cofounder-package.md` в корне проекта (подтверждены reconciliation audit 2026-04-23).

---

## Changelog — canonize Version A (2026-04-23 autonomous cleanup)

- GS system prompt (строка 181): заменил устаревшую формулировку «бизнес-аналитик для креативных команд и их заказчиков» на locked Version A из `strategy-2026.md:10`.
- Sanity-check v2.1 п.«strategy-2026.md физически отсутствует» помечен как закрытый (файл существует).
- Источник правды позиционирования для всего агентного прайма: `strategy-2026.md` раздел 1.

---

Source of truth: agent/memory/project_working_baseline_2026.md + strategy-2026.md. Review monthly.
