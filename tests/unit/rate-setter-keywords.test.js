// ─────────────────────────────────────────────────────────────
//  rate-setter-keywords.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + sync.js. Закрывает
//  фронт-часть задачи s1-16 «Запись ключевых слов в COS»: сбор
//  списка ключевых слов (MaketCP + тип card/extra + площадки из
//  proj.channels), тоггл блока и включение keywords в payload.
//
//  Проверяемая механика:
//    · элементы UI существуют в реальном index.html;
//    · rsBuildKeywords(): всегда MaketCP + категория + channels;
//    · дедупликация; поддержка channels как строк и {name};
//    · категория extra переключает второй тег;
//    · rsToggleKeywords(): показывает/прячет блок + превью;
//    · при выключенном тоггле payload.keywords НЕ добавляется;
//      при включённом — добавляется (перехват pywebview.api).
//
//  Запуск:  NODE_PATH=<repo>/node_modules node tests/unit/rate-setter-keywords.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const syncSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'sync.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

window.esc = function (s) { return String(s); };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.__proj = null;
window.getActiveProject = function () { return window.__proj; };

window.eval(syncSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }
function arrEq(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }

function setCat(v) {
  const el = document.querySelector('input[name="rs-kw-cat"][value="' + v + '"]');
  if (el) el.checked = true;
}

// ── Санити ──────────────────────────────────────────────────
ok('index.html has #rs-kw-enabled', !!document.getElementById('rs-kw-enabled'));
ok('index.html has #rs-kw-body', !!document.getElementById('rs-kw-body'));
ok('index.html has #rs-kw-preview', !!document.getElementById('rs-kw-preview'));
ok('index.html has card/extra radios', !!document.querySelector('input[name="rs-kw-cat"][value="card"]') && !!document.querySelector('input[name="rs-kw-cat"][value="extra"]'));
ok('rsBuildKeywords defined', typeof window.rsBuildKeywords === 'function');
ok('rsToggleKeywords defined', typeof window.rsToggleKeywords === 'function');

// ── rsBuildKeywords: нет проекта -> MaketCP + card ──────────
window.__proj = null;
setCat('card');
ok('no project -> [MaketCP, card]', arrEq(window.rsBuildKeywords(), ['MaketCP', 'card']));

// ── channels как строки + дедуп ─────────────────────────────
window.__proj = { brand: 'EKONIKA', channels: ['WB', 'Ozon', 'WB', 'Lamoda'] };
setCat('card');
ok('channels(str) dedup + prefix', arrEq(window.rsBuildKeywords(), ['MaketCP', 'card', 'WB', 'Ozon', 'Lamoda']));

// ── категория extra ─────────────────────────────────────────
setCat('extra');
ok('category extra', arrEq(window.rsBuildKeywords(), ['MaketCP', 'extra', 'WB', 'Ozon', 'Lamoda']));

// ── channels как объекты {name} ─────────────────────────────
window.__proj = { channels: [{ name: 'сайт' }, { name: 'соцсети' }] };
setCat('card');
ok('channels({name})', arrEq(window.rsBuildKeywords(), ['MaketCP', 'card', 'сайт', 'соцсети']));

// ── пустые channels ─────────────────────────────────────────
window.__proj = { channels: [] };
setCat('card');
ok('empty channels -> [MaketCP, card]', arrEq(window.rsBuildKeywords(), ['MaketCP', 'card']));

// ── rsToggleKeywords: показ/скрытие + превью ────────────────
const kwEnabled = document.getElementById('rs-kw-enabled');
const kwBody = document.getElementById('rs-kw-body');
const kwPrev = document.getElementById('rs-kw-preview');
kwEnabled.checked = false;
window.rsToggleKeywords();
ok('toggle off hides body', kwBody.style.display === 'none');
ok('toggle off clears preview', kwPrev.textContent === '');
window.__proj = { channels: ['WB'] };
setCat('card');
kwEnabled.checked = true;
window.rsToggleKeywords();
ok('toggle on shows body', kwBody.style.display !== 'none');
ok('toggle on preview lists keywords', kwPrev.textContent.indexOf('MaketCP') >= 0 && kwPrev.textContent.indexOf('WB') >= 0);

// ── payload: keywords только при включённом тоггле ──────────
// Подготовить обязательные поля формы + перехватить pywebview API.
document.getElementById('rs-session-dir').value = '/tmp/session';
const textRadio = document.querySelector('input[name="rs-mode"][value="text"]');
if (textRadio) textRadio.checked = true;
document.getElementById('rs-text').value = 'IMG_0001\nIMG_0002';
document.getElementById('rs-dry-run').checked = false;

let captured = null;
window.pywebview = { api: { rate_setter_run: function (p) { captured = p; return { then: undefined }; } } };

window.__proj = { channels: ['WB', 'Ozon'] };
setCat('card');

// Тоггл выключен -> keywords НЕ в payload
document.getElementById('rs-kw-enabled').checked = false;
captured = null;
window.runRateSetter(false);
ok('toggle off -> no payload.keywords', captured && !('keywords' in captured));

// Тоггл включён -> keywords в payload
document.getElementById('rs-kw-enabled').checked = true;
captured = null;
window.runRateSetter(false);
ok('toggle on -> payload.keywords set', captured && arrEq(captured.keywords, ['MaketCP', 'card', 'WB', 'Ozon']));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
