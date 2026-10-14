// ─────────────────────────────────────────────────────────────
//  rate-setter-autofill.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + sync.js. Закрывает
//  задачу s1-15 «Авто-сбор имён из карточек»: режим Rate Setter,
//  который собирает имена файлов из заполненных слотов карточек
//  + otherContent, снимает расширения (stems), заполняет список
//  и показывает количество.
//
//  Проверяемая механика (rsAutoFillFromProject / rsClearAutoFill):
//    · сбор имён из card.slots[].file + proj.otherContent[].name;
//    · дедупликация одинаковых имён (слот и доп.контент пересекаются);
//    · снятие расширений (.jpg/.cr3/.tiff/.png/.nef…) -> stems;
//    · заполнение textarea #rs-text построчно;
//    · переключение радио rs-mode в «text»;
//    · инфо-строка #rs-auto-info с источником и количеством;
//    · приоритет snGetActiveFiles() (снимок-контекст) над фолбэком;
//    · guard'ы: нет проекта / пустой проект — no-op;
//    · rsClearAutoFill() очищает список и прячет инфо.
//
//  Запуск:  node tests/unit/rate-setter-autofill.test.js
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

// Минимальные глобалы, которые ожидает sync.js
window.esc = function (s) { return String(s); };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
// Активный проект задаётся в каждой фазе
window.__proj = null;
window.getActiveProject = function () { return window.__proj; };
// Снимок-контекст НЕ активен в фолбэк-фазах (snGetActiveFiles остаётся undefined)

// Загружаем НАСТОЯЩИЙ sync.js в scope окна
window.eval(syncSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const textEl = document.getElementById('rs-text');
const infoEl = document.getElementById('rs-auto-info');
function radioText() { return document.querySelector('input[name="rs-mode"][value="text"]'); }
function resetUI() {
  textEl.value = '';
  infoEl.style.display = 'none';
  infoEl.textContent = '';
  var rf = document.querySelector('input[name="rs-mode"][value="folder"]');
  if (rf) rf.checked = true;
  if (radioText()) radioText().checked = false;
}

// Санити: элементы существуют в реальном index.html
ok('index.html has #rs-text', !!textEl);
ok('index.html has #rs-auto-info', !!infoEl);
ok('index.html has text-mode radio', !!radioText());
ok('rsAutoFillFromProject is defined', typeof window.rsAutoFillFromProject === 'function');
ok('rsClearAutoFill is defined', typeof window.rsClearAutoFill === 'function');

// ── Фаза A: нет активного проекта -> no-op ──────────────────
resetUI();
window.__proj = null;
window.rsAutoFillFromProject();
ok('A: no project -> textarea stays empty', textEl.value === '');
ok('A: no project -> info stays hidden', infoEl.style.display === 'none');

// ── Фаза B: пустой проект (нет слотов/доп.контента) -> no-op ─
resetUI();
window.__proj = { brand: 'EMPTY', cards: [{ slots: [{}, { file: null }] }], otherContent: [{ name: '' }] };
window.rsAutoFillFromProject();
ok('B: empty project -> no fill', textEl.value === '');
ok('B: empty project -> info hidden', infoEl.style.display === 'none');

// ── Фаза C: реальный проект, фолбэк-путь (snGetActiveFiles undefined) ─
resetUI();
window.__proj = {
  brand: 'EKONIKA',
  cards: [
    { slots: [{ file: 'IMG_0001.jpg' }, { file: 'IMG_0002.CR3' }, { file: null }, {} ] },
    { slots: [{ file: 'IMG_0002.CR3' }, { file: 'photo_A.tiff' }] } // IMG_0002 дубль
  ],
  otherContent: [
    { name: 'banner_wb.png' },
    { name: '' },
    { name: 'IMG_0001.jpg' } // дубль со слотом
  ]
};
window.rsAutoFillFromProject();
const lines = textEl.value.split('\n').filter(function (x) { return x !== ''; });
ok('C: collected 4 unique stems', lines.length === 4);
ok('C: dedup across slot+other (IMG_0001 once)',
  lines.filter(function (x) { return x === 'IMG_0001'; }).length === 1);
ok('C: dedup duplicate slot file (IMG_0002 once)',
  lines.filter(function (x) { return x === 'IMG_0002'; }).length === 1);
ok('C: extensions stripped (.jpg)', lines.indexOf('IMG_0001') !== -1 && lines.indexOf('IMG_0001.jpg') === -1);
ok('C: extensions stripped (.CR3)', lines.indexOf('IMG_0002') !== -1);
ok('C: extensions stripped (.tiff)', lines.indexOf('photo_A') !== -1);
ok('C: extensions stripped (.png)', lines.indexOf('banner_wb') !== -1);
ok('C: no residual extension anywhere', lines.every(function (x) { return !/\.(jpe?g|tiff?|png|cr[23w]|nef|arw|raf|dng)$/i.test(x); }));
ok('C: switched to text mode', radioText().checked === true);
ok('C: info visible', infoEl.style.display !== 'none');
ok('C: info shows count 4', /\b4\b/.test(infoEl.textContent));
ok('C: info shows project brand', infoEl.textContent.indexOf('EKONIKA') !== -1);
ok('C: info says "из проекта"', infoEl.textContent.indexOf('из проекта') !== -1);

// ── Фаза D: приоритет snGetActiveFiles() (снимок-контекст) ──
resetUI();
window.snGetActiveFiles = function () { return ['snap_1.jpg', 'snap_2.nef', 'snap_1.jpg']; };
window.snIsViewingSnapshot = function () { return true; };
window.__proj = { brand: 'EKONIKA', cards: [{ slots: [{ file: 'ignored.jpg' }] }], otherContent: [] };
window.rsAutoFillFromProject();
const dLines = textEl.value.split('\n').filter(function (x) { return x !== ''; });
ok('D: used snGetActiveFiles, not fallback', dLines.indexOf('ignored') === -1);
ok('D: snapshot stems present', dLines.indexOf('snap_1') !== -1 && dLines.indexOf('snap_2') !== -1);
ok('D: info says "из снимка"', infoEl.textContent.indexOf('из снимка') !== -1);
// снять снимок-контекст, чтобы не влиять дальше
delete window.snGetActiveFiles;
delete window.snIsViewingSnapshot;

// ── Фаза E: rsClearAutoFill() очищает и прячет инфо ─────────
textEl.value = 'IMG_0001\nIMG_0002';
infoEl.style.display = '';
infoEl.textContent = 'что-то';
window.rsClearAutoFill();
ok('E: clear empties textarea', textEl.value === '');
ok('E: clear hides info', infoEl.style.display === 'none');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
