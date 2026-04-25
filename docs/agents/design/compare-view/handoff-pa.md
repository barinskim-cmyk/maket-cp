# Handoff PA — Compare View MVP

Технические требования для реализации (≤8 пунктов):

1. **Feature flag** `App.flags.DEBUG_COMPARE_VIEW` (default `false`) в `state.js`. Кнопка «Сравнить версии» в галерее показывается только при `true`. Прямой URL `/compare/{photoId}` отдаёт empty-state при `false`.

2. **Domain extension** — добавить сущность `PhotoVersion {id, photo_id, stage: 'cc'|'retouch'|'grading', version_num, author_id, created_at, asset_path, is_selected}`. Таблица в Supabase + RLS по `auth.uid()` на чтение всех ролей проекта, на запись `is_selected` — только photographer/art-director.

3. **AppAPI методы** (bridge):
   - `compare.listVersions(photoId) -> PhotoVersion[]`
   - `compare.setSelected(photoId, versionId) -> {ok, stage_event_id}`
   - `compare.saveComment(photoId, text) -> {ok}`
   Все методы дублируются в desktop bridge и в `supabase.js` (browser).

4. **Frontend module** `compare.js` (новый файл, префикс функций `cv*`): рендер обоих slot-ов, dropdown wiring, toggle handling, comment debounce 600ms + blur + Cmd/Ctrl+Enter. Зависимости: `state.js`, `supabase.js`. Нельзя импортировать `cards.js`/`previews.js`.

5. **Routing & state** — URL формата `#compare/{photoId}?a={versionId}&b={versionId}`. На back-button — возврат в галерею с прокруткой к карточке этого фото.

6. **Mobile interaction** — swipe реализовать через touchstart/touchend без библиотек, threshold 60px по X. Между свайпами — fade 150ms. На desktop swipe выключен (`window.matchMedia('(pointer: fine)')`).

7. **Stage events** — при toggle «Выбрать» писать в `stage_history` событие `{stage_id: 'selected', version_id, photo_id, trigger: 'compare-view', timestamp}`. Откат при network error.

8. **Performance & assets** — превью версий грузить через существующий lazy-loader (`pv*` в `previews.js`); полное разрешение — по клику на фото (out of scope MVP, но не ломать вызов в будущем). Размер каждой стороны фиксированный 4:5, без CLS при загрузке.
