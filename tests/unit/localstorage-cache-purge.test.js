// ─────────────────────────────────────────────────────────────
//  localstorage-cache-purge.test.js
//
//  Node-харнесс (без браузера) на РЕАЛЬНОМ коде shootings.js.
//  Извлекает функции _shIsProjectPreviewKey / _shClearCloudCache
//  прямо из исходника и проверяет их против мок-localStorage.
//
//  Контекст: остаток инцидента previews RLS-leak (09.07) — кэш
//  проектов в localStorage не сбрасывался при logout, поэтому второй
//  пользователь на том же браузере мог увидеть проекты первого.
//  Фикс: _shClearCloudCache() чистит maketcp_projects + ключи превью
//  проектов, но СОХРАНЯЕТ UI-настройки (maketcp_pv_width / _cols).
//
//  Запуск:  node tests/unit/localstorage-cache-purge.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'v2', 'frontend', 'js', 'shootings.js'),
  'utf8'
);

function grab(re, label) {
  const m = SRC.match(re);
  if (!m) throw new Error('Не найден в shootings.js: ' + label);
  return m[0];
}

// Реальные фрагменты исходника, а не копии.
const CODE = [
  grab(/var SH_PREVIEWS_KEY_PREFIX = '[^']*';/, 'SH_PREVIEWS_KEY_PREFIX'),
  grab(/var SH_PROJECTS_CACHE_KEY = '[^']*';/, 'SH_PROJECTS_CACHE_KEY'),
  grab(/var SH_PV_RESERVED_KEYS = \{[^}]*\};/, 'SH_PV_RESERVED_KEYS'),
  grab(/function _shIsProjectPreviewKey\(k\) \{[\s\S]*?\n\}/, '_shIsProjectPreviewKey'),
  grab(/function _shClearCloudCache\(\) \{[\s\S]*?\n\}/, '_shClearCloudCache'),
].join('\n');

// Мок localStorage с поддержкой Object.keys(localStorage).
function makeLocalStorage(initial) {
  const store = Object.assign({}, initial);
  const base = {
    getItem: function (k) { return (k in store) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    _store: store,
  };
  return new Proxy(base, {
    ownKeys: function (t) { return Object.keys(t._store); },
    getOwnPropertyDescriptor: function (t, k) {
      if (k in t._store) return { enumerable: true, configurable: true, value: t._store[k] };
      return Object.getOwnPropertyDescriptor(t, k);
    },
    get: function (t, k) { return t[k]; },
  });
}

function loadApi(localStorage) {
  const factory = new Function(
    'localStorage', 'console',
    CODE + '\nreturn { _shClearCloudCache: _shClearCloudCache, _shIsProjectPreviewKey: _shIsProjectPreviewKey };'
  );
  return factory(localStorage, { log: function () {}, warn: function () {} });
}

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } }
function test(name, fn) { fn(); console.log((failures ? 'DONE' : 'PASS') + ': ' + name); }

test('purge чистит кэш облака, сохраняет UI-настройки', function () {
  const ls = makeLocalStorage({
    'maketcp_projects': '[{"brand":"EKONIKA"}]',
    'maketcp_pv_EKONIKA_2026-05-27': '[{"name":"a.jpg"}]',
    'maketcp_pv_ACME_2026-01-01': '[{"name":"b.jpg"}]',
    'maketcp_pv_width': '420',
    'maketcp_pv_cols': '4',
    'mcp_theme': 'dark',
    'maketcp_coach_pv_v1': '1',
  });
  const api = loadApi(ls);
  const n = api._shClearCloudCache();
  check(ls.getItem('maketcp_projects') === null, 'maketcp_projects удалён');
  check(ls.getItem('maketcp_pv_EKONIKA_2026-05-27') === null, 'превью проекта удалено');
  check(ls.getItem('maketcp_pv_ACME_2026-01-01') === null, 'превью проекта 2 удалено');
  check(ls.getItem('maketcp_pv_width') === '420', 'maketcp_pv_width СОХРАНЁН');
  check(ls.getItem('maketcp_pv_cols') === '4', 'maketcp_pv_cols СОХРАНЁН');
  check(ls.getItem('mcp_theme') === 'dark', 'тема сохранена');
  check(ls.getItem('maketcp_coach_pv_v1') === '1', 'флаг подсказок сохранён');
  check(n === 3, 'удалено ровно 3 ключа (1 projects + 2 превью), было ' + n);
});

test('_shIsProjectPreviewKey классифицирует ключи', function () {
  const api = loadApi(makeLocalStorage({}));
  check(api._shIsProjectPreviewKey('maketcp_pv_EKONIKA_2026-05-27') === true, 'ключ проекта => true');
  check(api._shIsProjectPreviewKey('maketcp_pv_width') === false, 'width-настройка => false');
  check(api._shIsProjectPreviewKey('maketcp_pv_cols') === false, 'cols-настройка => false');
  check(api._shIsProjectPreviewKey('maketcp_projects') === false, 'projects => false');
  check(api._shIsProjectPreviewKey('mcp_theme') === false, 'theme => false');
});

test('пустое хранилище — без падений', function () {
  const api = loadApi(makeLocalStorage({}));
  check(api._shClearCloudCache() === 0, '0 удалено на пустом');
});

test('только настройки — ничего не удаляется', function () {
  const ls = makeLocalStorage({ 'maketcp_pv_width': '300', 'maketcp_pv_cols': '3' });
  const api = loadApi(ls);
  check(api._shClearCloudCache() === 0, 'ничего не удалено');
  check(ls.getItem('maketcp_pv_width') === '300', 'width на месте');
});

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' ASSERTION(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
