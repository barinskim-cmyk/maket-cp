/* ══════════════════════════════════════════════
   metrics.js — Экран «Метрики» (использование платформы)
   ══════════════════════════════════════════════

   Задача audit0702-usage-metrics (backlog.html), фронт-слайс.

   Показывает владельцу сводку использования по его проектам:
   DAU/активные пользователи, активные проекты, топ-действия,
   активность по ролям, топ клиентских ошибок — за выбранный период.

   Источник данных: read-only RPC usage_metrics_summary (migration 040),
   обёрнутый аксессором sbUsageMetrics(days, cb) в supabase.js. Данные
   строго по проектам auth.uid() — чужое/анонимное не утекает (см. 040).

   Архитектура: все mx*HTML-функции ЧИСТЫЕ (summary -> строка HTML),
   без обращения к DOM — поэтому покрыты jsdom-тестом metrics-render.test.js.
   Оркестрация (fetch + вставка в DOM) вынесена в mxOnPageShow/mxRender.

   Стиль: дизайн-язык «Тёмная плёнка» (css/design-system.css): моно-подписи,
   tabular-nums, волосяные линии, без emoji/иконок.
   ══════════════════════════════════════════════ */

'use strict';

/* Текущее окно в днях (пресеты периода). */
var mxCurrentDays = 30;

/* Доступные пресеты периода: [дней, подпись]. */
var MX_PERIODS = [[7, '7 ДНЕЙ'], [30, '30 ДНЕЙ'], [90, '90 ДНЕЙ'], [365, 'ГОД']];

/* Человекочитаемые подписи действий action_log (для топ-действий).
   Неизвестное действие показываем как есть (raw ключ). */
var MX_ACTION_LABELS = {
  'project_create': 'Создание проекта',
  'project_update': 'Изменение проекта',
  'card_save': 'Сохранение карточек',
  'save_cards_by_token': 'Сохранение карточек (клиент)',
  'share_create': 'Создание share-ссылки',
  'client_approve': 'Аппрув клиента',
  'client_reject': 'Возврат клиента',
  'comment_add': 'Комментарий',
  'login': 'Вход',
  'register': 'Регистрация'
};

/* Человекочитаемые подписи ролей. */
var MX_ROLE_LABELS = {
  'owner': 'Фотограф (владелец)',
  'photographer': 'Фотограф',
  'client': 'Клиент',
  'retoucher': 'Ретушёр',
  'guest': 'Гость'
};

/* ── Утилиты (чистые) ── */

/* HTML-экранирование. */
function mxEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Форматирование целого с тонким разделителем тысяч (4 835). */
function mxNum(n) {
  var v = parseInt(n, 10);
  if (isNaN(v)) return '0';
  var neg = v < 0;
  var s = String(Math.abs(v));
  var out = '';
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' '; // NARROW NO-BREAK SPACE
    out += s.charAt(i);
  }
  return (neg ? '-' : '') + out;
}

/* ISO-дата/таймстемп -> 'ДД.ММ.ГГГГ' (локально-независимо, без времени). */
function mxFmtDate(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return mxEsc(iso);
  return m[3] + '.' + m[2] + '.' + m[1];
}

/* Короткий 'ДД.ММ' из ISO-дня. */
function mxShortDay(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2]) : mxEsc(iso);
}

/* Подпись действия. */
function mxActionLabel(key) {
  return MX_ACTION_LABELS[key] || key || '—';
}

/* Подпись роли (null/'' -> «не указана»). */
function mxRoleLabel(key) {
  if (!key) return 'Не указана';
  return MX_ROLE_LABELS[key] || key;
}

/* true, если сводка фактически пустая (нет ни одного действия). */
function mxIsEmpty(summary) {
  if (!summary) return true;
  var t = summary.totals || {};
  return !(parseInt(t.actions, 10) > 0);
}

/* ── Рендер блоков (чистые) ── */

/* KPI-строка из totals. */
function mxKpiHTML(totals) {
  totals = totals || {};
  var cells = [
    ['Действий', totals.actions],
    ['Активных пользователей', totals.active_users],
    ['Активных проектов', totals.active_projects],
    ['Активных дней', totals.active_days],
    ['Ошибок клиента', totals.errors],
    ['Сигнатур ошибок', totals.error_signatures]
  ];
  var html = '<div class="mx-kpi-grid">';
  for (var i = 0; i < cells.length; i++) {
    html += '<div class="mx-kpi">'
      + '<div class="mx-kpi-num ds-num">' + mxNum(cells[i][1]) + '</div>'
      + '<div class="mx-kpi-lbl ds-meta">' + mxEsc(cells[i][0]) + '</div>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

/* Спарклайн активности по дням (SVG, действия как бары). */
function mxDailySparkHTML(daily) {
  if (!daily || !daily.length) {
    return '<div class="mx-empty-line ds-meta">Нет активности по дням за период</div>';
  }
  var max = 1, i;
  for (i = 0; i < daily.length; i++) {
    var a = parseInt(daily[i].actions, 10) || 0;
    if (a > max) max = a;
  }
  var n = daily.length;
  var W = 100, H = 30, gap = 0.4;
  var bw = (W / n) - gap;
  if (bw < 0.5) bw = 0.5;
  var bars = '';
  for (i = 0; i < n; i++) {
    var val = parseInt(daily[i].actions, 10) || 0;
    var h = max > 0 ? (val / max) * H : 0;
    if (val > 0 && h < 0.8) h = 0.8;
    var x = (W / n) * i;
    var y = H - h;
    var title = mxShortDay(daily[i].day) + ': ' + mxNum(val) + ' действ.';
    bars += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" '
      + 'width="' + bw.toFixed(2) + '" height="' + h.toFixed(2) + '" '
      + 'class="mx-spark-bar"><title>' + mxEsc(title) + '</title></rect>';
  }
  var first = mxShortDay(daily[0].day);
  var last = mxShortDay(daily[n - 1].day);
  return '<div class="mx-spark">'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" '
    + 'class="mx-spark-svg" role="img" aria-label="Активность по дням">'
    + bars + '</svg>'
    + '<div class="mx-spark-axis ds-meta"><span>' + first + '</span><span>' + last + '</span></div>'
    + '</div>';
}

/* Таблица «Топ действий». */
function mxTopActionsHTML(arr) {
  if (!arr || !arr.length) {
    return '<div class="mx-empty-line ds-meta">Нет данных</div>';
  }
  var max = 1, i;
  for (i = 0; i < arr.length; i++) {
    var c = parseInt(arr[i].count, 10) || 0;
    if (c > max) max = c;
  }
  var html = '<div class="mx-bars">';
  for (i = 0; i < arr.length; i++) {
    var cnt = parseInt(arr[i].count, 10) || 0;
    var pct = Math.round((cnt / max) * 100);
    html += '<div class="mx-bar-row">'
      + '<div class="mx-bar-name">' + mxEsc(mxActionLabel(arr[i].action)) + '</div>'
      + '<div class="mx-bar-track"><div class="mx-bar-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="mx-bar-val ds-num">' + mxNum(cnt) + '</div>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

/* Таблица «По ролям». */
function mxByRoleHTML(arr) {
  if (!arr || !arr.length) {
    return '<div class="mx-empty-line ds-meta">Нет данных</div>';
  }
  var html = '<table class="mx-table"><thead><tr>'
    + '<th>Роль</th><th class="mx-r">Действий</th><th class="mx-r">Пользователей</th>'
    + '</tr></thead><tbody>';
  for (var i = 0; i < arr.length; i++) {
    html += '<tr>'
      + '<td>' + mxEsc(mxRoleLabel(arr[i].role)) + '</td>'
      + '<td class="mx-r ds-num">' + mxNum(arr[i].actions) + '</td>'
      + '<td class="mx-r ds-num">' + mxNum(arr[i].active_users) + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/* Таблица «Топ ошибок клиента». */
function mxTopErrorsHTML(arr) {
  if (!arr || !arr.length) {
    return '<div class="mx-empty-line ds-meta">Ошибок не зафиксировано — хорошо</div>';
  }
  var html = '<table class="mx-table mx-table-err"><thead><tr>'
    + '<th>Ошибка</th><th class="mx-r">Раз</th><th>Последняя</th>'
    + '</tr></thead><tbody>';
  for (var i = 0; i < arr.length; i++) {
    var msg = arr[i].message || arr[i].signature || '—';
    var typ = arr[i].error_type ? (arr[i].error_type + ': ') : '';
    html += '<tr>'
      + '<td class="mx-err-msg" title="' + mxEsc(msg) + '">'
      + '<span class="ds-meta">' + mxEsc(typ) + '</span>' + mxEsc(msg) + '</td>'
      + '<td class="mx-r ds-num">' + mxNum(arr[i].count) + '</td>'
      + '<td class="ds-meta">' + mxFmtDate(arr[i].last_seen) + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/* Переключатель периода. */
function mxPeriodBarHTML(days) {
  var html = '<div class="mx-period" role="group" aria-label="Период">';
  for (var i = 0; i < MX_PERIODS.length; i++) {
    var d = MX_PERIODS[i][0];
    var active = (d === days) ? ' active' : '';
    html += '<button class="mx-period-btn' + active + '" '
      + 'onclick="mxSetPeriod(' + d + ')">' + mxEsc(MX_PERIODS[i][1]) + '</button>';
  }
  html += '</div>';
  return html;
}

/* Пустое/сервисное состояние (нет данных или подсказка). */
function mxNoticeHTML(title, body, actionLabel, actionCall) {
  var html = '<div class="cp-empty mx-notice">'
    + '<div class="t1">' + mxEsc(title) + '</div>';
  if (body) html += '<div class="t2">' + mxEsc(body) + '</div>';
  if (actionLabel && actionCall) {
    html += '<div class="act" onclick="' + mxEsc(actionCall) + '" role="button" tabindex="0">'
      + mxEsc(actionLabel) + '</div>';
  }
  html += '</div>';
  return html;
}

/* Полная сводка -> HTML тела экрана. */
function mxSummaryHTML(summary) {
  if (mxIsEmpty(summary)) {
    return mxNoticeHTML(
      'ПОКА НЕТ ДАННЫХ',
      'За выбранный период в ваших проектах не зафиксировано действий. '
      + 'Метрики появятся, как только вы или клиент начнёте работать в системе.',
      null, null);
  }
  var t = summary.totals || {};
  var gen = summary.generated_at ? mxFmtDate(summary.generated_at) : '';
  var win = parseInt(summary.window_days, 10) || mxCurrentDays;

  var html = '';

  html += '<div class="mx-section">' + mxKpiHTML(t) + '</div>';

  html += '<div class="mx-section">'
    + '<div class="mx-h ds-lbl">АКТИВНОСТЬ ПО ДНЯМ</div>'
    + mxDailySparkHTML(summary.daily) + '</div>';

  html += '<div class="mx-cols">';

  html += '<div class="mx-col">'
    + '<div class="mx-h ds-lbl">ТОП ДЕЙСТВИЙ</div>'
    + mxTopActionsHTML(summary.top_actions) + '</div>';

  html += '<div class="mx-col">'
    + '<div class="mx-h ds-lbl">ПО РОЛЯМ</div>'
    + mxByRoleHTML(summary.by_role) + '</div>';

  html += '</div>'; // mx-cols

  html += '<div class="mx-section">'
    + '<div class="mx-h ds-lbl">ТОП ОШИБОК КЛИЕНТА</div>'
    + mxTopErrorsHTML(summary.top_errors) + '</div>';

  html += '<div class="mx-foot ds-meta">'
    + 'Окно: ' + mxNum(win) + ' дн.'
    + (gen ? ' · сформировано ' + gen : '')
    + ' · только ваши проекты</div>';

  return html;
}

/* ── Оркестрация (DOM) ── */

/* Сменить период и перерисовать. */
function mxSetPeriod(days) {
  mxCurrentDays = days;
  mxOnPageShow();
}

/* Вставить HTML в тело экрана, если контейнер есть. */
function mxSetBody(html) {
  var el = (typeof document !== 'undefined') && document.getElementById('mx-body');
  if (el) el.innerHTML = html;
}

/* Обновить панель периода (активная кнопка). */
function mxSyncPeriodBar() {
  var el = (typeof document !== 'undefined') && document.getElementById('mx-period-bar');
  if (el) el.innerHTML = mxPeriodBarHTML(mxCurrentDays);
}

/* Показ экрана: загрузить сводку и отрисовать. */
function mxOnPageShow() {
  mxSyncPeriodBar();

  /* Нет Supabase или не авторизован — подсказка войти. */
  if (typeof sbIsLoggedIn === 'function' && !sbIsLoggedIn()) {
    mxSetBody(mxNoticeHTML(
      'ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА',
      'Сводка использования доступна авторизованному владельцу. Войдите в облако, чтобы увидеть метрики своих проектов.',
      'Войти', 'showPage(\'shootings\')'));
    return;
  }

  mxSetBody('<div class="mx-loading ds-meta">Загрузка сводки…</div>');

  if (typeof sbUsageMetrics !== 'function') {
    mxSetBody(mxNoticeHTML('НЕДОСТУПНО', 'Модуль облака не загружен.', null, null));
    return;
  }

  sbUsageMetrics(mxCurrentDays, function (err, summary) {
    if (err) {
      mxSetBody(mxNoticeHTML('НЕ УДАЛОСЬ ЗАГРУЗИТЬ', err, 'Повторить', 'mxOnPageShow()'));
      return;
    }
    mxSetBody(mxSummaryHTML(summary));
  });
}

/* Экспорт для не-браузерных окружений (jsdom-тест читает через window). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mxEsc: mxEsc, mxNum: mxNum, mxFmtDate: mxFmtDate, mxShortDay: mxShortDay,
    mxActionLabel: mxActionLabel, mxRoleLabel: mxRoleLabel, mxIsEmpty: mxIsEmpty,
    mxKpiHTML: mxKpiHTML, mxDailySparkHTML: mxDailySparkHTML,
    mxTopActionsHTML: mxTopActionsHTML, mxByRoleHTML: mxByRoleHTML,
    mxTopErrorsHTML: mxTopErrorsHTML, mxPeriodBarHTML: mxPeriodBarHTML,
    mxNoticeHTML: mxNoticeHTML, mxSummaryHTML: mxSummaryHTML
  };
}
