# Post-approval safeguard

**Файл:** `v2/frontend/js/post-approval-safeguard.js`
**Подключён:** `v2/frontend/index.html` (последним скриптом)
**Дата:** 2026-04-27

## Зачем

После клика «Согласовать отбор» (`shClientApprove` → `proj._stageHistory['client_approved']` → snapshot `client_approved`) клиенты или фотографы продолжают листать карточки, дёргать слоты, ради «посмотреть варианты». Любое такое действие в нынешнем стеке вызывает `shCloudSyncExplicit()`, который через 3 сек пушит в Supabase, **портя согласованное состояние**. Авто-pull (`sbPullProject` каждые 30 сек) при этом не спасает — он откатывает локальные «фантомы», но к моменту pull они уже в облаке.

Safeguard перехватывает эти кейсы и заставляет пользователя **явно** выбрать, что он делает: смотрит или редактирует.

## UX

1. Защитный режим активен, когда `proj._stageHistory['client_approved']` существует.
2. Любой триггер sync (forward или reverse) в защитном режиме без выбранного intent → модалка:

   > **Отбор уже согласован.** Вы хотите просто посмотреть варианты или изменить отбор?
   >
   > [Просто посмотреть] (default secondary) [Изменить отбор] (primary)

3. Mode A — «Просто посмотреть»:
   - `shCloudSyncExplicit`, `sbUploadProject`, `sbLogAction`, `sbSyncStage` — **no-op**
   - `sbPullProject`, `sbStartAutoPull` — **no-op** (чтобы локальные фантомы не откатывались)
   - Локальные мутации (drag/drop, swap слотов, селект) **видны** клиенту
   - Reload → cloud state возвращается (т.к. ничего не пушили)
   - Choice persists в `sessionStorage('maketcp_post_approval_intent')`

4. Mode B — «Изменить отбор»:
   - Sync работает как обычно
   - В `client-action-bar` появляется кнопка **«Сохранить изменения после отбора»** (primary), активна только когда есть pending vs approved snapshot
   - Click → `snCreateSnapshot(stage='client', trigger='selection_modified_post_approval')` + обновление approved snapshot → кнопка исчезает
   - `beforeunload` + pending → confirmation «У вас есть несохранённые изменения отбора»

## Архитектура

Чистый wrapper-модуль. Не трогает `shootings.js` / `supabase.js` / `cards.js`. Все правки в одном файле:

```
post-approval-safeguard.js
  ├─ _paIsApproved(proj)           — defection через _stageHistory
  ├─ _paGetIntent / _paSetIntent   — sessionStorage
  ├─ _paBuildFingerprint(proj)     — переиспользует _sbProjectFingerprint
  │                                  для compact pending detection
  ├─ _paOpenModal()                — DOM-модалка
  ├─ _paInstallWrappers()          — оборачивает 6 функций:
  │     shCloudSyncExplicit, sbPullProject, sbStartAutoPull,
  │     sbLogAction, sbSyncStage, sbUploadProject
  ├─ _paUpdateSaveButton()         — рендерит/убирает save-кнопку
  ├─ _paCommitChanges()            — checkpoint commit
  └─ beforeunload listener
```

### Wrapper pattern

```js
_origShCloudSync = shCloudSyncExplicit;
window.shCloudSyncExplicit = function() {
  if (!_paShouldGate()) return _origShCloudSync.apply(this, arguments);
  var intent = _paGetIntent();
  if (intent === 'view') return;            /* Mode A: no-op */
  if (intent === 'edit') {                  /* Mode B: пройти + обновить кнопку */
    var r = _origShCloudSync.apply(this, arguments);
    _paScheduleBtnUpdate();
    return r;
  }
  _paOpenModal();                           /* Indeterminate: спросить */
  return;                                   /* deferred */
};
```

Modal opened? Текущий вызов отбрасывается. После выбора:
- `view` — никакого ретрая, sync не нужен
- `edit` — снять snapshot + дёрнуть `_origShCloudSync()` принудительно

### Pending detection

Approved snapshot — это fingerprint `_sbProjectFingerprint(proj)` (он уже есть в `supabase.js:2225` и считает cards/slots/OC/containers/stage/annotations/checkpoints). Fingerprint снимается в момент клика «Изменить отбор» (а не при `client_approved` checkpoint!) — так UX честнее: «всё что с этого момента» = pending. Цена: если пользователь успел сделать пару кликов до выбора Mode B, эти изменения попадут в baseline и не будут видны как pending. Считаем приемлемым — за защитный режим платим точностью baseline.

При `_paCommitChanges()` snapshot обновляется до текущего fingerprint → pending снова `false` → save-кнопка скрывается.

### Persistence

- `sessionStorage('maketcp_post_approval_intent')` — `'view'` / `'edit'` / null
- `sessionStorage('maketcp_pa_approved_snapshot')` — fingerprint строкой
- Оба ключа **очищаются на init** модуля (новая загрузка страницы = новая сессия = заново спросим). Это явное решение: нативная sessionStorage пережила бы reload, нам это не нужно.

## Интеграция

Скрипт подключён **последним** в `index.html` после `cloud-ui.js`, чтобы все wrapped-функции были к этому моменту определены. Wrappers ставятся в `_paInit()` через `DOMContentLoaded`.

```html
<script src="js/cloud-ui.js"></script>
<script src="js/post-approval-safeguard.js?v=1"></script>
```

## Public API

```js
window.paGetIntent()         // 'view' | 'edit' | null
window.paIsApproved(proj?)   // boolean
window.paHasPendingChanges() // boolean
window.paUpdateSaveButton()  // ручной перерисовать
window.paOpenModal()         // открыть модалку (для тестов / fallback)
window.paResetIntent()       // сбросить intent + snapshot (debug)
```

## Регрессии

- **Не-approved проекты:** `_paShouldGate()` возвращает `false` → wrappers пропускают вызов в оригинальную функцию **без изменений**. Поведение идентично pre-safeguard.
- **Артикулы / OC / комментарии:** в Mode A сохранения не идут (по дизайну). В Mode B — идут как обычно.
- **Mobile-клиент** (`cpMobileApprove`): использует `shClientApprove`, поэтому защита включается одинаково.

## Тестирование

Сценарий из спеки:

1. Залогиниться в TEST-проект как клиент (или владелец, не важно).
2. Если ещё нет approved selection — нажать «Согласовать отбор».
3. Попробовать переключить slot (drag/drop или click-to-replace) → **появляется модалка**.
4. **Mode A:** выбрать «Просто посмотреть» → подёргать ещё → reload → видно cloud state (без изменений).
5. Reload → выбрать «Изменить отбор» → подёргать → **появляется кнопка «Сохранить изменения после отбора»**.
6. Click на кнопку → confirm → кнопка пропадает; в БД лежит snapshot с trigger=`selection_modified_post_approval`.
7. Reload → новый state сохранён (т.к. forward sync в Mode B работал).
8. Mode B + pending + закрыть вкладку → browser показывает confirmation.

## Ограничения

- При смене intent в течение сессии (например view → edit) рекомендован reload. В UI нет переключателя.
- Если `client-action-bar` не отрисован (роль ≠ `client`), кнопка save не появится. Это ок — фотограф / ретушёр редактируют без safeguard, у них своя ответственность.
- `_sbProjectFingerprint` не учитывает данные `articles` и `_renameLog`. Если клиент изменит только их (что невозможно через UI клиента), pending не задетектится. Для текущих пользовательских сценариев — некритично.

## Откат

1. Удалить `<script src="js/post-approval-safeguard.js?v=1"></script>` из `index.html`.
2. Удалить файл `v2/frontend/js/post-approval-safeguard.js`.
3. Версии cache (`?v=21`) можно не откатывать — на работу не влияют.
