---
type: doc
status: active
owner: CoS
created: 2026-04-24
updated: 2026-04-24
tags:
  - ops
  - ongoing
  - ops-lane
  - client-a
related:
  - "[[strategy-2026]]"
  - "[[automation-rules]]"
priority: medium
cycle: ongoing
---

> **TL;DR:** **Период:** 2026-04-28 – 2026-05-18 (3 недели) **Ставки:** 1 (юр-разблокировка), 3 (anchor sales prep), 4 (стабилизация ядра), 5 (photographer-led prep) **Подписал:** [⏳ Маша, 2026-04-__] **Сформулировано CoS:** 2026-04-23 на базе Q2-стратегий всех 7 агентов + `strategy-2026.md` + `masha-q2-plan.md`.

# Goal Card — Cycle 1

**Период:** 2026-04-28 – 2026-05-18 (3 недели)
**Ставки:** 1 (юр-разблокировка), 3 (anchor sales prep), 4 (стабилизация ядра), 5 (photographer-led prep)
**Подписал:** [⏳ Маша, 2026-04-__]
**Сформулировано CoS:** 2026-04-23 на базе Q2-стратегий всех 7 агентов + `strategy-2026.md` + `masha-q2-plan.md`.

---

## Цель цикла

Разблокировать Ставку 1 (юр-доки: оферта v1 и privacy v1 в draft), подготовить Беларусь first contact (one-pager + канал), вывести `photo_versions` в prod-ready состояние (канонизированная миграция + ADR-001), финализировать landing cleanup (убрать устаревшие claim'ы + hero-badge routing-форма). Плюс: положить рабочие рельсы execution loop (goal/tasks/log/automation rules/release playbook/candidate A tracker) и провести первую встречу кандидата A.

**Один абзац для Маши:** цикл 1 — это не продажи и не релиз. Это «вставили ключи в замки»: юристу дали скоуп и ответы на вопросы (или default'ы), Беларуси сделали one-pager и ждём твоего бренда/канала, продукту починили последнюю архитектурную дыру (photo_versions), лендингу убрали всё устаревшее, кандидату A отдали [anchor client] pack как задачу. К 18 мая у команды есть материал, на котором цикл 2 уже закрывает деньги.

---

## Success criteria (измеримые, binary pass/fail)

> **Важно:** Первый платёж [anchor client] — НЕ в скоупе цикла 1, планируется в cycle 2 к 15 июня.

1. **LC: оферта + privacy в draft v1.** Ответы Маши на 10 open questions получены (или CoS зафиксировал default'ы в `docs/agents/legal/decisions-q2.md`), `drafts/oferta-v1.md` и `drafts/privacy-v1.md` готовы к неделе 2. Критерий — два файла в репо + лог решений.
2. **PA: `photo_versions` prod-ready.** 4 SQL-проверки из `photo_versions-migration-proposal.md` проведены, решение по сценарию A/B/C принято, миграция канонизирована как `030_photo_versions.sql` (или ALTER-дельта), `ADR-001` подписан CoS через T-05. Критерий — миграция в репо + ADR merged.
3. **PA + QA: Playwright baseline.** Scaffold `playwright.config.ts` + `.github/workflows/e2e.yml` работает локально; первый smoke-тест (auth → project → card → slot → rate) пишется, цель к концу W2 — 2 smoke-теста (share-link + auto-rename happy). CI gate в `continue-on-error: true` (активируется blocking после W3). Критерий — первый `green` прогон в CI.
4. **DAD + PA: landing cleanup PR готов к release review.** «EU серверы» убрано полностью, «PIM в разработке» переформулировано в нейтральное, hero-badge hybrid (фотограф/команда routing — визуал DAD, форма PA) — в draft. Критерий — PR открыт, GS + DAD + LC + QA в reviewer'ах.
5. **CX + DAD: Беларусь one-pager draft.** One-pager `design/assets/belarus-onepager-v1.pdf` собран при условии, что Маша передаёт бренд + holder + канал к 5 мая. Если блокер Маши не снят до 8 мая — deliverable в cycle 2 с красной меткой в status.md. Критерий — PDF в репо ИЛИ эскалация в status.md.
6. **CoS: execution-loop rails в репо.** `/goals/current.md`, `/tasks/cycle-1-review.md`, `/project-log.md` (с первыми двумя записями 23.04 и 24.04), `/ops/automation-rules.md`, `/ops/release-review-playbook.md`, `/agents/candidate-a-tracker.md` — все созданы и Маша подписала первый approval gate в четверг 7 мая. Кандидат A: первая встреча проведена, первая строка в tracker'е записана. Критерий — 6 файлов в репо + 1 встреча + запись.
7. **GS: outbound-плейбук v0.1.** Skeleton плейбука + 2 шаблона первого касания + 1 шаблон follow-up в `docs/marketing/outbound/` к 10 мая. Short-list 3-5 фотографов-евангелистов от Маши собран (или запрошен явно с deadline). Критерий — 3 файла + список имён.

---

## Отложено (явный scope-cut для cycle 1)

- Rate Setter ↔ COS round-trip implementation — cycle 2-3 (W3-W4). Критический KPI Ставки 4, дедлайн 30 июня — не cycle 1.
- [anchor client] Google Slides deck — cycle 2 (W3-W4), после того как Маша передаст замеры «до/после» (дедлайн 15 мая).
- Owner-dashboard MVP — cycles 4-5 (W7-W8).
- Channel adaptation PoC — cycle 5-6 (W9-W10).
- Первая outbound-волна для фотографов — cycle 2-3 (W3-W4), после approval Маши 20 мая.
- Live-lawyer консультация — cycle 3 (W4), после того как брифы LC готовы.
- Video-демо auto-rename (30-60 сек) — cycle 3 (W5), деливерабл недели 5.
- [anchor client] первый чек — cycle 4 (W7-W8), KPI 15 июня.
- Candidate A mid-point — cycle 3 (W6).
- Candidate B трек — в standby до решения Маши (может быть активирован в cycle 2-3).

---

## Привязка к лейнам

| Лейн | Главный deliverable цикла 1 | Связь с Ставкой |
|------|------------------------------|------------------|
| LC (Legal) | oferta-v1 + privacy-v1 в draft | Ставка 1 |
| PA (Product Architect) | photo_versions canonical + Playwright scaffold | Ставка 4 |
| QA | Playwright setup + первый smoke + photo_versions review с PA | Ставка 4 |
| DAD (Design) | Landing cleanup (EU, PIM убраны) + brand v0.1 baseline | Ставка 5 (через лендинг) + Ставка 3 (через one-pager) |
| CX (Client Experience) | Беларусь one-pager draft + [test user A] ritual-switch | Ставка 3 |
| GS (Growth) | Outbound-плейбук v0.1 + landing copy review | Ставка 5 |
| CoS | Execution loop infrastructure + candidate A kickoff | Ставка 2 + operational backbone |

---

## Проверка через 3 недели (12-18 мая)

1. 4/4 критических (LC drafts, photo_versions, Playwright, execution loop rails) — зелёные?
2. 2/3 soft-критических (landing PR, Belarus one-pager, outbound playbook) — зелёные? Если один жёлтый — допустимо с пометкой в status.md.
3. Approval gate cycle 1 прошёл у Маши в четверг 7 мая (не позже)?
4. Кандидат A — первая встреча была, что-то сказано, строка в tracker'е есть?
5. Weekly strategy review (пятница 15 мин) — обкатан?

**Порог успеха цикла 1:** 4/7 success criteria выполнены без красных. 3/7 или меньше — retro + пересмотр подхода к cycle 2.

---

## Что требует Маша в цикле 1 (deadlines)

Это явный список — если Маша не закрывает, CoS фиксирует default и идёт дальше.

| # | Запрос | Deadline | Блокирует |
|---|--------|----------|-----------|
| M1 | Подтверждение weekly strategy review каденции (пт 15 мин) | 2026-05-01 (пт W1) | execution loop ritual |
| M2 | Ответы на 10 open questions LC (5 oferta + 5 privacy) | 2026-05-04 (пн W2) | oferta-v1 + privacy-v1 |
| M3 | Бренд + holder + канал захода в Беларусь | 2026-05-05 (вт W2) | one-pager, первое касание |
| M4 | Approval task proposals cycle 1 (approval gate) | 2026-05-07 (чт W2) | старт работы всех 7 лейнов |
| M5 | Short-list 3-5 фотографов-евангелистов (имена + короткая характеристика) | 2026-05-10 (сб W2) | outbound волна 1 (cycle 2) |
| M6 | Подтверждение бюджета 30-50к ₽ на live-lawyer + источник | 2026-05-15 (пт W3) | live-lawyer встреча (cycle 3) |
| M7 | Goal card cycle 1 — подпись | до 2026-04-28 — уже прошло де-факто (Маша апрувнула 2026-04-24) | запуск цикла |

---

## Approval

- **Сформулировал:** CoS (Claude), 2026-04-23, overnight batch.
- **Подписал:** [⏳ Маша] — дата: __________ подпись: __________
- **Формальная готовность к работе:** после подписи Машей; до того — draft для обсуждения на первой встрече.

**Следующие шаги после подписи:**
1. CoS рассылает Goal card + шаблон task proposals всем 7 агентам.
2. Агенты возвращают proposals в течение 48 часов.
3. CoS собирает `/tasks/cycle-1-review.md` (уже в репо как starter) с recommendation.
4. Approval gate — четверг 7 мая, 30 минут с Машей.
5. Старт работы — четверг вечер / пятница 8 мая.

---

Source of truth: `strategy-2026.md`, `masha-q2-plan.md`, `agent-team-v2.md`, Q2-тактические стратегии всех 7 агентов (`docs/agents/<lane>/q2-tactical-strategy-2026-04-23.md`).
Next review: Monthly review, последняя пятница мая (2026-05-29).

---

## Changelog

- **2026-04-24** — цикл 1 расширен с 2 до 3 недель по решению Маши. Первый платёж [anchor client] явно вынесен в cycle 2.
