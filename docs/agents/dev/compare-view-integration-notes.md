# Compare View — интеграционные заметки (PA, 2026-04-24)

## TL;DR

Готов MVP backend + stand-alone страница для сравнения 2-х версий фото side-by-side. Всё спрятано под фича-флагом `DEBUG_COMPARE_VIEW` — без него ничего не меняется.

## Что добавлено

### 1. `v2/frontend/js/supabase.js`
- `_compareViewEnabled()` — helper, читает `localStorage.DEBUG_COMPARE_VIEW` (паттерн `_rsFixEnabled`).
- `sbGetPhotoVersions(projectId, photoName)` — Promise, возвращает массив версий. Подтягивает поля: `id, project_id, photo_name, stage, version_num, selected, preview_path, cos_path, created_at, created_by, metadata`. Сортировка: `stage ASC, version_num DESC`. Ошибки логирует, возвращает `[]` (UI не падает).

**Важно про сигнатуру.** В task-спеке была упомянута `sbGetPhotoVersions(photoId)`, но в текущей схеме `photo_versions` (см. `v2/backend/migrations/001_photo_versions.sql` и `v2/supabase/030_photo_versions.sql`) колонки `photo_id` нет — идентификатор фото это пара `(project_id, photo_name)`. Функция принимает эту пару. Если в будущем появится отдельная `photos`-таблица с UUID-ключом, функция станет тонкой оболочкой без изменения API у вызывающих.

### 2. `v2/frontend/compare-view.html`
Stand-alone страница. Подключает supabase SDK, `js/supabase.js` и `js/compare-view.js`. Плоский CSS (без переменных) — в соответствии со стилем проекта.

### 3. `v2/frontend/js/compare-view.js`
IIFE, без глобальных коллизий. Логика:
- Читает `project_id` и `photo_name` (или `photo_id` как алиас) из query string.
- Вызывает `sbInit()`, потом `sbGetPhotoVersions()`.
- Рендерит два слота A/B с dropdown'ом версий и кнопкой «Выбрать».
- Клик на «Выбрать» → `sbSelectPhotoVersion(versionId, projectId, photoName, stage, cb)` → локальный ререндер.
- Картинки берутся из `postprod` бакета через `sbClient.storage.getPublicUrl(preview_path)`. Если `preview_path` уже абсолютный URL — используется как есть.
- Feature-gate: без флага показывается «в разработке» с инструкцией как включить.

### 4. Wire-up в лайтбоксе (минимальный)
`v2/frontend/js/previews.js` → `_pvLbOpenDesktop`. Рядом с `nameEl`/`closeBtn` добавлена кнопка **«Сравнить версии»**, обёрнутая в `try/catch` и условие `_compareViewEnabled()`. Без флага кнопки нет — существующий UX не меняется. Клик открывает `compare-view.html?project_id=...&photo_name=...` в новой вкладке.

Мобильный лайтбокс (`_pvLbOpenMobile`) не трогал — compare-view концептуально требует как минимум два слота, что неудобно на узком экране.

## Как включить / выключить

В DevTools (консоль браузера):

```js
// ON
localStorage.setItem('DEBUG_COMPARE_VIEW', '1');
// OFF
localStorage.removeItem('DEBUG_COMPARE_VIEW');
```

Затем перезагрузить приложение. Кнопка появится в лайтбоксе (если для фото есть версии и проект имеет `_cloudId`).

## Прямая ссылка (для разработки / QA)

```
compare-view.html?project_id=<uuid проекта>&photo_name=<IMG_0001.CR3>
```

Например:
```
https://<host>/compare-view.html?project_id=a1b2c3d4-...&photo_name=IMG_0042.CR3
```

## Что остаётся DAD (визуал)

`docs/agents/design/compare-view/` — пустая папка на момент PR. Когда DAD родит spec:
1. Заменить минимальный CSS в `compare-view.html` на финальный (цвета, типографика, spacing, responsive breakpoints).
2. Добавить диф-режимы: swipe/onion-skin overlay, синхронный zoom/pan.
3. Пересмотреть A/B лейблы — сейчас просто буквы, DAD может добавить контекст (например показывать stage пиктограммой).
4. Мобильная раскладка (сейчас не поддержана).

## Что требует QA (regression)

1. **Флаг off** (дефолт): убедиться что лайтбокс открывается как раньше — нет лишних кнопок, нет JS-ошибок в консоли. Compare-view.html можно открыть напрямую — покажется «в разработке».
2. **Флаг on**:
   - В лайтбоксе появляется кнопка «Сравнить версии» рядом с крестиком (только если проект в облаке — `_cloudId` есть).
   - Клик открывает новую вкладку с двумя слотами A/B.
   - Dropdown'ы показывают все версии фото (ЦК/ретушь/грейдинг), сортировка правильная.
   - Кнопка «Выбрать» пишет `photo_versions.selected=true` (и сбрасывает у остальных той же stage).
   - После выбора обе колонки ререндерятся — та версия подсвечена «Выбрано».
   - Превью грузятся (через `sbClient.storage.getPublicUrl`).
3. **Edge cases**:
   - Фото без версий → показывается сообщение «Нет версий для этого фото».
   - Одна версия → оба слота показывают её, selection всё равно работает.
   - Невалидный `project_id` / `photo_name` → ошибка-сообщение, без падения.
   - Гость по share-ссылке (анонимный): RLS даёт SELECT, но UPDATE заблокирован на уровне БД — клик по «Выбрать» вернёт ошибку, UI это показывает. (Если нужно разрешить guest-save — нужна отдельная миграция аналогично 031.)
4. **Regression supabase.js**:
   - `sbSelectPhotoVersion`, `sbLoadPhotoVersions*`, `sbSavePhotoVersion` — не трогал. Проверить существующий flow photo_versions (ЦК загрузка, выбор на web-клиенте) не сломан.

## Файлы в изменениях

```
v2/frontend/js/supabase.js            (+ _compareViewEnabled, + sbGetPhotoVersions, ~85 строк)
v2/frontend/compare-view.html         (new)
v2/frontend/js/compare-view.js        (new, IIFE ~260 строк)
v2/frontend/js/previews.js            (wire-up ~22 строк, условный)
docs/agents/dev/compare-view-integration-notes.md (this file)
```

## Открытые вопросы (для Маши/DAD)

- Где именно размещать кнопку в финальной версии? Сейчас — в лайтбоксе, рядом с крестиком. Альтернативы: в превью-панели (контекст-меню), в карточке товара рядом со слотом.
- Нужна ли compare-view в singular mode (модалка поверх лайтбокса) вместо new tab? Плюсы tab: отдельная история браузера, можно сравнивать две вкладки. Минусы: прыжок фокуса, потеря контекста лайтбокса.
- Что считать «победителем» на уровне фото, если stage != 1? Сейчас `sbSelectPhotoVersion` работает в рамках одной stage. Это корректно для модели «на каждом этапе одна выбранная версия». Нужно ли компаративное сравнение cross-stage (например «финальный грейдинг против сырого ЦК»)? — DAD.
