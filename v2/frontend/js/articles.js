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

    /* PDF — сначала текстовый парсинг, потом AI фолбэк */
    if (ext === 'pdf') {
      var statusEl = document.getElementById('ar-stats');
      if (statusEl) statusEl.textContent = 'Парсинг PDF...';

      _arParsePdf(file, function(articles) {
        /* Проверить качество: мало результатов + есть AI ключ → фолбэк */
        if ((!articles || articles.length < 3) && _arGetOpenAIKey()) {
          console.log('articles.js: текстовый парсинг дал ' + (articles ? articles.length : 0) + ', пробую AI...');
          if (statusEl) statusEl.textContent = 'Текстовый парсинг: мало результатов, подключаю AI...';
          _arProcessPdfWithOpenAI(proj, file, _arGetOpenAIKey());
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

  var apiKey = _arGetOpenAIKey();
  if (!apiKey) {
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
 * Отправить изображение страницы в OpenAI Vision API.
 * Просит GPT-4o извлечь артикулы, категории, цвета.
 */
function _arCallOpenAIVision(apiKey, base64Image, pageNum, totalPages, callback) {
  var prompt = 'This is page ' + pageNum + ' of ' + totalPages + ' of a product catalog PDF.\n'
    + 'Extract ALL product article codes (SKUs) visible on this page.\n'
    + 'For each article, provide:\n'
    + '- "sku": the article/SKU code (e.g. "PL01056CN-13-black-26S")\n'
    + '- "category": product category if visible (shoes, bag, glasses, accessory, or empty)\n'
    + '- "color": color if visible in the SKU or near it\n'
    + '- "description": brief visual description of the product (1-2 words, e.g. "black heels", "red bag")\n\n'
    + 'Return ONLY valid JSON array: [{"sku":"...","category":"...","color":"...","description":"..."}]\n'
    + 'If no articles found on this page, return empty array: []\n'
    + 'Do NOT include any text before or after the JSON array.';

  var body = {
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/jpeg;base64,' + base64Image,
            detail: 'high'
          }
        }
      ]
    }],
    max_tokens: 4000,
    temperature: 0.1
  };

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = 60000;

  xhr.onload = function() {
    if (xhr.status !== 200) {
      console.error('OpenAI API error:', xhr.status, xhr.responseText);
      var errMsg = 'OpenAI API ошибка ' + xhr.status;
      try {
        var errData = JSON.parse(xhr.responseText);
        if (errData.error && errData.error.message) errMsg = errData.error.message;
      } catch(e) {}
      callback(errMsg, null);
      return;
    }

    try {
      var resp = JSON.parse(xhr.responseText);
      var content = resp.choices[0].message.content.trim();

      /* Извлечь JSON из ответа (может быть обёрнут в ```json ... ```) */
      var jsonStr = content;
      var jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      var articles = JSON.parse(jsonStr);
      callback(null, articles);
    } catch(e) {
      console.error('OpenAI parse error:', e, 'raw:', xhr.responseText);
      callback('Ошибка разбора ответа AI', null);
    }
  };

  xhr.onerror = function() {
    callback('Сетевая ошибка', null);
  };

  xhr.ontimeout = function() {
    callback('Таймаут запроса', null);
  };

  xhr.send(JSON.stringify(body));
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
      refImage: '',  /* OpenAI не возвращает картинки, только текст */
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

  /* Ключ может ещё загружаться (async) или pywebview ещё не готов.
     Активно пытаемся загрузить ключ при каждой попытке. */
  var attempts = 0;
  var maxAttempts = 12;
  var statusEl = document.getElementById('ar-stats');

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
      if (statusEl) statusEl.textContent = 'Ключ OpenAI не найден. Проверьте config.json';
      console.log('articles.js: ключ не найден после ' + maxAttempts + ' попыток');
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

  var apiKey = _arGetOpenAIKey();
  if (!apiKey) {
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

  var body = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: msgContent }],
    max_tokens: 200,
    temperature: 0.1
  };

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = 60000;

  xhr.onload = function() {
    if (statusEl) statusEl.textContent = '';
    if (xhr.status !== 200) {
      var errMsg = 'OpenAI ошибка ' + xhr.status;
      try { errMsg = JSON.parse(xhr.responseText).error.message; } catch(e) {}
      alert(errMsg);
      return;
    }
    try {
      var resp = JSON.parse(xhr.responseText);
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
  };

  xhr.onerror = function() { if (statusEl) statusEl.textContent = ''; alert('Сетевая ошибка'); };
  xhr.ontimeout = function() { if (statusEl) statusEl.textContent = ''; alert('Таймаут'); };
  xhr.send(JSON.stringify(body));
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

  var apiKey = _arGetOpenAIKey();
  if (!apiKey) {
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
  console.log('articles.js: arAutoMatchAll — ' + cards.length + ' cards, ' + skuList.length + ' articles, pdf=' + (_arLastPdfPath || 'none'));

  /* Стратегия: если есть PDF — отправляем страницы PDF, иначе refImage батчами */
  if (_arLastPdfPath && window.pywebview && window.pywebview.api && window.pywebview.api.pdf_pages_to_images) {
    if (statusEl) statusEl.textContent = 'Рендерю страницы PDF для AI...';
    window.pywebview.api.pdf_pages_to_images(_arLastPdfPath).then(function(result) {
      if (result && result.pages && result.pages.length > 0) {
        console.log('articles.js: PDF rendered — ' + result.pages.length + ' pages');
        _arMatchWithPdfPages(cards, skuList, result.pages, apiKey, proj, statusEl);
      } else {
        console.log('articles.js: PDF render failed, falling back to refImage');
        _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl);
      }
    }).catch(function(e) {
      console.error('articles.js: pdf_pages_to_images error:', e);
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

    /* Пересобрать свободные SKU (предыдущие могли быть привязаны) */
    var freeSkus = [];
    for (var a = 0; a < (proj.articles || []).length; a++) {
      if (proj.articles[a].cardIdx < 0) freeSkus.push({ idx: a, sku: proj.articles[a].sku });
    }

    if (freeSkus.length === 0) {
      idx = cards.length;
      processNext();
      return;
    }

    /* Построить промпт */
    var catHint = '';
    if (ci.category) {
      catHint = '\nIMPORTANT: This card is specifically for category: "' + ci.category + '".\n'
        + 'The photos may show a complete outfit (look) with multiple items, but you must ONLY match the '
        + ci.category + ' item. Ignore other items in the photo (bags, shoes, clothing that are NOT ' + ci.category + ').\n';
    } else {
      catHint = '\nWARNING: The photos may show a complete outfit (look) with multiple items.\n'
        + 'Focus on the MAIN SUBJECT — the item that is most prominent, centered, or shown in close-up.\n'
        + 'First determine what type of product this card is about (shoes, bag, clothing, accessory), '
        + 'then find ONLY that specific item in the checklist.\n';
    }

    var promptText = 'You receive TWO documents:\n\n'
      + 'DOCUMENT 1 — PRODUCT CARD: ' + ci.imgs.length + ' professional photos from a photoshoot.\n'
      + 'These photos show ONE specific product, possibly as part of a styled look/outfit.\n'
      + 'The CLOSE-UP photo (usually first) shows the target product best.\n'
      + catHint
      + '\nDOCUMENT 2 — CHECKLIST PDF: catalog pages with small reference photos and SKU codes.\n\n'
      + 'YOUR TASK: Match the SPECIFIC product from the card to its SKU in the checklist.\n'
      + 'Compare: shape, silhouette, color, material, texture, style, details (buckles, heels, straps, logo).\n\n'
      + 'Available SKUs (not yet matched):\n';
    for (var si = 0; si < freeSkus.length; si++) {
      promptText += '- "' + freeSkus[si].sku + '"\n';
    }
    promptText += '\nReturn ONLY JSON: {"match": "EXACT_SKU_STRING", "confidence": "high"} or {"match": null} if not found.\n'
      + 'WRONG match is worse than no match. If unsure, return null.';

    var msgContent = [];
    msgContent.push({ type: 'text', text: promptText });

    /* ДОКУМЕНТ 1: Фото карточки (до 3 ракурсов) */
    msgContent.push({ type: 'text', text: '=== DOCUMENT 1: PRODUCT CARD ===' });
    for (var k = 0; k < ci.imgs.length; k++) {
      var cUrl = ci.imgs[k];
      if (cUrl.indexOf('data:') !== 0 && cUrl.indexOf('http') !== 0) {
        cUrl = 'data:image/jpeg;base64,' + cUrl;
      }
      var label = (k === 0) ? 'Close-up / main photo' : 'Angle ' + (k + 1);
      msgContent.push({ type: 'text', text: '--- ' + label + ' ---' });
      msgContent.push({ type: 'image_url', image_url: { url: cUrl, detail: 'high' } });
    }

    /* ДОКУМЕНТ 2: Страницы PDF чек-листа */
    msgContent.push({ type: 'text', text: '=== DOCUMENT 2: CHECKLIST PDF ===' });
    for (var pi = 0; pi < pdfPages.length; pi++) {
      msgContent.push({ type: 'text', text: '--- Page ' + (pi + 1) + ' ---' });
      msgContent.push({ type: 'image_url', image_url: { url: pdfPages[pi], detail: 'high' } });
    }

    var body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: msgContent }],
      max_tokens: 200,
      temperature: 0.1
    };

    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
    xhr.timeout = 90000;

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          var text = resp.choices[0].message.content.trim();
          console.log('articles.js: card ' + ci.idx + ' AI (PDF) response:', text);
          var jsonMatch = text.match(/\{[\s\S]*\}/);
          var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
          if (result.match && result.match !== 'null' && result.match !== null) {
            /* Найти артикул по SKU */
            var matchedSku = String(result.match).trim();
            for (var fi = 0; fi < freeSkus.length; fi++) {
              if (freeSkus[fi].sku === matchedSku) {
                console.log('articles.js: card ' + ci.idx + ' -> ' + matchedSku);
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
      } else {
        console.error('articles.js: card ' + ci.idx + ' API error ' + xhr.status);
      }
      idx++;
      setTimeout(processNext, 2000);
    };
    xhr.onerror = function() { idx++; setTimeout(processNext, 2000); };
    xhr.ontimeout = function() { idx++; setTimeout(processNext, 2000); };
    xhr.send(JSON.stringify(body));
  }

  processNext();
}


/**
 * СТРАТЕГИЯ 2 (фолбэк): сопоставление через refImage батчами.
 * Когда PDF недоступен — отправляем refImage кандидатов группами по 12.
 */
function _arMatchWithRefImages(cards, proj, pvByName, apiKey, statusEl) {
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

    var candidates = [];
    for (var a = 0; a < (proj.articles || []).length; a++) {
      var art = proj.articles[a];
      if (art.cardIdx >= 0 || !art.refImage) continue;
      candidates.push({ idx: a, sku: art.sku, refImage: art.refImage });
    }

    if (candidates.length === 0) {
      idx = cards.length;
      processNext();
      return;
    }

    _arMatchOneCard(ci.idx, ci.imgs, candidates, apiKey, function(matchedArtIdx) {
      if (matchedArtIdx >= 0) {
        arDoMatch(matchedArtIdx, ci.idx);
        applied++;
        arRenderMatching();
      }
      idx++;
      setTimeout(processNext, 1500);
    });
  }

  processNext();
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
 * AI-сопоставление одной карточки с кандидатами.
 * Отправляет до 3 фото карточки (разные ракурсы) + до 12 refImage артикулов.
 * @param {number} cardIdx — индекс карточки
 * @param {string[]} cardImgs — массив URL/dataURL фото карточки (до 3 ракурсов)
 * @param {Array} candidates — [{idx, sku, refImage}]
 * @param {string} apiKey
 * @param {function} onDone — callback(matchedArtIdx) или callback(-1)
 */
function _arMatchOneCard(cardIdx, cardImgs, candidates, apiKey, onDone) {
  /* Ограничить кандидатов: 3 фото карточки + N артикулов, всего до ~18 картинок */
  var maxCandidates = Math.max(5, 18 - cardImgs.length);
  var cands = candidates.length > maxCandidates ? candidates.slice(0, maxCandidates) : candidates;

  var promptText = 'I have ' + cardImgs.length + ' photoshoot photos of the SAME product (different angles) and '
    + cands.length + ' catalog reference images.\n'
    + 'Which reference photo shows the SAME product as in the photoshoot? '
    + 'Compare shape, silhouette, color, material, style, details.\n\n';
  for (var i = 0; i < cands.length; i++) {
    promptText += '- A' + (i + 1) + ': "' + cands[i].sku + '"\n';
  }
  promptText += '\nReturn ONLY JSON: {"match": "A3", "confidence": "high"} or {"match": null} if none match.';

  var msgContent = [];
  msgContent.push({ type: 'text', text: promptText });

  /* Фото карточки — до 3 ракурсов */
  for (var k = 0; k < cardImgs.length; k++) {
    var cUrl = cardImgs[k];
    if (cUrl.indexOf('data:') !== 0 && cUrl.indexOf('http') !== 0) {
      cUrl = 'data:image/jpeg;base64,' + cUrl;
    }
    msgContent.push({ type: 'text', text: '--- CARD photo ' + (k + 1) + ' ---' });
    msgContent.push({ type: 'image_url', image_url: { url: cUrl, detail: 'low' } });
  }

  /* Фото кандидатов */
  for (var j = 0; j < cands.length; j++) {
    msgContent.push({ type: 'text', text: '--- A' + (j + 1) + ' ---' });
    msgContent.push({ type: 'image_url', image_url: { url: cands[j].refImage, detail: 'low' } });
  }

  var body = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: msgContent }],
    max_tokens: 150,
    temperature: 0.1
  };

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = 60000;

  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var resp = JSON.parse(xhr.responseText);
        var text = resp.choices[0].message.content.trim();
        console.log('articles.js: card ' + cardIdx + ' AI response:', text);
        var jsonMatch = text.match(/\{[\s\S]*\}/);
        var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        if (result.match && result.match !== 'null') {
          var artNum = parseInt(String(result.match).replace(/\D/g, ''), 10);
          var cand = cands[artNum - 1];
          if (cand) {
            console.log('articles.js: card ' + cardIdx + ' -> article ' + cand.sku);
            onDone(cand.idx);
            return;
          }
        }
      } catch(e) {
        console.error('articles.js: card ' + cardIdx + ' parse error:', e);
      }
    } else {
      console.error('articles.js: card ' + cardIdx + ' API error ' + xhr.status);
    }
    onDone(-1);
  };
  xhr.onerror = function() { console.error('articles.js: card ' + cardIdx + ' network error'); onDone(-1); };
  xhr.ontimeout = function() { console.error('articles.js: card ' + cardIdx + ' timeout'); onDone(-1); };
  xhr.send(JSON.stringify(body));
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

  var apiKey = _arGetOpenAIKey();
  if (!apiKey) {
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

  var body = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: content }],
    max_tokens: 2000,
    temperature: 0.1
  };

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.openai.com/v1/chat/completions', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
  xhr.timeout = 120000; /* 2 минуты на много изображений */

  xhr.onload = function() {
    if (xhr.status !== 200) {
      if (statusEl) statusEl.textContent = '';
      var errMsg = 'OpenAI ошибка ' + xhr.status;
      try {
        var errData = JSON.parse(xhr.responseText);
        if (errData.error && errData.error.message) errMsg = errData.error.message;
      } catch(e) {}
      alert('AI сопоставление: ' + errMsg);
      return;
    }

    try {
      var resp = JSON.parse(xhr.responseText);
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
        var confidence = match.confidence || 'low';

        /* Парсить индексы из A1, C3 и т.д. */
        var artNum = parseInt(artLabel.replace(/\D/g, ''), 10);
        var cardNum = parseInt(cardLabel.replace(/\D/g, ''), 10);
        if (!artNum || !cardNum) continue;

        var artEntry = arts[artNum - 1];
        var cardEntry = cards[cardNum - 1];
        if (!artEntry || !cardEntry) continue;

        /* Привязать */
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
      console.error('AI match parse error:', e, xhr.responseText);
      alert('Ошибка разбора ответа AI');
    }
  };

  xhr.onerror = function() {
    if (statusEl) statusEl.textContent = '';
    alert('Сетевая ошибка при обращении к OpenAI');
  };

  xhr.ontimeout = function() {
    if (statusEl) statusEl.textContent = '';
    alert('Таймаут запроса к OpenAI (2 минуты). Попробуйте с меньшим количеством артикулов.');
  };

  xhr.send(JSON.stringify(body));
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
