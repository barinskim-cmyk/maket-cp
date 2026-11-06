// ─────────────────────────────────────────────────────────────
//  retoucher-queue.test.js
//
//  jsdom-харнесс на РЕАЛЬНЫХ state.js + shootings.js. Проверяет
//  слайс 1 задачи «Минимальный режим ретушёра»:
//    · shBuildRetouchQueue — чистая функция очереди: total/done/pending,
//      исключение синтетических имён слотов, детекция версии retouch
//      по stem'у (регистронезависимо, без учёта расширения), сбор
//      правок клиента (card._comments author='client' + _clientComments),
//      исключение комментариев команды;
//    · shRenderClientBar(role='retoucher') рисует панель: класс rtch-mode,
//      сводка очереди в подзаголовке, список кадров по карточкам,
//      статусы «в работе»/«готово», блок правок клиента;
//    · без emoji в выводе;
//    · guard: пустой проект -> пустая панель, без throw;
//    · роль client/owner не трогается (нет rtch-mode, свои кнопки).
//
//  Запуск:  node tests/unit/retoucher-queue.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const stateSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'state.js'), 'utf8');
const shSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'shootings.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body><div id="app-main"></div></body>', {
  runScripts: 'outside-only', url: 'http://localhost/'
});
const { window } = dom;
const { document } = window;

window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.prompt = function () { return ''; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };

window.eval(stateSrc);
window.eval(shSrc);

// Стабы на функции, которые дёргает только client-режим входа (не ветка retoucher)
window.showPage = function () {};
window.showSubpage = function () {};
window._hideShareLoader = function () {};
window.cpMobileInit = function () {};
window.shAutoSave = function () {};

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

function install(proj, role) {
  if (proj) proj._role = role || 'retoucher';
  window.App.projects = proj ? [proj] : [];
  window.App.selectedProject = proj ? 0 : -1;
  var old = document.getElementById('client-action-bar');
  if (old) old.remove();
}

function makeProj() {
  return {
    brand: 'BrandX', _role: 'retoucher',
    previews: [
      { name: 'IMG_001.CR3', stem: 'IMG_001', versions: { retouch: 'url_r' } }, // есть ретушь
      { name: 'IMG_002.jpg', stem: 'IMG_002', versions: { color: 'url_c' } },    // только ЦК
      { name: 'IMG_003.jpg', stem: 'IMG_003', versions: {} }                     // без версий
    ],
    cards: [
      { name: 'Карточка A', slots: [
        { file: 'IMG_001.jpg', comment: 'кадрировать уже' }, // filled, расширение иное -> stem матч retouch => done
        { file: 'IMG_002.CR3' },                             // filled, только color => pending
        { file: 'slot_0_1.jpg' },                            // синтетический пустой слот -> исключить
        { file: null, dataUrl: null }                        // пустой -> исключить
      ], _comments: [
        { id: 'c1', text: 'сделать светлее', author: 'client', created: '2026-11-01' },
        { id: 'c2', text: 'внутренняя заметка', author: 'team', created: '2026-11-01' }
      ] },
      { name: 'Карточка B', slots: [
        { file: 'IMG_003.jpg' }                              // filled, нет retouch => pending
      ] }
    ],
    _clientComments: [ { type: 'extra_request', text: 'нужен ещё ракурс', date: '02.11.2026 10:00' } ]
  };
}

// ── 1. Чистая функция очереди: тоталы ──
var proj = makeProj();
install(proj, 'retoucher');
var q = window.shBuildRetouchQueue(proj);
ok('total counts only real filled slots (3)', q.total === 3);
ok('done = 1 (IMG_001 has retouch)', q.done === 1);
ok('pending = 2 (IMG_002, IMG_003)', q.pending === 2);
ok('synthetic slot_0_1 excluded', JSON.stringify(q).indexOf('slot_0_1') === -1);

// ── 2. Детекция версии retouch по stem (ext-agnostic, case-insensitive) ──
var itemsA = q.cards[0].items;
var img001 = itemsA.filter(function (x) { return x.file === 'IMG_001.jpg'; })[0];
ok('IMG_001.jpg matched to retouch version despite .CR3 preview', img001 && img001.done === true);
var img002 = itemsA.filter(function (x) { return x.file === 'IMG_002.CR3'; })[0];
ok('IMG_002 (only color) is pending', img002 && img002.done === false);
ok('slot comment carried through', img001 && img001.comment === 'кадрировать уже');

// case-insensitive stem match
var projCI = makeProj();
projCI.previews[0].stem = 'img_001';
projCI.cards[0].slots[0].file = 'IMG_001.JPG';
var qCI = window.shBuildRetouchQueue(projCI);
ok('stem match is case-insensitive', qCI.done === 1);

// ── 3. Правки клиента собраны, командные исключены ──
ok('feedback has 2 entries (1 client card comment + 1 project comment)', q.feedback.length === 2);
var fbText = q.feedback.map(function (f) { return f.text; }).join('|');
ok('client card comment present', fbText.indexOf('сделать светлее') !== -1);
ok('project client comment present', fbText.indexOf('нужен ещё ракурс') !== -1);
ok('team comment excluded from feedback', fbText.indexOf('внутренняя заметка') === -1);

// ── 4. Рендер панели ретушёра ──
install(proj, 'retoucher');
window.shRenderClientBar();
var bar = document.getElementById('client-action-bar');
ok('bar rendered', !!bar);
ok('bar has rtch-mode class', bar && /\brtch-mode\b/.test(bar.className));
var sub = bar.querySelector('.client-bar-subtitle');
ok('subtitle shows pending/total', sub && /осталось\s+2\s+из\s+3/.test(sub.textContent));
ok('subtitle shows done count', sub && /готово\s+1/.test(sub.textContent));
ok('panel rendered', !!bar.querySelector('.rtch-panel'));
ok('two card groups rendered', bar.querySelectorAll('.rtch-card').length === 2);
ok('three queue items rendered', bar.querySelectorAll('.rtch-item').length === 3);
ok('one item marked done', bar.querySelectorAll('.rtch-item.done').length === 1);
var states = Array.prototype.map.call(bar.querySelectorAll('.rtch-state'), function (e) { return e.textContent; });
ok('states use в работе / готово', states.indexOf('готово') !== -1 && states.indexOf('в работе') !== -1);
ok('feedback block rendered', !!bar.querySelector('.rtch-feedback'));
ok('feedback list has 2 items', bar.querySelectorAll('.rtch-fb-list li').length === 2);

// ── 5. Без emoji ──
var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
ok('no emoji in retoucher panel', !EMOJI.test(bar.innerHTML));

// ── 6. Guard: пустой проект ──
var projEmpty = { brand: 'Empty', _role: 'retoucher', cards: [], previews: [] };
install(projEmpty, 'retoucher');
var threw = false;
try { window.shRenderClientBar(); } catch (e) { threw = true; console.log(e && e.message); }
ok('empty project does not throw', !threw);
var barE = document.getElementById('client-action-bar');
ok('empty project shows rtch-empty', barE && !!barE.querySelector('.rtch-empty'));
var qE = window.shBuildRetouchQueue(projEmpty);
ok('empty queue totals zero', qE.total === 0 && qE.pending === 0 && qE.done === 0);
ok('shBuildRetouchQueue(null) safe', (function () { try { var r = window.shBuildRetouchQueue(null); return r.total === 0; } catch (e) { return false; } })());

// ── 7. Роль client/owner не трогается ──
var projC = makeProj();
install(projC, 'client');
window.shRenderClientBar();
var barC = document.getElementById('client-action-bar');
ok('client role: no rtch-mode class', barC && !/\brtch-mode\b/.test(barC.className));
ok('client role: no rtch-panel', barC && !barC.querySelector('.rtch-panel'));
ok('client role: has approve/extra buttons', barC && !!barC.querySelector('.client-bar-buttons'));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
