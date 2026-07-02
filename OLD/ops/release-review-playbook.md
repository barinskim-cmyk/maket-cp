---
type: playbook
status: locked
owner: CoS
created: 2026-04-24
updated: 2026-04-24
tags:
  - ops
  - ongoing
  - ops-lane
  - playbook
  - locked
related:
  - "[[agent-team-v2]]"
  - "[[automation-rules]]"
priority: high
cycle: ongoing
---

> **TL;DR:** **Версия:** v0 (2026-04-23, overnight batch) **Next revision:** v1 к неделе 11 (2026-07-07 — Q2 retro), по опыту первых 2-3 реальных gate'ов. **Source of truth:** `agent-team-v2.md` раздел "Execution loop" + Q2-стратегии всех 7 агентов (их "Release review gate" секции). **Owner:** Chief of Staff (оркестрация), каждый agent подписывает свою часть.

# Release Review Playbook — CoS + 7 lanes

**Версия:** v0 (2026-04-23, overnight batch)
**Next revision:** v1 к неделе 11 (2026-07-07 — Q2 retro), по опыту первых 2-3 реальных gate'ов.
**Source of truth:** `agent-team-v2.md` раздел "Execution loop" + Q2-стратегии всех 7 агентов (их "Release review gate" секции).
**Owner:** Chief of Staff (оркестрация), каждый agent подписывает свою часть.

---

## Назначение

Release review gate — structured approve/block между "PA думает что готово" и "в prod / к клиенту". Это не бюрократия, а защита от регрессий, юр-рисков и tone-inconsistency.

**Принцип Маши:** «безотказность важнее функциональности». QA и PA имеют право блокировать релиз. CoS оркестрирует, не решает сам (кроме operational-only).

---

## Dynamic состав — матрица по типу релиза

### Тип A. Landing / Brand / Copy (внешний)
Примеры: обновление лендинга, outbound-волна, case study, press-kit, social post.

| Лейн | Обязателен? | Что ревьюит |
|------|-------------|--------------|
| **PA** | Да | Не ломает ли UI/перф/технически |
| **QA** | Да | Smoke копирайта в продукте, ссылки рабочие |
| **GS** | Да | Tone-of-voice Version A, CTA, нет устаревших claim'ов |
| **DAD** | Да | Визуал, типографика, brand consistency |
| **LC** | Да (если есть claim про compliance / EU / DPA / ПД) | Юр-формулировки, нет обещаний без оснований |
| **CX** | Опционально (если касается клиентского email-а) | Клиент-impact |
| **CoS** | Всегда | Оркестрация, final decision |

**Пример релиза:** landing cleanup (EU убираем, PIM переформулируем). Обязательны: PA, QA, GS, DAD, LC, CoS. CX опционально.

### Тип B. Customer-facing core (продуктовая фича)
Примеры: автопереименование, Rate Setter sync, owner-dashboard, share-link, channel adaptation, mobile client.

| Лейн | Обязателен? | Что ревьюит |
|------|-------------|--------------|
| **PA** | Да | Код, архитектура, не ломает [test user A]-flow |
| **QA** | Да | Regression suite, edge cases [anchor client]-class |
| **CX** | Да | Client impact — что меняется у [test user A] / [anchor client] / Беларуси |
| **DAD** | Да (если UI-изменения) | Визуал, UX-согласованность |
| **GS** | Опционально (если затрагивает messaging или customer-facing copy) | Tone |
| **LC** | Опционально (только если затрагивает ПД или consent) | Юр-risk |
| **CoS** | Всегда | Оркестрация + final decision (Masha signs-off) |

**Пример релиза:** Rate Setter COS round-trip → PA + QA + CX + DAD (если UI feedback), CoS. Маша подписывает customer-facing.

### Тип C. Operational (внутренняя автоматизация / инфра)
Примеры: CI/CD улучшения, observability (Sentry, error_log), backup automation, internal tools, automation rules обновление.

| Лейн | Обязателен? | Что ревьюит |
|------|-------------|--------------|
| **PA** | Да | Технически |
| **QA** | Да | Не ломает ли CI / staging / production pipeline |
| **CoS** | Всегда — и signs-off | Authorize operational, Masha не подписывает |
| Остальные | Нет | — |

**Пример релиза:** error_log таблица + sbSafeCall wrapper → PA + QA + CoS. CoS signs-off, Masha видит в weekly log.

### Тип D. Legal-sensitive (юр-документы, consent UI, billing)
Примеры: публикация оферты / privacy, чекбокс consent при регистрации, billing-форма, DPA.

| Лейн | Обязателен? | Что ревьюит |
|------|-------------|--------------|
| **LC** | Да | Юр-соответствие, formуlировки, обязательные пункты |
| **PA** | Да (если UI затронут) | Реализация checkbox'ов, форм, ссылок |
| **DAD** | Да | Consent-UI не dark pattern, equal affordance |
| **GS** | Да | Публичная копия, FAQ |
| **CX** | Да | Что говорим клиенту в onboarding, emails |
| **QA** | Да | Smoke формы, ссылки, rendering |
| **CoS** | Всегда — и signs-off | Публикация, changelog, Masha подписывает оферту |

**Пример релиза:** публикация оферты + privacy на лендинге (июнь). Обязательны все 7. Маша подписывает финальные тексты.

---

## Workflow одного release review

### Step 1. Автор фичи готовит release-ноту (T-0)

Автор (обычно PA или DAD) создаёт `/releases/YYYY-MM-DD-<feature-slug>.md`:

```markdown
# Release <name> — YYYY-MM-DD

**Type:** A / B / C / D (см. матрицу выше)
**Author:** PA / DAD / LC (автор релиза)
**Scope:** <один абзац: что изменилось>
**Files touched:** <ключевые файлы>
**Screenshots / ADR:** <ссылки>
**Migrations:** <если есть, с ADR-ID>
**Feature flags:** <если есть>
**Rollback plan:** <одно предложение>
**Known issues:** <если есть>

## Reviewers (назначены CoS)
- [ ] PA — @author или @other-PA
- [ ] QA
- [ ] (другие по матрице)

## Status cards (заполняют reviewer'ы)
### PA — <status>
<чек-лист из PA Q2-strategy §6>
### QA — <status>
<чек-лист из QA Q2-strategy>
### ...
```

### Step 2. CoS определяет состав (T-0 + 1 час)

- Читает релиз-ноту.
- По матрице выше выбирает reviewer'ов.
- Добавляет их в `reviewers` секцию.
- Рассылает через `<lane>/status.md` в каждом задействованном лейне (или pings напрямую в стендап).
- Устанавливает SLA:
  - **Тип A (landing/brand):** 24 часа — если outbound / 48 часов — если лендинг.
  - **Тип B (customer-facing):** 48 часов.
  - **Тип C (operational):** 24 часа.
  - **Тип D (legal-sensitive):** 48-72 часа, если нужна консультация LC с юристом → +1 рабочая неделя.

### Step 3. Reviewer'ы пишут status cards (T-0 до +48h)

Каждый активный reviewer заполняет свою секцию status card (см. §Status card template ниже).

### Step 4. CoS агрегирует (T + deadline)

- **All approve** → зелёный свет.
- **1+ block** → фича на hold, автор фиксит, review заново на блокирующий аспект.
- **Approve with conditions** → merge идёт, но условие идёт в `<lane>/backlog.md` с deadline (типа "доделать в cycle N+1").
- **Subjective blocker (вкусовой)** → escalate to Masha.

### Step 5. Final decision

- **Customer-facing (Тип B или D, или A если лендинг):** Masha signs-off. CoS готовит 3-5 строк "вот что готово, вот что изменится для клиента, вот что risky".
- **Operational-only (Тип C, или A если внутренний):** CoS signs-off. Masha видит в weekly log.

### Step 6. Публикация / релиз

- PA / автор выкатывает.
- QA прогоняет post-release smoke.
- CoS логирует в `/project-log.md` и архивирует release-ноту.

### Step 7. Post-release verification (T + 24-48h)

- QA daily run — нет ли регрессий.
- CX ping [test user A] / anchor клиентам — нет ли жалоб.
- Если что-то плохое — T-01 активируется, rollback.

---

## Status card template (единый для всех лейнов)

```markdown
## <Lane> — <Status: APPROVE | APPROVE WITH CONDITIONS | BLOCK>

**Reviewer:** <agent>
**Дата:** YYYY-MM-DD
**Time spent:** <~X минут>

### Что проверено (из lane-specific checklist)
- [x] <пункт 1>
- [x] <пункт 2>
- [ ] <пункт 3 — not applicable, explain>

### Notes / замечания
<1-3 строки>

### Условия (если APPROVE WITH CONDITIONS)
- <условие 1, что должно быть сделано в следующем цикле>

### Блокеры (если BLOCK)
- <конкретный блокер с шагами воспроизведения>
```

---

## Lane-specific checklists

### PA — release review checklist

Из `docs/agents/dev/q2-tactical-strategy-2026-04-23.md` §6. Сокращённо:

1. **Staging green.** Все Playwright-сценарии в CI = green.
2. **Chrome-agent advisory.** 60 сек happy-path (login → project → rate → share-link).
3. **Migration safety.** Если миграция — ADR через T-05 + CoS approved?
4. **Feature flag coverage.** Новые features за флагом?
5. **Edge cases.** [anchor client] 14.04 (data loss), 15.04 (Cyrillic), soft-delete — не регрессируют?
6. **Observability.** Новые пути пишут в error_log? Не глотают throw silent?
7. **Rollback plan.** Одно предложение про откат.

**Время:** 5-10 минут / релиз. Budget — 5k токенов.

### QA — release review checklist

Из `docs/agents/qa/q2-tactical-strategy-2026-04-23.md` §5-6. Сокращённо:

1. **Pre-release regression suite зелёный.** 22+ тестов к концу Q2.
2. **Smoke Chrome-agent (3-5 GP сценариев) зелёный.**
3. **Bug-list пуст для данной фичи** (или все известные — в `known issues`).
4. **Edge cases покрыты** из lane-audit (S1-S5, E1-E7 auto-rename; I1-I7 Rate Setter).
5. **Data integrity** (dashboard vs source-of-truth; Cyrillic path; soft-delete; photo ID).
6. **Acceptance criteria от Маши** удовлетворены (если customer-facing).

**Время:** 15-30 минут / релиз.

### GS — release review checklist

Из `docs/agents/marketing/q2-tactical-strategy-2026-04-23.md` §6. Сокращённо:

1. **Version A tone.** Нет "DAM", "бизнес-аналитик", "CRM для фотографов".
2. **Нет устаревших claim'ов.** EU серверы, PIM в разработке, SOC 2 / ISO / GDPR-compliant — удалены или смягчены.
3. **Tone consistency.** Для фотографов "от-коллеги", для владельцев — деловой с цифрами.
4. **CTA.** Один на материал, явный, измеримый.
5. **Aud.-fit.** Одно сообщение одной аудитории.
6. **Reality check vs `/dev/status.md`.** Не обещаем того, что падает в QA.

**Время:** 24-48 часов / материал.

### DAD — release review checklist

Из `docs/agents/design/q2-tactical-strategy-2026-04-23.md` §6. Сокращённо:

1. **Brand system consistency.** Палитра, typography, tone-of-voice соответствуют `design/brand/brand.md`.
2. **Нет emoji / иконок где не попросили явно** (правило Маши).
3. **Consent UI — не dark pattern.** Equal affordance для accept/decline.
4. **Screenshots / визуал в копирайте = актуальные** (не старые скрины из audit до cleanup).
5. **Accessibility basics.** Контраст, touch-target ≥ 44px, keyboard-nav (mobile basics).
6. **OG / favicon / wordmark при шеринге ок.**

**Время:** 15-30 минут / релиз.

### CX — release review checklist

1. **Client impact clear.** Что изменится у [test user A] / [anchor client] / Беларусь — ясно?
2. **Onboarding не сломан.** Если меняется первый UX — onboarding-скрипт обновлён?
3. **Communication план.** Если фича затрагивает anchor — CX готов объяснить клиенту до релиза.
4. **Bug-history** — не возвращаемся в баг из `/bugs/`?

**Время:** 15-20 минут / релиз.

### LC — release review checklist

Из `docs/agents/legal/q2-tactical-strategy-2026-04-23.md` §6. Сокращённо:

1. **Consent-текст** соответствует privacy + оферте. Нет dark pattern.
2. **Claim'ы про compliance** (SOC 2, GDPR, EU, "ваши данные защищены") — каждый подтверждён фактом или смягчён.
3. **Privacy §7** (субобработчики) обновлена, если меняется subprocessor.
4. **Ссылки рабочие.** footer, регистрация, client-view → на актуальные версии оферты + privacy.
5. **Изменение оферты** → уведомление существующих клиентов за 30 дней.

**Время:** 1-2 рабочих дня / релиз с LC-касанием.

### CoS — release review oversight

Не своя секция в status card, но у CoS свой mini-checklist:

1. Все обязательные по матрице reviewer'ы назначены?
2. SLA прошёл, нет hang'а без ответа?
3. Blocker'ы учтены или разрешены?
4. Customer-facing? → pack для Masha signs-off.
5. Operational? → CoS signs-off, лог в weekly.
6. Post-release verification назначена (CX + QA)?

**Время:** 5 минут оркестрации / релиз.

---

## Escalation — кто решает блок

| Ситуация | Кто решает | Как |
|-----------|-----------|-----|
| PA блокирует по технической причине | PA | Конкретная починка → re-review |
| QA блокирует по regression / critical bug | QA | T-07 активируется, PA return |
| LC блокирует по юр-риску | LC + CoS | LC объясняет risk, CoS + Masha принимают trade-off |
| GS блокирует по tone-mismatch (subjective) | GS + CoS | GS правит копирайт; если спорно — Masha |
| DAD блокирует по визуалу (subjective) | DAD + CoS | DAD правит; если спорно — Masha |
| Два agent'а блокируют ≥ 3 итераций | CoS + Masha | 30-мин meet, scope-cut или pivot |
| Timing blocker (в окно не успеваем) | CoS | Defer в следующий cycle, communication клиенту если затронут |

**Masha signs-off customer-facing.** CoS signs-off operational. Нет третьего варианта в v0.

---

## Release-нота примеры (trim)

### Пример Тип A: landing cleanup

```
# Release landing-cleanup-2026-05-11

Type: A
Author: DAD + GS
Scope: Убраны упоминания "EU серверы" и "PIM в разработке" из landing.html. Hero-badge теперь routing-форма "фотограф / команда".
Files touched: v2/frontend/landing.html, design/brand/brand.md, design/ui/hero-badge-mockup.html
Rollback plan: git revert commit SHA, landing откатывается за 30 сек.

Reviewers:
- [ ] PA — landing.html не ломает
- [ ] QA — smoke форм, ссылки
- [ ] GS — копирайт Version A
- [ ] DAD — визуал
- [ ] LC — не осталось claim'ов про EU / compliance
- [ ] CoS — оркестрация, Masha sign-off

SLA: 48 часов на 7 мая чт 18:00.
```

### Пример Тип D: публикация оферты

```
# Release oferta-v2-publication-2026-06-08

Type: D
Author: LC + CoS
Scope: Публикация финальной оферты v2.0 (правки live-lawyer) и обновлённой privacy v2.0 на лендинге + регистрации. Чекбокс consent добавлен.
Files touched: v2/frontend/privacy.html, v2/frontend/landing.html, v2/frontend/components/consent-checkbox.js, supabase.js (consent column)
Migrations: YES — `033_consent_events.sql` под T-05 (ADR-007)
Rollback plan: db migration reversible, landing + privacy обратно через git revert.

Reviewers:
- [ ] LC — оферта + privacy финал соответствует
- [ ] PA — checkbox реализован, migration ок
- [ ] QA — regression форм регистрации + client-view
- [ ] DAD — consent UI не dark pattern
- [ ] GS — копирайт FAQ обновлён
- [ ] CX — onboarding-скрипт упоминает оферту
- [ ] CoS — оркестрация + Masha signs-off оферту

SLA: 72 часа, дедлайн финализации 8 июня.
```

---

## Что CoS записывает в `/project-log.md` по итогам

```
### Release YYYY-MM-DD — <name>
Type: A/B/C/D
Reviewers: <list with status>
Approve: <list> | Block: <list or none>
Decision: <customer-facing Masha / operational CoS>
Signed off by: Masha YYYY-MM-DD / CoS YYYY-MM-DD
Post-release: <pending | clean | issues found>
```

---

## Roadmap v1 (неделя 11 retro)

По опыту Q2:

1. Какие типы релизов имеют слишком большой состав? Кого можно сделать опциональным?
2. Какие SLA не выдерживаются? Нужно ли удлинить или ускорить?
3. Какие блоки повторяются? Это сигнал добавить автотест или процесс "до release-gate".
4. Нужно ли split тип D на podt'типы (billing vs oferta vs DPA)?
5. Чек-лист дорабатывается по реальным find'ам.

---

Source of truth: `agent-team-v2.md` + Q2-стратегии агентов release-review секции.
Owner: CoS.
Changelog: 2026-04-23 v0 — создан (overnight batch, CoS autonomous).
