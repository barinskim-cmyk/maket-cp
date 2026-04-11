/* ══════════════════════════════════════════════
   nav.js — Навигация по вкладкам + модалки
   ══════════════════════════════════════════════ */

function showPage(name) {
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

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Закрытие по клику вне модалки
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
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
