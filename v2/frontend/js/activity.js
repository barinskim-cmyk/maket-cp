/* ══════════════════════════════════════════════
   activity.js — Лента активности клиента для владельца
   ══════════════════════════════════════════════

   Срез задачи feat0702-notifications (P1). Родительская задача —
   уведомлять фотографа о действиях клиента (аппрув / возврат /
   комментарий). Полная доставка по email — через Supabase edge
   function + внешний провайдер (деньги/наружу -> решение Маши).

   Этот слайс — браузерная, владельческая, ТОЛЬКО ДЛЯ ЧТЕНИЯ часть:
   собирает клиентскую активность из канонического журнала событий
   (proj._events) и клиентских комментариев, считает «непрочитанное»
   против localStorage-метки времени и рисует ленту + бейдж на вкладке.
   Не трогает БД, не шлёт ничего наружу, не меняет данные проектов.

   Гость по share-ссылке вкладку не видит (owner-only, как «Метрики»).
   ────────────────────────────────────────────── */

var AC_SEEN_KEY = 'maketcp_activity_seen';

/* Клиентские типы событий journal'а -> человекочитаемая подпись.
   Сознательно узко: ровно «аппрув / возврат / комментарий» из брифа,
   без шумных selection_added/retouch_* (ретушёр — не клиент). */
var AC_KIND_LABEL = {
  approved: 'Клиент согласовал отбор',
  returned: 'Клиент вернул контент на доработку',
  comment:  'Комментарий клиента'
};

/* XSS-escape (самодостаточно, как mxEsc/в других модулях). */
function acEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Распарсить метку времени в ms. Возвращает 0 для пустых/непарсируемых
   значений (proj._clientComments.date — locale-строка): такие элементы
   показываются в ленте, но НИКОГДА не считаются «непрочитанными» —
   чтобы бейдж не загорался ложно. */
function acParseTs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return (isFinite(v) && v > 0) ? v : 0;
  /* Только ISO-8601 (как ts событий и created комментариев). Locale-строки
     вроде proj._clientComments.date парсятся движками по-разному и могут
     зажечь бейдж ложно, поэтому их отбрасываем в 0 (показ без непрочитанного). */
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return 0;
  var t = Date.parse(v);
  return (isFinite(t) && t > 0) ? t : 0;
}

/**
 * Собрать клиентскую активность по всем проектам владельца.
 * Источники: proj._events (selection_approved -> approved, cc_returned ->
 * returned), комментарии карточек author==='client' и проектные
 * _clientComments (-> comment). Сортировка — новые сверху.
 * @param {Array} projects
 * @returns {Array<{projId,projName,kind,label,text,cardName,count,who,when}>}
 */
function acCollectActivity(projects) {
  var out = [];
  if (!projects || !projects.length) return out;

  for (var i = 0; i < projects.length; i++) {
    var proj = projects[i];
    if (!proj) continue;
    var pid = proj._cloudId || proj.name || ('idx' + i);
    var pname = proj.name || 'Без имени';

    /* 1. Журнал событий — клиентские аппрувы и возвраты */
    if (proj._events && proj._events.length) {
      for (var e = 0; e < proj._events.length; e++) {
        var ev = proj._events[e];
        if (!ev) continue;
        var kind = null;
        if (ev.type === 'selection_approved') kind = 'approved';
        else if (ev.type === 'cc_returned') kind = 'returned';
        if (!kind) continue;
        out.push({
          projId: pid, projName: pname, kind: kind,
          label: AC_KIND_LABEL[kind], text: '', cardName: '',
          count: (ev.photos && ev.photos.length) ? ev.photos.length : 0,
          who: (ev.actor && ev.actor.name) ? ev.actor.name : '',
          when: acParseTs(ev.ts)
        });
      }
    }

    /* 2. Комментарии клиента на карточках */
    if (proj.cards && proj.cards.length) {
      for (var c = 0; c < proj.cards.length; c++) {
        var card = proj.cards[c];
        if (!card || !card._comments) continue;
        var cname = card.name || ('Карточка ' + (c + 1));
        for (var k = 0; k < card._comments.length; k++) {
          var cm = card._comments[k];
          if (cm && cm.author === 'client' && cm.text) {
            out.push({
              projId: pid, projName: pname, kind: 'comment',
              label: AC_KIND_LABEL.comment, text: cm.text, cardName: cname,
              count: 0, who: '', when: acParseTs(cm.created)
            });
          }
        }
      }
    }

    /* 3. Проектные клиентские комментарии (доп. запросы) */
    if (proj._clientComments && proj._clientComments.length) {
      for (var q = 0; q < proj._clientComments.length; q++) {
        var pc = proj._clientComments[q];
        if (pc && pc.text) {
          out.push({
            projId: pid, projName: pname, kind: 'comment',
            label: AC_KIND_LABEL.comment, text: pc.text, cardName: '',
            count: 0, who: '', when: acParseTs(pc.date)
          });
        }
      }
    }
  }

  out.sort(function(a, b) { return b.when - a.when; });
  return out;
}

/* Сколько элементов новее метки seenTs (только с валидным временем). */
function acUnreadCount(items, seenTs) {
  if (!items || !items.length) return 0;
  var s = seenTs || 0, n = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].when > 0 && items[i].when > s) n++;
  }
  return n;
}

/* localStorage «последний просмотр» (ms). Безопасно в приватном режиме. */
function acGetSeen() {
  try {
    var v = parseInt(localStorage.getItem(AC_SEEN_KEY), 10);
    return isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}
function acSetSeen(ts) {
  try { localStorage.setItem(AC_SEEN_KEY, String(ts || Date.now())); } catch (e) {}
}

/* Короткая ru-метка даты/времени, '' если времени нет. */
function acTimeLabel(ms) {
  if (!ms || ms <= 0) return '';
  try {
    var d = new Date(ms);
    return d.toLocaleDateString('ru-RU') + ' ' +
      d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

/* HTML одного элемента ленты. isNew -> точка-маркер непрочитанного. */
function acItemHTML(item, seenTs) {
  var isNew = (item.when > 0 && item.when > (seenTs || 0));
  var h = '<div class="ac-item' + (isNew ? ' ac-new' : '') + '">';
  h += '<span class="ac-dot" aria-hidden="true"></span>';
  h += '<div class="ac-item-main">';
  h += '<div class="ac-item-head">';
  h += '<span class="ac-label ac-' + acEsc(item.kind) + '">' + acEsc(item.label) + '</span>';
  h += '<span class="ac-proj">' + acEsc(item.projName) + '</span>';
  h += '</div>';
  var sub = [];
  if (item.kind === 'comment') {
    if (item.cardName) sub.push(acEsc(item.cardName));
  } else if (item.count) {
    sub.push(acEsc(item.count) + ' фото');
  }
  if (item.who) sub.push(acEsc(item.who));
  if (item.text) {
    h += '<div class="ac-text">' + acEsc(item.text) + '</div>';
  }
  var tl = acTimeLabel(item.when);
  h += '<div class="ac-meta">' + (sub.length ? sub.join(' · ') + (tl ? ' · ' : '') : '') + acEsc(tl) + '</div>';
  h += '</div></div>';
  return h;
}

/* HTML всей ленты (или empty-state). */
function acPanelHTML(items, seenTs) {
  if (!items || !items.length) {
    return '<div class="ac-empty ds-meta">Пока нет активности клиентов. ' +
      'Здесь появятся согласования отбора, возвраты на доработку и комментарии ' +
      'по вашим share-ссылкам.</div>';
  }
  var unread = acUnreadCount(items, seenTs);
  var h = '';
  h += '<div class="ac-summary ds-meta">Всего: ' + items.length +
    (unread ? ' · новых: ' + unread : '') + '</div>';
  h += '<div class="ac-list">';
  for (var i = 0; i < items.length; i++) h += acItemHTML(items[i], seenTs);
  h += '</div>';
  return h;
}

/* Обновить бейдж непрочитанного на кнопке вкладки. Owner-only. */
function acRefreshBadge() {
  var badge = document.getElementById('ac-nav-badge');
  if (!badge) return;
  if (window._isShareLink) { badge.style.display = 'none'; return; }
  var projects = (window.App && App.projects) || [];
  var n = acUnreadCount(acCollectActivity(projects), acGetSeen());
  if (n > 0) {
    badge.textContent = (n > 99 ? '99+' : String(n));
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

/* Показ вкладки: отрисовать ленту, пометить всё прочитанным, погасить бейдж. */
function acOnPageShow() {
  var body = document.getElementById('ac-body');
  if (!body) return;
  var projects = (window.App && App.projects) || [];
  var items = acCollectActivity(projects);
  var seen = acGetSeen();
  body.innerHTML = acPanelHTML(items, seen);
  /* Открыли ленту — считаем просмотренным по текущий момент. */
  acSetSeen(Date.now());
  acRefreshBadge();
}

/* Экспорт: в браузере объявленные через function имена уже глобальны;
   для jsdom-теста отдаём их через module.exports. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    acEsc: acEsc, acParseTs: acParseTs, acCollectActivity: acCollectActivity,
    acUnreadCount: acUnreadCount, acGetSeen: acGetSeen, acSetSeen: acSetSeen,
    acTimeLabel: acTimeLabel, acItemHTML: acItemHTML, acPanelHTML: acPanelHTML,
    acRefreshBadge: acRefreshBadge, acOnPageShow: acOnPageShow,
    AC_SEEN_KEY: AC_SEEN_KEY, AC_KIND_LABEL: AC_KIND_LABEL
  };
}
