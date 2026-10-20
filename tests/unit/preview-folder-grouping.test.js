// ─────────────────────────────────────────────────────────────
//  preview-folder-grouping.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + previews.js. Проверяет
//  группировку галереи превью по папкам (срез задачи
//  design0702-gallery-virtualization — «+ группировка по папкам»):
//    · кнопка-тоггл «Группировать» присутствует в панелях pv и oc-pv;
//    · pvToggleGroupByFolder флипает состояние и persist в localStorage;
//    · pvPrimaryFolder корректно берёт первую папку / «Без папки»;
//    · при включённой группировке pvRenderPanel сортирует store по
//      (папка, имя) и выставляет gallery._pvGroup / _pvGroupCounts;
//    · pvBuildHTML вставляет заголовок секции перед первым фото каждой
//      папки и НЕ дублирует его при lazy-подгрузке батчами;
//    · при выключенной группировке (дефолт) разметка и порядок не
//      меняются — заголовков нет (обратная совместимость).
//
//  Запуск:  node tests/unit/preview-folder-grouping.test.js
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
// jsdom предоставляет настоящий localStorage; очищаем для детерминизма
try { window.localStorage.clear(); } catch (e) {}

window.eval(pvSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// ── Тестовый набор фото: 3 папки, намеренно вперемешку ──
const STORE = [
  { name: 'b2.jpg', rating: 0, folders: ['Beta'] },
  { name: 'a1.jpg', rating: 0, folders: ['Alpha'] },
  { name: 'g1.jpg', rating: 0, folders: [] },          // Без папки
  { name: 'b1.jpg', rating: 0, folders: ['Beta'] },
  { name: 'a2.jpg', rating: 0, folders: ['Alpha'] },
  { name: 'a3.jpg', rating: 0, folders: ['Alpha'] }
];
const FOLDERS = ['Alpha', 'Beta'];   // pvGetFolders() — >1 папки, чтобы блок показался

// ── Стабы коллабораторов (изолируем логику грппировки) ──
window.pvGetStore = function () { return STORE.slice(); };
window.pvUsedInCards = function () { return {}; };
window.pvGetFolders = function () { return FOLDERS.slice(); };
window.pvGetLoadedVersions = function () { return ['preselect']; };
window.pvBindDragFromGallery = function () {};
window.pvDetectOrient = function () {};
window.pvApplyColumnWidth = function () {};
window.pvBindLazyScroll = function () {};
window.pvMaybeShowCoach = function () {};
window.pvRenderFilterStars = function () {};
window.pvRenderFolderSelect = function () {};
window.pvRenderVersionBar = function () {};
window.rtAnnotCount = function () { return 0; };
window.pvGetThumb = function () { return ''; };
window.pvHasVersion = function () { return true; };
window.pvShortName = function (n) { return n; };
window._pvFindCenterAnchor = function () { return null; };
window._pvRestoreToAnchor = function () { return true; };
window.getActiveProject = function () { return null; };
window.ocRenderField = function () {};
// pvToggleGroupByFolder вызывает pvRenderAll — заменяем на спай, т.к. в тесте
// галерею рендерим напрямую через pvRenderPanel (renderPv).
window.pvRenderAll = function () {};

function renderPv() {
  window.pvRenderPanel('pv-gallery', 'pv-toolbar', 'pv-count', 'pv-dropzone');
  return document.getElementById('pv-gallery');
}
function storeNames(g) { return (g._pvStore || []).map(function (p) { return p.name; }); }
function headers(g) {
  return Array.prototype.map.call(g.querySelectorAll('.pv-folder-head'), function (el) { return el.textContent; });
}

// 1. Кнопки-тогглы присутствуют в обеих панелях
ok('pv group toggle exists', !!document.getElementById('pv-group-folders'));
ok('oc-pv group toggle exists', !!document.getElementById('oc-pv-group-folders'));

// 2. pvPrimaryFolder
ok('pvPrimaryFolder picks first folder', window.pvPrimaryFolder({ folders: ['X', 'Y'] }) === 'X');
ok('pvPrimaryFolder falls back to «Без папки»', window.pvPrimaryFolder({ folders: [] }) === 'Без папки');

// 3. Дефолт: группировка ВЫКЛ -> нет заголовков, порядок как в store
ok('default: grouping off', window.PV_GROUP_BY_FOLDER['pv'] === false);
let g = renderPv();
ok('off: no folder headers rendered', headers(g).length === 0);
// Плоский вид использует штатную сортировку по имени (pvRenderPanel, стр.1752).
ok('off: standard name-sort order', storeNames(g).join(',') === 'a1.jpg,a2.jpg,a3.jpg,b1.jpg,b2.jpg,g1.jpg');
ok('off: gallery._pvGroup false', g._pvGroup === false);

// 4. Включаем группировку через тоггл -> persist + state
window.pvToggleGroupByFolder('pv');
ok('toggle flips state on', window.PV_GROUP_BY_FOLDER['pv'] === true);
ok('toggle persists to localStorage', window.localStorage.getItem('maketcp_pv_group_pv') === '1');

// 5. Рендер с группировкой: сортировка (папка, имя) + заголовки + счётчики
g = renderPv();
ok('on: store sorted by (folder,name)',
   storeNames(g).join(',') === 'a1.jpg,a2.jpg,a3.jpg,b1.jpg,b2.jpg,g1.jpg');
const H = headers(g);
ok('on: three folder headers', H.length === 3);
ok('on: header order Alpha/Beta/Без папки', H.join('|') === 'Alpha (3)|Beta (2)|Без папки (1)');
ok('on: gallery._pvGroup true', g._pvGroup === true);
ok('on: group counts correct', g._pvGroupCounts && g._pvGroupCounts['Alpha'] === 3 && g._pvGroupCounts['Beta'] === 2 && g._pvGroupCounts['Без папки'] === 1);

// 6. pvBuildHTML не дублирует заголовок на границе батчей (lazy-scroll).
//    Рендерим «второй батч» начиная с индекса внутри папки Alpha.
const sorted = g._pvStore;
const batch2 = window.pvBuildHTML(sorted, {}, 2, 6, true, g._pvGroupCounts);
// store[1]=a2 (Alpha), store[2]=a3 (Alpha) -> первый элемент батча НЕ новый
// фолдер -> заголовок Alpha НЕ должен повториться; должны появиться Beta и Без папки.
const b2heads = (batch2.match(/pv-folder-head/g) || []).length;
ok('lazy batch: no duplicate Alpha header, 2 new headers (Beta, Без папки)', b2heads === 2);
ok('lazy batch: Alpha not repeated', batch2.indexOf('>Alpha (') === -1);
ok('lazy batch: Beta header present', batch2.indexOf('>Beta (2)<') !== -1);

// 7. Выключаем обратно -> снова плоский вид
window.pvToggleGroupByFolder('pv');
ok('toggle off persists 0', window.localStorage.getItem('maketcp_pv_group_pv') === '0');
g = renderPv();
ok('off again: no headers', headers(g).length === 0);

// 8. Группировка не включается, если выбран одиночный фильтр папки
window.pvToggleGroupByFolder('pv'); // on
window.PV_FOLDER_FILTER['pv'] = 'Alpha';
g = renderPv();
ok('single-folder filter disables grouping headers', headers(g).length === 0);
window.PV_FOLDER_FILTER['pv'] = '';

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
