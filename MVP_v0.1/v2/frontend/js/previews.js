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

var PV_THUMB_MAX = 300;     // макс. сторона (для browser-фолбэка)
var PV_THUMB_QUALITY = 0.7;
var PV_RENDER_BATCH = 60;

// Текущий фильтр по рейтингу (минимальный рейтинг): 0 = все
var PV_FILTER = { 'pv': 0, 'oc-pv': 0 };
// Текущий фильтр по папке: '' = все
var PV_FOLDER_FILTER = { 'pv': '', 'oc-pv': '' };

// ── Хелперы папок ──

function pvFolderName(folderPath) {
  // "/Users/user/Photos/BrandX_previews" → "BrandX_previews"
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
      proj.previews.push({
        name: incoming.name,
        path: incoming.path,
        thumb: incoming.thumb,
        rating: incoming.rating || 0,
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
        var scale = Math.min(PV_THUMB_MAX / w, PV_THUMB_MAX / h, 1);
        var tw = Math.round(w * scale), th = Math.round(h * scale);

        var canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        canvas.getContext('2d').drawImage(img, 0, 0, tw, th);
        var thumbUrl = canvas.toDataURL('image/jpeg', PV_THUMB_QUALITY);

        callback({ name: file.name, path: '', thumb: thumbUrl, rating: rating });
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

  var scrollParent = gallery.closest('.cp-previews');
  if (scrollParent && store.length > limit) pvBindLazyScroll(scrollParent, gallery);
}

function pvBuildHTML(store, used, from, to) {
  var html = '';
  for (var i = from; i < to; i++) {
    var pv = store[i];
    var inCard = used[pv.name] ? true : false;
    var rating = pv.rating || 0;
    html += '<div class="pv-thumb' + (inCard ? ' pv-in-card' : '') + '" draggable="true" data-pv-name="' + esc(pv.name) + '" data-pv-idx="' + i + '" title="' + esc(pv.name) + '">';
    html += '<img src="' + pv.thumb + '" loading="lazy">';
    if (inCard) html += '<span class="pv-check"></span>';
    html += '<button class="pv-remove" onclick="pvRemoveByName(\'' + esc(pv.name).replace(/'/g, "\\'") + '\',event)">&times;</button>';
    html += '<span class="pv-name">' + esc(pvShortName(pv.name)) + '</span>';
    html += '</div>';
  }
  return html;
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

      var payload = { name: pv.name, path: pv.path || '', thumb: pv.thumb };
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
      proj.otherContent.push({ name: pv.name, path: pv.path || '', thumb: pv.thumb });
      ocRenderField();
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

  var html = '';
  for (var i = 0; i < store.length; i++) {
    var item = store[i];
    html += '<div class="oc-item" title="' + esc(item.name) + '">';
    html += '<img src="' + item.thumb + '" loading="lazy">';
    html += '<button class="pv-remove" onclick="ocRemoveItem(' + i + ',event)">&times;</button>';
    html += '<span class="pv-name">' + esc(pvShortName(item.name)) + '</span>';
    html += '</div>';
  }
  gallery.innerHTML = html;
}

function ocRemoveItem(idx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var store = ocGetStore();
  if (idx >= 0 && idx < store.length) store.splice(idx, 1);
  ocRenderField();
}

function ocClearAll() {
  var proj = getActiveProject();
  if (!proj) return;
  if (!confirm('Очистить весь доп. контент?')) return;
  proj.otherContent = [];
  ocRenderField();
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
