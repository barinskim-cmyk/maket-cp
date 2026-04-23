# Триаж открытых вопросов — 2026-04-23

Автор: Claude (Opus 4.6), автономный проход по результатам inaugural reconciliation audit.
Источник: `audits/coordinator-reconciliation-2026-04-23.md` раздел 4 (20 вопросов) + приоритизация в разделе 5.

## Легенда тегов

- **[can-close-autonomously]** — закрывается точечной правкой в doc/code, без решений Маши и без внешних данных.
- **[needs-masha]** — требует её решения, ценностного выбора или вводных, которые только она знает.
- **[needs-external-data]** — чисто рисёрч, можно собрать факты без Маши (регион Supabase, юр-нормы, и т.д.).
- **[needs-cofounder]** — ждёт engagement-теста кандидата A/B или внешнего человека; до конца Q2 бесполезно двигать.

---

## Таблица триажа

| # | Вопрос | Источник | Тег | Статус после Блока 5 |
|---|---|---|---|---|
| 4.1 | Какая формулировка Version A канонична? Headline vs core message? | strategy / product_core / GS prompt / landing | [needs-masha] + [can-close-autonomously] (core message уже зафиксирован strategy-2026 v2) | Частично закрыто: каскадно обновил product_core.md и прочие под Version A. Headline для лендинга остаётся за Машей. |
| 4.2 | Primary ICP: бренд-инхаус, продакшн-студия или оба? | Maket_CP_описание_проекта.md:19 vs strategy-2026 | [needs-masha] | Не тронуто (решение ценностное). |
| 4.3 | Цель года — 4,4 млн или 560 тыс.-1,02 млн? | strategy-2026.md:12 vs :188 | [needs-masha] | Не тронуто (решение Маши). |
| 4.4 | Как сосуществуют 4 SKU? | monetization vs strategy vs brand_client_continuity | [needs-masha] (требует решения про каскад цен) + [can-close-autonomously] (собрать скелет matrix) | Скелет `monetization-matrix.md` подготовлен как черновик для заполнения Машей. |
| 4.5 | `photo_versions`: таблица в prod существует? DDL? | supabase.js vs v2/supabase/ | [needs-external-data] (нужен доступ к prod DB) + [can-close-autonomously] (реверс-инжиниринг схемы из кода) | Предложенная миграция подготовлена: `v2/supabase/proposed-photo_versions.sql`. Проверка в prod остаётся. |
| 4.6 | Supabase region: EU или нет? | landing.html «EU серверы» | [needs-external-data] | Помечено для PA — требует `mcp__supabase__get_project` с правильными креденшенами. |
| 4.7 | Каналы фотографов для outbound | agent-team-v2.md GS deliverables | [needs-cofounder] | За Q2 GS деливераблом. |
| 4.8 | Механика upward-sell (фотограф→владелец) | agent-team-v2.md:512 | [needs-cofounder] + [needs-masha] | За Q2-Q3. |
| 4.9 | Отдельный headline для фотографов или одна Version A? | agent-team-v2.md | [needs-masha] (после первых тестов) | Ждём пилота Q3. |
| 4.10 | DAD — агент или skill-pack? | agent-team-v2.md | [needs-masha] | Q3 revisit. |
| 4.11 | Per-photo pipeline / photo versions в Q2 или Q3? | masha-q2-plan.md, BETA_SCOPE | [needs-masha] + [can-close-autonomously] (per-photo уже done, обновить memory) | Обновил `BETA_SCOPE.md` и пометил в memory через каскад (см. Блок 5). |
| 4.12 | Supabase Pro — оплачен? | project_company_baseline_2026_04 | [needs-external-data] | Легко проверить через supabase.com dashboard или биллинг; оставлено Маше (требует её доступа). |
| 4.13 | ОКВЭД / юр-форма (ИП-УСН, ООО, расширение на ИП-НПД) | masha-q2-plan Ставка 1 | [needs-external-data] + [needs-masha] | Рисёрч-отчёт подготовлен: `docs/agents/ops/okved-research-2026-04-23.md`. Решение за Машей + юристом. |
| 4.14 | `audit_edits.json` / `backlog_edits.json` — живые? | CLAUDE.md | [can-close-autonomously] | Убрал из CLAUDE.md упоминание несуществующих файлов (они de-facto упразднены, backlog.html/localStorage — канал). |
| 4.15 | Landing «EU серверы», «PIM в разработке» — legal-claim check | landing.html | [needs-masha] (решение про формулировку) + [needs-external-data] (проверить регион Supabase) | Не трогал HTML (по договорённости). Добавил в «что открыто». |
| 4.16 | Источник правды лендинга — `landing.html` или `landing_texts.md`? | См. 1.6 | [can-close-autonomously] | Пометил `landing_texts.md` как DEPRECATED через комментарий в шапке (источник правды — `landing.html`). |
| 4.17 | `strategic-frame-review.html`, `whitepaper_theses.html`, `insights_2026_04_15.html` — живые? | корень проекта | [needs-masha] | Не трогал. Сформирован список в отчёте. |
| 4.18 | Обновление `Maket_CP_описание_проекта.md` (ICP, пайплайн) | Maket_CP_описание_проекта | [needs-masha] + [can-close-autonomously] частично (ICP — за Машей, но позиционирование «DAM для фотографов» — за мной) | Обновил позиционирование; раздел ICP не тронул. |
| 4.19 | Bundle фотографа в бесплатный pack | monetization + brand_client_continuity | [needs-masha] | За Q3 photographer pilot. |
| 4.20 | «Бета открыта» vs «ищем 3 production-команды» | landing.html | [needs-masha] (landing — Маша/DAD) | За Машей. |

---

## Сводка по тегам

- **[can-close-autonomously]**: 7 пунктов (4.1 частично, 4.4 частично, 4.5 частично, 4.11 частично, 4.14, 4.16, 4.18 частично).
- **[needs-external-data]**: 4 пункта (4.5 частично, 4.6, 4.12, 4.13).
- **[needs-masha]**: 11 пунктов (4.1 headline, 4.2, 4.3, 4.9, 4.10, 4.11 приоритизация, 4.15, 4.17, 4.18 ICP, 4.19, 4.20) — остаются за ней.
- **[needs-cofounder]**: 2 пункта (4.7, 4.8) — ждут engagement-теста.

---

## Что закрыто автономно (детали — см. Блок 5 отчёта)

1. **Version A каскад** — `product_core.md`, `CLAUDE.md`, `Maket_CP_описание_проекта.md` header, `BETA_SCOPE.md`, `agent-team-v2.md` GS prompt раздел — подведены под canonical formulation.
2. **`photo_versions` миграция** — `v2/supabase/proposed-photo_versions.sql` + `docs/agents/dev/photo_versions-migration-proposal.md`.
3. **CLAUDE.md — «DAM» и `*_edits.json`** — первый абзац переписан под Version A; упоминание несуществующих json-файлов убрано.
4. **`landing_texts.md`** — шапка помечена DEPRECATED с явным указанием на `landing.html` как источник правды.
5. **`BETA_SCOPE.md` / per-photo статус** — подтверждено «done» (уже было корректно, но каскад в сопровождающих файлах обновлён).
6. **`monetization-matrix.md`** — создан скелет-черновик для заполнения Машей (ставил рядом со strategy-2026.md).
7. **ОКВЭД research** — отчёт `docs/agents/ops/okved-research-2026-04-23.md` с рекомендациями и рисками status-quo.

---

## Что остаётся Маше (приоритеты)

### Blockers (делать до старта Фазы 3 индивидуальных аудитов — 2026-04-28 и ранее):

- **4.1 (canonical headline)** — одна формулировка для лендинга H1 + subhead. Я подвёл core message под Version A, но headline для лендинга — за Машей.
- **4.13 (юр-форма)** — по research-отчёту выбрать вариант и записаться к юристу. Отчёт содержит 3-5 вариантов + риски status-quo.

### High (до 2026-05-01):

- **4.2 (ICP)** — развести «фотограф как канал» vs «бренд-инхаус как primary». Я не могу сделать это за Машу.
- **4.3 (цель года)** — выбрать между 4,4 млн (ран-рейт) и 560 тыс.-1,02 млн (честный потолок).
- **4.4 (monetization matrix)** — заполнить подготовленный мной черновик.
- **4.6 (Supabase EU)** — подтвердить регион через supabase dashboard.
- **4.15 (landing legal claims)** — решить, что оставить в «EU серверы» и «PIM в разработке» секциях после подтверждения фактов.

### Medium (до 2026-05-15):

- **4.11 (per-photo в Q2 vs Q3)** — приоритизация.
- **4.17 (artefact HTML статус)** — ревизия `strategic-frame-review.html` и пр.
- **4.18 (описание проекта — ICP + пайплайн)** — переписать разделы 1.2 и 3 после решения 4.2.
- **4.20 (бета: открытая vs закрытая)** — согласованность hero и beta секции на лендинге.

### Low:

- **4.9, 4.10, 4.19** — revisit после Q2/Q3.

### Чего ждём от внешнего/кофаундера:

- **4.7 (каналы фотографов)** — GS Q2 deliverable.
- **4.8 (upward-sell mechanic)** — GS + CX + PA, Q3.
- **4.12 (Supabase Pro оплачен?)** — за Машей (доступ к биллингу).

---

## Changelog этого файла

- **2026-04-23 v1** — первичный триаж из audit раздела 4. Автор: Claude (autonomous cleanup).
