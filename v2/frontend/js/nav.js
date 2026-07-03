/* ══════════════════════════════════════════════
   nav.js — Навигация по вкладкам + модалки
   ══════════════════════════════════════════════ */

function showPage(name) {
  /* Permission-hardening: гость по share-ссылке не должен попадать на
     админ-вкладки (Артикулы, Синхронизация). Если попытка — редирект на съёмки. */
  if (window._isShareLink && (name === 'articles' || name === 'sync')) {
    name = 'shootings';
  }
  App.currentPage = name;
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  var page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  var nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');

  // Инициализация компонентов при показе страницы
  if (name === 'content') {
    if (typeof pvOnPageShow === 'function') pvOnPageShow();
    /* Перерисовать карточку — layout нуждается в видимом контейнере для расчёта размеров.
       Двойной RAF + setTimeout гарантирует что CSS применён и контейнер имеет реальные размеры. */
    if (typeof cpRenderCard === 'function') {
      setTimeout(function() {
        requestAnimationFrame(function() { cpRenderCard(); });
      }, 50);
    }
  }
  if (name === 'articles') {
    if (typeof arOnPageShow === 'function') arOnPageShow();
  }
  if (name === 'sync') {
    /* Автозаполнить Rate Setter из текущего проекта */
    if (typeof rsAutoFillFromProject === 'function') rsAutoFillFromProject();
  }
}

function showSubpage(name) {
  document.querySelectorAll('.subpage').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.subtab').forEach(function(b) { b.classList.remove('active'); });
  var sub = document.getElementById('subpage-' + name);
  if (sub) sub.classList.add('active');
  var tab = document.getElementById('subtab-' + name);
  if (tab) tab.classList.add('active');

  /* Мобильный клиент: переключение между мобильным режимом и десктопным */
  if (typeof cpIsMobileClient === 'function' && cpIsMobileClient()) {
    if (name === 'cp') {
      /* На вкладке "Карточки товара" активируем мобильный режим */
      if (typeof cpMobileInit === 'function') cpMobileInit();
    } else {
      /* На других вкладках (Отбор, Артикулы) показываем десктопный контент */
      if (typeof cpMobileExitFeed === 'function') cpMobileExitFeed();
    }
  }

  if (name === 'cp') {
    if (typeof pvOnPageShow === 'function') pvOnPageShow();
    /* Перерисовать layout карточки после переключения подвкладки */
    if (typeof cpRenderCard === 'function') {
      setTimeout(function() {
        requestAnimationFrame(function() { cpRenderCard(); });
      }, 50);
    }
  }
  if (name === 'other' && typeof ocOnPageShow === 'function') ocOnPageShow();
  if (name === 'allcontent' && typeof acOnPageShow === 'function') acOnPageShow();
}

// ── Модалки ──

/* Элемент, имевший фокус до открытия модалки — вернуть фокус при закрытии (a11y) */
var navModalPrevFocus = null;

/* Селектор фокусируемых элементов внутри модалки (для focus-trap) */
var NAV_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function openModal(id) {
  var overlay = document.getElementById(id);
  overlay.classList.add('open');
  /* a11y: роль диалога и aria-modal на контейнере модалки */
  var modal = overlay.querySelector('.modal');
  if (modal) {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
  }
  /* Фокус внутрь модалки: первый видимый фокусируемый элемент */
  navModalPrevFocus = document.activeElement;
  var f = navVisibleFocusable(overlay);
  if (f.length) { try { f[0].focus(); } catch (e) {} }
}

/* Видимые фокусируемые элементы внутри контейнера.
   offsetParent не работает для position:fixed — используем getClientRects(). */
function navVisibleFocusable(root) {
  var all = root.querySelectorAll(NAV_FOCUSABLE);
  var vis = [];
  for (var i = 0; i < all.length; i++) {
    if (!all[i].disabled && all[i].getClientRects().length) vis.push(all[i]);
  }
  return vis;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (navModalPrevFocus && navModalPrevFocus.focus) {
    try { navModalPrevFocus.focus(); } catch (e) {}
    navModalPrevFocus = null;
  }
}

/* Открытая модалка (верхняя, если несколько) */
function navOpenOverlay() {
  var open = document.querySelectorAll('.modal-overlay.open');
  return open.length ? open[open.length - 1] : null;
}

// Закрытие по клику вне модалки
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// Escape закрывает верхнюю открытую модалку; Tab не выходит за её пределы (focus-trap)
document.addEventListener('keydown', function(e) {
  var overlay = navOpenOverlay();
  if (!overlay) return;
  if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault();
    closeModal(overlay.id);
    return;
  }
  if (e.key === 'Tab') {
    var vis = navVisibleFocusable(overlay);
    if (!vis.length) return;
    var first = vis[0], last = vis[vis.length - 1];
    var active = document.activeElement;
    /* Если фокус вне модалки — затянуть внутрь */
    if (!overlay.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
});

// ── Тема интерфейса (UI-спека 2026-07: тёмная по умолчанию) ──

/**
 * Установить тему интерфейса и запомнить выбор.
 * @param {string} t — 'dark' | 'light'
 */
function navSetTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('mcp_theme', t); } catch (e) {}
  var bd = document.getElementById('theme-btn-dark');
  var bl = document.getElementById('theme-btn-light');
  if (bd) bd.classList.toggle('active', t === 'dark');
  if (bl) bl.classList.toggle('active', t === 'light');
}

/* Синхронизировать состояние кнопок с темой, применённой до отрисовки */
document.addEventListener('DOMContentLoaded', function() {
  var t = document.documentElement.getAttribute('data-theme') || 'dark';
  navSetTheme(t);
});

// ── Скрытие вкладок для web-версии (beta cleanup c10, c11) ──

/**
 * Скрыть вкладки, доступные только в desktop (pywebview).
 * Rate Setter (Синхронизация) требует Python — скрываем в web.
 * Артикулы работают и в web (загрузка чек-листа, сопоставление, экспорт списка).
 * Вызывается при загрузке; повторно при pywebviewready (чтобы показать если desktop).
 */
function navUpdateTabVisibility() {
  var isDesktop = !!(window.pywebview && window.pywebview.api);
  var syncBtn = document.getElementById('nav-sync');
  var arBtn   = document.getElementById('nav-articles');

  /* Синхронизация — только desktop (нужен Python для записи COS) */
  if (syncBtn) syncBtn.style.display = isDesktop ? '' : 'none';

  /* Артикулы — доступны в desktop и в обычном web-браузере (широкий экран).
     Скрываем только на мобильном (<768px) и при share-ссылке (клиентский просмотр). */
  var isMobileScreen = (window.innerWidth < 768);
  var isShareLink    = !!window._isShareLink;
  if (arBtn) arBtn.style.display = (isMobileScreen || isShareLink) ? 'none' : '';
}

/* Запуск при DOMContentLoaded: скрыть для web */
window.addEventListener('DOMContentLoaded', function() {
  navUpdateTabVisibility();
});

/* Desktop: pywebview API инжектится позже — показать вкладки обратно */
window.addEventListener('pywebviewready', function() {
  navUpdateTabVisibility();
});
