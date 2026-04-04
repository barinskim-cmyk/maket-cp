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
     name:     string   — имя ("EKONIKA стандарт", "DShu аксессуары")
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
 * @returns {Object} созданный шаблон
 */
function addUserTemplate(name, slots, hAspect, vAspect, lockRows, hasHero) {
  var tmpl = {
    id: 'tmpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: name,
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
  { id: 'preselect',    name: 'Преотбор и превью',    beta: true },
  { id: 'selection',    name: 'Отбор фотографа',      beta: true },
  { id: 'client',       name: 'Отбор клиента',        beta: true },
  { id: 'color',        name: 'Цветокоррекция',       beta: false },
  { id: 'retouch_task', name: 'Комментарии на ретушь', beta: false },
  { id: 'retouch',      name: 'Ретушь',               beta: false },
  { id: 'retouch_ok',   name: 'Согласование ретуши',  beta: false },
  { id: 'adaptation',   name: 'Адаптация к каналам',  beta: false },
];


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
async function checkBackend() {
  var el = document.getElementById('backend-status');
  try {
    if (window.pywebview && window.pywebview.api) {
      var result = await window.pywebview.api.ping();
      if (result === 'pong') {
        el.textContent = 'подключён';
        el.className = 'connected';
        return;
      }
    }
  } catch(e) {}
  el.textContent = 'не подключён';
  el.className = 'disconnected';
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
    if (App.projects.length > 0 && typeof renderProjects === 'function') {
      renderProjects();

      /* Восстановить превью из IndexedDB (thumb + 1200px preview) */
      if (typeof pvDbRestoreProjectPreviews === 'function') {
        var pending = App.projects.length;
        for (var i = 0; i < App.projects.length; i++) {
          pvDbRestoreProjectPreviews(App.projects[i], function() {
            pending--;
            if (pending === 0) {
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
