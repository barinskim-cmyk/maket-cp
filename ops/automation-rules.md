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
  - client-a
  - belarus-brand
  - playbook
  - locked
related: []
priority: critical
cycle: ongoing
---

> **TL;DR:** **Версия:** v0 (2026-04-23, overnight batch) **Next revision:** v1 к неделе 11 (2026-07-07 — Q2 retro) **Source of truth:** `agent-team-v2.md` раздел "Automation rules (T-01 — T-07)" **Owner:** Chief of Staff.

# Automation Rules — CoS Playbook

**Версия:** v0 (2026-04-23, overnight batch)
**Next revision:** v1 к неделе 11 (2026-07-07 — Q2 retro)
**Source of truth:** `agent-team-v2.md` раздел "Automation rules (T-01 — T-07)"
**Owner:** Chief of Staff.

---

## Назначение

Это рабочий документ CoS. Когда срабатывает триггер — CoS идёт сюда и смотрит playbook. Цель — не бюрократия, а «ремни безопасности»: закрыть повторяемые инциденты воспроизводимо, не придумывая заново каждый раз.

**Правило v0:** если триггер не срабатывает 2 цикла подряд — переформулируем или удаляем. Если срабатывает часто и правило мешает — пересматриваем порог.

---

## T-01 — Live-test incident

**Trigger:** Тестер или клиент сообщает баг с потенциальным data loss или перебоем сервиса (флаг `live-bug` в `backlog.html` или прямое сообщение [test user A] / [anchor client] через CX).

**Actions (по порядку):**
1. **CX** в течение 1 часа фиксирует в `/bugs/YYYY-MM-DD.md` с тегами: `severity:critical|high|medium|low`, `from:<victoria|[anchor client]|belarus|internal>`, `scope:<rate-setter|share-link|auto-rename|...>`.
2. **CoS** в течение 2 часов ставит приём новых бета-заявок на паузу: lending hero-badge переключается в "в техническом обслуживании" (или форма отключена), GS не рассылает новые outbound-сообщения.
3. **CoS** уведомляет Машу через weekly digest или немедленно (если severity=critical).
4. **PA** (немедленно для severity critical/high) воспроизводит и открывает задачу `/tasks/dev/<bug>-YYYY-MM-DD.md`.
5. **QA** прогоняет regression (incident [anchor client]-class protection).
6. **PA + QA** фиксят и проверяют.
7. **CX** подтверждает клиенту и закрывает запись в `/bugs/`.
8. **CoS** снимает паузу после 24 часов без повторов.

**Success signal:** запись в `/bugs/` в статусе `fixed`, 24 часа без повторного триггера, CoS снял паузу, проверено что outbound-очередь восстановлена.

**Failure recovery:** если фикс не заходит за 48 часов для critical/high — CoS инициирует hot meeting с Машей + PA + QA. Если проблема шире (архитектурный дефект) — открывается ADR (T-05) и эскалируется как риск в monthly review.

**Пример сценария:**
> [test user A] пишет CX 2026-05-12 15:00 MSK: «у меня пропали карточки в [anchor client]-проекте». CX 15:30 фиксирует `/bugs/2026-05-12-victoria-card-wipe.md` с тегами `from:victoria, severity:critical, scope:cards`. CoS 16:30 переключает лендинг в "beta paused", уведомляет GS не рассылать. PA 17:00 воспроизводит, находит регрессию в delete-guard. QA 18:30 пишет regression-тест, PA фиксит к 20:00. QA подтверждает, CX пишет [test user A] «починили, спасибо за сигнал». CoS снимает паузу 2026-05-13 21:00 (+24ч). Логируем в `/project-log.md`.

---

## T-02 — Intent routing (лейн-идентификация)

**Trigger:** Входящее сообщение / задача / интент попадает не в свой лейн.

Примеры:
- Маша пишет в ops-чат «надо поправить копирайт на лендинге» → это GS/DAD, не CoS.
- В `/tasks/dev/` появляется задача «написать DPA» → это LC, не PA.
- Баг в карточках прилетает напрямую в PA без фиксации в `/bugs/` — это CX-gate нарушен.

**Actions (по порядку):**
1. **CoS** (или первый агент, получивший задачу) идентифицирует правильный лейн:
   - Копирайт / лендинг / outbound / позиционирование → GS.
   - Визуал / UI-ревью / brand / лого / OG → DAD.
   - Юр-текст / оферта / privacy / DPA → LC.
   - Код / архитектура / база данных / frontend → PA.
   - Клиент / тестер / onboarding / pipeline клиента → CX.
   - Тесты / regression / pre-release / gate → QA.
   - Execution loop / кофаундер / юр-оформление операций / координация → CoS.
2. **Переадресация через артефакт** (не in-chat переписку): задача пишется в `/tasks/<lane>/` или в `<lane>/status.md` как request.
3. **Подтверждение принятия** — получатель добавляет строку в свой `status.md`: «Принято задание от <owner>, expected by YYYY-MM-DD».

**Success signal:** задача ушла в правильный лейн без переспроса Маши, артефакт-запись есть у обоих.

**Failure recovery:** если задача «застряла» (не принята в 24 часа) — CoS пингует. Если спорный лейн — CoS принимает решение (ad hoc в v0, на v1 — добавить decision tree).

**Пример сценария:**
> PA получает в PR «нужен cold email template». PA в PR-комменте пишет: «T-02: это GS-лейн, переношу в `docs/agents/marketing/status.md`». GS принимает, пишет «Beru, expected by <date>». Никто не спросил Машу, никто не дубль не делал. Логируем: «T-02 routed: email-template request PA → GS».

---

## T-03 — Legal update cascade

**Trigger:** Любое из:
- LC изменил оферту / privacy / DPA.
- Новый клиент запросил DPA.
- Новая фича трогает ПД (например, client-view share links для внешнего клиента).
- Меняется юр-форма (НПД → УСН → ООО).
- Regulatory watch выявил новое требование РКН / 152-ФЗ.

**Actions (по порядку):**
1. **LC** готовит diff (что изменилось в тексте, что добавилось, что удалилось).
2. **CoS** проходит по всем местам, где цитируется документ:
   - `landing.html` (footer, privacy page, регистрация).
   - Регистрационная форма / client-view / share-link (UI-элементы).
   - `/legal/changelog.md` — публичная история изменений.
   - Email templates — если есть упоминание оферты.
3. **PA** обновляет UI-тексты и формы (чекбоксы согласия, ссылки на документы).
4. **DAD** обновляет визуал consent-экранов (не `dark pattern`, equal affordance для accept/decline).
5. **GS** обновляет публичные страницы (лендинг FAQ, security-page если есть).
6. **CoS** генерит human checklist для Маши: "вот что я изменил — прочитай и подпиши". Без подписи — не публикуем.

**Success signal:** все точки обновлены, Маша подписала, `/legal/changelog.md` имеет запись с датой и diff-summary, published на лендинге.

**Failure recovery:** если один из лейнов не обновил свою часть в 3 рабочих дня — CoS ставит блок на публикацию новой версии, эскалирует в weekly strategy review. В critical случаях ([anchor client] запросила DPA до подписания оферты) — cut timeline через дополнительную сессию с юристом (+20-30к ₽, бюджет из LC резерва).

**Пример сценария:**
> LC обновил oferta-v2 под правки живого юриста 2026-05-28. T-03 срабатывает. CoS 2026-05-29: diff собран. PA 2026-05-30 добавляет новое поле "согласие с офертой" в форму регистрации. DAD 2026-05-30 проверяет визуал: чекбокс не предзаполнен, ссылка на оферту рабочая. GS 2026-05-30 обновляет FAQ "Какие у нас юр-доки". CoS 2026-05-31 пишет Маше checklist: 4 места изменены, прочитай финал и подтверди. Маша 2026-06-01 подписывает. Публикация 2026-06-01 вечер. Запись в `/legal/changelog.md` и в `/project-log.md`.

---

## T-04 — Stale status alert

**Trigger:** `<lane>/status.md` не обновлялся:
- Более **7 дней** для Core лейнов (PA, CX, GS, CoS).
- Более **14 дней** для Specialist лейнов (DAD, QA, LC — когда в standby).

**Actions (по порядку):**
1. **CoS** (ежепятничный scan) идентифицирует stale лейны.
2. **CoS** пингует владельца лейна: короткое сообщение + ссылка на status.md с последним апдейтом.
3. Ожидание ответа — 3 рабочих дня.
4. Если ответа нет через 3 дня → эскалация Маше в weekly strategy review + запись в `/project-log.md`.
5. Если стейл повторился второй раз за Q2 — CoS инициирует conversation про лейн (перегружен? не ясен scope? нужен pivot?).

**Success signal:** `status.md` обновлён, lane живой, факт лога — 1 строка «T-04 triggered, resolved».

**Failure recovery:** если лейн стоит 14+ дней без ответа — CoS инициирует pause-протокол: status.md переключается в "paused by CoS, awaiting owner", задачи этого лейна в cycle — `defer`.

**Пример сценария:**
> 2026-05-23 (пт) CoS сканит: `/dev/status.md` последний апдейт 2026-05-15. 8 дней stale. CoS пингует PA: «статус не обновлён, что с цикл-2 progress?». PA отвечает в понедельник: «болел, догоню завтра». Stale снят, запись в log'е «T-04 triggered for PA, resolved after 4 days».

---

## T-05 — Migration / risky operation approval

**Trigger:** Рискованная операция:
- SQL-миграция (DDL, не DML).
- Auth / RLS / Storage bucket изменения.
- Bulk-операция над клиентскими данными (rename всех photo_versions, например).
- Изменение подрядчика инфраструктуры (Supabase region, CDN, payment processor).

**Actions (по порядку):**
1. **PA** (или другой автор) пишет ADR: `docs/agents/dev/adr/NNN-<topic>.md`. Формат: контекст, варианты, решение, последствия, откат.
2. **PA** публикует ADR + миграционный SQL (или plan) в PR.
3. **QA** пишет test plan: что проверяем до apply, что после, какие regressions ждём.
4. **CoS** читает ADR, QA test plan, задаёт 2-3 вопроса (что критично? что может упасть? какой rollback?).
5. **CoS approve** (в течение 24 часов) или request changes (конкретные пункты).
6. **PA** мержит PR и применяет в staging. QA прогоняет regression.
7. **PA + CoS** делают pre-prod go/no-go (5 минут).
8. **PA** применяет в prod в low-traffic окне.
9. **QA** прогоняет smoke после apply.
10. **CoS** логирует в `/project-log.md`.

**Success signal:** ADR merged, миграция в prod, regression зелёный, smoke зелёный, rollback не понадобился.

**Failure recovery:**
- Если regression красный в staging — миграция не идёт в prod, PA переделывает.
- Если в prod что-то сломалось — T-01 активируется параллельно (incident).
- `pg_dump` перед apply — обязателен. Без бэкапа — CoS не approves.

**Пример сценария:**
> PA пишет `ADR-001-photo-versions-canonical-migration.md` 2026-04-29. В PR — `030_photo_versions.sql`. QA пишет test plan: 4 SQL-проверки до, 3 после. CoS читает 2026-04-30: «вопрос — что с CAST null columns и есть ли foreign keys?». PA отвечает в комменте. CoS approves 2026-05-01. PA мержит и применяет в staging. QA regression зелёный. PA + CoS go/no-go 2026-05-02 утро. PA применяет в prod 2026-05-02 10:00 (Masha уведомлена). QA smoke зелёный в 10:30. Лог: «T-05: ADR-001 applied, zero regressions».

---

## T-06 — Approval gate timeout

**Trigger:** Маша не прошла approval gate за 48 часов после четверга (четверг — плановое окно cycle approval, 30 мин).

**Actions (по порядку):**
1. **CoS** пт утром: пинг в message «жду approval cycle-N-review»; короткий summary recommendations.
2. **CoS** пн утром (+72 часа): если ответа нет — применяет **правило минимального approved-set**:
   - Task'и, которые не блокируют Ставки 1-2 и не customer-facing — CoS принимает сам (operational authority).
   - Customer-facing и migration-task'и — остаются в `awaiting approval`.
3. **CoS** логирует в `/project-log.md`: «T-06 triggered, CoS approved N operational tasks, M awaiting Masha».
4. **CoS** в среду цикла N+1 (через 4 рабочих дня) — second ping в weekly digest.
5. Если awaiting > 1 недели — эскалация в monthly review как operational риск.

**Success signal:** approval gate прошёл (поздно, но прошёл); ничего из Ставок 1-2 не заблокировалось.

**Failure recovery:** если два цикла подряд timeout — CoS предлагает upgrade: "CoS authorize all operational tasks, Маша смотрит только customer-facing" (правило 3-циклов-одобрения из `docs/agents/ops/q2-tactical-strategy-2026-04-23.md` §5.2).

**Пример сценария:**
> 2026-05-14 (чт) — cycle-2 approval gate назначен. Маша в съёмке 14-16 мая. CoS 15 мая утром пинг: «cycle-2 approvals ждут тебя». Ответа нет. 19 мая (пн утро, +72ч) CoS activates minimal approved-set: 8 operational tasks — approve CoS; 3 customer-facing (landing copy, outbound волна) — остаются awaiting. Лог. 22 мая (ср) — second ping. Маша 23 мая подписывает все customer-facing. Log: «T-06 triggered, resolved after 9 days, 8 ops auto-approved».

---

## T-07 — Test gate fail

**Trigger:** QA ловит критичный баг в pre-release gate:
- Data loss / data corruption scenario.
- Broken share-link (клиент не может войти).
- Rate Setter sync расходится COS ↔ облако на regression-тесте.
- Auth / RLS нарушены (клиент видит чужие данные).
- [anchor client]-class regression (Cyrillic, soft-delete, storage 400).

**Actions (по порядку):**
1. **QA** блокирует релиз явно: пишет `/qa/releases/release-YYYY-MM-DD-BLOCKED.md` и statuscard `BLOCK`.
2. **QA** возвращает задачу в PA через `/tasks/dev/qa-return-YYYY-MM-DD.md` с:
   - Конкретным failing scenario (шаги воспроизведения).
   - Ожидаемое vs фактическое поведение.
   - Приоритет и severity.
3. **CoS** логирует инцидент в `/project-log.md`: дата, сценарий, причина блока.
4. **PA** фиксит, обновляет ADR (если архитектурное), новый PR.
5. **QA** ре-прогоняет regression. Если снова fail — цикл повторяется (T-07 not cleared).
6. **CX** уведомляется, что релиз задерживается; если есть клиентское обещание (например, [anchor client] ждёт фичу) — CX переадресует ожидания.
7. **CoS** не даёт зелёный на публикацию / release review, пока QA не пометил `UNBLOCK`.

**Success signal:** QA `UNBLOCK`, все regressions зелёные, релиз едет в prod, лог в `/project-log.md`.

**Failure recovery:** если фикс превращается в >3 итераций — open ADR, attend CoS + PA + QA в 30 минут meet, переоценка scope. Допустимо `scope-cut` (урезать фичу) — лучше меньше, но стабильно (принцип Маши: «безотказность > функциональность»).

**Пример сценария:**
> 2026-05-18 PA готовит релиз Rate Setter COS round-trip. QA прогоняет regression — 1 из 10 тестов fail: Cyrillic filename падает на storage ([anchor client] 15.04 regression!). QA пишет BLOCK, возвращает `/tasks/dev/qa-return-2026-05-18-rate-cyrillic.md` с шагами. PA 2026-05-19 находит что не вызывается `sbSanitizeStorageKey` в новом пути, фиксит. QA 2026-05-19 вечер прогоняет — зелёный. UNBLOCK. Release 2026-05-20 утро. Лог: «T-07 triggered, resolved in 24h, Cyrillic regression prevented».

---

## Summary table

| ID | Триггер (в 1 строку) | Owner-trigger | Owner-action | Time to action | Escalation threshold |
|----|-----------|----------------|---------------|-----------------|----------------------|
| **T-01** | Клиент / тестер сообщил баг | CX | CX → CoS → PA+QA | 2 часа | 48 часов не фиксится = hot meet |
| **T-02** | Задача попала не в свой лейн | любой агент | CoS routing | 24 часа | 48 часов не принята = CoS pings |
| **T-03** | Юр-документ меняется | LC | LC → CoS cascade | 3 рабочих дня | 1 лейн не обновился за 3 дня = блок публикации |
| **T-04** | Status.md stale | CoS scan | CoS ping owner | 7 дней Core / 14 Specialist | 3 дня без ответа = эскалация Маше |
| **T-05** | Рискованная миграция | PA | PA ADR + CoS approve + QA test plan | 24 часа на CoS approve | Нет бэкапа = CoS no-approve |
| **T-06** | Approval gate timeout | CoS scan | CoS pings + min approved set | 48 часов | 9 дней = monthly-review риск |
| **T-07** | QA critical fail | QA | QA block + PA return | Немедленно | 3+ итерации = scope-cut meet |

---

## Triggered log (Q2 2026)

_(Заполняется по мере срабатывания. Формат: `YYYY-MM-DD | T-XX | scenario | outcome`.)_

- _(пока пусто — cycle 1 стартует 2026-04-28)_

---

## Roadmap v1 (неделя 11 retro)

1. **T-08** (кандидат) — Masha off-grid mode (съёмка / отпуск 5+ дней). Триггер — календарь. Действия — CoS pauses approval gate, routes critical → async mode.
2. **T-09** (кандидат) — Финансовый триггер. НПД-лимит приближается к 80% (≈ 1.9 млн ₽ / год) → LC активирует УСН-подготовку.
3. **T-10** (кандидат) — Кофаундер-onboarding. Если Маша approve кандидата A/B → активируется onboarding-playbook (расширение состава review-gate, передача ownership).

Решение — на Q2 retro (2026-07-07) по данным срабатываний T-01..T-07.

---

Source of truth: `agent-team-v2.md` раздел "Automation rules".
Owner: CoS.
Changelog: 2026-04-23 v0 — создан (overnight batch, CoS autonomous).
