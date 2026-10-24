// ─────────────────────────────────────────────────────────────
//  oc-platform-tags.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ index.html + previews.js. Проверяет
//  задачу s1-17 «Теги площадок публикации»: кликабельные теги
//  площадок на каждом фото в доп. отборе (панель «Другое»),
//  множественный выбор и фильтрацию.
//
//  Проверяется НАСТОЯЩАЯ логика (pvChannelTags / pvOcTagsHTML /
//  pvOcToggleTag / pvOcItemPassesFilter / pvOcRenderTagFilter /
//  pvOcToggleFilter) + её влияние на реальный ocRenderField.
//  Коллабораторы, зависящие от окружения (drop-bind, masonry,
//  комментарии контейнера), застаблены ПОСЛЕ eval.
//
//  Запуск:  node tests/unit/oc-platform-tags.test.js
// ─────────────────────────────────────────────────────────────
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

window.esc = function (s) { return String(s == null ? '' : s); };
window.alert = function (m) { window.__lastAlert = m; };
window.confirm = function () { return true; };
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.indexedDB = undefined;

window.eval(pvSrc);

// ── Стабы коллабораторов (изолируем логику тегов) ──
window.ocInitField = function () {};
window.ocApplyMasonryLayout = function () {};
window.ocRenderContainerComments = function () { return ''; };
window.pvShortName = function (n) { return String(n || ''); };
window.pvGetPreview = function () { return ''; };

let saveCalls = 0;
window.shAutoSave = function () { saveCalls++; };

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

function freshProj() {
  return {
    brand: 'TEST',
    channels: ['WB', 'Ozon', 'сайт'],
    otherContent: [
      { name: 'free_a.jpg', thumb: 't', preview: 'p', channels: ['WB'] },
      { name: 'free_b.jpg', thumb: 't', preview: 'p' }
    ],
    ocContainers: [
      { id: 'c1', name: 'Контейнер 1', items: [
        { name: 'cnt_a.jpg', thumb: 't', preview: 'p', channels: ['Ozon', 'сайт'] }
      ] }
    ],
    previews: []
  };
}
let PROJ = freshProj();
window.getActiveProject = function () { return PROJ; };

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}]/u;

// ─── 1. Санити: контейнер фильтра есть в реальном index.html ───
ok('index has #oc-tag-filter', !!document.getElementById('oc-tag-filter'));
ok('index has #oc-dynamic-area', !!document.getElementById('oc-dynamic-area'));

// ─── 2. pvChannelTags ───
ok('pvChannelTags из proj.channels', JSON.stringify(window.pvChannelTags()) === JSON.stringify(['WB', 'Ozon', 'сайт']));

PROJ.channels = [];
ok('pvChannelTags фолбэк на дефолт при пустых channels',
   JSON.stringify(window.pvChannelTags()) === JSON.stringify(['WB', 'Ozon', 'Lamoda', 'сайт', 'соцсети', 'баннер']));

PROJ.channels = [{ name: 'WB' }, 'Ozon', { name: '' }, null];
ok('pvChannelTags поддерживает {name} и строки, пропускает пустые',
   JSON.stringify(window.pvChannelTags()) === JSON.stringify(['WB', 'Ozon']));

PROJ.channels = ['WB', 'Ozon', 'сайт'];

// ─── 3. pvOcItemPassesFilter (чистая логика) ───
window.pvOcClearFilter();
ok('passesFilter: без фильтра всё проходит', window.pvOcItemPassesFilter({ channels: [] }) === true);
window._ocTagFilter = { WB: true };
ok('passesFilter: элемент с тегом проходит', window.pvOcItemPassesFilter({ channels: ['WB'] }) === true);
ok('passesFilter: элемент без тега не проходит', window.pvOcItemPassesFilter({ channels: ['Ozon'] }) === false);
window._ocTagFilter = { WB: true, Ozon: true };
ok('passesFilter: OR по нескольким тегам', window.pvOcItemPassesFilter({ channels: ['Ozon'] }) === true);
window.pvOcClearFilter();

// ─── 4. pvOcTagsHTML: пикер + бейджи, без эмодзи ───
const itemWith = PROJ.otherContent[0];     // channels ['WB']
const itemNone = PROJ.otherContent[1];     // нет channels
const hWith = window.pvOcTagsHTML('free', -1, 0, itemWith);
const hNone = window.pvOcTagsHTML('free', -1, 1, itemNone);
ok('tagsHTML: пикер содержит кнопку на каждый канал (3)', (hWith.match(/class="oc-tag(\s|")/g) || []).length === 3);
ok('tagsHTML: назначенный тег помечен oc-tag-on', /class="oc-tag oc-tag-on" data-tag="WB"/.test(hWith));
ok('tagsHTML: бейдж назначенного тега присутствует', /<span class="oc-tag-badge">WB<\/span>/.test(hWith));
ok('tagsHTML: без тегов — нет блока бейджей', hNone.indexOf('oc-tags-badges') === -1);
ok('tagsHTML: пикер есть даже без назначенных', hNone.indexOf('class="oc-tags"') !== -1);
ok('tagsHTML: нет эмодзи', !EMOJI.test(hWith) && !EMOJI.test(hNone));

// ─── 5. ocRenderField: теги рендерятся на всех фото ───
window.ocRenderField();
const dyn = document.getElementById('oc-dynamic-area');
ok('render: все 3 фото отрисованы', document.querySelectorAll('.oc-item').length === 3);
ok('render: у каждого фото есть пикер тегов', document.querySelectorAll('.oc-item .oc-tags').length === 3);
ok('render: бейджи только у фото с тегами (2 из 3)', document.querySelectorAll('.oc-item .oc-tags-badges').length === 2);
ok('render: фильтр-бар показан (totalPhotos>0)', document.getElementById('oc-tag-filter').style.display === 'flex');
ok('render: фильтр-бар содержит чип на канал (3)', document.querySelectorAll('#oc-tag-filter .oc-tag').length === 3);
ok('render: нет эмодзи в области OC', !EMOJI.test(dyn.innerHTML) && !EMOJI.test(document.getElementById('oc-tag-filter').innerHTML));

// ─── 6. pvOcToggleTag: добавление тега (без фильтра -> in-place) ───
saveCalls = 0;
window.pvOcToggleTag('free', -1, 1, 1, { stopPropagation: function () {}, preventDefault: function () {} }); // free_b + 'Ozon'
ok('toggle add: модель обновлена', JSON.stringify(PROJ.otherContent[1].channels) === JSON.stringify(['Ozon']));
ok('toggle add: shAutoSave вызван', saveCalls === 1);
const fbEl = document.querySelector('#oc-free-field .oc-item[data-oc-idx="1"]');
ok('toggle add: DOM-кнопка помечена on', !!fbEl && !!fbEl.querySelector('.oc-tag[data-tag="Ozon"].oc-tag-on'));
ok('toggle add: бейдж появился in-place', !!fbEl && fbEl.querySelector('.oc-tags-badges') && /Ozon/.test(fbEl.querySelector('.oc-tags-badges').innerHTML));

// ─── 7. pvOcToggleTag: снятие тега ───
saveCalls = 0;
window.pvOcToggleTag('free', -1, 0, 0, { stopPropagation: function () {}, preventDefault: function () {} }); // free_a - 'WB'
ok('toggle remove: тег снят из модели', JSON.stringify(PROJ.otherContent[0].channels) === JSON.stringify([]));
ok('toggle remove: shAutoSave вызван', saveCalls === 1);

// ─── 8. Контейнерное фото: toggle по пути cnt ───
window.pvOcToggleTag('cnt', 0, 0, 0, { stopPropagation: function () {}, preventDefault: function () {} }); // cnt_a + 'WB'
ok('toggle cnt: тег добавлен контейнерному фото', PROJ.ocContainers[0].items[0].channels.indexOf('WB') !== -1);

// ─── 9. Фильтр по тегам скрывает несоответствующие фото ───
// Текущее состояние: free_a []=нет, free_b [Ozon], cnt_a [Ozon,сайт,WB]
PROJ = freshProj();            // сброс к детерминированному состоянию
window.pvOcClearFilter();
window.pvOcToggleFilter(0);    // WB (индекс 0): совпадает только free_a
ok('filter WB: показано только 1 фото (free_a)', document.querySelectorAll('.oc-item').length === 1);
ok('filter WB: это именно free_a', document.querySelector('.oc-item').getAttribute('title') === 'free_a.jpg');
ok('filter: кнопка «Сбросить» появилась', !!document.querySelector('.oc-tag-filter-reset'));

window.pvOcToggleFilter(1);    // + Ozon: теперь free_a(WB) + free_b? free_b нет Ozon в свежем PROJ -> cnt_a(Ozon,сайт)
ok('filter WB+Ozon (OR): free_a + cnt_a = 2 фото', document.querySelectorAll('.oc-item').length === 2);

// ─── 10. Сброс фильтра возвращает все фото ───
window.pvOcClearFilter();
ok('clear filter: снова все 3 фото', document.querySelectorAll('.oc-item').length === 3);
ok('clear filter: _ocTagFilter пуст', !window._ocTagFilterActive());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
