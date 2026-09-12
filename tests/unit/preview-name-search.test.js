// ─────────────────────────────────────────────────────────────
//  preview-name-search.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + previews.js. Проверяет
//  поиск по имени файла в панели превью (срез задачи
//  design0702-gallery-virtualization / audit C1):
//    · поле поиска присутствует в панелях pv и oc-pv;
//    · pvSetNameFilter нормализует ввод (trim) и планирует перерисовку;
//    · фильтр по имени регистронезависим и работает как подстрока;
//    · пустой запрос не фильтрует ничего;
//    · фильтр по имени комбинируется с фильтром по рейтингу.
//
//  Тестируется НАСТОЯЩАЯ логика фильтрации в pvRenderPanel — коллабораторы
//  (рендер HTML, drag-bind, lazy-scroll, coach-marks и т.п.) застаблены,
//  чтобы изолировать пайплайн фильтров. Проверяем gallery._pvStore —
//  массив, реально прошедший все фильтры.
//
//  Запуск:  node tests/unit/preview-name-search.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const pvSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'previews.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

// Глобалы окружения, которых ждёт previews.js
window.esc = function (s) { return String(s == null ? '' : s); };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.indexedDB = undefined;

// Загружаем НАСТОЯЩИЙ previews.js в scope окна
window.eval(pvSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// ── Тестовый набор фото ──
const STORE = [
  { name: 'IMG_0001.jpg', rating: 5, folders: [] },
  { name: 'IMG_0002.jpg', rating: 0, folders: [] },
  { name: 'DRESS_red_01.jpg', rating: 3, folders: [] },
  { name: 'dress_red_02.jpg', rating: 0, folders: [] },
  { name: 'SHOES_100.jpg', rating: 4, folders: [] }
];

// ── Стабы коллабораторов (изолируем логику фильтрации) ──
window.pvGetStore = function () { return STORE.slice(); };
window.pvUsedInCards = function () { return {}; };
window.pvGetFolders = function () { return []; };            // <=1 папки -> фильтр папок скрыт
window.pvGetLoadedVersions = function () { return ['preselect']; }; // version-bar скрыт
window.pvBuildHTML = function () { return ''; };             // не тестируем разметку здесь
window.pvBindDragFromGallery = function () {};
window.pvDetectOrient = function () {};
window.pvApplyColumnWidth = function () {};
window.pvBindLazyScroll = function () {};
window.pvMaybeShowCoach = function () {};
window.pvRenderFilterStars = function () {};
window.pvRenderFolderSelect = function () {};
window.pvRenderVersionBar = function () {};
window._pvFindCenterAnchor = function () { return null; };
window._pvRestoreToAnchor = function () { return true; };

// Синхронный спай вместо реального pvRenderAll (для теста дебаунса)
let renderAllCalls = 0;
window.pvRenderAll = function () { renderAllCalls++; };

function renderPv() {
  window.PV_NAME_FILTER['pv'] = window.PV_NAME_FILTER['pv']; // no-op читаемость
  window.pvRenderPanel('pv-gallery', 'pv-toolbar', 'pv-count', 'pv-dropzone');
  return document.getElementById('pv-gallery')._pvStore || [];
}
function names(arr) { return arr.map(function (p) { return p.name; }); }

// 1. Поля поиска присутствуют в обеих панелях
ok('pv search input exists', !!document.getElementById('pv-name-search'));
ok('oc-pv search input exists', !!document.getElementById('oc-pv-name-search'));
ok('pv search input inside .pv-filter', (function () {
  const el = document.getElementById('pv-name-search');
  return el && el.closest('.pv-filter') && el.closest('.pv-filter').id === 'pv-filter';
})());

// 2. Дефолт: пустой фильтр -> все фото
window.PV_FILTER['pv'] = 0;
window.PV_NAME_FILTER['pv'] = '';
ok('empty filter returns all', renderPv().length === STORE.length);

// 3. Подстрока по имени
window.PV_NAME_FILTER['pv'] = 'dress';
ok('substring "dress" -> 2 photos', names(renderPv()).sort().join(',') === 'DRESS_red_01.jpg,dress_red_02.jpg');

// 4. Регистронезависимость (верхний регистр запроса)
window.PV_NAME_FILTER['pv'] = 'IMG';
ok('uppercase query "IMG" -> 2 photos', renderPv().length === 2);
window.PV_NAME_FILTER['pv'] = 'shoes';
ok('lowercase query matches uppercase name', names(renderPv()).join(',') === 'SHOES_100.jpg');

// 5. Нет совпадений -> пустой результат + сообщение
window.PV_NAME_FILTER['pv'] = 'zzz_nomatch';
const empty = renderPv();
ok('no match -> empty store', empty.length === 0);
ok('no match -> empty-state message', /Нет фото по выбранным фильтрам/.test(document.getElementById('pv-gallery').innerHTML));

// 6. Комбинация с фильтром рейтинга: rating>=4 И имя содержит "0"
window.PV_FILTER['pv'] = 4;
window.PV_NAME_FILTER['pv'] = '0';   // все имена содержат 0, но rating>=4 -> IMG_0001(5), SHOES_100(4)
ok('name + rating combined', names(renderPv()).sort().join(',') === 'IMG_0001.jpg,SHOES_100.jpg');
window.PV_FILTER['pv'] = 0; // reset

// 7. pvSetNameFilter: тримит ввод и планирует ре-рендер (дебаунс)
renderAllCalls = 0;
window.pvSetNameFilter('pv', '  hat  ');
ok('pvSetNameFilter trims value', window.PV_NAME_FILTER['pv'] === 'hat');
ok('pvSetNameFilter debounced (no immediate render)', renderAllCalls === 0);

setTimeout(function () {
  ok('pvSetNameFilter fires render after debounce', renderAllCalls === 1);

  // 8. Повторный ввод в течение дебаунса -> один общий ре-рендер
  renderAllCalls = 0;
  window.pvSetNameFilter('pv', 'a');
  window.pvSetNameFilter('pv', 'ab');
  window.pvSetNameFilter('pv', 'abc');
  setTimeout(function () {
    ok('rapid typing coalesced into one render', renderAllCalls === 1);
    ok('final value after coalesced typing', window.PV_NAME_FILTER['pv'] === 'abc');

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail === 0 ? 0 : 1);
  }, 250);
}, 250);
