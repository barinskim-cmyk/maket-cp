---
type: doc
status: active
owner: Masha
created: 2026-04-23
updated: 2026-04-24
tags:
  - ongoing
  - client-a
related: []
priority: critical
cycle: ongoing
---

> **TL;DR:** **Статус:** СКЕЛЕТ — не источник правды, ждёт заполнения/решения Маши. **Дата:** 2026-04-23 (создан Claude в autonomous cleanup по результатам reconciliation audit п.1.4 и 4.4). **Референс:** `audits/coordinator-reconciliation-2026-04-23.md` п.1.4; `project_monetization.md` (memory); `strategy-2026.md` раздел 3 ставка 3; `project_brand_client_continuity.md` (memory).

# Monetization matrix — Maket CP (черновик для заполнения Машей)

**Статус:** СКЕЛЕТ — не источник правды, ждёт заполнения/решения Маши.
**Дата:** 2026-04-23 (создан Claude в autonomous cleanup по результатам reconciliation audit п.1.4 и 4.4).
**Референс:** `audits/coordinator-reconciliation-2026-04-23.md` п.1.4; `project_monetization.md` (memory); `strategy-2026.md` раздел 3 ставка 3; `project_brand_client_continuity.md` (memory).

---

## Зачем этот документ

В разных источниках фигурируют **четыре параллельных SKU**, но нет единой таблицы «какой SKU кому и когда»:

1. **Per-project 500 ₽** — фотограф платит за проект (3 мес retention).
2. **Studio pack 10×400 ₽** — студия покупает пакет, экономит 20%.
3. **Anchor monthly 30 000 ₽/мес** — бренд-инхаус ([anchor client]).
4. **Brand annual subscription** — бренд платит за cross-season continuity + brand cabinet.

Без этой сводной матрицы GS не может писать консистентный pack-оффер, а [anchor client]/Беларусь — получат разные формулировки цен.

---

## Матрица (заполнить — Маша)

| Параметр | Per-project (фотограф) | Studio pack (продакшн) | Anchor monthly (бренд-инхаус) | Brand annual (бренд subscription) |
|---|---|---|---|---|
| **Кто покупает** | фотограф (сам для своего проекта) | студия / продакшн | бренд-инхаус ([anchor client]-тип) | бренд (долгосрочный) |
| **Цена** | ~500 ₽ | 4000 ₽ за 10 проектов (400/проект) | 30 000 ₽/мес | _TBD (рекомендую ≥ 300 000 ₽/год)_ |
| **Retention данных** | 3 месяца | 3 месяца / до истечения пакета | постоянно пока платит | постоянно пока платит |
| **Что включает** | 1 проект, базовый pipeline, share-link | 10 проектов (расходуются), все pipeline-фичи | unlimited проекты, brand cabinet, поддержка | unlimited + cross-season + отчёты |
| **SLA** | best effort | best effort | 99.5% uptime, 24ч support | 99.9% uptime, 4ч critical |
| **Пропуск через photographer-led канал** | да (хук) | да | не основной | не основной |
| **Когда покупают** | начало проекта | 1 раз + пополнение | 3 мес пилот → annual | после 2-3 успешных сезонов |
| **Что экономит клиенту** | время на согласование | ↑ + cross-project шаблоны | ↑ + бренд-кабинет, единые артикулы | ↑ + cross-season артикулы, tenure-данные |
| **Где «живёт» артикул** | в проекте, 3 мес | в проекте, пакет | **brand cabinet** (постоянно) | **brand cabinet** (постоянно) |
| **Upgrade path** | → studio pack при 2+ проектах | → anchor monthly при 5+ проектах/мес | → annual после 3 мес пилота | — (top-tier) |
| **Продление / архив** | ~100 ₽ за месяц архива | архив — часть пакета | включено | включено |

---

## Открытые вопросы для Маши

1. **Бесплатный access для photographer-evangelist.** В memory `project_monetization.md` предполагается 500 ₽ с фотографа, но evangelist-хук требует бесплатный доступ в тест-режим. Как развести? (Варианты: бесплатно первый проект / первый месяц / до 5 проектов; или studio pack evangelist-version за 0 ₽.)
2. **Цена brand annual.** Нужно определение. Ориентир: anchor monthly × 12 × 0.8 (годовая скидка 20%) = ~288 000 ₽/год. Но это минимум — в продукте есть tenure-value (cross-season артикулы), который нужно отдельно оценить.
3. **Upgrade triggers.** Когда per-project фотограф «автоматически» видит предложение пере на studio pack? (По количеству проектов, по объёму фото, по числу клиентов?)
4. **Dual SKU для [anchor client].** [anchor client] уже реальный пользователь без оплаты. Предлагаем monthly 30k или сразу annual? Риски — см. strategy-2026 ставка 3 риски.
5. **Сохранение/перенос проектов между SKU.** Если фотограф был на per-project, а потом студия его «перекупает» в свой пакет — проект мигрирует или архивируется?
6. **Брендовый SKU и ФЗ-152.** Annual brand subscription = долгосрочное хранение ПДн. Нужно согласование DPA-срока (скажем, 12 мес + 3 мес архив).

---

## Что делать до заполнения

- **НЕ запускать outbound с ценовыми обещаниями.** Пока SKU противоречат друг другу, GS не может писать pack-оффер для [anchor client].
- GS/CoS удерживают любые price-discussions за встречу с Машей до утверждения этой матрицы.
- После утверждения — `project_monetization.md` в memory обновляется ссылкой на этот файл как source of truth.

---

## Changelog

- **2026-04-23** v1 — скелет создан Claude. Ждёт заполнения. Не источник правды.
