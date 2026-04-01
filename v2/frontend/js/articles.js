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


/* ──────────────────────────────────────────────
   Инициализация: обновить при переключении на вкладку
   ────────────────────────────────────────────── */

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
  arUpdateStats();
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
    el.innerHTML = '<div class="empty-state">Артикулы не загружены. Нажмите "Загрузить чек-лист" или "Импорт JSON".</div>';
    return;
  }

  var html = '<table class="ar-table"><thead><tr>'
    + '<th>#</th><th>Статус</th><th>Артикул</th><th>Категория</th><th>Референс</th><th>Карточка</th>'
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
    html += '<td class="ar-sku">' + esc(art.sku) + '</td>';
    html += '<td>' + esc(art.category || '') + '</td>';
    html += '<td>';
    if (art.refImage) {
      html += '<img class="ar-ref-thumb" src="' + art.refImage + '" alt="ref">';
    }
    html += '</td>';
    html += '<td>' + cardLabel + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}


/**
 * Загрузить чек-лист из файла (JSON, CSV, TXT).
 * Универсальная функция — работает и в desktop и в браузере.
 * JSON: [{sku, category, color, refImage}] или {articles: [...]}
 * CSV/TXT: строки с разделителями (tab, ;, ,) или по одному артикулу на строку.
 * Первая строка CSV может быть заголовком (sku/article/артикул).
 */
function arLoadChecklist() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала выберите съёмку'); return; }

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,.tsv,.txt';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var text = ev.target.result;
      var articles = null;
      var ext = (file.name.split('.').pop() || '').toLowerCase();

      if (ext === 'json') {
        articles = _arParseJson(text);
      } else {
        articles = _arParseCsvTxt(text);
      }

      if (!articles || articles.length === 0) {
        alert('Не удалось распознать артикулы в файле.\n\nПоддерживаемые форматы:\n- JSON: [{sku, category, color}]\n- CSV/TXT: строки с артикулами (разделитель: tab, ; или ,)');
        return;
      }

      /* Спросить: заменить или добавить */
      var mode = 'replace';
      if (proj.articles && proj.articles.length > 0) {
        mode = confirm('Уже загружено ' + proj.articles.length + ' артикулов.\n\nОК = заменить все\nОтмена = добавить к существующим') ? 'replace' : 'append';
      }

      if (mode === 'replace') {
        proj.articles = articles;
      } else {
        proj.articles = (proj.articles || []).concat(articles);
      }

      arRenderChecklist();
      arRenderMatching();
      arUpdateStats();
      if (typeof shAutoSave === 'function') shAutoSave();
      console.log('articles.js: загружено ' + articles.length + ' артикулов из ' + file.name);
    };
    reader.readAsText(file);
  };
  input.click();
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
   ────────────────────────────────────────────── */

/**
 * Отрисовать панель сопоставления: карточки слева, артикулы справа.
 * Клик на карточку + клик на артикул = привязка.
 */
function arRenderMatching() {
  var proj = getActiveProject();
  if (!proj) return;

  /* Карточки */
  var cardsEl = document.getElementById('ar-cards-list');
  if (cardsEl) {
    if (!proj.cards || proj.cards.length === 0) {
      cardsEl.innerHTML = '<div class="empty-state">Нет карточек</div>';
    } else {
      var html = '';
      for (var c = 0; c < proj.cards.length; c++) {
        var card = proj.cards[c];
        /* Найти привязанный артикул */
        var linkedSku = '';
        for (var a = 0; a < (proj.articles || []).length; a++) {
          if (proj.articles[a].cardIdx === c) {
            linkedSku = proj.articles[a].sku;
            break;
          }
        }
        var sel = (_arSelectedCard === c) ? ' ar-selected' : '';
        var thumb = '';
        if (card.slots && card.slots[0] && (card.slots[0].dataUrl || card.slots[0].thumbUrl)) {
          thumb = '<img class="ar-card-thumb" src="' + (card.slots[0].thumbUrl || card.slots[0].dataUrl) + '">';
        }
        html += '<div class="ar-match-item ar-card-item' + sel + '" onclick="arSelectCard(' + c + ')">';
        html += thumb;
        html += '<div class="ar-match-info">';
        html += '<div class="ar-match-num">Карточка ' + (c + 1) + '</div>';
        html += '<div class="ar-match-cat">' + esc(card.category || '') + '</div>';
        if (linkedSku) {
          html += '<div class="ar-match-sku">' + esc(linkedSku) + '</div>';
        }
        html += '</div></div>';
      }
      cardsEl.innerHTML = html;
    }
  }

  /* Артикулы */
  var skusEl = document.getElementById('ar-skus-list');
  if (skusEl) {
    if (!proj.articles || proj.articles.length === 0) {
      skusEl.innerHTML = '<div class="empty-state">Артикулы не загружены</div>';
    } else {
      var html2 = '';
      for (var s = 0; s < proj.articles.length; s++) {
        var art2 = proj.articles[s];
        var sel2 = (_arSelectedSku === s) ? ' ar-selected' : '';
        var matched = (art2.cardIdx >= 0) ? ' ar-matched' : '';
        html2 += '<div class="ar-match-item ar-sku-item' + sel2 + matched + '" onclick="arSelectSku(' + s + ')">';
        if (art2.refImage) {
          html2 += '<img class="ar-ref-thumb" src="' + art2.refImage + '">';
        }
        html2 += '<div class="ar-match-info">';
        html2 += '<div class="ar-match-sku">' + esc(art2.sku) + '</div>';
        html2 += '<div class="ar-match-cat">' + esc(art2.category || '') + '</div>';
        html2 += '</div></div>';
      }
      skusEl.innerHTML = html2;
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
 * Привязать артикул к карточке.
 * @param {number} skuIdx — индекс артикула
 * @param {number} cardIdx — индекс карточки
 */
function arDoMatch(skuIdx, cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  var art = proj.articles[skuIdx];
  if (!art) return;

  /* Снять предыдущую привязку артикула если была */
  art.cardIdx = cardIdx;
  art.status = 'matched';

  /* Обновить карточку */
  if (proj.cards && proj.cards[cardIdx]) {
    proj.cards[cardIdx].articleId = art.id;
  }

  arRenderChecklist();
  arRenderMatching();
  arUpdateStats();
  arCheckVerification();
  if (typeof shAutoSave === 'function') shAutoSave();
}


/**
 * Проверить: все артикулы привязаны? → показать блок верификации.
 */
function arCheckVerification() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  var allMatched = true;
  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].status === 'unmatched') {
      allMatched = false;
      break;
    }
  }

  var verifySection = document.getElementById('ar-verify-section');
  if (verifySection) {
    verifySection.style.display = allMatched ? '' : 'none';
    if (allMatched) arRenderVerification();
  }
}


/* ──────────────────────────────────────────────
   Блок 3: Верификация
   ────────────────────────────────────────────── */

/**
 * Отрисовать чек-лист верификации: артикул + ref-фото + фото из карточки.
 */
function arRenderVerification() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;
  var el = document.getElementById('ar-verify-list');
  if (!el) return;

  var html = '';
  for (var i = 0; i < proj.articles.length; i++) {
    var art = proj.articles[i];
    if (art.cardIdx < 0) continue;

    var card = (proj.cards && proj.cards[art.cardIdx]) ? proj.cards[art.cardIdx] : null;
    var cardThumb = '';
    if (card && card.slots && card.slots[0]) {
      cardThumb = card.slots[0].dataUrl || card.slots[0].thumbUrl || '';
    }

    var verified = (art.status === 'verified') ? ' ar-verified' : '';
    html += '<div class="ar-verify-item' + verified + '" data-idx="' + i + '" onclick="arToggleVerify(' + i + ')">';
    html += '<div class="ar-verify-ref">';
    if (art.refImage) {
      html += '<img src="' + art.refImage + '" alt="ref">';
    }
    html += '</div>';
    html += '<div class="ar-verify-info">';
    html += '<div class="ar-verify-sku">' + esc(art.sku) + '</div>';
    html += '<div class="ar-verify-cat">' + esc(art.category || '') + '</div>';
    html += '<div class="ar-verify-status">' + (art.status === 'verified' ? 'OK' : 'Не проверено') + '</div>';
    html += '</div>';
    html += '<div class="ar-verify-card">';
    if (cardThumb) {
      html += '<img src="' + cardThumb + '" alt="card">';
    }
    html += '</div>';
    html += '</div>';
  }
  el.innerHTML = html;
}


/**
 * Переключить статус верификации артикула.
 */
function arToggleVerify(idx) {
  var proj = getActiveProject();
  if (!proj || !proj.articles || !proj.articles[idx]) return;

  var art = proj.articles[idx];
  art.status = (art.status === 'verified') ? 'matched' : 'verified';

  arRenderChecklist();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
}


/**
 * Подтвердить все артикулы как верифицированные.
 */
function arConfirmAll() {
  var proj = getActiveProject();
  if (!proj || !proj.articles) return;

  for (var i = 0; i < proj.articles.length; i++) {
    if (proj.articles[i].status === 'matched') {
      proj.articles[i].status = 'verified';
    }
  }
  arRenderChecklist();
  arRenderVerification();
  arUpdateStats();
  if (typeof shAutoSave === 'function') shAutoSave();
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
   Импорт старого формата проекта (ekonika_data.json)
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
