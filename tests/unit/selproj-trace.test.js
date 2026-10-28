// ─────────────────────────────────────────────────────────────
//  selproj-trace.test.js
//
//  jsdom-харнесс на РЕАЛЬНЫХ state.js + diag.js. Проверяет усиленную
//  диагностику бага «перескакивает проект» (bug0703, Маша 03.07):
//    · каждая смена App.selectedProject пишет обогащённую запись
//      (fromName/toName, page, cardIdx, lightbox, projectsCount,
//       suspicious, stack) в window._selProjTrace;
//    · «подозрительный переход» помечается, когда выбор уехал на ДРУГОЙ
//      валидный проект на экране контента ИЛИ при открытом лайтбоксе;
//    · трейс персистится в localStorage и восстанавливается при
//      перезагрузке (пережил reload — улика не теряется);
//    · кольцевой буфер ограничен (cap 80);
//    · _selProjTraceClear чистит и память, и localStorage;
//    · get/set-семантика App.selectedProject не изменилась;
//    · diag.dgDownloadLog ВКЛЮЧАЕТ selProjTrace в payload (раньше — нет,
//      из-за чего улика никогда не попадала в скачанный лог).
//
//  Запуск:  node tests/unit/selproj-trace.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const stateSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'state.js'), 'utf8');
const diagSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'diag.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

function freshDom() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    runScripts: 'outside-only', url: 'http://localhost/'
  });
  const w = dom.window;
  w.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
  w.getComputedStyle = w.getComputedStyle || function () { return {}; };
  return dom;
}

// ── 1. Санити: трап установлен ──
let dom = freshDom();
dom.window.eval(stateSrc);
let w = dom.window;
ok('App defined', typeof w.App === 'object' && w.App);
ok('_selProjTrace is array', Array.isArray(w._selProjTrace));
ok('_selProjTraceClear is function', typeof w._selProjTraceClear === 'function');

// ── 2. Базовая запись + обогащённые поля ──
w._selProjTraceClear();
w.App.projects = [{ brand: 'EKONIKA' }, { brand: 'Victoria' }];
w.App.currentPage = 'shootings';
w.App.selectedProject = 0;            // from -1 -> 0
let r = w._selProjTrace[w._selProjTrace.length - 1];
ok('record pushed', w._selProjTrace.length === 1);
ok('from/to correct', r.from === -1 && r.to === 0);
ok('toName resolved from brand', r.toName === 'EKONIKA');
ok('page captured', r.page === 'shootings');
ok('projectsCount captured', r.projectsCount === 2);
ok('lightbox false when absent', r.lightbox === false);
ok('not suspicious (from was -1)', r.suspicious === false);
ok('has ts + stack', typeof r.ts === 'string' && typeof r.stack === 'string');

// ── 3. Подозрительный переход на экране контента ──
w.App.currentPage = 'content';
w.App.selectedProject = 1;            // from 0 -> 1 на content
r = w._selProjTrace[w._selProjTrace.length - 1];
ok('suspicious on content, valid->valid', r.suspicious === true);
ok('fromName/toName named', r.fromName === 'EKONIKA' && r.toName === 'Victoria');

// ── 4. НЕ подозрительно на экране съёмок ──
w.App.currentPage = 'shootings';
w.App.selectedProject = 0;            // from 1 -> 0 на shootings
r = w._selProjTrace[w._selProjTrace.length - 1];
ok('not suspicious on shootings', r.suspicious === false);

// ── 5. Лайтбокс открыт -> подозрительно даже вне content ──
let lb = w.document.createElement('div');
lb.id = 'pv-lightbox';
Object.defineProperty(lb, 'offsetParent', { get: function () { return w.document.body; } });
w.document.body.appendChild(lb);
w.App.currentPage = 'shootings';
w.App.selectedProject = 1;            // from 0 -> 1, лайтбокс открыт
r = w._selProjTrace[w._selProjTrace.length - 1];
ok('lightbox detected open', r.lightbox === true);
ok('suspicious when lightbox open', r.suspicious === true);
w.document.body.removeChild(lb);

// ── 6. Персистентность в localStorage ──
let stored = JSON.parse(w.localStorage.getItem('maketcp_selproj_trace'));
ok('persisted to localStorage', Array.isArray(stored) && stored.length === w._selProjTrace.length);
ok('persisted last record matches', stored[stored.length - 1].to === r.to);

// ── 7. get/set семантика не сломана ──
w.App.selectedProject = 1;
ok('getter returns set value', w.App.selectedProject === 1);
w.App.selectedProject = 0;
ok('getter returns new value', w.App.selectedProject === 0);

// ── 8. Кольцевой буфер cap 80 ──
w._selProjTraceClear();
for (let i = 0; i < 120; i++) { w.App.selectedProject = (i % 2); }
ok('ring buffer capped at 80', w._selProjTrace.length === 80);

// ── 9. Очистка чистит память и localStorage ──
w._selProjTraceClear();
ok('clear empties array', w._selProjTrace.length === 0);
ok('clear removes localStorage key', w.localStorage.getItem('maketcp_selproj_trace') === null);

// ── 10. Восстановление трейса при «перезагрузке» ──
let dom2 = freshDom();
dom2.window.localStorage.setItem('maketcp_selproj_trace',
  JSON.stringify([{ ts: 't', from: -1, to: 5, suspicious: true }]));
dom2.window.eval(stateSrc);
ok('trace restored after reload', dom2.window._selProjTrace.length === 1 &&
  dom2.window._selProjTrace[0].to === 5);

// ── 11. diag.dgDownloadLog включает selProjTrace ──
let dom3 = freshDom();
let w3 = dom3.window;
w3.eval(diagSrc);
w3.eval(stateSrc);
w3.App.projects = [{ brand: 'A' }, { brand: 'B' }];
w3.App.currentPage = 'content';
w3.App.selectedProject = 0;
w3.App.selectedProject = 1;
let captured = null;
w3.Blob = function (parts) { captured = parts && parts[0]; this.size = (captured || '').length; };
w3.URL = w3.URL || {};
w3.URL.createObjectURL = function () { return 'blob:x'; };
w3.URL.revokeObjectURL = function () {};
w3.HTMLAnchorElement.prototype.click = function () {};
ok('dgDownloadLog defined', typeof w3.dgDownloadLog === 'function');
w3.dgDownloadLog();
let payload = null;
try { payload = JSON.parse(captured); } catch (e) {}
ok('payload parsed', payload && typeof payload === 'object');
ok('payload.selProjTrace is array', payload && Array.isArray(payload.selProjTrace));
ok('payload.selProjTrace matches trace length',
  payload && payload.selProjTrace.length === w3._selProjTrace.length && w3._selProjTrace.length >= 2);
ok('payload.selProjTrace carries suspicious flag',
  payload && payload.selProjTrace.some(function (x) { return x.suspicious === true; }));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
