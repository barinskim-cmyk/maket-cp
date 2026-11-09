// ─────────────────────────────────────────────────────────────
//  usage-metrics.test.js
//
//  jsdom-харнесс на РЕАЛЬНОМ supabase.js. Проверяет sbUsageMetrics —
//  обёртку над read-only RPC usage_metrics_summary (migration 040):
//    · функция экспортирована;
//    · без sbClient -> ошибка "не подключён", data=null, RPC не зовётся;
//    · не авторизован (sbUser=null) -> ошибка про владельца, RPC не зовётся;
//    · авторизован -> зовёт rpc('usage_metrics_summary', {p_days:N}),
//      прокидывает data в callback(null, data);
//    · days по умолчанию 30 при вызове sbUsageMetrics(cb);
//    · строковый days '7' -> p_days 7 (parseInt);
//    · мусорный days -> p_days 30;
//    · res.error -> callback(errMsg, null);
//    · reject промиса ловится ['catch'] -> callback(errStr, null).
//
//  Запуск:  node tests/unit/usage-metrics.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'v2', 'frontend', 'js', 'supabase.js'), 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// Минимальные глобалы окружения
window.console = console;
// Загружаем НАСТОЯЩИЙ supabase.js
window.eval(src);

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok  - ' + name); }
  else { failed++; console.log('  FAIL- ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', a === b); }

// ── Мок Supabase-клиента: .rpc(name,args).then(cb)['catch'](cb2) ──
function makeClient(resolveVal, rejectVal) {
  const calls = [];
  const client = {
    _calls: calls,
    rpc: function (name, args) {
      calls.push({ name: name, args: args });
      return {
        then: function (cb) {
          let threw = null, ret;
          if (rejectVal === undefined) { try { ret = cb(resolveVal); } catch (e) { threw = e; } }
          return {
            'catch': function (cb2) {
              if (rejectVal !== undefined) return cb2(rejectVal);
              if (threw) return cb2(threw);
              return ret;
            }
          };
        }
      };
    }
  };
  return client;
}

const SUMMARY = { totals: { actions: 1820, active_users: 7 }, daily: [], owner_id: 'x' };

// 0. экспорт
ok('sbUsageMetrics определена', typeof window.sbUsageMetrics === 'function');

// 1. без клиента
(function () {
  window.sbClient = null; window.sbUser = null;
  let err = 'UNSET', data = 'UNSET';
  window.sbUsageMetrics(30, function (e, d) { err = e; data = d; });
  ok('без sbClient -> ошибка "не подключён"', /не подключ/i.test(err || ''));
  eq('без sbClient -> data null', data, null);
})();

// 2. не авторизован (клиент есть, sbUser null)
(function () {
  const c = makeClient({ data: SUMMARY });
  window.sbClient = c; window.sbUser = null;
  let err = 'UNSET', data = 'UNSET';
  window.sbUsageMetrics(30, function (e, d) { err = e; data = d; });
  ok('не авторизован -> ошибка про владельца', /владель/i.test(err || ''));
  eq('не авторизован -> RPC не вызван', c._calls.length, 0);
  eq('не авторизован -> data null', data, null);
})();

// 3. авторизован, успех + дефолтные/явные days
(function () {
  const c = makeClient({ data: SUMMARY });
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  let err = 'UNSET', data = 'UNSET';
  window.sbUsageMetrics(90, function (e, d) { err = e; data = d; });
  eq('успех -> err null', err, null);
  ok('успех -> прокинут summary', data && data.totals && data.totals.actions === 1820);
  eq('успех -> имя RPC', c._calls[0].name, 'usage_metrics_summary');
  eq('успех -> p_days = 90', c._calls[0].args.p_days, 90);
})();

// 4. дефолт 30 при sbUsageMetrics(cb)
(function () {
  const c = makeClient({ data: SUMMARY });
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  window.sbUsageMetrics(function () {});
  eq('sbUsageMetrics(cb) -> p_days 30', c._calls[0].args.p_days, 30);
})();

// 5. строковый days
(function () {
  const c = makeClient({ data: SUMMARY });
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  window.sbUsageMetrics('7', function () {});
  eq("days '7' -> p_days 7", c._calls[0].args.p_days, 7);
})();

// 6. мусорный days -> 30
(function () {
  const c = makeClient({ data: SUMMARY });
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  window.sbUsageMetrics('abc', function () {});
  eq("days 'abc' -> p_days 30", c._calls[0].args.p_days, 30);
})();

// 7. res.error -> callback(errMsg, null)
(function () {
  const c = makeClient({ error: { message: 'boom' }, data: null });
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  let err = 'UNSET', data = 'UNSET';
  window.sbUsageMetrics(30, function (e, d) { err = e; data = d; });
  eq('res.error -> err="boom"', err, 'boom');
  eq('res.error -> data null', data, null);
})();

// 8. reject промиса -> ['catch']
(function () {
  const c = makeClient(undefined, new Error('network down'));
  window.sbClient = c; window.sbUser = { id: 'owner-1' };
  let err = 'UNSET', data = 'UNSET';
  window.sbUsageMetrics(30, function (e, d) { err = e; data = d; });
  ok('reject -> err содержит текст', /network down/.test(err || ''));
  eq('reject -> data null', data, null);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
