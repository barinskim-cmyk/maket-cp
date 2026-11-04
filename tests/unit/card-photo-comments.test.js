// ─────────────────────────────────────────────────────────────
//  card-photo-comments.test.js
//
//  jsdom-харнесс на РЕАЛЬНЫХ index.html + cards.js + previews.js.
//  Закрывает задачу s3-04 «Текстовые комментарии к карточке и фото»:
//  текстовые комментарии на ДВУХ уровнях — к карточке целиком и к
//  отдельному фото; автор + timestamp; видны всем ролям.
//
//  Проверяется НАСТОЯЩАЯ логика:
//    · карточка: cpAddComment / cpGetComments / cpRenderComments /
//      cpSaveNewComment / cpDeleteComment (модель card._comments,
//      автор + created, side-effect shAutoSave, рендер даты/кнопок);
//    · фото: _pvLbGetCardComments / _pvLbGetAllComments — агрегация
//      комментариев фото из карточки + контейнера + аннотаций с
//      источником, ролью автора (Клиент/Команда) и timestamp;
//    · rtRenderCmtList — вывод агрегированного списка в тулбар.
//  Коллабораторы побочных эффектов (cpRenderCard / cpRenderList /
//  cpSaveHistory / cpCrystallizeCard / shAutoSave) застаблены ПОСЛЕ
//  eval — по образцу card-category / oc-platform-tags.
//
//  Запуск:  node tests/unit/card-photo-comments.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const cardsSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'cards.js'), 'utf8');
const pvSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'previews.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

// ── Глобалы окружения ──
window.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.prompt = function () { return ''; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.getComputedStyle = window.getComputedStyle || function () { return {}; };
window.indexedDB = undefined;

// Активный проект готовим ДО eval
let PROJ = null;
window.App = { currentCardIdx: 0 };
window.getActiveProject = function () { return PROJ; };
window.UserTemplates = [];

// Загружаем НАСТОЯЩИЕ модули
window.eval(cardsSrc);
window.eval(pvSrc);

// ── Стабы побочных эффектов ПОСЛЕ eval ──
let saveCalls = 0;
window.shAutoSave = function () { saveCalls++; };
window.cpRenderCard = function () {};
window.cpRenderList = function () {};
window.cpSaveHistory = function () {};
window.cpCrystallizeCard = function () {};

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u;

function freshProj() {
  return {
    brand: 'TEST',
    cards: [
      { name: 'Карточка А', slots: [ { file: 'ph1.jpg' }, { file: 'ph2.jpg' } ], _comments: [] },
      { name: '', slots: [ { file: 'ph3.jpg' } ], _comments: [] }
    ],
    ocContainers: [
      { id: 'c1', name: 'Контейнер 1', items: [ { name: 'ph2.jpg' } ], _comments: [] }
    ],
    _annotations: {}
  };
}

// ─── 1. Санити: функции обоих уровней существуют ───
ok('cpAddComment есть', typeof window.cpAddComment === 'function');
ok('cpGetComments есть', typeof window.cpGetComments === 'function');
ok('cpRenderComments есть', typeof window.cpRenderComments === 'function');
ok('cpDeleteComment есть', typeof window.cpDeleteComment === 'function');
ok('_pvLbGetCardComments есть', typeof window._pvLbGetCardComments === 'function');
ok('_pvLbGetAllComments есть', typeof window._pvLbGetAllComments === 'function');

// ─── 2. Карточка: добавление комментария (автор + timestamp) ───
PROJ = freshProj();
saveCalls = 0;
window.cpAddComment(0, 'Нужен другой ракурс');
let cc = window.cpGetComments(0);
ok('карточка: комментарий добавлен', cc.length === 1);
ok('карточка: текст сохранён', cc[0].text === 'Нужен другой ракурс');
ok('карточка: автор по умолчанию team', cc[0].author === 'team');
ok('карточка: timestamp ISO в created', ISO_RE.test(cc[0].created || ''));
ok('карточка: у комментария есть id', !!cc[0].id);
ok('карточка: add вызывает shAutoSave', saveCalls === 1);

// ─── 3. Карточка: рендер (дата, кнопки, счётчик, экранирование, без эмодзи) ───
let h = window.cpRenderComments(0);
ok('рендер: счётчик (1)', h.indexOf('(1)') !== -1);
ok('рендер: кнопка + Комментарий', h.indexOf('+ Комментарий') !== -1);
ok('рендер: textarea ввода', h.indexOf('cp-comment-text-0') !== -1);
ok('рендер: кнопка удаления на комментарии', h.indexOf('cpDeleteComment(0,') !== -1);
ok('рендер: текст комментария показан', h.indexOf('Нужен другой ракурс') !== -1);
ok('рендер: без эмодзи в UI', !EMOJI.test(h));

// экранирование опасного текста
window.cpAddComment(0, '<b>x</b>&"');
let h2 = window.cpRenderComments(0);
ok('рендер: html-текст экранирован', h2.indexOf('&lt;b&gt;') !== -1 && h2.indexOf('<b>x</b>') === -1);

// ─── 4. Карточка: ввод через cpSaveNewComment (реальное поле) ───
PROJ = freshProj();
// cpRenderComments полагается на textarea #cp-comment-text-0 в DOM
document.body.innerHTML = window.cpRenderComments(0);
let ta = document.getElementById('cp-comment-text-0');
ok('ввод: textarea отрисована в DOM', !!ta);
ta.value = '  Из поля ввода  ';
window.cpSaveNewComment(0, { stopPropagation: function(){}, preventDefault: function(){} });
let cc2 = window.cpGetComments(0);
ok('ввод: cpSaveNewComment добавил (trim)', cc2.length === 1 && cc2[0].text === 'Из поля ввода');
// пустой ввод — no-op
document.body.innerHTML = window.cpRenderComments(0);
document.getElementById('cp-comment-text-0').value = '   ';
window.cpSaveNewComment(0, { stopPropagation: function(){}, preventDefault: function(){} });
ok('ввод: пустой текст не добавляется', window.cpGetComments(0).length === 1);

// ─── 5. Карточка: удаление по id ───
PROJ = freshProj();
window.cpAddComment(0, 'первый');
window.cpAddComment(0, 'второй');
let ids = window.cpGetComments(0).map(function(c){ return c.id; });
saveCalls = 0;
window.cpDeleteComment(0, ids[0]);
let left = window.cpGetComments(0);
ok('удаление: остался один', left.length === 1 && left[0].text === 'второй');
ok('удаление: вызывает shAutoSave', saveCalls === 1);

// ─── 6. Фото: _pvLbGetCardComments привязывает комментарии карточки к фото ───
PROJ = freshProj();
window.cpAddComment(0, 'коммент к карточке А');
ok('фото->карточка: по файлу слота возвращает комментарии карточки',
   (window._pvLbGetCardComments('ph1.jpg') || []).length === 1);
ok('фото->карточка: другой файл той же карточки — те же комментарии',
   (window._pvLbGetCardComments('ph2.jpg') || []).length === 1);
ok('фото->карточка: фото не в карточке -> null',
   window._pvLbGetCardComments('нет-такого.jpg') === null);

// ─── 7. Фото: _pvLbGetAllComments агрегирует карточку + контейнер + аннотацию ───
PROJ = freshProj();
// ph2.jpg есть И в слоте карточки А, И в контейнере 1
PROJ.cards[0]._comments.push({ id: 'a1', text: 'правка от команды', author: 'team', created: '2026-11-04T10:00:00.000Z' });
PROJ.ocContainers[0]._comments.push({ id: 'b1', text: 'правка от клиента', author: 'client', created: '2026-11-04T11:00:00.000Z' });
PROJ._annotations['ph2.jpg'] = [ { id: 'an1', type: 'attention', text: 'смотри тени', tags: ['тени'], created: '2026-11-04T12:00:00.000Z' } ];

let all = window._pvLbGetAllComments('ph2.jpg');
ok('фото-агрегация: три источника (карточка+контейнер+аннотация)', all.length === 3);

let fromCard = all.filter(function(c){ return c.source === 'Карточка А'; });
ok('фото-агрегация: источник карточки по имени', fromCard.length === 1);
ok('фото-агрегация: роль автора team -> Команда', fromCard[0].author === 'Команда');
ok('фото-агрегация: timestamp карточки проброшен', fromCard[0].created === '2026-11-04T10:00:00.000Z');

let fromCnt = all.filter(function(c){ return c.source === 'Контейнер 1'; });
ok('фото-агрегация: источник контейнера', fromCnt.length === 1);
ok('фото-агрегация: роль автора client -> Клиент', fromCnt[0].author === 'Клиент');

let fromAnn = all.filter(function(c){ return c.text === 'смотри тени'; });
ok('фото-агрегация: аннотация включена', fromAnn.length === 1);
ok('фото-агрегация: источник аннотации = тег', fromAnn[0].source === 'тени');

// фото без комментариев/контейнера/аннотаций — пустой агрегат
ok('фото-агрегация: ph3 без комментариев -> []', window._pvLbGetAllComments('ph3.jpg').length === 0);

// безымянная карточка (cards[1]) -> дефолтная подпись "Карточка 2"
PROJ.cards[1]._comments.push({ id: 'd1', text: 'без имени', author: 'team', created: '2026-11-04T09:00:00.000Z' });
let all3 = window._pvLbGetAllComments('ph3.jpg');
ok('фото-агрегация: безымянная карточка -> "Карточка 2"',
   all3.length === 1 && all3[0].source === 'Карточка 2');

// ─── 8. rtRenderCmtList — вывод списка в тулбар (источник+автор+текст, без эмодзи) ───
PROJ = freshProj();
PROJ.cards[0]._comments.push({ id: 'a1', text: 'правка от клиента', author: 'client', created: '2026-11-04T10:00:00.000Z' });
let listEl = document.getElementById('rt-cmt-list') || (function(){
  var el = document.createElement('div'); el.id = 'rt-cmt-list'; document.body.appendChild(el); return el;
})();
window.rtRenderCmtList('ph1.jpg', null);
ok('rtRenderCmtList: текст комментария выведен', listEl.innerHTML.indexOf('правка от клиента') !== -1);
ok('rtRenderCmtList: источник (Карточка А) выведен', listEl.innerHTML.indexOf('Карточка А') !== -1);
ok('rtRenderCmtList: роль (Клиент) выведена', listEl.innerHTML.indexOf('Клиент') !== -1);
ok('rtRenderCmtList: без эмодзи', !EMOJI.test(listEl.innerHTML));
// нет комментариев -> пустой список
PROJ = freshProj();
window.rtRenderCmtList('ph1.jpg', null);
ok('rtRenderCmtList: без комментариев -> пусто', listEl.innerHTML === '');

// ─── Итог ───
console.log('\n' + pass + '/' + (pass + fail) + ' PASS');
if (fail > 0) { process.exitCode = 1; }
