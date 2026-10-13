// ─────────────────────────────────────────────────────────────
//  stage-history.test.js
//
//  jsdom-харнесс на РЕАЛЬНЫХ state.js + shootings.js. Проверяет
//  «Журнал переходов (timestamps)» (задача 1.13):
//    · advanceStage() при опустошении этапа фиксирует время ухода в
//      proj._stageHistory[idx] и proj._stageDates[idx].lastLeave, а в
//      _stageDates[next].firstEnter — время входа на следующий этап;
//    · переход записывается batch-событием (_stageBatches) с trigger;
//    · proj._stage сдвигается на минимальный непустой этап;
//    · нелинейный переход через targetIdx перепрыгивает этапы;
//    · renderPipelineV2 РИСУЕТ дату на завершённом этапе (.ds-meta);
//    · guard'ы: последний этап / selectedProject<0 — no-op без throw;
//
//  shPhotosPerStage в бою — event-sourced (currentTaskOf по журналу
//  событий), поэтому, как и в stage-hint.test.js, картину этапов задаём
//  детерминированным стабом ПОСЛЕ eval — он отражает previews[i]._stage,
//  ту самую модель, на которой строится legacy-путь advanceStage.
//  Тестируются НАСТОЯЩИЕ advanceStage / shRecordBatchMove / shProjectFront
//  / renderPipelineV2 из shootings.js.
//
//  Запуск:  node tests/unit/stage-history.test.js
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

window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.prompt = function () { return ''; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };

window.eval(stateSrc);
window.eval(shSrc);

const PIPELINE_STAGES = window.PIPELINE_STAGES;
const NSTAGES = PIPELINE_STAGES.length;

// Детерминированная картина этапов: counts выводятся из previews[i]._stage.
window.shEnsurePhotoStages = function () {};
window.shPhotosPerStage = function (proj) {
  var counts = [];
  for (var i = 0; i < NSTAGES; i++) counts.push(0);
  if (proj && proj.previews) {
    for (var p = 0; p < proj.previews.length; p++) {
      var st = proj.previews[p]._stage;
      if (typeof st === 'number' && st >= 0 && st < NSTAGES) counts[st]++;
    }
  }
  return counts;
};
window.shCumulativeMetrics = function (proj, counts) {
  var cum = []; var run = 0;
  for (var i = 0; i < NSTAGES; i++) { run += counts[i]; cum.push(run); }
  return {
    cumulative: cum, potential: 10, teamStageIndex: 1, clientStageIndex: 2,
    passedPreselect: 8, passedTeam: 5, clientStageDone: false,
    selectedCount: 0, scale: 0
  };
};
window._shV2Forks = function () { return {}; };
window.shAutoSave = function () {};

const FIXED_ENTER = '2026-03-01T10:00:00.000Z';
const FIXED_ENTER_D = new Date(FIXED_ENTER).toLocaleDateString('ru-RU'); // 01.03.2026

function makeProj() {
  return {
    brand: 'BrandX', _stage: 0,
    previews: [
      { name: 'a.jpg', _stage: 0 },
      { name: 'b.jpg', _stage: 0 },
      { name: 'c.jpg', _stage: 0 }
    ],
    cards: [], articles: [], _annotations: {},
    _stageDates: { 0: { firstEnter: FIXED_ENTER } }, _stageHistory: {}
  };
}
function install(proj) {
  window.App.projects = [proj];
  window.App.selectedProject = 0;
  window.localStorage.clear();
}

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const TS_RE = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

// ── 1. advanceStage фиксирует журнал при опустошении этапа ──
var proj = makeProj();
install(proj);
window.advanceStage(0);

ok('all photos moved to next stage', proj.previews.every(function (p) { return p._stage === 1; }));
ok('_stageHistory[0] is a timestamp string', typeof proj._stageHistory[0] === 'string' && TS_RE.test(proj._stageHistory[0]));
ok('_stageDates[0].lastLeave is ISO', proj._stageDates[0] && ISO_RE.test(proj._stageDates[0].lastLeave));
ok('_stageDates[1].firstEnter is ISO', proj._stageDates[1] && ISO_RE.test(proj._stageDates[1].firstEnter));
ok('project front advanced to stage 1', proj._stage === 1);

// ── 2. Переход записан batch-событием с trigger ──
ok('_stageBatches has one batch', Array.isArray(proj._stageBatches) && proj._stageBatches.length === 1);
var b0 = (proj._stageBatches || [])[0] || {};
ok('batch trigger defaults to manual', b0.trigger === 'manual');
ok('batch from/to/count correct', b0.fromStage === 0 && b0.toStage === 1 && b0.count === 3);
ok('batch date is ISO', ISO_RE.test(b0.date || ''));

// ── 3. Второй переход 1->2 дописывает журнал ──
window.advanceStage(1);
ok('_stageHistory[1] recorded on second advance', typeof proj._stageHistory[1] === 'string' && TS_RE.test(proj._stageHistory[1]));
ok('project front advanced to stage 2', proj._stage === 2);
ok('two batches recorded', proj._stageBatches.length === 2);

// ── 4. UI: завершённый этап показывает дату в .ds-meta ──
window.renderPipelineV2();
var c = document.getElementById('pipeline-container');
var metas = Array.prototype.slice.call(c.querySelectorAll('.ds-meta'));
var hasDate = metas.some(function (m) { return m.textContent.indexOf(FIXED_ENTER_D) !== -1; });
ok('done-stage date rendered in .ds-meta', hasDate);

// ── 5. Нелинейный переход через targetIdx ──
var proj2 = makeProj();
install(proj2);
window.advanceStage(0, 3); // прыжок 0 -> 3
ok('non-linear jump moves photos to targetIdx', proj2.previews.every(function (p) { return p._stage === 3; }));
ok('non-linear batch toStage=3', (proj2._stageBatches || [])[0].toStage === 3);
ok('_stageDates[3].firstEnter set on jump', proj2._stageDates[3] && ISO_RE.test(proj2._stageDates[3].firstEnter));

// ── 6. Guard: последний этап — no-op ──
var proj3 = makeProj();
proj3.previews.forEach(function (p) { p._stage = NSTAGES - 1; });
proj3._stage = NSTAGES - 1;
install(proj3);
var threw = false;
try { window.advanceStage(NSTAGES - 1); } catch (e) { threw = true; }
ok('last-stage advance does not throw', !threw);
ok('last-stage advance records no batch', !proj3._stageBatches || proj3._stageBatches.length === 0);

// ── 7. Guard: нет выбранного проекта — no-op ──
window.App.projects = [];
window.App.selectedProject = -1;
var threw2 = false;
try { window.advanceStage(0); } catch (e) { threw2 = true; }
ok('no-project advance does not throw', !threw2);

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
