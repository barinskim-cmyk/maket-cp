---
type: log
status: locked
owner: Masha
created: 2026-04-24
updated: 2026-04-24
tags:
  - ongoing
  - locked
related: []
priority: critical
cycle: ongoing
---

> **TL;DR:** Еженедельный операционный лог проекта. Ведётся CoS, подписывается Машей на weekly strategy review (пятница 15 мин).

# Project Log — Maket CP

Еженедельный операционный лог проекта. Ведётся CoS, подписывается Машей на weekly strategy review (пятница 15 мин).

**Source of truth:** `strategy-2026.md` (5 ставок), `agent-team-v2.md` (6-7 агентов + execution loop), `/goals/current.md` (текущий цикл), `/tasks/cycle-N-review.md` (approved tasks).

**Cadence:**
- Ежедневно (сжато): CoS добавляет 1-3 строки по факту дня.
- Еженедельно (подробно): CoS пишет weekly summary каждую пятницу перед strategy review.
- Ежемесячно: по итогам monthly review — ссылка на `/reviews/monthly-YYYY-MM.md`.

---

## 2026-04-23 (Чт)

— **Phase 5 закрыта.** 7 тактических Q2-стратегий сданы всеми лейнами: PA, CX, GS, DAD, QA, LC, CoS. Путь: `docs/agents/<lane>/q2-tactical-strategy-2026-04-23.md`.
— Пройдено 20+ микро-решений по продукту, монетизации, позиционированию, агентной команде, execution loop в течение дня.
— Канонизация Version A в `strategy-2026.md:10` и каскад по `CLAUDE.md`, `agent-team-v2.md`.
— **Overnight batch запущен:** 4 параллельных потока.
  - LC: финальная проверка oferta/privacy skeleton'ов.
  - PA: Rate Setter audit + podготовка к W1 SQL-проверкам.
  - DAD: landing cleanup plan + brand baseline.
  - CoS: execution loop infrastructure (этот log, `/goals/current.md`, `/tasks/cycle-1-review.md`, automation rules, release playbook, candidate A tracker).

## 2026-04-24 (Пт)

— _(обновится CoS утром)_. Ожидания: первая запись кандидата A если встреча назначена, статус Machine-approve на overnight deliverables, LC response по open questions (если Маша успела).
— Weekly strategy review — если Маша подтвердила каденцию (см. M1 в goal card), первый созвон пт 15 мин.
— Подготовка к weekend — proposals от живых 7 агентов, CoS собирает фактические правки к draft `cycle-1-review.md`.

## 2026-04-28 (Пн) — старт cycle 1

— _(обновится)_ CoS рассылает goal card + proposals-шаблон всем 7 лейнам.
— LC: запрос Маше на 10 open questions (deadline 4 мая).
— CX: kick-off retro, [test user A] ritual-switch инициирован.
— PA: первая неделя — SQL-проверки photo_versions + Playwright scaffold.
— DAD: активация неделя 1 (landing cleanup + brand v0.1 baseline).

---

## Формат еженедельных записей (на пятницу)

```
## Неделя N (YYYY-MM-DD – YYYY-MM-DD)

### Статус ставок
- Ставка 1 (юр-разблокировка): [green/yellow/red] — факт: [что случилось]
- Ставка 2 (кофаундер): [...]
- Ставка 3 (anchor sales): [...]
- Ставка 4 (стабилизация ядра): [...]
- Ставка 5 (photographer-led): [...]

### Прошло через approval gate
- [#] — [кратко что одобрено/отклонено]

### Release review прошёл
- [Фича] — approved / blocked — решение: [кто подписал]

### Automation rules triggered
- T-XX: [trigger → action → result]

### Риски на следующую неделю
- [1-3 пункта]

### Маша approval
- Подписала [YYYY-MM-DD], комментарий: [если был]
```

---

## Формат daily (опционально, по необходимости)

```
## YYYY-MM-DD (День)
— [Агент]: [факт]. [Если релевантно — ссылка на status.md или PR].
— [Агент]: [факт].
— CoS: [триггеры / встречи / эскалации].
```

---

## Правила ведения

1. **Факты > мнения.** «PA закрыл PA-1» лучше, чем «PA активно работает».
2. **Ссылки > пересказы.** Если есть `status.md` или PR — ссылка, а не дубликат.
3. **Конвертация относительных дат в абсолютные.** «На следующей неделе» → «неделя N+1 (YYYY-MM-DD)».
4. **1 запись ≤ 150 слов** (дневная) / ≤ 300 слов (еженедельная). Если длиннее — отдельный review файл, а здесь — ссылка.
5. **Не дублировать status.md агентов.** Project-log — это то, что касается межлейновой координации и Машиного окна внимания; лейн-factoid остаётся в `<lane>/status.md`.
6. **Automation rules triggers — обязательно логируем** (см. `/ops/automation-rules.md`). Это ядро прозрачности.

---

## Связанные артефакты

- `/goals/current.md` — что мы делаем сейчас.
- `/tasks/cycle-N-review.md` — что одобрено на цикл.
- `/ops/automation-rules.md` + `/ops/release-review-playbook.md` — playbook'и, на которые ссылается лог.
- `/reviews/monthly-YYYY-MM.md` — итоги месяца (не дублировать в log, только ссылаться).

**Owner:** Chief of Staff. Signed off: Masha (weekly strategy review, пятница 15 мин).
