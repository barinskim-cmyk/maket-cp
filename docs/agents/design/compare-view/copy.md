---
type: ui-copy
feature: compare-view
status: design-ready
owner: DAD
language: ru
created: 2026-04-25
updated: 2026-04-25
revision: retry-tight
---

> **TL;DR:** UI-строки compare view (MVP). Тон спокойный и рабочий, без emoji и восклицаний. Терминология фиксируется: «версия», «этап», «фото», «комментарий».

# Compare View — UI Copy (RU, MVP retry)

## 1. Заголовки и навигация
- `cv.title` — `Сравнение версий`
- `cv.breadcrumb` — `{brand} / {project} / {photo_name}`
- `cv.entry_button` — `Сравнить версии`
- `cv.entry_tooltip` — `Сравните 2 версии этого фото рядом`
- `cv.btn.back_mobile` — `Назад`
- `cv.btn.close` — `Закрыть` (aria-label у крестика)
- `cv.slot_label_a` — `Версия A` (aria-label слота)
- `cv.slot_label_b` — `Версия B`

## 2. Stage badges и метаданные
- `cv.version_badge.cc` — `CC`
- `cv.version_badge.retouch` — `RETOUCH`
- `cv.version_badge.grading` — `GRADING`
- `cv.version_badge.tech` — `TECH`
- `cv.version_badge.orig` — `ИСХОДНИК`
- `cv.version_dropdown` — `Версия: {stage} #{num}`
- `cv.meta_timestamp` — формат: сегодня → `сегодня, HH:MM`; до 7 дней → `пн, HH:MM`; иначе → `DD.MM.YYYY, HH:MM`
- `cv.meta_author` — `{email}`
- `cv.meta_killed` — `убита на этапе «{stage_name}»`

## 3. Dropdown
- `cv.dropdown.label` — `Какую версию показать`
- `cv.dropdown.option` — `{stage} #{num} — {date}`
- `cv.dropdown.option_current` — `{stage} #{num} — {date} (показана сейчас)`
- `cv.dropdown.option_killed` — `{stage} #{num} — {date} (убита)`
- `cv.dropdown.empty` — `Нет других версий`

## 4. Toggle «Выбрать»
- `cv.btn.select` — `Выбрать эту версию`
- `cv.btn.selected` — `Выбрана`
- `cv.btn.selecting` — `Сохраняем…`
- `cv.tooltip.no_perm` — `Нет прав на выбор версии`

## 5. Comment-поле
- `cv.comment.label` — `Комментарий к фото`
- `cv.comment.placeholder` — `Напишите комментарий — он относится ко всему фото, а не к отдельной версии.`
- `cv.comment.hint` — `Виден команде и заказчику. Cmd/Ctrl + Enter — сохранить.`
- `cv.btn.save_comment` — `Сохранить`
- `cv.btn.saving` — `Сохраняем…`
- `cv.toast.comment_saved` — `Комментарий сохранён`

## 6. States
- `cv.state.loading` — `Загружаем версии…`
- `cv.state.loading_slot` — `Загружаем изображение…`
- `cv.error.slot_title` — `Не удалось загрузить версию`
- `cv.btn.retry` — `Попробовать снова`
- `cv.error.offline_toast` — `Нет соединения. Выбор и комментарии сейчас недоступны.`
- `cv.error.selection_fail` — `Не получилось зафиксировать выбор. Попробуйте ещё раз.`
- `cv.error.comment_fail` — `Комментарий не сохранился. Попробуйте ещё раз.`

## 7. Empty states
- `cv.empty.no_versions.title` — `У этого фото пока нет версий`
- `cv.empty.no_versions.text` — `Версии появятся после загрузки ЦК или ретуши.`
- `cv.empty.one_version.title` — `Пока есть только одна версия`
- `cv.empty.one_version.text` — `Для сравнения нужно минимум две. Откройте фото, чтобы посмотреть её.`
- `cv.btn.return_gallery` — `Вернуться в галерею`
- `cv.btn.open_lightbox` — `Открыть фото`

## 8. Toasts и success
- `cv.toast.selected` — `Версия выбрана`
- `cv.toast.selection_cleared` — `Выбор снят`
- `cv.banner.same_version` — `Слева и справа одна и та же версия`

## 9. Warnings
- `cv.warn.killed` — `Эта версия убита на этапе «{stage_name}». Её можно сравнить, но не вернуть.`
- `cv.warn.stale_version` — `Версия устарела: появилась более новая.`

## 10. Mobile-специфика
- `cv.swipe_hint` — `Свайп — переключение между A и B` (показывается один раз, при первом открытии)
- Aria-подписи точек: `A`, `B`.

## 11. Keyboard shortcuts (desktop, в tooltip «?»)
```
Esc        — закрыть
← / →      — переключить слот
1 / 2      — выбрать слот A / B
Enter      — выбрать текущую версию
```

## 12. Tone & термины (фикс)
- Без восклицательных знаков и «пожалуйста».
- Числа цифрами: «2 версии», не «две версии».
- Термины: «версия» (не «вариант»), «этап» (не «стадия»), «фото» (не «снимок»), «комментарий» (не «заметка»).
