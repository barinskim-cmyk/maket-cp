// ─────────────────────────────────────────────────────────────
//  stage-hint.test.js
//
//  jsdom-харнесс на РЕАЛЬНЫХ state.js + shootings.js. Проверяет
//  «Подсказки по этапам» (задача 1.14):
//    · каждый этап PIPELINE_STAGES имеет непустой hint без эмодзи;
//    · renderPipelineV2 рисует блок .cp-stage-hint ТОЛЬКО под активным
//      этапом (не под done / future), с текстом hint этого этапа;
//    · по умолчанию подсказка свёрнута (display:none, aria-expanded=false,
//      каретка ▸);
//    · при сохранённом в localStorage открытом состоянии — развёрнута
//      (нет display:none, aria-expanded=true, каретка ▾);
//    · shToggleStageHint переключает DOM (display + каретка + aria) и
//      персистит состояние в localStorage (открыть → закрыть);
//    · в разметке нет эмодзи (только геометрические каретки ▸/▾).
//
//  Тестируются НАСТОЯЩИЕ функции: state.js и shootings.js грузятся целиком
//  в jsdom; коллабораторы рендера (shPhotosPerStage / shCumulativeMetrics /
//  _shV2Forks / shEnsurePhotoStages) заменяются стабами ПОСЛЕ eval, чтобы
//  задать детерминированную картину этапов.
//
//  Запуск:  node tests/unit/stage-hint.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const stateSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'state.js'), 'utf8');
const shSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'shootings.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body><div id="pipeline-container"></div></body>', {
  runScripts: 'outside-only', url: 'http://localhost/'
});
const { window } = dom;
const { document } = window;

// Глобалы окружения
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.prompt = function () { return ''; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };

// Загружаем НАСТОЯЩИЕ state.js + shootings.js в scope окна
window.eval(stateSrc);
window.eval(shSrc);

const PIPELINE_STAGES = window.PIPELINE_STAGES;

// Детерминированная картина этапов: активен только 'selection' (индекс 1).
// photoCounts[0]=0 (есть кадры дальше → done), [1]=5 (active), остальные 0.
window.shEnsurePhotoStages = function () {};
window.shPhotosPerStage = function () { return [0, 5, 0, 0, 0, 0, 0, 0]; };
window.shCumulativeMetrics = function () {
  return {
    cumulative: [0, 5, 0, 0, 0, 0, 0, 0],
    potential: 10, teamStageIndex: 1, clientStageIndex: 2,
    passedPreselect: 8, passedTeam: 5, clientStageDone: false,
    selectedCount: 0, scale: 0
  };
};
window._shV2Forks = function () { return {}; };

function makeProj() {
  return {
    brand: 'BrandX', _stage: 1, previews: [1, 2, 3, 4, 5],
    cards: [], articles: [], _annotations: {}, _stageDates: {}, _stageHistory: {}
  };
}
function render(proj) {
  window.App.projects = [proj];
  window.App.selectedProject = 0;
  window.localStorage.clear();
  window.renderPipelineV2();
  return document.getElementById('pipeline-container');
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// Эмодзи-детектор (исключаем геометрические ▸ U+25B8 / ▾ U+25BE — это каретки, не эмодзи)
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

// ── 1. Данные PIPELINE_STAGES ──
let allHaveHint = true, hintNoEmoji = true;
PIPELINE_STAGES.forEach(function (s) {
  if (!s.hint || typeof s.hint !== 'string' || !s.hint.trim()) allHaveHint = false;
  if (s.hint && EMOJI_RE.test(s.hint)) hintNoEmoji = false;
});
ok('each stage has a non-empty hint', allHaveHint && PIPELINE_STAGES.length === 8);
ok('no emoji in hint texts', hintNoEmoji);

// ── 2. Рендер: подсказка под активным этапом ──
const c = render(makeProj());
const hints = c.querySelectorAll('.cp-stage-hint');
ok('exactly one hint block (only active stage)', hints.length === 1);

const selection = PIPELINE_STAGES[1];
const bodyText = c.querySelector('.cp-stage-hint-body') ? c.querySelector('.cp-stage-hint-body').textContent : '';
ok('hint body shows the active stage text', bodyText.indexOf(selection.hint.slice(0, 20)) !== -1);

// done-этап 'preselect' не должен иметь подсказки — проверяем, что текста preselect нет
ok('done stage hint NOT rendered', c.innerHTML.indexOf(PIPELINE_STAGES[0].hint.slice(0, 20)) === -1);

// ── 3. По умолчанию свёрнута ──
const toggle = c.querySelector('.cp-stage-hint-toggle');
const body = c.querySelector('.cp-stage-hint-body');
const caret = c.querySelector('.cp-hint-caret');
ok('collapsed by default: body display:none', body && body.style.display === 'none');
ok('collapsed by default: aria-expanded=false', toggle && toggle.getAttribute('aria-expanded') === 'false');
ok('collapsed by default: caret is ▸', caret && caret.textContent === '▸');

// ── 4. Открытое состояние из localStorage ──
window.App.projects = [makeProj()];
window.App.selectedProject = 0;
window.localStorage.clear();
window.localStorage.setItem('maketcp_stagehint_open', JSON.stringify({ selection: 1 }));
window.renderPipelineV2();
const c2 = document.getElementById('pipeline-container');
const body2 = c2.querySelector('.cp-stage-hint-body');
const toggle2 = c2.querySelector('.cp-stage-hint-toggle');
const caret2 = c2.querySelector('.cp-hint-caret');
ok('persisted-open: body visible', body2 && body2.style.display !== 'none');
ok('persisted-open: aria-expanded=true', toggle2 && toggle2.getAttribute('aria-expanded') === 'true');
ok('persisted-open: caret is ▾', caret2 && caret2.textContent === '▾');

// ── 5. shToggleStageHint: DOM + персист ──
render(makeProj()); // свежий свёрнутый рендер, localStorage очищен
const c3 = document.getElementById('pipeline-container');
const tg = c3.querySelector('.cp-stage-hint-toggle');
const bd = c3.querySelector('.cp-stage-hint-body');
const cr = c3.querySelector('.cp-hint-caret');

const opened = window.shToggleStageHint('selection', tg);
const store1 = JSON.parse(window.localStorage.getItem('maketcp_stagehint_open') || '{}');
ok('toggle returns true on open', opened === true);
ok('toggle opens body', bd.style.display === '');
ok('toggle sets caret ▾', cr.textContent === '▾');
ok('toggle sets aria true', tg.getAttribute('aria-expanded') === 'true');
ok('toggle persists open state', store1.selection === 1);

const closed = window.shToggleStageHint('selection', tg);
const store2 = JSON.parse(window.localStorage.getItem('maketcp_stagehint_open') || '{}');
ok('toggle returns false on close', closed === false);
ok('toggle closes body', bd.style.display === 'none');
ok('toggle sets caret ▸', cr.textContent === '▸');
ok('toggle removes persisted state', store2.selection === undefined);

// ── 6. Нет эмодзи в разметке подсказки ──
ok('no emoji in rendered hint markup', !EMOJI_RE.test(c.querySelector('.cp-stage-hint').innerHTML));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
