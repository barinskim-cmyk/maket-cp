// ──────────────────────────────────────────────────────────────
//  photo-annotations.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + previews.js. Закрывает
//  задачу s3-05 «Аннотации (рисование на фото)»:
//    · обводка дефектов (эллипс/circle) и линии/стрелки (line) —
//      рисование поверх фото;
//    · хранение аннотаций как JSON в proj._annotations[photoName]
//      (id, shape, type, text, tags, author, created ISO, геометрия);
//    · типы аннотаций RT_ANNOTATION_TYPES (Удалить/Смягчить/Внимание)
//      с цветом и бордером;
//    · автор (team/client) + timestamp у каждой аннотации;
//    · автосохранение (shAutoSave) при добавлении;
//    · просмотр: rtRenderAnnotations строит SVG-слой .rt-annot-layer
//      поверх картинки — эллипсы .rt-circle и линии <path> в <svg>;
//    · в UI аннотаций нет emoji (требование Masha).
//
//  Тестируется НАСТОЯЩАЯ логика rtAddAnnotation / rtGetAnnotations /
//  rtRenderAnnotations. Коллабораторы сохранения (shAutoSave,
//  shCloudSyncExplicit) и активный проект застаблены ПОСЛЕ eval.
//
//  Запуск:  node tests/unit/photo-annotations.test.js
// ──────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'index.html'), 'utf8');
const pvSrc = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'previews.js'), 'utf8');

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

// ── Стабы коллабораторов (ПОСЛЕ eval) ──
let autoSaveCalls = 0;
let PROJECT = { brand: 'TEST', previews: [], otherContent: [], cards: [], _stage: 1 };
window.getActiveProject = function () { return PROJECT; };
window.shAutoSave = function () { autoSaveCalls++; };
window.shCloudSyncExplicit = function () {};

const PHOTO = 'IMG_0001.jpg';
const PHOTO2 = 'IMG_0002.jpg';

// ── Санити: аннотационный API существует ──
ok('RT_ANNOTATION_TYPES is an object', window.RT_ANNOTATION_TYPES && typeof window.RT_ANNOTATION_TYPES === 'object');
ok('types: remove/soften/attention present',
  !!window.RT_ANNOTATION_TYPES.remove && !!window.RT_ANNOTATION_TYPES.soften && !!window.RT_ANNOTATION_TYPES.attention);
ok('each type has label+color+border',
  ['remove', 'soften', 'attention'].every(function (k) {
    var t = window.RT_ANNOTATION_TYPES[k];
    return t && t.label && t.color && t.border;
  }));
ok('rtAddAnnotation is a function', typeof window.rtAddAnnotation === 'function');
ok('rtGetAnnotations is a function', typeof window.rtGetAnnotations === 'function');
ok('rtRenderAnnotations is a function', typeof window.rtRenderAnnotations === 'function');

// ── 1. Обводка дефекта (эллипс/circle) сохраняется как JSON ──
const circle = window.rtAddAnnotation(PHOTO, { x: 40, y: 55, r: 8, type: 'remove', text: 'убрать пятно', tags: ['кожа'], author: 'client' });
ok('circle: returns object with generated id', circle && typeof circle.id === 'string' && circle.id.indexOf('rt_') === 0);
ok('circle: shape = circle', circle.shape === 'circle');
ok('circle: hasCircle flag true', circle.hasCircle === true);
ok('circle: geometry x/y/rx/ry stored', circle.x === 40 && circle.y === 55 && circle.rx === 8 && circle.ry === 8);
ok('circle: type preserved', circle.type === 'remove');
ok('circle: text preserved', circle.text === 'убрать пятно');
ok('circle: tags preserved', Array.isArray(circle.tags) && circle.tags[0] === 'кожа');

// ── 2. Автор + timestamp ──
ok('circle: author respected (client)', circle.author === 'client');
ok('circle: created is valid ISO timestamp', typeof circle.created === 'string' && !isNaN(Date.parse(circle.created)));
const circleDefault = window.rtAddAnnotation(PHOTO, { x: 10, y: 10, r: 5 });
ok('default author = team', circleDefault.author === 'team');
ok('default type = attention', circleDefault.type === 'attention');

// ── 3. Линия/стрелка (line) сохраняется с точками ──
const line = window.rtAddAnnotation(PHOTO, { shape: 'line', points: [{ x: 5, y: 5 }, { x: 50, y: 60 }, { x: 80, y: 20 }], type: 'attention', text: 'провести по контуру' });
ok('line: shape = line', line.shape === 'line');
ok('line: points preserved (3 pts)', Array.isArray(line.points) && line.points.length === 3 && line.points[2].x === 80);
ok('line: type preserved', line.type === 'attention');

// ── 4. rtGetAnnotations возвращает сохранённое, изоляция по фото ──
const got = window.rtGetAnnotations(PHOTO);
ok('getAnnotations returns all 3 for photo', got.length === 3);
ok('getAnnotations isolated per photo (photo2 empty)', window.rtGetAnnotations(PHOTO2).length === 0);
window.rtAddAnnotation(PHOTO2, { x: 1, y: 1, r: 2, type: 'soften' });
ok('photo2 now has its own 1 annotation', window.rtGetAnnotations(PHOTO2).length === 1);
ok('photo1 unaffected (still 3)', window.rtGetAnnotations(PHOTO).length === 3);

// ── 5. Персистентность: добавление дёргает автосохранение (4 добавления выше) ──
ok('rtAddAnnotation triggers shAutoSave on each add (4 calls)', autoSaveCalls === 4);

// ── 6. Хранение в модели проекта (JSON-структура) ──
ok('annotations live in proj._annotations[photo]', Array.isArray(PROJECT._annotations[PHOTO]) && PROJECT._annotations[PHOTO].length === 3);
ok('commenting start recorded on project', typeof PROJECT._commentingStarted === 'string');

// ── 7. Просмотр: rtRenderAnnotations строит слой поверх фото ──
function buildImgWrap() {
  var wrap = document.createElement('div');
  wrap.className = 'cp-img-wrap';
  var img = document.createElement('img');
  img.src = 'data:image/png;base64,';
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  return wrap;
}
var wrap = buildImgWrap();
window.rtRenderAnnotations(PHOTO, wrap);
var layer = wrap.querySelector('.rt-annot-layer');
ok('render: .rt-annot-layer created in imgWrap', !!layer);
var circles = layer ? layer.querySelectorAll('.rt-circle') : [];
ok('render: two ellipses (.rt-circle) for circle annotations', circles.length === 2);
ok('render: ellipse carries data-annot-id', circles.length > 0 && !!circles[0].getAttribute('data-annot-id'));
var svg = layer ? layer.querySelector('svg') : null;
ok('render: svg layer present for line annotation', !!svg);
ok('render: svg has a <path> for the line', !!(svg && svg.querySelector('path')));
// Тип применяет цвет/бордер из RT_ANNOTATION_TYPES
var removeEllipse = null;
for (var ci = 0; ci < circles.length; ci++) {
  if (circles[ci].getAttribute('data-annot-id') === circle.id) { removeEllipse = circles[ci]; break; }
}
ok('render: remove-type ellipse gets type background color', !!removeEllipse && removeEllipse.style.background === 'rgba(220, 50, 50, 0.5)');
ok('render: remove-type ellipse has a border color set', !!removeEllipse && removeEllipse.style.borderColor !== '');
// Лейбл с текстом/типом показан для аннотации с текстом
ok('render: label shows type label + comment text',
  !!removeEllipse && !!removeEllipse.querySelector('.rt-annot-label') &&
  removeEllipse.querySelector('.rt-annot-label').textContent.indexOf('убрать пятно') !== -1);

// ── 8. Повторный рендер снимает старый слой (нет дублей) ──
window.rtRenderAnnotations(PHOTO, wrap);
ok('re-render: still exactly one .rt-annot-layer', wrap.querySelectorAll('.rt-annot-layer').length === 1);

// ── 9. Нет emoji в UI аннотаций (требование Masha) ──
var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
ok('annotation layer contains no emoji', !EMOJI.test(wrap.querySelector('.rt-annot-layer').textContent || ''));
ok('RT_ANNOTATION_TYPES labels contain no emoji',
  ['remove', 'soften', 'attention'].every(function (k) { return !EMOJI.test(window.RT_ANNOTATION_TYPES[k].label); }));

// ── Итог ──
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
