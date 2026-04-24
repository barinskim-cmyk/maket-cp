---
type: doc
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

> **TL;DR:** Maket CP — платформа для визуального продакшена. Отражает реальный процесс команды — вы видите его и управляете по-настоящему. Экономит время и деньги. (locked Version A, 2026-04-23; см.

# Maket CP -- Инструкции для Claude

## Проект

Maket CP — платформа для визуального продакшена. Отражает реальный процесс команды — вы видите его и управляете по-настоящему. Экономит время и деньги. (locked Version A, 2026-04-23; см. `strategy-2026.md` раздел 1.)

Desktop-first web app (pywebview + Python) + веб-клиент для заказчиков/ретушёров.
Владелец: Masha (barinski.m@gmail.com), коммерческий фотограф. Продукт родился из её собственной практики, но ICP — команда продакшена и владелец проекта; фотограф — канал (bottom-up motion), не основной покупатель.

## Git: обязательные правила

1. **Коммит после каждого логического изменения.** Не копить -- одна задача = один коммит.
2. **Формат коммита:**
   ```
   Краткое описание на английском (до 72 символов)

   - Что изменено (bullet points)
   - Какие файлы затронуты

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```
3. **Перед началом работы** -- проверить `git log --oneline -5` чтобы понять контекст.
4. **Workaround для lock-файлов** в этой среде: использовать `GIT_DIR=/tmp/maketcp_git` как описано ниже.
   **ОБЯЗАТЕЛЬНО включать fetch + rebase перед коммитом и push после** -- иначе у Masha будет non-fast-forward при git push:
   ```bash
   cp -r .git /tmp/maketcp_git
   rm -f /tmp/maketcp_git/*.lock /tmp/maketcp_git/objects/maintenance.lock
   # 1. Синхронизироваться с remote перед коммитом
   GIT_DIR=/tmp/maketcp_git GIT_WORK_TREE="$(pwd)" git fetch origin main 2>/dev/null || true
   GIT_DIR=/tmp/maketcp_git GIT_WORK_TREE="$(pwd)" git rebase origin/main 2>/dev/null || true
   # 2. Добавить файлы и закоммитить
   GIT_DIR=/tmp/maketcp_git GIT_WORK_TREE="$(pwd)" git add <files>
   GIT_DIR=/tmp/maketcp_git GIT_WORK_TREE="$(pwd)" git commit -m "..."
   # 3. Скопировать обратно и запушить
   cp -r /tmp/maketcp_git/* .git/ 2>/dev/null
   GIT_DIR=/tmp/maketcp_git GIT_WORK_TREE="$(pwd)" git push origin main 2>/dev/null || true
   ```
   Если push упал -- не критично, Masha может запустить `git sync` вручную.
5. **Никогда не делать** `git add .` или `git add -A` -- только конкретные файлы.

## Архитектура: не ломать

### Слоистая архитектура (строго соблюдать)
```
Frontend (HTML/JS)  -->  pywebview bridge  -->  AppAPI  -->  Services  -->  Domain / Infra
```

- **Domain** (`v2/backend/core/domain/`) -- чистые dataclass, без импорта сервисов или инфраструктуры
- **Services** (`v2/backend/core/services/`) -- бизнес-логика, импортируют только domain и infra
- **Infra** (`v2/backend/core/infra/`) -- работа с файлами, COS, внешние системы
- **API** (`v2/backend/core/api/`) -- bridge JS<->Python, импортирует services
- **Frontend** (`v2/frontend/js/`) -- модульная архитектура, каждый файл = один экран/функция

### Ключевые сущности (domain)
- Photo -- фотография (name, stem, path, rating, rotation, tags, source)
- Card -- карточка товара (slots, category, status, comments)
- Slot -- позиция в карточке (options[], selected, comment)
- CardTemplate -- шаблон сетки (slots[], rows, cols, min/max_photos)
- Project -- съёмка (brand, template, cards, categories, channels, stage, stage_history)
- StageEvent -- запись перехода этапа (stage_id, timestamp, trigger)
- Comment -- комментарий (author, text, created_at)
- Article -- артикул (id, sku, category, color, refImage, status: unmatched|matched|verified, cardIdx)

### Frontend модули
- state.js -- App, константы, утилиты, проверка бэкенда
- nav.js -- навигация, модалки
- shootings.js -- проекты, пайплайн, авто-синхронизация с облаком, оффлайн-режим
- layout.js -- движок раскладки карточек
- cards.js -- редактор карточек
- previews.js -- превью-панель (XMP, фильтры, lazy loading)
- articles.js -- артикулы: чек-лист, сопоставление, верификация, импорт legacy
- sync.js -- Rate Setter UI
- supabase.js -- Supabase SDK: авторизация, CRUD проектов/карточек/слотов, share
- cloud-ui.js -- UI облака: auth gate, логин, регистрация, загрузка проектов

### Dual-mode: desktop + browser
Весь frontend должен работать БЕЗ Python (браузерный фолбэк). Проверка:
```javascript
if (window.pywebview && window.pywebview.api) { /* desktop */ }
else { /* browser fallback */ }
```

## Стиль кода

### JavaScript
- Без фреймворков, чистый JS (ES5-совместимый, var вместо let/const)
- Функции с префиксом модуля: cp* (cards), pv* (previews), rs* (sync), ar* (articles), sh* (shootings), oc* (other content)
- Никаких emoji/иконок в UI (требование Masha)
- HTML генерируется строками (html += '...')

### Python
- Type hints обязательны
- Dataclass для domain-объектов
- Docstrings на русском или английском

### CSS
- Flexbox для лейаутов (.pv-gallery, .cp-layout)
- Переменные не используются (плоский CSS)

## Контрольные точки и тестирование

### После каждой задачи (обязательно):
1. Сделать коммит (git, через GIT_DIR workaround)
2. Обновить backlog.html -- поменять статус задачи на DONE
3. Проверить что не сломались существующие экраны

### Тестирование Masha:
- В backlog.html есть колонка **"Тест"** -- кликабельная ячейка с состояниями: `--` → `OK` → `FAIL` → `?` → `--`
- Masha кликает на ячейку после проверки каждой задачи
- Все изменения **авто-сохраняются** в localStorage браузера
- Сводка тестов отображается вверху таблицы (прогресс-бар)
- JSON экспорт/импорт доступен для переноса между устройствами

### Правила контрольных точек:
- Контрольные точки (ПРОВЕРКА 1-7) -- это **обязательные паузы** для ручного тестирования Masha
- Не переходить к следующему блоку задач, пока Masha не подтвердит ПРОВЕРКУ
- Если тест = FAIL или ?, **сначала исправить**, потом двигаться дальше
- После исправления -- новый коммит с пометкой "fix:"

### Баги (вкладка "Баги" в backlog.html):
- Masha добавляет баги через форму на вкладке "Баги"
- Каждый баг: экран, описание, приоритет, связь с задачей
- Галочка = исправлено, автоматическая дата фикса
- Поле "Коммит" -- вписать хэш коммита с исправлением
- При обнаружении бага в коде -- **тоже добавить** в таблицу багов
- Баги с высоким приоритетом исправлять **до** продолжения новых задач

### Синхронизация backlog.html:
- После каждого изменения кода -- обновить статус задачи в backlog.html
- Если добавлены новые задачи -- включить их в таблицу
- Коммитить backlog.html вместе с кодом

## Как читать бэклог Masha

Masha оставляет комментарии в:
- Колонка "Мои комментарии" в backlog.html (авто-сохраняется в localStorage)
- Колонка "Тест" в backlog.html -- результаты ручного тестирования

В начале каждой сессии проверить backlog.html и прочитать комментарии Masha.

(Ранее планировались файлы `audit_edits.json` и `backlog_edits.json`, но механика упразднена в пользу backlog.html/localStorage — см. changelog.)

## Запуск

### Desktop (Mac)
```bash
cd v2/backend && pip3 install Pillow && python3 main.py
```

### Браузер (для тестирования)
Открыть `v2/frontend/index.html` в браузере. Всё работает без Python, кроме:
- Выбор папки (только drag-and-drop)
- Rate Setter (нужен Python для записи .cos)
- Сохранение проекта в файл

## Changelog — canonize Version A (2026-04-23 autonomous cleanup)

- Заменил «DAM для коммерческих фотографов» на locked Version A (см. `strategy-2026.md` раздел 1 и `audits/coordinator-reconciliation-2026-04-23.md` п.1.3, 2.3).
- Убрал упоминание несуществующих `audit_edits.json` / `backlog_edits.json` — канал de-facto упразднён (см. reconciliation audit п.2.6, 4.14).
- Источник правды: `strategy-2026.md:10`.

## Важно помнить

- Карточка товара -- ЦЕНТРАЛЬНАЯ сущность. Всё крутится вокруг неё.
- Три роли: фотограф (desktop), клиент (web), ретушёр (web). Каждый экран учитывать с позиции всех ролей.
- Rate Setter пишет не только рейтинг, но и ключевые слова в COS.
- Превью-панель должна быть ресайзабельной (как в Capture One).
- Пайплайн -- по триггерам, не по кнопке.
