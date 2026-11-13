// ---------------------------------------------------------------
//  demo-project.test.js
//
//  jsdom-harness na REALNYH state.js + shootings.js + demo.js.
//  Proveryaet slais 1 zadachi feat0702-demo-project "Demo-proekt":
//    - shBuildDemoProject: validnaya struktura proekta, _demo:true,
//      NET _cloudId (ne popadaet v oblako), karty so slotami, zapolnennye
//      sloty s dataUrl (data:image/svg+xml), odin pustoi slot bez dataUrl;
//    - shDemoPlaceholder: data URI, podpis v SVG, orientatsiya h/v, bez emoji;
//    - shDemoEmptyActionHTML: knopka vne share, '' dlya share-ssylki;
//    - shLoadDemoProject: pushit demo v App, vybiraet, risuet spisok,
//      idempotenten, NE zovet oblachnuyu sinhronizatsiyu, net _cloudId;
//    - renderProjects pustoe sostoyanie soderzhit knopku demo (i NET dlya share);
//    - net emoji v vyvode.
//
//  Zapusk:  node tests/unit/demo-project.test.js
// ---------------------------------------------------------------
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', f), 'utf8');

const dom = new JSDOM(
  '<!DOCTYPE html><body>' +
  '<div id="project-list"></div>' +
  '<div id="pipeline-container"></div>' +
  '<div id="sh-hidden-wrap"><span id="sh-hidden-label"></span></div>' +
  '</body>',
  { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };

window.eval(read('state.js'));
window.eval(read('shootings.js'));
window.eval(read('demo.js'));

// Spiony: ubedimsya chto demo NE idet v oblako
var cloudCalls = 0;
window.shCloudSyncExplicit = function () { cloudCalls++; };
window.sbUploadProject = function () { cloudCalls++; };
window.shAutoSave = function () {};
// Stuby na funktsii iz drugih moduley (cards.js), kotorye renderProjects zovet v konce:
window.cpRenderList = function () {};
window.renderPipeline = window.renderPipeline || function () {};

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// ── 1. Builder ──
var demo = window.shBuildDemoProject();
ok('builder: brand set', demo.brand === 'Демо-витрина');
ok('builder: _demo true', demo._demo === true);
ok('builder: NET _cloudId (ne popadaet v oblako)', !('_cloudId' in demo) || !demo._cloudId);
ok('builder: _stage 0', demo._stage === 0);
ok('builder: 3 karty', Array.isArray(demo.cards) && demo.cards.length === 3);
ok('builder: 2 kategorii', demo.categories.length === 2);
ok('builder: channels pusto', Array.isArray(demo.channels) && demo.channels.length === 0);

var allSlots = [];
demo.cards.forEach(function (c) {
  ok('card ' + c.id + ': est id', !!c.id);
  ok('card ' + c.id + ': slots massiv', Array.isArray(c.slots) && c.slots.length > 0);
  c.slots.forEach(function (s) { allSlots.push(s); });
});
var filled = allSlots.filter(function (s) { return !!s.dataUrl; });
var empty = allSlots.filter(function (s) { return !s.dataUrl; });
ok('slots: est zapolnennye', filled.length >= 7);
ok('slots: zapolnennye imeyut data:image/svg+xml dataUrl',
   filled.every(function (s) { return /^data:image\/svg\+xml/.test(s.dataUrl); }));
ok('slots: zapolnennye imeyut file', filled.every(function (s) { return !!s.file; }));
ok('slots: est odin pustoi slot (bez dataUrl i file)',
   empty.length === 1 && !empty[0].file);
ok('slots: pustoi slot ne lomaet orient/weight',
   empty[0].orient === 'v' && typeof empty[0].weight === 'number');

// determinizm
var demo2 = window.shBuildDemoProject();
ok('builder: determinirovan (odinakovye brand/cards count)',
   demo2.brand === demo.brand && demo2.cards.length === demo.cards.length);

// ── 2. Placeholder ──
var ph = window.shDemoPlaceholder('Demo 01', 'v');
ok('placeholder: data URI', /^data:image\/svg\+xml;charset=utf-8,/.test(ph));
var svg = decodeURIComponent(ph.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
ok('placeholder: SVG soderzhit podpis (upper)', svg.indexOf('DEMO 01') !== -1);
ok('placeholder: vertikal 300x400', /width="300"/.test(svg) && /height="400"/.test(svg));
var phh = decodeURIComponent(window.shDemoPlaceholder('X', 'h').replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
ok('placeholder: gorizontal 400x300', /width="400"/.test(phh) && /height="300"/.test(phh));
ok('placeholder: bez emoji', !EMOJI.test(svg));

// ── 3. Empty-state action HTML ──
window._isShareLink = false;
var btn = window.shDemoEmptyActionHTML();
ok('action: knopka est vne share', /shLoadDemoProject\(\)/.test(btn) && btn.indexOf('es-actions') !== -1);
ok('action: bez emoji', !EMOJI.test(btn));
window._isShareLink = true;
ok('action: pusto dlya share-ssylki', window.shDemoEmptyActionHTML() === '');
window._isShareLink = false;

// ── 4. renderProjects pustoe sostoyanie soderzhit knopku ──
window.App.projects = [];
window.App.selectedProject = -1;
var threw = false;
try { window.renderProjects(); } catch (e) { threw = true; console.log('  renderProjects threw:', e.message); }
ok('render: pustoi spisok ne brosaet', !threw);
var listHtml = document.getElementById('project-list').innerHTML;
ok('render: v pustom sostoyanii est knopka demo', listHtml.indexOf('shLoadDemoProject()') !== -1);

// dlya share-ssylki knopki net
window._isShareLink = true;
window.renderProjects();
ok('render: dlya share knopki demo net', document.getElementById('project-list').innerHTML.indexOf('shLoadDemoProject()') === -1);
window._isShareLink = false;

// ── 5. Loader ──
window.App.projects = [];
window.App.selectedProject = -1;
cloudCalls = 0;
var threw2 = false;
try { window.shLoadDemoProject(); } catch (e) { threw2 = true; console.log('  loader threw:', e.message); }
ok('loader: ne brosaet', !threw2);
ok('loader: App.projects.length == 1', window.App.projects.length === 1);
ok('loader: vybran demo (selectedProject 0)', window.App.selectedProject === 0);
ok('loader: zagruzhennyi demo _demo:true', window.App.projects[0]._demo === true);
ok('loader: zagruzhennyi demo bez _cloudId', !window.App.projects[0]._cloudId);
ok('loader: oblako NE vyzvano (cloudCalls==0)', cloudCalls === 0);
var listHtml2 = document.getElementById('project-list').innerHTML;
ok('loader: spisok pokazyvaet brand demo', listHtml2.indexOf('Демо-витрина') !== -1);
ok('loader: spisok pokazyvaet teg demo', listHtml2.indexOf('project-demo-tag') !== -1);

// idempotentnost
window.shLoadDemoProject();
ok('loader: idempotenten (vse eshche 1 proekt)', window.App.projects.length === 1);
ok('loader: idempotenten (vybran 0)', window.App.selectedProject === 0);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
