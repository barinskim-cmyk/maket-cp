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
  - reference
related:
  - "[[strategy-2026]]"
  - "[[automation-rules]]"
priority: reference
cycle: ongoing
---

> **TL;DR:** Координаты task proposals + approval gate артефакты. Сюда попадают предложения 7 агентов на цикл, которые проходят approval gate Маши (см. `agent-team-v2.md` execution loop).

# /tasks/

Координаты task proposals + approval gate артефакты. Сюда попадают предложения 7 агентов на цикл, которые проходят approval gate Маши (см. `agent-team-v2.md` execution loop).

## Содержимое

- `cycle-N-proposals.md` — сырые task proposals от агентов (по 2-3 строки на task). Опционально — если CoS складывает review сразу. В Q2 часто один файл `cycle-N-review.md` заменяет оба этапа.
- `cycle-N-review.md` — собранный review от CoS: approved / deferred / cut + recommendation. Идёт в approval gate к Маше.

## Формат cycle-N-review.md

```
# Cycle N Review — YYYY-MM-DD
Период: YYYY-MM-DD – YYYY-MM-DD
Цель цикла: → /goals/current.md

## Proposals by agent
### PA (Product Architect)
- [ ] 1. <task> — W<week>, owner: <agent>, dep: <deps>
...

## Сводная таблица
| # | Agent | Task | Week | Owner | Deps | Recommendation |
|---|-------|------|------|-------|------|----------------|

## Approval
- [⏳ Маша]: approve / cut / modify
```

## Правила

1. Каждый task ≤ 3 строки. Если агент пишет на страницу — CoS возвращает на рефактор.
2. Дедлайн формата "неделя" (W1/W2) + конкретная дата там, где есть жёсткая привязка (например, "[anchor client] первый чек 15 июня").
3. Дедупликация: если две задачи пересекаются (PA + DAD оба про форму hero-badge) — CoS консолидирует в одну с двумя owner'ами.
4. Подпись Маши — обязательна. Без approval — агенты не стартуют.

## Связанные артефакты

- `/goals/current.md` — цель цикла, к которой привязаны задачи.
- `/project-log.md` — статус задач на конец недели.
- `/ops/release-review-playbook.md` — что запускается после закрытия задач (release review gate).

**Owner:** Chief of Staff.
**Approval:** Masha, четверг 30 минут на каждый cycle.
