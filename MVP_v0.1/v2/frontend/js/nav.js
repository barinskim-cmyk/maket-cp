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
  if (name === 'content' && typeof pvOnPageShow === 'function') pvOnPageShow();
}

function showSubpage(name) {
  document.querySelectorAll('.subpage').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.subtab').forEach(function(b) { b.classList.remove('active'); });
  var sub = document.getElementById('subpage-' + name);
  if (sub) sub.classList.add('active');
  var tab = document.getElementById('subtab-' + name);
  if (tab) tab.classList.add('active');

  if (name === 'cp' && typeof pvOnPageShow === 'function') pvOnPageShow();
  if (name === 'other' && typeof ocOnPageShow === 'function') ocOnPageShow();
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
