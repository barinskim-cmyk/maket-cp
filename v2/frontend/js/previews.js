/* ══════════════════════════════════════════════
   previews.js — Единый пул превью + доп. контент

   Два режима загрузки:
     Desktop (pywebview): Python сканирует папку, Pillow генерирует миниатюры
     Browser (фолбэк):    FileReader + canvas на клиенте

   Модель данных превью: {name, path, thumb, rating, folders}
     name    — имя файла
     path    — путь к оригиналу (desktop) или "" (browser)
     thumb   — base64 миниатюра для отображения
     rating  — рейтинг 0–5 (0 = без рейтинга)
     folders — массив имён папок-источников (дедупликация по имени файла)

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
        store.put({
          name: pv.name,
          path: pv.path || '',
          thumb: pv.thumb || '',
          preview: pv.preview || '',
          rating: pv.rating || 0,
          orient: pv.orient || 'v',
          folders: pv.folders || []
        }, key);
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
  // "/Users/masha/Photos/EKONIKA_previews" → "EKONIKA_previews"
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

  // Индекс существующих превью по имени
  var existingMap = {};
  for (var k = 0; k < proj.previews.length; k++) {
    existingMap[proj.previews[k].name] = k;
  }

  var items = data.items || [];

  for (var i = 0; i < items.length; i++) {
    var incoming = items[i];
    if (existingMap.hasOwnProperty(incoming.name)) {
      // Дубликат: обновляем рейтинг + добавляем папку
      var idx = existingMap[incoming.name];
      var pv = proj.previews[idx];
      if (incoming.rating && incoming.rating > 0) {
        pv.rating = incoming.rating;
      }
      if (!pv.folders) pv.folders = [];
      if (folderLabel && pv.folders.indexOf(folderLabel) < 0) {
        pv.folders.push(folderLabel);
      }
    } else {
      /* orient: определяем по w/h из backend (desktop) */
      var pvOrient = (incoming.w && incoming.h && incoming.w > incoming.h) ? 'h' : 'v';
      proj.previews.push({
        name: incoming.name,
        path: incoming.path,
        thumb: incoming.thumb,
        preview: incoming.preview || '',
        rating: incoming.rating || 0,
        orient: pvOrient,
        folders: folderLabel ? [folderLabel] : []
      });
    }
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
      if (err) console.warn('Авто-синхронизация превью:', err);
      else console.log('Превью синхронизированы с облаком');
    });
  }

  /* Авто-фиксация этапа 0 ("Преотбор и превью") при завершении загрузки */
  pvAutoAdvancePreselect();
};

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
          if (err) console.warn('Авто-синхронизация превью:', err);
          else console.log('Превью синхронизированы с облаком');
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

        callback({
          name: file.name, path: '', thumb: thumbUrl,
          preview: previewUrl, rating: rating, orient: orient
        });
      };
      img.onerror = function() { callback(null); };
      img.src = ev.target.result;
    };
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

  if (allStore.length === 0) {
    gallery.innerHTML = '';
    if (toolbar) toolbar.style.display = 'none';
    if (filterEl) filterEl.style.display = 'none';
    if (folderFilterEl) folderFilterEl.style.display = 'none';
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

  // Фильтрация по рейтингу + папке
  var store = [];
  for (var i = 0; i < allStore.length; i++) {
    var pv = allStore[i];
    if (minRating > 0 && (pv.rating || 0) < minRating) continue;
    if (folderFilter && (!pv.folders || pv.folders.indexOf(folderFilter) < 0)) continue;
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
    html += '<div class="pv-thumb' + orientCls + (inCard ? ' pv-in-card' : '') + '" draggable="true" data-pv-name="' + esc(pv.name) + '" data-pv-idx="' + i + '" title="' + esc(pv.name) + '">';
    html += '<img src="' + pv.thumb + '" loading="lazy">';
    if (inCard) html += '<span class="pv-check"></span>';
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
  /* Удалить предыдущий если есть */
  pvCloseFullscreen();

  var pv = _pvLbList[_pvLbIdx];
  if (!pv) return;

  var src = pv.preview || pv.thumb || pv.dataUrl || '';
  if (!src) return;

  var proj = getActiveProject();
  var isInOC = _pvIsInOtherContent(pv.name);

  var overlay = document.createElement('div');
  overlay.className = 'cp-fullscreen-overlay';
  overlay.id = 'pv-lightbox';
  overlay.onclick = function(ev) { if (ev.target === overlay) pvCloseFullscreen(); };

  /* Картинка */
  var img = document.createElement('img');
  img.src = src;
  img.className = 'cp-fullscreen-img';

  /* Кнопка закрыть */
  var closeBtn = document.createElement('button');
  closeBtn.className = 'cp-fullscreen-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = pvCloseFullscreen;

  /* Имя файла + счётчик */
  var nameEl = document.createElement('div');
  nameEl.className = 'cp-fullscreen-name';
  nameEl.textContent = (_pvLbIdx + 1) + ' / ' + _pvLbList.length + '  —  ' + (pv.name || '');

  /* Стрелка влево */
  var prevBtn = document.createElement('button');
  prevBtn.className = 'pv-lb-arrow pv-lb-prev';
  prevBtn.innerHTML = '&#8249;';
  prevBtn.onclick = function(ev) { ev.stopPropagation(); _pvLbNav(-1); };

  /* Стрелка вправо */
  var nextBtn = document.createElement('button');
  nextBtn.className = 'pv-lb-arrow pv-lb-next';
  nextBtn.innerHTML = '&#8250;';
  nextBtn.onclick = function(ev) { ev.stopPropagation(); _pvLbNav(1); };

  /* Галочка «В доп. контент» */
  var inCardIdx = _pvIsInCard(pv.name);
  var isLocked = inCardIdx >= 0;
  var isChecked = isInOC || isLocked;

  var checkWrap = document.createElement('div');
  checkWrap.className = 'pv-lb-check-wrap';
  checkWrap.id = 'pv-lb-oc-wrap';

  /* Круглая галочка как pv-check */
  var circle = document.createElement('div');
  circle.className = 'pv-lb-circle' + (isChecked ? ' pv-lb-circle-on' : '');
  circle.id = 'pv-lb-oc-circle';

  var labelEl = document.createElement('span');
  if (isLocked) {
    /* Карточечное фото — кликабельно, убирает из карточки */
    labelEl.textContent = 'В карточке К' + (inCardIdx + 1);
    checkWrap.style.cursor = 'pointer';
    checkWrap.onclick = (function(photoName, cIdx) {
      return function() { _pvLbRemoveFromCard(photoName, cIdx); };
    })(pv.name, inCardIdx);
  } else if (isInOC) {
    labelEl.textContent = 'В доп. контенте';
    checkWrap.style.cursor = 'pointer';
    checkWrap.onclick = function() { _pvLbToggleOC(false); _pvLbOpen(); };
  } else {
    labelEl.textContent = 'Добавить в отбор';
    checkWrap.style.cursor = 'pointer';
    checkWrap.onclick = function() { _pvLbToggleOC(true); _pvLbOpen(); };
  }

  checkWrap.appendChild(circle);
  checkWrap.appendChild(labelEl);

  /* Фильтр по рейтингу внутри лайтбокса */
  var filterBar = document.createElement('div');
  filterBar.className = 'pv-lb-filter-bar';
  filterBar.id = 'pv-lb-filter-bar';

  var filterLabel = document.createElement('span');
  filterLabel.className = 'pv-lb-filter-label';
  filterLabel.textContent = 'Фильтр: ';
  filterBar.appendChild(filterLabel);

  for (var st = 1; st <= 5; st++) {
    var starBtn = document.createElement('button');
    starBtn.className = 'pv-filter-star pv-lb-filter-star' + (st <= _pvLbRatingFilter ? ' active' : '');
    starBtn.setAttribute('data-star', st);
    starBtn.innerHTML = '&#9733;';
    starBtn.onclick = (function(sv) {
      return function(ev) { ev.stopPropagation(); _pvLbSetFilter(sv); };
    })(st);
    filterBar.appendChild(starBtn);
  }

  var resetBtn = document.createElement('button');
  resetBtn.className = 'pv-lb-filter-reset' + (_pvLbRatingFilter === 0 ? ' active' : '');
  resetBtn.textContent = 'Все';
  resetBtn.onclick = function(ev) { ev.stopPropagation(); _pvLbSetFilter(0); };
  filterBar.appendChild(resetBtn);

  /* Показать текущий рейтинг фото */
  var pvRating = _pvGetRating(pv.name);
  if (pvRating > 0) {
    var ratingDisplay = document.createElement('span');
    ratingDisplay.className = 'pv-lb-rating-display';
    var starsStr = '';
    for (var rs = 0; rs < pvRating; rs++) starsStr += '\u2605';
    ratingDisplay.textContent = '  ' + starsStr;
    filterBar.appendChild(ratingDisplay);
  }

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(nameEl);
  overlay.appendChild(prevBtn);
  overlay.appendChild(nextBtn);
  overlay.appendChild(checkWrap);
  overlay.appendChild(filterBar);
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
  var proj = getActiveProject();
  if (!proj || !proj.cards) return;
  var card = proj.cards[cardIdx];
  if (!card || !card.slots) return;

  for (var s = 0; s < card.slots.length; s++) {
    if (card.slots[s].file === name) {
      card.slots[s].file = null;
      card.slots[s].dataUrl = '';
      card.slots[s].thumbUrl = '';
      card.slots[s].preview = '';
      break;
    }
  }

  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof cpRenderCard === 'function') cpRenderCard();
  if (typeof acRenderField === 'function') acRenderField();
  if (typeof ocRenderField === 'function') ocRenderField();
  _pvLbOpen();
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
    proj.otherContent.push({
      name: pv.name,
      path: pv.path || '',
      thumb: pv.thumb || '',
      preview: pv.preview || ''
    });
  } else {
    /* Убрать */
    for (var j = proj.otherContent.length - 1; j >= 0; j--) {
      if (proj.otherContent[j].name === pv.name) {
        proj.otherContent.splice(j, 1);
      }
    }
  }

  /* Сохранить + синхронизировать + обновить галереи */
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof ocRenderField === 'function') ocRenderField();
  if (typeof acRenderField === 'function') acRenderField();
}

/**
 * Проверить, есть ли фото в доп. контенте.
 */
function _pvIsInOtherContent(name) {
  var proj = getActiveProject();
  if (!proj || !proj.otherContent) return false;
  for (var i = 0; i < proj.otherContent.length; i++) {
    if (proj.otherContent[i].name === name) return true;
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
  /* Пробел = переключить галочку (все фото: карточки и OC) */
  if (e.key === ' ') {
    e.preventDefault();
    var pv = _pvLbList[_pvLbIdx];
    if (!pv) return;
    var cardIdx = _pvIsInCard(pv.name);
    if (cardIdx >= 0) {
      _pvLbRemoveFromCard(pv.name, cardIdx);
    } else {
      var isIn = _pvIsInOtherContent(pv.name);
      _pvLbToggleOC(!isIn);
      _pvLbOpen();
    }
  }
}

function pvCloseFullscreen() {
  var overlay = document.getElementById('pv-lightbox');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _pvLbKeyHandler);
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

      var payload = { name: pv.name, path: pv.path || '', thumb: pv.thumb, preview: pv.preview || '' };
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
  console.log('Авто-фиксация: Преотбор и превью завершён, переход на этап 1');
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
//  Доп. контент — свободное поле
// ══════════════════════════════════════════════

function ocInitField() {
  var field = document.getElementById('oc-field');
  if (!field || field._ocBound) return;
  field._ocBound = true;

  field.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    this.classList.add('oc-drag-over');
  });

  field.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.classList.remove('oc-drag-over');
  });

  field.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('oc-drag-over');

    var pvData = e.dataTransfer.getData('application/x-preview');
    if (!pvData) return;

    var proj = getActiveProject();
    if (!proj) return;
    if (!proj.otherContent) proj.otherContent = [];

    try {
      var pv = JSON.parse(pvData);
      for (var k = 0; k < proj.otherContent.length; k++) {
        if (proj.otherContent[k].name === pv.name) return;
      }
      proj.otherContent.push({ name: pv.name, path: pv.path || '', thumb: pv.thumb, preview: pv.preview || '' });
      ocRenderField();
      /* Авто-синхронизация доп. контента */
      if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
    } catch(err) {}
  });
}

function ocRenderField() {
  var gallery = document.getElementById('oc-gallery');
  var toolbar = document.getElementById('oc-toolbar');
  var countEl = document.getElementById('oc-count');
  var empty = document.getElementById('oc-field-empty');
  var store = ocGetStore();

  if (!gallery) return;

  if (store.length === 0) {
    gallery.innerHTML = '';
    if (toolbar) toolbar.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }

  if (toolbar) {
    toolbar.style.display = 'flex';
    countEl.textContent = store.length + ' фото';
  }
  if (empty) empty.style.display = 'none';

  var zoomSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  var html = '';
  for (var i = 0; i < store.length; i++) {
    var item = store[i];
    html += '<div class="oc-item" title="' + esc(item.name) + '">';
    html += '<img src="' + (item.preview || item.thumb) + '" loading="lazy">';
    html += '<button class="oc-zoom" onclick="ocOpenLightbox(' + i + ',event)" title="На весь экран">' + zoomSvg + '</button>';
    html += '<button class="pv-remove" onclick="ocRemoveItem(' + i + ',event)">&times;</button>';
    html += '<span class="pv-name">' + esc(pvShortName(item.name)) + '</span>';
    html += '</div>';
  }
  gallery.innerHTML = html;
}

/**
 * Открыть лайтбокс из допконтента.
 */
function ocOpenLightbox(idx, e) {
  if (e) e.stopPropagation();
  var store = ocGetStore();
  if (!store[idx]) return;
  var lbList = [];
  for (var i = 0; i < store.length; i++) {
    lbList.push({
      name: store[i].name,
      thumb: store[i].thumb || '',
      preview: store[i].preview || store[i].thumb || '',
      path: ''
    });
  }
  _pvLbList = lbList;
  _pvLbIdx = idx;
  _pvLbOpen();
}

function ocRemoveItem(idx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var store = ocGetStore();
  if (idx >= 0 && idx < store.length) store.splice(idx, 1);
  ocRenderField();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
}

function ocClearAll() {
  var proj = getActiveProject();
  if (!proj) return;
  if (!confirm('Очистить весь доп. контент?')) return;
  proj.otherContent = [];
  ocRenderField();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
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

  /* 2. Доп. контент */
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

  var zoomSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var isH = it.orient === 'h';
    var spanStyle = isH ? ' style="grid-column: span 2"' : '';

    html += '<div class="ac-tile' + (isH ? ' ac-tile-h' : '') + '"' + spanStyle + ' title="' + esc(it.name) + '">';
    html += '<img src="' + (it.preview || it.thumb) + '" loading="lazy">';

    if (it.source === 'card') {
      /* Фото из карточки — зелёная галочка, можно отжать (убрать из карточки) */
      html += '<button class="ac-check ac-check-on" onclick="acToggleCard(\'' + esc(it.name).replace(/'/g, "\\'") + '\',' + it.cardIdx + ',event)"></button>';
      html += '<span class="ac-check-label">К' + (it.cardIdx + 1) + '</span>';
    } else {
      /* Фото из допконтента — зелёная галочка, можно убрать */
      html += '<button class="ac-check ac-check-on" onclick="acRemoveOC(\'' + esc(it.name).replace(/'/g, "\\'") + '\',event)"></button>';
      html += '<span class="ac-check-label">Доп.</span>';
    }

    /* Кнопка zoom → открывает лайтбокс */
    html += '<button class="ac-zoom" onclick="acOpenLightbox(' + i + ',event)" title="На весь экран">' + zoomSvg + '</button>';
    html += '<span class="pv-name">' + esc(pvShortName(it.name)) + '</span>';
    html += '</div>';
  }
  gallery.innerHTML = html;

  /* Обновить звёздочный фильтр */
  acRenderFilterStars();
}

/**
 * Убрать фото из допконтента (из галереи «Весь контент»).
 * @param {string} name — имя файла
 * @param {Event} e
 */
function acRemoveOC(name, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var proj = getActiveProject();
  if (!proj || !proj.otherContent) return;

  for (var j = proj.otherContent.length - 1; j >= 0; j--) {
    if (proj.otherContent[j].name === name) {
      proj.otherContent.splice(j, 1);
    }
  }

  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  acRenderField();
  if (typeof ocRenderField === 'function') ocRenderField();
}

/**
 * Убрать фото из карточки (отжать галочку из галереи «Весь контент»).
 * Фото остаётся в превью, но освобождает слот.
 * @param {string} name — имя файла
 * @param {number} cardIdx — индекс карточки
 * @param {Event} e
 */
function acToggleCard(name, cardIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var proj = getActiveProject();
  if (!proj || !proj.cards) return;

  var card = proj.cards[cardIdx];
  if (!card || !card.slots) return;

  /* Найти и очистить слот с этим файлом */
  for (var s = 0; s < card.slots.length; s++) {
    if (card.slots[s].file === name) {
      card.slots[s].file = null;
      card.slots[s].dataUrl = '';
      card.slots[s].thumbUrl = '';
      card.slots[s].preview = '';
      break;
    }
  }

  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof cpRenderCard === 'function') cpRenderCard();
  acRenderField();
  if (typeof ocRenderField === 'function') ocRenderField();
}

/**
 * Изменить количество колонок в плитке «Весь контент».
 */
function acSetColumns(val) {
  _acColumns = parseInt(val) || 4;
  acRenderField();
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

  /* Собираем массив в формате совместимом с _pvLbList */
  var lbList = [];
  for (var i = 0; i < items.length; i++) {
    lbList.push({
      name: items[i].name,
      thumb: items[i].thumb || '',
      preview: items[i].preview || '',
      path: ''
    });
  }
  _pvLbList = lbList;
  _pvLbIdx = idx;
  _pvLbRatingFilter = _acRatingFilter;
  _pvLbOpen();
}

/**
 * Кнопка «Посмотреть все» — открывает лайтбокс с первого фото.
 * Если задан фильтр по рейтингу, покажет только отфильтрованные.
 */
function acViewAll() {
  acOpenLightbox(0, null);
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
  ocInitField();
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
