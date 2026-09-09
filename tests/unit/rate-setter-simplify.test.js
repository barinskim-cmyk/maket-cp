// ─────────────────────────────────────────────────────────────
//  rate-setter-simplify.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + sync.js. Проверяет
//  упрощённый UI Rate Setter (задача ux-ratesetter-simplify):
//    · по умолчанию виден только основной путь (список + Запустить);
//    · «Пробный запуск» — чекбокс, а не отдельная кнопка;
//    · режим ввода и суффиксы спрятаны в панель «Дополнительно»;
//    · одна primary-кнопка «Запустить»;
//    · runRateSetter() без аргумента читает чекбокс dry-run,
//      а явный аргумент (обратная совместимость) его переопределяет.
//
//  Контекст: до фикса на один запуск приходилось 6 интерактивных
//  элементов и две кнопки запуска. Теперь вторичные настройки
//  скрыты за expandable-панелью, dry-run — тоггл.
//
//  Запуск:  node tests/unit/rate-setter-simplify.test.js
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
window.getActiveProject = function () { return null; };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };

// Загружаем НАСТОЯЩИЙ sync.js в scope окна
window.eval(syncSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// 1. Дефолт: textarea видна, режим «Папка» скрыт, «Дополнительно» свёрнуто
const textMode = document.getElementById('rs-text-mode');
const folderMode = document.getElementById('rs-folder-mode');
const advBody = document.getElementById('rs-adv-body');
ok('text-mode visible by default', textMode && textMode.style.display !== 'none');
ok('folder-mode hidden by default', folderMode && folderMode.style.display === 'none');
ok('advanced collapsed by default', advBody && advBody.style.display === 'none');

// 2. Одна primary-кнопка запуска, нет отдельной кнопки «Пробный запуск»
const runBtns = Array.from(document.querySelectorAll('#page-sync .btn-primary'));
ok('exactly one primary run button', runBtns.length === 1 && runBtns[0].id === 'rs-run-btn');
const allSyncBtns = Array.from(document.querySelectorAll('#page-sync button'));
const dryBtn = allSyncBtns.find(function (b) {
  return /Пробный запуск/.test(b.textContent) && b.tagName === 'BUTTON' && b.className.indexOf('rs-adv') === -1;
});
ok('no standalone "Пробный запуск" button', !dryBtn);

// 3. Dry-run теперь чекбокс
const dryChk = document.getElementById('rs-dry-run');
ok('dry-run checkbox exists', !!dryChk && dryChk.type === 'checkbox');

// 4. Тоггл «Дополнительно» существует и раскрывает/сворачивает панель
ok('advanced toggle exists', !!document.getElementById('rs-adv-toggle'));
window.toggleRsAdvanced();
ok('toggleRsAdvanced opens panel', advBody.style.display !== 'none');
ok('aria-expanded true after open', document.getElementById('rs-adv-toggle').getAttribute('aria-expanded') === 'true');
window.toggleRsAdvanced();
ok('toggleRsAdvanced closes panel', advBody.style.display === 'none');

// 5. Радио-режимы живут внутри «Дополнительно»
const advBodyEl = document.getElementById('rs-adv-body');
ok('mode radios are inside advanced panel', advBodyEl.querySelectorAll('input[name="rs-mode"]').length === 2);

// 6. runRateSetter() без аргумента читает чекбокс -> payload.dry_run
let captured = null;
window.pywebview = { api: { rate_setter_run: function (p) { captured = p; return undefined; } } };
document.getElementById('rs-session-dir').value = '/tmp/session';
document.getElementById('rs-text').value = 'IMG_0001\nIMG_0002';

// чекбокс OFF -> не пробный запуск
dryChk.checked = false; captured = null;
window.runRateSetter();
ok('run with checkbox off -> no dry_run', captured && !captured.dry_run && captured.mode === 'text');

// чекбокс ON -> пробный запуск
dryChk.checked = true; captured = null;
window.runRateSetter();
ok('run with checkbox on -> dry_run true', captured && captured.dry_run === true);

// явный аргумент по-прежнему уважается (обратная совместимость)
captured = null;
window.runRateSetter(true);
ok('explicit runRateSetter(true) still dry', captured && captured.dry_run === true);
captured = null; dryChk.checked = true;
window.runRateSetter(false);
ok('explicit runRateSetter(false) overrides checkbox', captured && !captured.dry_run);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
