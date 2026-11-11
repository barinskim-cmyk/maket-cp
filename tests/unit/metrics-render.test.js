// ─────────────────────────────────────────────────────────────
//  metrics-render.test.js
//
//  Юнит-тест ЧИСТЫХ рендер-функций metrics.js (экран «Метрики»,
//  задача audit0702-usage-metrics, фронт-слайс). Функции mx*HTML
//  принимают сводку usage_metrics_summary (migration 040) и возвращают
//  строку HTML без обращения к DOM — поэтому грузим модуль напрямую
//  через require() и проверяем выход.
//
//  Проверяется:
//    · экспорт всех mx*-функций;
//    · форматирование чисел (тонкий разделитель тысяч), дат, экранирование;
//    · подписи действий/ролей (маппинг + фолбэк на raw/«не указана»);
//    · mxIsEmpty по totals.actions;
//    · KPI/спарклайн/топ-действия/по-ролям/топ-ошибки — состав и пустые ветки;
//    · mxSummaryHTML: пустая сводка -> «ПОКА НЕТ ДАННЫХ», полная -> все блоки;
//    · переключатель периода отмечает активную кнопку;
//    · XSS: вредоносные значения экранируются (нет сырого <script>).
//
//  Запуск:  node tests/unit/metrics-render.test.js
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'v2', 'frontend', 'js', 'metrics.js'));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok  - ' + name); }
  else { failed++; console.log('  FAIL- ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', a === b); }
function has(name, hay, needle) { ok(name + ' contains ' + JSON.stringify(needle), hay.indexOf(needle) !== -1); }
function no(name, hay, needle) { ok(name + ' NOT contains ' + JSON.stringify(needle), hay.indexOf(needle) === -1); }

// Реалистичная сводка (верификация 2026-11-09: 1820 действ. / 7 юзеров / 14 проектов / 232 ошибки / 75 сигнатур / 22 дня)
const SUMMARY = {
  generated_at: '2026-11-11T18:00:00+00:00',
  window_days: 30,
  owner_id: 'fac7edad-0000-0000-0000-000000000000',
  totals: { actions: 1820, active_users: 7, active_projects: 14, owned_projects: 16, active_days: 22, errors: 232, error_signatures: 75 },
  daily: [
    { day: '2026-11-08', active_users: 3, active_projects: 5, actions: 120 },
    { day: '2026-11-09', active_users: 5, active_projects: 8, actions: 410 },
    { day: '2026-11-10', active_users: 2, active_projects: 3, actions: 60 }
  ],
  top_actions: [
    { action: 'card_save', count: 900 },
    { action: 'save_cards_by_token', count: 500 },
    { action: 'weird_unmapped_action', count: 20 }
  ],
  by_role: [
    { role: 'owner', actions: 1200, active_users: 1 },
    { role: 'client', actions: 600, active_users: 5 },
    { role: null, actions: 20, active_users: 1 }
  ],
  top_errors: [
    { signature: 'sig1', error_type: 'TypeError', message: 'Cannot read x of undefined', count: 100, last_seen: '2026-11-10T12:00:00+00:00' }
  ]
};

// 0. экспорт
['mxEsc','mxNum','mxFmtDate','mxActionLabel','mxRoleLabel','mxIsEmpty','mxKpiHTML',
 'mxDailySparkHTML','mxTopActionsHTML','mxByRoleHTML','mxTopErrorsHTML','mxPeriodBarHTML',
 'mxNoticeHTML','mxSummaryHTML'].forEach(function (fn) {
  ok('экспорт ' + fn, typeof M[fn] === 'function');
});

// 1. mxNum — тонкий разделитель тысяч ( )
eq('mxNum 1820', M.mxNum(1820), '1 820');
eq('mxNum 4835', M.mxNum(4835), '4 835');
eq('mxNum 7', M.mxNum(7), '7');
eq('mxNum 0', M.mxNum(0), '0');
eq('mxNum NaN->0', M.mxNum('abc'), '0');
eq('mxNum 1000000', M.mxNum(1000000), '1 000 000');

// 2. mxEsc
eq('mxEsc <', M.mxEsc('<b>'), '&lt;b&gt;');
eq('mxEsc null', M.mxEsc(null), '');

// 3. mxFmtDate
eq('mxFmtDate iso', M.mxFmtDate('2026-11-11T18:00:00+00:00'), '11.11.2026');
eq('mxFmtDate empty', M.mxFmtDate(''), '');

// 4. подписи
eq('mxActionLabel known', M.mxActionLabel('card_save'), 'Сохранение карточек');
eq('mxActionLabel unknown->raw', M.mxActionLabel('weird_unmapped_action'), 'weird_unmapped_action');
eq('mxRoleLabel known', M.mxRoleLabel('client'), 'Клиент');
eq('mxRoleLabel null->не указана', M.mxRoleLabel(null), 'Не указана');

// 5. mxIsEmpty
ok('mxIsEmpty(null)', M.mxIsEmpty(null) === true);
ok('mxIsEmpty totals.actions=0', M.mxIsEmpty({ totals: { actions: 0 } }) === true);
ok('mxIsEmpty full=false', M.mxIsEmpty(SUMMARY) === false);

// 6. KPI
(function () {
  const h = M.mxKpiHTML(SUMMARY.totals);
  has('KPI: действий 1 820', h, '1 820');
  has('KPI: активных дней label', h, 'Активных дней');
  has('KPI: сигнатур', h, '75');
})();

// 7. спарклайн
(function () {
  const empty = M.mxDailySparkHTML([]);
  has('спарк пустой -> подсказка', empty, 'Нет активности');
  const h = M.mxDailySparkHTML(SUMMARY.daily);
  has('спарк: svg', h, '<svg');
  const rects = (h.match(/<rect /g) || []).length;
  eq('спарк: число баров = дней', rects, SUMMARY.daily.length);
  has('спарк: ось начало', h, '08.11');
})();

// 8. топ-действий
(function () {
  eq('топ пусто -> Нет данных', M.mxTopActionsHTML([]).indexOf('Нет данных') !== -1, true);
  const h = M.mxTopActionsHTML(SUMMARY.top_actions);
  has('топ: маппинг card_save', h, 'Сохранение карточек');
  has('топ: raw unmapped', h, 'weird_unmapped_action');
  has('топ: макс бар 100%', h, 'width:100%');
})();

// 9. по ролям
(function () {
  const h = M.mxByRoleHTML(SUMMARY.by_role);
  has('роли: owner label', h, 'Фотограф (владелец)');
  has('роли: null -> Не указана', h, 'Не указана');
  has('роли: 1 200', h, '1 200');
})();

// 10. топ ошибок
(function () {
  has('ошибки пусто -> ок', M.mxTopErrorsHTML([]), 'Ошибок не зафиксировано');
  const h = M.mxTopErrorsHTML(SUMMARY.top_errors);
  has('ошибки: тип', h, 'TypeError');
  has('ошибки: сообщение', h, 'Cannot read x of undefined');
  has('ошибки: дата', h, '10.11.2026');
})();

// 11. сводка целиком
(function () {
  const empty = M.mxSummaryHTML({ totals: { actions: 0 } });
  has('сводка пустая', empty, 'ПОКА НЕТ ДАННЫХ');
  const h = M.mxSummaryHTML(SUMMARY);
  has('сводка: KPI блок', h, 'mx-kpi-grid');
  has('сводка: заголовок топ действий', h, 'ТОП ДЕЙСТВИЙ');
  has('сводка: заголовок ошибок', h, 'ТОП ОШИБОК');
  has('сводка: футер окно 30', h, 'Окно: 30');
})();

// 12. период
(function () {
  const h = M.mxPeriodBarHTML(90);
  has('период: кнопка 7', h, 'mxSetPeriod(7)');
  has('период: активная 90', h, 'mx-period-btn active');
})();

// 13. XSS — вредоносные значения экранируются
(function () {
  const evil = {
    totals: { actions: 5 },
    daily: [],
    top_actions: [{ action: '<script>alert(1)</script>', count: 5 }],
    by_role: [{ role: '<img onerror=x>', actions: 5, active_users: 1 }],
    top_errors: [{ signature: 's', message: '<svg/onload=1>', error_type: 'X', count: 1, last_seen: '2026-11-10' }]
  };
  const h = M.mxSummaryHTML(evil);
  no('XSS: нет сырого <script>', h, '<script>');
  no('XSS: нет сырого onerror=', h, '<img onerror=x>');
  has('XSS: экранированный scripт', h, '&lt;script&gt;');
})();

console.log('\n' + (failed ? 'FAILED ' : 'PASSED ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
