# Overnight Spec — 2026-04-30 / 2026-05-01
**Status:** locked, ready to execute autonomously overnight.
**Author:** Masha + Claude Dispatch (continuous conversation 2026-04-30 evening).
**Goal:** на утро 1 мая иметь работающую сборку которую можно тестировать на следующей съёмке Маши.

---

## 0. Контекст / стратегический reframe (locked)

Сегодняшнее решение Маши — **продукт > GTM**. Дедлайн — следующая съёмка (~неделя). Между съёмками — цикл доработок, чтобы продукт справился с реальной съёмкой без боли.

GTM (positioning, оферта, outbound, лендинг) поставлен на паузу до явного сигнала «возвращаемся к маркетингу». Текущие GTM-сессии доводят до точки и в стол. Новые не запускаются.

Маша одновременно ICP (как фотограф = канал) и не-ICP (платит команда продакшена). Дoгфудинг закрывает фотографа, покупательскую сторону наблюдаем через Викторию (paying-zone клиент).

**Виктория interrupt rule (HARD):** новый контент Виктории → бросаем ВСЁ (даже середину блока), ставим per-brand rename (см. `feedback_victoria_ekonika_2026_04_26.md`). После — продолжаем где прервались.

---

## 1. Priority order (locked)

1. **Block A: Google Drive integration** — UI и flow.
2. **Block B: Desktop Maket CP с C1-bridge** — объединённый экс-XMP-keywords + экс-desktop в один блок.

Drive первым потому что без него нечего хранить версии, нечего отдавать ретушёру, нечего скачивать клиенту. Desktop+C1 вторым потому что без Drive у десктопа нет связки куда заливать post-selection.

---

## 2. Block A — Google Drive integration

### 2.1. Почему Drive (не Supabase Pro)

Supabase Pro оплатить пока не получается и в ближайшее время не получится. Drive выбран как post-selection storage. OAuth scaffold уже есть (`v2/backend/setup_gdrive.py` + `secrets/google-token.json`). GDriveRepository уже пишется в активной задаче.

### 2.2. Scope (минимум)

**Что хранится в Drive:** ТОЛЬКО то, что прошло отбор клиентом (`selection_approved`). До отбора живёт в Supabase как preview/cache, оригиналы у фотографа локально.

**Partial approval:** клиент аппрувит 30 из 50 → в Drive улетают только 30. Остальные 20 остаются у фотографа локально.

**Incremental sync:** когда следующие N фото получают approval (вторая итерация согласования) — улетают только новые. Не перезаписываем существующие. Драйвер — поле `drive_file_id` на photo (NULL = не залитый, str = uploaded).

**Default sync mode:** automatic — при `selection_approved` событии подтягивает все pending фото в Drive в фоне. Manual-кнопка «Sync now» как fallback.

### 2.3. Forматы файлов

Поддерживаем что фотограф отдаёт. По частоте:
- JPEG — 95% случаев
- TIFF — для финальных файлов
- PNG — редко
- RAW + sidecar XMP / RAW + COS — редко (RAW обычно превью-only, ретушёру не нужен если сделана ЦК)

**Не оптимизируем под RAW**, но поддерживаем.

### 2.4. Folder structure в Drive

```
Maket CP/
  <brand>-<YYYYMMDD>-<name>/        # shooting code
    originals/                       # post-selection-approved оригиналы
    versions/
      <photo-id>/
        v1/                          # семантика стейджа в Supabase
        v2/
        v3/
        ...
```

Имя shooting-папки — генерится автоматически из проекта в Maket CP. Кириллица → латиница транслит. Пример: `ekonika-20260430-lookbook-vesna`.

**Drive root:** личный Drive под `barinski.m@gmail.com`, в папке `Maket CP/`. Реверсируемо, в будущем можно перенести.

### 2.5. Версии — semantic mapping

Таблица `photo_versions` уже существует со схемой:
- `stage` enum: `'color_correction' | 'retouch' | 'grading'`
- `version_num` int (порядковый внутри стейджа)
- `selected` bool (выбранный вариант стейджа)

**Папка `v#` в Drive** соответствует `(stage, version_num)` в supabase. Имя слота `v1` для одной фотки = «Color correction вариант 1», для другой = «Retouch вариант 2». Семантика живёт в БД, не в имени файла.

### 2.6. Cleanup unselected variants

**Правило:** когда `selected=true` ставится на один из вариантов в стейдже `'color_correction'`, фоновый job чистит остальные `color_correction`-варианты той же фотки в Drive (удаляет файлы, помечает `photo_versions.deleted_at = now`). Цель — экономия места, особенно для тифов.

**Стейджи `'retouch'` и `'grading'`** — НЕ чистятся. Все версии хранятся.
*(Open question: уточнить с Машей завтра, как именно вести себя с `grading`. Дефолт — как retouch, хранить всё.)*

### 2.7. Quality gate

Эвристика: **файл < 20 MB → флаг `preview_resolution=true`**.

Файл с этим флагом:
- НЕ выпускается ретушёру через download-link
- В UI отмечен бэйджем «Превью, не финал»
- Owner может вручную override через кнопку «Это финал, разрешить скачивание»

Доп-сигнал из metadata (опционально): если фотограф пишет в XMP keyword `_status:preview` — автоматически блокируется независимо от размера.

### 2.8. Acceptance criteria для Block A

1. ✅ OAuth handshake работает, токен в `secrets/google-token.json`, refresh через 7 дней.
2. ✅ `GDriveRepository` с методами upload / download / list / delete / ensure_folder / usage.
3. ✅ Миграция 034 добавляет `drive_file_id` text на `photos` и/или `photo_versions`.
4. UI: при approved selection в проекте — фоновый push в Drive. Прогресс виден в UI («Загружено 28/30 в Drive»).
5. UI: в share-link появляется блок «Скачать одобренные» (для ретушёра/клиента) с download buttons.
6. UI: владелец видит per-photo индикатор «в Drive ✓» / «не залитое» с возможностью manual sync.
7. Quality gate: файлы <20MB или с XMP-tag `_status:preview` блокируются от download для не-owner ролей, owner может override.
8. Cleanup unselected CC variants работает: ставлю selected=true на CC v2 → CC v1 и CC v3 удаляются из Drive в течение минуты.

---

## 3. Block B — Desktop Maket CP с C1-bridge

### 3.1. Reframe (важно)

**НЕ строим плагин для Capture One.** Строим Maket CP-десктоп, в который встроена C1-интеграция через системный AppleScript-bridge. Никакого плагина для C1 не существует, ставится только Maket CP.

Преимущества:
- Один установщик вместо двух
- Работает на любой версии C1 включая пиратскую
- Никакой зависимости от C1 SDK / signing
- Обновления C1 не ломают bridge (это macOS-уровневая автоматизация)
- Логика, UI, данные, event log — всё в одном месте

### 3.2. Технический стек C1-bridge

- **Python AppleScript bridge** через `osascript` subprocess или `py-applescript`
- Команды AppleScript:
  - `tell application "Capture One" to get selected variants`
  - `tell application "Capture One" to process selected variants using recipe "Embedded JPEG"`
- **Watcher на сессию** через `watchdog` (Python, уже в зависимостях возможно — проверить)
- **Глобальный hotkey** через `pynput` или `pyobjc` global event monitor
- **Permissions detection** через `pyobjc` (`AXIsProcessTrusted()` для accessibility, query TCC database для automation)

### 3.3. Десктоп-сборка

- **py2app** для упаковки pywebview + Python в `.app` бандл
- **Bundle identifier:** `app.maketcp.desktop` (или похожее, нужно зафиксировать раз и навсегда — для permissions persistence)
- **Ad-hoc signing:** `codesign --sign -` (бесплатно, личное использование, достаточно чтобы macOS сохранял permissions между запусками)
- **Auto-update:** при старте приложение делает `git pull` в его app-папке, если изменения — мягко рестарт. Альтернатива: GitHub Releases polling. Дефолт — тихая (без диалога), быстрая. Логи апдейта в `~/Library/Logs/Maket CP/update.log`.

### 3.4. Shooting Mode (вкладка «Съёмка»)

Новый таб в десктоп-приложении. Когда активен — все C1-интеграции включены. Когда не активен — всё спит.

**Lifecycle:**
1. Пользователь выбирает «Начать съёмку» → выбирает путь к C1-сессии (FilePicker, дефолт — последняя использованная).
2. *(First run only)* Permission flow — см. 3.5.
3. Сессия открыта: `shoot_session.start_time = now() UTC`.
4. Maket CP стартует watcher на сессию + регистрирует глобальный hotkey.
5. При любом изменении в сессии → событие в event log.
6. Пользователь нажимает «Завершить съёмку» → `shoot_session.end_time = now() UTC`, watcher и hotkey останавливаются.

**Duration metric:** `end_time - start_time` минус явные паузы (опционально, через кнопку «пауза»). Это и есть time-savings instrumentation, которую раньше отложили.

### 3.5. First-run permission flow

При первом включении Shoot mode проверяются ТРИ разрешения. Для каждого недостающего — отдельный диалог + deep link.

| Разрешение | Зачем | Deep link |
|---|---|---|
| **Accessibility** | AppleScript читает UI Capture One | `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` |
| **Automation → Capture One** | Apple Events для C1 | OS показывает попап автоматически при первом `tell application "Capture One"` |
| **Input Monitoring** | глобальный hotkey работает когда Maket CP не в фокусе | `x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent` |

UI flow: модалка с тремя строками-чекерами. Каждая показывает статус (granted/missing) и кнопку «Открыть настройки» для missing. После выдачи разрешения → «Проверить ещё раз». Когда все три — «Готово, начинаем съёмку».

На вторых и далее запусках flow не показывается, проверка фоновая в 100ms.

### 3.6. Watcher логика

Watcher следит за `<session>/Capture/` и `<session>/Trash/` (или эквивалентом для текущей версии C1).

При каждом изменении `.cos` файла:
1. Парсим XMP из .cos
2. Извлекаем: rating, keywords (включая наши спец-теги `_card:*`, `_slot:*`, `_status:*`, `_container:*`), embedded preview (JPEG)
3. Применяем правила:
   - `rating ≥ 2` → автоматический insert в `selection.preselect` (если ещё не там)
   - `_card:<id>` тег → группируем фото в карточку с этим ID; `_slot:<n>` определяет позицию
   - Изменение rating с 2→3 / удаление preselect → синхронно обновляем
4. Перезаписываем preview в Supabase (до водораздела всё mutable, см. ниже)

### 3.7. Pre-water-divide invariant

**До `selection_approved`:** превью / метаданные / порядок / карточки — всё mutable. Каждое изменение перезаписывает существующую запись. Storage не растёт.

**После `selection_approved`:** оригиналы летят в Drive. Версии (CC, retouch, grading) сохраняются immutable в Drive. Event log канонически записывает что произошло.

Эта пара — компактный pre-этап + история post-этап — обязательна. Не нарушать.

### 3.8. Hotkey «Add to Card»

**Привязка:** `Cmd+Shift+C` (по умолчанию, настраивается в Settings).

**Действие:**
1. Maket CP получает hotkey event (через Input Monitoring permission).
2. AppleScript-запрос к C1: `get selected variants` + их позиция в browser.
3. Сортировка по позиции в browser (top-left → bottom-right).
4. Генерируем новый `card_id` (UUID).
5. Для каждой фотки записываем в её .cos sidecar XMP keywords:
   - `_card:<card_id>`
   - `_slot:<index>` (1-based, по позиции после сортировки)
6. Watcher (см. 3.6) видит изменения, синхронизирует в Maket CP, появляется новая карточка с правильным порядком.

**Visual feedback:** короткая всплывашка над иконкой Maket CP в menu bar — «✓ 5 фото добавлено в карточку».

### 3.9. UTC timestamp invariant

**ВСЕ timestamps в storage — в UTC ISO 8601** (`2026-04-30T18:42:13Z`).

UI рендер — конвертация на клиенте по локали ОС или по явному выбору в `Settings → Timezone`.

**Reason:** macOS у некоторых пользователей в России криво настроен (показывает Pacific вместо Москвы). UTC снимает это раз и навсегда.

**Audit task:** проверить весь существующий event log + supabase columns, что timestamps в UTC. Если есть случаи где сохраняется local time — переписать. Это часть работы Block B.

### 3.10. XMP keywords vocabulary (canonical)

Единый префиксированный namespace `_*` в keywords:

| Tag | Значение | Source |
|---|---|---|
| `_card:<uuid>` | принадлежность к карточке | Add to Card hotkey |
| `_slot:<n>` | позиция в карточке | Add to Card hotkey |
| `_status:preview` | превью, не финал | manual или автоопределение по размеру |
| `_status:delivered` | отправлено клиенту | автоматически при delivery event |
| `_status:retouched` | вернулось от ретушёра | watcher при upload новой версии |
| `_container:<name>` | контейнер в Доп контенте | container-picker (уже работает) |
| `_brand:<name>` | бренд проекта | при привязке к проекту |
| `_shoot:<YYYYMMDD>` | дата съёмки | при привязке к проекту |

Rate Setter уже пишет ключевые слова. Расширяем под этот vocabulary.

### 3.11. Acceptance criteria для Block B

1. ✅ Десктоп `.app` собирается через py2app, ad-hoc signed, открывается двойным кликом.
2. ✅ Auto-update тихий через `git pull` при старте, логи в `~/Library/Logs/Maket CP/`.
3. Вкладка «Съёмка» в UI: «Начать съёмку» выбирает путь, «Завершить съёмку» закрывает.
4. First-run flow: проверка трёх permissions, deep links, статус-чекеры.
5. Watcher работает: меняю rating в C1 на 2 → через ≤3с фото появляется в pre-selection в Maket CP.
6. Hotkey работает: выделяю в C1 три фотки, жму Cmd+Shift+C → в Maket CP появляется карточка с правильным порядком.
7. UTC: все новые timestamps в supabase + event log в ISO 8601 UTC. Audit-сcript подтверждает 100%-compliance.
8. Settings: timezone setting присутствует и работает (изменение → UI рендер обновляется).
9. Rate Setter расширен под vocabulary 3.10.

---

## 4. Architecture invariants (do not violate)

1. **Pre vs post water-divide:** see 3.7.
2. **Event log = canonical truth.** Все агенты читают/пишут только через event log. Stages derive from events. UTC timestamps.
3. **XMP keywords vocabulary:** см. 3.10. Только префиксированные `_*` теги, чтобы не конфликтовать с пользовательскими keyword'ами.
4. **Drive = post-selection only.** Не использовать Drive для preview/cache/work-in-progress.
5. **Никаких emoji/иконок в UI** (правило Маши).
6. **Все timestamps в UTC.** Конвертация в local — только в UI render layer.
7. **Один установщик.** Maket CP как .app — единственное что ставит пользователь.

---

## 5. Open questions для следующего разговора

Не блокируют overnight работу, нужны только для refinement в следующем цикле:

1. **Grading stage cleanup** — чистим как CC (delete unpicked) или храним как retouch? Дефолт сейчас — храним.
2. **Onboarding wizard scope** — только permissions + session path, или ещё «default brand», «default folder», «default recipe» и т.п.?
3. **Pause button в Shoot mode** — нужна ли отдельная кнопка «пауза» (chai/lunch) или достаточно continuous timer?
4. **Hotkey customization** — UI для смены `Cmd+Shift+C` в settings, или забили?
5. **Multi-monitor C1** — что если у Маши/пользователя два монитора, как отличать «active» selection от «inactive»? AppleScript обычно возвращает primary, но проверить.

---

## 6. Execution plan для overnight

**Track 1 (Drive):**
- Завершить активную задачу `GDrive integration via Desktop Commander` (она идёт)
- Расширить: миграция 034 + `drive_file_id` поле + UI integration
- Quality gate (<20MB blocker)
- Cleanup job для CC unpicked

**Track 2 (Desktop + C1-bridge):**
- py2app сборка + ad-hoc signing + auto-update через git pull
- Вкладка «Съёмка» — UI + lifecycle
- AppleScript bridge (Python wrapper)
- Watcher на C1-сессию
- First-run permission flow
- UTC audit script + правки
- XMP vocabulary в Rate Setter

**Параллельно:**
- Hotkey "Add to Card" (нужны Track 2 deps)
- Pre-selection automation по rating

**Order внутри tracks:**

Track 1 → Drive UI и quality gate можно сразу, миграция уже в работе.

Track 2 → последовательность: py2app → permissions → AppleScript bridge → watcher → hotkey. Каждый этап тестируется на пиратке Capture One.

**Виктория interrupt:** в любой момент при сигнале от Маши прервать оба tracks, выполнить per-brand rename, вернуться.

---

*Спека locked 2026-04-30 23:xx UTC. Не редактировать без обсуждения с Машей.*
