/* ══════════════════════════════════════════════
   previews.js — Единый пул превью + доп. контент

   Два режима загрузки:
     Desktop (pywebview): Python сканирует папку, Pillow генерирует миниатюры
     Browser (фолбэк):    FileReader + canvas на клиенте

   Модель данных превью: {name, path, thumb, rating, folders, versions}
     name     — имя файла
     path     — путь к оригиналу (desktop) или "" (browser)
     thumb    — base64 миниатюра для отображения (дефолтная версия)
     preview  — 1200px превью для карточек (дефолтная версия)
     rating   — рейтинг 0–5 (0 = без рейтинга)
     folders  — массив имён папок-источников (дедупликация по имени файла)
     versions — {stageId: {thumb, preview, path}} — версии превью по этапам пайплайна
                Этапы: 'preselect' (RAW), 'color' (ЦК), 'retouch' (Ретушь)
                Дефолтные thumb/preview = версия активного этапа

   Для слотов карточек:
     Desktop: хранит {file, path}, полное изображение грузится через get_full_image
     Browser: хранит {file, dataUrl} как раньше
   ══════════════════════════════════════════════ */

var PV_THUMB_MAX = 300;       // макс. сторона для галереи (маленькая миниатюра)
var PV_THUMB_QUALITY = 0.7;
var PV_PREVIEW_MAX = 1200;    // макс. сторона для карточек/фулскрина (чёткое превью)
var PV_PREVIEW_QUALITY = 0.85;
var PV_RENDER_BATCH = 60;

// Текущий фильтр по рейтингу (минимальный рейтинг): 0 = все
var PV_FILTER = { 'pv': 0, 'oc-pv': 0 };
// Текущий фильтр по папке: '' = все
var PV_FOLDER_FILTER = { 'pv': '', 'oc-pv': '' };
// Фильтр "с комментариями": true = показывать только с аннотациями
var PV_COMMENT_FILTER = { 'pv': false, 'oc-pv': false };

// ── Версии превью (по этапам пайплайна) ──
// Этапы, для которых можно загружать отдельные версии превью
var PV_VERSION_STAGES = [
  { id: 'preselect', label: 'RAW' },
  { id: 'color',     label: 'ЦК' },
  { id: 'retouch',   label: 'Ретушь' }
];
// Текущая активная версия для просмотра: '' = дефолт (последняя загруженная)
var PV_ACTIVE_VERSION = '';
// Этап, выбранный для следующей загрузки папки ('' = обычная загрузка RAW)
var _pvLoadAsStage = '';


// ══════════════════════════════════════════════
//  IndexedDB: хранение превью (thumb + preview)
//  Позволяет сохранять 1200px превью без ограничений localStorage
// ══════════════════════════════════════════════

var PV_DB_NAME = 'maketcp_previews';
var PV_DB_VERSION = 1;
var PV_DB_STORE = 'previews';
var _pvDb = null;

/**
 * Открыть IndexedDB базу.
 * @param {function} callback — callback(db) или callback(null) при ошибке
 */
function pvDbOpen(callback) {
  if (_pvDb) { callback(_pvDb); return; }
  if (!window.indexedDB) { callback(null); return; }

  var req = indexedDB.open(PV_DB_NAME, PV_DB_VERSION);
  req.onupgradeneeded = function(e) {
    var db = e.target.result;
    if (!db.objectStoreNames.contains(PV_DB_STORE)) {
      /* Ключ: "projectKey/photoName" */
      db.createObjectStore(PV_DB_STORE);
    }
  };
  req.onsuccess = function(e) {
    _pvDb = e.target.result;
    callback(_pvDb);
  };
  req.onerror = function() {
    console.warn('IndexedDB не доступен');
    callback(null);
  };
}

/**
 * Сохранить все превью проекта в IndexedDB.
 * Сохраняет thumb + preview (1200px) для каждого фото.
 * @param {string} projKey — уникальный ключ проекта
 * @param {Array} previews — массив превью
 */
function pvDbSavePreviews(projKey, previews) {
  pvDbOpen(function(db) {
    if (!db) return;
    try {
      var tx = db.transaction(PV_DB_STORE, 'readwrite');
      var store = tx.objectStore(PV_DB_STORE);
      for (var i = 0; i < previews.length; i++) {
        var pv = previews[i];
        var key = projKey + '/' + pv.name;
        var saveObj = {
          name: pv.name,
          path: pv.path || '',
          thumb: pv.thumb || '',
          preview: pv.preview || '',
          rating: pv.rating || 0,
          orient: pv.orient || 'v',
          folders: pv.folders || []
        };
        /* Сохраняем версии превью если есть */
        if (pv.versions) saveObj.versions = pv.versions;
        store.put(saveObj, key);
      }
    } catch(e) {
      console.warn('pvDbSavePreviews:', e);
    }
  });
}

/**
 * Сохранить превью текущего проекта в IndexedDB.
 * Удобная обёртка: берёт ключ из проекта.
 * @param {Object} proj — объект проекта
 */
function pvDbSaveProjectPreviews(proj) {
  if (!proj || !proj.previews || proj.previews.length === 0) return;
  var key = (proj.brand || 'noname') + '_' + (proj.shoot_date || '');
  key = key.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
  pvDbSavePreviews(key, proj.previews);
}

/**
 * Загрузить превью проекта из IndexedDB и обновить проект.
 * Также обновляет dataUrl слотов карточек, если они содержат 300px thumb.
 * @param {Object} proj — объект проекта
 * @param {function} [callback] — вызывается по завершении
 */
function pvDbRestoreProjectPreviews(proj, callback) {
  if (!proj) { if (callback) callback(); return; }
  var key = (proj.brand || 'noname') + '_' + (proj.shoot_date || '');
  key = key.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');

  pvDbLoadPreviews(key, function(items) {
    if (items.length > 0) {
      proj.previews = items;
      console.log('IndexedDB: восстановлено ' + items.length + ' превью для ' + proj.brand);

      /* Обновить dataUrl слотов карточек: заменить 300px thumb на 1200px preview */
      var slotsUpdated = false;
      if (proj.cards) {
        var pvMap = {};
        for (var p = 0; p < items.length; p++) {
          pvMap[items[p].name] = items[p];
        }
        for (var c = 0; c < proj.cards.length; c++) {
          var card = proj.cards[c];
          if (!card.slots) continue;
          for (var s = 0; s < card.slots.length; s++) {
            var slot = card.slots[s];
            if (slot.file && pvMap[slot.file]) {
              var match = pvMap[slot.file];
              /* Восстановить 1200px preview если есть, иначе thumb */
              if (match.preview) {
                slot.dataUrl = match.preview;
                slot.thumbUrl = match.thumb;
                slotsUpdated = true;
              } else if (match.thumb) {
                slot.dataUrl = match.thumb;
              }
              /* Восстановить path из превью (для get_full_image) */
              if (match.path && !slot.path) {
                slot.path = match.path;
                slotsUpdated = true;
              }
            }
          }
        }
      }
      /* Перерисовать карточки если слоты обновились */
      if (slotsUpdated && typeof cpRenderCard === 'function') {
        cpRenderCard();
      }
    }
    if (callback) callback();
  });
}

/**
 * Загрузить все превью проекта из IndexedDB.
 * @param {string} projKey — уникальный ключ проекта
 * @param {function} callback — callback(previews) — массив или []
 */
function pvDbLoadPreviews(projKey, callback) {
  pvDbOpen(function(db) {
    if (!db) { callback([]); return; }
    try {
      var tx = db.transaction(PV_DB_STORE, 'readonly');
      var store = tx.objectStore(PV_DB_STORE);
      var results = [];
      var cursor = store.openCursor();
      var prefix = projKey + '/';
      cursor.onsuccess = function(e) {
        var c = e.target.result;
        if (c) {
          if (typeof c.key === 'string' && c.key.indexOf(prefix) === 0) {
            results.push(c.value);
          }
          c.continue();
        } else {
          callback(results);
        }
      };
      cursor.onerror = function() { callback([]); };
    } catch(e) {
      console.warn('pvDbLoadPreviews:', e);
      callback([]);
    }
  });
}

// ── Хелперы папок ──

function pvFolderName(folderPath) {
  // "/Users/masha/Photos/[anchor client]_previews" → "[anchor client]_previews"
  if (!folderPath) return 'Без папки';
  var parts = folderPath.replace(/[\/\\]+$/, '').split(/[\/\\]/);
  return parts[parts.length - 1] || folderPath;
}

function pvGetFolders() {
  // Собираем уникальные имена папок из всех превью
  var store = pvGetStore();
  var map = {};
  for (var i = 0; i < store.length; i++) {
    var folders = store[i].folders || [];
    for (var j = 0; j < folders.length; j++) {
      map[folders[j]] = true;
    }
  }
  return Object.keys(map).sort();
}

// ══════════════════════════════════════════════
//  Версии превью: helpers
//  Каждое превью может хранить versions = {stageId: {thumb, preview, path}}
//  pvGetThumb/pvGetPreview возвращают данные для активной версии
// ══════════════════════════════════════════════

/**
 * Получить thumb для превью с учётом активной версии.
 * Если у превью есть versions[activeVersion], вернуть его thumb.
 * Иначе — дефолтный thumb превью.
 * @param {Object} pv — объект превью
 * @returns {string} base64 или URL thumb
 */
function pvGetThumb(pv) {
  if (PV_ACTIVE_VERSION && pv.versions && pv.versions[PV_ACTIVE_VERSION]) {
    return pv.versions[PV_ACTIVE_VERSION].thumb || pv.thumb;
  }
  return pv.thumb;
}

/**
 * Получить preview (1200px) для превью с учётом активной версии.
 * @param {Object} pv — объект превью
 * @returns {string} base64 или URL preview
 */
function pvGetPreview(pv) {
  if (PV_ACTIVE_VERSION && pv.versions && pv.versions[PV_ACTIVE_VERSION]) {
    return pv.versions[PV_ACTIVE_VERSION].preview || pv.versions[PV_ACTIVE_VERSION].thumb || pv.preview || pv.thumb;
  }
  return pv.preview || pv.thumb;
}

/**
 * Получить path для превью с учётом активной версии.
 * @param {Object} pv — объект превью
 * @returns {string} путь к файлу
 */
function pvGetPath(pv) {
  if (PV_ACTIVE_VERSION && pv.versions && pv.versions[PV_ACTIVE_VERSION]) {
    return pv.versions[PV_ACTIVE_VERSION].path || pv.path || '';
  }
  return pv.path || '';
}

/**
 * Проверить, есть ли у превью версия для указанного этапа.
 * @param {Object} pv — объект превью
 * @param {string} stageId — id этапа (напр. 'color', 'retouch')
 * @returns {boolean}
 */
function pvHasVersion(pv, stageId) {
  return !!(pv.versions && pv.versions[stageId]);
}

/**
 * Получить список этапов, для которых у проекта загружены хотя бы одно превью.
 * @returns {Array} массив stage id
 */
function pvGetLoadedVersions() {
  var store = pvGetStore();
  var stages = {};
  for (var i = 0; i < store.length; i++) {
    var pv = store[i];
    if (pv.versions) {
      for (var sid in pv.versions) {
        if (pv.versions.hasOwnProperty(sid)) stages[sid] = true;
      }
    }
  }
  return Object.keys(stages);
}

/**
 * Посчитать сколько превью НЕ имеют версии для указанного этапа.
 * Полезно для показа "не хватает 12 фото для ретуши".
 * @param {string} stageId — id этапа
 * @returns {{total: number, missing: number, loaded: number}}
 */
function pvVersionStats(stageId) {
  var store = pvGetStore();
  var total = store.length;
  var loaded = 0;
  for (var i = 0; i < store.length; i++) {
    if (pvHasVersion(store[i], stageId)) loaded++;
  }
  return { total: total, missing: total - loaded, loaded: loaded };
}

/**
 * Получить набор имён фото, которые находятся в отборе (карточки + OC).
 * Используется для фильтрации галереи при активной ЦК/Ретушь версии.
 * @returns {Object} карта {photoName: true}
 */
function pvGetSelectionSet() {
  var proj = getActiveProject();
  if (!proj) return {};
  var set = {};
  /* Из карточек */
  if (proj.cards) {
    for (var c = 0; c < proj.cards.length; c++) {
      var card = proj.cards[c];
      if (!card.slots) continue;
      for (var s = 0; s < card.slots.length; s++) {
        if (card.slots[s].file) set[card.slots[s].file] = true;
      }
    }
  }
  /* Из OC контейнеров */
  if (proj.ocContainers) {
    for (var oc = 0; oc < proj.ocContainers.length; oc++) {
      var items = proj.ocContainers[oc].items || [];
      for (var oi = 0; oi < items.length; oi++) {
        if (items[oi].name) set[items[oi].name] = true;
      }
    }
  }
  /* Из свободного OC */
  if (proj.otherContent) {
    for (var f = 0; f < proj.otherContent.length; f++) {
      if (proj.otherContent[f].name) set[proj.otherContent[f].name] = true;
    }
  }
  return set;
}

/**
 * Пометить фото без ЦК-версии как «осталось прежним».
 * Копирует дефолтное превью в versions.color, убирает red-dot индикатор.
 */
function pvMarkAsUnchanged() {
  var proj = getActiveProject();
  if (!proj || !proj.previews) return;
  var count = 0;
  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];
    if (!pv.versions) pv.versions = {};
    if (!pv.versions[PV_ACTIVE_VERSION]) {
      /* Копируем дефолтные данные как версию */
      pv.versions[PV_ACTIVE_VERSION] = {
        thumb: pv.versions.preselect ? pv.versions.preselect.thumb : pv.thumb,
        preview: pv.versions.preselect ? pv.versions.preselect.preview : (pv.preview || pv.dataUrl || ''),
        _unchanged: true
      };
      count++;
    }
  }
  if (count > 0) {
    pvRenderAll();
    pvUpdateCardSlotsForVersion();
    if (typeof shAutoSave === 'function') shAutoSave();
  }
  return count;
}

/**
 * Переключить активную версию и перерисовать.
 * @param {string} stageId — id этапа или '' для дефолта
 */
function pvSetVersion(stageId) {
  PV_ACTIVE_VERSION = stageId || '';
  /* Сохранить в проект для восстановления при рестарте */
  var proj = getActiveProject();
  if (proj) {
    proj._activeVersion = PV_ACTIVE_VERSION;
    if (typeof shAutoSave === 'function') shAutoSave();
  }
  pvRenderAll();
  /* Обновить dataUrl слотов карточек для новой версии */
  pvUpdateCardSlotsForVersion();
}

/**
 * Обновить dataUrl всех заполненных слотов карточек для активной версии.
 * Когда пользователь переключает версию (RAW→ЦК→Ретушь),
 * карточки должны показывать соответствующие превью.
 */
function pvUpdateCardSlotsForVersion() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.previews) return;

  /* Строим карту превью по имени */
  var pvMap = {};
  for (var p = 0; p < proj.previews.length; p++) {
    pvMap[proj.previews[p].name] = proj.previews[p];
  }

  var changed = false;
  for (var c = 0; c < proj.cards.length; c++) {
    var card = proj.cards[c];
    if (!card.slots) continue;
    for (var s = 0; s < card.slots.length; s++) {
      var slot = card.slots[s];
      if (!slot.file || !pvMap[slot.file]) continue;
      var pv = pvMap[slot.file];
      var newPreview = pvGetPreview(pv);
      var newThumb = pvGetThumb(pv);
      var newPath = pvGetPath(pv);
      if (newPreview && slot.dataUrl !== newPreview) {
        slot.dataUrl = newPreview;
        slot.thumbUrl = newThumb;
        if (newPath) slot.path = newPath;
        changed = true;
      }
    }
  }

  /* Обновить OC-контейнеры + свободные фото */
  if (proj.ocContainers) {
    for (var oc = 0; oc < proj.ocContainers.length; oc++) {
      var items = proj.ocContainers[oc].items || [];
      for (var oi = 0; oi < items.length; oi++) {
        var ocPv = pvMap[items[oi].name];
        if (ocPv) {
          var ocNew = pvGetPreview(ocPv);
          var ocThumb = pvGetThumb(ocPv);
          if (ocNew && items[oi].preview !== ocNew) {
            items[oi].preview = ocNew;
            items[oi].thumb = ocThumb;
            changed = true;
          }
        }
      }
    }
  }
  if (proj.otherContent) {
    for (var f = 0; f < proj.otherContent.length; f++) {
      var fPv = pvMap[proj.otherContent[f].name];
      if (fPv) {
        var fNew = pvGetPreview(fPv);
        var fThumb = pvGetThumb(fPv);
        if (fNew && proj.otherContent[f].preview !== fNew) {
          proj.otherContent[f].preview = fNew;
          proj.otherContent[f].thumb = fThumb;
          changed = true;
        }
      }
    }
  }

  /* Перерисовать все экраны (всегда — рендеры сами берут актуальную версию) */
  if (typeof cpRenderCard === 'function') cpRenderCard();
  if (typeof ocRenderField === 'function') ocRenderField();
  if (typeof acRenderField === 'function') acRenderField();
}

// ── Определение режима ──

function pvHasBackend() {
  return !!(window.pywebview && window.pywebview.api);
}

// ── Доступ к данным проекта ──

function pvGetStore() {
  var proj = getActiveProject();
  if (!proj) return [];
  if (!proj.previews) proj.previews = [];
  // Миграция: добавляем folders если нет
  for (var i = 0; i < proj.previews.length; i++) {
    if (!proj.previews[i].folders) proj.previews[i].folders = [];
  }
  return proj.previews;
}

function ocGetStore() {
  var proj = getActiveProject();
  if (!proj) return [];
  if (!proj.otherContent) proj.otherContent = [];
  return proj.otherContent;
}

// ── Какие имена используются в карточках ──

function pvUsedInCards() {
  var used = {};
  var proj = getActiveProject();
  if (!proj || !proj.cards) return used;
  for (var c = 0; c < proj.cards.length; c++) {
    var card = proj.cards[c];
    if (!card.slots) continue;
    for (var s = 0; s < card.slots.length; s++) {
      var slot = card.slots[s];
      if (slot && slot.file) used[slot.file] = true;
    }
  }
  return used;
}

// ══════════════════════════════════════════════
//  Загрузка через Python API (Desktop)
// ══════════════════════════════════════════════

function pvPickFolder() {
  _pvLoadAsStage = '';
  pvPickFolderInternal();
}

/**
 * Загрузить папку как версию для определённого этапа пайплайна.
 * Вызывается из селекта в тулбаре: "Загрузить ЦК версию" / "Загрузить ретушь версию".
 * @param {string} stageId — id этапа ('color', 'retouch')
 */
function pvPickFolderAs(stageId) {
  if (!stageId) return;
  _pvLoadAsStage = stageId;
  pvPickFolderInternal();
}

/**
 * Внутренняя функция: запуск сканирования папки.
 * _pvLoadAsStage определяет как будет сохранена загрузка.
 */
function pvPickFolderInternal() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала создайте или откройте съёмку'); return; }

  if (pvHasBackend()) {
    // Desktop: нативный диалог + Python сканирование
    pvShowProgress('pv-dropzone', 0, 0, true);
    pvShowProgress('oc-pv-dropzone', 0, 0, true);
    window.pywebview.api.scan_preview_folder();
  } else {
    // Browser: показать подсказку
    alert('В браузерной версии перетащите файлы или папку на область превью');
  }
}

// Push-события из Python
window.onPreviewProgress = function(data) {
  pvShowProgress('pv-dropzone', data.loaded, data.total, true);
  pvShowProgress('oc-pv-dropzone', data.loaded, data.total, true);
};

window.onPreviewDone = function(data) {
  pvShowProgress('pv-dropzone', 0, 0, false);
  pvShowProgress('oc-pv-dropzone', 0, 0, false);

  var proj = getActiveProject();
  if (!proj) return;
  if (!proj.previews) proj.previews = [];

  var folderPath = data.folder || '';
  var folderLabel = pvFolderName(folderPath);

  /* Определяем: это загрузка версии (ЦК/ретушь) или обычная загрузка RAW? */
  var loadStage = _pvLoadAsStage || '';
  _pvLoadAsStage = ''; /* Сбросить после использования */

  /* Лимит загрузок версий на проект (ЦК + Ретушь суммарно, не больше 5) */
  var PV_MAX_VERSION_LOADS = 5;
  if (loadStage) {
    if (!proj._versionLoadCount) proj._versionLoadCount = 0;
    if (proj._versionLoadCount >= PV_MAX_VERSION_LOADS) {
      alert('Достигнут лимит версий: ' + PV_MAX_VERSION_LOADS + ' загрузок на проект.\nТекущая версия не загружена. Если нужно больше — обратитесь к разработчику.');
      return;
    }
    proj._versionLoadCount++;
  }

  // Индекс существующих превью по имени
  var existingMap = {};
  for (var k = 0; k < proj.previews.length; k++) {
    existingMap[proj.previews[k].name] = k;
  }

  var items = data.items || [];
  var versionCount = 0; /* счётчик добавленных версий */

  for (var i = 0; i < items.length; i++) {
    var incoming = items[i];

    if (loadStage && existingMap.hasOwnProperty(incoming.name)) {
      /* ── Загрузка версии: матчим по имени, записываем в versions ── */
      var idx = existingMap[incoming.name];
      var pv = proj.previews[idx];
      if (!pv.versions) pv.versions = {};
      pv.versions[loadStage] = {
        thumb: incoming.thumb,
        preview: incoming.preview || '',
        path: incoming.path || ''
      };
      /* Также обновляем рейтинг если он есть */
      if (incoming.rating && incoming.rating > 0) {
        pv.rating = incoming.rating;
      }
      versionCount++;

    } else if (loadStage && !existingMap.hasOwnProperty(incoming.name)) {
      /* Загрузка версии, но такого фото нет в проекте — пропускаем
         (нельзя добавить ЦК-версию без базового RAW-превью) */
      console.warn('pvVersion: пропущен ' + incoming.name + ' — нет в проекте (RAW)');

    } else if (existingMap.hasOwnProperty(incoming.name)) {
      /* ── Обычная загрузка: дубликат — обновляем рейтинг + папку ── */
      var idx2 = existingMap[incoming.name];
      var pv2 = proj.previews[idx2];
      if (incoming.rating && incoming.rating > 0) {
        pv2.rating = incoming.rating;
      }
      if (!pv2.folders) pv2.folders = [];
      if (folderLabel && pv2.folders.indexOf(folderLabel) < 0) {
        pv2.folders.push(folderLabel);
      }
      /* Миграция: первая загрузка = версия preselect */
      if (!pv2.versions) pv2.versions = {};
      if (!pv2.versions.preselect) {
        pv2.versions.preselect = {
          thumb: pv2.thumb,
          preview: pv2.preview || '',
          path: pv2.path || ''
        };
      }

    } else {
      /* ── Обычная загрузка: новое фото ── */
      var pvOrient = (incoming.w && incoming.h && incoming.w > incoming.h) ? 'h' : 'v';
      var newPv = {
        name: incoming.name,
        path: incoming.path,
        thumb: incoming.thumb,
        preview: incoming.preview || '',
        rating: incoming.rating || 0,
        orient: pvOrient,
        folders: folderLabel ? [folderLabel] : [],
        versions: {
          preselect: {
            thumb: incoming.thumb,
            preview: incoming.preview || '',
            path: incoming.path || ''
          }
        }
      };
      proj.previews.push(newPv);
    }
  }

  /* Лог для отладки */
  if (loadStage) {
    console.log('pvVersion: загружено ' + versionCount + ' версий для этапа "' + loadStage + '"');
    /* Автоматически переключаем на загруженную версию */
    PV_ACTIVE_VERSION = loadStage;
    /* Сохранить в проект для восстановления при рестарте */
    proj._activeVersion = PV_ACTIVE_VERSION;
  }

  // Запоминаем путь к папке превью
  if (folderPath) {
    if (!proj.previewFolders) proj.previewFolders = [];
    if (proj.previewFolders.indexOf(folderPath) < 0) {
      proj.previewFolders.push(folderPath);
    }
    proj.previewFolder = folderPath;
  }

  pvRenderAll();

  /* Сохранить превью в IndexedDB (thumb + 1200px preview) */
  pvDbSaveProjectPreviews(proj);

  /* Авто-синхронизация превью с облаком (инкрементально, без дублей) */
  if (proj._cloudId && typeof sbUploadPreviews === 'function') {
    sbUploadPreviews(proj._cloudId, proj.previews, function(err) {
      if (err) {
        console.warn('Авто-синхронизация превью:', err);
        proj._pendingSync = true; /* пометить для повторной попытки */
      } else {
        console.log('Превью синхронизированы с облаком');
      }
    });
  }

  /* Синхронизация версий с Supabase (ЦК/Ретушь) */
  if (loadStage && proj._cloudId && versionCount > 0 && typeof sbUploadThumb === 'function' && typeof sbSavePhotoVersion === 'function') {
    _pvSyncVersionsToCloud(proj, loadStage);
  }

  /* Авто-фиксация этапа 0 ("Преотбор и превью") при завершении загрузки */
  pvAutoAdvancePreselect();

  /* Авто-переход этапа при загрузке версии (ЦК → этап 'color', Ретушь → этап 'retouch') */
  if (loadStage && versionCount > 0) {
    pvAutoAdvanceToStage(loadStage);
    /* Обновить превью во всех экранах */
    pvUpdateCardSlotsForVersion();
  }
};

/**
 * Загрузить версии превью (ЦК/Ретушь) в Supabase Storage + photo_versions.
 * Пакетная загрузка по 3 штуки для экономии трафика.
 * @param {Object} proj — проект
 * @param {string} stageId — этап ('color', 'retouch')
 */
function _pvSyncVersionsToCloud(proj, stageId) {
  if (!proj._cloudId || !proj.previews) return;

  /* Собрать список фото с новой версией */
  var toUpload = [];
  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];
    if (pv.versions && pv.versions[stageId]) {
      var ver = pv.versions[stageId];
      /* Загружаем только если есть base64 данные (не URL) */
      var hasData = (ver.thumb && ver.thumb.indexOf('data:') === 0) || (ver.preview && ver.preview.indexOf('data:') === 0);
      if (hasData) {
        toUpload.push({ name: pv.name, ver: ver });
      }
    }
  }

  if (toUpload.length === 0) return;
  console.log('pvSyncVersions: загрузка ' + toUpload.length + ' версий "' + stageId + '" в облако...');

  var BATCH = 3;
  var idx = 0;
  var uploaded = 0;

  function nextBatch() {
    if (idx >= toUpload.length) {
      console.log('pvSyncVersions: загружено ' + uploaded + '/' + toUpload.length + ' версий "' + stageId + '"');
      return;
    }

    var end = Math.min(idx + BATCH, toUpload.length);
    var batchDone = 0;
    var batchSize = end - idx;

    for (var b = idx; b < end; b++) {
      (function(item) {
        var ver = item.ver;
        var thumbData = ver.thumb || '';
        var previewData = ver.preview || '';
        var storageName = stageId + '_pv_' + item.name;

        /* Загрузить thumb */
        sbUploadThumb(proj._cloudId, storageName, thumbData, function(err, thumbUrl) {
          /* Загрузить preview если есть */
          if (previewData && previewData.indexOf('data:') === 0) {
            sbUploadThumb(proj._cloudId, stageId + '_full_' + item.name, previewData, function(err2, previewUrl) {
              /* Сохранить запись в photo_versions */
              sbSavePhotoVersion({
                project_id: proj._cloudId,
                photo_name: item.name,
                stage: stageId,
                version_num: 1,
                preview_path: previewUrl || thumbUrl || ''
              }, function() { /* игнорируем ошибки записи */ });

              /* Заменить base64 на URL для экономии памяти */
              if (thumbUrl) ver.thumb = thumbUrl;
              if (previewUrl) ver.preview = previewUrl;

              uploaded++;
              batchDone++;
              if (batchDone >= batchSize) nextBatch();
            });
          } else {
            sbSavePhotoVersion({
              project_id: proj._cloudId,
              photo_name: item.name,
              stage: stageId,
              version_num: 1,
              preview_path: thumbUrl || ''
            }, function() {});

            if (thumbUrl) ver.thumb = thumbUrl;
            uploaded++;
            batchDone++;
            if (batchDone >= batchSize) nextBatch();
          }
        });
      })(toUpload[b]);
    }

    idx = end;
  }

  nextBatch();
}

// ══════════════════════════════════════════════
//  Индикатор прогресса
// ══════════════════════════════════════════════

function pvShowProgress(dropzoneId, loaded, total, active) {
  var dz = document.getElementById(dropzoneId);
  if (!dz) return;
  var textEl = dz.querySelector('.pv-dropzone-text');
  var btnEl = dz.querySelector('.btn');

  if (!active) {
    if (textEl) textEl.textContent = 'Перетащите файлы или';
    if (btnEl) { btnEl.style.display = ''; btnEl.disabled = false; }
    dz.classList.remove('pv-loading');
    return;
  }

  var pct = total > 0 ? Math.round(loaded / total * 100) : 0;
  var text = total > 0 ? ('Загрузка: ' + loaded + ' / ' + total + ' (' + pct + '%)') : 'Сканирование...';
  if (textEl) textEl.textContent = text;
  if (btnEl) { btnEl.style.display = 'none'; }
  dz.classList.add('pv-loading');
}

// ══════════════════════════════════════════════
//  Загрузка через FileReader + canvas (Browser фолбэк)
// ══════════════════════════════════════════════

function pvInitDropzone(dropzoneId) {
  var dropzone = document.getElementById(dropzoneId);
  if (!dropzone || dropzone._pvBound) return;
  dropzone._pvBound = true;

  dropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    this.classList.add('pv-drag-over');
  });

  dropzone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.classList.remove('pv-drag-over');
  });

  dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('pv-drag-over');

    var proj = getActiveProject();
    if (!proj) { alert('Сначала создайте или откройте съёмку'); return; }
    if (!proj.previews) proj.previews = [];
    var store = proj.previews;
    var dzId = dropzoneId;

    // webkitGetAsEntry для папок
    var items = e.dataTransfer.items;
    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
      var entries = [];
      var folderName = '';
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
          // Имя корневой папки
          if (entry.isDirectory && !folderName) folderName = entry.name;
        }
      }
      pvProcessEntries(entries, store, dzId, folderName);
      return;
    }

    // Фолбэк: файлы
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    pvLoadFilesWithProgress(files, store, dzId, '');
  });
}

// ── Обработка entries (папки) ──

function pvProcessEntries(entries, store, dzId, folderName) {
  var fileEntries = [];
  var pending = 0;

  function collectFiles(entryList) {
    for (var i = 0; i < entryList.length; i++) {
      var entry = entryList[i];
      if (entry.isFile) {
        fileEntries.push(entry);
      } else if (entry.isDirectory) {
        pending++;
        var reader = entry.createReader();
        reader.readEntries(function(children) {
          collectFiles(children);
          pending--;
          if (pending === 0) startLoading();
        });
      }
    }
    if (pending === 0) startLoading();
  }

  var started = false;
  function startLoading() {
    if (started) return;
    started = true;
    if (fileEntries.length === 0) { pvRenderAll(); return; }

    var imageEntries = [];
    var checking = 0, checked = 0;

    for (var i = 0; i < fileEntries.length; i++) {
      checking++;
      (function(entry) {
        entry.file(function(file) {
          if (file.type.startsWith('image/')) imageEntries.push(file);
          checked++;
          if (checked >= checking) pvLoadFilesWithProgress(imageEntries, store, dzId, folderName);
        });
      })(fileEntries[i]);
    }
  }

  collectFiles(entries);
}

// ── Загрузка с прогрессом (browser) ──

function pvLoadFilesWithProgress(files, store, dzId, folderName) {
  var imageFiles = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.type && f.type.startsWith('image/')) imageFiles.push(f);
    else if (!f.type) imageFiles.push(f);
  }
  if (imageFiles.length === 0) { pvRenderAll(); return; }

  var total = imageFiles.length;
  var loaded = 0;
  pvShowProgress(dzId, 0, total, true);
  pvShowProgress('pv-dropzone', 0, total, true);
  pvShowProgress('oc-pv-dropzone', 0, total, true);

  var queue = imageFiles.slice();
  var concurrent = 0, maxConcurrent = 4;

  function next() {
    while (concurrent < maxConcurrent && queue.length > 0) {
      concurrent++;
      loadOne(queue.shift());
    }
  }

  function loadOne(file) {
    // Дубликат? — мерджим папку
    for (var k = 0; k < store.length; k++) {
      if (store[k].name === file.name) {
        if (folderName && store[k].folders && store[k].folders.indexOf(folderName) < 0) {
          store[k].folders.push(folderName);
        }
        onDone();
        return;
      }
    }
    pvMakeThumbnail(file, function(result) {
      if (result) {
        result.folders = folderName ? [folderName] : [];
        store.push(result);
      }
      onDone();
    });
  }

  function onDone() {
    loaded++;
    pvShowProgress(dzId, loaded, total, true);
    pvShowProgress('pv-dropzone', loaded, total, true);
    pvShowProgress('oc-pv-dropzone', loaded, total, true);
    concurrent--;

    if (loaded >= total) {
      pvShowProgress(dzId, 0, 0, false);
      pvShowProgress('pv-dropzone', 0, 0, false);
      pvShowProgress('oc-pv-dropzone', 0, 0, false);
      pvRenderAll();
      /* Сохранить превью в IndexedDB */
      var proj = getActiveProject();
      if (proj) pvDbSaveProjectPreviews(proj);
      /* Авто-синхронизация превью с облаком */
      if (proj && proj._cloudId && typeof sbUploadPreviews === 'function') {
        sbUploadPreviews(proj._cloudId, proj.previews, function(err) {
          if (err) {
            console.warn('Авто-синхронизация превью:', err);
            if (proj) proj._pendingSync = true;
          } else {
            console.log('Превью синхронизированы с облаком');
          }
        });
      }
      /* Авто-фиксация этапа 0 ("Преотбор и превью") при завершении загрузки */
      pvAutoAdvancePreselect();
      return;
    }
    next();
  }

  next();
}

// ── Чтение XMP рейтинга из файла (browser) ──

function pvReadXmpRating(file, callback) {
  // Читаем первые 256KB — XMP всегда в начале JPEG
  var slice = file.slice(0, 256 * 1024);
  var reader = new FileReader();
  reader.onload = function(ev) {
    var buf = new Uint8Array(ev.target.result);
    var text = '';
    // Быстрый поиск маркера xmp:Rating в бинарных данных
    // Конвертируем в строку (ASCII-часть)
    try {
      // Ищем начало XMP блока
      var str = '';
      for (var i = 0; i < buf.length; i++) {
        str += String.fromCharCode(buf[i]);
      }
      // Regex для xmp:Rating="N"
      var m = str.match(/xmp:Rating[=">\s]*(\d)/i);
      if (m) {
        var r = parseInt(m[1]);
        callback(Math.max(0, Math.min(5, r)));
        return;
      }
    } catch(e) {}
    callback(0);
  };
  reader.onerror = function() { callback(0); };
  reader.readAsArrayBuffer(slice);
}

// ── Миниатюра через canvas (browser фолбэк) ──

function pvMakeThumbnail(file, callback) {
  // Сначала читаем рейтинг из XMP, потом делаем миниатюру
  pvReadXmpRating(file, function(rating) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        var orient = (w > h) ? 'h' : 'v';

        /* 1. Маленький thumb (300px) для галереи */
        var scale = Math.min(PV_THUMB_MAX / w, PV_THUMB_MAX / h, 1);
        var tw = Math.round(w * scale), th = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        canvas.getContext('2d').drawImage(img, 0, 0, tw, th);
        var thumbUrl = canvas.toDataURL('image/jpeg', PV_THUMB_QUALITY);

        /* 2. Большой preview (1200px) для карточек */
        var pScale = Math.min(PV_PREVIEW_MAX / w, PV_PREVIEW_MAX / h, 1);
        var pw = Math.round(w * pScale), ph = Math.round(h * pScale);
        var pCanvas = document.createElement('canvas');
        pCanvas.width = pw; pCanvas.height = ph;
        pCanvas.getContext('2d').drawImage(img, 0, 0, pw, ph);
        var previewUrl = pCanvas.toDataURL('image/jpeg', PV_PREVIEW_QUALITY);

        /* Освободить canvas-память (b11: canvas memory leak) */
        canvas.width = 0; canvas.height = 0;
        pCanvas.width = 0; pCanvas.height = 0;

        callback({
          name: file.name, path: '', thumb: thumbUrl,
          preview: previewUrl, rating: rating, orient: orient
        });
      };
      img.onerror = function() { callback(null); };
      img.src = ev.target.result;
    };
    reader.onerror = function() { callback(null); };
    reader.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════════
//  Рендер панели превью (ленивый: первые N + скролл)
// ══════════════════════════════════════════════

function pvRenderPanel(galleryId, toolbarId, countId, dropzoneId) {
  var gallery = document.getElementById(galleryId);
  var toolbar = document.getElementById(toolbarId);
  var countEl = document.getElementById(countId);
  var dropzone = document.getElementById(dropzoneId);
  var allStore = pvGetStore().slice().sort(function(a, b) {
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  var used = pvUsedInCards();

  if (!gallery) return;

  // Определяем panelKey для фильтра
  var panelKey = galleryId === 'pv-gallery' ? 'pv' : 'oc-pv';
  var filterId = panelKey + '-filter';
  var filterEl = document.getElementById(filterId);
  var minRating = PV_FILTER[panelKey] || 0;

  // Фильтр по папке
  var folderFilterId = panelKey + '-folder-filter';
  var folderFilterEl = document.getElementById(folderFilterId);
  var folderFilter = PV_FOLDER_FILTER[panelKey] || '';

  // Версии превью (только для основной панели)
  var versionBarEl = (panelKey === 'pv') ? document.getElementById('pv-version-bar') : null;

  if (allStore.length === 0) {
    gallery.innerHTML = '';
    if (toolbar) toolbar.style.display = 'none';
    if (filterEl) filterEl.style.display = 'none';
    if (folderFilterEl) folderFilterEl.style.display = 'none';
    if (versionBarEl) versionBarEl.style.display = 'none';
    if (dropzone) { dropzone.style.display = ''; dropzone.classList.remove('pv-compact'); }
    return;
  }

  if (toolbar) {
    toolbar.style.display = 'flex';
    countEl.textContent = allStore.length + ' фото';
  }
  if (dropzone) dropzone.classList.add('pv-compact');

  // Рендер фильтра по рейтингу
  if (filterEl) {
    filterEl.style.display = 'flex';
    pvRenderFilterStars(panelKey, minRating);
  }

  // Рендер фильтра по папке (только если > 1 папки)
  var folders = pvGetFolders();
  if (folderFilterEl) {
    if (folders.length > 1) {
      folderFilterEl.style.display = '';
      pvRenderFolderSelect(panelKey, folders, folderFilter);
    } else {
      folderFilterEl.style.display = 'none';
    }
  }

  // Рендер панели версий (только если есть загруженные версии)
  if (versionBarEl) {
    var loadedVersions = pvGetLoadedVersions();
    if (loadedVersions.length > 1 || (loadedVersions.length === 1 && loadedVersions[0] !== 'preselect')) {
      versionBarEl.style.display = '';
      pvRenderVersionBar(loadedVersions);
    } else {
      versionBarEl.style.display = 'none';
    }
  }

  // Фильтрация по рейтингу + папке + версия ЦК (только отбор)
  var store = [];
  /* Если активна версия ЦК или Ретушь — показывать только фото из отбора */
  var versionNeedsSelection = (PV_ACTIVE_VERSION === 'color' || PV_ACTIVE_VERSION === 'retouch');
  var selectionSet = null;
  if (versionNeedsSelection && panelKey === 'pv') {
    selectionSet = pvGetSelectionSet();
  }
  var commentFilter = PV_COMMENT_FILTER[panelKey] || false;
  for (var i = 0; i < allStore.length; i++) {
    var pv = allStore[i];
    if (minRating > 0 && (pv.rating || 0) < minRating) continue;
    if (folderFilter && (!pv.folders || pv.folders.indexOf(folderFilter) < 0)) continue;
    /* ЦК/Ретушь фильтр: только фото в отборе */
    if (selectionSet && !selectionSet[pv.name]) continue;
    /* Фильтр: только с комментариями */
    if (commentFilter && rtAnnotCount(pv.name) === 0) continue;
    store.push(pv);
  }

  if (store.length === 0) {
    var msg = 'Нет фото по выбранным фильтрам';
    gallery.innerHTML = '<div class="empty-state" style="padding:20px 0;font-size:12px">' + msg + '</div>';
    gallery._pvRendered = 0;
    gallery._pvStore = store;
    gallery._pvUsed = used;
    return;
  }

  var limit = Math.min(store.length, PV_RENDER_BATCH);
  var html = pvBuildHTML(store, used, 0, limit);
  gallery.innerHTML = html;
  gallery._pvRendered = limit;
  gallery._pvStore = store;
  gallery._pvUsed = used;

  pvBindDragFromGallery(gallery);
  pvDetectOrient(gallery);
  /* Применяем пользовательский размер миниатюр */
  if (pvColumns !== 3) pvApplyColumnWidth();

  var scrollParent = gallery.closest('.cp-previews');
  if (scrollParent && store.length > limit) pvBindLazyScroll(scrollParent, gallery);
}

/**
 * Миграция: для превью без orient определяем ориентацию по naturalWidth/naturalHeight
 * после загрузки img. Добавляет класс pv-h если горизонт.
 */
function pvDetectOrient(gallery) {
  var thumbs = gallery.querySelectorAll('.pv-thumb:not(.pv-h)');
  for (var i = 0; i < thumbs.length; i++) {
    (function(thumb) {
      var img = thumb.querySelector('img');
      if (!img) return;
      var check = function() {
        if (img.naturalWidth > img.naturalHeight) {
          thumb.classList.add('pv-h');
          /* Обновляем данные в store чтобы не пересчитывать */
          var name = thumb.getAttribute('data-pv-name');
          var store = pvGetStore();
          for (var s = 0; s < store.length; s++) {
            if (store[s].name === name) { store[s].orient = 'h'; break; }
          }
        }
      };
      if (img.complete && img.naturalWidth > 0) check();
      else img.addEventListener('load', check);
    })(thumbs[i]);
  }
}

function pvBuildHTML(store, used, from, to) {
  var html = '';
  for (var i = from; i < to; i++) {
    var pv = store[i];
    var inCard = used[pv.name] ? true : false;
    var rating = pv.rating || 0;
    /* orient может не быть у старых данных — фолбэк по thumb (img.src) */
    var orientCls = (pv.orient === 'h') ? ' pv-h' : '';
    /* Получить thumb для активной версии */
    var thumbSrc = pvGetThumb(pv);
    /* Индикатор отсутствия версии для активного этапа */
    var noVersion = (PV_ACTIVE_VERSION && !pvHasVersion(pv, PV_ACTIVE_VERSION));

    html += '<div class="pv-thumb' + orientCls + (inCard ? ' pv-in-card' : '') + '" draggable="true" data-pv-name="' + esc(pv.name) + '" data-pv-idx="' + i + '" title="' + esc(pv.name) + (noVersion ? ' [нет версии ' + PV_ACTIVE_VERSION + ']' : '') + '" onclick="pvShowFullscreen(' + i + ',event)">';
    html += '<img src="' + thumbSrc + '" loading="lazy">';
    if (noVersion) html += '<span class="pv-no-version"></span>';
    if (inCard) html += '<span class="pv-check"></span>';
    /* Счётчик аннотаций ретуши */
    var aCount = rtAnnotCount(pv.name);
    if (aCount > 0) html += '<span class="pv-annot-badge">' + aCount + '</span>';
    html += '<button class="pv-zoom" onclick="pvShowFullscreen(' + i + ',event)" title="На весь экран"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>';
    html += '<button class="pv-remove" onclick="pvRemoveByName(\'' + esc(pv.name).replace(/'/g, "\\'") + '\',event)">&times;</button>';
    html += '<span class="pv-name">' + esc(pvShortName(pv.name)) + '</span>';
    html += '</div>';
  }
  return html;
}

// ── Полноэкранный просмотр превью (лайтбокс) ──

/** @type {number} Текущий индекс в лайтбоксе */
var _pvLbIdx = -1;
/** @type {Array} Текущий список превью для навигации */
var _pvLbList = [];

/**
 * Показать превью в лайтбоксе с навигацией и галочкой «В доп. контент».
 * @param {number} pvIdx — индекс в массиве превью (фолбэк)
 * @param {Event} e — событие клика
 */
function pvShowFullscreen(pvIdx, e) {
  if (e) e.stopPropagation();
  var proj = getActiveProject();
  if (!proj || !proj.previews) return;

  /* Ищем имя файла через DOM */
  var pvName = '';
  if (e && e.target) {
    var thumb = e.target.closest('.pv-thumb');
    if (thumb) pvName = thumb.getAttribute('data-pv-name') || '';
  }

  /* Определяем индекс в полном массиве */
  var startIdx = -1;
  if (pvName) {
    for (var p = 0; p < proj.previews.length; p++) {
      if (proj.previews[p].name === pvName) { startIdx = p; break; }
    }
  }
  if (startIdx < 0) startIdx = pvIdx;
  if (!proj.previews[startIdx]) return;

  _pvLbList = proj.previews;
  _pvLbIdx = startIdx;
  _pvLbOpen();
}

/**
 * Создать/обновить лайтбокс overlay.
 */
function _pvLbOpen() {
  /* Мобильный: iPhone-стиль карусель со snap-scroll */
  if (window.innerWidth < 768) {
    _pvLbOpenMobile();
    return;
  }
  _pvLbOpenDesktop();
}

/**
 * Десктопный лайтбокс (стрелки + клавиши).
 */
function _pvLbOpenDesktop() {
  pvCloseFullscreen();

  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;

  /* Используем активную версию для лайтбокса */
  var src = pvGetPreview(pv) || pv.dataUrl || '';
  if (!src) return;

  var isInOC = _pvIsInOtherContent(pv.name);

  var overlay = document.createElement('div');
  overlay.className = 'cp-fullscreen-overlay';
  overlay.id = 'pv-lightbox';
  overlay.onclick = function(ev) { if (ev.target === overlay) pvCloseFullscreen(); };

  var imgWrap = document.createElement('div');
  imgWrap.className = 'pv-lb-img-wrap';

  var img = document.createElement('img');
  img.src = src;
  img.className = 'cp-fullscreen-img';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'cp-fullscreen-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = pvCloseFullscreen;

  var nameEl = document.createElement('div');
  nameEl.className = 'cp-fullscreen-name';
  nameEl.textContent = (_pvLbIdx + 1) + ' / ' + _pvLbList.length + '  —  ' + (pv.name || '');

  var prevBtn = document.createElement('button');
  prevBtn.className = 'pv-lb-arrow pv-lb-prev';
  prevBtn.innerHTML = '&#8249;';
  prevBtn.onclick = function(ev) { ev.stopPropagation(); _pvLbNav(-1); };

  var nextBtn = document.createElement('button');
  nextBtn.className = 'pv-lb-arrow pv-lb-next';
  nextBtn.innerHTML = '&#8250;';
  nextBtn.onclick = function(ev) { ev.stopPropagation(); _pvLbNav(1); };

  var checkWrap = _pvLbBuildCheck(pv);

  imgWrap.appendChild(img);
  imgWrap.appendChild(checkWrap);

  /* ── Тулбар комментариев ── */
  var cmtBar = document.createElement('div');
  cmtBar.className = 'rt-cmt-bar';
  cmtBar.id = 'rt-cmt-bar';
  cmtBar.style.display = 'none';

  /* Кнопка "+ Текст" */
  var addTextBtn = document.createElement('button');
  addTextBtn.className = 'rt-cmt-action';
  addTextBtn.textContent = '+ Текст';
  addTextBtn.onclick = function(ev) { ev.stopPropagation(); rtShowAnnotPopup(pv.name, null, rtAnnotCount(pv.name), imgWrap, null); };

  /* Кнопка "+ Кружок" (режим рисования) */
  var addCircleBtn = document.createElement('button');
  addCircleBtn.className = 'rt-cmt-action';
  addCircleBtn.id = 'rt-circle-mode-btn';
  addCircleBtn.textContent = '+ Кружок';
  addCircleBtn.onclick = function(ev) { ev.stopPropagation(); rtToggleAnnotMode(); };

  /* Кнопка "+ Линия" (режим рисования кривой) */
  var addLineBtn = document.createElement('button');
  addLineBtn.className = 'rt-cmt-action';
  addLineBtn.id = 'rt-line-mode-btn';
  addLineBtn.textContent = '+ Линия';
  addLineBtn.onclick = function(ev) { ev.stopPropagation(); rtToggleLineMode(); };

  /* Список существующих комментариев */
  var cmtList = document.createElement('div');
  cmtList.className = 'rt-cmt-list';
  cmtList.id = 'rt-cmt-list';

  cmtBar.appendChild(addTextBtn);
  cmtBar.appendChild(addCircleBtn);
  cmtBar.appendChild(addLineBtn);
  cmtBar.appendChild(cmtList);

  /* Главная кнопка открытия тулбара */
  var annotBtn = document.createElement('button');
  annotBtn.className = 'rt-annot-btn';
  annotBtn.id = 'rt-annot-toggle';
  var ac = rtAnnotCount(pv.name);
  annotBtn.textContent = 'Комментарии' + (ac > 0 ? ' (' + ac + ')' : '');
  annotBtn.onclick = function(ev) { ev.stopPropagation(); rtToggleCmtBar(pv.name, imgWrap); };

  overlay.appendChild(annotBtn);
  overlay.appendChild(cmtBar);

  /* Обработчик клика для линий и маршрутизации */
  imgWrap.addEventListener('click', function(ev) {
    if (ev.target.closest('.rt-circle') || ev.target.closest('.rt-line-hit') || ev.target.closest('.rt-popup') || ev.target.closest('button')) return;
    rtOnImageClick(ev);
  });
  /* Mousedown для кружков (drag-to-resize) */
  imgWrap.addEventListener('mousedown', function(ev) {
    if (ev.target.closest('.rt-circle') || ev.target.closest('.rt-line-hit') || ev.target.closest('.rt-popup') || ev.target.closest('button')) return;
    rtOnMouseDown(ev);
  });
  /* Двойной клик для завершения линии */
  imgWrap.addEventListener('dblclick', function(ev) {
    if (ev.target.closest('.rt-circle') || ev.target.closest('.rt-popup') || ev.target.closest('button')) return;
    rtOnLineDblClick(ev);
  });

  /* Отрисовать существующие аннотации */
  rtRenderAnnotations(pv.name, imgWrap);

  overlay.appendChild(imgWrap);
  overlay.appendChild(closeBtn);
  overlay.appendChild(nameEl);
  overlay.appendChild(prevBtn);
  overlay.appendChild(nextBtn);
  document.body.appendChild(overlay);

  document.addEventListener('keydown', _pvLbKeyHandler);

  /* Desktop: подгружаем оригинал */
  if (pv.path && window.pywebview && window.pywebview.api && window.pywebview.api.get_full_image) {
    window.pywebview.api.get_full_image(pv.path).then(function(result) {
      if (result && result.data_url) {
        var lb = document.getElementById('pv-lightbox');
        if (lb) {
          var fullImg = lb.querySelector('.cp-fullscreen-img');
          if (fullImg) fullImg.src = result.data_url;
        }
      }
    });
  }
}

/** Флаг блокировки snap-обработчика при программной прокрутке */
var _pvLbMobLocked = false;

/**
 * Мобильный лайтбокс: горизонтальный snap-scroll как в iPhone Photos.
 * 3-панельный скроллер (prev, current, next) с пересборкой при snap.
 */
function _pvLbOpenMobile() {
  pvCloseFullscreen();
  _pvLbMobLocked = true;

  /* Заблокировать поворот экрана в портрет */
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(function() {});
    }
  } catch(e) {}

  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;

  var overlay = document.createElement('div');
  overlay.className = 'cp-fullscreen-overlay pv-lb-mobile';
  overlay.id = 'pv-lightbox';

  /* Крестик закрытия */
  var closeBtn = document.createElement('button');
  closeBtn.className = 'cp-fullscreen-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = pvCloseFullscreen;

  /* Счётчик */
  var nameEl = document.createElement('div');
  nameEl.className = 'cp-fullscreen-name';
  nameEl.id = 'pv-lb-mob-name';
  nameEl.textContent = (_pvLbIdx + 1) + ' / ' + _pvLbList.length;

  /* Горизонтальный скроллер */
  var scroller = document.createElement('div');
  scroller.className = 'pv-lb-scroller';
  scroller.id = 'pv-lb-scroller';

  /* Отключить snap пока выставляем позицию — иначе браузер дёргает панели */
  scroller.style.scrollSnapType = 'none';

  _pvLbMobBuildPanels(scroller);

  /* Галочка под скроллером */
  var checkWrap = _pvLbBuildCheck(pv);
  checkWrap.id = 'pv-lb-mob-check';

  overlay.appendChild(closeBtn);
  overlay.appendChild(scroller);
  overlay.appendChild(checkWrap);
  overlay.appendChild(nameEl);
  document.body.appendChild(overlay);

  /* Прокрутить к текущей панели ПОСЛЕ layout (requestAnimationFrame).
     1 фото → панель 0, 2 фото → панель 0 (current), 3+ → панель 1 (центральная) */
  requestAnimationFrame(function() {
    var panelW = scroller.offsetWidth;
    scroller.scrollLeft = (_pvLbList.length >= 3) ? panelW : 0;

    /* Включить snap обратно после позиционирования */
    requestAnimationFrame(function() {
      scroller.style.scrollSnapType = 'x mandatory';
      _pvLbMobLocked = false;
    });
  });

  /* Слушать окончание прокрутки (snap) */
  var scrollTimer = null;
  scroller.addEventListener('scroll', function() {
    if (_pvLbMobLocked) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      _pvLbMobOnSnap(scroller);
    }, 150);
  }, { passive: true });

  document.addEventListener('keydown', _pvLbKeyHandler);
}

/**
 * Собрать панели в скроллере.
 * Если фото одно — одна панель (без скролла).
 * Если два — 2 панели (current, next).
 * Иначе — 3 панели (prev, current, next).
 */
function _pvLbMobBuildPanels(scroller) {
  scroller.innerHTML = '';

  var len = _pvLbList.length;
  if (len === 0) return;

  var indices;
  if (len === 1) {
    indices = [_pvLbIdx];
  } else if (len === 2) {
    var nextIdx2 = (_pvLbIdx + 1) % len;
    indices = [_pvLbIdx, nextIdx2];
  } else {
    var prevIdx = (_pvLbIdx - 1 + len) % len;
    var nextIdx = (_pvLbIdx + 1) % len;
    indices = [prevIdx, _pvLbIdx, nextIdx];
  }

  for (var i = 0; i < indices.length; i++) {
    var p = _pvLbList[indices[i]];
    var panel = document.createElement('div');
    panel.className = 'pv-lb-panel';

    var img = document.createElement('img');
    img.src = p ? (pvGetPreview(p) || p.dataUrl || '') : '';

    /* Горизонт → развернуть на 90° в вертикаль */
    var isLandscape = p && (p.orient === 'h' ||
      (p.width && p.height && p.width > p.height));
    img.className = 'pv-lb-panel-img' + (isLandscape ? ' pv-lb-rotated' : '');

    panel.appendChild(img);
    scroller.appendChild(panel);
  }
}

/**
 * Обработка snap: определить куда прокрутили, обновить индекс и пересобрать.
 */
function _pvLbMobOnSnap(scroller) {
  if (_pvLbMobLocked) return;

  var panelW = scroller.offsetWidth;
  if (panelW === 0) return;

  var len = _pvLbList.length;
  /* При 1 фото скролл не нужен */
  if (len <= 1) return;

  var scrollPos = scroller.scrollLeft;
  var snappedPanel = Math.round(scrollPos / panelW);

  /* При 2 фото: панели [current, next], "не двигались" = панель 0 */
  /* При 3+ фото: панели [prev, current, next], "не двигались" = панель 1 */
  var centerPanel = (len >= 3) ? 1 : 0;
  if (snappedPanel === centerPanel) return;

  if (len >= 3) {
    /* 3-панельный режим */
    if (snappedPanel === 0) {
      _pvLbIdx = (_pvLbIdx - 1 + len) % len;
    } else {
      _pvLbIdx = (_pvLbIdx + 1) % len;
    }
  } else {
    /* 2-панельный режим */
    if (snappedPanel === 1) {
      _pvLbIdx = (_pvLbIdx + 1) % len;
    } else {
      _pvLbIdx = (_pvLbIdx - 1 + len) % len;
    }
  }

  /* Заблокировать snap, пересобрать панели, центрировать мгновенно */
  _pvLbMobLocked = true;
  scroller.style.scrollSnapType = 'none';

  _pvLbMobBuildPanels(scroller);
  scroller.scrollLeft = (len >= 3) ? panelW : 0;

  requestAnimationFrame(function() {
    scroller.style.scrollSnapType = 'x mandatory';
    _pvLbMobLocked = false;
  });

  /* Обновить счётчик и галочку */
  _pvLbMobUpdateUI();
}

/**
 * Обновить счётчик и галочку в мобильном лайтбоксе.
 */
function _pvLbMobUpdateUI() {
  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;

  var nameEl = document.getElementById('pv-lb-mob-name');
  if (nameEl) {
    nameEl.textContent = (_pvLbIdx + 1) + ' / ' + _pvLbList.length;
  }

  /* Пересобрать галочку */
  var oldCheck = document.getElementById('pv-lb-mob-check');
  if (oldCheck) {
    var newCheck = _pvLbBuildCheck(pv);
    newCheck.id = 'pv-lb-mob-check';
    oldCheck.parentNode.replaceChild(newCheck, oldCheck);
  }
}

/**
 * Построить блок галочки для фото.
 * @param {Object} pv — объект превью {name, ...}
 * @returns {HTMLElement}
 */
function _pvLbBuildCheck(pv) {
  var isInOC = _pvIsInOtherContent(pv.name);
  var inCardIdx = _pvIsInCard(pv.name);
  var isLocked = inCardIdx >= 0;
  var isChecked = isInOC || isLocked;

  var checkWrap = document.createElement('div');
  checkWrap.className = 'pv-lb-check-wrap';

  var circle = document.createElement('div');
  circle.className = 'pv-lb-circle' + (isChecked ? ' pv-lb-circle-on' : '');

  var labelEl = document.createElement('span');
  if (isLocked) {
    labelEl.textContent = 'В карточке К' + (inCardIdx + 1);
  } else if (isInOC) {
    labelEl.textContent = 'В доп. контенте';
  } else {
    labelEl.textContent = 'Добавить в отбор';
  }
  checkWrap.style.cursor = 'pointer';
  checkWrap.onclick = (function(photoName) {
    return function() {
      var done = pvToggleSelection(photoName);
      if (done) {
        _pvLbMobUpdateUI();
        if (window.innerWidth >= 768) _pvLbOpen();
      }
    };
  })(pv.name);

  checkWrap.appendChild(circle);
  checkWrap.appendChild(labelEl);
  return checkWrap;
}

/**
 * Навигация по лайтбоксу: +1 вперёд, -1 назад.
 * Если включён фильтр по рейтингу — пропускает фото ниже порога.
 */
function _pvLbNav(dir) {
  var len = _pvLbList.length;
  if (!len) return;
  var minR = _pvLbRatingFilter || 0;
  var next = _pvLbIdx;
  /* Если нет фильтра — обычная навигация */
  if (minR === 0) {
    next += dir;
    if (next < 0) next = len - 1;
    if (next >= len) next = 0;
    _pvLbIdx = next;
    _pvLbOpen();
    return;
  }
  /* С фильтром: ищем следующее подходящее */
  for (var step = 0; step < len; step++) {
    next += dir;
    if (next < 0) next = len - 1;
    if (next >= len) next = 0;
    var r = _pvGetRating(_pvLbList[next].name);
    if (r >= minR) { _pvLbIdx = next; _pvLbOpen(); return; }
  }
  /* Не нашли — остаёмся на месте */
}

/**
 * Установить фильтр рейтинга в лайтбоксе и перейти к ближайшему подходящему.
 */
function _pvLbSetFilter(minRating) {
  if (_pvLbRatingFilter === minRating) minRating = 0;
  _pvLbRatingFilter = minRating;
  /* Если текущее фото не проходит фильтр — ищем ближайшее */
  if (minRating > 0) {
    var cur = _pvLbList[_pvLbIdx];
    if (cur && _pvGetRating(cur.name) < minRating) {
      _pvLbNav(1);
      return;
    }
  }
  _pvLbOpen();
}

/**
 * Убрать фото из карточки через лайтбокс.
 * @param {string} name — имя файла
 * @param {number} cardIdx — индекс карточки (0-based)
 */
function _pvLbRemoveFromCard(name, cardIdx) {
  var done = pvToggleSelection(name);
  if (done) _pvLbOpen();
}

/**
 * Добавить/убрать текущую превью из доп. контента.
 */
function _pvLbToggleOC(add) {
  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;
  var proj = getActiveProject();
  if (!proj) return;
  if (!proj.otherContent) proj.otherContent = [];

  if (add) {
    /* Добавить если нет */
    for (var i = 0; i < proj.otherContent.length; i++) {
      if (proj.otherContent[i].name === pv.name) return;
    }
    var newItem = { name: pv.name, path: pv.path || '', thumb: pv.thumb || '', preview: pv.preview || '' };
    if (typeof sbStampActor === 'function') sbStampActor(newItem);
    if (typeof sbLogAction === 'function') sbLogAction('add_to_other', 'project', null, null, pv.name);
    proj.otherContent.push(newItem);
  } else {
    /* Убрать */
    if (typeof sbLogAction === 'function') sbLogAction('remove_from_other', 'project', null, null, pv.name);
    for (var j = proj.otherContent.length - 1; j >= 0; j--) {
      if (proj.otherContent[j].name === pv.name) {
        proj.otherContent.splice(j, 1);
      }
    }
  }

  /* Сохранить + дельта-синхронизация + обновить галереи */
  if (typeof shAutoSave === 'function') shAutoSave();
  if (add && typeof sbOcDeltaAdd === 'function') {
    sbOcDeltaAdd(pv.name);
  } else if (!add && typeof sbOcDeltaRemove === 'function') {
    sbOcDeltaRemove(pv.name);
  } else if (typeof shCloudSyncExplicit === 'function') {
    shCloudSyncExplicit();
  }
  if (typeof ocRenderField === 'function') ocRenderField();
  if (typeof acRenderField === 'function') acRenderField();
}

/**
 * Проверить, есть ли фото в доп. контенте.
 */
function _pvIsInOtherContent(name) {
  var proj = getActiveProject();
  if (!proj) return false;
  /* Проверяем свободные фото */
  if (proj.otherContent) {
    for (var i = 0; i < proj.otherContent.length; i++) {
      if (proj.otherContent[i].name === name) return true;
    }
  }
  /* Проверяем контейнеры */
  if (proj.ocContainers) {
    for (var c = 0; c < proj.ocContainers.length; c++) {
      var items = proj.ocContainers[c].items || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].name === name) return true;
      }
    }
  }
  return false;
}

/**
 * Проверить, используется ли фото в какой-либо карточке.
 * @param {string} name — имя файла
 * @returns {number} индекс карточки (0-based) или -1
 */
function _pvIsInCard(name) {
  var proj = getActiveProject();
  if (!proj || !proj.cards) return -1;
  for (var c = 0; c < proj.cards.length; c++) {
    var slots = proj.cards[c].slots || [];
    for (var s = 0; s < slots.length; s++) {
      if (slots[s].file === name) return c;
    }
  }
  return -1;
}

/**
 * Обработчик клавиш в лайтбоксе.
 */
function _pvLbKeyHandler(e) {
  if (e.key === 'Escape') { pvCloseFullscreen(); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { _pvLbNav(1); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { _pvLbNav(-1); return; }
  /* Пробел убран — мешает вводу комментариев и путает пользователей */
}

function pvCloseFullscreen() {
  /* Сбросить режим аннотирования */
  _rtAnnotMode = false;
  /* Закрыть попап аннотации если открыт */
  var popup = document.querySelector('.rt-popup');
  if (popup) popup.remove();

  var overlay = document.getElementById('pv-lightbox');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _pvLbKeyHandler);

  /* Разблокировать поворот экрана */
  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch(e) {}

  /* Обновить бейджи аннотаций в галерее (могли измениться в лайтбоксе) */
  _pvRefreshAnnotBadges();
}

/**
 * Обновить счётчики аннотаций на миниатюрах галереи.
 * Вызывается при закрытии лайтбокса чтобы отразить добавленные/удалённые аннотации.
 */
function _pvRefreshAnnotBadges() {
  var thumbs = document.querySelectorAll('.pv-thumb[data-pv-name]');
  for (var i = 0; i < thumbs.length; i++) {
    var name = thumbs[i].getAttribute('data-pv-name');
    var badge = thumbs[i].querySelector('.pv-annot-badge');
    var count = rtAnnotCount(name);
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pv-annot-badge';
        thumbs[i].appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }
}

/* Обратная совместимость */
function _pvFullscreenEsc(e) {
  if (e.key === 'Escape') pvCloseFullscreen();
}

// ── Фильтр по рейтингу ──

function pvRenderFilterStars(panelKey, minRating) {
  var container = document.getElementById(panelKey + '-filter-stars');
  if (!container) return;
  var html = '';
  for (var s = 1; s <= 5; s++) {
    html += '<button class="pv-filter-star' + (s <= minRating ? ' active' : '') + '" data-star="' + s + '" onclick="pvSetFilter(\'' + panelKey + '\',' + s + ')">&#9733;</button>';
  }
  container.innerHTML = html;

  var resetBtn = document.getElementById(panelKey + '-filter-reset');
  if (resetBtn) {
    if (minRating === 0) resetBtn.classList.add('active');
    else resetBtn.classList.remove('active');
  }
}

function pvSetFilter(panelKey, minRating) {
  // Если кликнуть на тот же рейтинг — сброс
  if (PV_FILTER[panelKey] === minRating) minRating = 0;
  PV_FILTER[panelKey] = minRating;
  pvRenderAll();
}

// ── Фильтр по папке ──

function pvRenderFolderSelect(panelKey, folders, current) {
  var sel = document.getElementById(panelKey + '-folder-select');
  if (!sel) return;
  var html = '<option value="">Все папки</option>';
  for (var i = 0; i < folders.length; i++) {
    var f = folders[i];
    var selected = (f === current) ? ' selected' : '';
    html += '<option value="' + esc(f) + '"' + selected + '>' + esc(f) + '</option>';
  }
  sel.innerHTML = html;
}

function pvSetFolderFilter(panelKey, folderName) {
  PV_FOLDER_FILTER[panelKey] = folderName;
  pvRenderAll();
}

// ── Фильтр по комментариям ──

function pvToggleCommentFilter(panelKey) {
  PV_COMMENT_FILTER[panelKey] = !PV_COMMENT_FILTER[panelKey];
  var btn = document.getElementById(panelKey + '-comment-filter');
  if (btn) btn.classList.toggle('active', PV_COMMENT_FILTER[panelKey]);
  pvRenderAll();
}

// ══════════════════════════════════════════════
//  Рендер панели версий превью
// ══════════════════════════════════════════════

/**
 * Отрисовать панель переключения версий.
 * Показывает кнопки для каждой загруженной версии + статистику.
 * @param {Array} loadedVersions — массив stage id с загруженными версиями
 */
function pvRenderVersionBar(loadedVersions) {
  var switcherEl = document.getElementById('pv-version-switcher');
  var statsEl = document.getElementById('pv-version-stats');
  if (!switcherEl) return;

  /* Кнопки переключения */
  var html = '';
  /* Кнопка "Все" (без фильтра версий) */
  html += '<button class="pv-version-btn' + (!PV_ACTIVE_VERSION ? ' active' : '') + '" onclick="pvSetVersion(\'\')" title="Показать дефолтные превью">Все</button>';

  for (var i = 0; i < PV_VERSION_STAGES.length; i++) {
    var vs = PV_VERSION_STAGES[i];
    /* Показываем кнопку только если для этого этапа есть хотя бы одно превью */
    if (loadedVersions.indexOf(vs.id) < 0) continue;
    var isActive = (PV_ACTIVE_VERSION === vs.id);
    html += '<button class="pv-version-btn' + (isActive ? ' active' : '') + '" onclick="pvSetVersion(\'' + vs.id + '\')" title="Показать версию: ' + vs.label + '">' + vs.label + '</button>';
  }
  switcherEl.innerHTML = html;

  /* Статистика для активной версии */
  if (statsEl) {
    if (PV_ACTIVE_VERSION) {
      var stats = pvVersionStats(PV_ACTIVE_VERSION);
      var label = '';
      for (var j = 0; j < PV_VERSION_STAGES.length; j++) {
        if (PV_VERSION_STAGES[j].id === PV_ACTIVE_VERSION) { label = PV_VERSION_STAGES[j].label; break; }
      }
      if (stats.missing > 0) {
        statsEl.innerHTML = label + ': ' + stats.loaded + '/' + stats.total + ' <span class="pv-vs-missing">(не хватает ' + stats.missing + ')</span> <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;margin-left:4px" onclick="pvMarkAsUnchanged()" title="Пометить фото без версии как неизменённые">Осталось прежним</button>';
      } else {
        statsEl.innerHTML = label + ': ' + stats.loaded + '/' + stats.total + ' -- все загружены';
      }
    } else {
      statsEl.innerHTML = '';
    }
  }
}

/**
 * Обработчик выбора в селекте "Загрузить версию".
 * Привязывается к элементу pv-load-version-select.
 * @param {HTMLSelectElement} sel — элемент select
 */
function pvOnLoadVersionSelect(sel) {
  var stageId = sel.value;
  sel.value = ''; /* Сбросить селект */
  if (!stageId) return;

  /* Найти label для красивого сообщения */
  var label = stageId;
  for (var i = 0; i < PV_VERSION_STAGES.length; i++) {
    if (PV_VERSION_STAGES[i].id === stageId) { label = PV_VERSION_STAGES[i].label; break; }
  }

  var proj = getActiveProject();
  if (!proj || !proj.previews || proj.previews.length === 0) {
    alert('Сначала загрузите RAW-превью');
    return;
  }

  /* Подтверждение */
  if (!confirm('Выберите папку с версией "' + label + '".\n\nФайлы будут сопоставлены по имени с текущими превью.')) {
    return;
  }

  pvPickFolderAs(stageId);
}

// ── Удаление по имени (стабильное) ──

function pvRemoveByName(name, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var store = pvGetStore();
  for (var i = 0; i < store.length; i++) {
    if (store[i].name === name) { store.splice(i, 1); break; }
  }
  pvRenderAll();
}

// ── Ленивый скролл ──

function pvBindLazyScroll(scrollEl, gallery) {
  if (scrollEl._pvLazyBound) { scrollEl._pvGallery = gallery; return; }
  scrollEl._pvLazyBound = true;
  scrollEl._pvGallery = gallery;

  scrollEl.addEventListener('scroll', function() {
    var g = this._pvGallery;
    if (!g || !g._pvStore) return;
    var rendered = g._pvRendered || 0;
    var total = g._pvStore.length;
    if (rendered >= total) return;

    if (this.scrollTop + this.clientHeight > this.scrollHeight - 200) {
      var nextLimit = Math.min(total, rendered + PV_RENDER_BATCH);
      var newHTML = pvBuildHTML(g._pvStore, g._pvUsed, rendered, nextLimit);
      var temp = document.createElement('div');
      temp.innerHTML = newHTML;
      while (temp.firstChild) g.appendChild(temp.firstChild);
      g._pvRendered = nextLimit;
      pvBindDragFromGallery(g);
    }
  });
}

// ── Drag из панели превью ──

function pvBindDragFromGallery(gallery) {
  var thumbs = gallery.querySelectorAll('.pv-thumb:not([data-drag-bound])');
  thumbs.forEach(function(el) {
    el.setAttribute('data-drag-bound', '1');
    el.addEventListener('dragstart', function(e) {
      var name = this.getAttribute('data-pv-name');
      var store = pvGetStore();
      var pv = null;
      for (var k = 0; k < store.length; k++) {
        if (store[k].name === name) { pv = store[k]; break; }
      }
      if (!pv) return;

      /* Payload для drag: используем активную версию превью */
      var payload = {
        name: pv.name,
        path: pvGetPath(pv),
        thumb: pvGetThumb(pv),
        preview: pvGetPreview(pv),
        versions: pv.versions || null
      };
      e.dataTransfer.setData('application/x-preview', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
      this.classList.add('pv-dragging');
    });
    el.addEventListener('dragend', function() {
      this.classList.remove('pv-dragging');
    });
  });
}

// ── Рендер всех панелей ──

function pvRenderAll() {
  pvRenderPanel('pv-gallery', 'pv-toolbar', 'pv-count', 'pv-dropzone');
  pvRenderPanel('oc-pv-gallery', 'oc-pv-toolbar', 'oc-pv-count', 'oc-pv-dropzone');
  ocRenderField();
}

/**
 * Авто-фиксация этапа 0 ("Преотбор и превью") при завершении загрузки превью.
 * Если проект на этапе 0 и превью загружены — записывает время и переводит на этап 1.
 */
function pvAutoAdvancePreselect() {
  var proj = getActiveProject();
  if (!proj) return;
  /* Только если на этапе 0 (Преотбор и превью) */
  if ((proj._stage || 0) !== 0) return;
  /* Только если есть загруженные превью */
  if (!proj.previews || proj.previews.length === 0) return;

  /* Записать время завершения этапа 0 */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj._stageHistory[0] = timeStr;

  /* Перейти на этап 1 (Отбор фотографа) */
  proj._stage = 1;
  if (typeof renderPipeline === 'function') renderPipeline();
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Синхронизация этапа с облаком */
  if (typeof sbSyncStage === 'function') sbSyncStage('preview_loaded', timeStr);

  console.log('Авто-фиксация: Преотбор и превью завершён, переход на этап 1');
}

/**
 * Авто-переход пайплайна при загрузке версии превью.
 * Загрузка ЦК → переход на этап 'color' (3).
 * Загрузка ретуши → переход на этап 'retouch' (5).
 * Переход происходит только вперёд (не откатывает назад).
 * @param {string} stageId — id загруженной версии ('color', 'retouch')
 */
function pvAutoAdvanceToStage(stageId) {
  var proj = getActiveProject();
  if (!proj) return;

  /* Найти индекс целевого этапа в PIPELINE_STAGES */
  var targetIdx = -1;
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    if (PIPELINE_STAGES[i].id === stageId) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return;

  var currentStage = proj._stage || 0;
  /* Только вперёд */
  if (currentStage >= targetIdx) return;

  /* Записать историю для промежуточных этапов */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  /* Пометить все промежуточные этапы как пройденные */
  for (var s = currentStage; s < targetIdx; s++) {
    if (!proj._stageHistory[s]) {
      proj._stageHistory[s] = timeStr;
    }
  }

  proj._stage = targetIdx;

  if (typeof renderPipeline === 'function') renderPipeline();
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Синхронизация этапа с облаком */
  if (typeof sbSyncStage === 'function') {
    sbSyncStage(stageId + '_version_loaded', timeStr);
  }

  console.log('Авто-переход: загружена версия "' + stageId + '", этап → ' + targetIdx + ' (' + PIPELINE_STAGES[targetIdx].name + ')');
}

// ── Действия ──

function pvClearAll() {
  var proj = getActiveProject();
  if (!proj) return;
  if (!confirm('Очистить все превью?')) return;
  proj.previews = [];
  pvRenderAll();
}

function pvShortName(name) {
  var n = name.replace(/\.[^.]+$/, '');
  return n.length > 18 ? n.substring(0, 16) + '..' : n;
}

// ══════════════════════════════════════════════
//  Доп. контент — контейнеры + свободные фото
//
//  Модель данных:
//    proj.ocContainers = [{id, name, items: [{name, path, thumb, preview}]}]
//    proj.otherContent = [{name, path, thumb, preview}]  — свободные фото (без контейнера)
// ══════════════════════════════════════════════

/**
 * Получить массив контейнеров (lazy-init).
 */
function ocGetContainers() {
  var proj = getActiveProject();
  if (!proj) return [];
  if (!proj.ocContainers) proj.ocContainers = [];
  return proj.ocContainers;
}

/**
 * Создать новый контейнер.
 */
function ocAddContainer() {
  var proj = getActiveProject();
  if (!proj) return;
  if (!proj.ocContainers) proj.ocContainers = [];
  var idx = proj.ocContainers.length + 1;
  var newId = 'oc_' + Math.random().toString(36).substr(2, 8);
  var newName = 'Контейнер ' + idx;
  proj.ocContainers.push({ id: newId, name: newName, items: [] });
  if (typeof sbLogAction === 'function') sbLogAction('create_container', 'container', newId, newName);
  ocRenderField();
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Удалить контейнер — фото перемещаются в свободную зону.
 */
function ocDeleteContainer(idx) {
  var containers = ocGetContainers();
  if (idx < 0 || idx >= containers.length) return;
  if (!confirm('Удалить "' + containers[idx].name + '"? Фото переместятся в свободную зону.')) return;
  if (typeof sbLogAction === 'function') sbLogAction('delete_container', 'container', containers[idx].id, containers[idx].name);
  var proj = getActiveProject();
  if (!proj) return;
  if (!proj.otherContent) proj.otherContent = [];
  /* Перенести фото в свободную зону */
  var items = containers[idx].items || [];
  for (var i = 0; i < items.length; i++) {
    var dup = false;
    for (var j = 0; j < proj.otherContent.length; j++) {
      if (proj.otherContent[j].name === items[i].name) { dup = true; break; }
    }
    if (!dup) proj.otherContent.push(items[i]);
  }
  containers.splice(idx, 1);
  ocRenderField();
  if (typeof shAutoSave === 'function') shAutoSave();
  /* Контейнеры — полная синхронизация; OC — полная запись (массовая операция) */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof sbOcWriteFull === 'function') sbOcWriteFull();
}

/**
 * Inline-редактирование имени контейнера.
 */
function ocEditContainerName(idx) {
  var label = document.getElementById('oc-cnt-name-' + idx);
  if (!label) return;
  var containers = ocGetContainers();
  if (!containers[idx]) return;
  var curName = containers[idx].name || '';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'oc-cnt-name-input';
  input.value = curName;
  label.innerHTML = '';
  label.appendChild(input);
  input.focus();
  input.select();

  var save = function() {
    var val = input.value.trim();
    if (val) containers[idx].name = val;
    ocRenderField();
    if (typeof shAutoSave === 'function') shAutoSave();
    if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = curName; input.blur(); }
  });
}

// ── Комментарии к OC-контейнерам ──

/**
 * Получить комментарии контейнера.
 * @param {number} cntIdx
 * @returns {Array}
 */
function ocGetContainerComments(cntIdx) {
  var containers = ocGetContainers();
  if (!containers[cntIdx]) return [];
  if (!containers[cntIdx]._comments) containers[cntIdx]._comments = [];
  return containers[cntIdx]._comments;
}

/**
 * Добавить комментарий к контейнеру.
 */
function ocAddContainerComment(cntIdx, text) {
  var containers = ocGetContainers();
  if (!containers[cntIdx]) return;
  if (!containers[cntIdx]._comments) containers[cntIdx]._comments = [];
  containers[cntIdx]._comments.push({
    id: 'oc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    text: text,
    author: 'team',
    created: new Date().toISOString()
  });
  if (typeof shAutoSave === 'function') shAutoSave();
  ocRenderField();
}

/**
 * Удалить комментарий контейнера.
 */
function ocDeleteContainerComment(cntIdx, commentId) {
  var containers = ocGetContainers();
  if (!containers[cntIdx]) return;
  if (!containers[cntIdx]._comments) return;
  containers[cntIdx]._comments = containers[cntIdx]._comments.filter(function(c) { return c.id !== commentId; });
  if (typeof shAutoSave === 'function') shAutoSave();
  ocRenderField();
}

/**
 * Показать поле ввода нового комментария контейнера.
 */
function ocShowAddContainerComment(cntIdx) {
  var el = document.getElementById('oc-cmt-input-' + cntIdx);
  if (el) {
    el.style.display = 'block';
    var ta = document.getElementById('oc-cmt-text-' + cntIdx);
    if (ta) ta.focus();
  }
}

/**
 * Сохранить новый комментарий контейнера.
 */
function ocSaveContainerComment(cntIdx) {
  var ta = document.getElementById('oc-cmt-text-' + cntIdx);
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  ocAddContainerComment(cntIdx, text);
}

/**
 * HTML блока комментариев контейнера.
 * @param {number} cntIdx
 * @returns {string}
 */
function ocRenderContainerComments(cntIdx) {
  var comments = ocGetContainerComments(cntIdx);
  var html = '<div class="cp-comments oc-cmt-block">';
  html += '<div class="cp-comments-header">';
  html += '<span class="cp-comments-title" style="font-size:11px">' + (comments.length > 0 ? comments.length + ' комм.' : '') + '</span>';
  html += '<button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="ocShowAddContainerComment(' + cntIdx + ')">+ Комментарий</button>';
  html += '</div>';

  html += '<div class="cp-comment-input" id="oc-cmt-input-' + cntIdx + '" style="display:none">';
  html += '<textarea class="cp-comment-textarea" id="oc-cmt-text-' + cntIdx + '" placeholder="Комментарий..." rows="2"></textarea>';
  html += '<div style="display:flex;gap:6px;margin-top:4px">';
  html += '<button class="btn btn-sm btn-primary" style="font-size:10px" onclick="ocSaveContainerComment(' + cntIdx + ')">Добавить</button>';
  html += '<button class="btn btn-sm" style="font-size:10px" onclick="document.getElementById(\'oc-cmt-input-' + cntIdx + '\').style.display=\'none\'">Отмена</button>';
  html += '</div>';
  html += '</div>';

  for (var i = 0; i < comments.length; i++) {
    var c = comments[i];
    var dateStr = c.created ? new Date(c.created).toLocaleDateString('ru-RU') : '';
    html += '<div class="cp-comment-item" style="padding:5px 8px">';
    html += '<div class="cp-comment-text">' + esc(c.text) + '</div>';
    html += '<div class="cp-comment-meta">';
    html += '<span>' + dateStr + '</span>';
    html += '<button class="cp-comment-del" onclick="ocDeleteContainerComment(' + cntIdx + ',\'' + c.id + '\')">&times;</button>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

/**
 * Удалить фото из контейнера.
 */
function ocRemoveFromContainer(cntIdx, itemIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var containers = ocGetContainers();
  if (!containers[cntIdx]) return;
  var items = containers[cntIdx].items;
  if (itemIdx >= 0 && itemIdx < items.length) {
    var removedName = items[itemIdx].name;
    if (typeof sbLogAction === 'function') sbLogAction('remove_from_container', 'container', containers[cntIdx].id, containers[cntIdx].name, removedName);
    items.splice(itemIdx, 1);
  } else return;
  ocRenderField();
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Инициализация drag-drop для зоны (контейнер или свободная).
 * targetType: 'container' | 'free'
 * targetIdx: индекс контейнера (для 'container') или -1
 */
function _ocBindDropZone(el, targetType, targetIdx) {
  if (!el || el._ocDropBound) return;
  el._ocDropBound = true;

  el.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    this.classList.add('oc-drag-over');
  });

  el.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.classList.remove('oc-drag-over');
  });

  el.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('oc-drag-over');

    var pvData = e.dataTransfer.getData('application/x-preview');
    if (!pvData) return;

    var proj = getActiveProject();
    if (!proj) return;

    try {
      var pv = JSON.parse(pvData);
      var item = { name: pv.name, path: pv.path || '', thumb: pv.thumb, preview: pv.preview || '' };

      if (targetType === 'container') {
        var containers = ocGetContainers();
        if (!containers[targetIdx]) return;
        var cntItems = containers[targetIdx].items;
        /* Дубликат внутри одного контейнера не добавляем,
           но между разными контейнерами — разрешено */
        for (var k = 0; k < cntItems.length; k++) {
          if (cntItems[k].name === pv.name) return;
        }
        if (typeof sbStampActor === 'function') sbStampActor(item);
        if (typeof sbLogAction === 'function') sbLogAction('add_to_container', 'container', containers[targetIdx].id, containers[targetIdx].name, pv.name);
        cntItems.push(item);
      } else {
        /* Свободная зона */
        if (!proj.otherContent) proj.otherContent = [];
        for (var f = 0; f < proj.otherContent.length; f++) {
          if (proj.otherContent[f].name === pv.name) return;
        }
        if (typeof sbStampActor === 'function') sbStampActor(item);
        if (typeof sbLogAction === 'function') sbLogAction('add_to_other', 'project', null, null, pv.name);
        proj.otherContent.push(item);
      }

      ocRenderField();
      if (typeof shAutoSave === 'function') shAutoSave();

      /* Для свободной зоны: дельта-синхронизация OC (атомарно).
         Для контейнеров: полная синхронизация (структура контейнеров). */
      if (targetType === 'free' && pv.name && typeof sbOcDeltaAdd === 'function') {
        sbOcDeltaAdd(pv.name);
      } else if (typeof shCloudSyncExplicit === 'function') {
        shCloudSyncExplicit();
      }
    } catch(err) {}
  });
}

/**
 * Инициализация всех drop-зон на странице Other.
 */
function ocInitField() {
  /* Биндим drop-зоны после рендера */
  var containers = ocGetContainers();
  for (var c = 0; c < containers.length; c++) {
    var cntGallery = document.getElementById('oc-cnt-gallery-' + c);
    if (cntGallery) _ocBindDropZone(cntGallery, 'container', c);
  }
  var freeField = document.getElementById('oc-free-field');
  if (freeField) _ocBindDropZone(freeField, 'free', -1);
}

/**
 * Полная перерисовка секции Other: контейнеры + свободные фото.
 */
function ocRenderField() {
  var mainEl = document.querySelector('.oc-main');
  if (!mainEl) return;

  var proj = getActiveProject();
  if (!proj) return;

  var containers = ocGetContainers();
  var freeStore = ocGetStore();
  var totalPhotos = freeStore.length;
  for (var tc = 0; tc < containers.length; tc++) totalPhotos += (containers[tc].items || []).length;

  /* Карта превью для версионного отображения */
  var _ocPvMap = {};
  if (proj.previews) {
    for (var pm = 0; pm < proj.previews.length; pm++) {
      _ocPvMap[proj.previews[pm].name] = proj.previews[pm];
    }
  }

  /* Тулбар — показываем всегда (можно создавать контейнеры без фото) */
  var toolbar = document.getElementById('oc-toolbar');
  var countEl = document.getElementById('oc-count');
  if (toolbar) {
    toolbar.style.display = 'flex';
    if (countEl) countEl.textContent = totalPhotos + ' фото';
  }

  var zoomSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  /* Рендер динамической части (контейнеры + свободная зона) */
  var target = document.getElementById('oc-dynamic-area');
  if (!target) return;

  var html = '';

  /* ── Контейнеры ── */
  for (var c = 0; c < containers.length; c++) {
    var cnt = containers[c];
    var items = cnt.items || [];
    html += '<div class="oc-container-block">';
    html += '<div class="oc-cnt-header">';
    html += '<span class="oc-cnt-name" id="oc-cnt-name-' + c + '" onclick="ocEditContainerName(' + c + ')">' + esc(cnt.name) + '</span>';
    html += '<span class="oc-cnt-count">' + items.length + ' фото</span>';
    html += '<button class="oc-cnt-del" onclick="ocDeleteContainer(' + c + ')" title="Удалить контейнер">&times;</button>';
    html += '</div>';
    /* Комментарии контейнера */
    html += ocRenderContainerComments(c);
    html += '<div class="oc-cnt-gallery" id="oc-cnt-gallery-' + c + '">';
    if (items.length === 0) {
      html += '<div class="oc-cnt-empty">Перетащите фото сюда</div>';
    }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var cSel = _ocSelected['cnt:' + c + ':' + i] ? ' oc-selected' : '';
      var cSrc = (_ocPvMap[item.name] && typeof pvGetPreview === 'function') ? (pvGetPreview(_ocPvMap[item.name]) || item.preview || item.thumb) : (item.preview || item.thumb);
      html += '<div class="oc-item' + cSel + '" data-oc-idx="' + i + '" title="' + esc(item.name) + '" onclick="ocItemClick(\'cnt\',' + c + ',' + i + ',event)">';
      html += '<img src="' + cSrc + '" loading="lazy">';
      html += '<button class="oc-zoom" onclick="ocOpenContainerLightbox(' + c + ',' + i + ',event)" title="На весь экран">' + zoomSvg + '</button>';
      html += '<button class="pv-remove" onclick="ocRemoveFromContainer(' + c + ',' + i + ',event)">&times;</button>';
      if (item._addedBy) html += '<span class="oc-added-by">' + esc(item._addedBy) + '</span>';
      html += '<span class="pv-name">' + esc(pvShortName(item.name)) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
  }

  /* ── Свободные фото ── */
  html += '<div class="oc-free-block">';
  if (containers.length > 0) {
    html += '<div class="oc-free-header">Свободные фото</div>';
  }
  html += '<div class="oc-free-field" id="oc-free-field">';
  if (freeStore.length === 0) {
    html += '<div class="oc-cnt-empty">' + (containers.length > 0 ? 'Перетащите фото сюда' : 'Перетащите сюда фото из превью') + '</div>';
  }
  for (var f = 0; f < freeStore.length; f++) {
    var fItem = freeStore[f];
    var fSel = _ocSelected['free:' + f] ? ' oc-selected' : '';
    var fSrc = (_ocPvMap[fItem.name] && typeof pvGetPreview === 'function') ? (pvGetPreview(_ocPvMap[fItem.name]) || fItem.preview || fItem.thumb) : (fItem.preview || fItem.thumb);
    html += '<div class="oc-item' + fSel + '" data-oc-idx="' + f + '" title="' + esc(fItem.name) + '" onclick="ocItemClick(\'free\',-1,' + f + ',event)">';
    html += '<img src="' + fSrc + '" loading="lazy">';
    html += '<button class="oc-zoom" onclick="ocOpenLightbox(' + f + ',event)" title="На весь экран">' + zoomSvg + '</button>';
    html += '<button class="pv-remove" onclick="ocRemoveItem(' + f + ',event)">&times;</button>';
    if (fItem._addedBy) html += '<span class="oc-added-by">' + esc(fItem._addedBy) + '</span>';
    html += '<span class="pv-name">' + esc(pvShortName(fItem.name)) + '</span>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  target.innerHTML = html;

  /* Привязать drop-зоны */
  ocInitField();
}

/**
 * Открыть лайтбокс из свободных фото.
 */
function ocOpenLightbox(idx, e) {
  if (e) e.stopPropagation();
  var store = ocGetStore();
  if (!store[idx]) return;
  _ocOpenLb(store, idx);
}

/**
 * Открыть лайтбокс из контейнера.
 */
function ocOpenContainerLightbox(cntIdx, itemIdx, e) {
  if (e) e.stopPropagation();
  var containers = ocGetContainers();
  if (!containers[cntIdx]) return;
  var items = containers[cntIdx].items || [];
  if (!items[itemIdx]) return;
  _ocOpenLb(items, itemIdx);
}

/**
 * Общий хелпер для лайтбокса OC.
 */
function _ocOpenLb(store, idx) {
  var proj = getActiveProject();
  var pvOrientMap = {};
  if (proj && proj.previews) {
    for (var pm = 0; pm < proj.previews.length; pm++) {
      pvOrientMap[proj.previews[pm].name] = proj.previews[pm];
    }
  }
  var lbList = [];
  for (var i = 0; i < store.length; i++) {
    var srcPv = pvOrientMap[store[i].name];
    lbList.push({
      name: store[i].name,
      thumb: store[i].thumb || '',
      preview: store[i].preview || store[i].thumb || '',
      path: '',
      orient: srcPv ? srcPv.orient : 'v',
      width: srcPv ? srcPv.width : 0,
      height: srcPv ? srcPv.height : 0
    });
  }
  _pvLbList = lbList;
  _pvLbIdx = idx;
  _pvLbOpen();
}

function ocRemoveItem(idx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var store = ocGetStore();
  if (idx >= 0 && idx < store.length) {
    var removedName = store[idx].name;
    if (typeof sbLogAction === 'function') sbLogAction('remove_from_other', 'project', null, null, removedName);
    store.splice(idx, 1);
    ocRenderField();
    if (typeof shAutoSave === 'function') shAutoSave();
    /* Дельта-удаление на сервере (атомарно, без перезаписи) */
    if (removedName && typeof sbOcDeltaRemove === 'function') {
      sbOcDeltaRemove(removedName);
    } else if (typeof shCloudSyncExplicit === 'function') {
      shCloudSyncExplicit();
    }
  }
}

function ocClearAll() {
  var proj = getActiveProject();
  if (!proj) return;
  if (!confirm('Очистить весь доп. контент?')) return;
  proj.otherContent = [];
  proj.ocContainers = [];
  ocRenderField();
  if (typeof shAutoSave === 'function') shAutoSave();
  /* Контейнеры — полная синхронизация; OC — полная запись (очистка) */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof sbOcWriteFull === 'function') sbOcWriteFull();
}

// ── Мультивыбор фото (Cmd/Ctrl + клик) ──

/** @type {Object.<string, boolean>} Выделенные фото: ключ = "free:idx" или "cnt:cntIdx:itemIdx" */
var _ocSelected = {};

/**
 * Обработка клика по фото в OC с учётом мультивыбора.
 * При зажатом Cmd/Ctrl — переключает выделение вместо открытия лайтбокса.
 * source: 'free' | 'cnt', cntIdx: индекс контейнера (-1 для free), itemIdx: индекс фото
 */
function ocItemClick(source, cntIdx, itemIdx, e) {
  if (!e) return;
  e.stopPropagation();

  if (e.metaKey || e.ctrlKey) {
    /* Мультивыбор */
    var key = source === 'free' ? ('free:' + itemIdx) : ('cnt:' + cntIdx + ':' + itemIdx);
    if (_ocSelected[key]) {
      delete _ocSelected[key];
    } else {
      _ocSelected[key] = true;
    }
    _ocUpdateSelection();
    _ocUpdateGroupBar();
    return;
  }

  /* Обычный клик — сбросить выделение и открыть лайтбокс */
  _ocSelected = {};
  _ocUpdateSelection();
  _ocUpdateGroupBar();
  if (source === 'free') {
    ocOpenLightbox(itemIdx, e);
  } else {
    ocOpenContainerLightbox(cntIdx, itemIdx, e);
  }
}

/**
 * Обновить визуальное выделение в DOM.
 */
function _ocUpdateSelection() {
  /* Снять все выделения */
  var all = document.querySelectorAll('.oc-item.oc-selected');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('oc-selected');

  /* Поставить выделение */
  var keys = Object.keys(_ocSelected);
  for (var k = 0; k < keys.length; k++) {
    var parts = keys[k].split(':');
    var el;
    if (parts[0] === 'free') {
      el = document.querySelector('#oc-free-field .oc-item[data-oc-idx="' + parts[1] + '"]');
    } else {
      el = document.querySelector('#oc-cnt-gallery-' + parts[1] + ' .oc-item[data-oc-idx="' + parts[2] + '"]');
    }
    if (el) el.classList.add('oc-selected');
  }
}

/**
 * Показать/скрыть панель группировки.
 */
function _ocUpdateGroupBar() {
  var bar = document.getElementById('oc-group-bar');
  var count = Object.keys(_ocSelected).length;
  if (count > 0) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'oc-group-bar';
      bar.className = 'oc-group-bar';
      var mainEl = document.querySelector('.oc-main');
      if (mainEl) mainEl.insertBefore(bar, mainEl.firstChild);
    }
    var containers = ocGetContainers();
    var html = '<span class="oc-group-count">Выбрано: ' + count + '</span>';
    html += '<button class="btn btn-sm" onclick="ocGroupSelected(-1)">Новый контейнер</button>';
    for (var c = 0; c < containers.length; c++) {
      html += '<button class="btn btn-sm" onclick="ocGroupSelected(' + c + ')">' + esc(containers[c].name) + '</button>';
    }
    html += '<button class="btn btn-sm" onclick="ocClearSelection()">Отмена</button>';
    bar.innerHTML = html;
    bar.style.display = 'flex';
  } else {
    if (bar) bar.style.display = 'none';
  }
}

/**
 * Сбросить выделение.
 */
function ocClearSelection() {
  _ocSelected = {};
  _ocUpdateSelection();
  _ocUpdateGroupBar();
}

/**
 * Переместить/скопировать выделенные фото в контейнер.
 * targetIdx = -1 → создать новый контейнер.
 * Одно фото может быть в нескольких контейнерах одновременно.
 */
function ocGroupSelected(targetIdx) {
  var proj = getActiveProject();
  if (!proj) return;

  var containers = ocGetContainers();
  var freeStore = ocGetStore();

  /* Собрать выделенные фото */
  var photos = [];
  var keys = Object.keys(_ocSelected);
  for (var k = 0; k < keys.length; k++) {
    var parts = keys[k].split(':');
    var photo;
    if (parts[0] === 'free') {
      photo = freeStore[parseInt(parts[1])];
    } else {
      var cnt = containers[parseInt(parts[1])];
      if (cnt) photo = (cnt.items || [])[parseInt(parts[2])];
    }
    if (photo) photos.push({ name: photo.name, path: photo.path || '', thumb: photo.thumb || '', preview: photo.preview || '' });
  }

  if (photos.length === 0) return;

  /* Создать контейнер или выбрать существующий */
  var target;
  if (targetIdx === -1) {
    var idx = containers.length + 1;
    target = {
      id: 'oc_' + Math.random().toString(36).substr(2, 8),
      name: 'Контейнер ' + idx,
      items: []
    };
    containers.push(target);
  } else {
    target = containers[targetIdx];
    if (!target) return;
  }

  /* Добавить фото в контейнер (дубликаты между контейнерами разрешены) */
  for (var p = 0; p < photos.length; p++) {
    /* Проверяем дубликат только внутри этого же контейнера */
    var dup = false;
    for (var d = 0; d < target.items.length; d++) {
      if (target.items[d].name === photos[p].name) { dup = true; break; }
    }
    if (!dup) target.items.push(photos[p]);
  }

  /* Убрать из свободных, если были из free */
  for (var k2 = 0; k2 < keys.length; k2++) {
    var p2 = keys[k2].split(':');
    if (p2[0] === 'free') {
      var freeIdx = parseInt(p2[1]);
      /* Маркируем для удаления (не удаляем сразу, т.к. индексы сдвинутся) */
      if (freeStore[freeIdx]) freeStore[freeIdx]._toRemove = true;
    }
  }
  /* Удалить маркированные из свободных */
  for (var r = freeStore.length - 1; r >= 0; r--) {
    if (freeStore[r]._toRemove) freeStore.splice(r, 1);
  }

  _ocSelected = {};
  ocRenderField();
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

// ══════════════════════════════════════════════
//  «Весь контент» — все фото из отбора (карточки + доп. контент)
// ══════════════════════════════════════════════

/** @type {number} Количество колонок в плитке «Весь контент» */
var _acColumns = 4;

/**
 * Собрать все фото из отбора: слоты карточек + otherContent.
 * Возвращает массив {name, thumb, preview, source} (source = 'card' | 'other').
 */
function acGetAllContent() {
  var proj = getActiveProject();
  if (!proj) return [];
  var result = [];
  var seen = {};

  /* 1. Фото из карточек */
  var cards = proj.cards || [];
  for (var c = 0; c < cards.length; c++) {
    var slots = cards[c].slots || [];
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      var name = slot.file || '';
      if (!name) continue;
      if (seen[name]) continue;
      seen[name] = true;
      result.push({
        name: name,
        thumb: slot.thumbUrl || slot.dataUrl || '',
        preview: slot.dataUrl || slot.thumbUrl || '',
        source: 'card',
        cardIdx: c,
        orient: slot.orient || 'v'
      });
    }
  }

  /* 2. Доп. контент: контейнеры */
  var ocCnt = proj.ocContainers || [];
  for (var ci = 0; ci < ocCnt.length; ci++) {
    var cntItems = ocCnt[ci].items || [];
    for (var cj = 0; cj < cntItems.length; cj++) {
      var cItem = cntItems[cj];
      if (seen[cItem.name]) continue;
      seen[cItem.name] = true;
      result.push({
        name: cItem.name,
        thumb: cItem.thumb || '',
        preview: cItem.preview || cItem.thumb || '',
        source: 'other'
      });
    }
  }

  /* 3. Доп. контент: свободные фото */
  var oc = proj.otherContent || [];
  for (var i = 0; i < oc.length; i++) {
    var item = oc[i];
    if (seen[item.name]) continue;
    seen[item.name] = true;
    result.push({
      name: item.name,
      thumb: item.thumb || '',
      preview: item.preview || item.thumb || '',
      source: 'other'
    });
  }

  /* Сортировка по имени файла */
  result.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Отрисовать плитку «Весь контент».
 * ВСЕ галочки отжимаемые: карточные = убрать из слота, допконтент = убрать из OC.
 */
function acRenderField() {
  var gallery = document.getElementById('ac-gallery');
  var toolbar = document.getElementById('ac-toolbar');
  var countEl = document.getElementById('ac-count');
  var empty = document.getElementById('ac-field-empty');
  if (!gallery) return;

  var items = acGetAllContent();

  /* Применить фильтр по источнику если задан */
  if (_acSourceFilter === 'card') {
    var srcFiltered = [];
    for (var sf = 0; sf < items.length; sf++) {
      if (items[sf].source === 'card') srcFiltered.push(items[sf]);
    }
    items = srcFiltered;
  } else if (_acSourceFilter === 'other') {
    var srcFiltered2 = [];
    for (var sf2 = 0; sf2 < items.length; sf2++) {
      if (items[sf2].source === 'other') srcFiltered2.push(items[sf2]);
    }
    items = srcFiltered2;
  }

  /* Применить фильтр по рейтингу если задан */
  var minRating = _acRatingFilter || 0;
  if (minRating > 0) {
    var proj = getActiveProject();
    var pvMap = {};
    if (proj && proj.previews) {
      for (var p = 0; p < proj.previews.length; p++) {
        pvMap[proj.previews[p].name] = proj.previews[p].rating || 0;
      }
    }
    var filtered = [];
    for (var f = 0; f < items.length; f++) {
      var r = pvMap[items[f].name] || 0;
      if (r >= minRating) filtered.push(items[f]);
    }
    items = filtered;
  }

  if (items.length === 0) {
    gallery.innerHTML = '';
    if (toolbar) toolbar.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }

  if (toolbar) {
    toolbar.style.display = 'flex';
    countEl.textContent = items.length + ' фото';
  }
  if (empty) empty.style.display = 'none';

  gallery.style.gridTemplateColumns = 'repeat(' + _acColumns + ', 1fr)';

  /* Карта превью для версионного отображения */
  var acProj = getActiveProject();
  var _acPvMap = {};
  if (acProj && acProj.previews) {
    for (var ap = 0; ap < acProj.previews.length; ap++) {
      _acPvMap[acProj.previews[ap].name] = acProj.previews[ap];
    }
  }

  var zoomSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var isH = it.orient === 'h';
    var spanStyle = isH ? ' style="grid-column: span 2"' : '';

    /* Версионно-зависимый src из pv-объекта */
    var acSrc = (_acPvMap[it.name] && typeof pvGetPreview === 'function') ? (pvGetPreview(_acPvMap[it.name]) || it.preview || it.thumb) : (it.preview || it.thumb);
    html += '<div class="ac-tile' + (isH ? ' ac-tile-h' : '') + '"' + spanStyle + ' title="' + esc(it.name) + '" onclick="acViewFrom(\'' + esc(it.name).replace(/'/g, "\\'") + '\',event)">';
    html += '<img src="' + acSrc + '" loading="lazy">';

    if (it.source === 'card') {
      /* Фото из карточки — зелёная галочка, можно отжать (убрать из карточки) */
      html += '<button class="ac-check ac-check-on" onclick="acToggleCard(\'' + esc(it.name).replace(/'/g, "\\'") + '\',' + it.cardIdx + ',event)"></button>';
      html += '<span class="ac-check-label">К' + (it.cardIdx + 1) + '</span>';
    } else {
      /* Фото из допконтента — зелёная галочка, можно убрать */
      html += '<button class="ac-check ac-check-on" onclick="acRemoveOC(\'' + esc(it.name).replace(/'/g, "\\'") + '\',event)"></button>';
      html += '<span class="ac-check-label">Доп.</span>';
    }

    /* Кнопка «посмотреть опции» → лайтбокс со ВСЕМИ превью начиная с этого файла */
    html += '<button class="ac-zoom" onclick="acViewFrom(\'' + esc(it.name).replace(/'/g, "\\'") + '\',event)" title="Посмотреть опции">' + zoomSvg + '</button>';
    html += '</div>';
  }
  gallery.innerHTML = html;

  /* Обновить звёздочный фильтр */
  acRenderFilterStars();
}

/* ── Хелперы для pvToggleSelection ── */

/**
 * Очистить слот в карточке по имени файла.
 * Находит слот, содержащий указанный файл, и обнуляет все его поля.
 *
 * @param {Object} proj — активный проект
 * @param {number} cardIdx — индекс карточки (0-based)
 * @param {string} name — имя файла
 */
function _pvClearSlotByName(proj, cardIdx, name) {
  if (!proj.cards || !proj.cards[cardIdx]) return;
  var slots = proj.cards[cardIdx].slots || [];
  for (var s = 0; s < slots.length; s++) {
    if (slots[s].file === name) {
      slots[s].file = null;
      slots[s].dataUrl = null;
      slots[s].thumbUrl = null;
      slots[s].path = '';
      break;
    }
  }
}

/**
 * Удалить фото из массива otherContent проекта.
 *
 * @param {Object} proj — активный проект
 * @param {string} name — имя файла
 */
function _pvRemoveFromOC(proj, name) {
  if (!proj.otherContent) return;
  for (var i = proj.otherContent.length - 1; i >= 0; i--) {
    if (proj.otherContent[i].name === name) {
      proj.otherContent.splice(i, 1);
    }
  }
}

/**
 * Добавить фото в otherContent проекта (из загруженных превью).
 * Если фото уже есть в OC — ничего не делает.
 *
 * @param {Object} proj — активный проект
 * @param {string} name — имя файла
 */
function _pvAddToOC(proj, name) {
  if (!proj.otherContent) proj.otherContent = [];
  /* Проверка дубликата */
  for (var i = 0; i < proj.otherContent.length; i++) {
    if (proj.otherContent[i].name === name) return;
  }
  /* Найти превью по имени */
  var pv = null;
  if (proj.previews) {
    for (var p = 0; p < proj.previews.length; p++) {
      if (proj.previews[p].name === name) { pv = proj.previews[p]; break; }
    }
  }
  proj.otherContent.push({
    name: name,
    path: pv ? (pv.path || '') : '',
    thumb: pv ? (pv.thumb || '') : '',
    preview: pv ? (pv.preview || '') : ''
  });
}

/**
 * Единая функция переключения отбора: карточки, допконтент, добавление.
 *
 * Поведение зависит от source:
 * - 'card'    → удаляет из карточки молча (без подтверждения)
 * - 'oc'      → удаляет из допконтента молча
 * - undefined → из галереи/селекта/лайтбокса:
 *               если фото в карточке — спрашивает подтверждение
 *               если фото в допконтенте — убирает молча
 *               если нигде — добавляет в допконтент
 *
 * @param {string} name — имя файла
 * @param {Event} [e] — событие клика
 * @param {string} [source] — откуда вызвано: 'card', 'oc', или undefined (галерея)
 * @returns {boolean} true если выполнено, false если отменено
 */
function pvToggleSelection(name, e, source) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var proj = getActiveProject();
  if (!proj) return false;

  var inCardIdx = _pvIsInCard(name);
  var inOC = _pvIsInOtherContent(name);

  /* Флаг: была ли операция именно над OC (для дельта-синхронизации) */
  var ocAdded = false;
  var ocRemoved = false;

  if (source === 'card') {
    /* Вызвано из редактора карточки — удалить из карточки молча */
    if (inCardIdx >= 0) {
      _pvClearSlotByName(proj, inCardIdx, name);
      if (typeof cpRenderCard === 'function') cpRenderCard();
    }
  } else if (source === 'oc') {
    /* Вызвано из панели допконтента — удалить из OC молча */
    _pvRemoveFromOC(proj, name);
    ocRemoved = true;
  } else {
    /* Вызвано из галереи / селекта / лайтбокса */
    if (inCardIdx >= 0) {
      /* Фото в карточке — спросить подтверждение */
      if (!confirm('Убрать из отбора? Это фото есть в карточке ' + (inCardIdx + 1) + ' — оно будет удалено из карточки.')) return false;
      _pvClearSlotByName(proj, inCardIdx, name);
      if (typeof cpRenderCard === 'function') cpRenderCard();
    } else if (inOC) {
      /* В допконтенте — убрать молча */
      _pvRemoveFromOC(proj, name);
      ocRemoved = true;
    } else {
      /* Нигде нет — добавить в допконтент */
      _pvAddToOC(proj, name);
      ocAdded = true;
    }
  }

  /* Сохранить локально */
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Синхронизация: для OC-операций — дельта (атомарная),
     для карточных — полная синхронизация через shCloudSyncExplicit */
  if (ocAdded && typeof sbOcDeltaAdd === 'function') {
    sbOcDeltaAdd(name);
  } else if (ocRemoved && typeof sbOcDeltaRemove === 'function') {
    sbOcDeltaRemove(name);
  } else {
    /* Карточная операция или fallback — полная синхронизация */
    if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  }

  /* Обновить десктопные панели (на мобильном не вызывать cpMobileRender —
     он перестраивает ВСЮ страницу и сбрасывает скролл.
     Лайтбокс сам обновляет свою галочку через _pvLbMobUpdateUI / _pvLbOpen,
     а мобильная галерея — через cpMobileToggleOC.) */
  if (typeof acRenderField === 'function') acRenderField();
  if (typeof ocRenderField === 'function') ocRenderField();
  return true;
}

/* Обратная совместимость: старые вызовы → единая функция */
function acRemoveOC(name, e) { pvToggleSelection(name, e, 'oc'); }
function acToggleCard(name, cardIdx, e) { pvToggleSelection(name, e, 'card'); }

/**
 * Изменить количество колонок в плитке «Весь контент».
 */
function acSetColumns(val) {
  _acColumns = parseInt(val) || 4;
  acRenderField();
}

// ── «Весь контент»: фильтр по источнику (all / card / other) ──

/** @type {string} Фильтр по источнику: 'all', 'card', 'other' */
var _acSourceFilter = 'all';

/**
 * Установить фильтр по источнику для «Весь контент».
 * @param {string} src — 'all', 'card', 'other'
 */
function acSetSourceFilter(src) {
  _acSourceFilter = src || 'all';
  acRenderField();
  /* Обновить кнопки */
  var wrap = document.getElementById('ac-source-filter');
  if (wrap) {
    var btns = wrap.querySelectorAll('.ac-src-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('ac-src-active');
    }
    var active = wrap.querySelector('[onclick*="' + _acSourceFilter + '"]');
    if (active) active.classList.add('ac-src-active');
  }
}

// ── «Весь контент»: фильтр по рейтингу ──

/** @type {number} Минимальный рейтинг для фильтра «Весь контент» (0 = все) */
var _acRatingFilter = 0;

/**
 * Отрисовать звёздочки фильтра в тулбаре «Весь контент».
 */
function acRenderFilterStars() {
  var container = document.getElementById('ac-filter-stars');
  if (!container) return;
  var html = '';
  for (var s = 1; s <= 5; s++) {
    html += '<button class="pv-filter-star' + (s <= _acRatingFilter ? ' active' : '') + '" data-star="' + s + '" onclick="acSetRatingFilter(' + s + ')">&#9733;</button>';
  }
  container.innerHTML = html;

  var resetBtn = document.getElementById('ac-filter-reset');
  if (resetBtn) {
    if (_acRatingFilter === 0) resetBtn.classList.add('active');
    else resetBtn.classList.remove('active');
  }
}

/**
 * Установить фильтр по рейтингу для «Весь контент».
 */
function acSetRatingFilter(minRating) {
  if (_acRatingFilter === minRating) minRating = 0;
  _acRatingFilter = minRating;
  acRenderField();
}

// ── «Весь контент»: лайтбокс с фильтром ──

/** @type {number} Фильтр рейтинга в лайтбоксе (0 = все) */
var _pvLbRatingFilter = 0;

/**
 * Получить рейтинг фото по имени из массива превью проекта.
 * @param {string} name
 * @returns {number} рейтинг 0-5
 */
function _pvGetRating(name) {
  var proj = getActiveProject();
  if (!proj || !proj.previews) return 0;
  for (var i = 0; i < proj.previews.length; i++) {
    if (proj.previews[i].name === name) return proj.previews[i].rating || 0;
  }
  return 0;
}

/**
 * Открыть лайтбокс из плитки «Весь контент».
 * Собирает все фото в acGetAllContent() и открывает по индексу.
 */
function acOpenLightbox(idx, e) {
  if (e) e.stopPropagation();
  var items = acGetAllContent();
  if (!items[idx]) return;

  /* Применить текущий рейтинговый фильтр Весь контент */
  var minRating = _acRatingFilter || 0;
  if (minRating > 0) {
    var filtered = [];
    for (var f = 0; f < items.length; f++) {
      var r = _pvGetRating(items[f].name);
      if (r >= minRating) filtered.push(items[f]);
    }
    items = filtered;
  }
  if (!items[idx]) idx = 0;
  if (!items.length) return;

  /* Собираем массив в формате совместимом с _pvLbList.
     Обогащаем orient из превью проекта для корректного разворота горизонтов */
  var proj = getActiveProject();
  var pvOrientMap = {};
  if (proj && proj.previews) {
    for (var pm = 0; pm < proj.previews.length; pm++) {
      pvOrientMap[proj.previews[pm].name] = proj.previews[pm];
    }
  }
  var lbList = [];
  for (var i = 0; i < items.length; i++) {
    var srcPv = pvOrientMap[items[i].name];
    lbList.push({
      name: items[i].name,
      thumb: items[i].thumb || '',
      preview: items[i].preview || '',
      path: '',
      orient: srcPv ? srcPv.orient : (items[i].orient || 'v'),
      width: srcPv ? srcPv.width : 0,
      height: srcPv ? srcPv.height : 0
    });
  }
  _pvLbList = lbList;
  _pvLbIdx = idx;
  _pvLbRatingFilter = _acRatingFilter;
  _pvLbOpen();
}

/**
 * Кнопка на плитке отбора — открывает лайтбокс со ВСЕМИ превью проекта,
 * начиная с фото по имени name.
 * @param {string} name — имя файла от которого начать
 * @param {Event} e
 */
function acViewFrom(name, e) {
  if (e) e.stopPropagation();
  var proj = getActiveProject();
  if (!proj || !proj.previews || !proj.previews.length) return;

  var all = proj.previews;
  var minR = _acRatingFilter || 0;
  var lbList = [];
  var startIdx = 0;

  for (var i = 0; i < all.length; i++) {
    if (minR > 0 && (all[i].rating || 0) < minR) continue;
    if (all[i].name === name) startIdx = lbList.length;
    lbList.push({
      name: all[i].name,
      thumb: all[i].thumb || '',
      preview: all[i].preview || '',
      path: all[i].path || '',
      orient: all[i].orient || 'v',
      width: all[i].width || 0,
      height: all[i].height || 0
    });
  }
  if (!lbList.length) return;

  _pvLbList = lbList;
  _pvLbIdx = startIdx;
  _pvLbRatingFilter = _acRatingFilter;
  _pvLbOpen();
}

/**
 * Кнопка «Посмотреть все опции» — открывает лайтбокс со ВСЕМИ превью проекта
 * (не только отбор, а полный пул). С фильтром по рейтингу если задан.
 */
function acViewAll() {
  var proj = getActiveProject();
  if (!proj || !proj.previews || !proj.previews.length) return;

  var all = proj.previews;
  /* Применить рейтинговый фильтр если есть */
  var minR = _acRatingFilter || 0;
  var lbList = [];
  for (var i = 0; i < all.length; i++) {
    if (minR > 0 && (all[i].rating || 0) < minR) continue;
    lbList.push({
      name: all[i].name,
      thumb: all[i].thumb || '',
      preview: all[i].preview || '',
      path: all[i].path || '',
      orient: all[i].orient || 'v',
      width: all[i].width || 0,
      height: all[i].height || 0
    });
  }
  if (!lbList.length) return;

  _pvLbList = lbList;
  _pvLbIdx = 0;
  _pvLbRatingFilter = _acRatingFilter;
  _pvLbOpen();
}

/**
 * Вызывается при открытии подвкладки «Весь контент».
 */
function acOnPageShow() {
  acRenderField();
}


// ══════════════════════════════════════════════
//  Инициализация
// ══════════════════════════════════════════════

function pvOnPageShow() {
  pvInitDropzone('pv-dropzone');
  pvRenderAll();
}

function ocOnPageShow() {
  pvInitDropzone('oc-pv-dropzone');
  ocRenderField();  /* Рендерит контейнеры + свободные, затем биндит drop-зоны */
  pvRenderAll();
}

// ══════════════════════════════════════════════
//  Drag-to-resize preview panel
// ══════════════════════════════════════════════

/**
 * Initialize resize handle for preview panel
 * Creates a draggable strip on left edge, saves width to localStorage
 */
function pvInitResize() {
  var panel = document.getElementById('cp-previews');
  if (!panel || panel._pvResizeInitialized) return;
  panel._pvResizeInitialized = true;

  // Create resize handle element
  var handle = document.createElement('div');
  handle.className = 'pv-resize-handle';
  panel.insertBefore(handle, panel.firstChild);

  // Restore saved width from localStorage
  var savedWidth = localStorage.getItem('maketcp_pv_width');
  if (savedWidth) {
    var width = parseInt(savedWidth, 10);
    if (width >= 200 && width <= window.innerWidth / 2) {
      panel.style.width = width + 'px';
    }
  }

  // Track resize state
  var resizing = false;
  var startX = 0;
  var startWidth = 0;

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;

    // Add class for visual feedback during resize
    panel.classList.add('pv-resizing');
  });

  document.addEventListener('mousemove', function(e) {
    if (!resizing) return;

    // Calculate new width (from right edge dragging left)
    var deltaX = e.clientX - startX;
    var newWidth = startWidth + deltaX;

    // Apply constraints: min 200px, max 50% of window
    var minWidth = 200;
    var maxWidth = Math.floor(window.innerWidth / 2);
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    panel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!resizing) return;
    resizing = false;
    panel.classList.remove('pv-resizing');

    // Save width to localStorage
    var currentWidth = panel.offsetWidth;
    localStorage.setItem('maketcp_pv_width', currentWidth.toString());
  });
}

// ══════════════════════════════════════════════
//  Ползунок размера миниатюр (2-6 колонок)
// ══════════════════════════════════════════════

/** @type {string} localStorage key для количества колонок */
var PV_COLS_KEY = 'maketcp_pv_cols';

/** @type {number} Текущее количество колонок (по умолчанию 3) */
var pvColumns = 3;

/**
 * Установить количество колонок в галерее превью.
 * Пересчитывает ширину .pv-thumb через CSS custom property (inline style).
 * Горизонты всегда занимают 2 колонки.
 * @param {number|string} cols — количество колонок (2-6)
 */
function pvSetColumns(cols) {
  pvColumns = parseInt(cols, 10) || 3;
  if (pvColumns < 2) pvColumns = 2;
  if (pvColumns > 6) pvColumns = 6;

  try { localStorage.setItem(PV_COLS_KEY, pvColumns.toString()); } catch(e) {}

  pvApplyColumnWidth();
}

/**
 * Применить ширину колонок ко всем галереям.
 * Формула: width = (100% - (cols-1)*gap) / cols
 * gap = 4px
 */
function pvApplyColumnWidth() {
  var gap = 4;
  var totalGap = (pvColumns - 1) * gap;
  var thumbWidth = 'calc((100% - ' + totalGap + 'px) / ' + pvColumns + ')';

  /* Горизонт = 2 колонки + 1 gap */
  var hCols = Math.min(pvColumns, pvColumns); // ограничение: не больше pvColumns
  var hGap = (hCols - 1) * gap;
  var hThumbWidth;
  if (pvColumns <= 2) {
    /* При 2 колонках горизонт = полная ширина */
    hThumbWidth = '100%';
  } else {
    /* Горизонт = 2 ячейки + 1 gap */
    hThumbWidth = 'calc(2 * (100% - ' + totalGap + 'px) / ' + pvColumns + ' + ' + gap + 'px)';
  }

  var galleries = document.querySelectorAll('.pv-gallery');
  for (var g = 0; g < galleries.length; g++) {
    var thumbs = galleries[g].querySelectorAll('.pv-thumb');
    for (var t = 0; t < thumbs.length; t++) {
      if (thumbs[t].classList.contains('pv-h')) {
        thumbs[t].style.width = hThumbWidth;
      } else {
        thumbs[t].style.width = thumbWidth;
      }
    }
  }
}

/**
 * Инициализация: восстановить сохранённое количество колонок.
 */
function pvInitColumns() {
  try {
    var saved = localStorage.getItem(PV_COLS_KEY);
    if (saved) pvColumns = parseInt(saved, 10) || 3;
  } catch(e) {}

  var slider = document.getElementById('pv-thumb-slider');
  if (slider) slider.value = pvColumns;
}

// ── Скачать превью: ZIP с тремя папками ──

/**
 * Скачать превью отсортированные по трём папкам:
 *   1_cards/     — фото, которые уже в карточках
 *   2_rating_1/  — рейтинг >= 1, минус те что в карточках
 *   3_rating_2/  — рейтинг >= 2, минус те что в карточках
 *
 * Использует JSZip + FileSaver (CDN).
 */
function pvDownloadSorted() {
  if (typeof JSZip === 'undefined') {
    alert('Библиотека JSZip не загружена. Обновите страницу.');
    return;
  }

  var proj = getActiveProject();
  if (!proj || !proj.previews || proj.previews.length === 0) {
    alert('Нет превью для скачивания');
    return;
  }

  /* Собрать имена файлов в карточках */
  var inCards = {};
  if (proj.cards) {
    for (var c = 0; c < proj.cards.length; c++) {
      var card = proj.cards[c];
      if (!card.slots) continue;
      for (var s = 0; s < card.slots.length; s++) {
        if (card.slots[s].file) inCards[card.slots[s].file] = true;
      }
    }
  }

  /* Разделить превью на 3 группы */
  var groups = { cards: [], r1: [], r2: [] };
  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];
    var src = pv.thumb || pv.dataUrl || '';
    if (!src) continue;

    if (inCards[pv.name]) {
      groups.cards.push({ name: pv.name || ('photo_' + i + '.jpg'), src: src });
    } else if ((pv.rating || 0) >= 2) {
      groups.r2.push({ name: pv.name || ('photo_' + i + '.jpg'), src: src });
    } else if ((pv.rating || 0) >= 1) {
      groups.r1.push({ name: pv.name || ('photo_' + i + '.jpg'), src: src });
    }
  }

  var total = groups.cards.length + groups.r1.length + groups.r2.length;
  if (total === 0) {
    alert('Нет фото для скачивания (нужны фото в карточках или с рейтингом)');
    return;
  }

  console.log('Скачивание:', groups.cards.length, 'в карточках,',
    groups.r1.length, '1 звезда,', groups.r2.length, '2 звезды');

  var zip = new JSZip();
  var folderCards = zip.folder('1_cards');
  var folderR1 = zip.folder('2_rating_1');
  var folderR2 = zip.folder('3_rating_2');

  /* Собрать все задачи загрузки */
  var tasks = [];
  groups.cards.forEach(function(item) { tasks.push({ folder: folderCards, item: item }); });
  groups.r1.forEach(function(item) { tasks.push({ folder: folderR1, item: item }); });
  groups.r2.forEach(function(item) { tasks.push({ folder: folderR2, item: item }); });

  var done = 0;

  /* Загрузить одну картинку и добавить в ZIP */
  function addToZip(task, cb) {
    var src = task.item.src;

    if (src.indexOf('data:') === 0) {
      /* base64 — сразу в ZIP */
      var b64 = src.split(',')[1];
      if (b64) task.folder.file(task.item.name, b64, { base64: true });
      done++;
      cb();
    } else if (src.indexOf('http') === 0) {
      /* URL (Supabase Storage) — скачиваем как blob */
      fetch(src).then(function(resp) {
        return resp.blob();
      }).then(function(blob) {
        task.folder.file(task.item.name, blob);
        done++;
        if (done % 50 === 0) console.log('Скачано:', done + '/' + total);
        cb();
      }).catch(function() {
        console.warn('Не удалось скачать:', task.item.name);
        done++;
        cb();
      });
    } else {
      done++;
      cb();
    }
  }

  /* Скачиваем батчами по 10 чтобы не перегрузить сеть */
  var BATCH = 10;
  var idx = 0;

  function nextBatch() {
    if (idx >= tasks.length) {
      /* Всё скачано — генерируем ZIP */
      console.log('Формируем ZIP:', done, 'файлов...');
      zip.generateAsync({ type: 'blob' }).then(function(blob) {
        var name = (proj.brand || 'project') + '_previews.zip';
        saveAs(blob, name);
        console.log('ZIP готов:', name);
      });
      return;
    }

    var end = Math.min(idx + BATCH, tasks.length);
    var batchLeft = end - idx;

    for (var b = idx; b < end; b++) {
      addToZip(tasks[b], function() {
        batchLeft--;
        if (batchLeft <= 0) nextBatch();
      });
    }

    idx = end;
  }

  nextBatch();
}

// Initialize resize + columns on page load
document.addEventListener('DOMContentLoaded', function() {
  pvInitResize();
  pvInitColumns();
});


// ══════════════════════════════════════════════
//  Комментарии к фото
//
//  Модель: proj._annotations = {
//    "photo_name.jpg": [
//      { id, x?, y?, r?, type, text, tags, author, created, hasCircle, shape?, points? }
//    ]
//  }
//    hasCircle — true если к комментарию привязан кружок
//    x, y  — координаты центра круга в % от размера фото (0–100), только если hasCircle
//    r     — радиус круга в % от ширины фото (default 5), только если hasCircle
//    shape — 'circle' (default) | 'line' — тип фигуры
//    points— [{x,y}, ...] массив точек линии в % (только если shape === 'line')
//    type  — 'remove' | 'soften' | 'attention' (удалить / смягчить / обрати внимание)
//    text  — текстовый комментарий (может быть пустым)
//    tags  — массив тегов ['кожа', 'одежда', 'фон', ...]
//    author— 'team' | 'client'
//    created — ISO timestamp
//
//  UI: лайтбокс → «Комментарии» → тулбар [+ Текст] [+ Кружок] [+ Линия] →
//  Текст = попап без привязки к месту
//  Кружок = mousedown+drag на фото → размер кружка → попап
//  Линия = клики на фото → точки соединяются сглаженной кривой → двойной клик → попап
// ══════════════════════════════════════════════

/** Режим аннотирования: 'circle' | 'line' | false */
var _rtAnnotMode = false;

/** Состояние перетаскивания эллипса (drag для размера) */
var _rtDragState = null; /* { startX, startY, imgRect, imgWrap } */

/** Состояние рисования линии: массив точек [{x,y}] в % от фото */
var _rtLinePoints = [];

/** Состояние перетаскивания/ресайза существующего эллипса */
var _rtEditDrag = null; /* { mode: 'move'|'resizeR'|'resizeB', annotId, photoName, imgWrap, startEvt, origAnnot } */

/** Типы аннотаций: id → {label, color} */
var RT_ANNOTATION_TYPES = {
  remove:    { label: 'Удалить',          color: 'rgba(220,50,50,0.5)',  border: '#c33' },
  soften:    { label: 'Смягчить',         color: 'rgba(220,180,50,0.4)', border: '#cc9' },
  attention: { label: 'Обрати внимание',  color: 'rgba(50,130,220,0.4)', border: '#48c' }
};

/** Предустановленные теги для быстрого выбора */
var RT_QUICK_TAGS = ['кожа', 'одежда', 'фон', 'волосы', 'тени', 'объект', 'цвет'];

/**
 * Получить массив аннотаций для фото.
 * @param {string} photoName — имя файла
 * @returns {Array}
 */
function rtGetAnnotations(photoName) {
  var proj = getActiveProject();
  if (!proj) return [];
  if (!proj._annotations) proj._annotations = {};
  return proj._annotations[photoName] || [];
}

/**
 * Добавить аннотацию к фото.
 * @param {string} photoName — имя файла
 * @param {Object} annotation — {x, y, r, type, text, tags}
 * @returns {Object} добавленная аннотация с id и timestamp
 */
function rtAddAnnotation(photoName, annotation) {
  var proj = getActiveProject();
  if (!proj) return null;
  if (!proj._annotations) proj._annotations = {};
  if (!proj._annotations[photoName]) proj._annotations[photoName] = [];

  var isLine = annotation.shape === 'line';
  var hasCircle = !isLine && !!(annotation.x !== undefined && annotation.y !== undefined);
  var a = {
    id: 'rt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    hasCircle: hasCircle,
    shape: isLine ? 'line' : 'circle',
    type: annotation.type || 'attention',
    text: annotation.text || '',
    tags: annotation.tags || [],
    author: annotation.author || 'team',
    created: new Date().toISOString()
  };

  if (isLine && annotation.points) {
    a.points = annotation.points;
    a.x = annotation.x;
    a.y = annotation.y;
  } else if (hasCircle) {
    a.x = annotation.x;
    a.y = annotation.y;
    a.rx = annotation.rx || annotation.r || 5;
    a.ry = annotation.ry || annotation.r || 5;
  }

  proj._annotations[photoName].push(a);

  /* Автосохранение */
  if (typeof shAutoSave === 'function') shAutoSave();
  return a;
}

/**
 * Удалить аннотацию по id.
 * @param {string} photoName
 * @param {string} annotId
 */
function rtRemoveAnnotation(photoName, annotId) {
  var proj = getActiveProject();
  if (!proj || !proj._annotations || !proj._annotations[photoName]) return;
  proj._annotations[photoName] = proj._annotations[photoName].filter(function(a) {
    return a.id !== annotId;
  });
  if (proj._annotations[photoName].length === 0) {
    delete proj._annotations[photoName];
  }
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Обновить текст/тип аннотации.
 * @param {string} photoName
 * @param {string} annotId
 * @param {Object} updates — {text?, type?, tags?}
 */
function rtUpdateAnnotation(photoName, annotId, updates) {
  var annots = rtGetAnnotations(photoName);
  for (var i = 0; i < annots.length; i++) {
    if (annots[i].id === annotId) {
      if (updates.text !== undefined) annots[i].text = updates.text;
      if (updates.type !== undefined) annots[i].type = updates.type;
      if (updates.tags !== undefined) annots[i].tags = updates.tags;
      break;
    }
  }
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Количество аннотаций для фото (для отображения счётчика).
 * @param {string} photoName
 * @returns {number}
 */
function rtAnnotCount(photoName) {
  return rtGetAnnotations(photoName).length;
}

// ── Рендер аннотаций на лайтбоксе ──

/**
 * Создать SVG-слой аннотаций поверх изображения в лайтбоксе.
 * @param {string} photoName — имя фото
 * @param {HTMLElement} imgWrap — контейнер изображения
 */
function rtRenderAnnotations(photoName, imgWrap) {
  /* Удалить старый слой */
  var old = imgWrap.querySelector('.rt-annot-layer');
  if (old) old.remove();

  var annots = rtGetAnnotations(photoName);

  var layer = document.createElement('div');
  layer.className = 'rt-annot-layer';

  /* Выровнять слой аннотаций точно по картинке */
  _rtAlignLayer(layer, imgWrap);

  var graphicNum = 0;
  var svgNS = 'http://www.w3.org/2000/svg';

  /* SVG для линий — создаём через DOM (не innerHTML, из-за namespace) */
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:4';
  var hasSvgContent = false;

  for (var i = 0; i < annots.length; i++) {
    var a = annots[i];

    /* ── Линия ── */
    if (a.shape === 'line' && a.points && a.points.length >= 2) {
      graphicNum++;
      hasSvgContent = true;
      var typeInfo = RT_ANNOTATION_TYPES[a.type] || RT_ANNOTATION_TYPES.attention;
      var d = _rtBuildSmoothPath(a.points);

      /* Основная кривая */
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', typeInfo.border);
      path.setAttribute('stroke-width', '0.6');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', '0.8');
      svg.appendChild(path);

      /* Точки */
      for (var pi = 0; pi < a.points.length; pi++) {
        var dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', a.points[pi].x);
        dot.setAttribute('cy', a.points[pi].y);
        dot.setAttribute('r', '0.6');
        dot.setAttribute('fill', typeInfo.border);
        svg.appendChild(dot);
      }

      /* Номер посередине */
      var midIdx = Math.floor(a.points.length / 2);
      var numBg = document.createElementNS(svgNS, 'circle');
      numBg.setAttribute('cx', a.points[midIdx].x);
      numBg.setAttribute('cy', a.points[midIdx].y);
      numBg.setAttribute('r', '1.8');
      numBg.setAttribute('fill', typeInfo.color);
      numBg.setAttribute('stroke', typeInfo.border);
      numBg.setAttribute('stroke-width', '0.3');
      svg.appendChild(numBg);

      var numText = document.createElementNS(svgNS, 'text');
      numText.setAttribute('x', a.points[midIdx].x);
      numText.setAttribute('y', a.points[midIdx].y);
      numText.setAttribute('text-anchor', 'middle');
      numText.setAttribute('dominant-baseline', 'central');
      numText.setAttribute('font-size', '2');
      numText.setAttribute('font-weight', '700');
      numText.setAttribute('fill', '#fff');
      numText.textContent = graphicNum;
      svg.appendChild(numText);

      /* Кликабельная зона (толстая невидимая линия) */
      var hitPath = document.createElementNS(svgNS, 'path');
      hitPath.setAttribute('d', d);
      hitPath.setAttribute('fill', 'none');
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '3');
      hitPath.setAttribute('class', 'rt-line-hit');
      hitPath.style.pointerEvents = 'stroke';
      hitPath.style.cursor = 'pointer';
      (function(annot, idx) {
        hitPath.addEventListener('click', function(ev) {
          ev.stopPropagation();
          rtShowAnnotPopup(photoName, annot, idx, imgWrap);
        });
      })(a, i);
      svg.appendChild(hitPath);

      continue;
    }

    /* ── Эллипс ── */
    if (!a.hasCircle && a.x === undefined) continue;
    if (a.shape === 'line') continue;
    graphicNum++;
    var typeInfo2 = RT_ANNOTATION_TYPES[a.type] || RT_ANNOTATION_TYPES.attention;
    var rx = a.rx || a.r || 5;
    var ry = a.ry || a.r || 5;

    var ellipse = document.createElement('div');
    ellipse.className = 'rt-circle';
    ellipse.setAttribute('data-annot-id', a.id);
    ellipse.style.left = a.x + '%';
    ellipse.style.top = a.y + '%';
    ellipse.style.width = (rx * 2) + '%';
    ellipse.style.height = (ry * 2) + '%';
    ellipse.style.paddingBottom = '0';
    ellipse.style.background = typeInfo2.color;
    ellipse.style.borderColor = typeInfo2.border;

    /* Номер */
    var num = document.createElement('span');
    num.className = 'rt-circle-num';
    num.textContent = graphicNum;
    ellipse.appendChild(num);

    /* Перетаскивание эллипса (move) */
    (function(annot, idx, annotId, pName) {
      ellipse.addEventListener('mousedown', function(ev) {
        if (ev.target.classList.contains('rt-resize-handle')) return;
        ev.stopPropagation();
        _rtStartEditDrag('move', annotId, pName, ev);
      });
      /* Клик: попап (только если не было drag) */
      ellipse.addEventListener('click', function(ev) {
        if (_rtEditDrag) return;
        ev.stopPropagation();
        rtShowAnnotPopup(pName, annot, idx, imgWrap);
      });
    })(a, i, a.id, photoName);

    /* Ручки ресайза */
    var handleR = document.createElement('div');
    handleR.className = 'rt-resize-handle rt-h-right';
    (function(annotId, pName) {
      handleR.addEventListener('mousedown', function(ev) {
        ev.stopPropagation();
        _rtStartEditDrag('resizeR', annotId, pName, ev);
      });
    })(a.id, photoName);
    ellipse.appendChild(handleR);

    var handleB = document.createElement('div');
    handleB.className = 'rt-resize-handle rt-h-bottom';
    (function(annotId, pName) {
      handleB.addEventListener('mousedown', function(ev) {
        ev.stopPropagation();
        _rtStartEditDrag('resizeB', annotId, pName, ev);
      });
    })(a.id, photoName);
    ellipse.appendChild(handleB);

    layer.appendChild(ellipse);
  }

  /* Добавить SVG если есть линии */
  if (hasSvgContent) {
    layer.appendChild(svg);
  }

  imgWrap.appendChild(layer);
}

/**
 * Выровнять слой аннотаций точно по картинке внутри imgWrap.
 * Решает проблему: imgWrap может быть больше img.
 */
function _rtAlignLayer(layer, imgWrap) {
  var img = imgWrap.querySelector('img');
  if (!img || !img.complete || img.naturalWidth === 0) {
    /* Картинка ещё не загружена — выровняем после загрузки */
    if (img) {
      img.addEventListener('load', function() {
        _rtAlignLayerNow(layer, imgWrap);
      }, { once: true });
    }
    return;
  }
  _rtAlignLayerNow(layer, imgWrap);
}

function _rtAlignLayerNow(layer, imgWrap) {
  var img = imgWrap.querySelector('img');
  if (!img) return;
  var wRect = imgWrap.getBoundingClientRect();
  var iRect = img.getBoundingClientRect();
  layer.style.left = (iRect.left - wRect.left) + 'px';
  layer.style.top = (iRect.top - wRect.top) + 'px';
  layer.style.width = iRect.width + 'px';
  layer.style.height = iRect.height + 'px';
}

/**
 * Обновить список комментариев в тулбаре лайтбокса.
 * @param {string} photoName
 * @param {HTMLElement} imgWrap
 */
function rtRenderCmtList(photoName, imgWrap) {
  var listEl = document.getElementById('rt-cmt-list');
  if (!listEl) return;

  var annots = rtGetAnnotations(photoName);
  if (annots.length === 0) {
    listEl.innerHTML = '<div class="rt-cmt-empty">Нет комментариев</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < annots.length; i++) {
    var a = annots[i];
    var typeInfo = RT_ANNOTATION_TYPES[a.type] || RT_ANNOTATION_TYPES.attention;
    var hasGraphic = a.hasCircle || a.shape === 'line';
    var shapeLabel = a.shape === 'line' ? '~' : '';
    var icon = hasGraphic ? '<span class="rt-cmt-icon" style="background:' + typeInfo.border + '">' + shapeLabel + '</span>' : '';
    var preview = a.text ? a.text.substring(0, 60) : (hasGraphic ? typeInfo.label : 'Пустой');
    html += '<div class="rt-cmt-item" data-annot-id="' + a.id + '" onclick="rtCmtItemClick(\'' + esc(photoName) + '\',\'' + a.id + '\')">';
    html += icon;
    html += '<span class="rt-cmt-preview">' + esc(preview) + '</span>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  /* Обновить счётчик на кнопке */
  var btn = document.getElementById('rt-annot-toggle');
  if (btn) btn.textContent = 'Комментарии (' + annots.length + ')';
}

/**
 * Клик по элементу списка комментариев — открыть попап.
 */
function rtCmtItemClick(photoName, annotId) {
  var annots = rtGetAnnotations(photoName);
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  for (var i = 0; i < annots.length; i++) {
    if (annots[i].id === annotId) {
      rtShowAnnotPopup(photoName, annots[i], i, imgWrap);
      return;
    }
  }
}

/**
 * Переключить видимость тулбара комментариев.
 */
function rtToggleCmtBar(photoName, imgWrap) {
  var bar = document.getElementById('rt-cmt-bar');
  if (!bar) return;
  var isHidden = bar.style.display === 'none';
  bar.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    rtRenderCmtList(photoName, imgWrap);
  } else {
    /* Закрытие тулбара — выключить режим рисования */
    _rtAnnotMode = false;
    var circleBtn = document.getElementById('rt-circle-mode-btn');
    if (circleBtn) circleBtn.classList.remove('rt-mode-active');
    var iw = document.querySelector('.pv-lb-img-wrap');
    if (iw) iw.classList.remove('rt-annot-mode');
  }
}

/**
 * Показать попап для создания/редактирования аннотации.
 * @param {string} photoName
 * @param {Object|null} annot — существующая аннотация или null для новой
 * @param {number} idx — индекс (для заголовка)
 * @param {HTMLElement} imgWrap — контейнер для позиционирования
 * @param {Object} [newPos] — {x, y} для новой аннотации
 */
/**
 * Показать попап для создания/редактирования комментария.
 * @param {string} photoName
 * @param {Object|null} annot — существующий комментарий или null для нового
 * @param {number} idx — индекс (для заголовка)
 * @param {HTMLElement} imgWrap — контейнер изображения
 * @param {Object} [newPos] — {x, y} для нового кружка, null для текстового комментария
 */
function rtShowAnnotPopup(photoName, annot, idx, imgWrap, newPos) {
  /* Удалить старый попап */
  var oldPopup = document.querySelector('.rt-popup');
  if (oldPopup) oldPopup.remove();

  var isNew = !annot;
  var isLine = isNew ? (newPos && newPos.shape === 'line') : (annot && annot.shape === 'line');
  var hasCircle = isNew ? (!!newPos && !isLine) : (annot.hasCircle || (annot.x !== undefined && !isLine));
  var hasGraphic = hasCircle || isLine;
  var currentType = annot ? annot.type : 'attention';
  var currentText = annot ? annot.text : '';
  var currentTags = annot ? (annot.tags || []) : [];

  var popup = document.createElement('div');
  popup.className = 'rt-popup';

  var headerText = isNew
    ? (isLine ? 'Линия + текст' : (hasCircle ? 'Кружок + текст' : 'Текстовый комментарий'))
    : 'Комментарий #' + (idx + 1);
  var html = '<div class="rt-popup-header">';
  html += headerText;
  html += '<button class="rt-popup-close" onclick="this.closest(\'.rt-popup\').remove()">&times;</button>';
  html += '</div>';

  /* Тип (показывать для кружков и линий) */
  if (hasGraphic) {
    html += '<div class="rt-popup-types">';
    for (var tid in RT_ANNOTATION_TYPES) {
      if (!RT_ANNOTATION_TYPES.hasOwnProperty(tid)) continue;
      var t = RT_ANNOTATION_TYPES[tid];
      var sel = (tid === currentType) ? ' rt-type-active' : '';
      html += '<button class="rt-type-btn' + sel + '" data-type="' + tid + '" style="border-color:' + t.border + '" onclick="rtPopupSetType(this,\'' + tid + '\')">' + t.label + '</button>';
    }
    html += '</div>';
  }

  /* Теги */
  html += '<div class="rt-popup-tags">';
  for (var ti = 0; ti < RT_QUICK_TAGS.length; ti++) {
    var tag = RT_QUICK_TAGS[ti];
    var tagActive = (currentTags.indexOf(tag) >= 0) ? ' rt-tag-active' : '';
    html += '<button class="rt-tag-btn' + tagActive + '" data-tag="' + esc(tag) + '" onclick="rtPopupToggleTag(this)">' + esc(tag) + '</button>';
  }
  html += '</div>';

  /* Текст */
  html += '<textarea class="rt-popup-text" id="rt-popup-text" placeholder="Комментарий...">' + esc(currentText) + '</textarea>';

  /* Кнопки */
  html += '<div class="rt-popup-actions">';
  if (!isNew) {
    html += '<button class="rt-popup-del" onclick="rtPopupDelete(\'' + esc(photoName) + '\',\'' + annot.id + '\')">Удалить</button>';
  }
  if (isNew) {
    html += '<button class="rt-popup-save" onclick="rtPopupSave(\'' + esc(photoName) + '\',null)">Добавить</button>';
  } else {
    html += '<button class="rt-popup-save" onclick="rtPopupSave(\'' + esc(photoName) + '\',\'' + annot.id + '\')">Сохранить</button>';
  }
  html += '</div>';

  popup.innerHTML = html;

  /* Сохраняем данные позиции/линии на DOM-элементе (не в onclick-строке) */
  if (isNew && newPos) {
    popup._rtNewPos = newPos;
  }

  document.body.appendChild(popup);

  /* Фокус на текст */
  var ta = document.getElementById('rt-popup-text');
  if (ta) setTimeout(function() { ta.focus(); }, 100);
}

/** Переключить тип в попапе */
function rtPopupSetType(btn, type) {
  var types = btn.parentElement.querySelectorAll('.rt-type-btn');
  for (var i = 0; i < types.length; i++) types[i].classList.remove('rt-type-active');
  btn.classList.add('rt-type-active');
}

/** Переключить тег в попапе */
function rtPopupToggleTag(btn) {
  btn.classList.toggle('rt-tag-active');
}

/** Сохранить комментарий из попапа */
function rtPopupSave(photoName, annotId) {
  var popup = document.querySelector('.rt-popup');
  if (!popup) return;

  var type = 'attention';
  var activeType = popup.querySelector('.rt-type-active');
  if (activeType) type = activeType.getAttribute('data-type');

  var text = '';
  var ta = popup.querySelector('.rt-popup-text');
  if (ta) text = ta.value.trim();

  var tags = [];
  var activeTags = popup.querySelectorAll('.rt-tag-active');
  for (var i = 0; i < activeTags.length; i++) {
    tags.push(activeTags[i].getAttribute('data-tag'));
  }

  if (annotId) {
    /* Обновить существующий */
    rtUpdateAnnotation(photoName, annotId, { type: type, text: text, tags: tags });
  } else {
    /* Создать новый */
    var annData = { type: type, text: text, tags: tags };
    var newPos = popup._rtNewPos || null;
    if (newPos && newPos.shape === 'line' && newPos.points) {
      /* Линия */
      annData.shape = 'line';
      annData.points = newPos.points;
      /* x,y = центр bounding box (для позиционирования номера) */
      var bx = 0, by = 0;
      for (var pi = 0; pi < newPos.points.length; pi++) {
        bx += newPos.points[pi].x;
        by += newPos.points[pi].y;
      }
      annData.x = Math.round((bx / newPos.points.length) * 10) / 10;
      annData.y = Math.round((by / newPos.points.length) * 10) / 10;
    } else if (newPos && newPos.x !== undefined && newPos.y !== undefined) {
      /* Эллипс */
      annData.x = newPos.x;
      annData.y = newPos.y;
      annData.rx = newPos.rx || newPos.r || 5;
      annData.ry = newPos.ry || newPos.r || 5;
    }
    rtAddAnnotation(photoName, annData);
  }

  popup.remove();

  /* Перерисовать кружки на фото */
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (imgWrap) {
    var pv = _pvLbList[_pvLbIdx];
    if (pv) rtRenderAnnotations(pv.name, imgWrap);
  }
  /* Обновить список комментариев в тулбаре */
  rtRenderCmtList(photoName, imgWrap);
}

/** Удалить комментарий из попапа */
function rtPopupDelete(photoName, annotId) {
  rtRemoveAnnotation(photoName, annotId);
  var popup = document.querySelector('.rt-popup');
  if (popup) popup.remove();

  /* Перерисовать кружки */
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (imgWrap) {
    var pv = _pvLbList[_pvLbIdx];
    if (pv) rtRenderAnnotations(pv.name, imgWrap);
  }
  /* Обновить список */
  rtRenderCmtList(photoName, imgWrap);
}

// ── Режим аннотирования в лайтбоксе ──

/**
 * Включить/выключить режим аннотирования кружком.
 * В этом режиме mousedown+drag = рисование кружка с размером.
 */
function rtToggleAnnotMode() {
  if (_rtAnnotMode === 'circle') {
    _rtAnnotMode = false;
  } else {
    _rtAnnotMode = 'circle';
    _rtLinePoints = [];
    _rtRemoveLinePreview();
  }
  _rtUpdateModeButtons();
}

/**
 * Включить/выключить режим рисования линии.
 * Клики ставят точки, двойной клик завершает.
 */
function rtToggleLineMode() {
  if (_rtAnnotMode === 'line') {
    /* Если есть точки — завершить линию */
    if (_rtLinePoints.length >= 2) {
      _rtFinishLine();
    } else {
      _rtAnnotMode = false;
      _rtLinePoints = [];
      _rtRemoveLinePreview();
    }
  } else {
    _rtAnnotMode = 'line';
    _rtLinePoints = [];
    _rtRemoveLinePreview();
  }
  _rtUpdateModeButtons();
}

/**
 * Обновить внешний вид кнопок режимов в тулбаре.
 */
function _rtUpdateModeButtons() {
  var circleBtn = document.getElementById('rt-circle-mode-btn');
  if (circleBtn) {
    circleBtn.classList.toggle('rt-mode-active', _rtAnnotMode === 'circle');
    circleBtn.textContent = _rtAnnotMode === 'circle' ? 'Готово' : '+ Кружок';
  }
  var lineBtn = document.getElementById('rt-line-mode-btn');
  if (lineBtn) {
    lineBtn.classList.toggle('rt-mode-active', _rtAnnotMode === 'line');
    lineBtn.textContent = _rtAnnotMode === 'line'
      ? (_rtLinePoints.length >= 2 ? 'Завершить' : 'Готово')
      : '+ Линия';
  }
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (imgWrap) {
    imgWrap.classList.toggle('rt-annot-mode', !!_rtAnnotMode);
  }
}

/**
 * Координаты клика → проценты от изображения.
 * Использует слой аннотаций (или img) для точного позиционирования.
 * @returns {{x: number, y: number, rect: DOMRect, imgW: number, imgH: number}} | null
 */
function _rtEventToPercent(ev, imgWrap) {
  /* Используем слой аннотаций если есть (он выровнен по img) */
  var layer = imgWrap.querySelector('.rt-annot-layer');
  var img = imgWrap.querySelector('img');
  if (!img) return null;
  var ref = layer || img;
  var rect = ref.getBoundingClientRect();
  /* Если слоя нет — берём img rect */
  if (!layer) rect = img.getBoundingClientRect();
  var x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
  var y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    rect: rect,
    imgW: rect.width,
    imgH: rect.height
  };
}

/* ── Эллипс: mousedown + drag (задаёт rx/ry отдельно) ── */

/**
 * Начало рисования эллипса: mousedown.
 * Центр = точка клика, тянешь мышь → rx/ry по dx/dy.
 */
function rtOnMouseDown(ev) {
  if (_rtAnnotMode !== 'circle') return;
  if (ev.button !== 0) return;

  var imgWrap = ev.currentTarget;
  var pos = _rtEventToPercent(ev, imgWrap);
  if (!pos) return;

  ev.preventDefault();
  _rtDragState = {
    startX: pos.x, startY: pos.y,
    rect: pos.rect, imgWrap: imgWrap
  };

  _rtShowEllipsePreview(imgWrap, pos.x, pos.y, 0, 0);

  document.addEventListener('mousemove', _rtOnDragMove);
  document.addEventListener('mouseup', _rtOnDragEnd);
}

function _rtOnDragMove(ev) {
  if (!_rtDragState) return;
  var rect = _rtDragState.rect;
  var curX = ((ev.clientX - rect.left) / rect.width) * 100;
  var curY = ((ev.clientY - rect.top) / rect.height) * 100;
  var rx = Math.abs(curX - _rtDragState.startX);
  var ry = Math.abs(curY - _rtDragState.startY);
  rx = Math.max(1, Math.min(50, rx));
  ry = Math.max(1, Math.min(50, ry));
  _rtShowEllipsePreview(_rtDragState.imgWrap, _rtDragState.startX, _rtDragState.startY, rx, ry);
}

function _rtOnDragEnd(ev) {
  document.removeEventListener('mousemove', _rtOnDragMove);
  document.removeEventListener('mouseup', _rtOnDragEnd);
  if (!_rtDragState) return;

  var rect = _rtDragState.rect;
  var curX = ((ev.clientX - rect.left) / rect.width) * 100;
  var curY = ((ev.clientY - rect.top) / rect.height) * 100;
  var rx = Math.abs(curX - _rtDragState.startX);
  var ry = Math.abs(curY - _rtDragState.startY);
  rx = Math.max(2, Math.min(50, rx));
  ry = Math.max(2, Math.min(50, ry));
  rx = Math.round(rx * 10) / 10;
  ry = Math.round(ry * 10) / 10;

  var state = _rtDragState;
  _rtDragState = null;
  _rtRemoveEllipsePreview(state.imgWrap);

  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;

  rtShowAnnotPopup(pv.name, null, rtAnnotCount(pv.name), state.imgWrap,
    { x: state.startX, y: state.startY, rx: rx, ry: ry });
}

/** Превью эллипса при рисовании */
function _rtShowEllipsePreview(imgWrap, cx, cy, rx, ry) {
  var layer = imgWrap.querySelector('.rt-annot-layer');
  if (!layer) return;
  var el = layer.querySelector('.rt-circle-preview');
  if (!el) {
    el = document.createElement('div');
    el.className = 'rt-circle-preview';
    layer.appendChild(el);
  }
  el.style.left = cx + '%';
  el.style.top = cy + '%';
  el.style.width = (rx * 2) + '%';
  el.style.height = (ry * 2) + '%';
  el.style.paddingBottom = '0';
  el.style.display = 'block';
}

function _rtRemoveEllipsePreview(imgWrap) {
  if (!imgWrap) imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (!imgWrap) return;
  var el = imgWrap ? imgWrap.querySelector('.rt-circle-preview') : null;
  if (el) el.remove();
}

/* ── Перетаскивание/ресайз существующего эллипса ── */

function _rtStartEditDrag(mode, annotId, photoName, ev) {
  ev.stopPropagation();
  ev.preventDefault();
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (!imgWrap) return;
  var annots = rtGetAnnotations(photoName);
  var annot = null;
  for (var i = 0; i < annots.length; i++) {
    if (annots[i].id === annotId) { annot = annots[i]; break; }
  }
  if (!annot) return;

  _rtEditDrag = {
    mode: mode, annotId: annotId, photoName: photoName,
    imgWrap: imgWrap,
    startClientX: ev.clientX, startClientY: ev.clientY,
    origX: annot.x, origY: annot.y,
    origRx: annot.rx || annot.r || 5,
    origRy: annot.ry || annot.r || 5
  };
  document.addEventListener('mousemove', _rtOnEditMove);
  document.addEventListener('mouseup', _rtOnEditEnd);
}

function _rtOnEditMove(ev) {
  if (!_rtEditDrag) return;
  var d = _rtEditDrag;
  var layer = d.imgWrap.querySelector('.rt-annot-layer');
  if (!layer) return;
  var rect = layer.getBoundingClientRect();
  var dxPct = ((ev.clientX - d.startClientX) / rect.width) * 100;
  var dyPct = ((ev.clientY - d.startClientY) / rect.height) * 100;

  var annots = rtGetAnnotations(d.photoName);
  var annot = null;
  for (var i = 0; i < annots.length; i++) {
    if (annots[i].id === d.annotId) { annot = annots[i]; break; }
  }
  if (!annot) return;

  if (d.mode === 'move') {
    annot.x = Math.max(0, Math.min(100, _rtR(d.origX + dxPct)));
    annot.y = Math.max(0, Math.min(100, _rtR(d.origY + dyPct)));
  } else if (d.mode === 'resizeR') {
    annot.rx = Math.max(2, Math.min(50, _rtR(d.origRx + dxPct)));
  } else if (d.mode === 'resizeB') {
    annot.ry = Math.max(2, Math.min(50, _rtR(d.origRy + dyPct)));
  }

  rtRenderAnnotations(d.photoName, d.imgWrap);
}

function _rtOnEditEnd(ev) {
  document.removeEventListener('mousemove', _rtOnEditMove);
  document.removeEventListener('mouseup', _rtOnEditEnd);
  if (_rtEditDrag) {
    if (typeof shAutoSave === 'function') shAutoSave();
    _rtEditDrag = null;
  }
}

/* ── Линия: клики ставят точки, двойной клик завершает ── */

/**
 * Обработчик клика по фото в режиме линии.
 */
function rtOnLineClick(ev) {
  if (_rtAnnotMode !== 'line') return;

  var imgWrap = ev.currentTarget;
  var pos = _rtEventToPercent(ev, imgWrap);
  if (!pos) return;

  ev.preventDefault();
  ev.stopPropagation();

  _rtLinePoints.push({ x: pos.x, y: pos.y });
  _rtRenderLinePreview(imgWrap);
  _rtUpdateModeButtons();
}

/**
 * Двойной клик — завершить линию.
 */
function rtOnLineDblClick(ev) {
  if (_rtAnnotMode !== 'line') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (_rtLinePoints.length >= 2) {
    _rtFinishLine();
  }
}

/**
 * Завершить линию: создать аннотацию.
 */
function _rtFinishLine() {
  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;
  var imgWrap = document.querySelector('.pv-lb-img-wrap');
  var points = _rtLinePoints.slice(); /* копия */
  _rtLinePoints = [];
  _rtAnnotMode = false;
  _rtRemoveLinePreview();
  _rtUpdateModeButtons();

  /* Показать попап для линии */
  rtShowAnnotPopup(pv.name, null, rtAnnotCount(pv.name), imgWrap,
    { shape: 'line', points: points });
}

/**
 * Построить SVG path из массива точек с авто-сглаживанием (Catmull-Rom → cubic Bezier).
 * @param {Array} points — [{x,y}] в % (0-100)
 * @returns {string} SVG path d-attribute (в координатах %)
 */
function _rtBuildSmoothPath(points) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) {
    return 'M ' + points[0].x + ' ' + points[0].y + ' L ' + points[1].x + ' ' + points[1].y;
  }

  /* Catmull-Rom сплайн → кубические Безье кривые */
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for (var i = 0; i < points.length - 1; i++) {
    var p0 = points[Math.max(0, i - 1)];
    var p1 = points[i];
    var p2 = points[Math.min(points.length - 1, i + 1)];
    var p3 = points[Math.min(points.length - 1, i + 2)];

    /* Контрольные точки (tension = 0.5 / коэффициент 6) */
    var cp1x = p1.x + (p2.x - p0.x) / 6;
    var cp1y = p1.y + (p2.y - p0.y) / 6;
    var cp2x = p2.x - (p3.x - p1.x) / 6;
    var cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ' C ' + _rtR(cp1x) + ' ' + _rtR(cp1y) + ', ' + _rtR(cp2x) + ' ' + _rtR(cp2y) + ', ' + _rtR(p2.x) + ' ' + _rtR(p2.y);
  }
  return d;
}

/** Округлить до 1 десятичного знака */
function _rtR(v) { return Math.round(v * 10) / 10; }

/**
 * Отрисовать превью линии при рисовании (SVG поверх фото).
 * Использует createElementNS для корректного SVG namespace.
 */
function _rtRenderLinePreview(imgWrap) {
  if (!imgWrap) imgWrap = document.querySelector('.pv-lb-img-wrap');
  if (!imgWrap) return;
  var svgNS = 'http://www.w3.org/2000/svg';

  /* Ищем в annot-layer чтобы позиция совпадала с img */
  var parent = imgWrap.querySelector('.rt-annot-layer') || imgWrap;

  var svg = parent.querySelector('.rt-line-preview-svg');
  if (!svg) {
    svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'rt-line-preview-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6';
    parent.appendChild(svg);
  }

  /* Очистить старое содержимое */
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  /* Точки */
  for (var i = 0; i < _rtLinePoints.length; i++) {
    var dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', _rtLinePoints[i].x);
    dot.setAttribute('cy', _rtLinePoints[i].y);
    dot.setAttribute('r', '0.8');
    dot.setAttribute('fill', '#48c');
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '0.3');
    svg.appendChild(dot);
  }
  /* Сглаженная кривая */
  if (_rtLinePoints.length >= 2) {
    var d = _rtBuildSmoothPath(_rtLinePoints);
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(50,130,220,0.7)');
    path.setAttribute('stroke-width', '0.5');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }
}

function _rtRemoveLinePreview() {
  var svgs = document.querySelectorAll('.rt-line-preview-svg');
  for (var i = 0; i < svgs.length; i++) svgs[i].remove();
}

/**
 * Обработчик клика по изображению — маршрутизатор для кружка и линии.
 * Заменяет старый rtOnImageClick.
 */
function rtOnImageClick(ev) {
  if (!_rtAnnotMode) return;

  /* Линия: обрабатывается через click (не mousedown) */
  if (_rtAnnotMode === 'line') {
    rtOnLineClick(ev);
    return;
  }
  /* Кружок обрабатывается через mousedown (rtOnMouseDown), не через click */
}
