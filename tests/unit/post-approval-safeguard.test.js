// ─────────────────────────────────────────────────────────────
//  post-approval-safeguard.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ v2/frontend/js/post-approval-safeguard.js.
//  Регрессионная сетка для backup-guardّа, который защищает согласованный
//  клиентом отбор от случайной перезаписи (страховочная сетка Маши).
//
//  Покрывает:
//   · детекция «отбор согласован» — через event-log (selectionApproved),
//     через _stageHistory['client_approved'], через _stageHistory[2],
//     через _stage > CLIENT_STAGE_IDX, и отрицательные случаи;
//   · режим «Просто посмотреть» (view): forward+reverse sync становятся
//     no-op — approved-отбор НЕ уходит в облако и НЕ откатывается
//     (ядро защиты от потери правок);
//   · режим «Изменить отбор» (edit): sync работает как обычно
//     (passthrough к оригиналам);
//   · неодобренный проект — гейта нет, всё проходит насквозь;
//   · модалка-гейт открывается при approved + intent=null и откладывает
//     действие; выбор view/edit пишется в sessionStorage;
//   · детекция pending-изменений по фингерпринту (fallback-хеш);
//   · кнопка «Сохранить изменения после отбора» (Mode B) появляется при
//     pending и исчезает без него; без эмодзи в UI;
//   · paResetIntent чистит intent+snapshot.
//
//  Запуск:  node tests/unit/post-approval-safeguard.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const paSrc = fs.readFileSync(
  path.join(ROOT, 'v2', 'frontend', 'js', 'post-approval-safeguard.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const INTENT_KEY = 'maketcp_post_approval_intent';
const SNAP_KEY   = 'maketcp_pa_approved_snapshot';

// Общий сетап: стабы ПЕРЕД eval, чтобы модуль обернул их при _paInit.
function setup(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><body></body>',
    { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
  w.getComputedStyle = w.getComputedStyle || function () { return {}; };
  const calls = { sync: 0, pull: 0, autopull: 0, stopAutopull: 0, log: 0, stage: 0,
                  upload: 0, uploadCbArgs: null, pullCbArg: undefined };
  w.__proj = null;                       // активный проект (управляем из теста)
  w.getActiveProject = function () { return w.__proj; };
  if (opts.selectionApproved) w.selectionApproved = opts.selectionApproved;
  w.shCloudSyncExplicit = function () { calls.sync++; return 'SYNCED'; };
  w.sbPullProject = function (cb) { calls.pull++; if (typeof cb === 'function') cb(null); };
  w.sbStartAutoPull = function () { calls.autopull++; };
  w.sbStopAutoPull = function () { calls.stopAutopull++; };
  w.sbLogAction = function () { calls.log++; };
  w.sbSyncStage = function () { calls.stage++; };
  w.sbUploadProject = function (idx, cb) { calls.upload++; if (typeof cb === 'function') { calls.uploadCbArgs = Array.prototype.slice.call(arguments, 1); cb(null, { ok: 1 }); } };
  if (opts.fingerprint) w._sbProjectFingerprint = opts.fingerprint;
  w.eval(paSrc);
  // Модуль вешает _paInit (установку wrapper'ов) на DOMContentLoaded.
  // Под jsdom это событие к моменту eval ещё не наступило — дёрнем явно.
  try { w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: false })); } catch (e) {}
  return { dom, w, calls };
}

function approvedProjHistory() {
  return { _cloudId: 'c1', _stage: 0, _stageHistory: { client_approved: true },
           cards: [{ id: 'a', slots: [{ file: '1.jpg' }] }] };
}

// ── 1. Санити: публичный API установлен ──
{
  const { w } = setup();
  ok('paGetIntent is function', typeof w.paGetIntent === 'function');
  ok('paIsApproved is function', typeof w.paIsApproved === 'function');
  ok('paHasPendingChanges is function', typeof w.paHasPendingChanges === 'function');
  ok('paUpdateSaveButton is function', typeof w.paUpdateSaveButton === 'function');
  ok('paOpenModal is function', typeof w.paOpenModal === 'function');
  ok('intent cleared on load', w.paGetIntent() === null);
}

// ── 2. Детекция «отбор согласован» ──
{
  const { w } = setup();
  w.__proj = { _stage: 0, _stageHistory: { client_approved: true }, cards: [] };
  ok('approved via _stageHistory[client_approved]', w.paIsApproved() === true);

  w.__proj = { _stage: 0, _stageHistory: { 2: true }, cards: [] };
  ok('approved via _stageHistory[CLIENT_STAGE_IDX=2]', w.paIsApproved() === true);

  w.__proj = { _stage: 3, _stageHistory: {}, cards: [] };
  ok('approved via _stage > 2', w.paIsApproved() === true);

  w.__proj = { _stage: 0, _stageHistory: {}, cards: [] };
  ok('NOT approved: fresh project', w.paIsApproved() === false);

  w.__proj = null;
  ok('NOT approved: no active project', w.paIsApproved() === false);
}

// ── 2b. Детекция через event-log (selectionApproved) ──
{
  const { w } = setup({ selectionApproved: function (p) { return !!(p && p.__ev); } });
  w.__proj = { _stage: 0, _stageHistory: {}, cards: [], __ev: true };
  ok('approved via selectionApproved() event-log', w.paIsApproved() === true);
  w.__proj = { _stage: 0, _stageHistory: {}, cards: [], __ev: false };
  ok('selectionApproved false -> falls through to not-approved', w.paIsApproved() === false);
}

// ── 3. Режим VIEW: sync-функции становятся no-op (ядро защиты) ──
{
  const { w, calls } = setup();
  w.__proj = approvedProjHistory();
  w.sessionStorage.setItem(INTENT_KEY, 'view');

  w.shCloudSyncExplicit();
  ok('VIEW: shCloudSyncExplicit no-op (forward sync suppressed)', calls.sync === 0);

  let pullCbMsg = 'NOT_CALLED';
  w.sbPullProject(function (m) { pullCbMsg = m; });
  ok('VIEW: sbPullProject skipped (reverse sync suppressed)', calls.pull === 0);
  ok('VIEW: sbPullProject callback got skip-reason', typeof pullCbMsg === 'string' && pullCbMsg.indexOf('view-mode') !== -1);

  let upCb = 'NOT_CALLED';
  w.sbUploadProject(0, function (a, b) { upCb = [a, b]; });
  ok('VIEW: sbUploadProject no-op (upload suppressed)', calls.upload === 0);
  ok('VIEW: sbUploadProject callback invoked with (null,null)', Array.isArray(upCb) && upCb[0] === null && upCb[1] === null);

  w.sbLogAction();
  ok('VIEW: sbLogAction no-op', calls.log === 0);
  w.sbSyncStage();
  ok('VIEW: sbSyncStage no-op', calls.stage === 0);
  w.sbStartAutoPull();
  ok('VIEW: sbStartAutoPull no-op', calls.autopull === 0);
}

// ── 4. Режим EDIT: passthrough к оригиналам ──
{
  const { w, calls } = setup();
  w.__proj = approvedProjHistory();
  w.sessionStorage.setItem(INTENT_KEY, 'edit');

  const r = w.shCloudSyncExplicit();
  ok('EDIT: shCloudSyncExplicit passthrough (called)', calls.sync === 1);
  ok('EDIT: shCloudSyncExplicit returns original result', r === 'SYNCED');

  w.sbPullProject(function () {});
  ok('EDIT: sbPullProject passthrough', calls.pull === 1);

  w.sbUploadProject(0, function () {});
  ok('EDIT: sbUploadProject passthrough', calls.upload === 1);
}

// ── 5. Неодобренный проект: гейта нет, всё проходит ──
{
  const { w, calls } = setup();
  w.__proj = { _stage: 0, _stageHistory: {}, cards: [] };   // не approved
  w.sessionStorage.setItem(INTENT_KEY, 'view');             // даже при view

  w.shCloudSyncExplicit();
  ok('NOT-approved: shCloudSyncExplicit passes through despite view', calls.sync === 1);
  w.sbPullProject(function () {});
  ok('NOT-approved: sbPullProject passes through', calls.pull === 1);
}

// ── 6. Модалка-гейт: approved + intent=null -> открыть и отложить ──
{
  const { w, calls } = setup();
  w.__proj = approvedProjHistory();
  ok('precondition: intent null', w.paGetIntent() === null);

  w.shCloudSyncExplicit();                 // должно открыть модалку, не синкать
  const modal = w.document.getElementById('modal-post-approval-intent');
  ok('gate: modal created', !!modal);
  ok('gate: modal is open', !!modal && modal.classList.contains('open'));
  ok('gate: sync deferred (not called)', calls.sync === 0);

  // Клик «Просто посмотреть»
  w.document.getElementById('pa-modal-view').click();
  ok('gate: view-click sets intent=view', w.paGetIntent() === 'view');
  ok('gate: modal closed after choice', !modal.classList.contains('open'));
}

// ── 7. Выбор EDIT -> snapshot + pending-детекция + кнопка сохранения ──
{
  const { w } = setup();          // fallback fingerprint (без _sbProjectFingerprint)
  w.__proj = approvedProjHistory();
  // клиентская панель действий в DOM (куда вешается кнопка)
  w.document.body.insertAdjacentHTML('beforeend',
    '<div id="client-action-bar"><div class="client-bar-buttons"></div></div>');

  w.paOpenModal();
  w.document.getElementById('pa-modal-edit').click();
  ok('EDIT-choice: intent=edit', w.paGetIntent() === 'edit');
  ok('EDIT-choice: snapshot captured in sessionStorage', typeof w.sessionStorage.getItem(SNAP_KEY) === 'string');
  ok('EDIT-choice: no pending right after snapshot', w.paHasPendingChanges() === false);

  // Мутация проекта -> фингерпринт меняется -> pending
  w.__proj.cards.push({ id: 'b', slots: [{ file: '2.jpg' }] });
  ok('pending=true after card mutation', w.paHasPendingChanges() === true);

  w.paUpdateSaveButton();
  const btn = w.document.getElementById('pa-save-changes-btn');
  ok('save-button appears when pending (Mode B)', !!btn);
  ok('save-button attached inside client-action-bar',
     !!btn && !!btn.closest('#client-action-bar'));

  // Нет эмодзи/иконок в UI (правило Маши)
  const modalHtml = w.document.getElementById('modal-post-approval-intent').innerHTML;
  const btnText = btn ? btn.textContent : '';
  const EMOJI = /[←-⇿⌀-➿⬀-⯿☀-⛿✀-➿️\u{1F000}-\u{1FAFF}]/u;
  ok('no emoji in modal UI', !EMOJI.test(modalHtml));
  ok('no emoji in save-button text', !EMOJI.test(btnText));

  // Откат мутации -> pending исчезает -> кнопка убирается
  w.__proj.cards.pop();
  ok('pending=false after revert', w.paHasPendingChanges() === false);
  w.paUpdateSaveButton();
  ok('save-button removed when no pending', !w.document.getElementById('pa-save-changes-btn'));

  // paResetIntent чистит intent + snapshot
  w.paResetIntent();
  ok('paResetIntent clears intent', w.paGetIntent() === null);
  ok('paResetIntent clears snapshot', w.sessionStorage.getItem(SNAP_KEY) === null);
}

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
