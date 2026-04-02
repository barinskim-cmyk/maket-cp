/* ══════════════════════════════════════════════
   cards.js — Редактор карточек товара
   ══════════════════════════════════════════════

   Зависит от: state.js (App, UserTemplates, getUserTemplate, slotAspectCSS,
               slotsConfigFromCard, addUserTemplate, esc, getActiveProject)
               layout.js (layBuildLayout, layFindPrimaryHero, layAutoRows, layResetWeight)

   Карточка = массив слотов. Каждый слот хранит:
     { orient: 'h'|'v', weight: 1|2, row: number|undefined, file, dataUrl, path }

   Шаблон = конфигурация слотов без файлов:
     { id, name, hAspect, vAspect, lockRows: bool, slots: [{orient, weight}] }

   Layout-движок v2 (justified rows) вынесен в layout.js.
   cards.js содержит UI карточки, слотов, шаблонного редактора.
   Обратно-совместимые обёртки cpFindHero/cpPackRows делегируют в layout.js.

   Функции с префиксом cp* — публичный API модуля.
*/

/** @type {number|null} Индекс слота-источника при drag между слотами */
var cpDragSourceSlot = null;

/** @type {number} Максимальная глубина undo-истории */
var CP_MAX_HISTORY = 10;


// ══════════════════════════════════════════════
//  Сайдбар: список карточек
// ══════════════════════════════════════════════

/**
 * Отрисовать список карточек в сайдбаре.
 * Подсвечивает активную карточку и показывает счётчик файлов.
 */
function cpRenderList() {
  var listEl = document.getElementById('cp-cards-list');
  var proj = getActiveProject();

  if (!proj || !proj.cards || proj.cards.length === 0) {
    listEl.innerHTML = '';
    cpShowEmpty();
    return;
  }

  if (App.currentCardIdx < 0 || App.currentCardIdx >= proj.cards.length) {
    App.currentCardIdx = 0;
  }

  var html = '';
  for (var i = 0; i < proj.cards.length; i++) {
    var c = proj.cards[i];
    var active = i === App.currentCardIdx ? ' active' : '';
    var fileCount = 0;
    if (c.slots) {
      for (var j = 0; j < c.slots.length; j++) {
        if (c.slots[j] && (c.slots[j].file || c.slots[j].dataUrl)) fileCount++;
      }
    }
    html += '<div class="cp-card-item' + active + '" onclick="cpShowCard(' + i + ')">';
    html += 'Карточка ' + (i + 1);
    html += ' <span class="count">(' + fileCount + '/' + (c.slots ? c.slots.length : 0) + ')</span>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  cpRenderCard();

  if (typeof pvRenderAll === 'function') pvRenderAll();
}

/**
 * Показать пустое состояние редактора.
 */
function cpShowEmpty() {
  var view = document.getElementById('cp-view');
  var proj = getActiveProject();
  view.innerHTML = '<div class="cp-empty">' +
    (proj ? 'Нет карточек. Нажмите "+ Новая карточка".' : 'Создайте или откройте съёмку') +
    '</div>';
}


// ══════════════════════════════════════════════
//  Добавление / удаление карточек
// ══════════════════════════════════════════════

/**
 * Создать новую карточку.
 *
 * Приоритет конфигурации слотов:
 * 1. Копия предыдущей карточки (если есть)
 * 2. Шаблон проекта (proj.templateId → UserTemplates)
 * 3. Стартовый пресет: 4 вертикали
 */
function cpAddCard() {
  var proj = getActiveProject();
  if (!proj) { alert('Сначала создайте или откройте съёмку'); return; }

  var slotsConfig;

  /* 1. Копировать конфигурацию предыдущей карточки */
  if (proj.cards && proj.cards.length > 0) {
    var prevCard = proj.cards[proj.cards.length - 1];
    slotsConfig = slotsConfigFromCard(prevCard);
  }

  /* 2. proj._template (установленный через редактор шаблона) */
  if (!slotsConfig || slotsConfig.length === 0) {
    if (proj._template && proj._template.slots && proj._template.slots.length > 0) {
      slotsConfig = proj._template.slots.map(function(s) {
        return { orient: s.orient || 'v', weight: s.weight || 1, main: false };
      });
    }
  }

  /* 3. Шаблон проекта (UserTemplates) */
  if (!slotsConfig || slotsConfig.length === 0) {
    if (proj.templateId) {
      var tmpl = getUserTemplate(proj.templateId);
      if (tmpl && tmpl.slots) {
        slotsConfig = tmpl.slots.map(function(s) {
          return { orient: s.orient || 'v', main: !!s.main };
        });
      }
    }
  }

  /* 4. Фолбэк: 4 вертикали */
  if (!slotsConfig || slotsConfig.length === 0) {
    slotsConfig = [
      { orient: 'v', main: false },
      { orient: 'v', main: false },
      { orient: 'v', main: false },
      { orient: 'v', main: false }
    ];
  }

  /* Создать слоты с пустыми файлами.
     weight: из шаблона/предыдущей карточки, или дефолт (первый=2, остальные=1) */
  var slots = slotsConfig.map(function(s, idx) {
    return {
      orient: s.orient || 'v',
      weight: s.weight || (idx === 0 ? 2 : 1),
      aspect: s.aspect || null,
      file: null, dataUrl: null, path: null
    };
  });

  var card = {
    id: Math.random().toString(36).substr(2, 8),
    category: '',
    slots: slots
  };

  /* Копировать параметры шаблона в карточку: prev card > proj._template > proj.templateId */
  var prevCard = (proj.cards && proj.cards.length > 0) ? proj.cards[proj.cards.length - 1] : null;
  var projTmpl = proj._template || null;
  var userTmpl = proj.templateId ? getUserTemplate(proj.templateId) : null;

  card._hAspect = (prevCard && prevCard._hAspect) || (projTmpl && projTmpl.hAspect) || (userTmpl && userTmpl.hAspect) || null;
  card._vAspect = (prevCard && prevCard._vAspect) || (projTmpl && projTmpl.vAspect) || (userTmpl && userTmpl.vAspect) || null;
  card._lockRows = (prevCard && prevCard._lockRows) || (projTmpl && projTmpl.lockRows) || (userTmpl && userTmpl.lockRows) || false;
  if (prevCard && prevCard._hasHero !== undefined) card._hasHero = prevCard._hasHero;
  else if (projTmpl && projTmpl.hasHero !== undefined) card._hasHero = projTmpl.hasHero;
  else if (userTmpl && userTmpl.hasHero !== undefined) card._hasHero = userTmpl.hasHero;

  if (!proj.cards) proj.cards = [];
  proj.cards.push(card);
  App.currentCardIdx = proj.cards.length - 1;
  cpRenderList();
}

/**
 * Удалить карточку по индексу.
 * @param {number} idx
 */
function cpDeleteCard(idx) {
  var proj = getActiveProject();
  if (!proj || proj.cards.length <= 0) return;
  if (!confirm('Удалить карточку ' + (idx + 1) + '?')) return;

  proj.cards.splice(idx, 1);
  if (App.currentCardIdx >= proj.cards.length) {
    App.currentCardIdx = proj.cards.length - 1;
  }
  cpRenderList();
}


// ══════════════════════════════════════════════
//  Навигация по карточкам
// ══════════════════════════════════════════════

/**
 * Показать карточку по индексу.
 * @param {number} idx
 */
function cpShowCard(idx) {
  App.currentCardIdx = idx;
  cpRenderList();
}


// ══════════════════════════════════════════════
//  Layout-движок v2 — делегирует в layout.js
// ══════════════════════════════════════════════
//
//  Вся логика раскладки в layout.js (justified rows).
//  Здесь остаются только обратно-совместимые обёртки
//  для вызовов из template editor и других модулей.
// ══════════════════════════════════════════════

/**
 * Обратно-совместимая обёртка: найти hero (делегирует в layout.js).
 * @param {Array} slots
 * @returns {number}
 */
function cpFindHero(slots) {
  return layFindPrimaryHero(slots);
}

/**
 * Обратно-совместимая обёртка: упаковать слоты в ряды.
 * Используется в teRefreshPreview (template editor).
 * @param {Array} slots
 * @returns {Array<Array<number>>} массив рядов (индексы)
 */
function cpPackRows(slots) {
  return layAutoRows(slots, '3/2', '2/3');
}


// ══════════════════════════════════════════════
//  Рендеринг карточки
// ══════════════════════════════════════════════

/**
 * Главная функция рендеринга карточки.
 * Строит тулбар (категории, шаблон, +/-), layout, имена файлов, навигацию.
 */
function cpRenderCard() {
  var view = document.getElementById('cp-view');
  var proj = getActiveProject();
  if (!proj || !proj.cards || App.currentCardIdx < 0) { cpShowEmpty(); return; }

  var card = proj.cards[App.currentCardIdx];
  var idx = App.currentCardIdx;
  var totalSlots = card.slots ? card.slots.length : 0;

  var html = '';

  /* ── Мета + тулбар ── */
  html += '<div class="cp-meta">';
  html += '<span class="num">Карточка ' + (idx + 1) + '</span>';
  html += '<div class="cp-toolbar">';

  /* Редактор шаблона — основной способ настройки */
  html += '<button class="btn btn-sm" onclick="cpOpenTemplateEditor()">Редактировать шаблон</button>';

  /* Быстрые кнопки +V/+H */
  html += '<div class="cp-slot-controls">';
  html += '<button class="btn btn-sm" onclick="cpAddSlot(\'v\')" title="Добавить вертикаль">+ V</button>';
  html += '<button class="btn btn-sm" onclick="cpAddSlot(\'h\')" title="Добавить горизонталь">+ H</button>';
  if (totalSlots > 1) {
    html += '<button class="btn btn-sm" onclick="cpRemoveLastSlot()" title="Убрать последний слот">-</button>';
  }
  html += '</div>';

  /* Быстрое сохранение как шаблон */
  html += '<button class="btn btn-sm" onclick="cpSaveAsTemplate()">Сохранить шаблон</button>';

  /* Удалить карточку */
  html += '<button class="delete-card-btn" onclick="cpDeleteCard(' + idx + ')">Удалить</button>';
  html += '</div></div>';

  /* ── Layout карточки ── */
  var tmpl = getUserTemplate(proj.templateId);
  var projTmpl = proj._template || null;
  /* Card-level overrides > proj._template > UserTemplate > defaults */
  var cardHasHero = (card._hasHero !== undefined) ? card._hasHero :
    (projTmpl && projTmpl.hasHero !== undefined ? projTmpl.hasHero :
    (tmpl && tmpl.hasHero !== undefined ? tmpl.hasHero : undefined));
  var layTmpl = {
    hAspect: card._hAspect || (projTmpl && projTmpl.hAspect) || (tmpl && tmpl.hAspect) || '3/2',
    vAspect: card._vAspect || (projTmpl && projTmpl.vAspect) || (tmpl && tmpl.vAspect) || '2/3',
    lockRows: card._lockRows || (projTmpl && projTmpl.lockRows) || (tmpl && tmpl.lockRows) || false,
    hasHero: cardHasHero
  };
  html += layBuildLayout(card, layTmpl, function(si) { return cpSlotHTML(si, undefined, cardHasHero); });

  /* ── Имена файлов ── */
  html += '<div class="cp-file-names">';
  for (var fi = 0; fi < totalSlots; fi++) {
    var sl = card.slots[fi];
    if (sl && sl.file) html += '<span>' + esc(sl.file) + '</span>';
  }
  html += '</div>';

  /* ── Навигация ── */
  var histLen = (card._history && card._history.length) || 0;
  var total = proj.cards.length;
  html += '<div class="cp-nav-row">';
  html += '<button class="cp-nav-btn" onclick="cpShowCard(' + (idx - 1) + ')"' + (idx === 0 ? ' disabled' : '') + '>Назад</button>';
  html += '<button class="undo-btn" onclick="cpUndo()"' + (histLen === 0 ? ' disabled' : '') + '>Отменить' + (histLen ? ' (' + histLen + ')' : '') + '</button>';
  html += '<button class="cp-nav-btn" onclick="cpShowCard(' + (idx + 1) + ')"' + (idx >= total - 1 ? ' disabled' : '') + '>Вперёд</button>';
  html += '</div>';

  view.innerHTML = html;

  /* JS-sizing: пересчитать px-размеры landscape rest-ячеек.
     requestAnimationFrame даёт браузеру отрисовать grid/flex перед замером. */
  requestAnimationFrame(function() { layApplySizes(view); });

  /* Инициализировать resize-listener (idempotent — обновляет root) */
  layInitResize(view);

  cpBindSlotEvents();
}

// ══════════════════════════════════════════════
//  Слоты: HTML + управление
// ══════════════════════════════════════════════

/**
 * Сгенерировать HTML одного слота.
 *
 * Каждый слот показывает:
 * - Фото (если есть) или плейсхолдер "Перетащите фото"
 * - Тулбар: кнопка ориентации (H/V), кнопка main (M)
 * - Кнопку удаления фото (x)
 *
 * @param {number} slotIdx — индекс слота в card.slots[]
 * @param {number} [span]  — сколько grid-колонок занимает (из cpPackRows)
 * @returns {string} HTML
 */
/**
 * HTML для одного слота. НЕ задаёт размеры — размеры контролирует layout.
 * photo-slot заполняет контейнер (lay-cell / lay-cell-ls / lay-hero-col).
 *
 * @param {number}  slotIdx  — индекс слота в card.slots
 * @param {*}       span     — не используется (legacy, оставлен для совместимости)
 * @param {boolean} hasHero  — есть ли заглавное фото
 */
function cpSlotHTML(slotIdx, span, hasHero) {
  var proj = getActiveProject();
  var card = proj.cards[App.currentCardIdx];
  var slot = card.slots[slotIdx];
  var orient = slot.orient || 'v';
  var isHero = (hasHero === true && slotIdx === 0);

  var mainCls = isHero ? ' main-slot' : '';

  /* Тулбар слота: только лупа (ориентация и поворот временно скрыты) */
  var toolbar = '<div class="slot-toolbar"></div>';

  if (slot.dataUrl || slot.file) {
    var src = slot.dataUrl || slot.thumbUrl || '';
    /* Если нет ни dataUrl ни thumbUrl — показать пустой слот (не битую картинку) */
    if (!src && slot.file && typeof slot.file === 'string') {
      src = 'images/' + slot.file;
    }
    if (!src) {
      /* Файл привязан но картинки нет — показать как пустой */
      return '<div class="photo-slot empty' + mainCls + '" data-slot="' + slotIdx + '">' +
        '<div class="ph-text">' + esc(slot.file || 'Нет изображения') + '</div>' +
        '</div>';
    }
    var rot = slot.rotation || 0;
    var rotStyle = rot ? ' style="transform:rotate(' + rot + 'deg)"' : '';
    /* Кнопка увеличения: прямо на фото, иконка expand */
    var expandSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    var zoomBtn = '<button class="slot-expand" onclick="cpShowFullscreen(' + slotIdx + ',event)" title="На весь экран">' + expandSvg + '</button>';
    return '<div class="photo-slot filled' + mainCls + '" data-slot="' + slotIdx + '" draggable="true">' +
      '<img src="' + src + '" loading="lazy"' + rotStyle + ' onerror="this.parentNode.classList.add(\'img-error\')">' +
      zoomBtn +
      '<button class="remove-btn" onclick="cpClearSlotPhoto(' + slotIdx + ',event)">&times;</button></div>';
  }

  return '<div class="photo-slot empty' + mainCls + '" data-slot="' + slotIdx + '">' +
    '<div class="ph-text">' + (isHero ? 'Заглавное' : 'Перетащите фото') + '</div>' +
    toolbar +
    '</div>';
}

/**
 * Добавить пустой слот в конец карточки.
 * @param {string} orient — 'v' (вертикаль) или 'h' (горизонталь)
 */
function cpAddSlot(orient) {
  var card = getActiveProject().cards[App.currentCardIdx];
  cpSaveHistory();
  card.slots.push({ orient: orient || 'v', weight: 1, file: null, dataUrl: null, path: null });
  cpRenderCard();
  cpRenderList();
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Убрать последний слот из карточки.
 */
function cpRemoveLastSlot() {
  var card = getActiveProject().cards[App.currentCardIdx];
  if (card.slots.length <= 1) return;
  cpSaveHistory();
  card.slots.pop();
  cpSyncFiles(card);
  cpRenderCard();
  cpRenderList();
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Переключить ориентацию слота: h ↔ v.
 * Фото остаётся, просто кадрируется под новый aspect.
 * @param {number} slotIdx
 * @param {Event} e
 */
function cpToggleOrient(slotIdx, e) {
  e.stopPropagation();
  var card = getActiveProject().cards[App.currentCardIdx];
  cpSaveHistory();
  card.slots[slotIdx].orient = (card.slots[slotIdx].orient === 'h') ? 'v' : 'h';
  cpRenderCard();
}

/**
 * Повернуть фото в слоте на 90 по часовой стрелке.
 * Сохраняет rotation в slot.rotation (0, 90, 180, 270).
 * @param {number} slotIdx
 * @param {Event} e
 */
function cpRotateSlot(slotIdx, e) {
  e.stopPropagation();
  var card = getActiveProject().cards[App.currentCardIdx];
  cpSaveHistory();
  var slot = card.slots[slotIdx];
  slot.rotation = ((slot.rotation || 0) + 90) % 360;
  cpRenderCard();
}

// ══════════════════════════════════════════════
//  Полноэкранный просмотр фото
// ══════════════════════════════════════════════

/**
 * Показать фото из слота на весь экран (оверлей).
 * Изображение масштабируется по высоте окна с сохранением пропорций.
 * Закрытие: крестик, клик по фону, Escape.
 * @param {number} slotIdx
 * @param {Event} e
 */
var _cpFullscreenActive = false;

function cpShowFullscreen(slotIdx, e) {
  e.stopPropagation();
  var card = getActiveProject().cards[App.currentCardIdx];
  var slot = card.slots[slotIdx];
  if (!slot || (!slot.file && !slot.dataUrl)) return;

  _cpFullscreenActive = true;

  /* Для начала показываем то что есть (preview/thumb), потом догружаем оригинал */
  var src = slot.dataUrl || ('images/' + slot.file);
  var rot = slot.rotation || 0;
  var rotStyle = rot ? 'transform:rotate(' + rot + 'deg)' : '';

  /* Создаём оверлей */
  var overlay = document.createElement('div');
  overlay.className = 'cp-fullscreen-overlay';
  overlay.onclick = function(ev) { if (ev.target === overlay) cpCloseFullscreen(); };

  var img = document.createElement('img');
  img.src = src;
  img.className = 'cp-fullscreen-img';
  if (rotStyle) img.style.cssText = rotStyle;

  var closeBtn = document.createElement('button');
  closeBtn.className = 'cp-fullscreen-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = cpCloseFullscreen;

  /* Имя файла */
  var nameEl = document.createElement('div');
  nameEl.className = 'cp-fullscreen-name';
  nameEl.textContent = slot.file || '';

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(nameEl);
  document.body.appendChild(overlay);

  /* Escape для закрытия */
  document.addEventListener('keydown', cpFullscreenEscHandler);

  /* Desktop: подгружаем оригинал через бэкенд (pywebview) */
  if (slot.path && window.pywebview && window.pywebview.api) {
    window.pywebview.api.get_full_image(slot.path).then(function(result) {
      if (result && result.data_url) {
        /* Подменяем src на оригинал (если оверлей ещё открыт) */
        var currentOverlay = document.querySelector('.cp-fullscreen-overlay');
        if (currentOverlay) {
          var fullImg = currentOverlay.querySelector('.cp-fullscreen-img');
          if (fullImg) fullImg.src = result.data_url;
        }
      }
    });
  }
}

/**
 * Закрыть полноэкранный оверлей.
 */
function cpCloseFullscreen() {
  var overlay = document.querySelector('.cp-fullscreen-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', cpFullscreenEscHandler);
  _cpFullscreenActive = false;
  /* Перерисовать карточку (восстановить layout после фулскрина) */
  if (typeof cpRenderCard === 'function') cpRenderCard();
}

/** Обработчик Escape для закрытия оверлея */
function cpFullscreenEscHandler(e) {
  if (e.key === 'Escape') cpCloseFullscreen();
}

/**
 * Переключить визуальный вес слота: 1 → 2 → 1.
 * Только один слот может иметь weight > 1 — при увеличении сбрасывает остальные.
 * @param {number} slotIdx
 * @param {Event} e
 */
function cpToggleWeight(slotIdx, e) {
  e.stopPropagation();
  var card = getActiveProject().cards[App.currentCardIdx];
  cpSaveHistory();

  var curWeight = card.slots[slotIdx].weight || 1;

  /* Toggle: 1 → 2, 2 → 1 (без сброса остальных — поддержка нескольких hero) */
  card.slots[slotIdx].weight = (curWeight >= 2) ? 1 : 2;

  cpRenderCard();
}

/**
 * Очистить фото из слота (убрать файл, оставить слот).
 * @param {number} slotIdx
 * @param {Event} e
 */
function cpClearSlotPhoto(slotIdx, e) {
  e.stopPropagation();
  cpSaveHistory();
  var card = getActiveProject().cards[App.currentCardIdx];
  card.slots[slotIdx].file = null;
  card.slots[slotIdx].dataUrl = null;
  card.slots[slotIdx].thumbUrl = null;
  card.slots[slotIdx].path = null;
  cpSyncFiles(card);
  cpRenderCard();
  cpRenderList();
  if (typeof shAutoSave === 'function') shAutoSave();
  /* Авто-синхронизация для клиента */
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
}


// ══════════════════════════════════════════════
//  Редактор шаблона
// ══════════════════════════════════════════════

/**
 * Рабочий массив слотов редактора шаблона.
 * Каждый элемент: {orient: 'h'|'v', weight: 1|2}
 * Порядок можно менять drag-and-drop. Клик по слоту в превью переключает weight.
 * @type {Array}
 */
var teSlots = [];

/** @type {boolean} Есть ли заглавное фото (первый слот = hero) */
var teHasHero = true;

/** @type {number} Количество рядов в rest-зоне (задаётся пользователем) */
var teRowCount = 1;

/** @type {number|null} Индекс перетаскиваемого слота в превью редактора */
var teDragIdx = null;

/**
 * Открыть редактор шаблона.
 * Инициализирует состояние из текущей карточки (если есть).
 */
/**
 * Открыть модальное окно редактора шаблонов.
 * Инициализирует teSlots и параметры из карточки, проекта или дефолтов.
 * Приоритет: карточка > proj._template > proj.templateId > дефолт.
 */
function cpOpenTemplateEditor() {
  var card = null;
  var proj = getActiveProject();
  if (proj && proj.cards && App.currentCardIdx >= 0) {
    card = proj.cards[App.currentCardIdx];
  }

  /* Инициализировать слоты из карточки или дефолт */
  if (card && card.slots && card.slots.length > 0) {
    teSlots = card.slots.map(function(s) {
      return { orient: s.orient || 'v', weight: s.weight || 1 };
    });
  } else {
    teSlots = [
      { orient: 'v', weight: 2 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 }
    ];
  }

  /* Определить текущие аспекты из карточки или шаблона проекта.
     Приоритет: карточка > proj._template > proj.templateId > дефолт */
  var hAspect = '3/2';
  var vAspect = '2/3';
  if (card && card._hAspect) hAspect = card._hAspect;
  else if (proj && proj._template) {
    hAspect = proj._template.hAspect || '3/2';
    vAspect = proj._template.vAspect || '2/3';
  } else if (proj && proj.templateId) {
    var tmpl = getUserTemplate(proj.templateId);
    if (tmpl) { hAspect = tmpl.hAspect || '3/2'; vAspect = tmpl.vAspect || '2/3'; }
  }
  if (card && card._vAspect) vAspect = card._vAspect;

  /* lockRows убран из UI — авторяды всегда работают в редакторе */

  /* hasHero: из карточки или шаблона проекта.
     Приоритет: карточка > proj._template > proj.templateId > дефолт */
  teHasHero = true; /* по умолчанию = есть заглавное */
  if (card && card._hasHero !== undefined) teHasHero = card._hasHero;
  else if (proj && proj._template && proj._template.hasHero !== undefined) {
    teHasHero = proj._template.hasHero;
  } else if (proj && proj.templateId) {
    var tmpl3 = getUserTemplate(proj.templateId);
    if (tmpl3 && tmpl3.hasHero !== undefined) teHasHero = tmpl3.hasHero;
  }
  document.getElementById('te-has-hero').checked = teHasHero;

  /* Количество рядов: из slot.row (если уже заданы) или авто.
     Portrait: hero H = ряд, teRowCount включает его.
     Landscape: hero V = столбец, teRowCount = только rest-ряды. */
  if (teSlots.length > 0) {
    var maxR = 0;
    for (var ri = 0; ri < teSlots.length; ri++) {
      if (teSlots[ri].row !== undefined && teSlots[ri].row > maxR) maxR = teSlots[ri].row;
    }
    if (maxR > 0) {
      /* Ряды заданы в модели — восстановить.
         Для portrait добавить +1 за hero-ряд. */
      var heroI2 = layFindPrimaryHero(teSlots, teHasHero);
      var isP = heroI2 >= 0 && teSlots[heroI2].orient === 'h';
      teRowCount = (maxR + 1) + (isP ? 1 : 0);
    } else {
      teAutoRowCount();
    }
  } else {
    teRowCount = 2;
  }
  teDistributeRows();

  /* Заполнить select-ы пропорций */
  tePopulateAspectSelects(hAspect, vAspect);

  /* Имя */
  document.getElementById('te-name').value = '';

  /* Обновить счётчики */
  teUpdateCounts();

  /* Сначала открыть модалку, потом рендерить превью —
     иначе layApplySizes получит heroHeight=0 (DOM скрыт). */
  openModal('modal-tmpl-editor');
  teRefreshPreview();
}

/**
 * Заполнить select-ы пропорций вариантами из H_ASPECTS / V_ASPECTS.
 * @param {string} hVal — текущее значение для горизонталей
 * @param {string} vVal — текущее значение для вертикалей
 */
function tePopulateAspectSelects(hVal, vVal) {
  var hSel = document.getElementById('te-h-aspect');
  var vSel = document.getElementById('te-v-aspect');
  hSel.innerHTML = '';
  vSel.innerHTML = '';
  for (var i = 0; i < H_ASPECTS.length; i++) {
    var o = document.createElement('option');
    o.value = H_ASPECTS[i];
    o.textContent = ASPECT_LABELS[H_ASPECTS[i]] || H_ASPECTS[i];
    if (H_ASPECTS[i] === hVal) o.selected = true;
    hSel.appendChild(o);
  }
  for (var j = 0; j < V_ASPECTS.length; j++) {
    var o2 = document.createElement('option');
    o2.value = V_ASPECTS[j];
    o2.textContent = ASPECT_LABELS[V_ASPECTS[j]] || V_ASPECTS[j];
    if (V_ASPECTS[j] === vVal) o2.selected = true;
    vSel.appendChild(o2);
  }
}

/**
 * Обновить отображение счётчиков V и H.
 */
function teUpdateCounts() {
  var vc = 0, hc = 0;
  for (var i = 0; i < teSlots.length; i++) {
    if (teSlots[i].orient === 'h') hc++; else vc++;
  }
  document.getElementById('te-v-count').textContent = String(vc);
  document.getElementById('te-h-count').textContent = String(hc);

  /* Подсчитать реальное кол-во рядов из slot.row + hero-ряд для portrait */
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  var isPortrait = heroI >= 0 && teSlots[heroI].orient === 'h';
  var maxRow = _teMaxRow();
  var actualRows = maxRow + 1 + (isPortrait ? 1 : 0);
  teRowCount = actualRows;
  document.getElementById('te-row-count').textContent = String(teRowCount);
}

/**
 * Изменить количество рядов в rest-зоне.
 * @param {number} delta — +1 или -1
 */
function teAdjustRows(delta) {
  var newCount = teRowCount + delta;
  /* Минимум: portrait = 2 (hero + 1 rest), иначе = 1 */
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  var isPortrait = heroI >= 0 && teSlots[heroI].orient === 'h';
  var minRows = isPortrait ? 2 : 1;
  if (newCount < minRows) newCount = minRows;
  if (newCount > 6) newCount = 6;
  teRowCount = newCount;
  teDistributeRows();
  teUpdateCounts();
  teRefreshPreview();
}

/**
 * Равномерно распределить rest-слоты по teRowCount рядам.
 * Hero (weight>1) не участвует — он на своём месте (сверху или слева).
 * Остальные слоты раскидываются: каждый ряд получает примерно одинаковое
 * количество слотов.
 */
/**
 * Автоматически рассчитать teRowCount по правилам раскладки.
 * Portrait: hero H = 1 ряд, итого teRowCount = restRows + 1.
 * Landscape: hero V = столбец, teRowCount = restRows.
 * Equal: teRowCount = restRows.
 */
function teAutoRowCount() {
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  var restCount = heroI >= 0 ? teSlots.length - 1 : teSlots.length;
  var isLandscape = heroI >= 0 && teSlots[heroI].orient === 'v';
  var isPortrait  = heroI >= 0 && teSlots[heroI].orient === 'h';

  var restRows;
  if (isLandscape) {
    /* Landscape rest: 1-2→1 ряд, 3-6→2 ряда, 7+→3 (overflow) */
    if (restCount <= 2) restRows = 1;
    else if (restCount <= 6) restRows = 2;
    else restRows = 3;
  } else {
    /* Equal / Portrait rest: 3-й ряд когда > 4 на ряд (9+ слотов) */
    if (restCount <= 4) restRows = 1;
    else if (restCount <= 8) restRows = 2;
    else restRows = 3;
  }

  /* Portrait: hero H сам по себе ряд */
  teRowCount = isPortrait ? restRows + 1 : restRows;
}

/**
 * Сколько рядов отводится под rest-слоты (без hero-ряда).
 * Portrait: hero занимает 1 ряд, остаётся teRowCount - 1.
 * Landscape / Equal: все ряды = rest.
 */
function _teRestRowCount() {
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  var isPortrait = heroI >= 0 && teSlots[heroI].orient === 'h';
  return isPortrait ? Math.max(1, teRowCount - 1) : teRowCount;
}

function teDistributeRows() {
  /* Собрать rest-слоты (не hero) */
  var heroIdx = layFindPrimaryHero(teSlots, teHasHero);
  var restIdxs = [];
  for (var i = 0; i < teSlots.length; i++) {
    if (i !== heroIdx) restIdxs.push(i);
  }

  /* Распределить по рядам: portrait отнимает 1 ряд под hero */
  var effectiveRows = _teRestRowCount();

  /* Overflow в landscape: bottom-ряд шире (hero+rest), получает больше слотов */
  var isLandscape = heroIdx >= 0 && teSlots[heroIdx].orient === 'v';
  var isOverflow = isLandscape && effectiveRows >= 3;

  var distribution;
  if (isOverflow) {
    /* 2 side-ряда + остаток в bottom (bottom шире, ~5/3 rest) */
    distribution = _layDistributeOverflow(restIdxs.length, 2);
  } else {
    distribution = _layDistributeEvenly(restIdxs.length, effectiveRows);
  }

  for (var r = 0; r < distribution.length; r++) {
    for (var j = 0; j < distribution[r].length; j++) {
      var localIdx = distribution[r][j];
      teSlots[restIdxs[localIdx]].row = r;
    }
  }
}

/**
 * Добавить или убрать слот определённой ориентации.
 * Авто-пересчёт рядов если lockRows не зафиксирован.
 * @param {string} orient — 'v' или 'h'
 * @param {number} delta — +1 или -1
 */
function teAdjust(orient, delta) {
  if (delta > 0) {
    /* Новый слот — в последний ряд, не трогая ручную расстановку */
    var lastRow = _teMaxRow();
    teSlots.push({ orient: orient, weight: 1, row: lastRow });
  } else {
    /* Убрать последний слот с этой ориентацией.
       Hero (idx 0 при hasHero) защищён от удаления. */
    for (var i = teSlots.length - 1; i >= 0; i--) {
      if (teHasHero && i === 0) continue; /* не удалять hero */
      if (teSlots[i].orient === orient) {
        teSlots.splice(i, 1);
        break;
      }
    }
    _teCompactRows(); /* убрать пустые ряды после удаления */
  }
  teUpdateCounts();
  teRefreshPreview();
}

/**
 * Добавить слот в конкретный ряд (из кнопки «+» в превью).
 * @param {number} row — номер ряда
 */
function teAddSlotToRow(row) {
  /* Вставить V-слот после последнего слота этого ряда */
  var insertAt = 0;
  for (var i = 0; i < teSlots.length; i++) {
    if (teSlots[i].row === row || teSlots[i].row <= row) insertAt = i + 1;
  }
  teSlots.splice(insertAt, 0, { orient: 'v', weight: 1, row: row });
  teUpdateCounts();
  teRefreshPreview();
}

/**
 * Максимальный номер ряда среди rest-слотов.
 */
function _teMaxRow() {
  var max = 0;
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  for (var i = 0; i < teSlots.length; i++) {
    if (i === heroI) continue;
    if (teSlots[i].row !== undefined && teSlots[i].row > max) max = teSlots[i].row;
  }
  return max;
}

/**
 * Убрать пустые ряды: если ряд 1 пуст (всё перетащили), сдвинуть номера вниз.
 * Пример: row 0 = [A,B,C], row 1 = [], row 2 = [D] → row 0 = [A,B,C], row 1 = [D].
 */
function _teCompactRows() {
  var heroI = layFindPrimaryHero(teSlots, teHasHero);
  /* Собрать уникальные row-номера rest-слотов */
  var usedRows = {};
  for (var i = 0; i < teSlots.length; i++) {
    if (i === heroI) continue;
    var r = teSlots[i].row || 0;
    usedRows[r] = true;
  }
  /* Построить маппинг старый → новый (без дырок) */
  var sorted = Object.keys(usedRows).map(Number).sort(function(a, b) { return a - b; });
  var remap = {};
  for (var n = 0; n < sorted.length; n++) {
    remap[sorted[n]] = n;
  }
  /* Применить */
  for (var i = 0; i < teSlots.length; i++) {
    if (i === heroI) continue;
    var oldRow = teSlots[i].row || 0;
    if (remap[oldRow] !== undefined) teSlots[i].row = remap[oldRow];
  }
}

/**
 * Переключить галочку "Заглавное фото" в редакторе шаблона.
 * hasHero=true → первый слот = hero, его ориентация определяет раскладку.
 * hasHero=false → все слоты равные (justified rows).
 */
function teToggleHasHero() {
  teHasHero = document.getElementById('te-has-hero').checked;
  teAutoRowCount();
  teDistributeRows();
  teUpdateCounts();
  teRefreshPreview();
}

/**
 * Перерисовать превью шаблона в редакторе.
 * Использует тот же hero-based layout что и в карточке.
 */
function teRefreshPreview() {
  var el = document.getElementById('te-preview');
  if (teSlots.length === 0) { el.innerHTML = '<div class="te-empty">Добавьте слоты</div>'; return; }

  var hAspect = document.getElementById('te-h-aspect').value;
  var vAspect = document.getElementById('te-v-aspect').value;

  /* Используем layout.js (v2) с lockRows=true чтобы использовать slot.row
     назначенный через teDistributeRows (ручное управление рядами) */
  var fakeCard = { slots: teSlots };
  var fakeTmpl = { hAspect: hAspect, vAspect: vAspect, lockRows: true, hasHero: teHasHero };

  var html = layBuildLayout(fakeCard, fakeTmpl, function(idx) {
    return teSlotPreviewHTML(idx, hAspect, vAspect);
  });

  el.innerHTML = html;

  /* Добавить кнопку «+» в конец каждого ряда */
  var rows = el.querySelectorAll('.lay-row, .lay-row-ls');
  for (var ri = 0; ri < rows.length; ri++) {
    var rowNum = rows[ri].getAttribute('data-row');
    if (rowNum === null || rowNum === '') continue;
    /* Убрать padding (lay-pad) чтобы «+» был после слотов */
    var pad = rows[ri].querySelector('.lay-pad');
    if (pad) rows[ri].removeChild(pad);
    var addBtn = document.createElement('button');
    addBtn.className = 'te-row-add';
    addBtn.textContent = '+';
    addBtn.setAttribute('data-row', rowNum);
    addBtn.onclick = function() {
      teAddSlotToRow(parseInt(this.getAttribute('data-row')));
    };
    rows[ri].appendChild(addBtn);
  }

  /* JS-sizing для landscape rest-ячеек в превью */
  requestAnimationFrame(function() { layApplySizes(el); });

  teBindDragEvents();
}

/**
 * HTML одного слота в превью редактора.
 * Клик по слоту переключает weight.
 * @param {number} idx
 * @param {string} hAspect
 * @param {string} vAspect
 * @returns {string}
 */
/**
 * HTML одного слота в превью редактора шаблонов.
 * Размеры контролирует layout (lay-cell / lay-cell-ls).
 * te-slot заполняет контейнер 100% x 100%.
 */
function teSlotPreviewHTML(idx, hAspect, vAspect) {
  var slot = teSlots[idx];
  var isHero = (teHasHero && idx === 0);
  var heroCls = isHero ? ' te-hero' : '';
  var label = (slot.orient === 'h' ? 'H' : 'V');
  if (isHero) label += ' *';
  return '<div class="te-slot' + heroCls + '" data-te-idx="' + idx + '" draggable="true">' +
    '<span class="te-slot-label">' + label + '</span>' +
    '</div>';
}

/**
 * Привязать drag-события к слотам превью для перестановки.
 */
function teBindDragEvents() {
  var slots = document.querySelectorAll('#te-preview .te-slot');
  slots.forEach(function(el) {
    /* Drag: перетащить слот в другую позицию */
    el.addEventListener('dragstart', function(e) {
      teDragIdx = parseInt(this.getAttribute('data-te-idx'));
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(teDragIdx));
    });
    el.addEventListener('dragend', function() {
      teDragIdx = null;
      this.classList.remove('dragging');
    });
    el.addEventListener('dragover', function(e) {
      e.preventDefault();
      /* Показать индикатор вставки: лево или право от центра */
      var rect = this.getBoundingClientRect();
      var midX = rect.left + rect.width / 2;
      this.classList.remove('drag-insert-left', 'drag-insert-right');
      if (e.clientX < midX) {
        this.classList.add('drag-insert-left');
      } else {
        this.classList.add('drag-insert-right');
      }
      this.classList.add('drag-over');
    });
    el.addEventListener('dragleave', function() {
      this.classList.remove('drag-over', 'drag-insert-left', 'drag-insert-right');
    });
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      this.classList.remove('drag-over', 'drag-insert-left', 'drag-insert-right');
      var targetIdx = parseInt(this.getAttribute('data-te-idx'));
      if (teDragIdx !== null && teDragIdx !== targetIdx) {
        /* Определить: вставить до или после target */
        var rect = this.getBoundingClientRect();
        var insertAfter = (e.clientX >= rect.left + rect.width / 2);
        /* Move: вынуть слот из старой позиции */
        var moving = teSlots.splice(teDragIdx, 1)[0];
        /* Пересчитать targetIdx после splice */
        var newTargetIdx = targetIdx;
        if (teDragIdx < targetIdx) newTargetIdx--;
        var insertAt = insertAfter ? newTargetIdx + 1 : newTargetIdx;
        /* Слот получает row целевого — перемещение между рядами */
        var refSlot = teSlots[Math.min(newTargetIdx, teSlots.length - 1)];
        moving.row = refSlot ? refSlot.row : 0;
        teSlots.splice(insertAt, 0, moving);
        _teCompactRows();
        teUpdateCounts();
        teRefreshPreview();
      }
    });

    /* Click: переключить ориентацию H <-> V (не трогая ряды) */
    el.addEventListener('click', function(e) {
      if (e.defaultPrevented) return;
      var idx = parseInt(this.getAttribute('data-te-idx'));
      if (teSlots[idx]) {
        teSlots[idx].orient = (teSlots[idx].orient === 'h') ? 'v' : 'h';
        teUpdateCounts();
        teRefreshPreview();
      }
    });
  });

  /* ── Drop на ряд (пустое место) — переместить слот в конец этого ряда ── */
  var rows = document.querySelectorAll('#te-preview .lay-row, #te-preview .lay-row-ls');
  rows.forEach(function(rowEl) {
    rowEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      this.classList.add('drag-over-row');
    });
    rowEl.addEventListener('dragleave', function(e) {
      /* Не убирать подсветку если ушли на дочерний элемент */
      if (this.contains(e.relatedTarget)) return;
      this.classList.remove('drag-over-row');
    });
    rowEl.addEventListener('drop', function(e) {
      /* Если drop попал на слот — обработается выше, пропускаем */
      if (e.target.closest && e.target.closest('.te-slot')) return;
      e.preventDefault();
      this.classList.remove('drag-over-row');
      if (teDragIdx === null) return;

      var targetRow = parseInt(this.getAttribute('data-row'));
      if (isNaN(targetRow)) return;

      /* Вынуть слот и вставить в конец целевого ряда */
      var moving = teSlots.splice(teDragIdx, 1)[0];
      moving.row = targetRow;

      /* Найти последний слот с этим row и вставить после него */
      var lastInRow = -1;
      for (var i = 0; i < teSlots.length; i++) {
        if (teSlots[i].row === targetRow) lastInRow = i;
      }
      teSlots.splice(lastInRow + 1, 0, moving);
      _teCompactRows();
      teUpdateCounts();
      teRefreshPreview();
    });
  });
}

/**
 * Применить конфигурацию редактора к текущей карточке.
 */
/**
 * Применить текущую конфигурацию редактора к активной карточке.
 * Сохраняет параметры в карточку и проект (proj._template).
 */
function teApplyToCard() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || App.currentCardIdx < 0) {
    alert('Сначала создайте карточку');
    return;
  }
  if (teSlots.length === 0) { alert('Добавьте хотя бы один слот'); return; }

  var card = proj.cards[App.currentCardIdx];
  var hAspect = document.getElementById('te-h-aspect').value;
  var vAspect = document.getElementById('te-v-aspect').value;

  cpSaveHistory();

  /* Создать новые слоты, сохраняя файлы из старых (по позиции) */
  var oldSlots = card.slots || [];
  var newSlots = [];
  for (var i = 0; i < teSlots.length; i++) {
    var s = teSlots[i];
    var aspect = (s.orient === 'h') ? hAspect : vAspect;
    var old = oldSlots[i] || {};
    newSlots.push({
      orient: s.orient,
      weight: s.weight || 1,
      row: s.row || 0,
      aspect: aspect,
      file: old.file || null,
      dataUrl: old.dataUrl || null,
      path: old.path || null
    });
  }

  card.slots = newSlots;
  card._hAspect = hAspect;
  card._vAspect = vAspect;
  /* Шаблон всегда фиксирует ряды — раскладка экрана = раскладка шаблона */
  card._lockRows = true;
  card._hasHero = teHasHero;
  cpSyncFiles(card);

  /* Сохранить конфигурацию в proj._template для персистенции */
  proj._template = {
    id: proj._template ? proj._template.id : ('tmpl_' + Date.now()),
    name: proj._template ? proj._template.name : 'Project Template',
    hAspect: hAspect,
    vAspect: vAspect,
    lockRows: true,
    hasHero: teHasHero,
    slots: teSlots.map(function(s) {
      return { orient: s.orient, weight: s.weight || 1 };
    })
  };

  closeModal('modal-tmpl-editor');
  cpRenderList();
}

/**
 * Сохранить текущую конфигурацию редактора как новый шаблон.
 * Сохраняет в UserTemplates и в proj._template.
 */
function teSaveAsNew() {
  if (teSlots.length === 0) { alert('Добавьте хотя бы один слот'); return; }
  var name = document.getElementById('te-name').value.trim();
  if (!name) { alert('Введите имя шаблона'); return; }

  var hAspect = document.getElementById('te-h-aspect').value;
  var vAspect = document.getElementById('te-v-aspect').value;
  var tmpl = addUserTemplate(name, teSlots, hAspect, vAspect, true, teHasHero);

  /* Также сохранить в proj._template для персистенции при save/load */
  var proj = getActiveProject();
  if (proj) {
    proj._template = templateToProjFormat(tmpl);
  }

  alert('Шаблон "' + tmpl.name + '" сохранён (' + tmpl.slots.length + ' слотов)');
}

/**
 * Быстрое сохранение текущей карточки как шаблон (без модалки).
 * Сохраняет в UserTemplates и в proj._template.
 */
function cpSaveAsTemplate() {
  var proj = getActiveProject();
  var card = proj.cards[App.currentCardIdx];
  var config = slotsConfigFromCard(card);
  if (config.length === 0) { alert('Нет слотов для сохранения'); return; }

  var name = prompt('Имя шаблона:');
  if (!name || !name.trim()) return;

  var hAspect = card._hAspect || '3/2';
  var vAspect = card._vAspect || '2/3';
  var tmpl = addUserTemplate(name.trim(), config, hAspect, vAspect);

  /* Также сохранить в proj._template для персистенции при save/load */
  if (proj) {
    proj._template = templateToProjFormat(tmpl);
  }

  alert('Шаблон "' + tmpl.name + '" сохранён (' + tmpl.slots.length + ' слотов)');
}


// ══════════════════════════════════════════════
//  Drag & Drop
// ══════════════════════════════════════════════

/**
 * Привязать drag-события ко всем слотам текущей карточки.
 * Поддерживает:
 * 1. Drop из галереи превью (application/x-preview)
 * 2. Drop файла из ОС
 * 3. Swap между слотами
 */
function cpBindSlotEvents() {
  var slots = document.querySelectorAll('#cp-view .photo-slot');
  slots.forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      var idx = parseInt(this.getAttribute('data-slot'));
      var card = getActiveProject().cards[App.currentCardIdx];
      if (!card.slots[idx] || !card.slots[idx].file) { e.preventDefault(); return; }
      cpDragSourceSlot = idx;
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    el.addEventListener('dragend', function() {
      cpDragSourceSlot = null;
      this.classList.remove('dragging');
    });
    el.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.classList.add('drag-over');
    });
    el.addEventListener('dragleave', function() {
      this.classList.remove('drag-over');
    });
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('drag-over');
      var targetIdx = parseInt(this.getAttribute('data-slot'));
      var card = getActiveProject().cards[App.currentCardIdx];
      var slot = card.slots[targetIdx];

      /* 1. Drop из галереи превью */
      var pvData = e.dataTransfer.getData('application/x-preview');
      if (pvData) {
        try {
          var pv = JSON.parse(pvData);
          cpSaveHistory();
          slot.file = pv.name;
          slot.path = pv.path || '';
          /* Используем preview (1200px) для карточки, thumb (300px) как фолбэк */
          slot.dataUrl = pv.preview || pv.thumb;
          slot.thumbUrl = pv.thumb;
          cpSyncFiles(card);
          cpRenderCard();
          cpRenderList();
          if (typeof shAutoSave === 'function') shAutoSave();

          /* Desktop: если preview (1200px) нет, подгрузить оригинал через pywebview */
          if (!pv.preview && pv.path && window.pywebview && window.pywebview.api) {
            window.pywebview.api.get_full_image(pv.path).then(function(result) {
              if (result && result.data_url) {
                slot.dataUrl = result.data_url;
                cpRenderCard();
              }
            });
          }
        } catch(err) {}
        return;
      }

      /* 2. Файл из ОС */
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        var file = e.dataTransfer.files[0];
        if (!file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          cpSaveHistory();
          slot.file = file.name;
          slot.dataUrl = ev.target.result;
          slot.path = '';
          cpSyncFiles(card);
          cpRenderCard();
          cpRenderList();
          if (typeof shAutoSave === 'function') shAutoSave();
        };
        reader.readAsDataURL(file);
        return;
      }

      /* 3. Swap между слотами (только файлы, orient/main остаются) */
      if (cpDragSourceSlot !== null && cpDragSourceSlot !== targetIdx) {
        cpSaveHistory();
        var src = card.slots[cpDragSourceSlot];
        var tgt = card.slots[targetIdx];
        /* Swap файловые данные, оставить orient/main на месте */
        var tmpFile = tgt.file, tmpData = tgt.dataUrl, tmpPath = tgt.path, tmpThumb = tgt.thumbUrl;
        tgt.file = src.file; tgt.dataUrl = src.dataUrl; tgt.path = src.path; tgt.thumbUrl = src.thumbUrl;
        src.file = tmpFile; src.dataUrl = tmpData; src.path = tmpPath; src.thumbUrl = tmpThumb;
        cpSyncFiles(card);
        cpRenderCard();
        cpRenderList();
      }
    });
  });
}

/* Prevent browser from opening dropped files */
document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) { e.preventDefault(); });


// ══════════════════════════════════════════════
//  History / Undo
// ══════════════════════════════════════════════

/**
 * Сохранить текущее состояние карточки в undo-стек.
 * Вызывается перед любым изменением слотов.
 */
function cpSaveHistory() {
  var card = getActiveProject().cards[App.currentCardIdx];
  if (!card._history) card._history = [];
  var snap = {
    category: card.category,
    _hasHero: card._hasHero,
    _lockRows: card._lockRows,
    _hAspect: card._hAspect,
    _vAspect: card._vAspect,
    slots: card.slots.map(function(s) {
      return {
        orient: s.orient,
        weight: s.weight || 1,
        row: s.row,
        aspect: s.aspect || null,
        file: s.file,
        dataUrl: s.dataUrl,
        path: s.path
      };
    })
  };
  card._history.push(JSON.stringify(snap));
  if (card._history.length > CP_MAX_HISTORY) card._history.shift();

  /* Авто-синхронизация карточек с облаком (debounced) */
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
}

/**
 * Откатить последнее изменение (Ctrl+Z).
 */
function cpUndo() {
  var card = getActiveProject().cards[App.currentCardIdx];
  if (!card._history || !card._history.length) return;
  var snap = JSON.parse(card._history.pop());
  card.slots = snap.slots;
  if (snap.category !== undefined) card.category = snap.category;
  /* Восстановить параметры шаблона карточки */
  if (snap._hasHero !== undefined) card._hasHero = snap._hasHero;
  if (snap._lockRows !== undefined) card._lockRows = snap._lockRows;
  if (snap._hAspect !== undefined) card._hAspect = snap._hAspect;
  if (snap._vAspect !== undefined) card._vAspect = snap._vAspect;
  cpSyncFiles(card);
  cpRenderList();
}


// ══════════════════════════════════════════════
//  Синхронизация files[] из slots[]
// ══════════════════════════════════════════════

/**
 * Обновить массив files[] карточки из слотов (для экспорта, сохранения).
 * @param {Object} card
 */
function cpSyncFiles(card) {
  card.files = card.slots.map(function(s) { return s ? s.file : null; }).filter(Boolean);
}


// ══════════════════════════════════════════════
//  Клавиатурная навигация
// ══════════════════════════════════════════════

document.addEventListener('keydown', function(e) {
  if (App.currentPage !== 'content') return;
  var proj = getActiveProject();
  if (!proj || !proj.cards || proj.cards.length === 0) return;

  if (e.key === 'ArrowLeft' && App.currentCardIdx > 0) {
    cpShowCard(App.currentCardIdx - 1);
  }
  if (e.key === 'ArrowRight' && App.currentCardIdx < proj.cards.length - 1) {
    cpShowCard(App.currentCardIdx + 1);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    cpUndo();
  }
});


// ══════════════════════════════════════════════
//  Экспорт
// ══════════════════════════════════════════════

/**
 * Экспортировать список файлов всех карточек в текстовый файл.
 */
function cpExportList() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || proj.cards.length === 0) { alert('Нет карточек'); return; }

  var lines = [];
  for (var i = 0; i < proj.cards.length; i++) {
    var c = proj.cards[i];
    lines.push('--- Карточка ' + (i + 1) + ' ---');
    if (c.slots) {
      c.slots.forEach(function(s) {
        if (s && s.file) lines.push(s.file);
      });
    }
    lines.push('');
  }

  var text = lines.join('\n');
  var blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (proj.brand || 'project') + '_список_фото.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Экспортировать все карточки в PDF.
 * Каждая карточка = одна страница A4 (landscape).
 * Фото расставляются по сетке как в UI.
 */
function cpExportPDF() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || proj.cards.length === 0) { alert('Нет карточек'); return; }

  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    alert('Библиотека jsPDF не загружена. Обновите страницу.');
    return;
  }

  var jsPDF = (window.jspdf && window.jspdf.jsPDF) || jspdf.jsPDF;
  var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  var pageW = 297; /* A4 landscape width */
  var pageH = 210; /* A4 landscape height */
  var margin = 10;
  var contentW = pageW - margin * 2;
  var contentH = pageH - margin * 2;
  var gap = 3;

  /* Заголовок проекта */
  var brandText = (proj.brand || 'Проект') + (proj.shoot_date ? ' / ' + proj.shoot_date : '');

  for (var ci = 0; ci < proj.cards.length; ci++) {
    if (ci > 0) doc.addPage();
    var card = proj.cards[ci];
    if (!card.slots || card.slots.length === 0) continue;

    /* Заголовок страницы */
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(brandText + '  |  ' + 'Карточка ' + (ci + 1), margin, margin - 2);

    /* Собрать слоты с изображениями */
    var filledSlots = [];
    for (var si = 0; si < card.slots.length; si++) {
      var slot = card.slots[si];
      if (slot.dataUrl || slot.thumbUrl) {
        filledSlots.push(slot);
      }
    }

    if (filledSlots.length === 0) {
      doc.setFontSize(14);
      doc.setTextColor(180);
      doc.text('(пустая карточка)', pageW / 2, pageH / 2, { align: 'center' });
      continue;
    }

    /* Раскладка: определить hero + rest */
    var hasHero = (card._hasHero !== undefined) ? card._hasHero : true;
    var heroSlot = (hasHero && filledSlots.length > 0) ? filledSlots[0] : null;
    var restSlots = hasHero ? filledSlots.slice(1) : filledSlots;

    if (heroSlot && restSlots.length > 0) {
      /* Hero слева (60%), rest справа (40%) */
      var heroW = contentW * 0.58;
      var restW = contentW - heroW - gap;
      var heroH = contentH;

      /* Hero */
      _cpPdfDrawImage(doc, heroSlot, margin, margin, heroW, heroH);

      /* Rest: сетка справа */
      var restX = margin + heroW + gap;
      var cols = restSlots.length <= 2 ? 1 : 2;
      var rows = Math.ceil(restSlots.length / cols);
      var cellW = (restW - gap * (cols - 1)) / cols;
      var cellH = (contentH - gap * (rows - 1)) / rows;

      for (var ri = 0; ri < restSlots.length; ri++) {
        var col = ri % cols;
        var row = Math.floor(ri / cols);
        var cx = restX + col * (cellW + gap);
        var cy = margin + row * (cellH + gap);
        _cpPdfDrawImage(doc, restSlots[ri], cx, cy, cellW, cellH);
      }
    } else {
      /* Без hero: равномерная сетка */
      var total = filledSlots.length;
      var gridCols = total <= 2 ? total : (total <= 4 ? 2 : 3);
      var gridRows = Math.ceil(total / gridCols);
      var gCellW = (contentW - gap * (gridCols - 1)) / gridCols;
      var gCellH = (contentH - gap * (gridRows - 1)) / gridRows;

      for (var gi = 0; gi < total; gi++) {
        var gc = gi % gridCols;
        var gr = Math.floor(gi / gridCols);
        var gx = margin + gc * (gCellW + gap);
        var gy = margin + gr * (gCellH + gap);
        _cpPdfDrawImage(doc, filledSlots[gi], gx, gy, gCellW, gCellH);
      }
    }

    /* Имена файлов внизу */
    doc.setFontSize(6);
    doc.setTextColor(180);
    var names = [];
    for (var ni = 0; ni < card.slots.length; ni++) {
      if (card.slots[ni].file) names.push(card.slots[ni].file);
    }
    if (names.length > 0) {
      doc.text(names.join('   '), margin, pageH - 2);
    }
  }

  /* Скачать PDF */
  doc.save((proj.brand || 'project') + '_карточки.pdf');
}

/**
 * Нарисовать изображение слота в PDF (object-fit: contain).
 * Вписывает картинку в ячейку с сохранением пропорций.
 * @param {jsPDF} doc
 * @param {Object} slot — слот с dataUrl/thumbUrl
 * @param {number} x — X координата ячейки (мм)
 * @param {number} y — Y координата ячейки (мм)
 * @param {number} w — ширина ячейки (мм)
 * @param {number} h — высота ячейки (мм)
 */
function _cpPdfDrawImage(doc, slot, x, y, w, h) {
  var src = slot.dataUrl || slot.thumbUrl || slot.thumb;
  if (!src) return;

  try {
    /* Фон ячейки */
    doc.setFillColor(250, 250, 250);
    doc.rect(x, y, w, h, 'F');

    /* Пропорции по ориентации слота:
       orient='h' (горизонтальное фото) -> ~3:2
       orient='v' (вертикальное фото) -> ~2:3 */
    var imgAspect = (slot.orient === 'h') ? (3 / 2) : (2 / 3);
    var cellAspect = w / h;
    var drawW, drawH, drawX, drawY;

    if (imgAspect > cellAspect) {
      /* Картинка шире ячейки -- ограничиваем по ширине */
      drawW = w;
      drawH = w / imgAspect;
      drawX = x;
      drawY = y + (h - drawH) / 2;
    } else {
      /* Картинка выше ячейки -- ограничиваем по высоте */
      drawH = h;
      drawW = h * imgAspect;
      drawX = x + (w - drawW) / 2;
      drawY = y;
    }

    doc.addImage(src, 'JPEG', drawX, drawY, drawW, drawH);
  } catch(e) {
    /* Если формат не поддерживается -- рисуем плейсхолдер */
    doc.setFillColor(245, 245, 245);
    doc.rect(x, y, w, h, 'F');
    doc.setFontSize(8);
    doc.setTextColor(180);
    doc.text(slot.file || '?', x + w / 2, y + h / 2, { align: 'center' });
  }
}


// ══════════════════════════════════════════════
//  Мобильный клиентский режим
// ══════════════════════════════════════════════
//
//  Непрерывная вертикальная лента карточек для мобильного клиента.
//  Активируется когда _appClientMode && viewport < 768px.
//  Не меняет десктопный рендер — отдельный путь отрисовки.
// ══════════════════════════════════════════════

/** @type {boolean} Текущий режим: true = карточки, false = галерея */
var _mobViewCards = true;

/**
 * Проверить, нужен ли мобильный режим.
 * @returns {boolean}
 */
function cpIsMobileClient() {
  return _appClientMode && window.innerWidth < 768;
}

/**
 * Главная точка входа: если мобильный клиент — рендерить ленту,
 * иначе — обычный десктопный рендер.
 * Вызывается из shEnterClientMode() после инициализации.
 */
function cpMobileInit() {
  if (!cpIsMobileClient()) return;

  /* Скрыть весь десктопный контент, показать мобильную обёртку */
  var appMain = document.getElementById('app-main');
  if (!appMain) return;

  /* Создать мобильный контейнер если нет */
  var mobWrap = document.getElementById('mob-wrap');
  if (!mobWrap) {
    mobWrap = document.createElement('div');
    mobWrap.id = 'mob-wrap';
    appMain.appendChild(mobWrap);
  }

  /* Скрыть все дочерние элементы кроме mob-wrap */
  for (var i = 0; i < appMain.children.length; i++) {
    var child = appMain.children[i];
    if (child.id !== 'mob-wrap') {
      child.style.display = 'none';
    }
  }

  _mobViewCards = true;
  cpMobileRender();
}

/**
 * Выход из мобильного режима (показать десктопный контент).
 * Восстанавливает видимость всех скрытых элементов.
 */
function cpMobileExitFeed() {
  var appMain = document.getElementById('app-main');
  if (!appMain) return;

  /* Показать все дочерние элементы кроме mob-wrap */
  for (var i = 0; i < appMain.children.length; i++) {
    var child = appMain.children[i];
    if (child.id !== 'mob-wrap') {
      child.style.display = '';
    }
  }

  _mobViewCards = false;
}

/**
 * Отрисовать мобильный интерфейс (шапка + лента/галерея).
 */
function cpMobileRender() {
  var mobWrap = document.getElementById('mob-wrap');
  if (!mobWrap) return;

  var proj = getActiveProject();
  var brandName = proj ? esc(proj.brand || '') : '';
  var toggleLabel = _mobViewCards ? 'SHOW GALLERY' : 'GO BACK TO CARDS';

  var html = '';

  /* Sticky-шапка */
  html += '<div class="mob-header">';
  html += '<div class="mob-header-title">' + (brandName || 'Просмотр') + '</div>';
  html += '<button class="mob-header-btn" onclick="cpMobileToggleView()">' + toggleLabel + '</button>';
  html += '</div>';

  if (_mobViewCards) {
    html += cpMobileRenderFeed();
  } else {
    html += cpMobileRenderGallery();
  }

  mobWrap.innerHTML = html;

  /* Привязать touch-события к каруселям */
  if (_mobViewCards) {
    cpMobileBindCarousels();
    cpMobileBindDoubleTap();
  }
}

/**
 * Переключение карточки/галерея.
 */
function cpMobileToggleView() {
  _mobViewCards = !_mobViewCards;
  cpMobileRender();
}

/**
 * Рендер непрерывной ленты карточек (мобильный).
 * @returns {string} HTML
 */
function cpMobileRenderFeed() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || proj.cards.length === 0) {
    return '<div style="padding:40px 16px;text-align:center;color:#999">Нет карточек</div>';
  }

  var html = '<div class="mob-feed">';

  for (var ci = 0; ci < proj.cards.length; ci++) {
    var card = proj.cards[ci];
    if (!card.slots) continue;

    /* Определить, есть ли hero у карточки */
    var projTmpl = proj._template || null;
    var tmpl = proj.templateId ? getUserTemplate(proj.templateId) : null;
    var cardHasHero = (card._hasHero !== undefined) ? card._hasHero :
      (projTmpl && projTmpl.hasHero !== undefined ? projTmpl.hasHero :
      (tmpl && tmpl.hasHero !== undefined ? tmpl.hasHero : false));

    /* Разделитель */
    html += '<div class="mob-card-block" data-card-idx="' + ci + '">';
    html += '<div class="mob-card-divider">Карточка ' + (ci + 1) + ' / ' + proj.cards.length + '</div>';
    html += '<div class="mob-card-slots">';

    for (var si = 0; si < card.slots.length; si++) {
      var slot = card.slots[si];
      var orient = slot.orient || 'v';
      var isHero = (cardHasHero && si === 0);
      var weight = slot.weight || 1;
      var isHeroByWeight = (weight >= 2 && si === 0);

      /* Класс слота: hero/h/v */
      var slotClass = 'mob-slot-v';
      if (isHero || isHeroByWeight) slotClass = 'mob-slot-hero';
      else if (orient === 'h') slotClass = 'mob-slot-h';

      var hasFoto = slot.file || slot.dataUrl;

      if (hasFoto) {
        var src = slot.dataUrl || slot.thumbUrl || slot.thumb || '';
        html += '<div class="' + slotClass + ' mob-carousel-wrap" data-card="' + ci + '" data-slot="' + si + '">';
        html += '<img src="' + src + '" loading="lazy">';
        /* Стрелки карусели */
        html += '<div class="mob-carousel-arrows">';
        html += '<button class="mob-carousel-arrow" onclick="cpMobileCarousel(' + ci + ',' + si + ',-1)">&lsaquo;</button>';
        html += '<button class="mob-carousel-arrow" onclick="cpMobileCarousel(' + ci + ',' + si + ',1)">&rsaquo;</button>';
        html += '</div>';
        /* Кнопка удаления */
        html += '<button class="mob-slot-remove" onclick="cpMobileClearSlot(' + ci + ',' + si + ')">&times;</button>';
        html += '</div>';
      } else {
        /* Пустой слот */
        html += '<div class="' + slotClass + ' mob-slot-empty" data-card="' + ci + '" data-slot="' + si + '">';
        html += '<div class="mob-slot-empty-text">Нажмите дважды чтобы добавить фото</div>';
        html += '</div>';
      }
    }

    html += '</div></div>'; /* mob-card-slots, mob-card-block */
  }

  /* Кнопки согласования в конце ленты */
  html += '<div class="mob-approve-block">';
  html += '<div class="mob-approve-title">Просмотр завершён</div>';
  html += '<button class="mob-btn-approve" onclick="cpMobileApprove()">Согласовать отбор</button>';
  html += '<button class="mob-btn-reject" onclick="cpMobileReject()">Вернуть на доработку</button>';
  html += '</div>';

  html += '</div>'; /* mob-feed */
  return html;
}

/**
 * Получить ближайшие превью по ориентации для карусели.
 * @param {string} currentFile - имя текущего файла в слоте
 * @param {string} orient - 'h' или 'v'
 * @param {number} range - диапазон в каждую сторону (по умолчанию 15)
 * @returns {Array} массив объектов превью
 */
function cpGetNearbyPreviews(currentFile, orient, range) {
  var proj = getActiveProject();
  if (!proj || !proj.previews) return [];
  range = range || 15;

  /* Фильтруем по ориентации */
  var filtered = [];
  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];
    var pvOrient = (pv.width && pv.height) ? (pv.width > pv.height ? 'h' : 'v') :
      (pv.orient || 'v');
    if (pvOrient === orient || orient === 'any') {
      filtered.push(pv);
    }
  }

  if (filtered.length === 0) return filtered;

  /* Найти индекс текущего файла */
  var currentIdx = -1;
  for (var j = 0; j < filtered.length; j++) {
    if (filtered[j].name === currentFile || filtered[j].stem === currentFile) {
      currentIdx = j;
      break;
    }
  }

  /* Если не нашли — вернуть первые 2*range */
  if (currentIdx < 0) {
    return filtered.slice(0, range * 2);
  }

  /* Вырезать диапазон вокруг текущего */
  var start = Math.max(0, currentIdx - range);
  var end = Math.min(filtered.length, currentIdx + range + 1);
  return filtered.slice(start, end);
}

/**
 * Карусель: заменить фото в слоте на следующее/предыдущее.
 * @param {number} cardIdx - индекс карточки
 * @param {number} slotIdx - индекс слота
 * @param {number} dir - направление (-1 = назад, 1 = вперёд)
 */
function cpMobileCarousel(cardIdx, slotIdx, dir) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;

  var card = proj.cards[cardIdx];
  var slot = card.slots[slotIdx];
  if (!slot) return;

  var orient = slot.orient || 'v';
  var currentFile = slot.file || '';

  /* Получить ближайшие по ориентации */
  var nearby = cpGetNearbyPreviews(currentFile, orient, 15);
  if (nearby.length === 0) return;

  /* Найти текущий в списке nearby */
  var curIdx = -1;
  for (var i = 0; i < nearby.length; i++) {
    if (nearby[i].name === currentFile || nearby[i].stem === currentFile) {
      curIdx = i;
      break;
    }
  }

  /* Следующий/предыдущий */
  var newIdx = curIdx + dir;
  if (newIdx < 0) newIdx = 0;
  if (newIdx >= nearby.length) newIdx = nearby.length - 1;
  if (newIdx === curIdx) return;

  var newPv = nearby[newIdx];

  /* Обновить слот */
  slot.file = newPv.name || newPv.stem || '';
  slot.dataUrl = newPv.preview || newPv.thumb || '';
  slot.path = newPv.path || '';

  /* Авто-синхронизация */
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Перерисовать только этот слот (перерисовываем всю ленту — проще и безопаснее) */
  cpMobileRender();
}

/**
 * Удалить фото из слота (мобильный).
 * @param {number} cardIdx
 * @param {number} slotIdx
 */
function cpMobileClearSlot(cardIdx, slotIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;

  var slot = proj.cards[cardIdx].slots[slotIdx];
  if (!slot) return;

  slot.file = null;
  slot.dataUrl = null;
  slot.path = null;

  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof shAutoSave === 'function') shAutoSave();

  cpMobileRender();
}

/**
 * Согласовать отбор (мобильный клиент).
 */
function cpMobileApprove() {
  if (typeof shClientApprove === 'function') {
    shClientApprove();
  }
}

/**
 * Вернуть на доработку (мобильный клиент).
 */
function cpMobileReject() {
  if (typeof shClientRequestExtra === 'function') {
    shClientRequestExtra();
  }
}

/**
 * Привязать touch-свайп к каруселям.
 * Pointer Events: pointerdown → сохранить X, pointerup → определить свайп.
 */
function cpMobileBindCarousels() {
  var carousels = document.querySelectorAll('.mob-carousel-wrap');
  for (var i = 0; i < carousels.length; i++) {
    (function(el) {
      var startX = 0;
      var startY = 0;
      el.addEventListener('pointerdown', function(e) {
        startX = e.clientX;
        startY = e.clientY;
      });
      el.addEventListener('pointerup', function(e) {
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        /* Минимальный свайп 40px, горизонтальнее чем вертикальный */
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          var ci = parseInt(el.getAttribute('data-card'));
          var si = parseInt(el.getAttribute('data-slot'));
          var dir = dx < 0 ? 1 : -1; /* свайп влево = следующее */
          cpMobileCarousel(ci, si, dir);
        }
      });
    })(carousels[i]);
  }
}

/**
 * Привязать двойной тап на пустые слоты.
 * При двойном тапе — автоматически вставить следующее фото из галереи.
 */
function cpMobileBindDoubleTap() {
  var empties = document.querySelectorAll('.mob-slot-empty');
  for (var i = 0; i < empties.length; i++) {
    (function(el) {
      var lastTap = 0;
      el.addEventListener('touchend', function(e) {
        var now = Date.now();
        if (now - lastTap < 350) {
          /* Двойной тап! */
          e.preventDefault();
          var ci = parseInt(el.getAttribute('data-card'));
          var si = parseInt(el.getAttribute('data-slot'));
          cpMobileAutoFillSlot(ci, si);
        }
        lastTap = now;
      });
    })(empties[i]);
  }
}

/**
 * Автозаполнение пустого слота: следующее фото из галереи
 * (по порядку после первого файла в этой карточке, с учётом ориентации).
 * @param {number} cardIdx
 * @param {number} slotIdx
 */
function cpMobileAutoFillSlot(cardIdx, slotIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  if (!proj.previews || proj.previews.length === 0) return;

  var card = proj.cards[cardIdx];
  var slot = card.slots[slotIdx];
  if (!slot) return;
  if (slot.file || slot.dataUrl) return; /* не пустой */

  var orient = slot.orient || 'v';

  /* Найти первый заполненный слот в этой карточке для определения якоря */
  var anchorFile = '';
  for (var s = 0; s < card.slots.length; s++) {
    if (card.slots[s].file) {
      anchorFile = card.slots[s].file;
      break;
    }
  }

  /* Получить ближайшие по ориентации */
  var nearby = cpGetNearbyPreviews(anchorFile, orient, 15);
  if (nearby.length === 0) return;

  /* Собрать уже использованные файлы в этой карточке */
  var used = {};
  for (var u = 0; u < card.slots.length; u++) {
    if (card.slots[u].file) used[card.slots[u].file] = true;
  }

  /* Найти первый неиспользованный */
  var newPv = null;
  /* Начинаем после якоря */
  var anchorIdx = -1;
  for (var a = 0; a < nearby.length; a++) {
    if (nearby[a].name === anchorFile) { anchorIdx = a; break; }
  }
  var searchStart = anchorIdx >= 0 ? anchorIdx + 1 : 0;
  for (var n = searchStart; n < nearby.length; n++) {
    if (!used[nearby[n].name]) {
      newPv = nearby[n];
      break;
    }
  }
  /* Если не нашли после якоря, ищем с начала */
  if (!newPv) {
    for (var m = 0; m < nearby.length; m++) {
      if (!used[nearby[m].name]) {
        newPv = nearby[m];
        break;
      }
    }
  }

  if (!newPv) return;

  slot.file = newPv.name || newPv.stem || '';
  slot.dataUrl = newPv.preview || newPv.thumb || '';
  slot.path = newPv.path || '';

  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof shAutoSave === 'function') shAutoSave();

  cpMobileRender();
}

/**
 * Рендер мобильной галереи с галочками.
 * @returns {string} HTML
 */
function cpMobileRenderGallery() {
  var proj = getActiveProject();
  if (!proj || !proj.previews || proj.previews.length === 0) {
    return '<div style="padding:40px 16px;text-align:center;color:#999">Нет фотографий</div>';
  }

  /* Текущий список other_content */
  var ocList = proj.otherContent || [];
  var ocMap = {};
  for (var o = 0; o < ocList.length; o++) {
    ocMap[ocList[o].name] = true;
  }

  var html = '<div class="mob-gallery">';

  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];
    var src = pv.preview || pv.thumb || '';
    if (!src) continue;

    var pvOrient = (pv.width && pv.height) ? (pv.width > pv.height ? 'h' : 'v') :
      (pv.orient || 'v');
    var itemClass = pvOrient === 'h' ? 'mob-gallery-item-h' : 'mob-gallery-item-v';
    var pvName = pv.name || pv.stem || '';
    var isChecked = ocMap[pvName] ? ' checked' : '';

    html += '<div class="mob-gallery-item ' + itemClass + '">';
    html += '<img src="' + src + '" loading="lazy" onclick="cpMobileGalleryFullscreen(' + i + ')">';
    html += '<div class="mob-gallery-check' + isChecked + '" onclick="cpMobileToggleOC(\'' + esc(pvName) + '\',this)">';
    html += isChecked ? '&#10003;' : '';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Переключить галочку "Доп. контент" на фото в мобильной галерее.
 * @param {string} pvName - имя файла превью
 * @param {HTMLElement} el - элемент галочки
 */
function cpMobileToggleOC(pvName, el) {
  var proj = getActiveProject();
  if (!proj) return;

  if (!proj.otherContent) proj.otherContent = [];

  /* Найти индекс по полю name */
  var idx = -1;
  for (var i = 0; i < proj.otherContent.length; i++) {
    if (proj.otherContent[i].name === pvName) {
      idx = i;
      break;
    }
  }

  if (idx >= 0) {
    proj.otherContent.splice(idx, 1);
    el.className = 'mob-gallery-check';
    el.innerHTML = '';
  } else {
    /* Найти объект превью с этим именем чтобы получить метаданные */
    var pvObj = null;
    for (var j = 0; j < proj.previews.length; j++) {
      if ((proj.previews[j].name || proj.previews[j].stem) === pvName) {
        pvObj = proj.previews[j];
        break;
      }
    }

    /* Добавить объект с preview/thumb/path если найдено */
    var ocItem = { name: pvName };
    if (pvObj) {
      if (pvObj.preview) ocItem.preview = pvObj.preview;
      if (pvObj.thumb) ocItem.thumb = pvObj.thumb;
      if (pvObj.path) ocItem.path = pvObj.path;
    }
    proj.otherContent.push(ocItem);
    el.className = 'mob-gallery-check checked';
    el.innerHTML = '&#10003;';
  }

  /* Синхронизация */
  if (typeof sbAutoSyncCards === 'function') sbAutoSyncCards();
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Полноэкранный просмотр фото из мобильной галереи.
 * @param {number} pvIdx - индекс в proj.previews
 */
function cpMobileGalleryFullscreen(pvIdx) {
  if (typeof pvShowFullscreen === 'function') {
    pvShowFullscreen(pvIdx);
  }
}
