# Maket CP — концепция и текущее состояние

**Что это.** Платформа для визуального продакшена. Идея простая: фотограф снимает, продакшен-команда отбирает, клиент согласовывает, ретушёр обрабатывает. Сегодня всё это размазано по чатам, гугл-таблицам, файлообменникам и часам на zoom-созвонах. Maket CP собирает весь процесс в одно место — где видно реальное состояние, кто что делает, и где простой.

**Миссия.** Дать команде продакшена прозрачность по всему циклу съёмки, чтобы каждый видел свою работу в общем контексте, а не вытаскивал её из чужих голов.

**Цель** — экономия времени и денег за счёт того, что:
- фотограф не воюет с таблицами и не пересылает превью вручную;
- клиент видит отбор сам, может править его прямо в браузере по ссылке, согласовывает в один клик;
- ретушёр получает готовый список с пометками от клиента, не пишет «а что финально?»;
- владелец проекта в любой момент видит, на каком этапе стоит работа.

**ICP** — продакшен-команда (бренды, маркетплейсы, e-com студии). Фотограф — канал захода (bottom-up): продукт нравится фотографу, он рекомендует продакшену.

---

## Как сейчас устроено

Два компонента, общая база данных.

**Десктоп для фотографа** — pywebview-приложение на маке. В нём шут-режим: подключаешь активную сессию Capture One, программа сама читает .cos-файлы, ловит рейтинги и ключевые слова, отображает живую галерею. Хоткей **Cmd+Shift+C** превращает выделенные в C1 кадры в карточку товара со слотами правильной ориентации. Проекты хранятся локально и синхронизируются с облаком автоматически.

**Веб-клиент** для клиента и ретушёра — статический сайт на GitHub Pages (`https://barinskim-cmyk.github.io/maket-cp/`). Открывается по share-ссылке без логина. Можно посмотреть проект, поменять варианты в карточках, оставить комментарии, согласовать отбор. Ретушёрский режим показывает только финальный отбор с пометками клиента.

**Сервер** — Supabase (Postgres + RLS). Хранит проекты, карточки товара, слоты, превью, артикулы, события пайплайна, логи действий, share-ссылки. Гостевой доступ по share-токену реализован через RPC-функции с `SECURITY DEFINER`, чтобы RLS не пропускал owner-only операции.

---

## Что уже работает

- **Live shoot mode с Capture One**: filesystem watcher на .cos, глобальный хоткей через pyobjc NSEvent, AppleScript-bridge для активной сессии.
- **Карточки товара с шаблонами** 1H+2V, 3H, 4V и кастомные. Hero-слот, авто-расстановка по orient, drag-n-drop, сохранение пользовательских шаблонов.
- **Share-ссылки трёх ролей**: client (правит), retoucher (видит финал + комменты), viewer (только смотрит).
- **Двусторонний sync проекта** с облаком, защита от пустых push-ов и race condition между client/owner правками.
- **Soft-delete всего** (карточек, слотов, проектов) с возможностью восстановления.
- **Pipeline-события**: `preview_loaded`, `selection_done`, `send_client_link`, `client_approved`, `client_extra_request`, `color_correction_done`, `retouch_done`. Триггерятся автоматически по действиям, не по кнопкам.
- **Метаданные .cos читаются полностью**: рейтинг, keywords, Exp_Date (capture time), ориентация, диафрагма, ISO, фокусное, линза, камера, все ЦК-настройки. Это база для метрик «время на артикул», «темп съёмки», «SLA до согласования».
- **Артикулы**: импорт из таблиц, AI-матчинг фото к артикулу через OpenAI Vision (edge function), переименование файлов с логированием в `rename_log`.
- **Action log**: каждое действие участника пишется в БД (от owner и от guest по share-токену через RPC `log_action`).

---

## Состояние проекта

В бете. Один платящий клиент (бренд EKONIKA, фотограф работает на их съёмках), активная разработка по приоритету «рост продукта > формальность» — фичи добавляются по мере боли клиента, не по плану-году.

**Релизы**: каждый коммит в `main` → авто-деплой web-клиента на GitHub Pages. Десктоп пересобирается локально по запросу. Cache-busting через `?v=N` query-params на assets.

---

## Ближайшие достижения

1. **`captured_at` в БД для каждого превью** — миграция previews + sync, чтобы метрики времени считались не локально.
2. **Стейдж-события для всех ключевых триггеров** — сейчас часть событий пишется только в localStorage. Включить полный SLA в Supabase.
3. **Вкладка «Метрики» в проекте** — дашборд по съёмке, темпу, перерывам. Прототип уже есть в виде PPTX-презентации; нужно переписать на JS-чарты.
4. **Версионирование превью** — один photo = одна плитка, версии переключаются. Сейчас разные JPG'и одного RAW попадают как отдельные строки.
5. **Originals storage** в Google Drive с download-логом (после оплаты Supabase Pro).
6. **Brand recipe из C1** — срез типичных C1-настроек проекта, алерт при отклонении на новой съёмке.
7. **Justified-layout** (Flickr/Yandex.Disk-стиль) в Select / Options / Other галереях.
8. **AI rename + AI match** — развить до автоматического сопоставления article ↔ card.

---

## Стек

- **Backend**: Python 3, pywebview, watchdog (FS watcher), pyobjc (hotkey + AppleScript).
- **Frontend**: чистый ES5-совместимый JS без фреймворков, без бандлеров. Модульная архитектура (`state.js`, `nav.js`, `shootings.js`, `cards.js`, `previews.js`, `articles.js`, `sync.js`, `supabase.js`, `cloud-ui.js`).
- **Cloud**: Supabase (Postgres 17 + RLS + storage + edge functions). Edge functions на Deno для git-push proxy и AI Vision.
- **Hosting**: GitHub Pages для статики веб-клиента.

---

## Архитектура backend

Слоистая, строго соблюдается:

```
Frontend (HTML/JS)  →  pywebview bridge  →  AppAPI  →  Services  →  Domain / Infra
```

- **Domain** (`v2/backend/core/domain/`): чистые dataclass без импорта сервисов или инфры. Photo, Card, Slot, CardTemplate, Project, StageEvent, Comment, Article.
- **Services** (`v2/backend/core/services/`): бизнес-логика. shooting_service, card_service, project_service, preview_service, version_service, article_service, rate_setter, hotkey_service, session_watcher, permissions_service.
- **Infra** (`v2/backend/core/infra/`): cos_repository (read/write .cos XML), c1_bridge (AppleScript к Capture One).
- **API** (`v2/backend/core/api/`): bridge JS↔Python через pywebview js_api, плюс эндпоинты для preview rendering.

---

## Ключевые таблицы Supabase

- **projects** — съёмки (brand, shoot_date, stage 0..7, deleted_at, oc_containers jsonb, events jsonb, annotations, comments).
- **cards** — карточки товара (id text, project_id, position, status, has_hero, h_aspect, v_aspect, soft-delete).
- **slots** — позиции в карточке (card_id, position, orient, weight, row_num, file_name, thumb_path, original_path).
- **previews** — превью фото проекта (file_name, rating, orient, stage, position).
- **photo_versions** — версии превью (color_correction / retouch / grading, version_num, selected).
- **photo_originals** — RAW/TIFF в external storage (storage_backend: gdrive/s3/b2, file_id, parent_folder_id).
- **articles** — артикулы (sku, category, color, status: unmatched/matched/verified, card_idx, ref_image_path).
- **stage_events** — события пайплайна (stage_id, trigger_desc, note).
- **action_log** — детальный лог действий (actor_token / actor_role: owner|client, action, target).
- **share_links**, **project_members**, **comments**, **oc_comments**, **annotations**, **snapshots**, **rename_log**, **ai_match_decisions**, **client_errors**.

RLS: owner — `auth.uid() = owner_id`; share-link guest — отдельные RPC с `SECURITY DEFINER` (например `save_cards_by_token`, `client_approve_by_token`, `oc_add_item_by_token`, `log_action`, `get_project_by_token`).

---

## Точка входа в код

- **Репо**: `https://github.com/barinskim-cmyk/maket-cp`
- **CLAUDE.md** в корне — обязательные правила: git-flow с GIT_DIR workaround, layered architecture, dual-mode требование (frontend работает и в pywebview, и в браузере без Python через фолбэки), стиль кода (ES5, var вместо let/const, никаких emoji в UI), принцип «рост продукта > формальность».
- **v2/backend/main.py** — entry point pywebview app.
- **v2/frontend/index.html** — entry point web client.
- **v2/supabase/** — миграции SQL (RLS policies, RPC functions).
- **docs/** — стратегия (`strategy-2026.md` — locked positioning), аудиты, планы (`audits/coordinator-reconciliation-*` — фиксированные источники правды), `agents/dev/template-audit-plan-2026-05-02.md` — план рефакторинга шаблонов.

---

## Data flow

```
Camera → Capture One session → .cos files (XML metadata)
                                         ↓
                            session_watcher (filesystem watcher)
                                         ↓
                              read_metadata (rating/keywords/Exp_Date)
                                         ↓
                  emit events: photo_added, photo_changed, selection_added
                                         ↓
        frontend (smEnsurePhoto) → proj.previews → autosave (localStorage + disk)
                                         ↓
                    Cmd+Shift+C hotkey → new card, slots filled by orient
                                         ↓
                Drag-and-drop → slot.file = filename, orient detected
                                         ↓
              shCloudSyncExplicit → Supabase (cards/slots upsert + previews)
                                         ↓
                    Share-link (?share=token) → guest читает get_project_by_token
                                         ↓
                      Guest edits slots → save_cards_by_token RPC
                                         ↓
                    Approve → client_approve_by_token → stage_event + action_log
                                         ↓
              Stage advance, photographer notification, retouch task pickup
```

---

## Контакт

barinski.m@gmail.com · github.com/barinskim-cmyk/maket-cp

Документ: 2026-05-08
