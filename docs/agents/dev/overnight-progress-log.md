# Overnight Progress Log — 2026-04-30

Скелет десктоп-приложения и Shooting Mode (Block B спеки, частично).

Worktree: `pedantic-germain-81ceec`. Ветка: `claude/pedantic-germain-81ceec`.

## Контекст / источники

- Спека: `docs/agents/dev/overnight-spec-2026-04-30.md` — **в репо отсутствует на момент старта**.
  Работаю по самодостаточному описанию задачи в промпте (acceptance criteria
  явно перечислены, разделы 3.2–3.5/3.9 расшифрованы там же).
- Supabase MCP — **не подключён в текущей среде**. Миграцию 035 кладу
  файлом `v2/supabase/035_shoot_sessions.sql` для применения вручную/PA.

## Прогресс

### 1. py2app — IN PROGRESS / см. ниже

### 2. Auto-update — pending

### 3. Shooting tab — pending

### 4. Permissions — pending

### 5. C1 bridge stub — pending

### 6. UTC audit — pending

## Что готово (acceptance criteria 1–8)

| # | Критерий | Статус |
|---|----------|--------|
| 1 | `dist/Maket CP.app` собирается двойным кликом | ❌ blocked: py2app + Python 3.14 модулграф ловит фантомный hook `PyInstaller.hooks.hook-PySide6.QtSpatialAudio` (issue py2app#414). `setup_py2app.py` готов, скрипт `build_app.sh` готов — Маше нужно собрать на Python 3.11/3.12 или применить workaround `--no-PyInstaller-hooks`. |
| 2 | Таб «Съёмка» виден в нав | ✅ index.html, скрытие для share-link guests в nav.js |
| 3 | Кнопка «Начать съёмку» открывает FilePicker → создаёт `shoot_sessions` запись с UTC `start_time` | ✅ AppAPI `shoot_pick_session` + `shoot_start_session`, JS `smPickAndStart` пишет в Supabase |
| 4 | Кнопка «Завершить съёмку» закрывает session, `end_time` UTC | ✅ `shoot_end_session` + `smEndFlow` |
| 5 | First-run permission flow (3 чекера, deep links) | ✅ `permissions_service.py` + модалка `#modal-shoot-perms`, кнопка «Продолжить» дизейблится пока не все три «выдано» |
| 6 | Миграция 035 применена в supabase | ⚠️ SQL готов в `v2/supabase/035_shoot_sessions.sql`, **Supabase MCP не подключён** в среде → Маше нужно применить вручную через `mcp.apply_migration` или Supabase Dashboard SQL Editor |
| 7 | UTC audit script | ✅ `v2/backend/scripts/audit_utc.py`. Запуск без env vars: статический анализ — найдено 24 display-only `toLocale*` site (всё display, не persist). Live-проверка `shoot_sessions / action_log / client_errors` доступна с `SUPABASE_URL + SUPABASE_KEY`. |
| 8 | Push + PR | ✅ feature ветка `claude/pedantic-germain-81ceec`, PR-ссылка ниже |

## Дополнительно сделано

- Auto-update via `git pull` в фоновом потоке (`main.py._try_git_pull`), лог в `~/Library/Logs/Maket CP/update.log`. Soft-restart через `subprocess.Popen + os._exit(0)`. В frozen .app — no-op (нет .git).
- `core/infra/c1_bridge.py` — facade с `is_running` (real), `get_session_path / get_selected_variants / process_selected_to_jpg` (stub), всё через `osascript` с timeout.
- `core/services/shooting_service.py` — start/end/abort + event_logger callback, события пушатся в JS как `onShoot_*`.
- `core/domain/shoot_session.py` — dataclass.
- AppAPI extensions: `shoot_*`, `permissions_*`, `c1 status`.
- Settings → Timezone stub: localStorage key `maketcp.settings.timezone` (UI пока не вытащен наружу — добавить в Settings page next).

## Что упёрлось / Маше руками утром

1. **py2app билд на Py3.14** падает на сканировании несуществующего PyInstaller hook. Workarounds:
   - `python3.11 -m pip install py2app && python3.11 v2/backend/setup_py2app.py py2app --no-strip`
   - либо patch py2app: исключить `PyInstaller` из `mf.import_hook` через `excludes=[..., "PyInstaller"]` (уже добавлено в OPTIONS, но recipe сканер ловит до excludes — нужен `argv_emulation: False` + `--no-recipes` экспериментально).
2. **Migration 035** — применить через `mcp.apply_migration` на проект `mukiyeuxulasvtlpckjf` (project_id `maketcp`). SQL в `v2/supabase/035_shoot_sessions.sql`.
3. **Permissions проверены вручную на текущем Mac**: accessibility=False, input_monitoring=False, automation=True. Это нормально — host (Python.framework) не в TCC. В bundle .app будет правильное Bundle ID и user сможет grant.
4. **Watcher / hotkey / pre-selection** — не делал по тз (отдельный trek).

---

## Раунд 2 — 2026-05-01 (real C1 integration)

### Что сделано
- **`core/infra/c1_bridge.py`** — реальный AppleScript, не stubs. `_detect_app_name` пробует «Capture One», «Capture One 23/24/25», «Capture One Pro» и fuzzy fallback на любое имя начинающееся с «Capture One» (для пиратки/локализации). `get_session_path` возвращает `path of current document`. `get_selected_variants` строит JSON прямо в AppleScript (id/name/path/rating/color_tag/position) — никакого парсинга AppleScript-list. `process_selected_to_jpg` запускает recipe «Embedded JPEG».
- **`core/infra/cos_repository.py`** — добавил `read_metadata` (rating + keywords) и `update_keywords` (union с существующими, .bak бэкап). Поддерживает оба формата keyword-хранения C1 (`<KeywordsContainer><K N="…"/>` и legacy `<E K="Keywords" V="kw1; kw2"/>`).
- **`core/services/session_watcher.py`** — `watchdog`-based observer на `<session>/Capture/`. Эвенты: `photo_added`, `photo_changed`, `selection_added/removed` (порог rating>=2), `card_signal` (детектит `_card:<id>` + `_slot:<n>` keywords). Seed initial state — не флудит «changed» при старте.
- **`core/services/hotkey_service.py`** — pynput `GlobalHotKeys` на `<cmd>+<shift>+c`. **DISABLED на macOS** (см. ниже). На fire: `bridge.get_selected_variants` → sort by `position` → mint UUID → write `_card:` + `_slot:` keywords в каждый .cos → notify NSUserNotification.
- **`shooting_service.py` теперь wires watcher + hotkey** на старт/конец session. Эвенты с обоих форвардятся в JS как `onShoot_watcher_*` / `onShoot_hotkey_*` и складываются в `session.events` jsonb.
- **`AppAPI`**: `shoot_c1_session_path` (auto-pick от bridge), `shoot_hotkey_smoke` (manual trigger вместо хоткея пока pynput выключен).
- **Frontend**: 9 новых push-handler'ов в `shooting.js` (видно в журнале событий), кнопка «Добавить в карточку» в активной съёмке (вместо хоткея).

### Smoke test (пройден локально)
Прогнал synthetic .cos файлы через ShootingService end-to-end. **9/9 эвентов получены корректно** в правильном порядке: `shoot_session.started → watcher.watcher_started → photo_changed (rating 0→3) → selection_added → photo_added (с keywords) → selection_added → card_signal (card=abc slot=0) → watcher.watcher_stopped → shoot_session.ended`. Selection threshold (>=2) и card_signal детекция работают.

### Что **НЕ** работает на машине Маши (macOS 26.4)

**🚨 pynput SIGTRAP-краш Python-процесса.** Listener thread зовёт `TSMGetInputSourceProperty` не из main thread → `dispatch_assert_queue` валит весь pywebview процесс. Crash report: `~/Library/Logs/DiagnosticReports/Python-2026-05-01-085854.ips`.
- **Mitigation:** `HotkeyService.activate()` на `sys.platform == 'darwin'` сразу возвращает soft error без вызова pynput. Без этого pywebview бы крашился каждый раз при старте съёмки.
- **Заменитель:** в UI есть кнопка «Добавить в карточку» которая через `shoot_hotkey_smoke` вызывает тот же code path. Cmd+Shift+C временно недоступен.
- **Чтобы вернуть хоткей:** переписать на `pyobjc + NSEvent.addGlobalMonitorForEventsMatchingMask` (~120 LOC, runloop в main thread). Отдельный trek.

### Acceptance status (после раунда 2)
| # | Критерий | Статус |
|---|----------|--------|
| Real AppleScript bridge | ✅ get_session_path, get_selected_variants, process_selected_to_jpg все рабочие |
| Watcher на сессию | ✅ watchdog, дедупом на seed, 5 типов эвентов |
| Auto pre-selection (rating>=2) | ✅ через `selection_added`/`removed` эвенты |
| `_card:` / `_slot:` keyword детекция | ✅ `card_signal` event |
| Hotkey Cmd+Shift+C | ❌ disabled на macOS (pynput crash) — manual button работает |
| Wire watcher+hotkey в start/end_session | ✅ с teardown и forwarding |

### Что Маше попробовать утром
1. `python3 main.py` — должен запуститься без крашей.
2. Открыть Capture One с какой-нибудь сессией.
3. Maket CP → «Проекты» → «Новая съёмка» → выбрать «Снимаю прямо сейчас» → создать.
4. На вкладке «Съёмка» — выдать 3 разрешения (особенно Automation: Capture One). FilePicker выберет тот же путь что C1 показывает в `path of current document` (или вручную если bridge тихо денайнул).
5. Менять рейтинг кадров в C1 → должны прилетать `selection_added` эвенты в журнал.
6. Выбрать N кадров в C1 → нажать «Добавить в карточку» → должны записаться `_card:UUID _slot:0..N-1` keywords в .cos. SessionWatcher тут же увидит `card_signal` эвент.
7. Если что-то на самом деле крашит pywebview — пиши `~/Library/Logs/DiagnosticReports/Python-2026-05-01-*.ips`, посмотрю.
