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
