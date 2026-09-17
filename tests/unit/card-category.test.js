// ─────────────────────────────────────────────────────────────
//  card-category.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + cards.js. Проверяет
//  UI категории карточки (task 4.1):
//    · кнопка-тоггл: пусто -> "Категория"; задано -> имя + класс cp-cat-set;
//    · попап содержит "Без категории", список proj.categories и поле добавления;
//    · повторный клик закрывает попап (тоггл);
//    · текущая категория карточки, отсутствующая в proj.categories, всё равно
//      показывается в списке;
//    · cpSetCategory пишет card.category, снимает undo-снимок (cpSaveHistory),
//      ре-рендерит и сохраняет (shAutoSave);
//    · очистка ('') зануляет category;
//    · cpAddCategory добавляет новую категорию в проект (без дублей по регистру)
//      и назначает её карточке;
//    · в UI нет эмодзи/иконок (требование проекта);
//    · экранирование кавычек в имени категории внутри inline-onclick.
//
//  Тестируется НАСТОЯЩИЙ cards.js (загружен целиком в jsdom со стабами
//  коллабораторов). Спаим cpSaveHistory / cpRenderCard / cpRenderList /
//  shAutoSave, чтобы проверить сторону эффектов.
//
//  Запуск:  node tests/unit/card-category.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const cardsSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'cards.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

// ── Глобалы окружения, которых ждёт cards.js ──
window.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.prompt = function () { return ''; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };

// Приложение / активный проект
const CARD = { name: 'C1', category: '', slots: [], _history: [] };
const PROJ = { cards: [CARD], categories: ['Обувь', 'Сумки'], _template: null, templateId: '' };
window.App = { currentCardIdx: 0 };
window.getActiveProject = function () { return PROJ; };
window.UserTemplates = [];

// Загружаем НАСТОЯЩИЙ cards.js в scope окна
window.eval(cardsSrc);

// Спаи на побочные эффекты — ПОСЛЕ eval, чтобы перекрыть реальные
// объявления cards.js (cpRenderCard/cpRenderList/cpSaveHistory).
let calls = { saveHistory: 0, renderCard: 0, renderList: 0, autoSave: 0 };
window.cpSaveHistory = function () { calls.saveHistory++; };
window.cpRenderCard = function () { calls.renderCard++; };
window.cpRenderList = function () { calls.renderList++; };
window.shAutoSave = function () { calls.autoSave++; };

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

// ── 1. Кнопка: пусто ──
CARD.category = '';
let btn = window._cpCategoryBtnHTML(CARD);
ok('btn empty shows "Категория"', /Категория/.test(btn) && !/cp-cat-set/.test(btn));

// ── 2. Кнопка: задано ──
CARD.category = 'Обувь';
btn = window._cpCategoryBtnHTML(CARD);
ok('btn set shows name + cp-cat-set', /Обувь/.test(btn) && /cp-cat-set/.test(btn));
CARD.category = '';

// ── 3. Открытие попапа: пункты ──
function openMenu() {
  const b = document.createElement('button');
  b.className = 'cp-cat-btn';
  document.body.appendChild(b);
  window.cpToggleCategoryMenu({ stopPropagation: function () {}, currentTarget: b });
  return document.querySelector('.cp-cat-menu');
}
let menu = openMenu();
ok('menu opens', !!menu);
ok('menu has "Без категории"', !!menu && /Без категории/.test(menu.innerHTML));
ok('menu lists proj.categories', !!menu && /Обувь/.test(menu.innerHTML) && /Сумки/.test(menu.innerHTML));
ok('menu has add input + button', !!menu && !!menu.querySelector('.cp-cat-input') && /cpAddCategory/.test(menu.innerHTML));
ok('menu no emoji/icons', !!menu && !EMOJI_RE.test(menu.innerHTML));

// ── 4. Тоггл закрывает ──
const b2 = document.querySelector('.cp-cat-btn');
window.cpToggleCategoryMenu({ stopPropagation: function () {}, currentTarget: b2 });
ok('second toggle closes menu', !document.querySelector('.cp-cat-menu'));

// ── 5. Текущая категория вне списка проекта показывается ──
CARD.category = 'Очки'; // нет в proj.categories
menu = openMenu();
ok('out-of-list current category shown', !!menu && /Очки/.test(menu.innerHTML));
window.cpCloseCategoryMenu();
CARD.category = '';

// ── 6. cpSetCategory назначает + эффекты ──
calls = { saveHistory: 0, renderCard: 0, renderList: 0, autoSave: 0 };
window.cpSetCategory('Сумки');
ok('cpSetCategory sets card.category', CARD.category === 'Сумки');
ok('cpSetCategory took undo snapshot', calls.saveHistory === 1);
ok('cpSetCategory re-rendered + saved', calls.renderCard === 1 && calls.renderList === 1 && calls.autoSave === 1);

// ── 7. Очистка ──
calls = { saveHistory: 0, renderCard: 0, renderList: 0, autoSave: 0 };
window.cpSetCategory('');
ok('cpSetCategory("") clears', CARD.category === '' && calls.saveHistory === 1);

// ── 8. No-op при той же категории (без снимка) ──
CARD.category = 'Обувь';
calls = { saveHistory: 0, renderCard: 0, renderList: 0, autoSave: 0 };
window.cpSetCategory('Обувь');
ok('same category is no-op (no snapshot)', calls.saveHistory === 0);
CARD.category = '';

// ── 9. cpAddCategory добавляет новую + назначает ──
PROJ.categories = ['Обувь', 'Сумки'];
menu = openMenu();
menu.querySelector('.cp-cat-input').value = 'Ремни';
calls = { saveHistory: 0, renderCard: 0, renderList: 0, autoSave: 0 };
window.cpAddCategory();
ok('cpAddCategory pushes to proj.categories', PROJ.categories.indexOf('Ремни') !== -1);
ok('cpAddCategory assigns to card', CARD.category === 'Ремни');

// ── 10. Без дублей по регистру ──
CARD.category = '';
menu = openMenu();
menu.querySelector('.cp-cat-input').value = 'обувь'; // дубль "Обувь" в др. регистре
window.cpAddCategory();
const beltCount = PROJ.categories.filter(function (c) { return c.toLowerCase() === 'обувь'; }).length;
ok('cpAddCategory no case-duplicate', beltCount === 1 && CARD.category === 'Обувь');

// ── 11. Пустой ввод не добавляет ──
CARD.category = '';
const before = PROJ.categories.length;
menu = openMenu();
menu.querySelector('.cp-cat-input').value = '   ';
window.cpAddCategory();
ok('empty input adds nothing', PROJ.categories.length === before && CARD.category === '');
window.cpCloseCategoryMenu();

// ── 12. Экранирование кавычек в onclick ──
PROJ.categories = ["O'Neil"];
CARD.category = '';
menu = openMenu();
ok('quote in name escaped in onclick', !!menu && /O\\'Neil/.test(menu.innerHTML));
window.cpCloseCategoryMenu();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
