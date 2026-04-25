---
type: ui-spec
feature: compare-view
status: design-ready
owner: DAD
created: 2026-04-25
updated: 2026-04-25
feature_flag: DEBUG_COMPARE_VIEW
priority: high
scope: MVP
revision: retry-tight
---

> **TL;DR:** Экран сравнения двух версий фото side-by-side (desktop) или swipe (mobile). Slot A + Slot B с независимыми dropdown, badge'ами stage/v#, тогглом «Выбрать», общим comment-полем. Палитра A (монохром), без emoji, behind `DEBUG_COMPARE_VIEW`.

# Compare View — UX-спецификация (MVP, retry)

## 1. Цель и Scope MVP
Команда и клиент видят две версии одного фото бок о бок и фиксируют, какая идёт дальше по пайплайну. Только 2 слота. Comment — на photo, не на version. Без zoom-sync и diff overlay.

## 2. User journey
Галерея → у фото есть «+N версий» → клик «Сравнить версии» → compare view → dropdown переключает версию на каждой стороне независимо → toggle «Выбрать» пишет stage event → comment сохраняется по blur и Cmd/Ctrl+Enter → Close возвращает в галерею с обновлённым бейджем у фото. Дефолт slot A = последняя retouch, slot B = последняя grading (или cc, если grading нет).

## 3. Wireframe — Desktop (≥1024px)
```
[← Назад]          Сравнение версий — IMG_0421.jpg          [×]
┌──────────────────────────────┬──────────────────────────────┐
│ [РЕТУШЬ · v3]                │ [ГРЕЙДИНГ · v1]              │
│ 24.04.2026 · Аня Р.          │ 25.04.2026 · Маша Б.         │
│ ┌────────── фото A ────────┐ │ ┌────────── фото B ────────┐ │
│ └──────────────────────────┘ │ └──────────────────────────┘ │
│ [Ретушь · v3 ▾]    (•) Выбрана │ [Грейдинг · v1 ▾]  ( ) Выбрать │
└──────────────────────────────┴──────────────────────────────┘
[ Комментарий к фото ............................. ] [Сохранить]
```

## 4. Wireframe — Mobile (<768px)
```
[← Назад]   IMG_0421.jpg   [×]
[РЕТУШЬ · v3]   24.04 · Аня Р.
┌─── фото A ────────────────┐
│                           │
└───────────────────────────┘
[Ретушь · v3 ▾]   ( ) Выбрать
        ●  ○      ← swipe dots (A / B)
[ Комментарий к фото ............ ]
[ Сохранить ]
```
Swipe влево/вправо (snap 180ms) переключает A/B. Один слот на экране.

## 5. Color palette — A (монохром)
- `--bg-canvas: #0F0F10` — фон экрана
- `--bg-slot: #1A1A1A` — letterbox слота
- `--bg-surface: #1F1F21` — header / comment panel
- `--fg-primary: #F3F3F3` — основной текст
- `--fg-secondary: #9B9B9E` — meta (timestamp, author)
- `--border: #2A2A2D` — границы и divider
- `--accent-select: #FFFFFF` — selected outline + filled badge
- `--danger: #E05252` — error / destructive

Selected slot = белая рамка 2px + filled-белая кнопка с чёрным текстом. Без цветных акцентов.

## 6. States
- **loading** — оба слота скелетон (пульс `#1A1A1A → #222`), header с photo_name виден сразу. После 800ms — spinner 24×24 по центру.
- **error per-side** — серая заглушка + текст «Не удалось загрузить версию» + кнопка «Попробовать снова». Противоположный слот не страдает.
- **no-versions** — entry-point скрыт; deep-link → centered empty state «У этого фото пока нет версий» + CTA «Вернуться к галерее».
- **only-one-version** — кнопка «Сравнить» в галерее скрыта (не disabled). Deep-link → empty state «Для сравнения нужно минимум 2 версии».
- **same-version-on-both-sides** — баннер сверху «Слева и справа одна и та же версия».
- **selected** — на active slot белая рамка 2px + статичный tag «✓ Выбрана»; противоположный — кнопка «Выбрать эту версию».
- **comment-saving / saved / failed** — кнопка disabled+spinner; toast «Комментарий сохранён» / inline error.

## 7. Empty / error messages (RU)
- Loading: «Загрузка версий…»
- Per-side error: «Не удалось загрузить версию»
- No versions (toast): «У этого фото пока нет версий»
- Only one version: «Нужно минимум 2 версии для сравнения»
- Same version banner: «Слева и справа одна и та же версия»
- Network lost: «Нет соединения»
- Save failed: «Не удалось сохранить, повторите»

## 8. Feature flag
`DEBUG_COMPARE_VIEW` (default `false`) — `App.flags.DEBUG_COMPARE_VIEW` в `state.js`. При `false` кнопка «Сравнить версии» не рендерится; deep-link отдаёт empty state. Mount'ится всегда — feature ship'нут hidden.

## 9. Out of scope MVP
Per-version comments; 3+ версии; sync zoom/pan; before/after slider; diff overlay; inline annotations.
