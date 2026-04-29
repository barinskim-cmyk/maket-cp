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

/* Рейтинг-фильтр для десктопной карусели берётся из превью-панели (PV_FILTER['pv']).
   Отдельная переменная _cpCardFilter больше не нужна. */


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
    cpRenderDeletedList();
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
    var cardLabel = (c.name && c.name.trim()) ? c.name.trim() : ('Карточка ' + (i + 1));
    html += '<div class="cp-card-item' + active + '" onclick="cpShowCard(' + i + ')">';
    html += '<span class="cp-card-item-name">' + esc(cardLabel) + '</span>';
    html += ' <span class="count">(' + fileCount + '/' + (c.slots ? c.slots.length : 0) + ')</span>';
    html += '<button class="cp-card-item-del" onclick="event.stopPropagation();cpDeleteCard(' + i + ')" title="Удалить карточку">&times;</button>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  cpRenderCard();
  cpRenderDeletedList();

  if (typeof pvRenderAll === 'function') pvRenderAll();
}

/**
 * Отрисовать список удалённых карточек под основным sidebar list.
 */
function cpRenderDeletedList() {
  var proj = getActiveProject();
  if (!proj) return;
  var listEl = document.getElementById('cp-cards-list');
  if (!listEl || !listEl.parentNode) return;

  var existing = document.getElementById('cp-deleted-block');
  if (existing) existing.remove();

  var del = (proj._deletedCards || []);
  if (del.length === 0) return;

  var expanded = !!window._cpShowDeleted;
  var html = '<div class="cp-deleted-toggle" onclick="cpToggleShowDeleted()">' +
    (expanded ? '▾' : '▸') + ' Удалённые (' + del.length + ')</div>';

  if (expanded) {
    html += '<div class="cp-deleted-list">';
    for (var i = 0; i < del.length; i++) {
      var c = del[i];
      var name = (c.name && c.name.trim()) ? c.name.trim() : ('Карточка ' + (i + 1));
      html += '<div class="cp-card-item cp-card-item-deleted" title="' + esc(c.deletedAt || '') + '">';
      html += '<span class="cp-card-item-name">' + esc(name) + '</span>';
      html += '<button class="cp-card-item-restore" onclick="event.stopPropagation();cpRestoreCard(' + i + ')" title="Восстановить">↺</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  var block = document.createElement('div');
  block.id = 'cp-deleted-block';
  block.className = 'cp-deleted-block';
  block.innerHTML = html;
  listEl.parentNode.insertBefore(block, listEl.nextSibling);
}

/** Toggle отображения удалённых */
function cpToggleShowDeleted() {
  window._cpShowDeleted = !window._cpShowDeleted;
  cpRenderDeletedList();
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

  /* Приоритет конфигурации:
     1. Копия предыдущей карточки (если есть)
     2. proj._template (активный шаблон проекта)
     3. proj.templateId → UserTemplates
     4. Фолбэк: 4 вертикали */

  /* 1. Копировать конфигурацию предыдущей карточки */
  if (proj.cards && proj.cards.length > 0) {
    var prevCard = proj.cards[proj.cards.length - 1];
    slotsConfig = slotsConfigFromCard(prevCard);
  }

  /* 2. proj._template (установленный через редактор/библиотеку/dropdown) */
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

  /* Параметры карточки: prevCard > proj._template > proj.templateId */
  var prevCard = (proj.cards && proj.cards.length > 1) ? proj.cards[proj.cards.length - 2] : null;
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
  /* Лог создания карточки в action_log.
     Если _cloudId ещё не установлен (первая карточка проекта) — sbLogAction
     тихо выйдет, но после первичной заливки sbUploadProject установит _cloudId,
     и последующие create_card будут логироваться. */
  if (typeof sbLogAction === 'function') {
    sbLogAction('create_card', 'card', card.id, card.name || ('Карточка ' + proj.cards.length));
  }
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Удалить карточку по индексу.
 * @param {number} idx
 */
function cpDeleteCard(idx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || idx < 0 || idx >= proj.cards.length) return;
  var card = proj.cards[idx];
  var label = (card.name && card.name.trim()) || ('Карточка ' + (idx + 1));
  if (!confirm('Удалить «' + label + '»? (можно восстановить)')) return;

  /* Soft delete: перенос в _deletedCards с timestamp.
     Сохраняем все данные карточки — slots, name, layout — чтобы restore вернул всё как было. */
  var now = new Date();
  card.deletedAt = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj.cards.splice(idx, 1);
  if (!proj._deletedCards) proj._deletedCards = [];
  proj._deletedCards.unshift(card); /* самые свежие сверху */

  /* Если удалили текущую открытую карточку — переключаемся на соседнюю */
  if (App.currentCardIdx >= proj.cards.length) {
    App.currentCardIdx = Math.max(0, proj.cards.length - 1);
  }
  cpRenderList();
  if (typeof sbLogAction === 'function') {
    sbLogAction('soft_delete_card', 'card', card.id, label);
  }
  /* Помечаем карточку soft-deleted в облаке (cards.deleted_at = now).
     Pull уже фильтрует по deleted_at IS NULL — карточка не вернётся при пере-загрузке. */
  if (proj._cloudId && card.id && typeof sbClient !== 'undefined' && sbClient) {
    try {
      sbClient.from('cards').update({ deleted_at: new Date().toISOString() })
        .eq('id', card.id).eq('project_id', proj._cloudId)
        .then(function(res) {
          if (res && res.error) console.warn('cpDeleteCard cloud update:', res.error.message);
        });
    } catch (e) { console.warn('cpDeleteCard:', e); }
  }
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Восстановить удалённую карточку обратно в proj.cards.
 * @param {number} delIdx — индекс в proj._deletedCards
 */
function cpRestoreCard(delIdx) {
  var proj = getActiveProject();
  if (!proj || !proj._deletedCards || delIdx < 0 || delIdx >= proj._deletedCards.length) return;
  var card = proj._deletedCards.splice(delIdx, 1)[0];
  delete card.deletedAt;
  if (!proj.cards) proj.cards = [];
  proj.cards.push(card);
  App.currentCardIdx = proj.cards.length - 1;
  cpRenderList();
  if (typeof sbLogAction === 'function') {
    sbLogAction('restore_card', 'card', card.id, card.name || ('Карточка ' + proj.cards.length));
  }
  /* Снимаем soft-delete в облаке: deleted_at → null. Карточка снова видна. */
  if (proj._cloudId && card.id && typeof sbClient !== 'undefined' && sbClient) {
    try {
      sbClient.from('cards').update({ deleted_at: null })
        .eq('id', card.id).eq('project_id', proj._cloudId)
        .then(function(res) {
          if (res && res.error) console.warn('cpRestoreCard cloud update:', res.error.message);
        });
    } catch (e) { console.warn('cpRestoreCard:', e); }
  }
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
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
  var cardLabel = (card.name && card.name.trim()) ? card.name.trim() : ('Карточка ' + (idx + 1));
  html += '<div class="cp-meta">';
  html += '<span class="num cp-card-name" onclick="cpEditCardName()" title="Нажмите чтобы переименовать">' + esc(cardLabel) + '</span>';
  html += '<div class="cp-toolbar">';

  /* Стрелка назад (undo) — минималистичная, слева в тулбаре */
  var histLen = (card._history && card._history.length) || 0;
  html += '<button class="cp-undo-arrow" onclick="cpUndo()" title="Отменить последнее действие"' + (histLen === 0 ? ' disabled' : '') + '>&larr;</button>';

  /* Выбор шаблона из библиотеки — dropdown прямо в карточке */
  html += _cpTemplateSelectHTML();

  /* Редактор шаблона и библиотека */
  html += '<button class="btn btn-sm" onclick="cpOpenTemplateEditor()">Редактор</button>';
  html += '<button class="btn btn-sm" onclick="cpOpenTemplateLibrary()">Библиотека</button>';

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

  /* Кнопка "Удалить карточку" убрана из тулбара — удаление доступно
     через сайдбар (правый клик или отдельная кнопка в списке карточек).
     Фильтр по рейтингу: в десктопе берётся из превью-панели (PV_FILTER['pv']). */
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

  /* Авто-применение раскладки: если у слотов нет row (загружены из облака без рядов).
     НЕ пересчитывать если:
     - _lockRows=true (ряды зафиксированы шаблоном)
     - хотя бы один слот имеет row !== undefined && row !== null
       (row=0 — это валидный первый ряд, не путать с "нет ряда") */
  if (card.slots && card.slots.length > 1 && !layTmpl.lockRows && typeof layAutoRows === 'function') {
    var hasAnyRow = false;
    for (var ri = 0; ri < card.slots.length; ri++) {
      if (card.slots[ri].row !== undefined && card.slots[ri].row !== null) {
        hasAnyRow = true;
        break;
      }
    }
    if (!hasAnyRow) {
      var autoRows = layAutoRows(card.slots, layTmpl.hAspect, layTmpl.vAspect);
      if (typeof layAssignRows === 'function') layAssignRows(card.slots, autoRows);
      /* Rows назначены — сохранить в облако, чтобы при следующей загрузке
         раскладка не пересчитывалась заново */
      if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
    }
  }

  html += layBuildLayout(card, layTmpl, function(si) { return cpSlotHTML(si, undefined, cardHasHero); });

  /* Имена файлов и аннотации к фото убраны из вида карточки:
     — имена создают визуальный шум
     — аннотации к фото видны в лайтбоксе (единый список из всех источников) */

  /* ── Комментарии к карточке ── */
  html += cpRenderComments(idx);

  /* ── Навигация ── */
  var total = proj.cards.length;
  html += '<div class="cp-nav-row">';
  html += '<button class="cp-nav-btn" onclick="cpShowCard(' + (idx - 1) + ')"' + (idx === 0 ? ' disabled' : '') + '>Назад</button>';
  html += '<span class="cp-nav-counter">' + (idx + 1) + ' / ' + total + '</span>';
  html += '<button class="cp-nav-btn" onclick="cpShowCard(' + (idx + 1) + ')"' + (idx >= total - 1 ? ' disabled' : '') + '>Вперёд</button>';
  html += '</div>';

  /* ── Сохранить состояние поля ввода комментария перед перерисовкой ── */
  var _cmtState = null;
  var _cmtEl = document.getElementById('cp-comment-input-' + idx);
  if (_cmtEl && _cmtEl.style.display !== 'none') {
    var _cmtTa = document.getElementById('cp-comment-text-' + idx);
    _cmtState = {
      cardIdx: idx,
      text: _cmtTa ? _cmtTa.value : '',
      selStart: _cmtTa ? _cmtTa.selectionStart : 0,
      selEnd: _cmtTa ? _cmtTa.selectionEnd : 0
    };
  }

  view.innerHTML = html;

  /* ── Восстановить поле ввода комментария после перерисовки ── */
  if (_cmtState && _cmtState.cardIdx === idx) {
    var _cmtEl2 = document.getElementById('cp-comment-input-' + idx);
    if (_cmtEl2) {
      _cmtEl2.style.display = 'block';
      var _cmtTa2 = document.getElementById('cp-comment-text-' + idx);
      if (_cmtTa2) {
        _cmtTa2.value = _cmtState.text;
        _cmtTa2.selectionStart = _cmtState.selStart;
        _cmtTa2.selectionEnd = _cmtState.selEnd;
        _cmtTa2.focus();
      }
    }
  }

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
    /* Версионно-зависимый src: ищем pv-объект и берём актуальное превью */
    var src = '';
    if (slot.file && proj.previews && typeof pvGetPreview === 'function') {
      for (var pi = 0; pi < proj.previews.length; pi++) {
        if (proj.previews[pi].name === slot.file) {
          src = pvGetPreview(proj.previews[pi]) || pvGetThumb(proj.previews[pi]) || '';
          break;
        }
      }
    }
    if (!src) src = slot.dataUrl || slot.thumbUrl || '';
    /* Синтетические имена вида "slot_C_S.jpg" (см. supabase.js:385) — это
       плейсхолдеры пустого слота, не реальные файлы. Для них и для любых
       других случаев отсутствия src показываем пустой слот вместо
       попытки подтянуть несуществующий "images/...". */
    var isSynthName = slot.file && /^slot_\d+_\d+\.jpe?g$/i.test(slot.file);
    if (!src) {
      /* Файл привязан но картинки нет — показать как пустой */
      var label = (slot.file && !isSynthName) ? slot.file : 'Нет изображения';
      return '<div class="photo-slot empty' + mainCls + '" data-slot="' + slotIdx + '">' +
        '<div class="ph-text">' + esc(label) + '</div>' +
        '</div>';
    }
    var rot = slot.rotation || 0;
    var rotStyle = rot ? ' style="transform:rotate(' + rot + 'deg)"' : '';
    /* Кнопка увеличения: прямо на фото, иконка expand */
    var expandSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    var zoomBtn = '<button class="slot-expand" onclick="cpShowFullscreen(' + slotIdx + ',event)" title="На весь экран">' + expandSvg + '</button>';
    /* Стрелки карусели: листание фото в слоте (по ориентации) */
    var carouselArrows = '<div class="slot-carousel-arrows">' +
      '<button class="slot-carousel-arrow slot-carousel-prev" onclick="cpDesktopCarousel(' + slotIdx + ',-1,event)">&lsaquo;</button>' +
      '<button class="slot-carousel-arrow slot-carousel-next" onclick="cpDesktopCarousel(' + slotIdx + ',1,event)">&rsaquo;</button>' +
      '</div>';
    /* Бейдж «кто добавил» — показывается при наведении */
    var addedBadge = '';
    if (slot._addedBy) {
      addedBadge = '<span class="slot-added-by" title="' + esc(slot._addedAt || '') + '">' + esc(slot._addedBy) + '</span>';
    }
    return '<div class="photo-slot filled' + mainCls + '" data-slot="' + slotIdx + '" draggable="true">' +
      '<img src="' + src + '" loading="lazy"' + rotStyle + ' onerror="this.parentNode.classList.add(\'img-error\')">' +
      zoomBtn + carouselArrows + addedBadge +
      '<button class="remove-btn" onclick="cpClearSlotPhoto(' + slotIdx + ',event)">&times;</button></div>';
  }

  return '<div class="photo-slot empty' + mainCls + '" data-slot="' + slotIdx + '">' +
    '<div class="ph-text">' + (isHero ? 'Заглавное' : 'Перетащите фото') + '</div>' +
    toolbar +
    '</div>';
}

/**
 * Desktop-карусель: заменить фото в слоте на следующее/предыдущее.
 * Работает аналогично cpMobileCarousel, но для текущей карточки в редакторе.
 * Учитывает фильтр превью-панели (PV_FILTER['pv']) как минимальный рейтинг.
 * @param {number} slotIdx - индекс слота в текущей карточке
 * @param {number} dir - направление (-1 = назад, 1 = вперёд)
 * @param {Event} [e] - событие клика
 */
function cpDesktopCarousel(slotIdx, dir, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var proj = getActiveProject();
  if (!proj || !proj.cards || App.currentCardIdx < 0) return;

  var card = proj.cards[App.currentCardIdx];
  if (!card || !card.slots || slotIdx < 0 || slotIdx >= card.slots.length) return;
  var slot = card.slots[slotIdx];
  if (!slot) return;

  var orient = slot.orient || 'v';
  var currentFile = slot.file || '';

  /* Получить ближайшие по ориентации с учётом рейтинг-фильтра из превью-панели */
  var nearby = cpGetNearbyPreviews(currentFile, orient, 15);
  var minRating = (typeof PV_FILTER !== 'undefined') ? (PV_FILTER['pv'] || 0) : 0;
  if (minRating > 0) {
    var filtered = [];
    for (var f = 0; f < nearby.length; f++) {
      if ((nearby[f].rating || 0) >= minRating) filtered.push(nearby[f]);
    }
    /* Если фильтр отсёк всё — показать все без фильтра */
    if (filtered.length > 0) nearby = filtered;
  }
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

  /* Сохранить для undo */
  if (typeof cpPushUndo === 'function') cpPushUndo();

  /* Обновить данные слота (с учётом активной версии превью) */
  slot.file = newPv.name || newPv.stem || '';
  slot.dataUrl = (typeof pvGetPreview === 'function') ? pvGetPreview(newPv) : (newPv.preview || newPv.thumb || '');
  slot.thumbUrl = (typeof pvGetThumb === 'function') ? pvGetThumb(newPv) : (newPv.thumb || newPv.preview || '');
  slot.path = (typeof pvGetPath === 'function') ? pvGetPath(newPv) : (newPv.path || '');
  /* Метка актора + аудит */
  if (typeof sbStampActor === 'function') sbStampActor(slot);
  if (typeof sbLogAction === 'function') {
    var _card = getActiveProject().cards[App.currentCardIdx];
    sbLogAction('add_to_slot', 'card', _card ? _card.id : '', _card ? _card.name : '', slot.file);
  }

  /* Обновить ТОЛЬКО картинку в DOM (без перерисовки всей карточки) */
  var slotEl = document.querySelector('.photo-slot[data-slot="' + slotIdx + '"]');
  if (slotEl) {
    var img = slotEl.querySelector('img');
    if (img) img.src = slot.dataUrl || slot.thumbUrl || '';
  }

  /* Синхронизация */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof shAutoSave === 'function') shAutoSave();
}

/* cpSetCardFilter / _cpFilterStarsHTML — удалены.
   Десктопная карусель использует PV_FILTER['pv'] из превью-панели.
   Мобильная версия использует cpMobileSetOptionsFilter / _mobOptionsFilter. */

/**
 * Редактирование имени карточки inline.
 * Заменяет заголовок на input, по Enter/blur сохраняет.
 */
function cpEditCardName() {
  var proj = getActiveProject();
  if (!proj) return;
  var card = proj.cards[App.currentCardIdx];
  if (!card) return;

  var el = document.querySelector('.cp-card-name');
  if (!el) return;

  var currentName = (card.name && card.name.trim()) ? card.name.trim() : '';
  var placeholder = 'Карточка ' + (App.currentCardIdx + 1);
  var input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.placeholder = placeholder;
  input.className = 'cp-card-name-input';
  input.style.cssText = 'font-size:inherit; font-weight:inherit; border:1px solid #ccc; border-radius:4px; padding:2px 6px; width:180px; outline:none;';

  function save() {
    var val = input.value.trim();
    card.name = val || '';
    cpRenderCard();
    cpRenderList();
    if (typeof shAutoSave === 'function') shAutoSave();
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = currentName; save(); }
  });

  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
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
  var proj = getActiveProject();
  var card = proj.cards[App.currentCardIdx];
  var slot = card.slots[slotIdx];
  if (!slot || (!slot.file && !slot.dataUrl)) return;

  /* Одно фото в лайтбоксе — без листания (как в мобильной версии).
     Слот карточки всегда открывает только свою фотографию. */
  if (slot.file && proj.previews && typeof _pvLbOpen === 'function') {
    var pv = null;
    for (var pi = 0; pi < proj.previews.length; pi++) {
      if (proj.previews[pi].name === slot.file) { pv = proj.previews[pi]; break; }
    }
    if (pv) {
      _pvLbList = [pv];
      _pvLbIdx = 0;
      _pvLbOpen();
      return;
    }
  }

  /* Фолбэк: простой оверлей если превью не найдено.
     Если dataUrl нет — выходим (нет смысла открывать пустую картинку;
     "images/" фолбэк был мёртвым — такой папки не существует). */
  if (!slot.dataUrl) return;
  _cpFullscreenActive = true;
  var src = slot.dataUrl;
  var rot = slot.rotation || 0;
  var rotStyle = rot ? 'transform:rotate(' + rot + 'deg)' : '';

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

  var nameEl = document.createElement('div');
  nameEl.className = 'cp-fullscreen-name';
  nameEl.textContent = slot.file || '';

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(nameEl);
  document.body.appendChild(overlay);

  document.addEventListener('keydown', cpFullscreenEscHandler);
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
  var proj = getActiveProject();
  var card = proj.cards[App.currentCardIdx];
  var oldFile = card.slots[slotIdx].file;
  card.slots[slotIdx].file = null;
  card.slots[slotIdx].dataUrl = null;
  card.slots[slotIdx].thumbUrl = null;
  card.slots[slotIdx].path = null;
  if (oldFile && typeof sbLogAction === 'function') sbLogAction('remove_from_slot', 'card', card.id, card.name, oldFile);

  /* Клиентский режим: авто-переверстка (убрать пустые слоты, удалить пустые карточки) */
  if (typeof _appClientMode !== 'undefined' && _appClientMode) {
    cpAutoReflow(proj, App.currentCardIdx);
  }

  cpSyncFiles(card);
  cpRenderCard();
  cpRenderList();
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Авто-переверстка карточки после удаления фото (клиентский режим).
 * 1. Убирает пустые слоты из карточки (оставшиеся фото сдвигаются)
 * 2. Если карточка полностью пуста — удаляет её
 * 3. Корректирует App.currentCardIdx если нужно
 *
 * Вызывается ТОЛЬКО в клиентском режиме — фотограф управляет слотами вручную.
 *
 * @param {object} proj — текущий проект
 * @param {number} cardIdx — индекс карточки
 */
function cpAutoReflow(proj, cardIdx) {
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card.slots) return;

  /* 1. Собрать только заполненные слоты */
  var filled = [];
  for (var s = 0; s < card.slots.length; s++) {
    if (card.slots[s].file) {
      filled.push(card.slots[s]);
    }
  }

  if (filled.length === 0) {
    /* 2. Карточка пуста — удалить */
    proj.cards.splice(cardIdx, 1);
    /* Скорректировать текущий индекс */
    if (App.currentCardIdx >= proj.cards.length) {
      App.currentCardIdx = Math.max(0, proj.cards.length - 1);
    }
    console.log('cpAutoReflow: пустая карточка ' + cardIdx + ' удалена');
    return;
  }

  if (filled.length < card.slots.length) {
    /* 3. Есть пустые слоты — пересобрать массив слотов */
    card.slots = filled;
    console.log('cpAutoReflow: карточка ' + cardIdx + ' переверстана, осталось ' + filled.length + ' слотов');
  }
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
  var proj = getActiveProject();
  var brand = (proj && proj.brand) ? proj.brand : '';
  var tmpl = addUserTemplate(name, teSlots, hAspect, vAspect, true, teHasHero, brand);

  /* Также сохранить в proj._template для персистенции при save/load */
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
  var brand = proj.brand || '';
  var tmpl = addUserTemplate(name.trim(), config, hAspect, vAspect, card._lockRows, card._hasHero, brand);

  /* Также сохранить в proj._template для персистенции при save/load */
  if (proj) {
    proj._template = templateToProjFormat(tmpl);
  }

  alert('Шаблон "' + tmpl.name + '" сохранён (' + tmpl.slots.length + ' слотов)');
}


// ══════════════════════════════════════════════
//  Библиотека шаблонов (1.6d)
// ══════════════════════════════════════════════

/**
 * Открыть модалку библиотеки шаблонов.
 * Показывает список UserTemplates с превью, переименованием, удалением.
 */
function cpOpenTemplateLibrary() {
  var container = document.getElementById('tmpl-lib-list');
  if (!container) return;
  _cpRenderLibraryList();
  openModal('modal-tmpl-library');
}

/**
 * Отрисовать список шаблонов в библиотеке.
 * Вызывается при открытии и после любых изменений (удаление, переименование).
 */
function _cpRenderLibraryList() {
  var container = document.getElementById('tmpl-lib-list');
  if (!container) return;
  var proj = getActiveProject();

  if (UserTemplates.length === 0) {
    container.innerHTML = '<div class="tmpl-lib-empty">Нет сохранённых шаблонов</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < UserTemplates.length; i++) {
    var t = UserTemplates[i];
    var slotSummary = _cpTemplateSlotSummary(t);
    var brandLabel = t.brand ? ' [' + esc(t.brand) + ']' : '';
    var isActive = proj && proj._template && proj._template.id === t.id;

    html += '<div class="tmpl-lib-item' + (isActive ? ' tmpl-lib-active' : '') + '" data-tmpl-id="' + t.id + '">';
    html += '<div class="tmpl-lib-preview">' + _cpTemplateMiniPreview(t) + '</div>';
    html += '<div class="tmpl-lib-info">';
    html += '<div class="tmpl-lib-name">' + esc(t.name) + brandLabel + '</div>';
    html += '<div class="tmpl-lib-meta">' + slotSummary + '</div>';
    html += '</div>';
    html += '<div class="tmpl-lib-actions">';
    html += '<button class="btn btn-sm" onclick="cpLibApplyTemplate(\'' + t.id + '\')">Применить</button>';
    html += '<button class="btn btn-sm" onclick="cpLibApplyToAll(\'' + t.id + '\')">Ко всем</button>';
    html += '<button class="btn btn-sm" onclick="cpLibRenameTemplate(\'' + t.id + '\')">Имя</button>';
    html += '<button class="btn btn-sm" onclick="cpLibEditBrand(\'' + t.id + '\')">Бренд</button>';
    html += '<button class="btn btn-sm" onclick="cpLibDuplicateTemplate(\'' + t.id + '\')">Копия</button>';
    html += '<button class="btn btn-sm delete-card-btn" onclick="cpLibDeleteTemplate(\'' + t.id + '\')">X</button>';
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

/**
 * Мини-описание слотов шаблона: "3V + 1H (4 фото)"
 * @param {Object} t — шаблон
 * @returns {string}
 */
function _cpTemplateSlotSummary(t) {
  var v = 0, h = 0;
  (t.slots || []).forEach(function(s) {
    if (s.orient === 'h') h++;
    else v++;
  });
  var parts = [];
  if (v > 0) parts.push(v + 'V');
  if (h > 0) parts.push(h + 'H');
  return parts.join(' + ') + ' (' + (t.slots || []).length + ' фото)';
}

/**
 * Мини-превью шаблона: маленькая раскладка из серых прямоугольников.
 * @param {Object} t — шаблон
 * @returns {string} HTML
 */
function _cpTemplateMiniPreview(t) {
  if (!t.slots || t.slots.length === 0) return '';
  /* Группируем слоты по рядам через layAutoRows (если доступна) */
  var rows;
  if (typeof layAutoRows === 'function') {
    rows = layAutoRows(t.slots, t.hAspect || '3/2', t.vAspect || '2/3');
  } else {
    /* фолбэк: все в один ряд */
    rows = [t.slots.map(function(_, i) { return i; })];
  }
  var html = '<div class="tmpl-mini-grid">';
  for (var r = 0; r < rows.length; r++) {
    html += '<div class="tmpl-mini-row">';
    for (var c = 0; c < rows[r].length; c++) {
      var si = rows[r][c];
      var s = t.slots[si] || {};
      var cls = (s.orient === 'h') ? 'tmpl-mini-h' : 'tmpl-mini-v';
      html += '<div class="tmpl-mini-slot ' + cls + '"></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

/**
 * Применить шаблон из библиотеки к текущей карточке.
 * @param {string} tmplId
 */
function cpLibApplyTemplate(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  _cpApplyTemplateToCard(tmpl, App.currentCardIdx);
  closeModal('modal-tmpl-library');
  cpRenderList();
}

/**
 * Применить шаблон ко всем карточкам проекта (1.6e).
 * @param {string} tmplId
 */
function cpLibApplyToAll(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  var proj = getActiveProject();
  if (!proj || !proj.cards || proj.cards.length === 0) {
    alert('Нет карточек');
    return;
  }
  if (!confirm('Применить шаблон "' + tmpl.name + '" ко всем ' + proj.cards.length + ' карточкам? Фото сохранятся по позициям.')) return;

  cpSaveHistory();
  for (var i = 0; i < proj.cards.length; i++) {
    _cpApplyTemplateToCard(tmpl, i);
  }
  closeModal('modal-tmpl-library');
  cpRenderList();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Общая логика применения шаблона к одной карточке по индексу.
 * Сохраняет фото по позициям из старых слотов.
 * @param {Object} tmpl — шаблон из UserTemplates
 * @param {number} cardIdx — индекс карточки
 */
function _cpApplyTemplateToCard(tmpl, cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || cardIdx < 0 || cardIdx >= proj.cards.length) return;

  var card = proj.cards[cardIdx];
  var hAspect = tmpl.hAspect || '3/2';
  var vAspect = tmpl.vAspect || '2/3';
  var oldSlots = card.slots || [];

  /* Создать новые слоты, сохраняя файлы по позициям */
  var newSlots = [];
  for (var i = 0; i < (tmpl.slots || []).length; i++) {
    var s = tmpl.slots[i];
    var aspect = (s.orient === 'h') ? hAspect : vAspect;
    var old = oldSlots[i] || {};
    newSlots.push({
      orient: s.orient,
      weight: s.weight || 1,
      row: 0,
      aspect: aspect,
      file: old.file || null,
      dataUrl: old.dataUrl || null,
      path: old.path || null
    });
  }

  card.slots = newSlots;
  card._hAspect = hAspect;
  card._vAspect = vAspect;
  card._lockRows = true;
  card._hasHero = (tmpl.hasHero !== undefined) ? tmpl.hasHero : true;
  card.files = card.slots.map(function(sl) { return sl ? sl.file : null; }).filter(Boolean);

  /* Авто-раскладка рядов */
  if (card.slots.length > 1 && typeof layAutoRows === 'function') {
    var autoRows = layAutoRows(card.slots, hAspect, vAspect);
    if (typeof layAssignRows === 'function') layAssignRows(card.slots, autoRows);
  }

  /* Обновить proj._template */
  proj._template = templateToProjFormat(tmpl);
  proj.templateId = tmpl.id;
}

/**
 * Переименовать шаблон в библиотеке.
 * @param {string} tmplId
 */
function cpLibRenameTemplate(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  var name = prompt('Новое имя:', tmpl.name);
  if (!name || !name.trim()) return;
  updateUserTemplate(tmplId, { name: name.trim() });
  _cpRenderLibraryList();
}

/**
 * Изменить бренд шаблона.
 * @param {string} tmplId
 */
function cpLibEditBrand(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  var brand = prompt('Бренд:', tmpl.brand || '');
  if (brand === null) return;
  updateUserTemplate(tmplId, { brand: brand.trim() });
  _cpRenderLibraryList();
}

/**
 * Дублировать шаблон.
 * @param {string} tmplId
 */
function cpLibDuplicateTemplate(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  addUserTemplate(
    tmpl.name + ' (копия)',
    tmpl.slots || [],
    tmpl.hAspect, tmpl.vAspect, tmpl.lockRows, tmpl.hasHero, tmpl.brand
  );
  _cpRenderLibraryList();
}

/**
 * Удалить шаблон.
 * @param {string} tmplId
 */
function cpLibDeleteTemplate(tmplId) {
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  if (!confirm('Удалить шаблон "' + tmpl.name + '"?')) return;
  deleteUserTemplate(tmplId);
  _cpRenderLibraryList();
}


// ══════════════════════════════════════════════
//  Выбор шаблона прямо в карточке (dropdown)
// ══════════════════════════════════════════════

/**
 * Построить HTML выпадающего списка шаблонов для тулбара карточки.
 * @returns {string} HTML <select> с опциями
 */
function _cpTemplateSelectHTML() {
  var proj = getActiveProject();
  var activeId = (proj && proj._template) ? proj._template.id : (proj ? proj.templateId : '');

  var html = '<select class="cp-tmpl-select" onchange="cpQuickApplyTemplate(this.value)">';
  html += '<option value="">-- Шаблон --</option>';
  for (var i = 0; i < UserTemplates.length; i++) {
    var t = UserTemplates[i];
    var brandTag = t.brand ? ' [' + esc(t.brand) + ']' : '';
    var sel = (t.id === activeId) ? ' selected' : '';
    html += '<option value="' + t.id + '"' + sel + '>' + esc(t.name) + brandTag + '</option>';
  }
  html += '</select>';
  return html;
}

/**
 * Быстрое применение шаблона из dropdown в карточке.
 * @param {string} tmplId
 */
function cpQuickApplyTemplate(tmplId) {
  if (!tmplId) return;
  var tmpl = getUserTemplate(tmplId);
  if (!tmpl) return;
  cpSaveHistory();
  _cpApplyTemplateToCard(tmpl, App.currentCardIdx);
  cpRenderList();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
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
          slot.path = (typeof pvGetPath === 'function') ? pvGetPath(pv) : (pv.path || '');
          /* Используем preview (1200px) для карточки, thumb (300px) как фолбэк */
          /* С учётом активной версии (ЦК/ретушь) */
          slot.dataUrl = (typeof pvGetPreview === 'function') ? pvGetPreview(pv) : (pv.preview || pv.thumb);
          slot.thumbUrl = (typeof pvGetThumb === 'function') ? pvGetThumb(pv) : pv.thumb;
          /* Метка актора + аудит */
          if (typeof sbStampActor === 'function') sbStampActor(slot);
          if (typeof sbLogAction === 'function') sbLogAction('add_to_slot', 'card', card.id, card.name, pv.name);
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

        /* Видео: захватить первый кадр с плашкой «ВИДЕО», добавить как фото */
        if (file.type.startsWith('video/')) {
          _cpVideoToThumb(file, function(thumbDataUrl, thumbOrient) {
            cpSaveHistory();
            slot.file = file.name;
            slot.dataUrl = thumbDataUrl;
            slot.path = '';
            slot._isVideo = true; /* маркер: исходный файл — видео */
            if (thumbOrient && slot.orient !== thumbOrient) slot.orient = thumbOrient;
            if (typeof sbStampActor === 'function') sbStampActor(slot);
            if (typeof sbLogAction === 'function') sbLogAction('add_video_to_slot', 'card', card.id, card.name, file.name);
            cpSyncFiles(card);
            cpRenderCard();
            cpRenderList();
            if (typeof shAutoSave === 'function') shAutoSave();
          });
          return;
        }

        if (!file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          cpSaveHistory();
          slot.file = file.name;
          slot.dataUrl = ev.target.result;
          slot.path = '';
          if (typeof sbStampActor === 'function') sbStampActor(slot);
          if (typeof sbLogAction === 'function') sbLogAction('add_to_slot', 'card', card.id, card.name, file.name);
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

// ══════════════════════════════════════════════
//  Видео → превью-кадр с плашкой «ВИДЕО»
//
//  При дропе видеофайла в слот: захватываем первый кадр через Canvas,
//  рисуем плашку, сохраняем dataUrl как обычную картинку.
//  Клиент видит превью и может расставить видео по карточкам,
//  а потом переименовать через артикулы.
// ══════════════════════════════════════════════

/**
 * Получить превью-кадр из видеофайла с плашкой «ВИДЕО».
 * @param {File} file — видеофайл (.mp4, .mov, .avi и т.д.)
 * @param {function} callback — callback(dataUrl, orient)
 *   dataUrl — base64 PNG с кадром и плашкой
 *   orient  — 'h' если горизонтальное, 'v' если вертикальное
 */
function _cpVideoToThumb(file, callback) {
  var video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  var objUrl = URL.createObjectURL(file);
  video.src = objUrl;

  /* Переходим к 0.5 сек чтобы пропустить возможно чёрный первый кадр */
  video.addEventListener('loadeddata', function() {
    video.currentTime = Math.min(0.5, video.duration * 0.1 || 0);
  });

  video.addEventListener('seeked', function() {
    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 720;
    var orient = vw >= vh ? 'h' : 'v';

    /* Масштабируем до 1200px по длинной стороне */
    var maxSide = 1200;
    var scale = Math.min(maxSide / vw, maxSide / vh, 1);
    var cw = Math.round(vw * scale);
    var ch = Math.round(vh * scale);

    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');

    /* Кадр */
    ctx.drawImage(video, 0, 0, cw, ch);

    /* Плашка «ВИДЕО» — полупрозрачный прямоугольник + текст */
    var badgeH = Math.round(ch * 0.12);
    var badgeW = Math.round(cw * 0.35);
    var badgeX = Math.round(cw * 0.04);
    var badgeY = Math.round(ch * 0.04);
    var fontSize = Math.round(badgeH * 0.55);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    _cpRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();

    /* Треугольник-«play» */
    var triSize = Math.round(badgeH * 0.45);
    var triX = badgeX + Math.round(badgeH * 0.35);
    var triY = badgeY + Math.round(badgeH * 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(triX, triY - triSize / 2);
    ctx.lineTo(triX + triSize * 0.85, triY);
    ctx.lineTo(triX, triY + triSize / 2);
    ctx.closePath();
    ctx.fill();

    /* Текст */
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + fontSize + 'px -apple-system, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    var textX = triX + triSize + Math.round(badgeH * 0.2);
    var textY = badgeY + Math.round(badgeH * 0.5);
    ctx.fillText('ВИДЕО', textX, textY);

    var dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    URL.revokeObjectURL(objUrl);
    callback(dataUrl, orient);
  });

  video.addEventListener('error', function() {
    /* Не удалось декодировать — вернуть заглушку */
    URL.revokeObjectURL(objUrl);
    var canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ВИДЕО', 600, 400);
    callback(canvas.toDataURL('image/jpeg', 0.8), 'h');
  });

  video.load();
}

/**
 * Вспомогательная: нарисовать закруглённый прямоугольник на Canvas.
 */
function _cpRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* Prevent browser from opening dropped files */
document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) { e.preventDefault(); });

/**
 * Full-area drop zone: при перетаскивании файлов в окно показывает
 * полноэкранную зону, файлы попадают в пул превью текущего проекта.
 * Особенно полезно когда превью ещё не загружены и дропзона маленькая.
 */
(function() {
  var overlay = null;
  var hideTimer = null;

  function getOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'cp-fullscreen-drop';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'background:rgba(0,0,0,0.25);z-index:9999;display:none;' +
      'align-items:center;justify-content:center;pointer-events:all';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:40px 60px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center">' +
      '<div style="font-size:18px;font-weight:600;margin-bottom:8px">Перетащите фото сюда</div>' +
      '<div style="font-size:13px;color:#888">Файлы или папка с фотографиями</div></div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    overlay.addEventListener('dragleave', function(e) {
      /* Скрыть только если курсор вышел за пределы overlay */
      if (e.relatedTarget && overlay.contains(e.relatedTarget)) return;
      hideOverlay();
    });
    overlay.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      hideOverlay();

      /* Направить файлы в dropzone превью */
      var dz = document.getElementById('pv-dropzone');
      if (dz) {
        /* Синтетический drop-event на дропзону */
        var synth = new DragEvent('drop', {
          dataTransfer: e.dataTransfer,
          bubbles: true, cancelable: true
        });
        dz.dispatchEvent(synth);
      }
    });
    return overlay;
  }

  function showOverlay() {
    var el = getOverlay();
    el.style.display = 'flex';
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  var enterCount = 0;
  document.addEventListener('dragenter', function(e) {
    /* Показать только для файлов из ОС, не для внутренних drag */
    if (!e.dataTransfer || !e.dataTransfer.types) return;
    var hasFiles = false;
    for (var i = 0; i < e.dataTransfer.types.length; i++) {
      if (e.dataTransfer.types[i] === 'Files') { hasFiles = true; break; }
    }
    if (!hasFiles) return;
    /* Не показывать если уже внутри приложения (drag из галереи) */
    if (e.dataTransfer.types.indexOf('application/x-preview') >= 0) return;

    enterCount++;
    if (enterCount === 1) showOverlay();
  });

  document.addEventListener('dragleave', function(e) {
    enterCount--;
    if (enterCount <= 0) {
      enterCount = 0;
      /* Задержка чтобы не мерцало при переходе между элементами */
      hideTimer = setTimeout(hideOverlay, 100);
    }
  });

  document.addEventListener('drop', function() {
    enterCount = 0;
    hideOverlay();
  });
})();


// ══════════════════════════════════════════════
//  History / Undo
// ══════════════════════════════════════════════

/**
 * Сохранить текущее состояние карточки в undo-стек.
 * Вызывается перед любым изменением слотов.
 */
function cpSaveHistory() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[App.currentCardIdx]) return;
  var card = proj.cards[App.currentCardIdx];
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
        thumbUrl: s.thumbUrl || null,
        path: s.path
      };
    })
  };
  card._history.push(JSON.stringify(snap));
  if (card._history.length > CP_MAX_HISTORY) card._history.shift();

  /* Авто-синхронизация карточек с облаком (debounced) */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
}

/**
 * Откатить последнее изменение (Ctrl+Z).
 */
function cpUndo() {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[App.currentCardIdx]) return;
  var card = proj.cards[App.currentCardIdx];
  if (!card._history || !card._history.length) return;
  try {
    var snap = JSON.parse(card._history.pop());
  } catch(e) { console.error('cpUndo: corrupted history entry'); return; }
  card.slots = snap.slots;
  if (snap.category !== undefined) card.category = snap.category;
  /* Восстановить параметры шаблона карточки */
  if (snap._hasHero !== undefined) card._hasHero = snap._hasHero;
  if (snap._lockRows !== undefined) card._lockRows = snap._lockRows;
  if (snap._hAspect !== undefined) card._hAspect = snap._hAspect;
  if (snap._vAspect !== undefined) card._vAspect = snap._vAspect;
  cpSyncFiles(card);
  cpRenderList();
  cpRenderCard(); /* Обновить редактор карточки после undo */
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
  /* Явная синхронизация с облаком при изменении файлов в карточке */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
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

/** @type {string} Текущий режим: 'cards' | 'select' | 'options' */
var _mobViewMode = 'cards';

/** @type {string} Режим, в котором был последний рендер — для сохранения скролла. */
var _mobLastRenderedView = '';

/**
 * Проверить, нужен ли мобильный режим.
 * @returns {boolean}
 */
function cpIsMobileClient() {
  return (_appClientMode || _appMobileOwner) && window.innerWidth < 768;
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

  /* Оверлей «переверните телефон» для iOS (в CSS скрыт в ландшафте) */
  if (!document.getElementById('mob-rotate-overlay')) {
    var rotOverlay = document.createElement('div');
    rotOverlay.id = 'mob-rotate-overlay';
    rotOverlay.className = 'mob-rotate-overlay';
    rotOverlay.innerHTML = '<div style="font-size:48px">&#8635;</div>' +
      '<div>Пожалуйста, переверните телефон<br>в вертикальное положение</div>';
    document.body.appendChild(rotOverlay);
  }

  /* Скрыть все дочерние элементы кроме mob-wrap */
  for (var i = 0; i < appMain.children.length; i++) {
    var child = appMain.children[i];
    if (child.id !== 'mob-wrap') {
      child.style.display = 'none';
    }
  }

  /* Пометка для CSS — чтобы html/body получили белый фон
     (иначе под полупрозрачной адресной строкой Telegram/Safari
     просвечивает серый body-background). */
  document.body.classList.add('mob-client-mode');

  _mobViewMode = 'cards';

  /* Заблокировать поворот экрана — только портретная ориентация.
     Работает в Android Chrome; iOS Safari не поддерживает lock. */
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('portrait').catch(function() { /* тихо игнорируем если не поддерживается */ });
  }

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

  _mobViewMode = 'cards';
}

/**
 * Отрисовать мобильный интерфейс (шапка + лента/галерея/отбор).
 */
function cpMobileRender() {
  var mobWrap = document.getElementById('mob-wrap');
  if (!mobWrap) return;

  /* Сохранить позицию скролла только если режим просмотра не менялся —
     иначе при переключении табов (cards→select) скролл из одной ленты
     не имеет смысла применять к другой. */
  var _mobSavedScroll = 0;
  if (_mobLastRenderedView === _mobViewMode) {
    _mobSavedScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
  }
  _mobLastRenderedView = _mobViewMode;

  var proj = getActiveProject();
  var brandName = proj ? esc(proj.brand || '') : '';

  var html = '';

  /* Sticky-шапка: бургер-кнопка + название + табы */
  html += '<div class="mob-header">';
  html += '<div class="mob-header-left">';
  /* Кнопка «назад к списку проектов» для мобильного владельца */
  if (typeof _appMobileOwner !== 'undefined' && _appMobileOwner) {
    html += '<button class="mob-back-btn" onclick="_mobBackToProjects()" title="К проектам">';
    html += '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    html += '</button>';
  }
  html += '<button class="mob-burger" onclick="cpMobileToggleCardMenu()" title="Список карточек">';
  html += '<span></span><span></span><span></span>';
  html += '</button>';
  html += '<div class="mob-header-title">' + (brandName || 'Просмотр') + '</div>';
  html += '</div>';
  html += '<div class="mob-header-tabs">';
  html += '<button class="mob-tab-btn' + (_mobViewMode === 'cards' ? ' mob-tab-active' : '') + '" onclick="cpMobileSetView(\'cards\')">Cards</button>';
  html += '<button class="mob-tab-btn' + (_mobViewMode === 'select' ? ' mob-tab-active' : '') + '" onclick="cpMobileSetView(\'select\')">Select</button>';
  html += '<button class="mob-tab-btn' + (_mobViewMode === 'other' ? ' mob-tab-active' : '') + '" onclick="cpMobileSetView(\'other\')">Other</button>';
  html += '<button class="mob-tab-btn' + (_mobViewMode === 'options' ? ' mob-tab-active' : '') + '" onclick="cpMobileSetView(\'options\')">Options</button>';
  html += '</div>';
  html += '</div>';

  /* Выдвижное меню карточек (бургер) */
  html += _cpMobileCardMenuHTML(proj);

  if (_mobViewMode === 'cards') {
    html += cpMobileRenderFeed();
  } else if (_mobViewMode === 'select') {
    html += cpMobileRenderSelect();
  } else if (_mobViewMode === 'other') {
    html += cpMobileRenderOther();
  } else if (_mobViewMode === 'pipeline') {
    html += cpMobileRenderPipeline();
  } else {
    html += cpMobileRenderGallery();
  }

  mobWrap.innerHTML = html;

  /* Выровнять mob-filter-bar по реальной высоте хедера (чтобы не было зазора) */
  var _hdr = mobWrap.querySelector('.mob-header');
  var _fb  = mobWrap.querySelector('.mob-filter-bar');
  if (_hdr && _fb) {
    _fb.style.top = _hdr.offsetHeight + 'px';
  }

  /* Привязать touch-события к каруселям */
  if (_mobViewMode === 'cards') {
    cpMobileBindCarousels();
    cpMobileBindDoubleTap();
    cpMobileBindSlotTap();
  }

  /* Восстановить скролл после полного ре-рендера. */
  if (_mobSavedScroll > 0) {
    try { window.scrollTo(0, _mobSavedScroll); } catch(e) {}
  }
}

// ══════════════════════════════════════════════
//  Мобильное меню карточек (бургер)
// ══════════════════════════════════════════════

/**
 * Генерирует HTML выдвижного меню со списком карточек.
 * Меню появляется слева при нажатии на бургер-кнопку.
 * @param {object} proj — активный проект
 * @returns {string} HTML
 */
function _cpMobileCardMenuHTML(proj) {
  if (!proj || !proj.cards || proj.cards.length === 0) return '';

  var html = '';
  html += '<div class="mob-card-menu" id="mob-card-menu">';
  html += '<div class="mob-card-menu-overlay" onclick="cpMobileToggleCardMenu()"></div>';
  html += '<div class="mob-card-menu-panel">';
  html += '<div class="mob-card-menu-header">';
  html += '<span>Карточки (' + proj.cards.length + ')</span>';
  html += '<button class="mob-card-menu-close" onclick="cpMobileToggleCardMenu()">&times;</button>';
  html += '</div>';

  /* Ссылка на пайплайн / историю съёмки */
  var pipelineLabel = (window._isShareLink) ? 'История съёмки' : 'Пайплайн';
  html += '<button class="mob-card-menu-pipeline-btn" onclick="cpMobileToggleCardMenu();cpMobileSetView(\'pipeline\')">';
  html += pipelineLabel;
  html += '</button>';

  html += '<div class="mob-card-menu-list">';

  for (var i = 0; i < proj.cards.length; i++) {
    var card = proj.cards[i];
    var label = (card.name && card.name.trim()) ? esc(card.name.trim()) : ('Карточка ' + (i + 1));

    /* Мини-инфо: сколько слотов заполнено */
    var filled = 0;
    var total = card.slots ? card.slots.length : 0;
    for (var s = 0; s < total; s++) {
      if (card.slots[s] && (card.slots[s].file || card.slots[s].dataUrl)) filled++;
    }
    var info = filled + ' / ' + total;

    /* Первое фото как миниатюра (если есть) */
    var thumbSrc = '';
    if (card.slots) {
      for (var t = 0; t < card.slots.length; t++) {
        if (card.slots[t] && (card.slots[t].thumbUrl || card.slots[t].dataUrl || card.slots[t].thumb)) {
          thumbSrc = card.slots[t].thumbUrl || card.slots[t].thumb || card.slots[t].dataUrl;
          break;
        }
      }
    }

    html += '<button class="mob-card-menu-item" onclick="cpMobileGoToCard(' + i + ')">';
    if (thumbSrc) {
      html += '<img class="mob-card-menu-thumb" src="' + thumbSrc + '">';
    } else {
      html += '<div class="mob-card-menu-thumb mob-card-menu-thumb-empty"></div>';
    }
    html += '<div class="mob-card-menu-item-info">';
    html += '<div class="mob-card-menu-item-name">' + label + '</div>';
    html += '<div class="mob-card-menu-item-count">' + info + ' фото</div>';
    html += '</div>';
    html += '</button>';
  }

  html += '</div></div></div>';
  return html;
}

/**
 * Открыть/закрыть выдвижное меню карточек.
 */
function cpMobileToggleCardMenu() {
  var menu = document.getElementById('mob-card-menu');
  if (!menu) return;
  menu.classList.toggle('mob-card-menu-open');
}

/**
 * Перейти к карточке: переключить на вкладку Cards, закрыть меню, прокрутить к карточке.
 * @param {number} cardIdx — индекс карточки
 */
function cpMobileGoToCard(cardIdx) {
  /* Закрыть меню */
  var menu = document.getElementById('mob-card-menu');
  if (menu) menu.classList.remove('mob-card-menu-open');

  /* Переключить на вкладку Cards если не на ней */
  if (_mobViewMode !== 'cards') {
    _mobViewMode = 'cards';
    cpMobileRender();
  }

  /* Прокрутить к карточке */
  setTimeout(function() {
    var block = document.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"]');
    if (block) {
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);
}

/**
 * Переключение режима мобильного клиента.
 * @param {string} mode — 'cards' | 'select' | 'options'
 */
function cpMobileSetView(mode) {
  _mobViewMode = mode;
  cpMobileRender();
}


/**
 * Мобильный рендер пайплайна съёмки (только чтение).
 * Для клиентов по share-ссылке называется "История съёмки",
 * для владельца — "Пайплайн".
 * @returns {string} HTML
 */
function cpMobileRenderPipeline() {
  var proj = getActiveProject();
  if (!proj) {
    return '<div style="padding:40px 16px;text-align:center;color:#999">Нет данных</div>';
  }

  var title = (window._isShareLink) ? 'История съёмки' : 'Пайплайн';
  var stage = proj._stage || 0;

  /* Считаем фото по этапам (если функция доступна) */
  var photoCounts = (typeof shPhotosPerStage === 'function') ? shPhotosPerStage(proj) : [];
  var totalPhotos = (proj.previews) ? proj.previews.length : 0;

  var html = '<div class="mob-pipeline">';
  html += '<div class="mob-pipeline-title">' + esc(title) + '</div>';

  html += '<div class="mob-pipeline-steps">';

  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var s = PIPELINE_STAGES[i];
    var cnt = photoCounts[i] || 0;

    /* Состояние: done / active / future */
    var cls = '';
    if (totalPhotos > 0) {
      var hasPhotosAfter = false;
      for (var j = i + 1; j < PIPELINE_STAGES.length; j++) {
        if ((photoCounts[j] || 0) > 0) { hasPhotosAfter = true; break; }
      }
      if (cnt === 0 && hasPhotosAfter) cls = 'done';
      else if (cnt > 0) cls = 'active';
    } else {
      /* Нет фото — опираемся на proj._stage */
      if (i < stage) cls = 'done';
      else if (i === stage) cls = 'active';
    }

    html += '<div class="mob-pipeline-step mob-pipeline-step-' + (cls || 'future') + '">';

    /* Точка-индикатор */
    html += '<div class="mob-pipeline-dot">';
    html += (cls === 'done') ? '&#10003;' : (i + 1);
    html += '</div>';

    html += '<div class="mob-pipeline-step-info">';
    html += '<div class="mob-pipeline-step-name">' + esc(s.name);
    if (totalPhotos > 0 && cnt > 0) {
      var pct = Math.round(cnt / totalPhotos * 100);
      html += '<span class="mob-pipeline-step-count">' + cnt + ' фото (' + pct + '%)</span>';
    }
    html += '</div>';

    /* Дата / заметка */
    if (cls === 'done' && proj._stageHistory && proj._stageHistory[i]) {
      html += '<div class="mob-pipeline-step-note">' + esc(proj._stageHistory[i]) + '</div>';
    } else if (cls === 'active' && proj._stageDates && proj._stageDates[i] && proj._stageDates[i].firstEnter) {
      var enterDate = new Date(proj._stageDates[i].firstEnter);
      html += '<div class="mob-pipeline-step-note">c ' + enterDate.toLocaleDateString('ru-RU') + '</div>';
    }

    html += '</div>'; /* step-info */
    html += '</div>'; /* step */
  }

  html += '</div>'; /* steps */
  html += '</div>'; /* pipeline */
  return html;
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

      /* Aspect ratio из шаблона карточки (например '2/3', '3/4', '4/5').
         Для вертикальных берём _vAspect, для горизонтальных — _hAspect.
         Hero-слот показывается в полную ширину без фиксированного соотношения. */
      var slotStyle = '';
      if (slotClass === 'mob-slot-v') {
        var vAspect = card._vAspect || '2/3';
        slotStyle = ' style="aspect-ratio:' + vAspect.replace('/', ' / ') + '"';
      } else if (slotClass === 'mob-slot-h') {
        var hAspect = card._hAspect || '3/2';
        slotStyle = ' style="aspect-ratio:' + hAspect.replace('/', ' / ') + '"';
      }

      var hasFoto = slot.file || slot.dataUrl;

      if (hasFoto) {
        var src = slot.dataUrl || slot.thumbUrl || slot.thumb || '';
        html += '<div class="' + slotClass + ' mob-carousel-wrap"' + slotStyle + ' data-card="' + ci + '" data-slot="' + si + '">';
        html += '<img src="' + src + '" loading="lazy">';
        /* Стрелки и удаление — скрыты, появляются по тапу на этот слот */
        html += '<div class="mob-carousel-controls mob-controls-hidden" data-controls="' + ci + '-' + si + '">';
        html += '<div class="mob-carousel-arrows">';
        html += '<button class="mob-carousel-arrow" onclick="cpMobileCarousel(' + ci + ',' + si + ',-1,event)">&lsaquo;</button>';
        html += '<button class="mob-carousel-arrow" onclick="cpMobileCarousel(' + ci + ',' + si + ',1,event)">&rsaquo;</button>';
        html += '</div>';
        html += '<button class="mob-slot-zoom" onclick="cpMobileSlotFullscreen(' + ci + ',' + si + ',event)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>';
        html += '<button class="mob-slot-remove" onclick="cpMobileClearSlot(' + ci + ',' + si + ')">&times;</button>';
        html += '</div>';
        html += '</div>';
      } else {
        /* Пустой слот */
        html += '<div class="' + slotClass + ' mob-slot-empty"' + slotStyle + ' data-card="' + ci + '" data-slot="' + si + '">';
        html += '<div class="mob-slot-empty-text">Нажмите дважды чтобы добавить фото</div>';
        html += '</div>';
      }
    }

    html += '</div>'; /* mob-card-slots */

    /* Кнопка "добавить слот" — только в клиентском режиме */
    if (typeof _appClientMode !== 'undefined' && _appClientMode) {
      html += '<button class="mob-slot-add-btn" onclick="cpMobileAddSlot(' + ci + ')" ';
      html += 'aria-label="Добавить слот">+ Добавить слот</button>';
    }

    /* Комментарии к карточке (мобильная версия) */
    try { html += _cpMobileCommentsHTML(ci, card); } catch(e) { console.error('mob-comments render:', e); }

    html += '</div>'; /* mob-card-block */
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
 * Обновляет ТОЛЬКО img в этом слоте — без перерисовки всей ленты.
 * @param {number} cardIdx - индекс карточки
 * @param {number} slotIdx - индекс слота
 * @param {number} dir - направление (-1 = назад, 1 = вперёд)
 * @param {Event} [e] - событие клика (останавливаем всплытие)
 */
function cpMobileCarousel(cardIdx, slotIdx, dir, e) {
  if (e) e.stopPropagation();
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;

  var card = proj.cards[cardIdx];
  if (!card.slots || slotIdx < 0 || slotIdx >= card.slots.length) return;
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

  /* Обновить слот данные (с учётом активной версии) */
  slot.file = newPv.name || newPv.stem || '';
  slot.dataUrl = (typeof pvGetPreview === 'function') ? pvGetPreview(newPv) : (newPv.preview || newPv.thumb || '');
  slot.path = (typeof pvGetPath === 'function') ? pvGetPath(newPv) : (newPv.path || '');
  if (typeof sbStampActor === 'function') sbStampActor(slot);
  if (typeof sbLogAction === 'function') sbLogAction('add_to_slot', 'card', card.id, card.name, slot.file);

  /* Обновить ТОЛЬКО картинку в DOM (без перерисовки ленты) */
  var wrap = document.querySelector('.mob-carousel-wrap[data-card="' + cardIdx + '"][data-slot="' + slotIdx + '"]');
  if (wrap) {
    var img = wrap.querySelector('img');
    if (img) img.src = slot.dataUrl;
  }

  /* Авто-синхронизация (тихо, без UI перерисовки) */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof shAutoSave === 'function') shAutoSave();
}

/**
 * Добавить новый пустой слот в карточку (мобильный клиент).
 * Нужно чтобы клиент мог вернуть удалённый слот или добавить ещё фото.
 * Ориентация нового слота берётся из последнего слота карточки (или 'v' по умолчанию).
 * @param {number} cardIdx
 */
function cpMobileAddSlot(cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card.slots) card.slots = [];

  /* Ориентация: наследуем от последнего слота — так вероятнее совпадёт с шаблоном */
  var defOrient = 'v';
  if (card.slots.length > 0) {
    var last = card.slots[card.slots.length - 1];
    defOrient = last.orient || 'v';
  }

  card.slots.push({
    orient: defOrient,
    weight: 1,
    options: [],
    selected: -1,
    file: null,
    dataUrl: null,
    thumbUrl: null,
    path: null,
    comment: ''
  });

  if (typeof sbLogAction === 'function') sbLogAction('add_slot', 'card', card.id, card.name, '');
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Хирургический апдейт: перерисовать только mob-card-block этой карточки */
  if (_mobViewMode === 'cards') {
    var block = document.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"]');
    if (block && block.parentNode) {
      var feedHtml = '';
      try { feedHtml = cpMobileRenderFeed(); } catch(e) { feedHtml = ''; }
      var tmp = document.createElement('div');
      tmp.innerHTML = feedHtml;
      var newBlock = tmp.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"]');
      if (newBlock) {
        block.parentNode.replaceChild(newBlock, block);
        if (typeof cpMobileBindCarousels === 'function') cpMobileBindCarousels();
        if (typeof cpMobileBindDoubleTap === 'function') cpMobileBindDoubleTap();
        if (typeof cpMobileBindSlotTap === 'function') cpMobileBindSlotTap();
        /* Прокрутить к новому слоту, чтобы клиент видел куда он добавился */
        var newSlot = newBlock.querySelector('.mob-slot-empty:last-of-type');
        if (newSlot && newSlot.scrollIntoView) {
          try { newSlot.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e2) {}
        }
        return;
      }
    }
  }

  /* Фолбэк */
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
  var card = proj.cards[cardIdx];
  if (!card.slots || slotIdx < 0 || slotIdx >= card.slots.length) return;

  var slot = card.slots[slotIdx];
  if (!slot) return;

  var oldFile = slot.file;
  slot.file = null;
  slot.dataUrl = null;
  slot.thumbUrl = null;
  slot.path = null;
  if (oldFile && typeof sbLogAction === 'function') sbLogAction('remove_from_slot', 'card', card.id, card.name, oldFile);

  var wasClient = (typeof _appClientMode !== 'undefined' && _appClientMode);
  var cardsBefore = proj.cards.length;
  var slotsBefore = card.slots.length;

  /* Авто-переверстка: убрать пустые слоты, удалить пустые карточки */
  if (wasClient) {
    cpAutoReflow(proj, cardIdx);
  }

  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof shAutoSave === 'function') shAutoSave();

  /* Сохранить скролл, чтобы пользователя не "улетало" в начало ленты. */
  var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

  var cardsAfter = proj.cards.length;
  var slotsAfter = (proj.cards[cardIdx] && proj.cards[cardIdx].slots)
    ? proj.cards[cardIdx].slots.length : 0;
  var sameCard = (cardsAfter === cardsBefore);
  var sameSlots = sameCard && (slotsAfter === slotsBefore);

  /* Случай клиентского режима: auto-reflow схлопнул слоты, но карточка цела.
     Перерисуем ТОЛЬКО один mob-card-block — без полного ре-рендера ленты. */
  if (sameCard && !sameSlots && _mobViewMode === 'cards') {
    var block = document.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"]');
    if (block && block.parentNode) {
      /* Рендерим полную ленту (все индексы уже корректные),
         из результата вытаскиваем блок нужной карточки. */
      var feedHtml = '';
      try { feedHtml = cpMobileRenderFeed(); } catch(e) { feedHtml = ''; }
      var tmpC = document.createElement('div');
      tmpC.innerHTML = feedHtml;
      var newBlock = tmpC.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"]');
      if (newBlock) {
        block.parentNode.replaceChild(newBlock, block);
        if (typeof cpMobileBindCarousels === 'function') cpMobileBindCarousels();
        if (typeof cpMobileBindDoubleTap === 'function') cpMobileBindDoubleTap();
        if (typeof cpMobileBindSlotTap === 'function') cpMobileBindSlotTap();
        return;
      }
    }
  }

  if (sameSlots && _mobViewMode === 'cards') {
    /* Хирургический апдейт: перерисовать только нужный слот
       (без flash всей ленты). */
    var wrap = document.querySelector('.mob-card-block[data-card-idx="' + cardIdx + '"] .mob-carousel-wrap[data-card="' + cardIdx + '"][data-slot="' + slotIdx + '"]');
    if (wrap && wrap.parentNode) {
      var orient = slot.orient || 'v';
      var weight = slot.weight || 1;
      var isHero = (card._hasHero && slotIdx === 0) || (weight >= 2 && slotIdx === 0);
      var slotClass = 'mob-slot-v';
      var slotStyle = '';
      if (isHero) {
        slotClass = 'mob-slot-hero';
      } else if (orient === 'h') {
        slotClass = 'mob-slot-h';
        var hAspect = card._hAspect || '3/2';
        slotStyle = ' style="aspect-ratio:' + hAspect.replace('/', ' / ') + '"';
      } else {
        var vAspect = card._vAspect || '2/3';
        slotStyle = ' style="aspect-ratio:' + vAspect.replace('/', ' / ') + '"';
      }
      var emptyHtml = '<div class="' + slotClass + ' mob-slot-empty"' + slotStyle + ' data-card="' + cardIdx + '" data-slot="' + slotIdx + '">' +
        '<div class="mob-slot-empty-text">Нажмите дважды чтобы добавить фото</div>' +
        '</div>';
      var tmp = document.createElement('div');
      tmp.innerHTML = emptyHtml;
      wrap.parentNode.replaceChild(tmp.firstChild, wrap);
      /* Восстановить биндинги на пустой слот */
      if (typeof cpMobileBindDoubleTap === 'function') cpMobileBindDoubleTap();
      return;
    }
  }

  /* Фолбэк: полный ре-рендер с восстановлением скролла. */
  cpMobileRender();
  try { window.scrollTo(0, scrollY); } catch(e) {}
}

/**
 * Открыть лайтбокс из мобильной карточки — показывает фото текущего слота
 * в контексте всех превью проекта (можно листать).
 * @param {number} cardIdx
 * @param {number} slotIdx
 * @param {Event} e
 */
function cpMobileSlotFullscreen(cardIdx, slotIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var slot = proj.cards[cardIdx].slots[slotIdx];
  if (!slot || !slot.file) return;

  /* Найти превью по имени файла */
  var pv = null;
  if (proj.previews) {
    for (var i = 0; i < proj.previews.length; i++) {
      if (proj.previews[i].name === slot.file) { pv = proj.previews[i]; break; }
    }
  }
  if (!pv) {
    pv = {
      name: slot.file,
      thumb: slot.thumbUrl || slot.dataUrl || '',
      preview: slot.dataUrl || slot.thumbUrl || '',
      orient: slot.orient || 'v'
    };
  }

  /* Одно фото — без листания */
  if (typeof _pvLbList !== 'undefined') {
    _pvLbList = [pv];
    _pvLbIdx = 0;
    if (typeof _pvLbOpen === 'function') _pvLbOpen();
  }
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
    /* Избегаем двойной привязки при хирургических апдейтах. */
    if (carousels[i].getAttribute('data-swipe-bound') === '1') continue;
    carousels[i].setAttribute('data-swipe-bound', '1');
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
    /* Избегаем двойной привязки при хирургических апдейтах. */
    if (empties[i].getAttribute('data-dbltap-bound') === '1') continue;
    empties[i].setAttribute('data-dbltap-bound', '1');
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
 * Привязать тап на слоты: показать/скрыть стрелки и крестик.
 * При тапе на один слот — показать его контролы, скрыть остальные.
 * При тапе вне слотов — скрыть все.
 */
function cpMobileBindSlotTap() {
  var carousels = document.querySelectorAll('.mob-carousel-wrap');
  for (var i = 0; i < carousels.length; i++) {
    /* Избегаем двойной привязки при хирургических апдейтах. */
    if (carousels[i].getAttribute('data-tap-bound') === '1') continue;
    carousels[i].setAttribute('data-tap-bound', '1');
    (function(el) {
      el.addEventListener('click', function(e) {
        /* Если кликнули на кнопку (стрелку, удаление) — не трогать */
        if (e.target.tagName === 'BUTTON') return;

        var controls = el.querySelector('.mob-carousel-controls');
        if (!controls) return;

        var wasVisible = !controls.classList.contains('mob-controls-hidden');

        /* Скрыть все контролы */
        _cpMobileHideAllControls();

        /* Если этот был скрыт — показать */
        if (!wasVisible) {
          controls.classList.remove('mob-controls-hidden');
          /* Автоскрытие через 4 секунды */
          clearTimeout(window._mobControlsTimer);
          window._mobControlsTimer = setTimeout(function() {
            _cpMobileHideAllControls();
          }, 4000);
        }
      });
    })(carousels[i]);
  }

  /* Тап на пустую область — скрыть все контролы */
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.mob-carousel-wrap')) {
      _cpMobileHideAllControls();
    }
  });
}

/**
 * Скрыть все контролы карусели.
 */
function _cpMobileHideAllControls() {
  var all = document.querySelectorAll('.mob-carousel-controls');
  for (var i = 0; i < all.length; i++) {
    all[i].classList.add('mob-controls-hidden');
  }
  clearTimeout(window._mobControlsTimer);
}

/**
 * Рендер мобильной галереи «Отбор» (Select) — только фото из карточек и допконтента.
 * @returns {string} HTML
 */
function cpMobileRenderSelect() {
  var items = (typeof acGetAllContent === 'function') ? acGetAllContent() : [];

  if (items.length === 0) {
    return '<div style="padding:40px 16px;text-align:center;color:#999">Нет фото в отборе</div>';
  }

  var html = '<div class="mob-select">';

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var src = it.preview || it.thumb || '';
    if (!src) continue;

    var orient = it.orient || 'v';
    /* Горизонталь — на всю ширину, вертикаль — по 2 в ряд */
    var itemClass = orient === 'h' ? 'mob-select-item-h' : 'mob-select-item-v';

    html += '<div class="mob-select-item ' + itemClass + '">';
    html += '<img src="' + src + '" loading="lazy" onclick="cpMobileSelectFullscreen(' + i + ')">';
    html += '</div>';
  }

  html += '</div>';

  /* Кнопки согласования */
  html += '<div class="mob-approve-block">';
  html += '<div class="mob-approve-title">Просмотр завершён</div>';
  html += '<button class="mob-btn-approve" onclick="cpMobileApprove()">Согласовать отбор</button>';
  html += '<button class="mob-btn-reject" onclick="cpMobileReject()">Вернуть на доработку</button>';
  html += '</div>';

  return html;
}

/**
 * Полноэкранный просмотр из мобильного отбора.
 * @param {number} idx — индекс в acGetAllContent()
 */
function cpMobileSelectFullscreen(idx) {
  if (typeof acOpenLightbox === 'function') {
    acOpenLightbox(idx, null);
  }
}

/**
 * Рендер вкладки Other — только доп. контент (без карточек).
 * Плитка как в Select: горизонты на всю ширину, вертикали по 2.
 * Тап по фото открывает лайтбокс только по OC-списку.
 * @returns {string} HTML
 */
function cpMobileRenderOther() {
  var proj = getActiveProject();
  var freeStore = (proj && proj.otherContent) ? proj.otherContent : [];
  var containers = (proj && proj.ocContainers) ? proj.ocContainers : [];
  var totalPhotos = freeStore.length;
  for (var tc = 0; tc < containers.length; tc++) totalPhotos += (containers[tc].items || []).length;

  /* Тулбар */
  var html = '<div class="mob-other-toolbar">';
  html += '<span class="mob-other-count">' + totalPhotos + ' фото</span>';
  html += '<button class="mob-other-options-btn" onclick="ocAddContainer()">+ Контейнер</button>';
  html += '<button class="mob-other-options-btn" onclick="cpMobileSetView(\'options\')">Все опции</button>';
  html += '</div>';

  if (totalPhotos === 0 && containers.length === 0) {
    html += '<div style="padding:40px 16px;text-align:center;color:#999">';
    html += 'Нет доп. контента.<br>';
    html += '<button class="mob-other-go-options" onclick="cpMobileSetView(\'options\')">Перейти в Options для отбора</button>';
    html += '</div>';
    return html;
  }

  /* Найти ориентацию через превью, если есть */
  var pvMap = {};
  if (proj && proj.previews) {
    for (var p = 0; p < proj.previews.length; p++) {
      pvMap[proj.previews[p].name] = proj.previews[p];
    }
  }

  /* Хелпер: генерация плитки фото */
  function _mobOcTile(item, onclickFn, removeFn) {
    var src = item.preview || item.thumb || '';
    if (!src) return '';
    var pv = pvMap[item.name];
    var orient = 'v';
    if (pv) {
      orient = (pv.width && pv.height) ? (pv.width > pv.height ? 'h' : 'v') : (pv.orient || 'v');
    }
    var itemClass = orient === 'h' ? 'mob-select-item-h' : 'mob-select-item-v';
    var t = '<div class="mob-select-item ' + itemClass + '">';
    t += '<img src="' + src + '" loading="lazy" onclick="' + onclickFn + '">';
    t += '<button class="mob-oc-remove" onclick="' + removeFn + '">&times;</button>';
    t += '</div>';
    return t;
  }

  /* ── Контейнеры ── */
  for (var c = 0; c < containers.length; c++) {
    var cnt = containers[c];
    var items = cnt.items || [];
    html += '<div class="mob-oc-cnt-block">';
    html += '<div class="mob-oc-cnt-header">';
    html += '<span class="mob-oc-cnt-name" onclick="ocEditContainerName(' + c + ')">' + esc(cnt.name) + '</span>';
    html += '<span class="mob-oc-cnt-count">' + items.length + '</span>';
    html += '<button class="mob-oc-cnt-del" onclick="cpMobileDeleteContainer(' + c + ')">&times;</button>';
    html += '</div>';
    if (items.length > 0) {
      html += '<div class="mob-select">';
      for (var i = 0; i < items.length; i++) {
        html += _mobOcTile(
          items[i],
          'cpMobileContainerFullscreen(' + c + ',' + i + ')',
          'cpMobileContainerRemove(' + c + ',' + i + ',event)'
        );
      }
      html += '</div>';
    } else {
      html += '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Пусто</div>';
    }
    html += '</div>';
  }

  /* ── Свободные фото ── */
  if (freeStore.length > 0 || containers.length > 0) {
    if (containers.length > 0) {
      html += '<div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;padding:8px 16px 4px">Свободные фото</div>';
    }
    html += '<div class="mob-select">';
    for (var f = 0; f < freeStore.length; f++) {
      html += _mobOcTile(
        freeStore[f],
        'cpMobileOtherFullscreen(' + f + ')',
        'cpMobileOtherRemove(' + f + ',event)'
      );
    }
    html += '</div>';
  }

  return html;
}

/**
 * Открыть лайтбокс из мобильной вкладки Other (свободные фото).
 * @param {number} idx — индекс в otherContent
 */
function cpMobileOtherFullscreen(idx) {
  if (typeof ocOpenLightbox === 'function') {
    ocOpenLightbox(idx, null);
  }
}

/**
 * Открыть лайтбокс из мобильной вкладки Other (контейнер).
 */
function cpMobileContainerFullscreen(cntIdx, itemIdx) {
  if (typeof ocOpenContainerLightbox === 'function') {
    ocOpenContainerLightbox(cntIdx, itemIdx, null);
  }
}

/**
 * Удалить фото из доп. контента через мобильную вкладку Other.
 * @param {number} idx — индекс в otherContent
 * @param {Event} e
 */
function cpMobileOtherRemove(idx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (typeof ocRemoveItem === 'function') {
    ocRemoveItem(idx);
  }
  cpMobileRender();
}

/**
 * Удалить фото из контейнера через мобильную вкладку.
 */
function cpMobileContainerRemove(cntIdx, itemIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (typeof ocRemoveFromContainer === 'function') {
    ocRemoveFromContainer(cntIdx, itemIdx);
  }
  cpMobileRender();
}

/**
 * Удалить контейнер через мобильную вкладку (фото → свободные).
 */
function cpMobileDeleteContainer(cntIdx) {
  if (typeof ocDeleteContainer === 'function') {
    ocDeleteContainer(cntIdx);
  }
  cpMobileRender();
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
  slot.dataUrl = (typeof pvGetPreview === 'function') ? pvGetPreview(newPv) : (newPv.preview || newPv.thumb || '');
  slot.path = (typeof pvGetPath === 'function') ? pvGetPath(newPv) : (newPv.path || '');

  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof shAutoSave === 'function') shAutoSave();

  cpMobileRender();
}

/** @type {number} Фильтр рейтинга для мобильной галереи Options (0 = все) */
var _mobOptionsFilter = 0;

/**
 * Установить фильтр рейтинга в мобильной галерее Options.
 * @param {number} minRating
 */
function cpMobileSetOptionsFilter(minRating) {
  if (_mobOptionsFilter === minRating) minRating = 0;
  _mobOptionsFilter = minRating;
  cpMobileRender();
}

/**
 * Рендер мобильной галереи с галочками (Options — все превью).
 * @returns {string} HTML
 */
function cpMobileRenderGallery() {
  var proj = getActiveProject();
  if (!proj || !proj.previews || proj.previews.length === 0) {
    return '<div style="padding:40px 16px;text-align:center;color:#999">Нет фотографий</div>';
  }

  /* Звёздочный фильтр */
  var html = '<div class="mob-filter-bar">';
  for (var s = 1; s <= 5; s++) {
    html += '<button class="mob-filter-star' + (s <= _mobOptionsFilter ? ' mob-star-active' : '') + '" onclick="cpMobileSetOptionsFilter(' + s + ')">&#9733;</button>';
  }
  html += '<button class="mob-filter-reset' + (_mobOptionsFilter === 0 ? ' mob-star-active' : '') + '" onclick="cpMobileSetOptionsFilter(0)">Все</button>';
  html += '</div>';

  /* Собрать карту: что в отборе (карточки + допконтент) */
  var ocList = proj.otherContent || [];
  var ocMap = {};
  for (var o = 0; o < ocList.length; o++) {
    ocMap[ocList[o].name] = true;
  }
  /* Что в карточках */
  var cardMap = {};
  var cards = proj.cards || [];
  for (var c = 0; c < cards.length; c++) {
    var slots = cards[c].slots || [];
    for (var sl = 0; sl < slots.length; sl++) {
      if (slots[sl].file) cardMap[slots[sl].file] = true;
    }
  }

  var minR = _mobOptionsFilter || 0;

  html += '<div class="mob-gallery">';

  for (var i = 0; i < proj.previews.length; i++) {
    var pv = proj.previews[i];

    /* Фильтр по рейтингу */
    if (minR > 0 && (pv.rating || 0) < minR) continue;

    var src = pv.preview || pv.thumb || '';
    if (!src) continue;

    var pvOrient = (pv.width && pv.height) ? (pv.width > pv.height ? 'h' : 'v') :
      (pv.orient || 'v');
    var itemClass = pvOrient === 'h' ? 'mob-gallery-item-h' : 'mob-gallery-item-v';
    var pvName = pv.name || pv.stem || '';
    var inCard = cardMap[pvName];
    var inOC = ocMap[pvName];
    var isChecked = (inCard || inOC) ? ' checked' : '';

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
 * Переключить галочку на фото в мобильной галерее (Options).
 * Использует единую pvToggleSelection из previews.js.
 * @param {string} pvName - имя файла превью
 * @param {HTMLElement} el - элемент галочки
 */
function cpMobileToggleOC(pvName, el) {
  if (typeof pvToggleSelection !== 'function') return;
  var done = pvToggleSelection(pvName);
  if (!done) return;

  /* Обновить визуал галочки.
     pvToggleSelection уже делает: shAutoSave + delta/full sync + render.
     Дублировать sync здесь не нужно. */
  var inCard = (typeof _pvIsInCard === 'function') ? _pvIsInCard(pvName) >= 0 : false;
  var inOC = (typeof _pvIsInOtherContent === 'function') ? _pvIsInOtherContent(pvName) : false;
  if (inCard || inOC) {
    el.className = 'mob-gallery-check checked';
    el.innerHTML = '&#10003;';
  } else {
    el.className = 'mob-gallery-check';
    el.innerHTML = '';
  }
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


// ══════════════════════════════════════════════
//  Аннотации к фото на карточке (сводка)
// ══════════════════════════════════════════════

/**
 * Сгенерировать HTML сводки аннотаций для слотов карточки.
 * Показывает: графические маркеры (кружок/линия) с типом + текстовые комментарии.
 * @param {Object} card
 * @returns {string} HTML
 */
function _cpRenderSlotAnnotations(card) {
  if (typeof rtGetAnnotations !== 'function') return '';
  if (!card.slots || card.slots.length === 0) return '';

  var items = []; /* {file, annots[]} */
  for (var si = 0; si < card.slots.length; si++) {
    var file = card.slots[si].file;
    if (!file) continue;
    var annots = rtGetAnnotations(file);
    if (annots.length > 0) items.push({ file: file, annots: annots, slotIdx: si });
  }

  if (items.length === 0) return '';

  var html = '<div class="cp-annot-summary">';
  html += '<div class="cp-annot-header">Аннотации к фото</div>';

  for (var ii = 0; ii < items.length; ii++) {
    var item = items[ii];
    html += '<div class="cp-annot-file">';
    html += '<span class="cp-annot-file-name">' + esc(item.file) + '</span>';

    for (var ai = 0; ai < item.annots.length; ai++) {
      var a = item.annots[ai];
      var RT_TYPES = (typeof RT_ANNOTATION_TYPES !== 'undefined') ? RT_ANNOTATION_TYPES : {};
      var typeInfo = RT_TYPES[a.type] || { label: a.type, border: '#999' };
      var shapeIcon = (a.shape === 'line') ? '~' : 'O';
      var hasGraphic = a.hasCircle || a.shape === 'line';

      html += '<div class="cp-annot-item" onclick="cpOpenAnnotInLightbox(\'' + esc(item.file) + '\')" title="Открыть в лайтбоксе">';
      if (hasGraphic) {
        html += '<span class="cp-annot-shape" style="border-color:' + typeInfo.border + '">' + shapeIcon + '</span>';
        html += '<span class="cp-annot-type" style="color:' + typeInfo.border + '">' + typeInfo.label + '</span>';
      }
      if (a.tags && a.tags.length > 0) {
        html += '<span class="cp-annot-tags">[' + a.tags.join(', ') + ']</span>';
      }
      if (a.text) {
        html += '<span class="cp-annot-text">' + esc(a.text.substring(0, 80)) + (a.text.length > 80 ? '...' : '') + '</span>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Открыть фото в лайтбоксе из карточки (для просмотра аннотаций).
 */
function cpOpenAnnotInLightbox(fileName) {
  var proj = getActiveProject();
  if (!proj || !proj.previews) return;
  for (var i = 0; i < proj.previews.length; i++) {
    if (proj.previews[i].name === fileName) {
      if (typeof pvShowFullscreen === 'function') pvShowFullscreen(i);
      return;
    }
  }
}

// ══════════════════════════════════════════════
//  Кристаллизация карточки
//
//  Карточка рождается как черновик (draft): лёгкая структура
//  с временным 8-символьным ID. Можно свободно менять слоты,
//  перекраивать раскладку — ID при этом не гарантирован.
//
//  Кристаллизация фиксирует card.id навсегда. Триггеры:
//    1. Добавление комментария к карточке
//    2. Подтверждение привязки артикула (TODO: articles.js)
//
//  После кристаллизации ID не меняется при sync,
//  комментарии надёжно привязаны к карточке.
// ══════════════════════════════════════════════

/**
 * Кристаллизовать карточку — зафиксировать стабильный ID.
 * Идемпотентна: повторный вызов ничего не делает.
 * @param {number} cardIdx — индекс карточки в проекте
 * @returns {boolean} true если кристаллизация произошла (или уже была)
 */
function cpCrystallizeCard(cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return false;
  var card = proj.cards[cardIdx];

  if (card._crystallized) return true; /* уже кристаллизована */

  /* Фиксируем ID: если текущий — короткий (8 символов), оставляем.
     Главное — пометить что этот ID стабилен и не подлежит замене. */
  card._crystallized = true;
  card._crystallizedAt = new Date().toISOString();

  console.log('cpCrystallizeCard: карточка ' + (cardIdx + 1) +
    ' кристаллизована, id=' + card.id);

  return true;
}

/**
 * Проверить, кристаллизована ли карточка.
 * @param {number} cardIdx
 * @returns {boolean}
 */
function cpIsCardCrystallized(cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return false;
  return !!proj.cards[cardIdx]._crystallized;
}

// ══════════════════════════════════════════════
//  Комментарии к карточкам
//
//  Модель: card._comments = [
//    { id, text, author, created }
//  ]
//  author — 'team' | 'client'
// ══════════════════════════════════════════════

/**
 * Получить комментарии карточки.
 * @param {number} cardIdx
 * @returns {Array}
 */
function cpGetComments(cardIdx) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return [];
  var card = proj.cards[cardIdx];
  if (!card._comments) card._comments = [];
  return card._comments;
}

/**
 * Добавить комментарий к карточке.
 * @param {number} cardIdx
 * @param {string} text
 */
function cpAddComment(cardIdx, text) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card._comments) card._comments = [];
  card._comments.push({
    id: 'cc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    text: text,
    author: 'team',
    created: new Date().toISOString()
  });

  /* Кристаллизация: комментарий сохранён → фиксируем ID карточки */
  cpCrystallizeCard(cardIdx);

  /* Отметить начало комментирования в проекте (для пайплайна) */
  if (!proj._commentingStarted) {
    proj._commentingStarted = new Date().toISOString();
    proj._commentingStartedStageIdx = proj._stage || 0;
  }

  if (typeof shAutoSave === 'function') shAutoSave();
  cpRenderCard();
}

/**
 * Удалить комментарий карточки.
 * @param {number} cardIdx
 * @param {string} commentId
 */
function cpDeleteComment(cardIdx, commentId) {
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card._comments) return;
  card._comments = card._comments.filter(function(c) { return c.id !== commentId; });
  if (typeof shAutoSave === 'function') shAutoSave();
  cpRenderCard();
}

/**
 * Сгенерировать HTML блока комментариев для карточки.
 * @param {number} cardIdx
 * @returns {string} HTML
 */
function cpRenderComments(cardIdx) {
  var comments = cpGetComments(cardIdx);
  var html = '<div class="cp-comments">';
  html += '<div class="cp-comments-header">';
  html += '<span class="cp-comments-title">Комментарии' + (comments.length > 0 ? ' (' + comments.length + ')' : '') + '</span>';
  html += '<button class="btn btn-sm" onclick="cpShowAddComment(' + cardIdx + ',event)">+ Комментарий</button>';
  html += '</div>';

  /* Поле ввода (скрыто по умолчанию) — onclick останавливает всплытие чтобы внешние обработчики не перерисовали карточку */
  html += '<div class="cp-comment-input" id="cp-comment-input-' + cardIdx + '" style="display:none" onclick="event.stopPropagation()">';
  html += '<textarea class="cp-comment-textarea" id="cp-comment-text-' + cardIdx + '" placeholder="Текст комментария..." rows="2" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"></textarea>';
  html += '<div style="display:flex;gap:6px;margin-top:4px">';
  html += '<button class="btn btn-sm btn-primary" onclick="cpSaveNewComment(' + cardIdx + ',event)">Добавить</button>';
  html += '<button class="btn btn-sm" onclick="event.stopPropagation();document.getElementById(\'cp-comment-input-' + cardIdx + '\').style.display=\'none\'">Отмена</button>';
  html += '</div>';
  html += '</div>';

  /* Список комментариев */
  for (var i = 0; i < comments.length; i++) {
    var c = comments[i];
    var dateStr = c.created ? new Date(c.created).toLocaleDateString('ru-RU') : '';
    html += '<div class="cp-comment-item">';
    html += '<div class="cp-comment-text">' + esc(c.text) + '</div>';
    html += '<div class="cp-comment-meta">';
    html += '<span>' + dateStr + '</span>';
    html += '<button class="cp-comment-del" onclick="cpDeleteComment(' + cardIdx + ',\'' + c.id + '\')" title="Удалить">&times;</button>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

/**
 * Показать поле ввода нового комментария.
 */
function cpShowAddComment(cardIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var el = document.getElementById('cp-comment-input-' + cardIdx);
  if (el) {
    el.style.display = 'block';
    var ta = document.getElementById('cp-comment-text-' + cardIdx);
    if (ta) ta.focus();
  }
}

/**
 * Сохранить новый комментарий из поля ввода.
 */
function cpSaveNewComment(cardIdx, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var ta = document.getElementById('cp-comment-text-' + cardIdx);
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  cpAddComment(cardIdx, text);
}

// ══════════════════════════════════════════════
//  Мобильные комментарии к карточкам
// ══════════════════════════════════════════════

/**
 * HTML блока комментариев для мобильной карточки.
 * Отображается под слотами каждой карточки в ленте.
 * @param {number} cardIdx
 * @param {Object} card
 * @returns {string}
 */
function _cpMobileCommentsHTML(cardIdx, card) {
  /* Внешний контейнер — id нужен чтобы обновлять блок точечно
     (без полной перерисовки страницы, иначе поле ввода "моргает") */
  var html = '<div class="mob-comments" id="mob-comments-' + cardIdx + '">';
  html += _cpMobileCommentsInnerHTML(cardIdx, card);
  html += '</div>';
  return html;
}

/**
 * Содержимое блока комментариев (без внешнего контейнера).
 * Вынесено отдельно, чтобы `cpMobileSendComment` мог обновлять только эту часть
 * — и не перерисовывать всю страницу через `cpMobileRender()`.
 */
function _cpMobileCommentsInnerHTML(cardIdx, card) {
  var comments = card._comments || [];
  var html = '';

  /* Существующие комментарии */
  if (comments.length > 0) {
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var dateStr = c.created ? new Date(c.created).toLocaleDateString('ru-RU') : '';
      var authorLabel = (c.author === 'client') ? 'Клиент' : 'Команда';
      html += '<div class="mob-comment-item">';
      html += '<div class="mob-comment-text">' + esc(c.text) + '</div>';
      html += '<div class="mob-comment-meta">' + authorLabel + ' ' + dateStr + '</div>';
      html += '</div>';
    }
  }

  /* Поле ввода + кнопка "OK". Отправка — через обработчик onkeydown (Enter)
     и onclick кнопки, оба вызывают cpMobileSendComment(cardIdx). */
  html += '<div class="mob-comment-add">';
  html += '<input type="text" class="mob-comment-input" id="mob-cmt-input-' + cardIdx + '" placeholder="Комментарий..." ';
  html += 'onkeydown="if(event.key===\'Enter\'){cpMobileSendComment(' + cardIdx + ');event.preventDefault();}">';
  html += '<button class="mob-comment-send" onclick="cpMobileSendComment(' + cardIdx + ')">OK</button>';
  html += '</div>';

  return html;
}

/**
 * Отправить комментарий из мобильного поля ввода.
 * @param {number} cardIdx
 */
function cpMobileSendComment(cardIdx) {
  var input = document.getElementById('mob-cmt-input-' + cardIdx);
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  var author = window._shareToken ? 'client' : 'team';
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.cards[cardIdx]) return;
  var card = proj.cards[cardIdx];
  if (!card._comments) card._comments = [];
  card._comments.push({
    id: 'cc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    text: text,
    author: author,
    created: new Date().toISOString()
  });

  /* Кристаллизация: комментарий сохранён → фиксируем ID карточки */
  cpCrystallizeCard(cardIdx);

  if (typeof shAutoSave === 'function') shAutoSave();
  /* Синхронизировать комментарий в облако немедленно */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();

  /* ТОЧЕЧНОЕ обновление — перерисовываем ТОЛЬКО блок комментариев этой карточки.
     Раньше вызывался cpMobileRender() и вся страница мигала/прыгала.
     Теперь меняем innerHTML одного контейнера — input получает фокус заново. */
  var container = document.getElementById('mob-comments-' + cardIdx);
  if (container) {
    container.innerHTML = _cpMobileCommentsInnerHTML(cardIdx, card);
    /* Вернуть фокус на поле ввода — удобнее для подряд нескольких комментариев */
    var newInput = document.getElementById('mob-cmt-input-' + cardIdx);
    if (newInput) {
      try { newInput.focus({ preventScroll: true }); } catch(e) { newInput.focus(); }
    }
  } else {
    /* Фолбэк: если контейнер не найден (например, вид сменился) — полный рендер */
    cpMobileRender();
  }
}
