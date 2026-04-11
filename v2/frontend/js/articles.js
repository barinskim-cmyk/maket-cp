/* ══════════════════════════════════════════════
   articles.js — Артикулы: чек-лист, сопоставление, верификация

   Зависит от: state.js (App, getActiveProject, esc),
               previews.js (pvDbOpen, pvDbSavePreviews),
               shootings.js (renderProjects, _shProjKey, shAutoSave)

   Модель артикула (Article):
   {
     id:        string   — уникальный ключ (ar_<timestamp>_<rand>)
     sku:       string   — артикул (PL01056CN-13-black-26S)
     category:  string   — категория (shoes, bag, glasses, accessory)
     color:     string   — цвет (из SKU или пустая строка)
     refImage:  string   — base64 референс-фото из каталога
     status:    string   — unmatched | matched | verified
     cardIdx:   number   — индекс карточки (-1 = не привязан)
   }

   Префикс функций: ar*

   Порядок работы:
   1. Загрузить чек-лист (PDF → desktop, JSON → web)
   2. Сопоставить артикулы с карточками (drag или клик)
   3. Верифицировать (чек-лист с картинками)
   4. Rate Setter переименует файлы (sync.js)
   ══════════════════════════════════════════════ */


/* ──────────────────────────────────────────────
   Состояние модуля
   ────────────────────────────────────────────── */

/** @type {number|null} Индекс выбранного артикула для сопоставления */
var _arSelectedSku = null;

/** @type {number|null} Индекс выбранной карточки для сопоставления */
var _arSelectedCard = null;

/** @type {string} Кэшированный OpenAI API key (загружается при старте) */
var _arOpenAIKey = '';
var _arLastPdfPath = '';  /* путь к последнему загруженному PDF чек-листу */

/* Облачная синхронизация артикулов использует тот же механизм что карточки —
   shCloudSyncExplicit() из shootings.js. Отдельный таймер не нужен. */


/* ══════════════════════════════════════════════
   IndexedDB: хранение ref-изображений артикулов
   Отдельная БД, не зависит от maketcp_previews.
   refImage (base64) не помещается в localStorage —
   храним здесь, как превью фотографий.
   ══════════════════════════════════════════════ */

var AR_DB_NAME    = 'maketcp_articles';
var AR_DB_VERSION = 1;
var AR_DB_STORE   = 'ref_images';
var _arDb         = null;

/**
 * Открыть IndexedDB для ref-изображений артикулов.
 * @param {function} callback — callback(db) или callback(null) при ошибке
 */
function arDbOpen(callback) {
  if (_arDb) { callback(_arDb); return; }
  if (!window.indexedDB) { callback(null); return; }

  var req = indexedDB.open(AR_DB_NAME, AR_DB_VERSION);
  req.onupgradeneeded = function(e) {
    var db = e.target.result;
    if (!db.objectStoreNames.contains(AR_DB_STORE)) {
      /* Ключ: "projKey/artId" */
      db.createObjectStore(AR_DB_STORE);
    }
  };
  req.onsuccess = function(e) {
    _arDb = e.target.result;
    callback(_arDb);
  };
  req.onerror = function() {
    console.warn('arDbOpen: IndexedDB не доступен');
    callback(null);
  };
}

/**
 * Сохранить ref-изображения всех артикулов проекта в IndexedDB.
 * Сохраняет только артикулы у которых есть непустой refImage.
 * @param {object} proj — проект с articles[] и proj.brand/shoot_date
 */
function arDbSaveRefImages(proj) {
  if (!proj || !proj.articles || proj.articles.length === 0) return;
  var projKey = _arProjKey(proj);

  arDbOpen(function(db) {
    if (!db) return;
    try {
      var tx = db.transaction(AR_DB_STORE, 'readwrite');
      var store = tx.objectStore(AR_DB_STORE);
      var saved = 0;
      for (var i = 0; i < proj.articles.length; i++) {
        var art = proj.articles[i];
        if (!art.refImage || !art.id) continue;
        store.put({ id: art.id, refImage: art.refImage }, projKey + '/' + art.id);
        saved++;
      }
      if (saved > 0) console.log('arDbSaveRefImages: сохранено', saved, 'ref-изображений для', proj.brand);
    } catch(e) {
      console.warn('arDbSaveRefImages:', e);
    }
  });
}

/**
 * Восстановить ref-изображения артикулов из IndexedDB в proj.articles[].refImage.
 * Вызывается при открытии вкладки Артикулы.
 * @param {object}   proj     — проект
 * @param {function} [onDone] — опциональный callback()
 */
function arDbRestoreRefImages(proj, onDone) {
  if (!proj || !proj.articles || proj.articles.length === 0) {
    if (typeof onDone === 'function') onDone();
    return;
  }

  /* Проверить: нужно ли восстанавливать */
  var missing = 0;
  for (var i = 0; i < proj.articles.length; i++) {
    if (!proj.articles[i].refImage) missing++;
  }
  if (missing === 0) {
    if (typeof onDone === 'function') onDone();
    return;  /* Всё уже есть */
  }

  var projKey = _arProjKey(proj);

  arDbOpen(function(db) {
    if (!db) { if (typeof onDone === 'function') onDone(); return; }
    try {
      var tx = db.transaction(AR_DB_STORE, 'readonly');
      var store = tx.objectStore(AR_DB_STORE);

      /* Индекс артикулов по id для быстрого поиска */
      var byId = {};
      for (var j = 0; j < proj.articles.length; j++) {
        if (proj.articles[j].id) byId[proj.articles[j].id] = proj.articles[j];
      }

      var prefix = projKey + '/';
      var cursor = store.openCursor();
      var restored = 0;

      cursor.onsuccess = function(e) {
        var c = e.target.result;
        if (c) {
          if (typeof c.key === 'string' && c.key.indexOf(prefix) === 0) {
            var artId = c.key.slice(prefix.length);
            if (byId[artId] && !byId[artId].refImage && c.value && c.value.refImage) {
              byId[artId].refImage = c.value.refImage;
              restored++;
            }
          }
          c.continue();
        } else {
          if (restored > 0) {
            console.log('arDbRestoreRefImages: восстановлено', restored, 'ref-изображений из IndexedDB для', proj.brand);
            arRenderChecklist();
            arRenderMatching();
            arRenderVerification();
          }
          /* Фолбэк: попробовать скачать из Supabase Storage те что не нашлись в IndexedDB */
          _arRestoreRefImagesFromCloud(proj, onDone);
        }
      };
      cursor.onerror = function() {
        if (typeof onDone === 'function') onDone();
      };
    } catch(e) {
      console.warn('arDbRestoreRefImages:', e);
      if (typeof onDone === 'function') onDone();
    }
  });
}

/**
 * Ключ проекта для IndexedDB — тот же формат что в previews.js.
 * @param {object} proj
 * @returns {string}
 */
function _arProjKey(proj) {
  var k = (proj.brand || 'noname') + '_' + (proj.shoot_date || '');
  return k.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
}


/**
 * Загрузить ref-изображения артикулов в Supabase Storage.
 * Вызывается после импорта PDF если пользователь залогинен и проект в облаке.
 * Загружает только артикулы у которых есть refImage но нет _refImagePath (ещё не в облаке).
 * После успешной загрузки сохраняет URL в art._refImagePath и вызывает shAutoSave().
 *
 * Аналог sbUploadThumb() / sbUploadPreviews() для превью.
 *
 * @param {object} proj — проект с articles[] и _cloudId
 */
function arUploadRefImagesToCloud(proj) {
  if (!proj || !proj._cloudId) return;
  if (typeof sbUploadArticleRefImage !== 'function') return;
  if (typeof sbIsLoggedIn === 'function' && !sbIsLoggedIn()) return;

  var toUpload = [];
  for (var i = 0; i < (proj.articles || []).length; i++) {
    var art = proj.articles[i];
    if (art.refImage && !art._refImagePath && art.id) {
      toUpload.push(i);
    }
  }
  if (toUpload.length === 0) return;

  console.log('arUploadRefImagesToCloud: загружаю', toUpload.length, 'ref-изображений...');
  var uploaded = 0;

  function uploadNext(queueIdx) {
    if (queueIdx >= toUpload.length) {
      console.log('arUploadRefImagesToCloud: загружено', uploaded, 'из', toUpload.length);
      if (uploaded > 0 && typeof shAutoSave === 'function') shAutoSave();
      return;
    }
    var artIdx = toUpload[queueIdx];
    var art = proj.articles[artIdx];
    if (!art) { uploadNext(queueIdx + 1); return; }

    sbUploadArticleRefImage(proj._cloudId, art.id, art.refImage, function(err, publicUrl) {
      if (!err && publicUrl) {
        art._refImagePath = publicUrl;
        uploaded++;
      } else if (err) {
        console.warn('arUploadRefImagesToCloud: ошибка для', art.sku, ':', err);
      }
      /* Небольшая пауза чтобы не спамить Storage API */
      setTimeout(function() { uploadNext(queueIdx + 1); }, 200);
    });
  }

  uploadNext(0);
}


/**
 * Восстановить ref-изображения из Supabase Storage в proj.articles[].refImage.
 * Вызывается из arDbRestoreRefImages() как фолбэк если IndexedDB пустой.
 * После загрузки сохраняет в IndexedDB для кэширования.
 *
 * @param {object}   proj     — проект
 * @param {Function} [onDone] — callback()
 */
function _arRestoreRefImagesFromCloud(proj, onDone) {
  if (!proj || !proj._cloudId) {
    if (typeof onDone === 'function') onDone();
    return;
  }
  if (typeof sbDownloadArticleRefImage !== 'function') {
    if (typeof onDone === 'function') onDone();
    return;
  }

  /* Только артикулы с _refImagePath но без refImage */
  var toDownload = [];
  for (var i = 0; i < (proj.articles || []).length; i++) {
    var art = proj.articles[i];
    if (!art.refImage && art._refImagePath) {
      toDownload.push(i);
    }
  }
  if (toDownload.length === 0) {
    if (typeof onDone === 'function') onDone();
    return;
  }

  console.log('arRestoreRefImagesFromCloud: скачиваю', toDownload.length, 'ref-изображений...');
  var restored = 0;

  function downloadNext(queueIdx) {
    if (queueIdx >= toDownload.length) {
      if (restored > 0) {
        /* Сохранить в IndexedDB как кэш */
        arDbSaveRefImages(proj);
        arRenderChecklist();
        arRenderMatching();
        arRenderVerification();
        console.log('arRestoreRefImagesFromCloud: восстановлено', restored, 'изображений');
      }
      if (typeof onDone === 'function') onDone();
      return;
    }
    var artIdx = toDownload[queueIdx];
    var art = proj.articles[artIdx];
    if (!art || !art._refImagePath) { downloadNext(queueIdx + 1); return; }

    sbDownloadArticleRefImage(art._refImagePath, function(err, dataUrl) {
      if (!err && dataUrl) {
        art.refImage = dataUrl;
        restored++;
      }
      setTimeout(function() { downloadNext(queueIdx + 1); }, 100);
    });
  }

  downloadNext(0);
}


/* ──────────────────────────────────────────────
   Облачная синхронизация артикулов
   ────────────────────────────────────────────── */

/**
 * Запланировать облачную синхронизацию.
 * Использует тот же механизм что карточки (shCloudSyncExplicit из shootings.js):
 * - Единый дебаунс-таймер (3 сек)
 * - Флаг _shCloudSyncRunning предотвращает параллельные записи
 * - sbMarkPushDone() блокирует pull на SB_PULL_BLOCK_WINDOW (10 сек)
 * Фактическая запись sbSaveArticles() + sbSaveRenameLog() происходит
 * внутри _shDoCloudSync() в shootings.js.
 */
function arCloudSync() {
  if (typeof shCloudSyncExplicit === 'function') {
    shCloudSyncExplicit();
  }
}


/**
 * Загрузить артикулы из облака для текущего проекта.
 * Вызывается при открытии вкладки Артикулы если проект подключён к облаку
 * и локальный список пустой (первый открытый на этом устройстве).
 * @param {Function} [onDone] — опциональный callback(err)
 */
function arLoadFromCloud(onDone) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) {
    if (typeof onDone === 'function') onDone(null);
    return;
  }
  if (typeof sbLoadArticles !== 'function') {
    if (typeof onDone === 'function') onDone(null);
    return;
  }

  sbLoadArticles(proj, function(err, articles) {
    if (err) {
      console.warn('arLoadFromCloud error:', err);
      if (typeof onDone === 'function') onDone(err);
      return;
    }
    if (!articles || articles.length === 0) {
      if (typeof onDone === 'function') onDone(null);
      return;
    }

    /* Мерж: облачные данные приоритетнее если локальных нет, иначе обогащаем поле status */
    var localIsEmpty = (!proj.articles || proj.articles.length === 0);
    if (localIsEmpty) {
      proj.articles = articles;
      console.log('arLoadFromCloud: загружено', articles.length, 'артикулов из облака');
    } else {
      /* Обновить статусы из облака (не перезаписывать refImage — он хранится локально) */
      var cloudById = {};
      for (var i = 0; i < articles.length; i++) cloudById[articles[i].id] = articles[i];
      for (var j = 0; j < proj.articles.length; j++) {
        var local = proj.articles[j];
        var remote = cloudById[local.id];
        if (remote) {
          local.status  = remote.status;
          local.cardIdx = remote.cardIdx;
        }
      }
    }

    arRenderChecklist();
    arRenderMatching();
    arRenderVerification();
    arUpdateStats();
    if (typeof shAutoSave === 'function') shAutoSave();
    if (typeof onDone === 'function') onDone(null);
  });
}


/* ──────────────────────────────────────────────
   Инициализация
   ────────────────────────────────────────────── */

/**
 * Загрузить OpenAI API key из доступных источников (в порядке приоритета):
 * 1. Supabase app_config (для обновления из админки)
 * 2. Локальный config.json (для десктопа)
 * 3. localStorage (ручной ввод пользователя)
 *
 * Вызывается автоматически при загрузке модуля.
 */
function _arLoadOpenAIKey() {
  /* 1. Supabase: таблица app_config */
  if (typeof sbClient !== 'undefined' && sbClient) {
    sbClient.from('app_config').select('value').eq('key', 'openai_api_key').single()
      .then(function(resp) {
        if (resp.data && resp.data.value) {
          _arOpenAIKey = resp.data.value;
          console.log('articles.js: OpenAI key loaded from Supabase');
          return;
        }
        /* Supabase не дал — пробуем config.json */
        _arLoadKeyFromConfig();
      })
      .catch(function() {
        _arLoadKeyFromConfig();
      });
    return;
  }

  /* Нет Supabase — пробуем config.json */
  _arLoadKeyFromConfig();
}


/**
 * Загрузить ключ из config.json (фолбэк после Supabase).
 * Desktop: через бэкенд-метод get_config_value (надёжные абсолютные пути).
 * Browser: через fetch config.json.
 */
function _arLoadKeyFromConfig() {
  /* Desktop: через Python бэкенд — один вызов, бэкенд сам ищет файл */
  if (window.pywebview && window.pywebview.api && window.pywebview.api.get_config_value) {
    window.pywebview.api.get_config_value('openai_api_key').then(function(val) {
      if (val) {
        _arOpenAIKey = val;
        console.log('articles.js: OpenAI key loaded from config.json (via backend)');
      } else {
        _arOpenAIKey = localStorage.getItem('openai_api_key') || '';
        if (_arOpenAIKey) console.log('articles.js: OpenAI key loaded from localStorage');
        else console.log('articles.js: OpenAI key NOT found');
      }
    }).catch(function(e) {
      console.log('articles.js: get_config_value error:', e);
      _arOpenAIKey = localStorage.getItem('openai_api_key') || '';
    });
    return;
  }

  /* Browser: fetch config.json */
  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'config.json', true);
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var cfg = JSON.parse(xhr.responseText);
        if (cfg.openai_api_key) {
          _arOpenAIKey = cfg.openai_api_key;
          console.log('articles.js: OpenAI key loaded from config.json (browser)');
          return;
        }
      } catch(e) {}
    }
    _arOpenAIKey = localStorage.getItem('openai_api_key') || '';
    if (_arOpenAIKey) console.log('articles.js: OpenAI key loaded from localStorage');
  };
  xhr.onerror = function() {
    _arOpenAIKey = localStorage.getItem('openai_api_key') || '';
  };
  xhr.send();
}

/* Запуск загрузки ключа при загрузке скрипта */
_arLoadOpenAIKey();


/**
 * Сохранить текущий проект в JSON-файл на диске (через pywebview диалог).
 * Работает на десктопе (pywebview). В браузере — скачивание через Blob.
 */
function arSaveProjectToFile() {
  var proj = getActiveProject();
  if (!proj) { alert('Нет активного проекта'); return; }

  /* Подготовить данные: полный проект включая артикулы */
  var data = JSON.parse(JSON.stringify(proj));
  /* Убрать тяжёлые base64 данные для уменьшения файла */
  if (data.previews) {
    for (var pi = 0; pi < data.previews.length; pi++) {
      delete data.previews[pi].preview;
    }
  }
  /* Убрать тяжёлые refImage из артикулов (base64 каталожные фото) */
  if (data.articles) {
    for (var ai = 0; ai < data.articles.length; ai++) {
      delete data.articles[ai].refImage;
    }
  }
  var json = JSON.stringify(data, null, 2);
  var filename = (proj.brand || 'project') + '_' + (proj.shoot_date || 'nodate') + '.json';

  /* Desktop: используем pywebview save_text_to_file() */
  if (window.pywebview && window.pywebview.api && window.pywebview.api.save_text_to_file) {
    window.pywebview.api.save_text_to_file(json, filename).then(function(resp) {
      if (resp && resp.ok) {
        alert('Проект сохранён: ' + resp.path);
      } else if (resp && resp.error) {
        alert('Ошибка: ' + resp.error);
      }
      /* cancelled — пользователь закрыл диалог */
    });
    return;
  }

  /* Browser fallback: скачать JSON через Blob */
  var data = JSON.parse(JSON.stringify(proj));
  /* Убрать тяжёлые base64 данные для уменьшения файла */
  if (data.previews) {
    for (var i = 0; i < data.previews.length; i++) {
      delete data.previews[i].preview;
    }
  }
  var json = JSON.stringify(data, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (proj.brand || 'project') + '_' + (proj.shoot_date || 'nodate') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/**
 * Получить текущий OpenAI API key.
 * Используется всеми AI-функциями.
 */
function _arGetOpenAIKey() {
  return _arOpenAIKey || localStorage.getItem('openai_api_key') || '';
}


/**
 * Вызывается при показе вкладки «Артикулы» (из nav.js → showPage).
 * Проверяет наличие активного проекта и рисует UI.
 */
function arOnPageShow() {
  var proj = getActiveProject();
  var noProj = document.getElementById('ar-no-project');
  var main = document.getElementById('ar-main');
  if (!proj) {
    if (noProj) noProj.style.display = '';
    if (main) main.style.display = 'none';
    return;
  }
  if (noProj) noProj.style.display = 'none';
  if (main) main.style.display = '';

  /* Инициализировать articles массив если нет */
  if (!proj.articles) proj.articles = [];

  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();

  /* Восстановить ref-изображения из IndexedDB (они не хранятся в localStorage) */
  arDbRestoreRefImages(proj, function() {
    /* После восстановления refImages — подтянуть статусы из облака если нужно */
    if (proj._cloudId && (!proj.articles || proj.articles.length === 0)) {
      arLoadFromCloud(function(err) {
        if (err) console.warn('arOnPageShow: cloud load failed:', err);
      });
    }
  });
}


/* ──────────────────────────────────────────────
   Блок 1: Чек-лист артикулов
   ────────────────────────────────────────────── */

/**
 * Отрисовать чек-лист артикулов.
 * Каждый артикул: статус-индикатор + SKU + категория + ref-картинка.
 */
function arRenderChecklist() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;
  var el = document.getElementById('ar-checklist');
  if (!el) return;

  if (proj.articles.length === 0) {
    el.innerHTML = '<div class="empty-state">Артикулы не загружены. Нажмите "Загрузить чек-лист" для загрузки из файла (JSON, CSV, TXT).</div>';
    return;
  }

  var html = '<table class="ar-table"><thead><tr>'
    + '<th>#</th><th></th><th>Фото</th><th>Артикул</th><th>Категория</th><th>Цвет</th><th>Карточка</th><th></th>'
    + '</tr></thead><tbody>';

  for (var i = 0; i < proj.articles.length; i++) {
    var art = proj.articles[i];
    var statusCls = 'ar-status-' + (art.status || 'unmatched');
    var statusText = art.status === 'verified' ? 'OK' : (art.status === 'matched' ? '~' : '--');
    var cardLabel = (art.cardIdx >= 0 && proj.cards && proj.cards[art.cardIdx])
      ? 'Карточка ' + (art.cardIdx + 1)
      : '--';

    html += '<tr class="ar-row ' + statusCls + '" data-idx="' + i + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td><span class="ar-status-dot ' + statusCls + '">' + statusText + '</span></td>';
    /* Референс-фото из каталога (если есть) */
    html += '<td class="ar-ref-cell">';
    if (art.refImage) {
      html += '<img class="ar-ref-thumb" src="' + art.refImage + '" alt="ref" onclick="arShowRefImage(' + i + ')">';
    } else {
      html += '<span class="ar-ref-empty">--</span>';
    }
    html += '</td>';
    html += '<td class="ar-sku">' + esc(art.sku) + '</td>';
    html += '<td>' + esc(art.category || '') + '</td>';
    html += '<td>' + esc(art.color || '') + '</td>';
    html += '<td>' + cardLabel + '</td>';
    html += '<td class="ar-row-actions"><button onclick="arDeleteArticle(' + i + ')" title="Удалить">x</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';

  /* Кнопка очистки внизу */
  html += '<div style="margin-top:8px;text-align:right">'
    + '<button class="btn btn-sm" onclick="arClearAll()" style="color:#e57373;border-color:#e57373">Очистить все артикулы</button>'
    + '</div>';

  el.innerHTML = html;
}


/**
 * Показать все фото карточки крупно (полуэкранный оверлей).
 * Клик по карточке в панели сопоставления — увеличенный просмотр.
 */
function arPreviewCard(cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card.slots || card.slots.length === 0) return;

  /* Построить карту превью */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  /* Собрать все фото слотов */
  var images = [];
  for (var si = 0; si < card.slots.length; si++) {
    var slot = card.slots[si];
    var imgSrc = slot.dataUrl || slot.thumbUrl || '';
    if (!imgSrc && slot.file && pvByName[slot.file]) {
      var pv = pvByName[slot.file];
      imgSrc = pv.preview || pv.thumb || '';
    }
    if (imgSrc) {
      images.push({ src: imgSrc, name: slot.file || ('Слот ' + (si + 1)) });
    }
  }
  if (images.length === 0) return;

  /* Создать оверлей */
  var overlay = document.createElement('div');
  overlay.className = 'ar-card-overlay';
  overlay.onclick = function(e) {
    if (e.target === overlay) document.body.removeChild(overlay);
  };

  var html = '<div class="ar-card-preview">';
  html += '<div class="ar-card-preview-header">Карточка ' + (cardIdx + 1);

  /* Показать привязанный артикул если есть */
  if (proj.articles) {
    for (var a = 0; a < proj.articles.length; a++) {
      if (proj.articles[a].cardIdx === cardIdx) {
        html += ' &mdash; ' + esc(proj.articles[a].sku);
        break;
      }
    }
  }
  html += '<button class="ar-card-preview-close" onclick="this.closest(\'.ar-card-overlay\').remove()">x</button>';
  html += '</div>';

  html += '<div class="ar-card-preview-grid">';
  for (var i = 0; i < images.length; i++) {
    html += '<div class="ar-card-preview-item">';
    html += '<img src="' + images[i].src + '" alt="' + esc(images[i].name) + '">';
    html += '<div class="ar-card-preview-name">' + esc(images[i].name) + '</div>';
    html += '</div>';
  }
  html += '</div></div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);
}


/**
 * Показать увеличенное референс-фото артикула (модальное окно).
 */
function arShowRefImage(idx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.articles[idx]) return;
  var art = proj.articles[idx];
  if (!art.refImage) return;

  /* Создать модальный оверлей */
  var overlay = document.createElement('div');
  overlay.className = 'ar-ref-overlay';
  overlay.onclick = function() { document.body.removeChild(overlay); };
  overlay.innerHTML = '<div class="ar-ref-modal">'
    + '<img src="' + art.refImage + '" alt="' + esc(art.sku) + '">'
    + '<div class="ar-ref-modal-sku">' + esc(art.sku) + '</div>'
    + '</div>';
  document.body.appendChild(overlay);
}


/**
 * Удалить один артикул по индексу.
 */
function arDeleteArticle(idx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.articles[idx]) return;

  proj.articles.splice(idx, 1);

  /* Пересчитать cardIdx: индексы артикулов сместились */
  /* (cardIdx ссылается на индекс карточки, не артикула — пересчёт не нужен) */

  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
}


/**
 * Очистить все артикулы (с подтверждением).
 */
function arClearAll() {
  var proj = getActiveProject();
  if (!proj || !proj.articles || proj.articles.length === 0) return;
  if (!confirm('Удалить все ' + proj.articles.length + ' артикулов?')) return;

  proj.articles = [];
  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
}


/**
 * Загрузить чек-лист из файла (PDF/JSON/CSV/TXT/XLSX).
 * Desktop: использует Python бэкенд (pdfplumber для PDF с изображениями).
 * Browser: фолбэк на pdf.js / SheetJS / текстовый парсинг.
 */
function arLoadChecklist() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала выберите съёмку'); return; }

  /* Desktop-режим: Python-бэкенд парсит все форматы, включая PDF с картинками */
  if (window.pywebview && window.pywebview.api && window.pywebview.api.parse_article_file) {
    _arLoadViaBackend(proj);
    return;
  }

  /* Browser-режим: локальный парсинг через JS */
  _arLoadViaBrowser(proj);
}


/**
 * Desktop: парсинг через Python бэкенд (pdfplumber + Pillow).
 * Нативный диалог выбора файла, серверный парсинг PDF с изображениями.
 * Если результат плохой (0 артикулов) — автоматически отправляет в OpenAI Vision.
 */
function _arLoadViaBackend(proj) {
  window.onArticleParseDone = function(result) {
    var articles = [];
    if (!result.error && result.articles) {
      articles = _arConvertBackendResult(result.articles);
    }

    var fileName = result.file || 'файл';
    var isPdf = fileName.toLowerCase().indexOf('.pdf') >= 0;
    if (isPdf && result.file) _arLastPdfPath = result.file;  /* сохранить для AI-расстановки */

    /* Проверить качество: если PDF и мало артикулов — попробовать AI */
    if (isPdf && articles.length < 3 && _arGetOpenAIKey()) {
      console.log('articles.js: pdfplumber нашёл ' + articles.length + ' артикулов, пробую AI...');
      var statusEl = document.getElementById('ar-stats');
      if (statusEl) statusEl.textContent = 'Обычный парсинг: ' + articles.length + ', пробую AI...';

      /* Нужен файл для AI — просим бэкенд прочитать */
      _arFallbackToAI(proj, fileName, articles);
      return;
    }

    _arApplyLoaded(proj, articles, fileName);
  };

  var res = window.pywebview.api.parse_article_pdf_async();
  if (res && res.cancelled) return;
  if (res && res.error) {
    alert('Ошибка: ' + res.error);
    return;
  }
  console.log('articles.js: парсинг запущен через Python бэкенд');
}


/**
 * Конвертировать результат бэкенда в формат Article для фронтенда.
 * Добавляет id, status, cardIdx.
 */
function _arConvertBackendResult(rawArticles) {
  var articles = [];
  for (var i = 0; i < rawArticles.length; i++) {
    var a = rawArticles[i];
    articles.push({
      id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sku: String(a.sku || '').trim(),
      category: a.category || '',
      color: a.color || '',
      refImage: a.refImage || '',
      status: 'unmatched',
      cardIdx: -1
    });
  }
  return articles;
}


/**
 * Автоматический фолбэк на OpenAI Vision (desktop).
 * Когда pdfplumber не справился — рендерим страницы через бэкенд и отправляем в AI.
 * @param {Object} proj — активный проект
 * @param {string} filePath — путь к PDF файлу
 * @param {Array} partialArticles — то что pdfplumber уже нашёл (может быть пусто)
 */
function _arFallbackToAI(proj, filePath, partialArticles) {
  var apiKey = _arGetOpenAIKey();
  var statusEl = document.getElementById('ar-stats');

  /* Desktop: есть бэкенд → рендерим страницы через Python */
  if (window.pywebview && window.pywebview.api && window.pywebview.api.pdf_pages_to_images) {
    if (statusEl) statusEl.textContent = 'AI: рендеринг страниц PDF...';

    /* pdf_pages_to_images — синхронный, может быть медленным, но pywebview вернёт результат */
    var result = window.pywebview.api.pdf_pages_to_images(filePath);
    if (!result || result.error || !result.pages || result.pages.length === 0) {
      if (statusEl) statusEl.textContent = '';
      /* Если AI не помог — отдаём что есть от pdfplumber */
      _arApplyLoaded(proj, partialArticles, filePath);
      return;
    }

    /* Отправить страницы в OpenAI Vision */
    _arSendPagesToOpenAI(proj, result.pages, apiKey, filePath, statusEl);
    return;
  }

  /* Нет бэкенда или нет метода — отдаём что есть */
  if (statusEl) statusEl.textContent = '';
  _arApplyLoaded(proj, partialArticles, filePath);
}


/**
 * Отправить отрендеренные страницы PDF в OpenAI Vision для извлечения артикулов.
 * Обрабатывает по одной странице, собирает результат.
 */
function _arSendPagesToOpenAI(proj, pages, apiKey, fileName, statusEl) {
  var allArticles = [];
  var pageIdx = 0;
  var totalPages = pages.length;

  function processPage() {
    if (pageIdx >= totalPages) {
      if (statusEl) statusEl.textContent = '';
      var articles = _arConvertOpenAIResult(allArticles);
      _arApplyLoaded(proj, articles, fileName + ' (AI)');
      return;
    }

    if (statusEl) statusEl.textContent = 'AI: страница ' + (pageIdx + 1) + '/' + totalPages + '...';

    var base64Data = pages[pageIdx].replace(/^data:image\/\w+;base64,/, '');

    _arCallOpenAIVision(apiKey, base64Data, pageIdx + 1, totalPages, function(err, pageArticles) {
      if (!err && pageArticles && pageArticles.length > 0) {
        allArticles = allArticles.concat(pageArticles);
      }
      pageIdx++;
      /* Небольшая пауза чтобы не превысить rate limit */
      setTimeout(processPage, 300);
    });
  }

  processPage();
}


/**
 * Browser: парсинг через JS (pdf.js, SheetJS, текст).
 * PDF: сначала текстовый парсинг, если < 3 артикулов — автоматически AI.
 */
function _arLoadViaBrowser(proj) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,.tsv,.txt,.xlsx,.xls,.pdf';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();

    /* PDF — гибридный парсинг: текст+координаты из pdf.js + кроп фото из canvas */
    if (ext === 'pdf') {
      var statusEl = document.getElementById('ar-stats');
      if (statusEl) statusEl.textContent = 'Разбираю PDF...';
      _arParsePdfHybrid(file, function(articles) {
        if (!articles || articles.length === 0) {
          /* Фолбэк: AI если ничего не нашли */
          var apiKey = _arGetOpenAIKey();
          if (apiKey) {
            if (statusEl) statusEl.textContent = 'Текст не распознан, пробую AI...';
            _arProcessPdfWithOpenAI(proj, file, apiKey);
          } else {
            if (statusEl) statusEl.textContent = '';
            alert('Не удалось распознать артикулы в PDF.\n\nДобавьте ключ OpenAI для AI-распознавания.');
          }
        } else {
          if (statusEl) statusEl.textContent = '';
          _arApplyLoaded(proj, articles, file.name);
        }
      });
      return;
    }

    /* Excel — бинарный парсинг через SheetJS */
    if (ext === 'xlsx' || ext === 'xls') {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var articles = _arParseXlsx(ev.target.result);
        _arApplyLoaded(proj, articles, file.name);
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    /* JSON / CSV / TXT — текстовый парсинг */
    var reader2 = new FileReader();
    reader2.onload = function(ev) {
      var text = ev.target.result;
      var articles = (ext === 'json') ? _arParseJson(text) : _arParseCsvTxt(text);
      _arApplyLoaded(proj, articles, file.name);
    };
    reader2.readAsText(file);
  };
  input.click();
}


/* ──────────────────────────────────────────────
   OpenAI Vision — распознавание PDF через AI
   ────────────────────────────────────────────── */

/**
 * Inline-форма ввода OpenAI API key для веб-режима.
 * Показывает карточку под блоком артикулов, без prompt().
 * @param {function} onSave — callback(key) после сохранения
 */
function _arShowKeyInput(onSave) {
  /* Не дублировать */
  if (document.getElementById('ar-key-input-box')) return;

  var box = document.createElement('div');
  box.id = 'ar-key-input-box';
  box.className = 'ar-key-input-box';
  box.innerHTML = ''
    + '<div class="ar-key-input-title">Нужен ключ OpenAI для AI-сопоставления</div>'
    + '<div class="ar-key-input-hint">Получить ключ: <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a></div>'
    + '<div class="ar-key-input-row">'
    +   '<input type="password" id="ar-key-input-field" class="ar-key-input-field" placeholder="sk-..." autocomplete="off">'
    +   '<button class="btn" onclick="_arSaveKeyFromInput()">Сохранить</button>'
    + '</div>'
    + '<div class="ar-key-input-note">Ключ сохраняется в браузере (localStorage) и не отправляется на сервер.</div>';

  /* Вставить после блока ar-block-1 (чеклист) */
  var anchor = document.getElementById('ar-block-2') || document.getElementById('ar-checklist') || document.body;
  if (anchor.parentNode) {
    anchor.parentNode.insertBefore(box, anchor);
  } else {
    document.body.appendChild(box);
  }

  /* Сохранить callback для использования в _arSaveKeyFromInput */
  box._onSave = onSave;

  /* Фокус */
  var field = document.getElementById('ar-key-input-field');
  if (field) setTimeout(function() { field.focus(); }, 100);
}

/**
 * Сохранить ключ из inline-формы и запустить AI.
 */
function _arSaveKeyFromInput() {
  var field = document.getElementById('ar-key-input-field');
  var box   = document.getElementById('ar-key-input-box');
  if (!field) return;
  var key = field.value.trim();
  if (!key || key.length < 20) {
    field.style.borderColor = '#c00';
    return;
  }
  localStorage.setItem('openai_api_key', key);
  _arOpenAIKey = key;
  if (box) {
    var cb = box._onSave;
    box.parentNode && box.parentNode.removeChild(box);
    if (typeof cb === 'function') cb(key);
  }
}


/**
 * Настроить API-ключ OpenAI. Сохраняется в localStorage.
 */
function arSetOpenAIKey() {
  var current = _arGetOpenAIKey();
  var masked = current ? (current.substr(0, 7) + '...' + current.substr(-4)) : 'не задан';
  var key = prompt('OpenAI API Key (текущий: ' + masked + ').\n\nВведите ключ или оставьте пустым для удаления:', '');
  if (key === null) return; /* отмена */
  if (key.trim()) {
    localStorage.setItem('openai_api_key', key.trim());
    _arOpenAIKey = key.trim();
    alert('Ключ сохранён.');
  } else {
    localStorage.removeItem('openai_api_key');
    _arOpenAIKey = '';
    alert('Ключ удалён.');
  }
}


/**
 * Загрузить PDF и распознать артикулы через OpenAI Vision.
 * Работает и в desktop, и в браузере — нужен только API-ключ.
 *
 * Алгоритм:
 * 1. Пользователь выбирает PDF
 * 2. Каждая страница рендерится в canvas (pdf.js)
 * 3. Canvas -> base64 JPEG -> отправляется в OpenAI Vision
 * 4. GPT-4o извлекает артикулы + описания
 * 5. Результат загружается как чек-лист
 */
function arLoadViaOpenAI() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала выберите съёмку'); return; }

  var _isWeb = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;
  var apiKey = _isWeb ? '' : _arGetOpenAIKey();
  if (!_isWeb && !apiKey) {
    alert('Для распознавания PDF через AI нужен ключ OpenAI.\n\nНажмите кнопку "API Key" чтобы ввести ключ.');
    return;
  }

  if (typeof pdfjsLib === 'undefined') {
    alert('pdf.js не загружен. Проверьте подключение библиотеки.');
    return;
  }

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    _arProcessPdfWithOpenAI(proj, file, apiKey);
  };
  input.click();
}


/**
 * Рендерить страницы PDF и отправлять в OpenAI Vision.
 */
function _arProcessPdfWithOpenAI(proj, file, apiKey) {
  var reader = new FileReader();
  reader.onload = function(ev) {
    var typedArray = new Uint8Array(ev.target.result);

    pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
      var totalPages = pdf.numPages;
      var allArticles = [];
      var processed = 0;

      /* Статус */
      var statusEl = document.getElementById('ar-stats');
      if (statusEl) statusEl.textContent = 'AI: обработка 0/' + totalPages + ' страниц...';

      /* Обрабатываем страницы по одной */
      function processPage(pageNum) {
        if (pageNum > totalPages) {
          /* Все страницы обработаны */
          if (statusEl) statusEl.textContent = '';
          var articles = _arConvertOpenAIResult(allArticles);
          _arApplyLoaded(proj, articles, file.name + ' (AI)');
          return;
        }

        pdf.getPage(pageNum).then(function(page) {
          /* Рендерим страницу в canvas */
          var scale = 2.0; /* хорошее качество для OCR */
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          var ctx = canvas.getContext('2d');

          page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
            /* Canvas -> JPEG base64 */
            var imageBase64 = canvas.toDataURL('image/jpeg', 0.85);
            var base64Data = imageBase64.replace('data:image/jpeg;base64,', '');

            /* Отправить в OpenAI Vision */
            _arCallOpenAIVision(apiKey, base64Data, pageNum, totalPages, function(err, pageArticles) {
              processed++;
              if (statusEl) statusEl.textContent = 'AI: обработка ' + processed + '/' + totalPages + ' страниц...';

              if (!err && pageArticles && pageArticles.length > 0) {
                /* Вырезать референс-фото из canvas по bounding box */
                for (var ai = 0; ai < pageArticles.length; ai++) {
                  var a = pageArticles[ai];
                  if (a.img && typeof a.img.x === 'number' && typeof a.img.y === 'number'
                      && typeof a.img.w === 'number' && typeof a.img.h === 'number'
                      && a.img.w > 0.02 && a.img.h > 0.02) {
                    try {
                      var bx = Math.round(a.img.x * canvas.width);
                      var by = Math.round(a.img.y * canvas.height);
                      var bw = Math.round(a.img.w * canvas.width);
                      var bh = Math.round(a.img.h * canvas.height);
                      /* Ограничиваем размер: не больше 600x800 */
                      var scaleDown = Math.min(1, 600 / bw, 800 / bh);
                      var outW = Math.round(bw * scaleDown);
                      var outH = Math.round(bh * scaleDown);
                      var cropCanvas = document.createElement('canvas');
                      cropCanvas.width = outW;
                      cropCanvas.height = outH;
                      cropCanvas.getContext('2d').drawImage(canvas, bx, by, bw, bh, 0, 0, outW, outH);
                      a.refImage = cropCanvas.toDataURL('image/jpeg', 0.82);
                    } catch(cropErr) {
                      console.warn('articles.js: crop error', cropErr);
                    }
                  }
                }
                allArticles = allArticles.concat(pageArticles);
              }

              /* Следующая страница */
              processPage(pageNum + 1);
            });
          });
        });
      }

      processPage(1);

    }).catch(function(err) {
      alert('Ошибка чтения PDF: ' + err.message);
    });
  };
  reader.readAsArrayBuffer(file);
}


/**
 * Построить сообщение для OpenAI Vision (общее для обоих режимов).
 * @returns {Array} messages-массив для OpenAI API
 */
function _arBuildVisionMessages(base64Image, pageNum, totalPages) {
  var prompt = 'This is page ' + pageNum + ' of ' + totalPages + ' of a product catalog PDF.\n'
    + 'Extract ALL product article codes (SKUs) visible on this page.\n'
    + 'For each article, provide:\n'
    + '- "sku": the article/SKU code (e.g. "PL01056CN-13-black-26S")\n'
    + '- "category": product category if visible (shoes, bag, glasses, accessory, or empty)\n'
    + '- "color": color if visible in the SKU or near it\n'
    + '- "description": brief visual description of the product (1-2 words, e.g. "black heels", "red bag")\n'
    + '- "img": bounding box of the PRODUCT PHOTO on the page as relative coords 0.0-1.0: {"x":0.1,"y":0.1,"w":0.3,"h":0.4}. '
    +   'If the product has no photo on this page, omit "img".\n\n'
    + 'Return ONLY valid JSON array: [{"sku":"...","category":"...","color":"...","description":"...","img":{"x":...,"y":...,"w":...,"h":...}}]\n'
    + 'If no articles found on this page, return empty array: []\n'
    + 'Do NOT include any text before or after the JSON array.';

  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,' + base64Image, detail: 'high' }
      }
    ]
  }];
}

/**
 * Разобрать ответ OpenAI и вернуть callback(err, articles).
 */
function _arParseVisionResponse(responseText, status, callback) {
  if (status !== 200) {
    var errMsg = 'OpenAI API ошибка ' + status;
    try {
      var errData = JSON.parse(responseText);
      if (errData.error && errData.error.message) errMsg = errData.error.message;
    } catch(e) {}
    callback(errMsg, null);
    return;
  }
  try {
    var resp = JSON.parse(responseText);
    var content = resp.choices[0].message.content.trim();
    var jsonStr = content;
    var jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    var articles = JSON.parse(jsonStr);
    callback(null, articles);
  } catch(e) {
    console.error('OpenAI parse error:', e, 'raw:', responseText);
    callback('Ошибка разбора ответа AI', null);
  }
}

/**
 * Универсальный запрос к OpenAI Chat Completions.
 * Автоматически выбирает путь:
 * - Веб (sbClient доступен): Supabase Edge Function "openai-vision"
 * - Desktop (pywebview): прямой XHR с apiKey
 *
 * @param {Array}    messages   — messages-массив для OpenAI
 * @param {number}   maxTokens  — max_tokens
 * @param {number}   timeoutMs  — timeout XHR (только для desktop)
 * @param {string}   apiKey     — ключ (только для desktop)
 * @param {function} callback   — callback(responseText, httpStatus)
 */
function _arOpenAIRequest(messages, maxTokens, timeoutMs, apiKey, callback) {
  var isWeb = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;

  if (isWeb) {
    sbClient.functions.invoke('openai-vision', {
      body: { messages: messages, max_tokens: maxTokens, temperature: 0 }
    }).then(function(result) {
      if (result.error) {
        var errText = result.error.message || String(result.error);
        if (errText.indexOf('FunctionsFetchError') >= 0 || errText.indexOf('not found') >= 0) {
          errText = 'Edge Function "openai-vision" не найдена. Задеплойте в Supabase.';
        }
        callback(JSON.stringify({ error: { message: errText } }), 500);
        return;
      }
      var raw = result.data;
      if (raw && raw.choices) {
        callback(JSON.stringify(raw), 200);
      } else if (raw && raw.error) {
        callback(JSON.stringify(raw), 400);
      } else {
        callback(JSON.stringify(raw || {}), 200);
      }
    }).catch(function(e) {
      callback(JSON.stringify({ error: { message: 'Network error: ' + e.message } }), 500);
    });
    return;
  }

  /* Desktop: прямой XHR */
  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = timeoutMs || 60000;
  xhr.onload = function() { callback(xhr.responseText, xhr.status); };
  xhr.onerror = function() { callback(null, 0); };
  xhr.ontimeout = function() { callback(null, -1); };
  xhr.send(JSON.stringify({ model: 'gpt-4o', messages: messages, max_tokens: maxTokens, temperature: 0 }));
}


/**
 * Отправить изображение страницы в OpenAI Vision API.
 *
 * Два режима:
 * - Веб (нет pywebview + есть sbClient): через Supabase Edge Function "openai-vision"
 *   Ключ хранится в Supabase Secrets, никогда не попадает в браузер.
 * - Desktop (pywebview): прямой XHR, ключ из config.json.
 */
function _arCallOpenAIVision(apiKey, base64Image, pageNum, totalPages, callback) {
  var messages = _arBuildVisionMessages(base64Image, pageNum, totalPages);
  var isWeb = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;

  /* ── Веб-режим: Edge Function ── */
  if (isWeb) {
    sbClient.functions.invoke('openai-vision', {
      body: { messages: messages, max_tokens: 4000, temperature: 0 }
    }).then(function(result) {
      if (result.error) {
        /* Edge Function вернула HTTP-ошибку или сетевую ошибку */
        var errText = result.error.message || String(result.error);
        /* Если функция не задеплоена — показываем понятное сообщение */
        if (errText.indexOf('FunctionsFetchError') >= 0 || errText.indexOf('not found') >= 0) {
          errText = 'Edge Function не найдена. Задеплойте openai-vision в Supabase.';
        }
        callback(errText, null);
        return;
      }
      /* result.data — уже распарсенный JSON от Edge Function (который сам отдаёт OpenAI-ответ) */
      var raw = result.data;
      var responseText, status;
      if (raw && raw.choices) {
        /* Edge Function вернула OpenAI-ответ напрямую */
        responseText = JSON.stringify(raw);
        status = 200;
      } else if (raw && raw.error) {
        responseText = JSON.stringify(raw);
        status = 500;
      } else {
        responseText = JSON.stringify(raw);
        status = 200;
      }
      _arParseVisionResponse(responseText, status, callback);
    }).catch(function(e) {
      callback('Сетевая ошибка Edge Function: ' + e.message, null);
    });
    return;
  }

  /* ── Desktop-режим: прямой XHR ── */
  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = 60000;

  xhr.onload = function() {
    _arParseVisionResponse(xhr.responseText, xhr.status, callback);
  };
  xhr.onerror = function() { callback('Сетевая ошибка', null); };
  xhr.ontimeout = function() { callback('Таймаут запроса', null); };

  xhr.send(JSON.stringify({
    model: 'gpt-4o',
    messages: messages,
    max_tokens: 4000,
    temperature: 0
  }));
}


/**
 * Конвертировать результат OpenAI в формат Article.
 */
function _arConvertOpenAIResult(rawArticles) {
  var articles = [];
  var seen = {};
  for (var i = 0; i < rawArticles.length; i++) {
    var a = rawArticles[i];
    var sku = String(a.sku || a.article || a.SKU || '').trim();
    if (!sku || seen[sku]) continue;
    seen[sku] = true;
    articles.push({
      id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sku: sku,
      category: a.category || '',
      color: a.color || '',
      refImage: a.refImage || '',  /* заполняется при кропе из PDF-страницы */
      status: 'unmatched',
      cardIdx: -1
    });
  }
  return articles;
}


/**
 * Применить загруженные артикулы к проекту.
 * Общая логика для всех форматов: проверка, выбор режима, рендер.
 */
function _arApplyLoaded(proj, articles, fileName) {
  if (!articles || articles.length === 0) {
    alert('Не удалось распознать артикулы в файле "' + fileName + '".\n\nПоддерживаемые форматы:\n- Excel (.xlsx)\n- PDF (таблица с артикулами)\n- JSON: [{sku, category, color}]\n- CSV/TXT: строки с разделителями');
    return;
  }

  /* Спросить: заменить или добавить */
  var mode = 'replace';
  if (proj.articles && proj.articles.length > 0) {
    mode = confirm('Уже загружено ' + proj.articles.length + ' артикулов.\nНайдено ' + articles.length + ' новых.\n\nОК = заменить все\nОтмена = добавить к существующим') ? 'replace' : 'append';
  }

  if (mode === 'replace') {
    proj.articles = articles;
  } else {
    proj.articles = (proj.articles || []).concat(articles);
  }

  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
  /* Сохранить ref-изображения: IndexedDB (локальный кэш) + Supabase Storage (облако) */
  arDbSaveRefImages(proj);
  arUploadRefImagesToCloud(proj);
  console.log('articles.js: загружено ' + articles.length + ' артикулов из ' + fileName);

  /* Автоматически запустить AI-расстановку если есть ключ и незакреплённые карточки */
  _arAutoMatchIfReady(proj);
}


/**
 * Автоматический запуск AI-расстановки после загрузки чек-листа.
 * Ждёт загрузки ключа (до 3 секунд), потом запускает arAutoMatchAll().
 */
function _arAutoMatchIfReady(proj) {
  if (!proj || !proj.cards || proj.cards.length === 0) return;
  if (!proj.articles || proj.articles.length === 0) return;

  /* Проверить есть ли незакреплённые карточки */
  var hasUnmatched = false;
  for (var c = 0; c < proj.cards.length; c++) {
    var matched = false;
    for (var a = 0; a < proj.articles.length; a++) {
      if (proj.articles[a].cardIdx === c) { matched = true; break; }
    }
    if (!matched) { hasUnmatched = true; break; }
  }
  if (!hasUnmatched) return;

  var statusEl = document.getElementById('ar-stats');

  /* Веб-режим с Edge Function: ключ хранится в Supabase Secrets, не нужен в браузере */
  var isWebWithEdgeFunction = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;
  if (isWebWithEdgeFunction) {
    if (statusEl) statusEl.textContent = 'AI расставляет артикулы...';
    arAutoMatchAll();
    return;
  }

  /* Ключ может ещё загружаться (async) или pywebview ещё не готов.
     Активно пытаемся загрузить ключ при каждой попытке. */
  var attempts = 0;
  var maxAttempts = 12;

  function tryLoadAndRun() {
    attempts++;
    var key = _arGetOpenAIKey();

    /* Если ключа нет — активно пытаемся загрузить через бэкенд */
    if (!key && window.pywebview && window.pywebview.api && window.pywebview.api.get_config_value) {
      if (statusEl) statusEl.textContent = 'Загружаю ключ OpenAI... (попытка ' + attempts + ')';
      console.log('articles.js: tryLoadAndRun #' + attempts + ' — вызываю get_config_value');
      window.pywebview.api.get_config_value('openai_api_key').then(function(val) {
        if (val) {
          _arOpenAIKey = val;
          console.log('articles.js: ключ загружен! ' + val.substr(0, 12) + '...');
          if (statusEl) statusEl.textContent = 'AI расставляет артикулы...';
          arAutoMatchAll();
        } else {
          console.log('articles.js: get_config_value вернул пустое значение');
          retryOrGiveUp();
        }
      }).catch(function(e) {
        console.log('articles.js: get_config_value ошибка:', e);
        retryOrGiveUp();
      });
      return;
    }

    /* Ключ уже есть — запускаем */
    if (key) {
      console.log('articles.js: ключ уже загружен, запускаю AI');
      if (statusEl) statusEl.textContent = 'AI расставляет артикулы...';
      arAutoMatchAll();
      return;
    }

    /* pywebview ещё не готов — ждём */
    if (statusEl) statusEl.textContent = 'Жду pywebview... (попытка ' + attempts + ')';
    console.log('articles.js: tryLoadAndRun #' + attempts + ' — pywebview not ready');
    retryOrGiveUp();
  }

  function retryOrGiveUp() {
    if (attempts < maxAttempts) {
      setTimeout(tryLoadAndRun, 500);
    } else {
      console.log('articles.js: ключ не найден после ' + maxAttempts + ' попыток');
      /* Веб-режим: показываем inline-форму для ввода ключа */
      _arShowKeyInput(function(key) {
        if (key) {
          _arOpenAIKey = key;
          if (statusEl) statusEl.textContent = 'AI расставляет артикулы...';
          arAutoMatchAll();
        }
      });
    }
  }

  /* Первая попытка через 1 секунду (дать pywebview инициализироваться) */
  setTimeout(tryLoadAndRun, 1000);
}


/**
 * Парсинг JSON-файла с артикулами.
 * Поддерживает: массив [{sku, ...}], объект {articles: [...]},
 * а также поля-синонимы (name, article, cat, ref).
 * @param {string} text — содержимое файла
 * @returns {Array|null} массив Article-объектов или null
 */
function _arParseJson(text) {
  try {
    var data = JSON.parse(text);
    var raw = Array.isArray(data) ? data : (data.articles || data.items || data.data || null);
    if (!Array.isArray(raw)) return null;

    var articles = [];
    for (var i = 0; i < raw.length; i++) {
      var a = raw[i];
      /* Поддержка разных форматов ключей */
      var sku = a.sku || a.article || a.name || a.artikul || a['артикул'] || '';
      if (!sku && typeof a === 'string') sku = a; /* массив строк */
      if (!sku) continue;

      articles.push({
        id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        sku: String(sku).trim(),
        category: a.category || a.cat || a['категория'] || '',
        color: a.color || a['цвет'] || '',
        refImage: a.refImage || a.ref || a.image || '',
        status: 'unmatched',
        cardIdx: -1
      });
    }
    return articles.length > 0 ? articles : null;
  } catch(e) {
    return null;
  }
}


/**
 * Парсинг CSV/TXT файла с артикулами.
 * Автоопределение разделителя (tab > ; > ,).
 * Первая строка: если содержит "sku"/"article"/"артикул" — считается заголовком.
 * Колонки: 1=sku, 2=category, 3=color (опционально).
 * @param {string} text — содержимое файла
 * @returns {Array|null} массив Article-объектов или null
 */
function _arParseCsvTxt(text) {
  var lines = text.split(/\r?\n/).filter(function(l) { return l.trim() !== ''; });
  if (lines.length === 0) return null;

  /* Определяем разделитель по первой строке */
  var sep = '\t';
  if (lines[0].indexOf('\t') < 0) {
    sep = lines[0].indexOf(';') >= 0 ? ';' : ',';
  }

  /* Проверяем заголовок */
  var startIdx = 0;
  var headerCheck = lines[0].toLowerCase();
  if (headerCheck.indexOf('sku') >= 0 || headerCheck.indexOf('article') >= 0 ||
      headerCheck.indexOf('артикул') >= 0 || headerCheck.indexOf('артікул') >= 0) {
    startIdx = 1;
  }

  /* Определяем индексы колонок из заголовка */
  var skuCol = 0, catCol = -1, colorCol = -1;
  if (startIdx === 1) {
    var headers = lines[0].split(sep).map(function(h) { return h.trim().toLowerCase(); });
    for (var h = 0; h < headers.length; h++) {
      var hdr = headers[h];
      if (hdr === 'category' || hdr === 'категория' || hdr === 'cat') catCol = h;
      if (hdr === 'color' || hdr === 'цвет') colorCol = h;
      if (hdr === 'sku' || hdr === 'article' || hdr === 'артикул' || hdr === 'name') skuCol = h;
    }
  }

  var articles = [];
  for (var i = startIdx; i < lines.length; i++) {
    var parts = lines[i].split(sep);
    var sku = (parts[skuCol] || '').trim();
    if (!sku) continue;

    articles.push({
      id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sku: sku,
      category: catCol >= 0 ? (parts[catCol] || '').trim() : '',
      color: colorCol >= 0 ? (parts[colorCol] || '').trim() : '',
      refImage: '',
      status: 'unmatched',
      cardIdx: -1
    });
  }
  return articles.length > 0 ? articles : null;
}


/**
 * Парсинг Excel-файла (.xlsx / .xls) через SheetJS.
 * Ищет колонку с артикулами по заголовку (sku, article, артикул, наименование, код).
 * Если заголовок не найден — берёт первую колонку.
 * @param {ArrayBuffer} data — содержимое файла
 * @returns {Array|null} массив Article-объектов или null
 */
function _arParseXlsx(data) {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека SheetJS не загружена. Проверьте интернет-соединение.');
    return null;
  }
  try {
    var workbook = XLSX.read(data, { type: 'array' });
    var sheetName = workbook.SheetNames[0];
    var sheet = workbook.Sheets[sheetName];

    /* Конвертируем в массив массивов (включая заголовок) */
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length < 2) return null;

    /* Ищем колонку-артикул по заголовку */
    var headerRow = rows[0];
    var skuCol = -1, catCol = -1, colorCol = -1;
    for (var h = 0; h < headerRow.length; h++) {
      var hdr = String(headerRow[h]).toLowerCase().trim();
      if (skuCol < 0 && (hdr === 'sku' || hdr === 'article' || hdr === 'артикул' ||
          hdr === 'artikul' || hdr === 'код' || hdr === 'code' || hdr === 'name' ||
          hdr === 'наименование' || hdr.indexOf('артикул') >= 0 || hdr.indexOf('sku') >= 0)) {
        skuCol = h;
      }
      if (catCol < 0 && (hdr === 'category' || hdr === 'категория' || hdr === 'cat' ||
          hdr === 'тип' || hdr === 'type' || hdr === 'группа' || hdr === 'group')) {
        catCol = h;
      }
      if (colorCol < 0 && (hdr === 'color' || hdr === 'цвет' || hdr === 'colour')) {
        colorCol = h;
      }
    }

    /* Если заголовок не найден — первая колонка = артикул */
    var startRow = 1; /* пропускаем заголовок */
    if (skuCol < 0) {
      skuCol = 0;
      /* Может быть без заголовка — проверяем: если первая строка похожа на артикул */
      var firstVal = String(rows[0][0] || '').trim();
      if (firstVal && firstVal.length > 2 && !firstVal.match(/^(sku|article|артикул|код|name)/i)) {
        startRow = 0; /* нет заголовка, начинаем с первой строки */
      }
    }

    var articles = [];
    for (var i = startRow; i < rows.length; i++) {
      var row = rows[i];
      var sku = String(row[skuCol] || '').trim();
      if (!sku) continue;

      articles.push({
        id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        sku: sku,
        category: catCol >= 0 ? String(row[catCol] || '').trim() : '',
        color: colorCol >= 0 ? String(row[colorCol] || '').trim() : '',
        refImage: '',
        status: 'unmatched',
        cardIdx: -1
      });
    }
    console.log('articles.js: Excel parsed, sheet "' + sheetName + '", ' + articles.length + ' rows, skuCol=' + skuCol);
    return articles.length > 0 ? articles : null;
  } catch(e) {
    console.error('articles.js: Excel parse error:', e);
    return null;
  }
}


/**
 * Парсинг PDF-файла через pdf.js.
 * Извлекает текст со всех страниц, ищет строки похожие на артикулы.
 * @param {File} file — PDF файл
 * @param {function} callback — callback(articles)
 */

/**
 * Основной PDF парсер.
 *
 * Стратегия (приоритет → надёжность):
 *
 * 1. JPEG-сканер (primary): читает сырой PDF-буфер, находит JPEG-потоки
 *    (FFD8FF...FFD9) — именно так хранятся embedded фото в PDF.
 *    pdf.js для текста, JPEG-потоки для изображений. Порядок совпадает.
 *
 * 2. Canvas-кроп (fallback): если JPEG не нашлись — рендерит страницу
 *    в canvas и вырезает фото по координатам (для PDF с SVG/векторными картинками).
 *
 * @param {File}     file     — PDF файл
 * @param {function} callback — callback(articles|null)
 */
function _arParsePdfHybrid(file, callback) {
  if (typeof pdfjsLib === 'undefined') {
    callback(null);
    return;
  }

  var statusEl = document.getElementById('ar-stats');
  var reader = new FileReader();

  reader.onload = function(ev) {
    var buffer = ev.target.result;
    var uint8  = new Uint8Array(buffer);

    if (statusEl) statusEl.textContent = 'PDF: поиск изображений...';

    /* ── ШАГ 1: Извлечь JPEG-потоки из бинарного PDF ── */
    var jpegImages = _arExtractJpegsFromBuffer(uint8);

    /* ── ШАГ 2: Извлечь SKU из текста через pdf.js ── */
    pdfjsLib.getDocument({ data: uint8 }).promise.then(function(pdf) {

      var allSkus = [];
      var pagesTotal = pdf.numPages;

      function processPage(pageNum) {
        if (pageNum > pagesTotal) {
          /* ── ШАГ 3: Сопоставить SKU ↔ JPEG по индексу ── */
          var articles = _arPairSkusWithImages(allSkus, jpegImages);

          /* Fallback: если JPEG не нашлись — пробуем canvas-кроп */
          var hasImages = articles.some(function(a) { return !!a.refImage; });
          if (!hasImages && jpegImages.length === 0) {
            if (statusEl) statusEl.textContent = 'PDF: рендер страниц...';
            _arParsePdfCanvas(buffer, callback);
            return;
          }

          callback(articles.length > 0 ? articles : null);
          return;
        }

        if (statusEl) statusEl.textContent = 'PDF: текст стр. ' + pageNum + '/' + pagesTotal + '...';

        pdf.getPage(pageNum).then(function(page) {
          page.getTextContent().then(function(content) {
            var pageSkus = _arExtractSkusFromTextItems(content.items);
            for (var si = 0; si < pageSkus.length; si++) {
              allSkus.push(pageSkus[si]);
            }
            processPage(pageNum + 1);
          });
        }).catch(function() { processPage(pageNum + 1); });
      }

      processPage(1);

    }).catch(function(e) {
      console.error('articles.js: PDF parse error:', e);
      callback(null);
    });
  };

  reader.readAsArrayBuffer(file);
}


/**
 * Сканирует Uint8Array PDF-файла на JPEG-потоки (FFD8FF…FFD9).
 * Embedded JPEG хранятся как-есть (DCTDecode), что позволяет извлечь их
 * напрямую без рендеринга.
 *
 * @param  {Uint8Array} uint8
 * @returns {string[]}  массив data-URL jpeg
 */
function _arExtractJpegsFromBuffer(uint8) {
  var jpegs = [];
  var i = 0;
  while (i < uint8.length - 3) {
    /* JPEG SOI = FF D8, за которым любой маркер FF */
    if (uint8[i] === 0xFF && uint8[i+1] === 0xD8 && uint8[i+2] === 0xFF) {
      var start = i;
      i += 2;
      /* Ищем EOI: FF D9 */
      while (i < uint8.length - 1) {
        if (uint8[i] === 0xFF && uint8[i+1] === 0xD9) {
          i += 2;
          jpegs.push('data:image/jpeg;base64,' + _arUint8ToBase64(uint8.slice(start, i)));
          break;
        }
        i++;
      }
    } else {
      i++;
    }
  }
  return jpegs;
}


/**
 * Конвертирует Uint8Array в base64-строку (чанками, без переполнения стека).
 */
function _arUint8ToBase64(bytes) {
  var binary = '';
  var CHUNK = 32768;
  for (var off = 0; off < bytes.length; off += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(off, Math.min(off + CHUNK, bytes.length)));
  }
  return btoa(binary);
}


/**
 * Извлечь артикулы из массива pdf.js text items.
 * Дубли отфильтрованы. Порядок: страница за страницей, сверху вниз.
 */
function _arExtractSkusFromTextItems(items) {
  var SKU_RE  = /^[A-Za-z0-9][A-Za-z0-9\-\_\.\/]{4,39}$/;
  var SKIP_RE = /^(артикул|артикл|sku|article|category|color|код|code|наименование|размер|size|price|цена|qty|кол|итого|total|sum|описание|нет|фото)$/i;
  var seen = {};
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var s = items[i].str.trim();
    if (!s || s.length < 5 || s.length > 50) continue;
    if (SKIP_RE.test(s)) continue;
    if (SKU_RE.test(s) && !seen[s]) {
      seen[s] = true;
      result.push(s);
    }
  }
  return result;
}


/**
 * Сопоставить список SKU с массивом JPEG по индексу.
 * SKU #i ↔ JPEG #i (в каталогах порядок вхождения совпадает).
 */
function _arPairSkusWithImages(skus, images) {
  var articles = [];
  for (var i = 0; i < skus.length; i++) {
    var sku = skus[i];
    articles.push({
      id:       'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sku:      sku,
      category: '',
      color:    _arExtractColorFromSku(sku),
      refImage: i < images.length ? images[i] : '',
      status:   'unmatched',
      cardIdx:  -1
    });
  }
  return articles;
}


/**
 * Canvas-кроп fallback: рендер страниц + вырезание по координатам.
 * Используется когда в PDF нет embedded JPEG (SVG, векторная графика).
 */
function _arParsePdfCanvas(buffer, callback) {
  var statusEl = document.getElementById('ar-stats');
  var uint8 = new Uint8Array(buffer);

  pdfjsLib.getDocument({ data: uint8 }).promise.then(function(pdf) {
    var allArticles = [];
    var pagesTotal  = pdf.numPages;

    function processPage(pageNum) {
      if (pageNum > pagesTotal) {
        callback(allArticles.length > 0 ? allArticles : null);
        return;
      }
      if (statusEl) statusEl.textContent = 'PDF: рендер стр. ' + pageNum + '/' + pagesTotal + '...';

      pdf.getPage(pageNum).then(function(page) {
        var scale    = 2.5;
        var viewport = page.getViewport({ scale: scale });
        var canvas   = document.createElement('canvas');
        canvas.width  = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        var ctx = canvas.getContext('2d');

        var renderDone = false, textDone = false;
        var textItems  = [];

        function onBothDone() {
          if (!renderDone || !textDone) return;
          var skuItems    = _arFindSkuItems(textItems, canvas.height);
          var pageArticles = _arCropArticleImages(skuItems, canvas, textItems);
          allArticles = allArticles.concat(pageArticles);
          processPage(pageNum + 1);
        }

        page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
          renderDone = true;
          onBothDone();
        });

        page.getTextContent().then(function(content) {
          for (var k = 0; k < content.items.length; k++) {
            var item = content.items[k];
            var str = item.str.trim();
            if (!str) continue;
            textItems.push({
              str:      str,
              x:        item.transform[4] * scale,
              y:        canvas.height - item.transform[5] * scale,
              fontSize: Math.abs(item.transform[3]) * scale
            });
          }
          textDone = true;
          onBothDone();
        });

      }).catch(function() { processPage(pageNum + 1); });
    }

    processPage(1);
  }).catch(function() { callback(null); });
}


/**
 * Извлечь цвет из SKU (ищет стандартные цветовые слова через дефис).
 */
function _arExtractColorFromSku(sku) {
  var COLORS = {
    black:1, white:1, red:1, blue:1, green:1, brown:1, beige:1,
    grey:1, gray:1, pink:1, navy:1, cream:1, tan:1, nude:1,
    silver:1, gold:1, bordeaux:1, camel:1, ivory:1, cognac:1,
    sand:1, taupe:1, olive:1, coral:1, mint:1, lavender:1,
    citrus:1, nutella:1, starwhite:1, ecru:1, bone:1, clay:1
  };
  var parts = sku.toLowerCase().split('-');
  for (var pi = parts.length - 1; pi >= 0; pi--) {
    if (COLORS[parts[pi]]) return parts[pi];
  }
  return '';
}


/**
 * Найти текстовые элементы похожие на артикулы.
 * Возвращает список с canvasY (Y от верха страницы).
 */
function _arFindSkuItems(textItems, canvasHeight) {
  /* Регулярки для артикулов: содержат цифры+буквы+дефисы, длина 5-40 */
  var SKU_RE = /^[A-Za-z0-9][A-Za-z0-9\-\_\.\/]{4,39}$/;
  /* Слова-исключения (заголовки, служебные слова) */
  var SKIP_RE = /^(артикул|артикл|sku|article|category|color|код|code|наименование|размер|size|price|цена|qty|кол|итого|total|sum|описание)$/i;

  var found = [];
  for (var i = 0; i < textItems.length; i++) {
    var item = textItems[i];
    var s = item.str.trim();
    if (!s || s.length < 5 || s.length > 50) continue;
    if (SKIP_RE.test(s)) continue;
    if (SKU_RE.test(s)) {
      found.push({ sku: s, x: item.x, y: item.y, fontSize: item.fontSize });
    }
  }

  /* Убрать дубли (один артикул может быть на нескольких строках) */
  var seen = {};
  var unique = [];
  for (var j = 0; j < found.length; j++) {
    if (!seen[found[j].sku]) {
      seen[found[j].sku] = true;
      unique.push(found[j]);
    }
  }

  return unique;
}


/**
 * Вырезать референс-фото для каждого артикула.
 *
 * Автоматически определяет тип раскладки:
 *
 * ТАБЛИЧНАЯ (Portal-стиль): SKU слева, фото справа в той же строке
 *   ┌──────────────┬──────────┐
 *   │ PL01056CN... │  [фото]  │
 *   ├──────────────┼──────────┤
 *   │ PL01350CN... │  [фото]  │
 *   └──────────────┴──────────┘
 *   Признак: все SKU X < 50% ширины страницы
 *
 * СЕТОЧНАЯ: фото сверху, SKU снизу каждого блока
 *   ┌────┬────┐
 *   │фото│фото│
 *   │SKU │SKU │
 *   └────┴────┘
 */
function _arCropArticleImages(skuItems, canvas, allTextItems) {
  if (skuItems.length === 0) return [];

  var sorted = skuItems.slice().sort(function(a, b) { return a.y - b.y; });

  /* Определяем тип раскладки: если все SKU в левой половине — табличная */
  var maxSkuX = 0;
  for (var si = 0; si < sorted.length; si++) {
    if (sorted[si].x > maxSkuX) maxSkuX = sorted[si].x;
  }
  var isTableLayout = maxSkuX < canvas.width * 0.5;

  if (isTableLayout) {
    return _arCropTableLayout(sorted, canvas, allTextItems);
  } else {
    return _arCropGridLayout(sorted, canvas);
  }
}


/**
 * Кроп для ТАБЛИЧНОЙ раскладки (SKU слева, фото справа).
 * Разделитель: правая граница SKU-текста + отступ.
 * Строки: полосы между Y-позициями соседних SKU.
 */
function _arCropTableLayout(sorted, canvas, allTextItems) {
  /* Ищем правую границу SKU-зоны: берём 75-й перцентиль правых краёв */
  var rightEdges = sorted.map(function(s) {
    return s.x + s.sku.length * (s.fontSize || 12) * 0.55;
  }).sort(function(a, b) { return a - b; });
  var p75idx = Math.floor(rightEdges.length * 0.75);
  var skuZoneRight = rightEdges[p75idx] * 1.15; /* +15% зазор */

  /* Ограничиваем: разделитель не меньше 25% и не больше 55% ширины */
  skuZoneRight = Math.max(canvas.width * 0.25, Math.min(canvas.width * 0.55, skuZoneRight));

  /*
   * Правая граница таблицы.
   * Ищем текстовые элементы правее SKU-зоны (заголовки столбцов, плейсхолдеры).
   * Если не нашли — берём 55% ширины (типично для A4 портрет с одним фото-столбцом).
   */
  var tableRight = canvas.width * 0.55; /* разумный дефолт */
  if (allTextItems) {
    var rightItems = allTextItems.filter(function(t) { return t.x > skuZoneRight; });
    if (rightItems.length > 0) {
      var maxRX = 0;
      for (var ri = 0; ri < rightItems.length; ri++) {
        var t = rightItems[ri];
        var rx = t.x + t.str.length * (t.fontSize || 12) * 0.6;
        if (rx > maxRX) maxRX = rx;
      }
      /* Берём правый край текстов + 30% padding, но не больше 70% ширины страницы */
      tableRight = Math.min(canvas.width * 0.70, maxRX * 1.3);
    }
  }
  /* Не давать tableRight быть меньше skuZoneRight + 50px */
  tableRight = Math.max(tableRight, skuZoneRight + 50);

  /*
   * Высота строки: медианный интервал между соседними SKU.
   * Используем для расчёта rowTop/rowBottom через пропорцию,
   * а не через середину — это точнее, когда фото занимает всю высоту строки.
   *
   * Для Portal-стиля: фото начинается ~62% высоты строки ВЫШЕ текста SKU
   * (в canvas-координатах: меньший Y = выше на странице).
   */
  var rowHeight = 120; /* разумный дефолт (px при scale=2.5) */
  if (sorted.length > 1) {
    var gaps = [];
    for (var gi = 1; gi < sorted.length; gi++) {
      gaps.push(sorted[gi].y - sorted[gi - 1].y);
    }
    gaps.sort(function(a, b) { return a - b; });
    rowHeight = gaps[Math.floor(gaps.length / 2)]; /* медиана */
  }

  var topRatio    = 0.62; /* фото начинается за 62% высоты строки до текста SKU */
  var bottomRatio = 0.38; /* фото заканчивается за 38% высоты строки после текста */

  var articles = [];

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i];

    var rowTop    = Math.max(0,             Math.round(item.y - rowHeight * topRatio));
    var rowBottom = Math.min(canvas.height, Math.round(item.y + rowHeight * bottomRatio));

    var cropX = Math.round(skuZoneRight);
    var cropY = rowTop + 1;
    var cropW = Math.round(tableRight - skuZoneRight - 2);
    var cropH = rowBottom - rowTop - 2;

    articles.push(_arMakeCroppedArticle(item.sku, canvas, cropX, cropY, cropW, cropH));
  }

  return articles;
}


/**
 * Кроп для СЕТОЧНОЙ раскладки (фото выше SKU).
 */
function _arCropGridLayout(sorted, canvas) {
  /* Кластеризуем SKU по X → определяем колонки */
  var xValues = sorted.map(function(s) { return s.x; }).sort(function(a, b) { return a - b; });
  var cols = _arDetectColumns(xValues, canvas.width);
  var articles = [];

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i];
    var col = _arGetColumn(item.x, cols);
    var fs = item.fontSize || 14;

    /* Верх блока = низ предыдущего SKU в той же колонке */
    var topY = 0;
    for (var j = i - 1; j >= 0; j--) {
      if (_arGetColumn(sorted[j].x, cols) === col) {
        topY = sorted[j].y + fs;
        break;
      }
    }

    var cropX = Math.round(col.left + 2);
    var cropY = Math.round(topY + 2);
    var cropW = Math.round(col.right - col.left - 4);
    var cropH = Math.round(item.y - topY - 4);

    articles.push(_arMakeCroppedArticle(item.sku, canvas, cropX, cropY, cropW, cropH));
  }

  return articles;
}


/**
 * Вырезать прямоугольник из canvas и вернуть Article-объект.
 */
function _arMakeCroppedArticle(sku, canvas, cropX, cropY, cropW, cropH) {
  var refImage = '';
  if (cropW > 20 && cropH > 20) {
    try {
      var scaleDown = Math.min(1, 600 / cropW, 800 / cropH);
      var cc = document.createElement('canvas');
      cc.width  = Math.round(cropW * scaleDown);
      cc.height = Math.round(cropH * scaleDown);
      cc.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cc.width, cc.height);
      refImage = cc.toDataURL('image/jpeg', 0.88);
    } catch(e) { /* тихо игнорируем */ }
  }
  return {
    id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    sku: sku,
    category: '',
    color: '',
    refImage: refImage,
    status: 'unmatched',
    cardIdx: -1
  };
}


/**
 * Определить колонки сетки по X-координатам SKU.
 */
function _arDetectColumns(xValues, canvasWidth) {
  if (xValues.length === 0) return [{ left: 0, right: canvasWidth, center: canvasWidth / 2 }];
  var tolerance = canvasWidth / 6;
  var clusters = [];
  for (var i = 0; i < xValues.length; i++) {
    var x = xValues[i];
    var found = false;
    for (var c = 0; c < clusters.length; c++) {
      if (Math.abs(clusters[c].center - x) < tolerance) {
        clusters[c].values.push(x);
        clusters[c].center = clusters[c].values.reduce(function(a, b) { return a + b; }, 0) / clusters[c].values.length;
        found = true; break;
      }
    }
    if (!found) clusters.push({ center: x, values: [x] });
  }
  clusters.sort(function(a, b) { return a.center - b.center; });
  var result = [];
  for (var ci = 0; ci < clusters.length; ci++) {
    var left  = ci > 0 ? (clusters[ci - 1].center + clusters[ci].center) / 2 : 0;
    var right = ci < clusters.length - 1 ? (clusters[ci].center + clusters[ci + 1].center) / 2 : canvasWidth;
    result.push({ left: left, right: right, center: clusters[ci].center });
  }
  return result;
}

function _arGetColumn(x, cols) {
  for (var i = 0; i < cols.length; i++) {
    if (x >= cols[i].left && x < cols[i].right) return cols[i];
  }
  return cols[cols.length - 1];
}


function _arParsePdf(file, callback) {
  if (typeof pdfjsLib === 'undefined') {
    alert('Библиотека PDF.js не загружена. Проверьте интернет-соединение.');
    callback(null);
    return;
  }

  var reader = new FileReader();
  reader.onload = function(ev) {
    var data = new Uint8Array(ev.target.result);
    pdfjsLib.getDocument({ data: data }).promise.then(function(pdf) {
      var allText = [];
      var pagesLeft = pdf.numPages;

      /* Извлечь текст со всех страниц */
      for (var p = 1; p <= pdf.numPages; p++) {
        (function(pageNum) {
          pdf.getPage(pageNum).then(function(page) {
            page.getTextContent().then(function(content) {
              /* Собрать строки, группируя по Y-координатам (строки таблицы) */
              var lines = {};
              for (var k = 0; k < content.items.length; k++) {
                var item = content.items[k];
                var y = Math.round(item.transform[5]); /* Y координата */
                if (!lines[y]) lines[y] = [];
                lines[y].push({ x: item.transform[4], text: item.str });
              }

              /* Сортируем строки по Y (сверху вниз = убывание Y) */
              var yKeys = Object.keys(lines).sort(function(a, b) { return b - a; });
              for (var li = 0; li < yKeys.length; li++) {
                /* Сортируем ячейки в строке по X (слева направо) */
                var cells = lines[yKeys[li]].sort(function(a, b) { return a.x - b.x; });
                var lineText = cells.map(function(c) { return c.text.trim(); }).filter(function(t) { return t; });
                if (lineText.length > 0) {
                  allText.push({ page: pageNum, cells: lineText, raw: lineText.join('\t') });
                }
              }
              pagesLeft--;
              if (pagesLeft === 0) {
                /* Все страницы обработаны — парсим артикулы */
                var articles = _arExtractFromPdfLines(allText);
                callback(articles);
              }
            });
          });
        })(p);
      }
    }).catch(function(e) {
      console.error('articles.js: PDF parse error:', e);
      alert('Ошибка чтения PDF: ' + e.message);
      callback(null);
    });
  };
  reader.readAsArrayBuffer(file);
}


/**
 * Извлечь артикулы из распарсенных строк PDF.
 * Ищет заголовок (sku, артикул, код), определяет колонку, парсит строки.
 * @param {Array} lines — [{page, cells: [string], raw: string}]
 * @returns {Array|null}
 */
function _arExtractFromPdfLines(lines) {
  if (!lines || lines.length === 0) return null;

  /* Ищем строку-заголовок */
  var skuCol = -1, catCol = -1, colorCol = -1;
  var headerIdx = -1;

  for (var i = 0; i < Math.min(lines.length, 20); i++) {
    var cells = lines[i].cells;
    for (var c = 0; c < cells.length; c++) {
      var val = cells[c].toLowerCase();
      if (skuCol < 0 && (val.indexOf('артикул') >= 0 || val.indexOf('sku') >= 0 ||
          val.indexOf('article') >= 0 || val.indexOf('код') >= 0 || val === 'code')) {
        skuCol = c;
        headerIdx = i;
      }
      if (catCol < 0 && (val.indexOf('категория') >= 0 || val.indexOf('category') >= 0 ||
          val.indexOf('группа') >= 0 || val.indexOf('тип') >= 0)) {
        catCol = c;
      }
      if (colorCol < 0 && (val.indexOf('цвет') >= 0 || val.indexOf('color') >= 0)) {
        colorCol = c;
      }
    }
    if (headerIdx >= 0) break;
  }

  /* Если заголовок не найден — берём всё как список артикулов (первая ячейка каждой строки) */
  var startIdx = 0;
  if (headerIdx >= 0) {
    startIdx = headerIdx + 1;
  } else {
    skuCol = 0;
  }

  var articles = [];
  var seen = {}; /* дедупликация */
  for (var j = startIdx; j < lines.length; j++) {
    var rowCells = lines[j].cells;
    if (!rowCells || rowCells.length === 0) continue;

    var sku = (skuCol >= 0 && skuCol < rowCells.length) ? rowCells[skuCol].trim() : rowCells[0].trim();
    if (!sku || sku.length < 2) continue;

    /* Пропускаем строки-заголовки страниц (повторы) */
    if (sku.toLowerCase().indexOf('артикул') >= 0 || sku.toLowerCase().indexOf('sku') >= 0) continue;

    /* Дедупликация */
    if (seen[sku]) continue;
    seen[sku] = true;

    articles.push({
      id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sku: sku,
      category: (catCol >= 0 && catCol < rowCells.length) ? rowCells[catCol].trim() : '',
      color: (colorCol >= 0 && colorCol < rowCells.length) ? rowCells[colorCol].trim() : '',
      refImage: '',
      status: 'unmatched',
      cardIdx: -1
    });
  }

  console.log('articles.js: PDF parsed, ' + articles.length + ' articles from ' + lines.length + ' lines');
  return articles.length > 0 ? articles : null;
}


/**
 * Добавить один артикул вручную (prompt).
 */
function arAddManual() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала выберите съёмку'); return; }
  if (!proj.articles) proj.articles = [];

  var sku = prompt('Введите артикул (SKU):');
  if (!sku || !sku.trim()) return;

  var category = prompt('Категория (необязательно):') || '';

  proj.articles.push({
    id: 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    sku: sku.trim(),
    category: category.trim(),
    color: '',
    refImage: '',
    status: 'unmatched',
    cardIdx: -1
  });

  arRenderChecklist();
  arRenderMatching();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
}


/* ──────────────────────────────────────────────
   Блок 2: Сопоставление артикулов с карточками
   Две колонки: карточки слева, артикулы справа.
   AI переставляет правую колонку чтобы совпало.
   Клик на карточку + клик на артикул = ручная привязка.
   ────────────────────────────────────────────── */

/**
 * Отрисовать панель сопоставления: две колонки.
 * Левая — карточки (фото + номер), правая — артикулы (фото + SKU).
 * Привязанные пары стоят напротив друг друга, с пониженной прозрачностью.
 */
function arRenderMatching() {
  var proj = getActiveProject();
  if (!proj) return;

  /* Построить карту превью */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  var rowsEl = document.getElementById('ar-match-rows');
  var freeEl = document.getElementById('ar-free-articles');
  if (!rowsEl) return;

  if (!proj.cards || proj.cards.length === 0) {
    rowsEl.innerHTML = '<div class="empty-state">Нет карточек</div>';
    if (freeEl) freeEl.innerHTML = '';
    return;
  }

  /* ── Строки: карточка + артикул бок о бок ── */
  var html = '';
  for (var c = 0; c < proj.cards.length; c++) {
    var card = proj.cards[c];

    /* Найти привязанный артикул */
    var linkedArt = null;
    var linkedIdx = -1;
    for (var a = 0; a < (proj.articles || []).length; a++) {
      if (proj.articles[a].cardIdx === c) {
        linkedArt = proj.articles[a];
        linkedIdx = a;
        break;
      }
    }

    var selCard = (_arSelectedCard === c) ? ' ar-selected' : '';

    html += '<div class="ar-match-row">';

    /* --- Левая половина: КАРТОЧКА --- */
    html += '<div class="ar-match-cell ar-card-item' + selCard + '" onclick="arSelectCard(' + c + ')">';
    html += '<button class="ar-zoom-btn" onclick="event.stopPropagation();arPreviewCard(' + c + ')" title="Увеличить">+</button>';

    /* Фото-полоска */
    html += '<div class="ar-card-photos">';
    if (card.slots) {
      var maxPhotos = Math.min(card.slots.length, 3);
      for (var si = 0; si < maxPhotos; si++) {
        var slot = card.slots[si];
        var imgSrc = slot.dataUrl || slot.thumbUrl || '';
        if (!imgSrc && slot.file && pvByName[slot.file]) {
          var pv = pvByName[slot.file];
          imgSrc = pv.thumb || pv.preview || '';
        }
        if (imgSrc) {
          html += '<img class="ar-card-photo" src="' + imgSrc + '">';
        } else if (slot.file) {
          html += '<div class="ar-card-photo ar-card-photo-empty">' + esc(slot.file.substr(0, 8)) + '</div>';
        }
      }
    }
    html += '</div>';

    html += '<div class="ar-match-info">';
    html += '<div class="ar-match-num">Карточка ' + (c + 1) + '</div>';
    if (linkedArt) {
      html += '<div class="ar-match-sku">' + esc(linkedArt.sku) + '</div>';
    }
    html += '</div></div>';

    /* --- Правая половина: АРТИКУЛ или placeholder --- */
    if (linkedArt) {
      var selSku = (_arSelectedSku === linkedIdx) ? ' ar-selected' : '';
      html += '<div class="ar-match-cell ar-sku-item' + selSku + '" onclick="arSelectSku(' + linkedIdx + ')">';
      if (linkedArt.refImage) {
        html += '<img class="ar-sku-ref" src="' + linkedArt.refImage + '" alt="ref">';
      }
      html += '<div class="ar-match-info">';
      html += '<div class="ar-match-sku">' + esc(linkedArt.sku) + '</div>';
      if (linkedArt.category) html += '<div class="ar-match-cat">' + esc(linkedArt.category) + '</div>';
      html += '</div>';
      html += '<button class="ar-unmatch-btn" onclick="event.stopPropagation();arUnmatch(' + linkedIdx + ')" title="Отвязать">x</button>';
      html += '</div>';
    } else {
      html += '<div class="ar-match-cell ar-sku-placeholder" onclick="arSelectCard(' + c + ')">';
      html += '<div class="ar-match-info"><div class="ar-match-cat">-- не привязан --</div></div>';
      html += '</div>';
    }

    html += '</div>'; /* /ar-match-row */
  }
  rowsEl.innerHTML = html;

  /* ── Свободные артикулы (не привязанные ни к одной карточке) ── */
  if (freeEl) {
    var usedArt = {};
    for (var a2 = 0; a2 < (proj.articles || []).length; a2++) {
      if (proj.articles[a2].cardIdx >= 0) usedArt[a2] = true;
    }

    var freeHtml = '';
    var freeCount = 0;
    for (var a3 = 0; a3 < (proj.articles || []).length; a3++) {
      if (usedArt[a3]) continue;
      freeCount++;
      var art = proj.articles[a3];
      var selF = (_arSelectedSku === a3) ? ' ar-selected' : '';

      freeHtml += '<div class="ar-free-item' + selF + '" onclick="arSelectSku(' + a3 + ')">';
      if (art.refImage) {
        freeHtml += '<img class="ar-sku-ref" src="' + art.refImage + '" alt="ref">';
      }
      freeHtml += '<div class="ar-match-info">';
      freeHtml += '<div class="ar-match-sku">' + esc(art.sku) + '</div>';
      if (art.category) freeHtml += '<div class="ar-match-cat">' + esc(art.category) + '</div>';
      freeHtml += '</div></div>';
    }

    if (freeCount > 0) {
      freeEl.innerHTML = '<h4 style="font-size:12px;text-transform:uppercase;color:#999;margin:16px 0 8px">Свободные артикулы (' + freeCount + ')</h4>' + freeHtml;
    } else {
      freeEl.innerHTML = '';
    }
  }
}


/**
 * Выбрать карточку для сопоставления.
 * Если артикул уже выбран — привязать.
 */
function arSelectCard(idx) {
  _arSelectedCard = idx;
  if (_arSelectedSku !== null) {
    arDoMatch(_arSelectedSku, _arSelectedCard);
    _arSelectedSku = null;
    _arSelectedCard = null;
  }
  arRenderMatching();
}

/**
 * Выбрать артикул для сопоставления.
 * Если карточка уже выбрана — привязать.
 */
function arSelectSku(idx) {
  _arSelectedSku = idx;
  if (_arSelectedCard !== null) {
    arDoMatch(_arSelectedSku, _arSelectedCard);
    _arSelectedSku = null;
    _arSelectedCard = null;
  }
  arRenderMatching();
}


/**
 * AI-поиск артикула для одной карточки.
 * Отправляет фото карточки + все незакреплённые refImage в OpenAI.
 */
function arAIFindForCard(cardIdx) {
  var proj = getActiveProject();
  if (!proj) return;

  var _isWeb2 = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;
  var apiKey = _isWeb2 ? '' : _arGetOpenAIKey();
  if (!_isWeb2 && !apiKey) {
    alert('Нужен ключ OpenAI. Нажмите "API Key".');
    return;
  }

  /* Построить карту превью */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  /* Фото карточки (первое непустое) */
  var card = proj.cards[cardIdx];
  var cardImg = '';
  if (card && card.slots) {
    for (var si = 0; si < card.slots.length; si++) {
      var slot = card.slots[si];
      cardImg = slot.dataUrl || slot.thumbUrl || '';
      if (!cardImg && slot.file && pvByName[slot.file]) {
        var pv = pvByName[slot.file];
        cardImg = pv.thumb || pv.preview || '';
      }
      if (cardImg) break;
    }
  }
  if (!cardImg) { alert('У карточки нет фото.'); return; }

  /* Незакреплённые артикулы с refImage */
  var candidates = [];
  for (var a = 0; a < (proj.articles || []).length; a++) {
    var art = proj.articles[a];
    if (art.cardIdx >= 0) continue;
    if (!art.refImage) continue;
    candidates.push({ idx: a, sku: art.sku, refImage: art.refImage });
  }
  if (candidates.length === 0) {
    alert('Нет артикулов с референс-фото для сравнения.');
    return;
  }

  /* Статус */
  var statusEl = document.getElementById('ar-stats');
  if (statusEl) statusEl.textContent = 'AI: ищу артикул для карточки ' + (cardIdx + 1) + '...';

  /* Формируем запрос */
  var msgContent = [];
  var promptText = 'I have a photoshoot photo of a product (CARD). '
    + 'Below are ' + candidates.length + ' catalog reference photos of different products (labeled A1, A2, etc.).\n\n'
    + 'Which catalog photo shows the SAME product as the CARD photo?\n'
    + 'Compare product shape, style, color, silhouette.\n\n'
    + 'Catalog articles:\n';
  for (var ci = 0; ci < candidates.length; ci++) {
    promptText += '- A' + (ci + 1) + ': "' + candidates[ci].sku + '"\n';
  }
  promptText += '\nReturn ONLY JSON: {"match": "A3", "confidence": "high"}\n'
    + 'Or if no match: {"match": null}\n'
    + 'Do NOT include any text before or after the JSON.';

  msgContent.push({ type: 'text', text: promptText });

  /* Фото карточки */
  msgContent.push({ type: 'text', text: '--- CARD (photoshoot) ---' });
  var cardUrl = cardImg;
  if (cardUrl.indexOf('data:') !== 0 && cardUrl.indexOf('http') !== 0) {
    cardUrl = 'data:image/jpeg;base64,' + cardUrl;
  }
  msgContent.push({ type: 'image_url', image_url: { url: cardUrl, detail: 'low' } });

  /* Фото артикулов */
  for (var ai = 0; ai < candidates.length; ai++) {
    msgContent.push({ type: 'text', text: '--- A' + (ai + 1) + ': ' + candidates[ai].sku + ' ---' });
    msgContent.push({ type: 'image_url', image_url: { url: candidates[ai].refImage, detail: 'low' } });
  }

  _arOpenAIRequest([{ role: 'user', content: msgContent }], 200, 60000, apiKey, function(responseText, status) {
    if (statusEl) statusEl.textContent = '';
    if (!responseText || status !== 200) {
      var errMsg = 'OpenAI ошибка ' + status;
      try { errMsg = JSON.parse(responseText).error.message; } catch(e) {}
      alert(errMsg);
      return;
    }
    try {
      var resp = JSON.parse(responseText);
      var text = resp.choices[0].message.content.trim();
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);

      if (result.match) {
        var artNum = parseInt(String(result.match).replace(/\D/g, ''), 10);
        var cand = candidates[artNum - 1];
        if (cand) {
          arDoMatch(cand.idx, cardIdx);
          return;
        }
      }
      alert('AI не нашёл подходящий артикул для карточки ' + (cardIdx + 1) + '. Выберите вручную.');
    } catch(e) {
      console.error('AI find parse error:', e);
      alert('Ошибка разбора ответа AI');
    }
  });
}


/**
 * Найти артикулы для ВСЕХ незакреплённых карточек.
 * Запускает arAIFindForCard последовательно для каждой.
 */
/**
 * Batch AI matching: отправляем ВСЕ карточки и ВСЕ артикулы одним запросом.
 * AI возвращает массив сопоставлений [{card: 1, article: "A3"}, ...].
 */
/**
 * Последовательная AI-расстановка: по одной карточке за раз.
 * Для каждой карточки отправляет 1 фото карточки + все refImage артикулов.
 * Пауза 1 сек между запросами (rate limit).
 */
/**
 * AI-расстановка: отправляем страницы PDF чек-листа + фото карточки.
 * AI видит всю таблицу артикулов на странице и сравнивает с фото товара.
 * Если PDF нет — фолбэк на индивидуальные refImage (батчами по 12).
 */
function arAutoMatchAll() {
  var proj = getActiveProject();
  if (!proj || !proj.cards) return;

  /* В веб-режиме ключ хранится в Supabase Secrets — не нужен в браузере */
  var isWeb = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;
  var apiKey = isWeb ? '' : _arGetOpenAIKey();
  if (!isWeb && !apiKey) {
    var s = document.getElementById('ar-stats');
    if (s) s.textContent = 'AI: ключ не найден';
    return;
  }

  /* Построить карту превью */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  /* Собрать незакреплённые карточки с фото */
  var cards = [];
  for (var c = 0; c < proj.cards.length; c++) {
    var hasMatch = false;
    for (var a = 0; a < (proj.articles || []).length; a++) {
      if (proj.articles[a].cardIdx === c) { hasMatch = true; break; }
    }
    if (hasMatch) continue;

    var card = proj.cards[c];
    var cardImgs = _arGetCardImages(card, pvByName);
    if (cardImgs.length > 0) cards.push({ idx: c, imgs: cardImgs, category: card.category || '' });
  }

  if (cards.length === 0) return;

  /* Список SKU артикулов (для промпта) */
  var skuList = [];
  for (var a2 = 0; a2 < (proj.articles || []).length; a2++) {
    var art2 = proj.articles[a2];
    if (art2.cardIdx >= 0) continue;
    skuList.push({ idx: a2, sku: art2.sku });
  }

  var statusEl = document.getElementById('ar-stats');
  console.log('articles.js: arAutoMatchAll — ' + cards.length + ' cards, PDF pages strategy');

  /* Основная стратегия: PDF страницы (все артикулы видны на одной картинке) */
  if (_arLastPdfPath && window.pywebview && window.pywebview.api && window.pywebview.api.pdf_pages_to_images) {
    if (statusEl) statusEl.textContent = 'Рендерю PDF (300 DPI)...';
    window.pywebview.api.pdf_pages_to_images(_arLastPdfPath).then(function(result) {
      if (result && result.pages && result.pages.length > 0) {
        console.log('articles.js: PDF rendered — ' + result.pages.length + ' pages');
        _arMatchWithPdfPages(cards, skuList, result.pages, apiKey, proj, statusEl);
      } else {
        if (statusEl) statusEl.textContent = 'PDF не отрендерился, пробую refImage...';
        _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl);
      }
    }).catch(function() {
      _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl);
    });
  } else {
    _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl);
  }
}


/**
 * СТРАТЕГИЯ 1: Сопоставление через страницы PDF.
 * Для каждой карточки: фото карточки + страницы PDF + список SKU.
 * AI видит таблицу с картинками артикулов и находит совпадение.
 */
function _arMatchWithPdfPages(cards, skuList, pdfPages, apiKey, proj, statusEl) {
  var total = cards.length;
  var applied = 0;
  var idx = 0;

  function processNext() {
    if (idx >= cards.length) {
      if (statusEl) statusEl.textContent = 'AI: ' + applied + ' из ' + total + ' сопоставлено';
      arRenderMatching();
      arRenderVerification();
      if (typeof shAutoSave === 'function') shAutoSave();
      return;
    }

    var ci = cards[idx];
    if (statusEl) statusEl.textContent = 'AI: карточка ' + (idx + 1) + '/' + total + '...';

    /* Пересобрать свободные SKU */
    var freeSkus = [];
    for (var a = 0; a < (proj.articles || []).length; a++) {
      if (proj.articles[a].cardIdx < 0) freeSkus.push({ idx: a, sku: proj.articles[a].sku });
    }
    if (freeSkus.length === 0) { idx = cards.length; processNext(); return; }

    /* Простой промпт */
    var promptText = 'I have ' + ci.imgs.length + ' photoshoot photos of ONE product and '
      + pdfPages.length + ' pages from a product checklist PDF.\n\n'
      + 'The photoshoot may show a styled outfit. Look at which item is shown in close-up '
      + 'or appears most prominently — that is the target product.\n\n'
      + 'Find this product in the checklist PDF pages. The PDF has small reference photos next to SKU codes.\n\n'
      + 'Available SKUs:\n';
    for (var si = 0; si < freeSkus.length; si++) {
      promptText += '"' + freeSkus[si].sku + '", ';
    }
    promptText += '\n\nReturn JSON: {"match": "EXACT_SKU", "confidence": "high|medium|low"} or {"match": null}';

    var msgContent = [];
    msgContent.push({ type: 'text', text: promptText });

    /* Фото карточки */
    for (var k = 0; k < ci.imgs.length; k++) {
      var cUrl = ci.imgs[k];
      if (cUrl.indexOf('data:') !== 0 && cUrl.indexOf('http') !== 0) {
        cUrl = 'data:image/jpeg;base64,' + cUrl;
      }
      msgContent.push({ type: 'image_url', image_url: { url: cUrl, detail: 'high' } });
    }

    /* Страницы PDF */
    for (var pi = 0; pi < pdfPages.length; pi++) {
      msgContent.push({ type: 'image_url', image_url: { url: pdfPages[pi], detail: 'high' } });
    }

    var body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: msgContent }],
      max_tokens: 300,
      temperature: 0
    };

    _arSendWithRetry(body, apiKey, 0, function(text) {
      if (text) {
        try {
          var jsonMatch = text.match(/\{[\s\S]*\}/);
          var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
          console.log('articles.js: card ' + ci.idx + ' AI:', JSON.stringify(result));
          if (result.match && result.match !== 'null' && result.match !== null) {
            var matchedSku = String(result.match).trim();
            for (var fi = 0; fi < freeSkus.length; fi++) {
              if (freeSkus[fi].sku === matchedSku) {
                arDoMatch(freeSkus[fi].idx, ci.idx);
                applied++;
                arRenderMatching();
                break;
              }
            }
          }
        } catch(e) {
          console.error('articles.js: card ' + ci.idx + ' parse error:', e);
        }
      }
      idx++;
      setTimeout(processNext, 2500);
    });
  }

  processNext();
}


/**
 * Отправить запрос к OpenAI с автоматическим retry при 429.
 * @param {Object} body — тело запроса
 * @param {string} apiKey
 * @param {number} attempt — номер попытки (0-based)
 * @param {function} onDone — callback(responseText) или callback(null)
 */
function _arSendWithRetry(body, apiKey, attempt, onDone) {
  var maxRetries = 3;

  _arOpenAIRequest(body.messages, body.max_tokens || 1000, 90000, apiKey, function(responseText, status) {
    if (status === 200) {
      try {
        var resp = JSON.parse(responseText);
        onDone(resp.choices[0].message.content.trim());
      } catch(e) { onDone(null); }
    } else if (status === 429 && attempt < maxRetries) {
      /* Rate limit — ждём и пробуем снова */
      var wait = (attempt + 1) * 5000;
      console.log('articles.js: 429 rate limit, retry in ' + (wait / 1000) + 's (attempt ' + (attempt + 1) + ')');
      var statusEl = document.getElementById('ar-stats');
      if (statusEl) statusEl.textContent = 'Rate limit, жду ' + (wait / 1000) + 'с...';
      setTimeout(function() {
        _arSendWithRetry(body, apiKey, attempt + 1, onDone);
      }, wait);
    } else {
      console.error('articles.js: API error ' + status);
      onDone(null);
    }
  });
}


/**
 * Сопоставление через refImage батчами по 10.
 * Для каждой карточки прогоняем ВСЕ батчи кандидатов, выбираем лучший матч.
 */
function _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl) {
  var total = cards.length;
  var applied = 0;
  var cardIdx = 0;
  var BATCH_SIZE = 10;

  function processNextCard() {
    if (cardIdx >= cards.length) {
      if (statusEl) statusEl.textContent = 'AI: ' + applied + ' из ' + total + ' сопоставлено';
      arRenderMatching();
      arRenderVerification();
      if (typeof shAutoSave === 'function') shAutoSave();
      return;
    }

    var ci = cards[cardIdx];

    /* Собрать свободные кандидаты */
    var candidates = [];
    for (var a = 0; a < (proj.articles || []).length; a++) {
      var art = proj.articles[a];
      if (art.cardIdx >= 0 || !art.refImage) continue;
      candidates.push({ idx: a, sku: art.sku, refImage: art.refImage });
    }

    if (candidates.length === 0) {
      cardIdx = cards.length;
      processNextCard();
      return;
    }

    /* Разбить кандидатов на батчи */
    var batches = [];
    for (var b = 0; b < candidates.length; b += BATCH_SIZE) {
      batches.push(candidates.slice(b, b + BATCH_SIZE));
    }

    if (statusEl) statusEl.textContent = 'AI: карточка ' + (cardIdx + 1) + '/' + total +
      ' (' + batches.length + ' батчей по ' + BATCH_SIZE + ')...';

    /* Прогнать все батчи, собрать матчи, выбрать лучший */
    var allMatches = []; /* [{artIdx, sku, confidence}] */
    var batchIdx = 0;

    function processNextBatch() {
      if (batchIdx >= batches.length) {
        /* Все батчи прошли — выбрать лучший матч */
        if (allMatches.length > 0) {
          /* Приоритет: high > medium > low */
          var best = allMatches[0];
          for (var mi = 1; mi < allMatches.length; mi++) {
            if (_arConfScore(allMatches[mi].confidence) > _arConfScore(best.confidence)) {
              best = allMatches[mi];
            }
          }
          console.log('articles.js: card ' + ci.idx + ' best match: ' + best.sku + ' (' + best.confidence + ')');
          arDoMatch(best.artIdx, ci.idx);
          applied++;
          arRenderMatching();
        }
        cardIdx++;
        setTimeout(processNextCard, 1000);
        return;
      }

      var batch = batches[batchIdx];
      if (statusEl) statusEl.textContent = 'AI: карточка ' + (cardIdx + 1) + '/' + total +
        ', батч ' + (batchIdx + 1) + '/' + batches.length + '...';

      _arMatchOneCard(ci.idx, ci.imgs, ci.category, batch, apiKey, function(artIdx, confidence) {
        if (artIdx >= 0) {
          var matchedCand = null;
          for (var ci2 = 0; ci2 < batch.length; ci2++) {
            if (batch[ci2].idx === artIdx) { matchedCand = batch[ci2]; break; }
          }
          if (matchedCand) {
            allMatches.push({ artIdx: artIdx, sku: matchedCand.sku, confidence: confidence || 'medium' });
          }
        }
        batchIdx++;
        setTimeout(processNextBatch, 1500);
      });
    }

    processNextBatch();
  }

  processNextCard();
}

/** Числовой скор уверенности для сортировки */
function _arConfScore(c) {
  if (c === 'high') return 3;
  if (c === 'medium') return 2;
  if (c === 'low') return 1;
  return 0;
}


/**
 * Получить до 3 фото карточки (разные ракурсы товара).
 * @returns {string[]} массив URL/dataURL изображений
 */
function _arGetCardImages(card, pvByName) {
  var imgs = [];
  if (!card || !card.slots) return imgs;
  var max = Math.min(card.slots.length, 3);
  for (var si = 0; si < max; si++) {
    var slot = card.slots[si];
    var img = slot.dataUrl || slot.thumbUrl || '';
    if (!img && slot.file && pvByName[slot.file]) {
      var pv = pvByName[slot.file];
      img = pv.thumb || pv.preview || '';
    }
    if (img) imgs.push(img);
  }
  return imgs;
}


/**
 * AI-сопоставление одной карточки с батчем кандидатов.
 * Отправляет 1 фото карточки (крупный план) + до 10 refImage.
 * @param {number} cardIdx — индекс карточки
 * @param {string[]} cardImgs — фото карточки (до 3)
 * @param {string} category — категория карточки
 * @param {Array} candidates — [{idx, sku, refImage}] (батч до 10)
 * @param {string} apiKey
 * @param {function} onDone — callback(matchedArtIdx, confidence) или callback(-1)
 */
function _arMatchOneCard(cardIdx, cardImgs, category, candidates, apiKey, onDone) {
  var cands = candidates;

  /* Промпт: анализ всех фото, определение предмета */
  var promptText = 'TASK: Match a product from a photoshoot to its catalog reference.\n\n'
    + 'PHOTOSHOOT CARD: ' + cardImgs.length + ' photos from the same product card.\n'
    + 'These photos may include close-ups, detail shots, and full-body model shots.\n'
    + 'The card is about ONE specific product. To identify it:\n'
    + '- If there is a close-up: the close-up shows the target product.\n'
    + '- If all photos are full-body/model shots: look at what product is highlighted, '
    + 'or what item appears consistently across all angles. The product may be shoes, a bag, '
    + 'clothing, glasses, jewelry, or any accessory.\n'
    + '- A single card is always about ONE product, even if the model wears an entire outfit.\n\n'
    + 'CATALOG REFERENCES (batch ' + (cands.length) + ' items):\n';
  for (var i = 0; i < cands.length; i++) {
    promptText += '- A' + (i + 1) + ': "' + cands[i].sku + '"\n';
  }
  promptText += '\nCompare the target product to each reference.\n'
    + 'Key details: shape, silhouette, color, material, texture, hardware, heel type, sole, stitching, logo.\n'
    + 'Return JSON: {"match": "A3", "confidence": "high|medium|low"} or {"match": null} if none in this batch.';

  var msgContent = [];
  msgContent.push({ type: 'text', text: promptText });

  /* Фото карточки — отправляем ВСЕ ракурсы для лучшего сравнения */
  for (var k = 0; k < cardImgs.length; k++) {
    var cUrl = cardImgs[k];
    if (cUrl.indexOf('data:') !== 0 && cUrl.indexOf('http') !== 0) {
      cUrl = 'data:image/jpeg;base64,' + cUrl;
    }
    var label = (k === 0) ? 'CARD close-up' : 'CARD angle ' + (k + 1);
    msgContent.push({ type: 'text', text: '--- ' + label + ' ---' });
    msgContent.push({ type: 'image_url', image_url: { url: cUrl, detail: 'high' } });
  }

  /* Фото кандидатов */
  for (var j = 0; j < cands.length; j++) {
    msgContent.push({ type: 'text', text: '--- A' + (j + 1) + ' ---' });
    msgContent.push({ type: 'image_url', image_url: { url: cands[j].refImage, detail: 'high' } });
  }

  _arOpenAIRequest([{ role: 'user', content: msgContent }], 200, 60000, apiKey, function(responseText, status) {
    if (status === 200) {
      try {
        var resp = JSON.parse(responseText);
        var text = resp.choices[0].message.content.trim();
        console.log('articles.js: card ' + cardIdx + ' batch AI response:', text);
        var jsonMatch = text.match(/\{[\s\S]*\}/);
        var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        if (result.match && result.match !== 'null' && result.match !== null) {
          var artNum = parseInt(String(result.match).replace(/\D/g, ''), 10);
          var cand = cands[artNum - 1];
          if (cand) {
            console.log('articles.js: card ' + cardIdx + ' -> ' + cand.sku + ' (' + (result.confidence || '?') + ')');
            onDone(cand.idx, result.confidence || 'medium');
            return;
          }
        }
      } catch(e) {
        console.error('articles.js: card ' + cardIdx + ' parse error:', e);
      }
    } else {
      console.error('articles.js: card ' + cardIdx + ' API error ' + status);
    }
    onDone(-1, null);
  });
}

/**
 * Привязать артикул к карточке.
 * @param {number} skuIdx — индекс артикула
 * @param {number} cardIdx — индекс карточки
 */
function arDoMatch(skuIdx, cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  var art = proj.articles[skuIdx];
  if (!art) return;

  /* Снять предыдущую привязку другого артикула с этой карточки */
  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].cardIdx === cardIdx && i !== skuIdx) {
      proj.articles[i].cardIdx = -1;
      proj.articles[i].status = 'unmatched';
    }
  }

  art.cardIdx = cardIdx;
  art.status = 'matched';

  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
}


/**
 * Отвязать артикул от карточки.
 * @param {number} skuIdx — индекс артикула
 */
function arUnmatch(skuIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.articles[skuIdx]) return;

  proj.articles[skuIdx].cardIdx = -1;
  proj.articles[skuIdx].status = 'unmatched';

  arRenderChecklist();
  arRenderMatching();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
}


/* ──────────────────────────────────────────────
   AI Авто-сопоставление: OpenAI Vision
   ────────────────────────────────────────────── */

/**
 * Авто-сопоставление артикулов с карточками через OpenAI Vision.
 *
 * Алгоритм:
 * 1. Собрать все незакреплённые артикулы с refImage
 * 2. Собрать все незакреплённые карточки с фото слотов
 * 3. Отправить все изображения в GPT-4o одним запросом
 * 4. AI определяет какой артикул к какой карточке подходит
 * 5. Применить привязки, показать результат для верификации
 */
function arAutoMatchAI() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала выберите съёмку'); return; }

  var _isWeb3 = !window.pywebview && typeof sbClient !== 'undefined' && sbClient;
  var apiKey = _isWeb3 ? '' : _arGetOpenAIKey();
  if (!_isWeb3 && !apiKey) {
    alert('Для авто-сопоставления нужен ключ OpenAI.\nНажмите "API Key" чтобы ввести ключ.');
    return;
  }

  if (!proj.articles || proj.articles.length === 0) {
    alert('Сначала загрузите чек-лист артикулов.'); return;
  }
  if (!proj.cards || proj.cards.length === 0) {
    alert('Нет карточек для сопоставления.'); return;
  }

  /* Построить карту превью */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  /* Собрать незакреплённые артикулы с refImage */
  var unmatchedArts = [];
  for (var a = 0; a < proj.articles.length; a++) {
    var art = proj.articles[a];
    if (art.cardIdx >= 0) continue; /* уже привязан */
    if (!art.refImage) continue; /* нет фото — AI не сможет */
    unmatchedArts.push({ idx: a, sku: art.sku, refImage: art.refImage });
  }

  if (unmatchedArts.length === 0) {
    alert('Нет незакреплённых артикулов с референс-фото.\nЗагрузите артикулы из PDF с картинками.');
    return;
  }

  /* Собрать незакреплённые карточки с фото */
  var unmatchedCards = [];
  for (var c = 0; c < proj.cards.length; c++) {
    /* Проверить не привязана ли уже */
    var alreadyMatched = false;
    for (var aa = 0; aa < proj.articles.length; aa++) {
      if (proj.articles[aa].cardIdx === c) { alreadyMatched = true; break; }
    }
    if (alreadyMatched) continue;

    var card = proj.cards[c];
    if (!card.slots || card.slots.length === 0) continue;

    /* Взять первое непустое фото из слотов */
    var cardImg = '';
    for (var si = 0; si < card.slots.length; si++) {
      var slot = card.slots[si];
      cardImg = slot.dataUrl || slot.thumbUrl || '';
      if (!cardImg && slot.file && pvByName[slot.file]) {
        var pv = pvByName[slot.file];
        cardImg = pv.thumb || pv.preview || '';
      }
      if (cardImg) break;
    }
    if (!cardImg) continue;

    unmatchedCards.push({ idx: c, img: cardImg });
  }

  if (unmatchedCards.length === 0) {
    alert('Нет незакреплённых карточек с фото.'); return;
  }

  /* Ограничение: OpenAI принимает до ~20 изображений за раз.
     Разбиваем на батчи если нужно */
  var statusEl = document.getElementById('ar-stats');
  if (statusEl) statusEl.textContent = 'AI: сопоставление ' + unmatchedArts.length + ' артикулов с ' + unmatchedCards.length + ' карточками...';

  _arSendMatchRequest(apiKey, unmatchedArts, unmatchedCards, proj, statusEl);
}


/**
 * Отправить запрос на сопоставление в OpenAI Vision.
 * Формирует один запрос со всеми изображениями.
 */
function _arSendMatchRequest(apiKey, arts, cards, proj, statusEl) {
  /* Формируем контент сообщения: текст + изображения */
  var content = [];

  /* Текстовая инструкция */
  var prompt = 'You are matching product catalog reference photos with photoshoot card photos.\n\n'
    + 'ARTICLES (reference catalog photos) — labeled A1, A2, etc.:\n';
  for (var a = 0; a < arts.length; a++) {
    prompt += '- A' + (a + 1) + ': SKU "' + arts[a].sku + '"\n';
  }
  prompt += '\nCARDS (photoshoot photos) — labeled C1, C2, etc.\n\n'
    + 'Match each article to the card showing the SAME product.\n'
    + 'Compare product shape, style, color, and type.\n\n'
    + 'Return ONLY a JSON array of matches:\n'
    + '[{"article": "A1", "card": "C3", "confidence": "high"}, ...]\n\n'
    + 'confidence: "high" = clearly same product, "medium" = likely same, "low" = uncertain.\n'
    + 'If no good match exists for an article, omit it from the array.\n'
    + 'Do NOT include any text before or after the JSON.';

  content.push({ type: 'text', text: prompt });

  /* Изображения артикулов */
  for (var ai = 0; ai < arts.length; ai++) {
    content.push({ type: 'text', text: '--- Article A' + (ai + 1) + ': ' + arts[ai].sku + ' ---' });
    content.push({
      type: 'image_url',
      image_url: { url: arts[ai].refImage, detail: 'low' }
    });
  }

  /* Изображения карточек */
  for (var ci = 0; ci < cards.length; ci++) {
    content.push({ type: 'text', text: '--- Card C' + (ci + 1) + ' ---' });
    var cardUrl = cards[ci].img;
    /* Убедиться что URL — data:image формат */
    if (cardUrl && cardUrl.indexOf('data:') !== 0 && cardUrl.indexOf('http') !== 0) {
      cardUrl = 'data:image/jpeg;base64,' + cardUrl;
    }
    content.push({
      type: 'image_url',
      image_url: { url: cardUrl, detail: 'low' }
    });
  }

  _arOpenAIRequest([{ role: 'user', content: content }], 2000, 120000, apiKey, function(responseText, status) {
    if (!responseText || status !== 200) {
      if (statusEl) statusEl.textContent = '';
      var errMsg = 'OpenAI ошибка ' + status;
      try {
        var errData = JSON.parse(responseText);
        if (errData.error && errData.error.message) errMsg = errData.error.message;
      } catch(e) {}
      if (status === -1) errMsg = 'Таймаут (2 минуты). Попробуйте с меньшим количеством артикулов.';
      alert('AI сопоставление: ' + errMsg);
      return;
    }

    try {
      var resp = JSON.parse(responseText);
      var text = resp.choices[0].message.content.trim();

      /* Извлечь JSON */
      var jsonMatch = text.match(/\[[\s\S]*\]/);
      var matches = JSON.parse(jsonMatch ? jsonMatch[0] : text);

      /* Применить привязки */
      var matched = 0;
      for (var m = 0; m < matches.length; m++) {
        var match = matches[m];
        var artLabel = match.article || '';
        var cardLabel = match.card || '';

        /* Парсить индексы из A1, C3 и т.д. */
        var artNum = parseInt(artLabel.replace(/\D/g, ''), 10);
        var cardNum = parseInt(cardLabel.replace(/\D/g, ''), 10);
        if (!artNum || !cardNum) continue;

        var artEntry = arts[artNum - 1];
        var cardEntry = cards[cardNum - 1];
        if (!artEntry || !cardEntry) continue;

        arDoMatch(artEntry.idx, cardEntry.idx);
        matched++;
      }

      if (statusEl) statusEl.textContent = '';
      if (matched > 0) {
        alert('AI сопоставил ' + matched + ' артикулов с карточками.\nПроверьте результат в блоке "Верификация".');
      } else {
        alert('AI не смог найти совпадения. Попробуйте сопоставить вручную.');
      }

    } catch(e) {
      if (statusEl) statusEl.textContent = '';
      console.error('AI match parse error:', e, responseText);
      alert('Ошибка разбора ответа AI');
    }
  });
}


/* ──────────────────────────────────────────────
   Блок 3: Верификация
   ────────────────────────────────────────────── */

/**
 * Отрисовать блок верификации: сопоставленные артикулы рядом с фото из карточки.
 * Кликаем = подтверждаем / снимаем подтверждение.
 * Показывается всегда (даже если не все сопоставлены) — для уже сопоставленных.
 */
function arRenderVerification() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  var verifySection = document.getElementById('ar-verify-section');
  var el = document.getElementById('ar-verify-list');
  if (!el || !verifySection) return;

  /* Посчитать сопоставленные */
  var matchedItems = [];
  var verifiedCount = 0;
  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].cardIdx >= 0) {
      matchedItems.push(i);
      if (proj.articles[i].status === 'verified') verifiedCount++;
    }
  }

  /* Показать секцию если есть что верифицировать */
  if (matchedItems.length === 0) {
    verifySection.style.display = 'none';
    return;
  }
  verifySection.style.display = '';

  /* Тулбар верификации */
  var toolbarHtml = '<div class="ar-verify-toolbar">'
    + '<button class="btn btn-sm" onclick="arConfirmAll()">Подтвердить все</button>'
    + '<button class="btn btn-sm" onclick="arResetVerification()" style="color:#999">Сбросить</button>'
    + '<span class="ar-verify-progress">' + verifiedCount + ' / ' + matchedItems.length + ' проверено</span>';
  /* Кнопка формирования списка переименования (доступна после верификации) */
  if (verifiedCount > 0) {
    toolbarHtml += '<button class="btn btn-sm btn-primary" onclick="arGenerateRenameList()" '
      + 'style="margin-left:auto" title="Скачать CSV-файл для переименования">'
      + 'Список на переименование (' + verifiedCount + ')</button>';
  }
  toolbarHtml += '<span id="ar-rename-status" style="font-size:12px;margin-left:8px"></span>'
    + '</div>';

  var html = toolbarHtml;
  for (var m = 0; m < matchedItems.length; m++) {
    var idx = matchedItems[m];
    var art = proj.articles[idx];
    var card = (proj.cards && proj.cards[art.cardIdx]) ? proj.cards[art.cardIdx] : null;
    var cardThumb = '';
    if (card && card.slots && card.slots[0]) {
      cardThumb = card.slots[0].dataUrl || card.slots[0].thumbUrl || '';
    }

    var verified = (art.status === 'verified') ? ' ar-verified' : '';
    html += '<div class="ar-verify-item' + verified + '" data-idx="' + idx + '" onclick="arToggleVerify(' + idx + ')">';

    /* Фото из карточки (слева) */
    html += '<div class="ar-verify-card">';
    if (cardThumb) {
      html += '<img src="' + cardThumb + '" alt="card">';
    }
    html += '</div>';

    /* Инфо (центр) */
    html += '<div class="ar-verify-info">';
    html += '<div class="ar-verify-sku">' + esc(art.sku) + '</div>';
    if (art.category) html += '<div class="ar-verify-cat">' + esc(art.category) + '</div>';
    html += '<div class="ar-verify-status">' + (art.status === 'verified' ? 'OK' : 'Кликните для подтверждения') + '</div>';
    html += '</div>';

    /* Референс (справа, если есть) */
    if (art.refImage) {
      html += '<div class="ar-verify-ref"><img src="' + art.refImage + '" alt="ref"></div>';
    }

    html += '</div>';
  }
  el.innerHTML = html;

  /* Показать блок переименования если есть верифицированные */
  var renameSection = document.getElementById('ar-rename-section');
  if (renameSection) {
    renameSection.style.display = verifiedCount > 0 ? '' : 'none';
  }
}


/**
 * Применить автопереименование карточки по артикулу.
 * Вызывается при верификации совпадения артикул–карточка.
 * Устанавливает card.name = art.sku для привязанной карточки.
 * Записывает событие в proj._renameLog для облачной синхронизации.
 * Не откатывает имя при снятии верификации — оставляем как есть.
 * @param {object} proj  — активный проект
 * @param {object} art   — артикул со статусом 'verified' и cardIdx >= 0
 */
function _arApplyCardRename(proj, art) {
  if (!art || art.cardIdx < 0) return;
  if (!proj.cards || !proj.cards[art.cardIdx]) return;

  var card = proj.cards[art.cardIdx];
  var oldName = card.name || '';
  card.name = art.sku;

  /* Записать в лог переименований */
  if (!proj._renameLog) proj._renameLog = [];
  proj._renameLog.push({
    article_id:    art.id,
    card_idx:      art.cardIdx,
    original_name: oldName,
    new_name:      art.sku,
    trigger:       'verify',
    renamed_at:    new Date().toISOString(),
    _synced:       false
  });
}


/**
 * Переключить статус верификации артикула.
 * При переходе в 'verified' — автоматически переименовать привязанную карточку.
 */
function arToggleVerify(idx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.articles[idx]) return;

  var art = proj.articles[idx];
  art.status = (art.status === 'verified') ? 'matched' : 'verified';

  /* Автопереименование карточки при верификации */
  if (art.status === 'verified') {
    _arApplyCardRename(proj, art);
  }

  arRenderChecklist();
  arRenderVerification();
  arUpdateStats();

  /* Обновить отображение карточек — имя карточки поменялось,
     сайдбар со списком карточек и заголовок активной карточки
     должны показать новое название СРАЗУ, без переключения вкладок. */
  if (typeof cpRenderList === 'function') cpRenderList();
  if (typeof cpRenderCard === 'function') cpRenderCard();

  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
}


/**
 * Подтвердить все сопоставленные артикулы как верифицированные.
 * Автоматически переименовывает все привязанные карточки.
 */
function arConfirmAll() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].status === 'matched') {
      proj.articles[i].status = 'verified';
      /* Автопереименование карточки */
      _arApplyCardRename(proj, proj.articles[i]);
    }
  }
  arRenderChecklist();
  arRenderVerification();
  arUpdateStats();

  /* После массового подтверждения — обновить список карточек и активную карточку,
     чтобы новые имена стали видны сразу. */
  if (typeof cpRenderList === 'function') cpRenderList();
  if (typeof cpRenderCard === 'function') cpRenderCard();

  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
}


/**
 * Сбросить верификацию: все verified → matched.
 */
function arResetVerification() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].status === 'verified') {
      proj.articles[i].status = 'matched';
    }
  }
  arRenderChecklist();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
  arCloudSync();
}


/* ──────────────────────────────────────────────
   Статистика
   ────────────────────────────────────────────── */

/**
 * Обновить статистику артикулов.
 */
function arUpdateStats() {
  var proj = getActiveProject();
  var el = document.getElementById('ar-stats');
  if (!el) return;
  if (!proj || !proj.articles || proj.articles.length === 0) {
    el.textContent = '';
    return;
  }
  var total = proj.articles.length;
  var matched = 0, verified = 0;
  for (var i = 0; i < total; i++) {
    if (proj.articles[i].status === 'matched') matched++;
    if (proj.articles[i].status === 'verified') verified++;
  }
  el.textContent = total + ' артикулов: ' + verified + ' ОК, ' + matched + ' сопоставлено, ' + (total - matched - verified) + ' осталось';
}


/* ──────────────────────────────────────────────
   Импорт старого формата проекта ([anchor client]_data.json)
   ────────────────────────────────────────────── */

/**
 * Импорт старого JSON-формата проекта.
 * Читает файл, конвертирует в текущий формат,
 * сохраняет превью в IndexedDB.
 *
 * Старый формат:
 * { shootDate, brand, cards: [{category, bottomCount, slots: [{dataUrl, name}]}] }
 *
 * Вызывается из кнопки «Импорт» на вкладке «Съёмки».
 */
function shImportLegacyJson() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;

    /* Показать прогресс */
    var statusEl = document.getElementById('save-status');
    if (statusEl) {
      statusEl.textContent = 'Импорт: чтение файла...';
      statusEl.style.color = '#ff9800';
    }

    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var old = JSON.parse(ev.target.result);
        _shDoLegacyImport(old);
      } catch(ex) {
        alert('Ошибка чтения JSON: ' + ex.message);
        if (statusEl) { statusEl.textContent = 'Ошибка импорта'; statusEl.style.color = '#c62828'; }
      }
    };
    reader.readAsText(file);
  };
  input.click();
}


/**
 * Выполнить конвертацию старого формата в текущий.
 * @param {Object} old — данные старого формата
 */
function _shDoLegacyImport(old) {
  var statusEl = document.getElementById('save-status');

  var proj = {
    brand: old.brand || 'Import',
    shoot_date: old.shootDate || old.shoot_date || new Date().toISOString().slice(0, 10),
    templateId: '',
    categories: [],
    channels: [],
    _stage: 1,
    _stageHistory: {},
    otherContent: [],
    cards: [],
    articles: [],
    previews: []
  };

  var allPreviews = [];
  var seenNames = {};

  for (var c = 0; c < (old.cards || []).length; c++) {
    var oldCard = old.cards[c];
    if (!oldCard) continue;

    var newCard = {
      category: oldCard.category || '',
      articleId: '',
      status: 'draft',
      comments: [],
      slots: []
    };

    var slotCount = (oldCard.slots || []).length;
    for (var s = 0; s < slotCount; s++) {
      var oldSlot = oldCard.slots[s];

      if (!oldSlot) {
        /* Пустой слот */
        newCard.slots.push({
          orient: 'v', weight: 1, name: '',
          dataUrl: null, thumbUrl: null, path: ''
        });
        continue;
      }

      var dataUrl = oldSlot.dataUrl || '';
      var name = oldSlot.name || '';

      /* Первый слот = hero (горизонт), остальные = вертикали */
      var isHero = (s === 0 && slotCount > 1);
      var orient = isHero ? 'h' : 'v';

      newCard.slots.push({
        orient: orient,
        weight: isHero ? 2 : 1,
        name: name,
        file: name,
        dataUrl: dataUrl,
        thumbUrl: dataUrl,
        path: ''
      });

      /* Собрать в пул превью (без дубликатов) */
      if (name && !seenNames[name] && dataUrl) {
        seenNames[name] = true;
        allPreviews.push({
          name: name,
          thumb: dataUrl,
          preview: dataUrl,
          path: '',
          rating: 0,
          orient: orient,
          folders: []
        });
      }
    }

    proj.cards.push(newCard);
  }

  proj.previews = allPreviews;

  /* Добавить проект в App */
  App.projects.push(proj);
  App.selectedProject = App.projects.length - 1;

  if (statusEl) {
    statusEl.textContent = 'Импорт: сохранение превью...';
  }

  /* Сохранить превью в IndexedDB (для восстановления при перезагрузке) */
  var projKey = (proj.brand || 'noname') + '_' + (proj.shoot_date || '');
  projKey = projKey.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');

  if (typeof pvDbSavePreviews === 'function') {
    pvDbSavePreviews(projKey, allPreviews);
  }

  /* Отрисовать */
  if (typeof renderProjects === 'function') renderProjects();
  if (typeof shAutoSave === 'function') shAutoSave();

  if (statusEl) {
    statusEl.textContent = 'Импорт: ' + proj.cards.length + ' карточек, ' + allPreviews.length + ' фото';
    statusEl.style.color = '#4caf50';
    setTimeout(function() {
      statusEl.textContent = 'Сохранено';
      statusEl.style.color = '#999';
    }, 5000);
  }

  console.log('Legacy import: ' + proj.cards.length + ' cards, ' + allPreviews.length + ' previews');
}


// ══════════════════════════════════════════════
//  Блок 4: Формирование списка на переименование
//
//  После верификации артикулов генерируется CSV-файл
//  с двумя колонками: исходное имя файла → новое имя (на основе SKU).
//  Клиент скачивает CSV и запускает rename-скрипт на Windows.
//
//  Правила именования:
//    SKU + "_" + порядковый номер фото в карточке (01, 02, 03...)
//    Расширение сохраняется от оригинала.
//    Пример: PL01056CN-13-black-26S_01.jpg, PL01056CN-13-black-26S_02.jpg
// ══════════════════════════════════════════════

/**
 * Сформировать список переименования из верифицированных артикулов.
 * Скачивает CSV-файл: old_name, new_name
 * @param {boolean} [allMatched] — включить и matched (не только verified)
 */
function arGenerateRenameList(allMatched) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.cards) {
    alert('Нет данных для формирования списка');
    return;
  }

  var lines = [];
  var count = 0;

  for (var i = 0; i < proj.articles.length; i++) {
    var art = proj.articles[i];
    /* Пропускаем несопоставленные и (опционально) неверифицированные */
    if (art.cardIdx < 0) continue;
    if (!allMatched && art.status !== 'verified') continue;

    var card = proj.cards[art.cardIdx];
    if (!card || !card.slots) continue;

    var sku = art.sku || ('article_' + i);
    var photoNum = 0;

    for (var s = 0; s < card.slots.length; s++) {
      var slot = card.slots[s];
      if (!slot.file) continue;
      photoNum++;

      /* Расширение из оригинального файла */
      var ext = '';
      var dotPos = slot.file.lastIndexOf('.');
      if (dotPos >= 0) ext = slot.file.substring(dotPos);

      /* Номер фото: 01, 02, 03... */
      var numStr = photoNum < 10 ? ('0' + photoNum) : ('' + photoNum);
      var newName = sku + '_' + numStr + ext;

      lines.push(slot.file + ',' + newName);
      count++;
    }
  }

  if (lines.length === 0) {
    alert('Нет верифицированных артикулов с привязанными фотографиями.\n'
      + 'Сначала загрузите чек-лист, сопоставьте артикулы с карточками и подтвердите.');
    return;
  }

  /* Сформировать CSV */
  var csv = 'old_name,new_name\n' + lines.join('\n') + '\n';

  /* Скачать файл */
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var brandSlug = (proj.brand || 'project').replace(/[^a-zA-Z0-9а-яА-Я_-]/g, '_');
  a.download = 'rename_' + brandSlug + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  /* Обновить UI */
  var statusEl = document.getElementById('ar-rename-status');
  if (statusEl) {
    statusEl.textContent = 'Список сформирован: ' + count + ' файлов';
    statusEl.style.color = '#4caf50';
  }
}
