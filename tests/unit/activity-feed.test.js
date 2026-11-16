// ─────────────────────────────────────────────────────────────
//  activity-feed.test.js
//
//  Юнит-тест ЧИСТЫХ функций activity.js — лента активности клиента
//  для владельца (срез feat0702-notifications). Функции собирают
//  клиентскую активность из proj._events + комментариев, считают
//  непрочитанное и рендерят HTML без DOM — грузим модуль напрямую
//  через require() и проверяем выход.
//
//  Покрыто:
//    · экспорт ac*-функций;
//    · acParseTs: ISO → ms, число passthrough, мусор/пусто/null → 0;
//    · acCollectActivity: аппрув + возврат из журнала, комментарии
//      клиента (карточка author='client' + _clientComments), игнор
//      командных комментов и неклиентских событий, null-проект,
//      сортировка новые-сверху, count фото у событий;
//    · acUnreadCount: seen=0 / середина / будущее;
//    · acPanelHTML: empty-state, сводка «новых: N», класс ac-new;
//    · acItemHTML: ac-new только у новых, «N фото», текст коммента;
//    · XSS: <script> в тексте коммента экранируется;
//    · без emoji в выводе и в исходнике модуля.
//
//  Запуск:  node tests/unit/activity-feed.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const fs = require('fs');
const A = require(path.join(__dirname, '..', '..', 'v2', 'frontend', 'js', 'activity.js'));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok  - ' + name); }
  else { failed++; console.log('  FAIL- ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', a === b); }
function has(name, hay, needle) { ok(name + ' contains ' + JSON.stringify(needle), hay.indexOf(needle) !== -1); }
function no(name, hay, needle) { ok(name + ' NOT contains ' + JSON.stringify(needle), hay.indexOf(needle) === -1); }

const T1 = '2026-11-10T10:00:00Z'; // возврат
const T2 = '2026-11-11T10:00:00Z'; // аппрув
const T3 = '2026-11-12T10:00:00Z'; // коммент карточки (самый новый)
const ms = function (s) { return Date.parse(s); };

const PROJECTS = [
  {
    name: 'BrandX', _cloudId: 'c1',
    _events: [
      { id: 'e1', type: 'selection_added', ts: T1, actor: { name: 'Клиент' }, photos: ['x.jpg'] }, // игнор
      { id: 'e2', type: 'cc_returned', ts: T1, actor: { name: 'Клиент' }, photos: ['a.jpg', 'b.jpg', 'c.jpg'] },
      { id: 'e3', type: 'selection_approved', ts: T2, actor: { name: 'Клиент' }, photos: ['a.jpg', 'b.jpg'] }
    ],
    cards: [
      { name: 'Карточка 1', _comments: [
        { id: 'k1', author: 'client', text: 'нужно светлее', created: T3 },
        { id: 'k2', author: 'team', text: 'внутренняя заметка', created: T3 }
      ] }
    ],
    _clientComments: [ { type: 'extra_request', text: 'добавьте доп. кадр', date: '12.11.2026, 13:00' } ]
  },
  { name: 'BrandY', _cloudId: 'c2', _events: [], cards: [] },
  null
];

// 0. экспорт
['acEsc','acParseTs','acCollectActivity','acUnreadCount','acGetSeen','acSetSeen',
 'acTimeLabel','acItemHTML','acPanelHTML','acRefreshBadge','acOnPageShow'].forEach(function (fn) {
  ok('экспорт ' + fn, typeof A[fn] === 'function');
});

// 1. acParseTs
ok('acParseTs ISO > 0', A.acParseTs(T1) === ms(T1) && A.acParseTs(T1) > 0);
eq('acParseTs число passthrough', A.acParseTs(1700000000000), 1700000000000);
eq('acParseTs мусор → 0', A.acParseTs('12.11.2026, 13:00'), 0);
eq('acParseTs null → 0', A.acParseTs(null), 0);
eq('acParseTs пусто → 0', A.acParseTs(''), 0);

// 2. acCollectActivity
const items = A.acCollectActivity(PROJECTS);
eq('собрано 4 элемента', items.length, 4);
eq('нет selection_added (неклиентское)', items.filter(function (i) { return i.kind !== 'approved' && i.kind !== 'returned' && i.kind !== 'comment'; }).length, 0);
eq('один approved', items.filter(function (i) { return i.kind === 'approved'; }).length, 1);
eq('один returned', items.filter(function (i) { return i.kind === 'returned'; }).length, 1);
eq('два comment (карточка + проектный)', items.filter(function (i) { return i.kind === 'comment'; }).length, 2);
eq('командный комментарий проигнорирован', items.filter(function (i) { return i.text === 'внутренняя заметка'; }).length, 0);
ok('сортировка: самый новый (коммент T3) первым', items[0].kind === 'comment' && items[0].when === ms(T3));
const approvedItem = items.filter(function (i) { return i.kind === 'approved'; })[0];
eq('у approved count = 2 фото', approvedItem.count, 2);
eq('projName проставлен', approvedItem.projName, 'BrandX');
const projComment = items.filter(function (i) { return i.text === 'добавьте доп. кадр'; })[0];
eq('проектный коммент с нечитаемой датой → when 0', projComment.when, 0);
eq('пустой список проектов → []', A.acCollectActivity([]).length, 0);
eq('null-аргумент → []', A.acCollectActivity(null).length, 0);

// 3. acUnreadCount
eq('unread seen=0 → 3 (все с валидным временем)', A.acUnreadCount(items, 0), 3);
eq('unread seen=между T1 и T2 → 2', A.acUnreadCount(items, ms('2026-11-10T20:00:00Z')), 2);
eq('unread seen=будущее → 0', A.acUnreadCount(items, ms('2027-01-01T00:00:00Z')), 0);
eq('unread пустой список → 0', A.acUnreadCount([], 0), 0);

// 4. acPanelHTML
const emptyHTML = A.acPanelHTML([], 0);
has('empty-state текст', emptyHTML, 'Пока нет активности');
const panelHTML = A.acPanelHTML(items, ms('2026-11-10T20:00:00Z'));
has('панель: подпись аппрува', panelHTML, 'Клиент согласовал отбор');
has('панель: подпись возврата', panelHTML, 'Клиент вернул контент');
has('панель: имя проекта', panelHTML, 'BrandX');
has('панель: сводка новых', panelHTML, 'новых: 2');
has('панель: класс непрочитанного', panelHTML, 'ac-new');

// 5. acItemHTML
const newItem = A.acItemHTML({ kind: 'approved', label: 'Клиент согласовал отбор', projName: 'BrandX', text: '', cardName: '', count: 2, who: 'Клиент', when: ms(T2) }, ms(T1));
has('новый элемент имеет ac-new', newItem, 'ac-new');
has('новый элемент: N фото', newItem, '2 фото');
const oldItem = A.acItemHTML({ kind: 'returned', label: 'Клиент вернул контент на доработку', projName: 'BrandX', text: '', cardName: '', count: 1, who: '', when: ms(T1) }, ms(T2));
no('старый элемент без ac-new', oldItem, 'ac-new');
const cmtItem = A.acItemHTML({ kind: 'comment', label: 'Комментарий клиента', projName: 'BrandX', text: 'нужно светлее', cardName: 'Карточка 1', count: 0, who: '', when: ms(T3) }, 0);
has('коммент: текст виден', cmtItem, 'нужно светлее');
has('коммент: имя карточки', cmtItem, 'Карточка 1');

// 6. XSS
const xssItems = A.acCollectActivity([{ name: 'Evil<script>', _cloudId: 'x', _events: [], cards: [{ name: 'C', _comments: [{ author: 'client', text: '<script>alert(1)</script>', created: T3 }] }] }]);
const xssHTML = A.acPanelHTML(xssItems, 0);
no('XSS: нет сырого <script> в тексте', xssHTML, '<script>alert(1)</script>');
has('XSS: экранированный скрипт', xssHTML, '&lt;script&gt;');
no('XSS: имя проекта экранировано', xssHTML, 'Evil<script>');

// 7. без emoji — вывод и исходник
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u; // пиктограммы/дингбаты (стрелки — не emoji)
ok('в панели нет emoji', !EMOJI.test(panelHTML + emptyHTML + cmtItem));
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'v2', 'frontend', 'js', 'activity.js'), 'utf8');
ok('в исходнике activity.js нет emoji', !EMOJI.test(src));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
