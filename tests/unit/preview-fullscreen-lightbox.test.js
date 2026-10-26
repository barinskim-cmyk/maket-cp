// ──────────────────────────────────────────────────────────────
//  preview-fullscreen-lightbox.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + previews.js. Закрывает
//  задачу s2-03 «Полноэкранный просмотр фото»:
//    · клик на миниатюру → полноэкранный лайтбокс (#pv-lightbox);
//    · навигация стрелками (prev/next) с цикличностью (wrap-around);
//    · навигация клавишами (ArrowRight/Left/Up/Down), Escape = закрыть;
//    · счётчик «N / M — имя» и имя текущего фото;
//    · индекс резолвится по имени кликнутой миниатюры и по
//      отфильтрованному списку галереи (gallery._pvStore);
//    · на desktop (pywebview) оригинал догружается через get_full_image;
//    · pvCloseFullscreen снимает overlay и keydown-обработчик;
//    · в UI лайтбокса нет emoji (требование Masha).
//
//  Тестируется НАСТОЯЩАЯ логика pvShowFullscreen / _pvLbOpenDesktop /
//  _pvLbNav / _pvLbKeyHandler / pvCloseFullscreen. Коллабораторы
//  аннотаций и рендера превью застаблены ПОСЛЕ eval, чтобы изолировать
//  каркас лайтбокса и навигацию.
//
//  Запуск:  node tests/unit/preview-fullscreen-lightbox.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const pvSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'previews.js'), 'utf8');

// jsdom по умолчанию 1024px — desktop-ветка лайтбокса (>=768)
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

// Глобалы окружения, которых ждёт previews.js
window.esc = function (s) { return String(s == null ? '' : s); };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.indexedDB = undefined;

// Загружаем НАСТОЯЩИЙ previews.js в scope окна
window.eval(pvSrc);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

// ── Тестовый проект ──
const PREVIEWS = [
  { name: 'IMG_0001.jpg', path: '/src/IMG_0001.jpg', rating: 5 },
  { name: 'IMG_0002.jpg', path: '/src/IMG_0002.jpg', rating: 0 },
  { name: 'IMG_0003.jpg', path: '/src/IMG_0003.jpg', rating: 3 }
];
let PROJECT = { brand: 'TEST', previews: PREVIEWS, otherContent: [], cards: [] };

// ── Стабы коллабораторов (изолируем каркас лайтбокса) ──
window.getActiveProject = function () { return PROJECT; };
window.pvGetPreview = function (pv) { return 'data:preview/' + (pv ? pv.name : ''); };
// Рендер-хелперы, которые дёргаются при открытии — не тестируем их тут
window._pvLbBuildCheck = function () { var d = document.createElement('div'); d.className = 'pv-lb-check'; return d; };
window.rtRenderCmtList = function () {};
window.rtRenderAnnotations = function () {};

function lb() { return document.getElementById('pv-lightbox'); }
function nameText() { var el = lb() && lb().querySelector('.cp-fullscreen-name'); return el ? el.textContent : ''; }
function imgSrc() { var el = lb() && lb().querySelector('.cp-fullscreen-img'); return el ? el.getAttribute('src') : ''; }

// ── Санити: функции лайтбокса существуют ──
ok('pvShowFullscreen is a function', typeof window.pvShowFullscreen === 'function');
ok('pvCloseFullscreen is a function', typeof window.pvCloseFullscreen === 'function');
ok('_pvLbNav is a function', typeof window._pvLbNav === 'function');
ok('_pvLbKeyHandler is a function', typeof window._pvLbKeyHandler === 'function');

// ── 1. Открытие по индексу: строится overlay с нужными частями ──
window.pvShowFullscreen(0);
ok('overlay #pv-lightbox created', !!lb());
ok('overlay has .cp-fullscreen-img', !!(lb() && lb().querySelector('.cp-fullscreen-img')));
ok('overlay has close button', !!(lb() && lb().querySelector('.cp-fullscreen-close')));
ok('overlay has prev arrow', !!(lb() && lb().querySelector('.pv-lb-prev')));
ok('overlay has next arrow', !!(lb() && lb().querySelector('.pv-lb-next')));
ok('img src = preview of photo 0', imgSrc() === 'data:preview/IMG_0001.jpg');
ok('counter shows 1 / 3 and name', nameText().indexOf('1 / 3') === 0 && nameText().indexOf('IMG_0001.jpg') !== -1);

// ── 2. Навигация стрелкой вперёд (next) ──
window._pvLbNav(1);
ok('nav(+1) -> photo 2, counter 2 / 3', nameText().indexOf('2 / 3') === 0 && nameText().indexOf('IMG_0002.jpg') !== -1);
ok('nav(+1) -> img src updated', imgSrc() === 'data:preview/IMG_0002.jpg');

// ── 3. Цикличность: с последнего -> на первый ──
window._pvLbNav(1); // -> 3 / 3
ok('nav(+1) -> photo 3, counter 3 / 3', nameText().indexOf('3 / 3') === 0);
window._pvLbNav(1); // wrap -> 1 / 3
ok('nav(+1) wraps last->first', nameText().indexOf('1 / 3') === 0 && nameText().indexOf('IMG_0001.jpg') !== -1);

// ── 4. Назад с первого -> на последний (wrap) ──
window._pvLbNav(-1);
ok('nav(-1) wraps first->last', nameText().indexOf('3 / 3') === 0 && nameText().indexOf('IMG_0003.jpg') !== -1);

// ── 5. Клавиатура: стрелки навигируют, Escape закрывает ──
window._pvLbKeyHandler({ key: 'ArrowRight' }); // 3 -> wrap 1
ok('key ArrowRight navigates (wrap to 1/3)', nameText().indexOf('1 / 3') === 0);
window._pvLbKeyHandler({ key: 'ArrowLeft' }); // 1 -> wrap 3
ok('key ArrowLeft navigates (wrap to 3/3)', nameText().indexOf('3 / 3') === 0);
window._pvLbKeyHandler({ key: 'ArrowDown' }); // 3 -> wrap 1 (Down == next)
ok('key ArrowDown == next', nameText().indexOf('1 / 3') === 0);
window._pvLbKeyHandler({ key: 'Escape' });
ok('key Escape closes lightbox', !lb());

// ── 6. Резолв индекса по имени кликнутой миниатюры + списку галереи ──
// Строим галерею с отфильтрованным _pvStore (напр. только rating>0): 2 фото
var gallery = document.createElement('div');
gallery.className = 'pv-gallery';
gallery._pvStore = [PREVIEWS[0], PREVIEWS[2]]; // IMG_0001, IMG_0003
var thumb = document.createElement('div');
thumb.className = 'pv-thumb';
thumb.setAttribute('data-pv-name', 'IMG_0003.jpg');
gallery.appendChild(thumb);
document.body.appendChild(gallery);
var fakeEvt = { stopPropagation: function () {}, target: thumb };
window.pvShowFullscreen(999, fakeEvt); // pvIdx мусорный — должен победить резолв по имени
ok('index resolved by clicked thumb name', nameText().indexOf('IMG_0003.jpg') !== -1);
ok('list = filtered gallery._pvStore (M=2)', nameText().indexOf('2 / 2') === 0);
window.pvCloseFullscreen();
ok('pvCloseFullscreen removes overlay', !lb());

// ── 7. Нет emoji в UI лайтбокса (требование Masha) ──
window.pvShowFullscreen(0);
var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
ok('lightbox UI contains no emoji', !EMOJI.test(lb().textContent || ''));
window.pvCloseFullscreen();

// ── 8. Desktop: оригинал догружается через get_full_image ──
(async function () {
  var fullCalledWith = null;
  window.pywebview = {
    api: {
      get_full_image: function (p) {
        fullCalledWith = p;
        return Promise.resolve({ data_url: 'data:FULL/' + p });
      }
    }
  };
  window.pvShowFullscreen(1); // IMG_0002, path '/src/IMG_0002.jpg'
  ok('desktop: get_full_image called with pv.path', fullCalledWith === '/src/IMG_0002.jpg');
  // дождаться микротаска промиса и подмены src
  await Promise.resolve();
  await Promise.resolve();
  ok('desktop: img src replaced with full_image data_url', imgSrc() === 'data:FULL//src/IMG_0002.jpg');
  window.pvCloseFullscreen();
  delete window.pywebview;

  // ── Итог ──
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
