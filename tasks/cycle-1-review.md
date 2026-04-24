---
type: doc
status: active
owner: CoS
created: 2026-04-24
updated: 2026-04-24
tags:
  - ops
  - q2
  - ops-lane
  - client-a
related:
  - "[[strategy-2026]]"
  - "[[automation-rules]]"
priority: medium
cycle: Q2
---

> **TL;DR:** **Период цикла:** 2026-04-28 – 2026-05-11 (2 недели) **Goal card:** `/goals/current.md` **Состояние:** DRAFT (собран CoS 2026-04-23 на базе Q2-стратегий агентов). Ждёт proposals от агентов + approval Маши в четверг 7 мая. **Формат:** каждый task — ≤ 3 строки, с owner / week / deps / recommendation.

# Cycle 1 Review — Task Proposals

**Период цикла:** 2026-04-28 – 2026-05-11 (2 недели)
**Goal card:** `/goals/current.md`
**Состояние:** DRAFT (собран CoS 2026-04-23 на базе Q2-стратегий агентов). Ждёт proposals от агентов + approval Маши в четверг 7 мая.
**Формат:** каждый task — ≤ 3 строки, с owner / week / deps / recommendation.

---

## 1. Task proposals by agent (draft от CoS, pre-fill из Q2-стратегий)

### 1.1. PA — Product Architect
Источник: `docs/agents/dev/q2-tactical-strategy-2026-04-23.md` недели 1-2.

- [ ] **PA-1.** `photo_versions` prod SQL-проверки (4 запроса из `photo_versions-migration-proposal.md` §4.5). W1. Deps: MCP Supabase или SQL Editor. Deliverable: лог результатов → решение по сценарию A/B/C.
- [ ] **PA-2.** Канонизация миграции → `030_photo_versions.sql` (или ALTER-дельта по B/C). W1. Deps: PA-1. Deliverable: файл в репо.
- [ ] **PA-3.** `ADR-001` — photo_versions canonical migration. W1. Deps: PA-2, T-05 CoS approve. Deliverable: `docs/agents/dev/adr/001-photo-versions-canonical-migration.md`.
- [ ] **PA-4.** Playwright + GitHub Actions scaffold (`package.json`, `playwright.config.ts`, `.github/workflows/e2e.yml`). W1. Deps: —. Deliverable: CI job проходит локально, `continue-on-error: true` в main.
- [ ] **PA-5.** Fixture-проект для Chrome-agent staging (Машин собственный, не [anchor client]). W1-W2. Deps: Маша → QA передача снапшота (дедлайн 10 мая). Deliverable: `tests/fixtures/masha-[anchor client]-clone-2026-05.json`.
- [ ] **PA-6.** `ADR-002` — Rate Setter COS round-trip архитектура. W2. Deps: PA-3 merged. Deliverable: `docs/agents/dev/adr/002-rate-setter-cos-roundtrip.md`.
- [ ] **PA-7.** Первый smoke-Playwright: auth → project → card → slot → rate → load versions. W2. Deps: PA-4, PA-5. Deliverable: `tests/e2e/smoke-auth-project-rate.spec.ts`.
- [ ] **PA-8.** Audit `articles.js` rename-all (exists / partial / missing). W2. Deps: —. Deliverable: отчёт в `/dev/status.md`.

### 1.2. CX — Client Experience
Источник: `docs/agents/clients/q2-tactical-strategy-2026-04-23.md` недели 1-2.

- [ ] **CX-1.** Kick-off retro: status.md → план цикла 1. Уведомление CoS/DAD/GS/LC. W1 пн. Deliverable: `/clients/status.md` обновлён.
- [ ] **CX-2.** Brief DAD на Беларусь one-pager (структура, блоки, tone, дедлайн 10 мая). W1. Deps: —. Deliverable: `docs/agents/clients/briefs/belarus-onepager-brief.md`.
- [ ] **CX-3.** [test user A] ritual-switch: переход с ad-hoc на weekly ping (5 мин мессенджер, crisis-only retro). W1. Deps: Маша одобряет формат. Deliverable: запись в `/clients/[anchor client]/retro-process.md`.
- [ ] **CX-4.** Беларусь one-pager финализирован совместно с DAD + GS (копирайт CX, визуал DAD, тональность GS). W2. Deps: Маша передала бренд + holder + канал (5 мая). Deliverable: PDF + исходник.
- [ ] **CX-5.** Координация с QA формата `/bugs/YYYY-MM-DD.md` (теги, SLA, severity). W1-W2. Deps: QA-4. Deliverable: `/bugs/README.md` согласован.
- [ ] **CX-6.** Приём у Маши замеров «до/после» [anchor client] (начало сбора). W2. Deps: — (CX не блокируется). Deliverable: `/clients/[anchor client]/before-after.md` в статусе "in progress".
- [ ] **CX-7.** Friday approval gate: первый статус-update цикла 1. W2 пт. Deliverable: одна запись в `/clients/status.md`.

### 1.3. GS — Growth Strategist
Источник: `docs/agents/marketing/q2-tactical-strategy-2026-04-23.md` недели 1-2.

- [ ] **GS-1.** Landing cleanup — вычитка копирайта (EU серверы убрать, «PIM в разработке» переформулировать, проверка hero на Version A). W1-W2. Deps: DAD-1, PA coordinate. Deliverable: отредактированный текст в PR.
- [ ] **GS-2.** Outbound-плейбук v0.1 для фотографов (skeleton + 2 шаблона первого касания + 1 follow-up). W2 дедлайн 5 мая (draft) → 10 мая (review CoS + CX). Deliverable: `docs/marketing/outbound/playbook-v01.md`.
- [ ] **GS-3.** Hero-badge routing logic + копирайт формы беты (фотограф/команда). W1-W2. Deps: DAD-2 макет, PA-форма. Deliverable: копирайт в `docs/marketing/content/hero-badge-copy.md`.
- [ ] **GS-4.** Short-list 3-5 фотографов-евангелистов совместно с Машей. W2 дедлайн 10 мая. Deps: M5 (Маша). Deliverable: список в `marketing/status.md`.
- [ ] **GS-5.** Подготовка 5-10 персонализированных outreach-сообщений для short-list. W2. Deps: GS-4. Deliverable: draft сообщений, Маша посылает лично в cycle 2.
- [ ] **GS-6.** Подтверждение фикстуры Chrome-agent = Машин проект (с PA). W1. Deps: PA-5. Deliverable: пометка в `marketing/status.md`.

### 1.4. DAD — Design / Art Director
Источник: `docs/agents/design/q2-tactical-strategy-2026-04-23.md` неделя 1.

- [ ] **DAD-1.** Landing cleanup visual pass: убрать «EU серверы», переформулировать «PIM в разработке», проверить hero на Version A. W1. Deps: GS-1 copy. Deliverable: обновлённый `landing.html` (правит PA по спекам).
- [ ] **DAD-2.** Hero-badge hybrid form: один form с первым Q «фотограф / команда», dynamic follow-up поля. Макет статического HTML-mock. W1-W2. Deps: GS-3 copy. Deliverable: `design/ui/hero-badge-mockup.html` + спека для PA.
- [ ] **DAD-3.** Brand system v0.1: `design/brand/brand.md` (палитра, typo, tone-of-voice). W1. Deliverable: файл в репо.
- [ ] **DAD-4.** Wordmark SVG (3 варианта: full / mark / icon) + favicon (16/32/48/180/192/512) + OG-image 1200×630 + email-header 1200×300. W1. Deliverable: `design/brand/logo/`, `favicon/`, `og/`.
- [ ] **DAD-5.** Review с Машей (30 мин): палитра, typography, accent-цвет (варианты A/B/C), финальная формулировка subtitle. W1. Deps: M (Маша review slot). Deliverable: подпись Маши в `design/brand/brand.md`.

### 1.5. QA — Test Engineer
Источник: `docs/agents/qa/q2-tactical-strategy-2026-04-23.md` неделя 1.

- [ ] **QA-1.** `photo_versions` blocker closure совместно с PA: проверка 4 SQL-запросов, совместное решение A/B/C. W1. Deps: PA-1. Deliverable: подпись QA в `ADR-001`.
- [ ] **QA-2.** Playwright setup в CI (проверка `playwright.config.ts`, workflow). W1. Deps: PA-4. Deliverable: CI gate работает в `continue-on-error: true` до W3.
- [ ] **QA-3.** Первый smoke-suite: 2 теста. (1) Share-link — открытие проекта по ссылке без логина, видимость карточек. (2) Автопереименование happy path (5 фото, Rate Setter, переименование). W1-W2. Deps: PA-4, PA-5. Deliverable: `tests/e2e/smoke-*.spec.ts` × 2.
- [ ] **QA-4.** `/bugs/` процесс с CX: формат, теги, SLA. W1-W2. Deps: CX-5. Deliverable: `/bugs/README.md`, `/qa/bug-process.md`.
- [ ] **QA-5.** Запрос Маше снапшота тестового проекта (не [test user A], Машин собственный) → golden-dataset для Chrome-agent. W1. Deps: Маша передача 10 мая. Deliverable: `test-fixtures` bucket + запись.

### 1.6. LC — Legal Counsel
Источник: `docs/agents/legal/q2-tactical-strategy-2026-04-23.md` недели 1-2.

- [ ] **LC-1.** Запрос Маше на 10 open questions (5 oferta + 5 privacy, audit §6.1-6.2). W1. Deadline ответа Маши — 4 мая. Fallback: defaults. Deliverable: `docs/agents/legal/decisions-q2.md` с ответами или default'ами.
- [ ] **LC-2.** Запрос в CX на требования compliance-отдела [anchor client] (если есть зафиксированные). W1. Deps: — (CX отвечает on-demand). Deliverable: лог в `decisions-q2.md`.
- [ ] **LC-3.** Актуализация `oferta-skeleton.md` под ответы Маши → `drafts/oferta-v1.md`. W2. Deps: LC-1. Deliverable: файл без [плейсхолдеров].
- [ ] **LC-4.** Diff `privacy.html` (2026-04-20) против `privacy-policy-skeleton.md` → `drafts/privacy-v1.md` + diff-отчёт. W2. Deps: LC-1. Deliverable: 2 файла в drafts/ + список missing clauses.
- [ ] **LC-5.** Подготовка бюджета + шорт-лист 3 кандидатов-юристов (founder-сеть приоритет). W2. Deps: M6 (бюджет от Маши). Deliverable: `docs/agents/legal/lawyer-shortlist-2026-05.md` (готовится к cycle 3 консультации).

### 1.7. CoS — Chief of Staff
Источник: `docs/agents/ops/q2-tactical-strategy-2026-04-23.md` недели 1-2.

- [ ] **CoS-1.** `/goals/current.md` — goal card cycle 1 (готов, ждёт подписи Маши). W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-2.** `/tasks/cycle-1-review.md` — этот файл. W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-3.** `/project-log.md` — starter + первая запись 23.04 + первая запись 24.04. W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-4.** `/ops/automation-rules.md` — T-01..T-07, trigger/action/success/failure/example. W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-5.** `/ops/release-review-playbook.md` — матрица состава, status card, escalation. W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-6.** `/agents/candidate-a-tracker.md` — 6 недель × 5 критериев + decision form. W1. Deliverable: ✅ файл создан 2026-04-23.
- [ ] **CoS-7.** Первая встреча кандидата A ([anchor client] pack как задача). W1. Deps: Маша подтверждает время. Deliverable: первая строка в tracker'е.
- [ ] **CoS-8.** LC kickoff: scope-лист передан (юр-разблокировка ИП, 2 документа + консультация). W1. Deps: —. Deliverable: пометка в `/ops/status.md` или `/project-log.md`.
- [ ] **CoS-9.** Weekly strategy review с Машей — пятница 15 мин, W1 и W2. Deps: M1. Deliverable: 2 записи в `/project-log.md`.
- [ ] **CoS-10.** Первый approval gate cycle 1 — четверг 7 мая, 30 минут с Машей. Deps: все 7 proposals присланы. Deliverable: approved / cut / defer в этом файле.
- [ ] **CoS-11.** `ADR-001` approval через T-05 (когда PA закроет PA-3). W1-W2. Deliverable: подпись CoS в ADR-001.

---

## 2. Сводная таблица (all 7 lanes × first 2 weeks)

| # | Agent | Task | Week | Deps | Deadline | Recommendation |
|---|-------|------|------|------|----------|----------------|
| PA-1 | PA | photo_versions SQL-проверки (4 запроса) | W1 | MCP или SQL Editor | 30 апр | **Approve** — блокер всего ядра |
| PA-2 | PA | Канонизация миграции 030_photo_versions.sql | W1 | PA-1 | 4 мая | **Approve** |
| PA-3 | PA | ADR-001 photo_versions canonical | W1 | PA-2, T-05 | 4 мая | **Approve** |
| PA-4 | PA | Playwright + GitHub Actions scaffold | W1 | — | 4 мая | **Approve** — не релизим без него |
| PA-5 | PA | Fixture-проект Chrome-agent (Машин проект) | W1-W2 | Маша (10 мая) | 10 мая | **Approve** |
| PA-6 | PA | ADR-002 Rate Setter COS round-trip | W2 | PA-3 | 11 мая | **Approve** |
| PA-7 | PA | Первый smoke-Playwright (auth→rate) | W2 | PA-4, PA-5 | 11 мая | **Approve** |
| PA-8 | PA | Audit articles.js rename-all | W2 | — | 11 мая | **Approve** |
| CX-1 | CX | Kick-off retro → план | W1 пн | — | 28 апр | **Approve** |
| CX-2 | CX | Brief DAD на Беларусь one-pager | W1 | — | 2 мая | **Approve** |
| CX-3 | CX | [test user A] ritual-switch weekly ping | W1 | Маша | 5 мая | **Approve** |
| CX-4 | CX | Беларусь one-pager финал | W2 | Маша (5 мая), DAD, GS | 10 мая | **Approve с условием** (если блокер Маши — defer в cycle 2) |
| CX-5 | CX | Coord `/bugs/` формата с QA | W1-W2 | QA-4 | 11 мая | **Approve** |
| CX-6 | CX | Приём замеров «до/после» [anchor client] | W2 | — | 15 мая (выход в cycle 2) | **Approve** — старт сбора |
| CX-7 | CX | Friday status update | W2 пт | — | 11 мая | **Approve** |
| GS-1 | GS | Landing cleanup копирайт | W1-W2 | DAD-1 | 11 мая | **Approve** |
| GS-2 | GS | Outbound-плейбук v0.1 | W2 | — | 10 мая | **Approve** |
| GS-3 | GS | Hero-badge routing copy | W1-W2 | DAD-2, PA | 11 мая | **Approve** |
| GS-4 | GS | Short-list 3-5 фотографов | W2 | M5 (Маша) | 10 мая | **Approve** — зависит от Маши |
| GS-5 | GS | 5-10 персонализированных сообщений | W2 | GS-4 | 11 мая | **Approve** — draft, рассылка в cycle 2 |
| GS-6 | GS | Подтверждение фикстуры = Машин проект | W1 | PA-5 | 4 мая | **Approve** |
| DAD-1 | DAD | Landing cleanup visual pass | W1 | GS-1 | 4 мая | **Approve** |
| DAD-2 | DAD | Hero-badge hybrid form mockup | W1-W2 | GS-3 | 11 мая | **Approve** |
| DAD-3 | DAD | Brand system v0.1 `brand.md` | W1 | — | 4 мая | **Approve** |
| DAD-4 | DAD | Wordmark + favicon + OG + email-header | W1 | — | 4 мая | **Approve** — закрывает видимую дыру |
| DAD-5 | DAD | Review Маши палитра + accent + subtitle | W1 | Маша | 4 мая | **Approve** — блокер для lab SVG финала |
| QA-1 | QA | photo_versions blocker closure с PA | W1 | PA-1 | 30 апр | **Approve** |
| QA-2 | QA | Playwright setup в CI | W1 | PA-4 | 4 мая | **Approve** |
| QA-3 | QA | 2 smoke-теста (share-link + auto-rename) | W1-W2 | PA-4, PA-5 | 11 мая | **Approve** |
| QA-4 | QA | `/bugs/` процесс с CX | W1-W2 | CX-5 | 11 мая | **Approve** |
| QA-5 | QA | Запрос Маше снапшота тест-проекта | W1 | Маша (10 мая) | 10 мая | **Approve** — critical fixture |
| LC-1 | LC | Запрос Маше 10 open questions | W1 | Маша (4 мая) | 4 мая | **Approve** — иначе default'ы |
| LC-2 | LC | Запрос в CX compliance [anchor client] | W1 | CX (ответ) | 11 мая | **Approve** |
| LC-3 | LC | oferta-v1.md | W2 | LC-1 | 11 мая | **Approve** — блокер Ставки 1 |
| LC-4 | LC | privacy-v1.md + diff | W2 | LC-1 | 11 мая | **Approve** |
| LC-5 | LC | Бюджет + шорт-лист 3 юристов | W2 | M6 (Маша) | 11 мая | **Approve** — подготовка к cycle 3 |
| CoS-1..6 | CoS | Execution loop infrastructure | W1 | — | ✅ 2026-04-23 done | **Approve** — уже сделано |
| CoS-7 | CoS | Первая встреча кандидата A | W1 | Маша (время) | 2 мая | **Approve** |
| CoS-8 | CoS | LC kickoff scope-лист | W1 | — | 28 апр | **Approve** |
| CoS-9 | CoS | Weekly strategy review (пт 15 мин) | W1, W2 | M1 | 1 мая, 8 мая | **Approve** — ритм всего цикла |
| CoS-10 | CoS | Approval gate cycle 1 | W2 чт | Все proposals | 7 мая | **Approve** — это сам gate |
| CoS-11 | CoS | ADR-001 T-05 approval | W1-W2 | PA-3 | 11 мая | **Approve** |

**Итого:** 42 task proposals, recommendation все 42 approve (6 с условием / fallback).

---

## 3. Конфликты, которые CoS поймал

1. **PA-5 ↔ QA-5 ↔ GS-6** — фикстура Chrome-agent: PA готовит, QA запрашивает у Маши, GS подтверждает принцип «Машин проект». Один owner (PA), остальные — read-only / confirmations. Не дублировать работу.
2. **DAD-1 ↔ GS-1** — landing cleanup: DAD делает визуал, GS делает копирайт. PA сливает в `landing.html`. Порядок: GS copy → DAD visual → PA merge → release review.
3. **LC-1 ↔ M2** — ответы Маши на 10 open questions. Если к 4 мая ответа нет — LC фиксирует default'ы и идёт дальше. Маша не должна быть в критическом пути больше 3 рабочих дней.
4. **CX-4 ↔ M3** — Беларусь one-pager: если Маша не дала бренд+holder+канал до 5 мая, CX-4 defer'ится в cycle 2 с красной меткой. Не блокируем весь Беларусь трек, если одно ограничение.
5. **PA-3 ↔ CoS-11** — T-05 approval: PA готовит ADR-001, CoS подписывает. Важно — CoS не "рассматривает месяц", SLA 24 часа.

---

## 4. Approval

### Approved (Маша подписала ____)

_(Заполняется Машей на approval gate 7 мая)_

- [ ]
- [ ]
- [ ]

### Cut (Маша отклонила)

- [ ]

### Deferred to cycle 2

- [ ]

### Open questions (не попали ни в одну категорию)

- [ ]

---

## 5. Approval signature

- **Сформулировал:** CoS (Claude), 2026-04-23, overnight batch на базе Q2-стратегий всех 7 агентов.
- **Валидировал:** [⏳ CoS на weekly check-in пн-пт W1 — скорректирует по proposals от живых агентов]
- **Подписал Маша:** __________ дата __________

---

## 6. После approval gate

1. Cut/defer — записывается в этот файл.
2. CoS рассылает approved list каждому агенту в их `status.md`.
3. Старт работы — четверг вечер 7 мая / пятница 8 мая.
4. Следующий check-point — пятница 8 мая, weekly strategy review + project-log запись.
5. Closure cycle 1 — понедельник 12 мая, retro и старт cycle 2.

---

Source of truth: `/goals/current.md` + `docs/agents/<lane>/q2-tactical-strategy-2026-04-23.md` × 7.
