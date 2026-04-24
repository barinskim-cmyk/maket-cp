---
type: status
status: locked
owner: LC
created: 2026-04-24
updated: 2026-04-24
tags:
  - legal
  - ongoing
  - legal-lane
  - locked
related:
  - "[[agent-team-v2]]"
  - "[[strategy-2026]]"
priority: high
cycle: ongoing
---

> **TL;DR:** **Обновляется:** при активации (cyclical, по триггерам). В standby — `standby since <date>, last activity <...>`.

# Legal Counsel (LC) — Status

**Обновляется:** при активации (cyclical, по триггерам). В standby — `standby since <date>, last activity <...>`.

---

## Текущий статус

**Статус:** active — Phase 6 (Tier-1 locked, v1.0 ready for lawyer review), 2026-04-24.
**Следующая активация:** до 30 мая 2026 — live-lawyer consultation Q2 (обязательный trigger), см. `regulatory-watch.md` запись от 2026-04-24. Подробный бриф юристу — собрать в неделю 2 (5–11 мая).

### v1.0 drafts — status

| Документ | Версия | Статус |
|---|---|---|
| Публичная оферта | `drafts/oferta-v1.0.md` | READY for live-lawyer review; 7 Tier-1 locked (2026-04-24); 11 Tier-2 defaults применены автономно LC; ⚠️ маркеры сняты полностью. |
| Политика конфиденциальности | `drafts/privacy-policy-v1.0.md` | READY for live-lawyer review; 1 Tier-1 locked (§8.3 РКН); 8 Tier-2 defaults применены; ⚠️ маркеры сняты полностью. |
| DPA | `drafts/dpa-skeleton-v0.9.md` | skeleton без изменений; активируется по запросу Заказчика. |
| Triage defaults | `drafts/defaults-triage-2026-04-24.md` | исходный документ (locked basis для v1.0). |

**Blocker для публикации:** review живого юриста + внесение формальных полей (ИНН, ОГРНИП, фактические реквизиты).

---

## Last activation summary

**Дата:** 2026-04-23.
**Триггер:** Phase 5 (тактика Q2 — координатор Ставки 3 anchor sales).
**Артефакты:**
- `docs/agents/legal/q2-tactical-strategy-2026-04-23.md` — Q2 тактика, 12-недельный план, deliverables, риски.
- (ранее) `docs/agents/legal/understanding-2026-04-23.md` — Phase 3.
- (ранее) `docs/agents/legal/audit-2026-04-23.md` — Phase 3.
- (ранее) `docs/agents/legal/key-docs-index-2026-04-23.md` — Phase 3.
- (ранее) `docs/agents/legal/regulatory-watch.md` — baseline.
- (ранее) `docs/agents/legal/drafts/oferta-skeleton.md`, `privacy-policy-skeleton.md`, `dpa-template-skeleton.md`.

**Outcome:** Q2-план зафиксирован. Главный блок — оферта + privacy к 8 июня → подпись [anchor client] 15 июня. Ждём Машу: бюджет 30-50к ₽, ответы на 10 open questions, контакт юриста.

---

## Active items / Q2 priority

1. **Оферта для [anchor client]** — skeleton готов (`drafts/oferta-skeleton.md`). Активируется, когда Маша подтверждает, что [anchor client] готова к подписанию. До активации — не нанимаем живого юриста, skeleton замораживается.
2. **Privacy policy обновление на лендинге** — skeleton готов (`drafts/privacy-policy-skeleton.md`). Активируется одновременно с подготовкой оферты (не позже 2026-05-15).
3. **Regulatory watch** — пассивный мониторинг (см. `regulatory-watch.md`). Обновление — при появлении существенных изменений в 152-ФЗ / НК РФ / НПД.

---

## Triggers to watch (переносится из audit §5)

| Триггер | Статус на 2026-04-23 |
|---|---|
| [anchor client] запрашивает DPA | не запрошен |
| Клиент задаёт вопрос о локализации ПДн | не поднят |
| НПД-лимит приближается (2 млн ₽ выручка за год) | не приближается, выручка 0 на 2026-04-23 |
| Жалоба тестера / клиента | нет |
| Инцидент с данными (утечка, потеря) | последний 14-15 апреля (data loss + cyrillic) — не регуляторные |
| Изменение ФЗ (152, НПД, УСН) в сторону ужесточения | 30 мая 2026 — повышение штрафов 152-ФЗ (мониторим, не активируем) |
| CX / CoS запрашивают консультацию | не запрошена |

---

## Requests out / waiting for

| От кого | Что жду | Дата запроса |
|---|---|---|
| Masha | Ответы на 7 open questions (audit §6) | 2026-04-23 |
| CoS | Подтверждение готовности к юр-разблокировке (Ставка 1, deadline 2026-05-15) | 2026-04-23 |
| PA | Окончательное подтверждение региона Supabase для формулировки §7-8 privacy + §8 DPA | 2026-04-23 |
| CX | Уточнение, какой запас времени между готовой офертой и первым выставленным счётом [anchor client] | 2026-04-23 |

---

## Активация LC — кто может триггерить

- **Маша** — прямо, любой срочный вопрос.
- **CoS** — при ops-блокере, требующем юр-позиции.
- **CX** — при вопросе клиента, требующем юр-формулировки.
- **PA** — при технической правке, затрагивающей ПДн / subject matter.
- **GS** — при внешнем обещании продукта, требующем юр-проверки.
- **QA** — при функциональном регресе юр-чекпоинтов (checkbox согласия, privacy link).

Сам LC в standby не проактивирует (кроме regulatory-watch обновлений ежемесячно).

---

## Бюджет живого юриста — Q2 2026

| Случай | Оценка стоимости |
|---|---|
| Первая консультация (review оферта + privacy + 2-3 open questions) | 30-50 000 ₽ |
| Правка по комментариям [anchor client] после pitch | +10-20 000 ₽ |
| Активация DPA по запросу enterprise | 20-30 000 ₽ |
| Retainer (опционально, при росте объёма) | 15-25 000 ₽/мес |

**Итого Q2 минимум:** 30-50 000 ₽ (одноразово, одна консультация).
**Источник:** отложенные 300 000 ₽ Маши.

---

## Known issues / risks

1. **Supabase Frankfurt = de facto трансграничная передача ПДн.** Статус-кво риск. Активируется, когда клиент спросит.
2. **Регистрация в реестре операторов ПДн пропущена (не подано уведомление).** Сознательная позиция (принцип Маши). Активируется, когда регулятор / клиент потребует.
3. **Расширение ОКВЭД на 62.01/62.02 не оформлено.** Сознательно отложено. При переходе на УСН оформим в одном блоке.
4. **152-ФЗ ст.18 ч.5 (локализация ПДн граждан РФ) — не соблюдается.** Статус-кво риск. Активируется при enterprise compliance-запросе.

---

## Changelog

- **2026-04-24** — Tier-1 locked Машей (7 решений). LC выпустил `oferta-v1.0.md` и `privacy-policy-v1.0.md` — ready for live-lawyer review. Tier-2 defaults применены автономно LC (~20 штук суммарно). Все ⚠️ маркеры сняты. Trigger: live-lawyer consultation до 30 мая 2026.
- **2026-04-23** — inaugural activation, Phase 3 individual audit. Skeleton юр-лейна создан: understanding, audit, key-docs-index, status, regulatory-watch, 3 drafts skeleton. LC переходит в standby.

---

**Source of truth:** `strategy-2026.md` Ставка 1, `agent/memory/project_growth_over_formalism.md`, `docs/agents/legal/audit-2026-04-23.md`, `docs/agents/ops/okved-research-2026-04-23.md`.
