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
  arRenderVerification();
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
 */
function _arLoadViaBackend(proj) {
  /* Для больших PDF используем асинхронную версию с push-событием */
  window.onArticleParseDone = function(result) {
    if (result.error) {
      alert('Ошибка парсинга: ' + result.error);
      return;
    }
    var articles = _arConvertBackendResult(result.articles || []);
    _arApplyLoaded(proj, articles, result.file || 'файл');
  };

  var res = window.pywebview.api.parse_article_pdf_async();
  if (res && res.cancelled) return;
  if (res && res.error) {
    alert('Ошибка: ' + res.error);
    return;
  }
  /* Результат придёт через onArticleParseDone push-событие */
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
 * Browser: парсинг через JS (pdf.js, SheetJS, текст).
 * Фолбэк для работы без Python.
 */
function _arLoadViaBrowser(proj) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,.tsv,.txt,.xlsx,.xls,.pdf';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();

    /* PDF — асинхронный парсинг через pdf.js (без изображений) */
    if (ext === 'pdf') {
      _arParsePdf(file, function(articles) {
        _arApplyLoaded(proj, articles, file.name);
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
  console.log('articles.js: загружено ' + articles.length + ' артикулов из ' + fileName);
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
   ────────────────────────────────────────────── */

/**
 * Отрисовать панель сопоставления: карточки слева, артикулы справа.
 * Клик на карточку + клик на артикул = привязка.
 */
function arRenderMatching() {
  var proj = getActiveProject();
  if (!proj) return;

  /* Построить карту превью по имени файла для быстрого поиска */
  var pvByName = {};
  if (proj.previews) {
    for (var pi = 0; pi < proj.previews.length; pi++) {
      pvByName[proj.previews[pi].name] = proj.previews[pi];
    }
  }

  /* Карточки (слева) — показываем все фото из слотов */
  var cardsEl = document.getElementById('ar-cards-list');
  if (cardsEl) {
    if (!proj.cards || proj.cards.length === 0) {
      cardsEl.innerHTML = '<div class="empty-state">Нет карточек. Перейдите на вкладку "Контент".</div>';
    } else {
      var html = '';
      for (var c = 0; c < proj.cards.length; c++) {
        var card = proj.cards[c];
        /* Найти привязанный артикул */
        var linkedSku = '';
        var linkedIdx = -1;
        for (var a = 0; a < (proj.articles || []).length; a++) {
          if (proj.articles[a].cardIdx === c) {
            linkedSku = proj.articles[a].sku;
            linkedIdx = a;
            break;
          }
        }
        var sel = (_arSelectedCard === c) ? ' ar-selected' : '';
        var matchedCls = linkedSku ? ' ar-matched' : '';

        html += '<div class="ar-match-item ar-card-item' + sel + matchedCls + '" onclick="arSelectCard(' + c + ')">';

        /* Фото-полоска: все слоты карточки */
        html += '<div class="ar-card-photos">';
        if (card.slots) {
          var maxPhotos = Math.min(card.slots.length, 3);
          for (var si = 0; si < maxPhotos; si++) {
            var slot = card.slots[si];
            var imgSrc = slot.dataUrl || slot.thumbUrl || '';
            /* Если нет URL в слоте — попробовать найти в превью по file_name */
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

        /* Инфо: номер + привязанный артикул */
        html += '<div class="ar-match-info">';
        html += '<div class="ar-match-num">Карточка ' + (c + 1) + '</div>';
        if (linkedSku) {
          html += '<div class="ar-match-sku">' + esc(linkedSku) + '</div>';
          html += '<button class="ar-unmatch-btn" onclick="event.stopPropagation();arUnmatch(' + linkedIdx + ')">Отвязать</button>';
        }
        html += '</div></div>';
      }
      cardsEl.innerHTML = html;
    }
  }

  /* Артикулы (справа) — только несопоставленные сверху, потом сопоставленные */
  var skusEl = document.getElementById('ar-skus-list');
  if (skusEl) {
    if (!proj.articles || proj.articles.length === 0) {
      skusEl.innerHTML = '<div class="empty-state">Загрузите чек-лист</div>';
    } else {
      var html2 = '';
      /* Сначала несопоставленные */
      for (var s = 0; s < proj.articles.length; s++) {
        var art2 = proj.articles[s];
        if (art2.cardIdx >= 0) continue;
        var sel2 = (_arSelectedSku === s) ? ' ar-selected' : '';
        html2 += '<div class="ar-match-item ar-sku-item' + sel2 + '" onclick="arSelectSku(' + s + ')">';
        /* Референс-фото из каталога (если есть) */
        if (art2.refImage) {
          html2 += '<img class="ar-sku-ref" src="' + art2.refImage + '" alt="ref">';
        }
        html2 += '<div class="ar-match-info">';
        html2 += '<div class="ar-match-sku">' + esc(art2.sku) + '</div>';
        if (art2.category) html2 += '<div class="ar-match-cat">' + esc(art2.category) + '</div>';
        html2 += '</div></div>';
      }
      /* Потом сопоставленные (серые) */
      for (var s2 = 0; s2 < proj.articles.length; s2++) {
        var art3 = proj.articles[s2];
        if (art3.cardIdx < 0) continue;
        var cardNum = art3.cardIdx + 1;
        html2 += '<div class="ar-match-item ar-sku-item ar-matched">';
        /* Референс-фото */
        if (art3.refImage) {
          html2 += '<img class="ar-sku-ref" src="' + art3.refImage + '" alt="ref">';
        }
        html2 += '<div class="ar-match-info">';
        html2 += '<div class="ar-match-sku">' + esc(art3.sku) + '</div>';
        html2 += '<div class="ar-match-cat">-> Карточка ' + cardNum + '</div>';
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
    + '<span class="ar-verify-progress">' + verifiedCount + ' / ' + matchedItems.length + ' проверено</span>'
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
 * Подтвердить все сопоставленные артикулы как верифицированные.
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
