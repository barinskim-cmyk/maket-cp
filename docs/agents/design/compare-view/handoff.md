---
type: handoff-spec
from: DAD
to: PA
feature: compare-view
status: design-ready
created: 2026-04-24
updated: 2026-04-24
feature_flag: DEBUG_COMPARE_VIEW
related:
  - "[[spec]]"
  - "[[mockup]]"
  - "[[copy]]"
  - "[[project_pipeline_model]]"
priority: high
---

> **TL;DR:** Compare view — модалка поверх lightbox, 2 слота бок о бок (desktop) / swipe (mobile). Нужен API list versions + update selected, state management для подсветки, event handlers dropdown/select/comment. Ниже — полный список с сигнатурами и ссылки на существующие таблицы Supabase.

# Compare View — Handoff для PA

## 1. Scope реализации (MVP)

| Блок                     | Готовность дизайна | Что делает PA                                         |
|--------------------------|---------------------|-------------------------------------------------------|
| Модаль compare view      | spec + mockup       | Вставить в DOM поверх lightbox, respect feature flag  |
| Dropdown выбора версий   | spec + copy         | Рендер из `photo_versions`, filter по `photo_id`      |
| Select version button    | spec + copy         | Обновление `photo_versions.selected` (one-of)         |
| Общее поле комментария   | spec + copy         | CRUD в `photo_comments` (таблица существует?)         |
| Mobile swipe             | spec + mockup       | Touch events + snap animation                         |
| Keyboard shortcuts       | spec                | Esc / ← → / 1/2 / Enter                               |
| States (loading/error)   | spec + copy         | Skeleton, toast, inline retry                         |
| Feature flag             | spec                | `window.MAKET_FLAGS.DEBUG_COMPARE_VIEW`               |

## 2. Data model (Supabase)

Опираемся на существующий план из `project_pipeline_model.md`:

### 2.1. Таблица `photo_versions` (уже спроектирована)

```sql
-- Ожидаемая схема (уточнить с PA, может отличаться от финальной)
photo_versions (
  id           uuid primary key,
  project_id   uuid not null references projects(id),
  photo_name   text not null,           -- MVP: match by filename
  photo_id     uuid,                    -- post-MVP: persistent photo id
  stage        text not null,           -- 'cc' | 'retouch' | 'grading' | 'tech' | 'orig'
  version_num  integer not null,        -- глобальный порядковый (1,2,3...)
  iteration    integer default 1,       -- номер итерации внутри stage
  status       text default 'uploaded', -- 'uploaded' | 'approved' | 'rejected'
  file_path    text,                    -- storage path оригинала
  preview_path text,                    -- storage path превью
  cos_path     text,                    -- если есть .cos
  selected     boolean default false,   -- ОДНА версия per photo = selected
  author_email text,                    -- кто загрузил
  created_at   timestamptz default now(),
  decided_at   timestamptz,
  decided_by   text,
  killed_at_stage text                  -- null или имя этапа где убита
);
```

**Инвариант `selected`:** по одному фото может быть не более одной версии с `selected=true`. Гарантировать через:
- Либо partial unique index: `CREATE UNIQUE INDEX ON photo_versions(photo_name, project_id) WHERE selected = true`
- Либо транзакционный update (в одном txn `update selected=false where photo_name=X` потом `update selected=true where id=Y`) — предпочтительно.

### 2.2. Таблица `photo_comments` (новая? уточнить)

Комментарий в compare view — **на уровне фото** (photo_id / photo_name + project_id), НЕ per-version.

```sql
photo_comments (
  id           uuid primary key,
  project_id   uuid not null,
  photo_name   text not null,
  photo_id     uuid,
  author_email text,
  text         text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
```

**Альтернатива:** если у карточек/фото уже есть поле `comment` в существующих сущностях — переиспользовать. PA проверяет в `reference_supabase.md`.

## 3. API требования (bridge / Supabase RPC)

### 3.1. `listPhotoVersions(photoName, projectId) → Version[]`

Цель: получить все версии фото, отсортированные по `version_num DESC`.

```typescript
// supabase-js example
const { data: versions, error } = await supabase
  .from('photo_versions')
  .select('id, stage, version_num, status, preview_path, selected, author_email, created_at, killed_at_stage')
  .eq('project_id', projectId)
  .eq('photo_name', photoName)
  .order('version_num', { ascending: false });
```

- **Pre-filter:** исключать `status='rejected' AND killed_at_stage IS NULL` только если продукт решит скрывать — по MVP **показываем всё** (включая убитые) с бейджем.
- **Ошибки:** network → state 6.2 (slot error). Empty → state 6.3 (empty).

### 3.2. `setSelectedVersion(versionId, photoName, projectId) → {ok:boolean}`

Транзакционный update. Желательно через RPC:

```sql
-- Supabase RPC function
create or replace function public.cv_set_selected_version(
  p_version_id uuid,
  p_photo_name text,
  p_project_id uuid
) returns void
language plpgsql
security invoker
as $$
begin
  update photo_versions
     set selected = false
   where project_id = p_project_id
     and photo_name = p_photo_name
     and selected = true;

  update photo_versions
     set selected = true,
         decided_at = now(),
         decided_by = auth.jwt() ->> 'email'
   where id = p_version_id
     and project_id = p_project_id;
end;
$$;
```

- RLS: `security invoker` — право должно быть у пользователей проекта (check existing RLS policy на `photo_versions`).
- Идемпотентность: повторный вызов с тем же `version_id` — no-op (не падает).

### 3.3. `getPhotoComment(photoName, projectId) → {text, updated_at, author_email} | null`

```typescript
const { data, error } = await supabase
  .from('photo_comments')
  .select('text, updated_at, author_email')
  .eq('project_id', projectId)
  .eq('photo_name', photoName)
  .maybeSingle();
```

### 3.4. `upsertPhotoComment(photoName, projectId, text) → {ok:boolean}`

Один комментарий per photo (MVP). Для многопользовательских комментариев — пост-MVP threading.

```sql
-- Upsert
insert into photo_comments (project_id, photo_name, text, author_email)
values ($1, $2, $3, auth.jwt() ->> 'email')
on conflict (project_id, photo_name)
do update set text = EXCLUDED.text, updated_at = now(), author_email = EXCLUDED.author_email;
```

## 4. State management (frontend)

### 4.1. State shape

```javascript
// cv* prefix per существующая конвенция модулей
var cvState = {
  photoName: 'IMG_0042_m7k2x.jpg',
  projectId: 'uuid…',
  versions: [], // Version[] после load
  slotA: { versionId: null, loading: false, error: null },
  slotB: { versionId: null, loading: false, error: null },
  selectedVersionId: null, // кэш, обновляется после setSelected
  comment: { text: '', loading: false, saved: false, error: null },
  isOpen: false,
  mobileSlide: 0 // 0 = slot A visible, 1 = slot B
};
```

### 4.2. Default preselect

После `listPhotoVersions`:
- `slotA.versionId` = `versions.find(v => v.selected)?.id || versions[0]?.id` — текущая selected или последняя.
- `slotB.versionId` = `versions.find(v => v.id !== slotA.versionId)?.id` — следующая по age.
- Если всего 1 версия → не открываем compare view, показываем empty state.
- Если 0 версий → кнопка входа скрыта, но роут defensive показывает empty.

### 4.3. Dropdown change handler

```javascript
function cvOnDropdownChange(slot /* 'A' | 'B' */, newVersionId) {
  if (cvState['slot' + slot].versionId === newVersionId) return;
  // нельзя выбрать ту же версию в обоих слотах
  var otherSlot = slot === 'A' ? 'B' : 'A';
  if (cvState['slot' + otherSlot].versionId === newVersionId) {
    // swap: подмешать старую версию в другой слот
    cvState['slot' + otherSlot].versionId = cvState['slot' + slot].versionId;
  }
  cvState['slot' + slot].versionId = newVersionId;
  cvRender();
}
```

### 4.4. Select handler

```javascript
async function cvOnSelectVersion(slot) {
  var versionId = cvState['slot' + slot].versionId;
  if (!versionId) return;
  var prev = cvState.selectedVersionId;
  cvState.selectedVersionId = versionId; // optimistic
  cvRender();
  var res = await cvApi.setSelectedVersion(versionId, cvState.photoName, cvState.projectId);
  if (!res.ok) {
    cvState.selectedVersionId = prev; // rollback
    cvShowToast(COPY['cv.error.selection_fail']);
    cvRender();
    return;
  }
  cvShowToast(COPY['cv.toast.selected']);
}
```

### 4.5. Comment save

Debounce 600ms автосейвом ИЛИ explicit save-кнопка — по MVP выбираем **explicit save** (Masha предпочитает контроль, см. `feedback_tech_decisions.md`). Unsaved changes → разрешить закрытие с confirm dialog («Закрыть без сохранения?»).

## 5. Event handlers — полный список

| Handler                    | Триггер                                  | Действие                                 |
|----------------------------|------------------------------------------|------------------------------------------|
| `cvOpen(photoName, projectId)` | Клик «Сравнить версии» в lightbox   | load versions, preselect, mount modal    |
| `cvClose()`                | Esc / клик X / клик вне модалки (desktop) | unmount, вернуть фокус в lightbox       |
| `cvOnDropdownChange(slot, id)` | Change в `<select>` dropdown         | Обновить slot, fetch preview если надо   |
| `cvOnSelectVersion(slot)`  | Клик «Выбрать эту версию»                | API call + toast + rerender              |
| `cvOnCommentInput()`       | Input в textarea                         | Обновить state.text, enable save button  |
| `cvOnCommentSave()`        | Клик «Сохранить» / Cmd+Enter             | upsert API + toast                       |
| `cvOnSwipe(direction)`     | Touch swipe / dot click (mobile)         | `state.mobileSlide = 0 or 1`             |
| `cvOnKey(e)`               | keydown listener                         | Esc / ← → / 1,2 / Enter → маппинг        |
| `cvOnRetry(slot)`          | Клик «Попробовать снова»                 | Re-fetch preview для слота               |

## 6. Mobile breakpoint и свайп

- Breakpoint: `max-width: 767px` (coincides с существующим mobile-client breakpoint).
- Swipe: простой touchstart/touchmove/touchend с порогом 40px по X. Если превышен — snap к следующему слайду. Иначе snap обратно.
- Используем native touch events, без hammer.js / swiper.js (минимум зависимостей, см. архитектуру «чистый JS»).
- Snap transition: `transform: translateX(-50%)` с `transition: 180ms ease-out`.

## 7. Feature flag wiring

Существующий механизм флагов (проверить `v2/frontend/js/state.js`):

```javascript
window.MAKET_FLAGS = window.MAKET_FLAGS || {};
// Default off. Turn on для Masha/Victoria через query param ?flag=compare
if (new URLSearchParams(location.search).get('flag') === 'compare') {
  window.MAKET_FLAGS.DEBUG_COMPARE_VIEW = true;
}
```

В lightbox рендер:

```javascript
if (window.MAKET_FLAGS && window.MAKET_FLAGS.DEBUG_COMPARE_VIEW && versionsCount >= 2) {
  // показать кнопку «Сравнить версии»
}
```

## 8. Архитектурные правила (напоминание)

Из `feedback_architecture.md`:
- Frontend module: `v2/frontend/js/compare-view.js` — одна точка входа, cv* префикс функций.
- CSS: в модульном стиле + использовать `var(--*)` токены (см. `spec.md §5`).
- Service layer (если нужно): `v2/backend/core/services/compare_view_service.py` — но MVP live только во frontend + supabase RPC, **python не нужен**.
- Dual-mode: MVP — только web (supabase), десктоп (pywebview) совместимость должна быть — код не должен падать если `window.pywebview` отсутствует.
- Никаких emoji / иконок — только текст или SVG без зависимостей.

## 9. Что требует QA (test coverage)

### 9.1. Functional
- [ ] Открытие / закрытие compare view из lightbox (клик, Esc, клик вне).
- [ ] Dropdown показывает все версии photo, отсортированы по version_num desc.
- [ ] Выбор версии в dropdown меняет отображаемое изображение.
- [ ] Same version в обоих слотах — auto-swap работает.
- [ ] Select → selected флаг обновлён в Supabase (check via MCP).
- [ ] Только одна version per photo остаётся selected после двойного select.
- [ ] Comment save → upsert в `photo_comments`.
- [ ] Close с unsaved comment → confirm dialog.
- [ ] Feature flag off → кнопка «Сравнить» не видна.

### 9.2. Responsive / platforms
- [ ] Desktop ≥ 1024px — side-by-side.
- [ ] Mobile < 768px — swipe, dots indicator.
- [ ] Tablet 768–1023px — side-by-side (узкий, но ok).
- [ ] iOS Safari swipe — без jump.
- [ ] Android Chrome — pinch-zoom в слоте не ломает swipe.

### 9.3. Edge cases
- [ ] 0 версий → empty state «нет версий».
- [ ] 1 версия → empty state «нужна пара».
- [ ] 2+ версий → compare работает.
- [ ] Убитая версия — отображается с бейджом «убита».
- [ ] Все версии убиты — selected работает (warning).
- [ ] Offline → toast, кнопки disabled.
- [ ] Очень длинный photo_name (≥80 символов) — truncate с ellipsis в header.
- [ ] Очень длинный comment (близко к 1000) — counter + limit.
- [ ] Быстрый double-click на Select — не отправляем два API call (debounce / disabled).

### 9.4. Accessibility
- [ ] Tab-order: dropdown A → btn A → dropdown B → btn B → textarea → save → close.
- [ ] Focus ring виден на всех focusable.
- [ ] Screen reader: aria-live объявляет «Версия выбрана».
- [ ] Контраст WCAG AA (проверить через design:accessibility-review).

### 9.5. Performance
- [ ] Preview загружается < 1.5s на 3G (cached при повторном открытии).
- [ ] Переключение dropdown не перезагружает уже кешированное превью.
- [ ] Swipe на mobile — 60fps.

### 9.6. Data integrity
- [ ] После select — `photo_versions.selected` обновлён атомарно (не double-selected).
- [ ] После save comment — `photo_comments.updated_at` обновлён.
- [ ] RLS: пользователь вне проекта не видит версии / не может select.

## 10. Milestones

| Шаг | Что                                            | Владелец    |
|-----|------------------------------------------------|-------------|
| M0  | Подтверждение схемы `photo_versions` / `photo_comments` | PA + Masha |
| M1  | Supabase migration: indexes, RPC `cv_set_selected_version` | PA |
| M2  | Frontend module `compare-view.js` skeleton + feature flag | PA |
| M3  | Dropdown + slot rendering + image load           | PA          |
| M4  | Select + Supabase update                         | PA          |
| M5  | Comment panel + upsert                           | PA          |
| M6  | Mobile swipe + responsive CSS                    | PA          |
| M7  | Keyboard shortcuts + a11y polish                 | PA          |
| M8  | QA runthrough + Masha test на реальных данных    | QA + Masha  |

MVP ship goal: feature flag ON для Victoria + Masha, остальные — OFF до валидации.

## 11. Открытые вопросы (нужно Masha/PA)

1. Существует ли таблица `photo_comments` уже? Если нет — создаём в Supabase migration.
2. Нужен ли history комментариев (кто и когда менял) в MVP? Сейчас: НЕТ, только last-wins upsert.
3. Где именно в lightbox размещать кнопку «Сравнить версии» — top bar, side panel, или под фото? (Предлагаю: top-right, рядом с существующим rating/rotate).
4. Должен ли select в compare view триггерить stage event в пайплайн (`approved` → advanceStage)? MVP: **нет**, только selected флаг. Advance остаётся в основном потоке.
5. Лимит длины комментария — 1000 символов ок? Или 500 / 2000?

Ответы — через backlog.html или inline в этом файле.
