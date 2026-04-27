/* ══════════════════════════════════════════════
   state.js — Глобальное состояние, константы, утилиты
   ══════════════════════════════════════════════

   Порядок загрузки: state.js → nav.js → shootings.js → cards.js → previews.js → sync.js
   Все остальные модули полагаются на App, CARD_TEMPLATES, CAT_NAMES, PIPELINE_STAGES.
*/

/**
 * Глобальное состояние приложения.
 * @type {{projects: Array, selectedProject: number, currentCardIdx: number, currentPage: string}}
 */
var App = {
  projects: [],          // массив загруженных проектов
  selectedProject: -1,   // индекс выбранного проекта
  currentCardIdx: -1,    // индекс текущей карточки (в редакторе)
  currentPage: 'shootings',
};


/* ──────────────────────────────────────────────
   Шаблоны карточек товара
   ──────────────────────────────────────────────
   Шаблон создаётся пользователем: расположил фото на карточке →
   нажал "Сохранить как шаблон" → дал имя → готово.

   Модель шаблона:
   {
     id:       string   — уникальный ключ
     name:     string   — имя ("BrandX standard", "Studio Z accessories")
     hAspect:  string   — пропорции горизонтов ("3/2", "16/9", "4/3")
     vAspect:  string   — пропорции вертикалей ("2/3", "3/4", "4/5")
     lockRows: boolean  — фиксированные ряды (slot.row из редактора)
     hasHero:  boolean  — есть заглавное фото (первый слот = hero)
     slots:    Array<{orient: 'h'|'v', weight: number}>
   }

   orient:  'h' = горизонт, 'v' = вертикаль
   hasHero: true = первый слот — заглавное фото, его ориентация определяет
            раскладку (V→landscape, H→portrait). false = все слоты равные.

   Пропорции задаются в редакторе шаблона и применяются
   ко всем слотам одной ориентации. Формат CSS: "3/2", "2/3".

   Layout-движок (cards.js → cpPackRows):
   - V=1 ед., H=2 ед., main +1 ед., строка ≤4 ед.
   - Фото кадрируется под слот (object-fit: cover)

   Шаблоны хранятся в localStorage (коллекция пользователя).
   Стартовые пресеты создаются при первом запуске.
   ────────────────────────────────────────────── */

/** @type {string} localStorage key for user templates */
var TEMPLATES_LS_KEY = 'maketcp_templates';

/**
 * Стартовые пресеты — создаются при первом запуске,
 * если у пользователя нет сохранённых шаблонов.
 * @type {Array<{id: string, name: string, slots: Array}>}
 */
/** Доступные пропорции для горизонтов */
var H_ASPECTS = ['3/2', '4/3', '16/9', '5/4'];
/** Доступные пропорции для вертикалей */
var V_ASPECTS = ['2/3', '3/4', '4/5', '9/16'];

/** Человекочитаемые названия пропорций */
var ASPECT_LABELS = {
  '3/2':  '3:2',  '4/3':  '4:3',  '16/9': '16:9', '5/4': '5:4',
  '2/3':  '2:3',  '3/4':  '3:4',  '4/5':  '4:5',  '9/16': '9:16'
};

var STARTER_TEMPLATES = [
  {
    id: 'starter_h3',
    name: 'Горизонт + 3 вертикали',
    hAspect: '3/2', vAspect: '2/3', lockRows: false, hasHero: true,
    slots: [
      { orient: 'h', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 }
    ]
  },
  {
    id: 'starter_v4',
    name: '4 вертикали',
    hAspect: '3/2', vAspect: '2/3', lockRows: false, hasHero: true,
    slots: [
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 }
    ]
  },
  {
    id: 'starter_v6',
    name: '6 вертикалей',
    hAspect: '3/2', vAspect: '2/3', lockRows: false, hasHero: true,
    slots: [
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 },
      { orient: 'v', weight: 1 }
    ]
  }
];

/**
 * Коллекция шаблонов пользователя (загружается из localStorage).
 * @type {Array<{id: string, name: string, slots: Array}>}
 */
var UserTemplates = [];

/**
 * Загрузить шаблоны пользователя из localStorage.
 * Если пусто — инициализировать стартовыми пресетами.
 */
function loadUserTemplates() {
  try {
    var raw = localStorage.getItem(TEMPLATES_LS_KEY);
    if (raw) {
      UserTemplates = JSON.parse(raw);
      if (!Array.isArray(UserTemplates)) UserTemplates = [];
    }
  } catch (e) {
    UserTemplates = [];
  }
  if (UserTemplates.length === 0) {
    UserTemplates = STARTER_TEMPLATES.map(function(t) {
      return { id: t.id, name: t.name, slots: t.slots.slice() };
    });
    saveUserTemplates();
  }
}

/**
 * Сохранить шаблоны пользователя в localStorage.
 */
function saveUserTemplates() {
  try {
    localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(UserTemplates));
  } catch (e) {
    console.error('saveUserTemplates:', e);
  }
}

/**
 * Добавить новый шаблон в коллекцию.
 * @param {string} name — имя шаблона
 * @param {Array<{orient: string, main: boolean}>} slots — конфигурация слотов
 * @param {string} [hAspect='3/2'] — пропорции горизонтов
 * @param {string} [vAspect='2/3'] — пропорции вертикалей
 * @param {boolean} [lockRows=false]
 * @param {boolean} [hasHero=true]
 * @param {string} [brand=''] — бренд (атрибут для фильтрации)
 * @returns {Object} созданный шаблон
 */
function addUserTemplate(name, slots, hAspect, vAspect, lockRows, hasHero, brand) {
  var tmpl = {
    id: 'tmpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: name,
    brand: brand || '',
    hAspect: hAspect || '3/2',
    vAspect: vAspect || '2/3',
    lockRows: !!lockRows,
    hasHero: (hasHero !== undefined) ? !!hasHero : true,
    slots: slots.map(function(s) { return { orient: s.orient, weight: s.weight || 1 }; })
  };
  UserTemplates.push(tmpl);
  saveUserTemplates();
  return tmpl;
}

/**
 * Обновить существующий шаблон.
 * @param {string} id
 * @param {Object} updates — {name?, slots?, hAspect?, vAspect?}
 * @returns {Object|null}
 */
function updateUserTemplate(id, updates) {
  var tmpl = getUserTemplate(id);
  if (!tmpl) return null;
  if (updates.name !== undefined)     tmpl.name     = updates.name;
  if (updates.brand !== undefined)    tmpl.brand    = updates.brand;
  if (updates.hAspect !== undefined)  tmpl.hAspect  = updates.hAspect;
  if (updates.vAspect !== undefined)  tmpl.vAspect  = updates.vAspect;
  if (updates.lockRows !== undefined) tmpl.lockRows = updates.lockRows;
  if (updates.hasHero !== undefined)  tmpl.hasHero  = updates.hasHero;
  if (updates.slots !== undefined) {
    tmpl.slots = updates.slots.map(function(s) { return { orient: s.orient, weight: s.weight || 1 }; });
  }
  saveUserTemplates();
  return tmpl;
}

/**
 * Удалить шаблон по id.
 * @param {string} id
 */
function deleteUserTemplate(id) {
  UserTemplates = UserTemplates.filter(function(t) { return t.id !== id; });
  saveUserTemplates();
}

/**
 * Получить шаблон по id.
 * @param {string} id
 * @returns {Object|null}
 */
function getUserTemplate(id) {
  for (var i = 0; i < UserTemplates.length; i++) {
    if (UserTemplates[i].id === id) return UserTemplates[i];
  }
  return null;
}

/**
 * Создать полную копию шаблона для сохранения в проекте.
 * Убеждаемся, что все нужные поля присутствуют.
 * @param {Object} tmpl — объект шаблона из UserTemplates
 * @returns {Object} полная копия для proj._template
 */
function templateToProjFormat(tmpl) {
  if (!tmpl) return null;
  return {
    id: tmpl.id || ('tmpl_' + Date.now()),
    name: tmpl.name || 'Template',
    brand: tmpl.brand || '',
    hAspect: tmpl.hAspect || '3/2',
    vAspect: tmpl.vAspect || '2/3',
    lockRows: !!tmpl.lockRows,
    hasHero: (tmpl.hasHero !== undefined) ? !!tmpl.hasHero : true,
    slots: (tmpl.slots || []).map(function(s) {
      return { orient: s.orient || 'v', weight: s.weight || 1 };
    })
  };
}

/**
 * Создать конфигурацию слотов из текущей карточки.
 * Читает card.slots и генерирует массив {orient, main}.
 * @param {Object} card — карточка
 * @returns {Array<{orient: string, main: boolean}>}
 */
function slotsConfigFromCard(card) {
  if (!card || !card.slots) return [];
  return card.slots.map(function(s) {
    return {
      orient: (s && s.orient) ? s.orient : 'v',
      weight: (s && s.weight) ? s.weight : 1,
      main: !!(s && (s.main || s.weight > 1))
    };
  });
}

/**
 * Получить CSS aspect-ratio для слота.
 *
 * Приоритет:
 * 1. slot.aspect (если задан в объекте слота)
 * 2. orient → дефолт ('h' → '3/2', 'v' → '2/3')
 *
 * Можно вызвать как slotAspectCSS('h') или slotAspectCSS(slotObj).
 *
 * @param {string|Object} orientOrSlot — orient-строка или объект слота
 * @returns {string} CSS значение (например "3/2" или "2/3")
 */
function slotAspectCSS(orientOrSlot) {
  if (typeof orientOrSlot === 'object' && orientOrSlot !== null) {
    if (orientOrSlot.aspect) return orientOrSlot.aspect;
    return orientOrSlot.orient === 'h' ? '3/2' : '2/3';
  }
  return orientOrSlot === 'h' ? '3/2' : '2/3';
}

/* Загрузить шаблоны при старте */
loadUserTemplates();


/* Категории товаров — убраны из MVP, запланированы на поздний этап */


/* ──────────────────────────────────────────────
   Пайплайн — этапы съёмки
   ────────────────────────────────────────────── */

/**
 * 8 этапов фотопроизводства. Порядок фиксирован.
 * В будущем каждый этап получит trigger.check(proj) для автоперехода.
 * @type {Array<{id: string, name: string}>}
 */
var PIPELINE_STAGES = [
  { id: 'preselect',    name: 'Превью (преотбор)',      beta: true },
  { id: 'selection',    name: 'Отбор команды',          beta: true },
  { id: 'client',       name: 'Отбор клиента',          beta: true },
  { id: 'color',        name: 'Цветокоррекция',         beta: false },
  { id: 'retouch_task', name: 'Комментарии на ретушь',  beta: false },
  { id: 'retouch',      name: 'Ретушь',                 beta: false },
  { id: 'retouch_ok',   name: 'Согласование ретуши',    beta: false },
  { id: 'adaptation',   name: 'Адаптация к каналам',    beta: false },
];

/* ──────────────────────────────────────────────
   Checkpoint (контрольная точка пайплайна)
   ──────────────────────────────────────────────
   Каждый checkpoint фиксирует событие + список затронутых фото.
   proj._checkpoints = [ { id, date, stage, trigger, photos, iteration, note } ]

   trigger types:
     'preview_loaded'     — загружена папка с превью
     'selection_done'     — отбор сформирован (отправка клиенту)
     'client_received'    — клиент открыл ссылку
     'client_saved'       — клиент сохранил изменения (дельта вычисляется)
     'client_approved'    — клиент согласовал (группу фото)
     'client_returned'    — клиент вернул на доработку
     'photo_killed'       — фото удалено из отбора
     'cc_loaded'          — загружена ЦК-версия
     'cc_confirmed'       — подтверждение "ЦК финальная"
     'retouch_comments'   — завершено комментирование
     'retouch_loaded'     — загружена ретушь-версия
     'retouch_approved'   — клиент согласовал ретушь
     'retouch_returned'   — клиент вернул ретушь
     'manual'             — ручная фиксация состояния
     'adaptation_done'    — финал
   ────────────────────────────────────────────── */

/**
 * Создать контрольную точку на пайплайне.
 * @param {string} trigger — тип триггера (см. список выше)
 * @param {Object} opts — доп. параметры:
 *   {string}   stage     — id этапа (если не указан, берётся текущий)
 *   {string[]} photos    — список имён затронутых фото
 *   {number}   iteration — номер итерации (для ЦК/ретушь)
 *   {string}   note      — комментарий
 *   {string[]} added     — фото добавленные в отбор (для client_saved)
 *   {string[]} removed   — фото убранные из отбора (для client_saved)
 * @returns {Object|null} созданный checkpoint или null
 */
/* Map legacy cpk triggers → canonical event types.
   Used as a thin delegator: old call-sites continue working but
   write to proj._events (canonical), не proj._checkpoints. */
var _CPK_TRIGGER_TO_TYPE = {
  'preview_loaded':   'preview_loaded',
  'selection_done':   'selection_approved',
  'client_received':  'preview_loaded',
  'client_saved':     'selection_added',
  'client_approved':  'selection_approved',
  'client_returned':  'cc_returned',
  'photo_killed':     'selection_removed',
  'cc_loaded':        'cc_loaded',
  'cc_confirmed':     'cc_loaded',
  'retouch_comments': 'retouch_loaded',
  'retouch_loaded':   'retouch_loaded',
  'retouch_approved': 'delivered',
  'retouch_returned': 'retouch_returned',
  'manual':           'manual_skip',
  'adaptation_done':  'delivered'
};

function cpkCreate(trigger, opts) {
  var proj = getActiveProject();
  if (!proj) return null;
  opts = opts || {};
  if (typeof emitEvent !== 'function') {
    console.warn('cpkCreate: events.js not loaded yet, skipping');
    return null;
  }

  var actor = (typeof evGetCurrentActor === 'function') ? evGetCurrentActor() : { name: 'system' };

  /* Special-case: client_saved может содержать added + removed одновременно —
     разбиваем на два события (selection_added / selection_removed). */
  if (trigger === 'client_saved') {
    var lastEv = null;
    if (opts.added && opts.added.length > 0) {
      lastEv = emitEvent(proj, 'selection_added', actor, opts.added,
        opts.note ? { payload: { note: opts.note } } : undefined);
    }
    if (opts.removed && opts.removed.length > 0) {
      lastEv = emitEvent(proj, 'selection_removed', actor, opts.removed,
        opts.note ? { payload: { note: opts.note } } : undefined);
    }
    if (!lastEv && opts.photos && opts.photos.length > 0) {
      lastEv = emitEvent(proj, 'selection_added', actor, opts.photos);
    }
    return lastEv;
  }

  var type = _CPK_TRIGGER_TO_TYPE[trigger] || trigger;
  var evOpts = {};
  var payload = {};
  if (opts.note) payload.note = opts.note;
  if (opts.iteration) payload.iteration = opts.iteration;
  if (opts.stage) payload.legacy_stage = opts.stage;
  if (Object.keys(payload).length > 0) evOpts.payload = payload;

  return emitEvent(proj, type, actor, opts.photos || [], evOpts);
}

/**
 * Получить все события проекта (canonical event log).
 * Раньше возвращало _checkpoints. Теперь возвращает _events —
 * формат отличается (type вместо trigger, ts вместо date).
 * @returns {Array}
 */
function cpkGetAll() {
  var proj = getActiveProject();
  return (proj && Array.isArray(proj._events)) ? proj._events : [];
}

/**
 * Получить путь конкретного фото по чекпоинтам.
 * @param {string} photoName — имя файла
 * @returns {Array} чекпоинты где это фото упомянуто
 */
function cpkPhotoHistory(photoName) {
  var all = cpkGetAll();
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var cp = all[i];
    if (cp.photos && cp.photos.indexOf(photoName) >= 0) {
      result.push(cp);
    }
    if (cp.added && cp.added.indexOf(photoName) >= 0) {
      result.push(cp);
    }
    if (cp.removed && cp.removed.indexOf(photoName) >= 0) {
      result.push(cp);
    }
  }
  return result;
}

/**
 * Получить текущее состояние отбора: список имён фото в карточках + OC.
 * @returns {string[]}
 */
function cpkGetSelectionList() {
  var proj = getActiveProject();
  if (!proj) return [];
  var list = [];
  var seen = {};
  if (proj.cards) {
    for (var c = 0; c < proj.cards.length; c++) {
      var slots = proj.cards[c].slots || [];
      for (var s = 0; s < slots.length; s++) {
        if (slots[s].file && !seen[slots[s].file]) {
          list.push(slots[s].file);
          seen[slots[s].file] = true;
        }
      }
    }
  }
  if (proj.otherContent) {
    for (var o = 0; o < proj.otherContent.length; o++) {
      var n = proj.otherContent[o].name;
      if (n && !seen[n]) { list.push(n); seen[n] = true; }
    }
  }
  if (proj.ocContainers) {
    for (var ci = 0; ci < proj.ocContainers.length; ci++) {
      var items = proj.ocContainers[ci].items || [];
      for (var it = 0; it < items.length; it++) {
        if (items[it].name && !seen[items[it].name]) {
          list.push(items[it].name);
          seen[items[it].name] = true;
        }
      }
    }
  }
  return list;
}

/**
 * Вычислить дельту между текущим отбором и последним чекпоинтом.
 * @returns {Object} { added: string[], removed: string[], unchanged: string[] }
 */
function cpkCalcDelta() {
  var current = cpkGetSelectionList();
  var currentSet = {};
  for (var i = 0; i < current.length; i++) currentSet[current[i]] = true;

  /* Найти последний чекпоинт с photos */
  var all = cpkGetAll();
  var prevPhotos = [];
  for (var j = all.length - 1; j >= 0; j--) {
    if (all[j].photos && all[j].photos.length > 0) {
      prevPhotos = all[j].photos;
      break;
    }
  }
  var prevSet = {};
  for (var k = 0; k < prevPhotos.length; k++) prevSet[prevPhotos[k]] = true;

  var added = [], removed = [], unchanged = [];
  for (var a = 0; a < current.length; a++) {
    if (prevSet[current[a]]) unchanged.push(current[a]);
    else added.push(current[a]);
  }
  for (var r = 0; r < prevPhotos.length; r++) {
    if (!currentSet[prevPhotos[r]]) removed.push(prevPhotos[r]);
  }
  return { added: added, removed: removed, unchanged: unchanged };
}


/* ──────────────────────────────────────────────
   Утилиты
   ────────────────────────────────────────────── */

/**
 * Экранирование HTML-спецсимволов (XSS-защита).
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Получить текущий активный проект.
 * @returns {Object|null}
 */
function getActiveProject() {
  if (App.selectedProject >= 0 && App.selectedProject < App.projects.length) {
    return App.projects[App.selectedProject];
  }
  return null;
}

/**
 * Человекочитаемый статус карточки.
 * @param {string} s — draft | pending | approved | done
 * @returns {string}
 */
function statusLabel(s) {
  var map = { draft: 'Черновик', pending: 'На согласовании', approved: 'Утверждено', done: 'Готово' };
  return map[s] || s;
}


/* ──────────────────────────────────────────────
   Проверка бэкенда (pywebview)
   ────────────────────────────────────────────── */

/**
 * Проверяет доступность Python-бэкенда через pywebview bridge.
 * Обновляет индикатор в status-bar.
 */
function checkBackend() {
  var el = document.getElementById('backend-status');
  if (window.pywebview && window.pywebview.api) {
    try {
      window.pywebview.api.ping().then(function(result) {
        if (result === 'pong') {
          el.textContent = 'подключён';
          el.className = 'connected';
        } else {
          el.textContent = 'не подключён';
          el.className = 'disconnected';
        }
      }).catch(function() {
        el.textContent = 'не подключён';
        el.className = 'disconnected';
      });
    } catch(e) {
      el.textContent = 'не подключён';
      el.className = 'disconnected';
    }
  } else {
    el.textContent = 'не подключён';
    el.className = 'disconnected';
  }
}

window.addEventListener('pywebviewready', function() { checkBackend(); });
setTimeout(checkBackend, 1000);

/* Загрузить автосохранённые проекты при старте (browser fallback).
   Если открыта share-ссылка (?share=), пропускаем — будет загружен только share-проект. */
window.addEventListener('DOMContentLoaded', function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('share')) return; /* share-ссылка — не грузим localStorage */

  if (typeof shLoadAutoSaved === 'function' && App.projects.length === 0) {
    shLoadAutoSaved();
    if (App.projects.length > 0) {
      /* Локальные проекты загрузились — убрать заглушку "Загружаю..." */
      if (typeof _shCloudLoadDone !== 'undefined') _shCloudLoadDone = true;
      if (typeof renderProjects === 'function') renderProjects();

      /* Восстановить превью из IndexedDB (thumb + 1200px preview) */
      if (typeof pvDbRestoreProjectPreviews === 'function') {
        var pending = App.projects.length;
        for (var i = 0; i < App.projects.length; i++) {
          pvDbRestoreProjectPreviews(App.projects[i], function() {
            pending--;
            if (pending === 0) {
              /* Восстановить активную версию из выбранного проекта */
              var sel = (App.selectedProject >= 0) ? App.projects[App.selectedProject] : null;
              if (sel && sel._activeVersion && typeof PV_ACTIVE_VERSION !== 'undefined') {
                PV_ACTIVE_VERSION = sel._activeVersion;
              }
              /* Все превью загружены — перерисовать */
              renderProjects();
              if (typeof pvRenderAll === 'function') pvRenderAll();
            }
          });
        }
      }
    }
  }
});
