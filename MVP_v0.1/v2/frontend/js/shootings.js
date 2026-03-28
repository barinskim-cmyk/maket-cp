/* ══════════════════════════════════════════════
   shootings.js — Проекты + пайплайн
   ══════════════════════════════════════════════

   Зависит от: state.js (App, UserTemplates, getUserTemplate, slotAspectCSS,
               PIPELINE_STAGES, esc, getActiveProject)
   Зависят от него: cards.js (proj.templateId для создания карточек)

   Модалка "Новая съёмка":
   - Бренд, дата
   - Шаблон: выбрать из сохранённых (UserTemplates) или "Начать без шаблона"
   - Мини-превью выбранного шаблона
*/

/**
 * Открыть модалку создания нового проекта.
 * Устанавливает дефолтную дату и заполняет селектор шаблонов.
 */
function openNewProjectModal() {
  document.getElementById('inp-date').value = new Date().toISOString().slice(0, 10);
  populateTemplateSelect();
  openModal('modal-new-project');
}

/**
 * Заполнить select шаблонов из UserTemplates.
 * Первая опция — "Без шаблона (4 вертикали)".
 */
function populateTemplateSelect() {
  var sel = document.getElementById('inp-template');
  sel.innerHTML = '';

  /* Опция: без шаблона */
  var optBlank = document.createElement('option');
  optBlank.value = '';
  optBlank.textContent = 'Без шаблона (4 вертикали)';
  sel.appendChild(optBlank);

  /* Шаблоны пользователя */
  for (var i = 0; i < UserTemplates.length; i++) {
    var t = UserTemplates[i];
    var opt = document.createElement('option');
    opt.value = t.id;
    var aspectInfo = (ASPECT_LABELS[t.hAspect] || '') + '/' + (ASPECT_LABELS[t.vAspect] || '');
    opt.textContent = t.name + ' (' + t.slots.length + ', ' + aspectInfo + ')';
    sel.appendChild(opt);
  }

  /* Слушатель для превью */
  sel.onchange = function() { renderTemplatePreview(sel.value); };
  renderTemplatePreview(sel.value);
}

/**
 * Отрисовать мини-превью шаблона (схематичные прямоугольники).
 *
 * Логика повторяет layout-движок cards.js:
 * - main + h: отдельная строка сверху + остальные снизу
 * - main + v: один ряд, main занимает 2 ячейки
 * - без main: все в один ряд
 *
 * @param {string} templateId — id шаблона или '' (без шаблона)
 */
function renderTemplatePreview(templateId) {
  var el = document.getElementById('tmpl-preview');
  if (!el) return;

  /* Без шаблона: 4 вертикали */
  var slots, hAspect = '3/2', vAspect = '2/3';
  if (!templateId) {
    slots = [
      { orient: 'v', main: false },
      { orient: 'v', main: false },
      { orient: 'v', main: false },
      { orient: 'v', main: false }
    ];
  } else {
    var t = getUserTemplate(templateId);
    if (!t) { el.innerHTML = ''; return; }
    slots = t.slots;
    hAspect = t.hAspect || '3/2';
    vAspect = t.vAspect || '2/3';
  }

  /* Найти hero (slot с weight > 1) */
  var heroIdx = -1;
  for (var i = 0; i < slots.length; i++) {
    if ((slots[i].weight || 1) > 1) { heroIdx = i; break; }
  }

  var html = '<div class="tmpl-mini">';

  if (heroIdx >= 0 && slots[heroIdx].orient === 'h') {
    /* Книжная: hero-H сверху + остальные снизу */
    html += '<div class="tmpl-mini-top"><div class="tmpl-mini-slot h" style="aspect-ratio:' + hAspect + '"></div></div>';
    html += '<div class="tmpl-mini-bottom">';
    for (var i = 0; i < slots.length; i++) {
      if (i === heroIdx) continue;
      var a = slots[i].orient === 'h' ? hAspect : vAspect;
      html += '<div class="tmpl-mini-slot v" style="aspect-ratio:' + a + '"></div>';
    }
    html += '</div>';
  } else if (heroIdx >= 0 && slots[heroIdx].orient === 'v') {
    /* Альбомная: hero-V слева + остальные справа */
    html += '<div class="tmpl-mini-row">';
    html += '<div class="tmpl-mini-slot v hero" style="aspect-ratio:' + vAspect + ';flex:2"></div>';
    var restWrap = '<div style="display:flex;flex-wrap:wrap;gap:2px;flex:3">';
    for (var i = 0; i < slots.length; i++) {
      if (i === heroIdx) continue;
      var a = slots[i].orient === 'h' ? hAspect : vAspect;
      restWrap += '<div class="tmpl-mini-slot v" style="aspect-ratio:' + a + '"></div>';
    }
    restWrap += '</div>';
    html += restWrap;
    html += '</div>';
  } else {
    /* Без hero: один ряд */
    html += '<div class="tmpl-mini-row">';
    for (var i = 0; i < slots.length; i++) {
      var cls2 = slots[i].orient === 'h' ? 'h' : 'v';
      var a2 = slots[i].orient === 'h' ? hAspect : vAspect;
      html += '<div class="tmpl-mini-slot ' + cls2 + '" style="aspect-ratio:' + a2 + '"></div>';
    }
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

/**
 * Создать новый проект с выбранным шаблоном карточки.
 *
 * Шаблон сохраняется как templateId в проекте.
 * cards.js использует proj.templateId → getUserTemplate() для создания карточек.
 *
 * В desktop-режиме вызывает Python API new_project().
 * В браузерном фолбэке создаёт объект локально.
 */
async function createProject() {
  var brand = document.getElementById('inp-brand').value.trim();
  var date = document.getElementById('inp-date').value;
  var templateId = document.getElementById('inp-template').value; /* '' = без шаблона */
  if (!brand) { alert('Введите бренд'); return; }

  closeModal('modal-new-project');

  try {
    if (window.pywebview && window.pywebview.api) {
      var data = await window.pywebview.api.new_project(brand, date, templateId);
      if (data) {
        data._stage = 0;
        data.templateId = templateId;
        App.projects.push(data);
        App.selectedProject = App.projects.length - 1;
        renderProjects();
      }
    } else {
      /* Браузерный фолбэк */
      var proj = {
        brand: brand,
        shoot_date: date,
        templateId: templateId,
        categories: [],
        channels: [],
        cards: [],
        _stage: 0,
        _stageHistory: []
      };
      App.projects.push(proj);
      App.selectedProject = App.projects.length - 1;
      renderProjects();
    }
  } catch(e) {
    alert('Ошибка: ' + e);
  }
}

/**
 * Загрузить существующий проект из файла (desktop only).
 * Вызывает Python API load_project(), который показывает диалог выбора файла.
 */
async function loadProject() {
  try {
    if (window.pywebview && window.pywebview.api) {
      var data = await window.pywebview.api.load_project();
      if (data && !data.cancelled) {
        data._stage = data._stage || 0;
        /* Обратная совместимость: старый формат template → templateId */
        if (data.template && typeof data.template === 'object' && !data.templateId) {
          data.templateId = data.template.id || '';
        }
        App.projects.push(data);
        App.selectedProject = App.projects.length - 1;
        renderProjects();
      }
    }
  } catch(e) {
    alert('Ошибка: ' + e);
  }
}

/**
 * Выбрать проект по индексу. Сбрасывает текущую карточку.
 * @param {number} idx
 */
function selectProject(idx) {
  App.selectedProject = idx;
  App.currentCardIdx = -1;
  renderProjects();
}

/**
 * Отрисовать список проектов и обновить пайплайн + карточки.
 */
function renderProjects() {
  var list = document.getElementById('project-list');
  if (App.projects.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет открытых проектов</div>';
    document.getElementById('pipeline-container').innerHTML =
      '<div class="empty-state">Выберите съёмку</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < App.projects.length; i++) {
    var p = App.projects[i];
    var sel = i === App.selectedProject ? ' selected' : '';
    var cardsCount = p.cards ? p.cards.length : 0;
    html += '<div class="project-item' + sel + '" onclick="selectProject(' + i + ')">';
    html += '<span class="project-brand">' + esc(p.brand) + '</span>';
    html += '<span class="project-date">' + esc(p.shoot_date) + '</span>';
    html += '<span class="project-stats">' + cardsCount + ' карт.</span>';
    html += '</div>';
  }
  list.innerHTML = html;

  renderPipeline();
  cpRenderList();
}


// ══════════════════════════════════════════════
//  Пайплайн
// ══════════════════════════════════════════════

/**
 * Отрисовать визуальный пайплайн (8 этапов) для выбранного проекта.
 * Этапы: done → active → будущие. Активный этап имеет кнопку "Завершить".
 */
function renderPipeline() {
  var container = document.getElementById('pipeline-container');
  if (App.selectedProject < 0 || App.selectedProject >= App.projects.length) {
    container.innerHTML = '<div class="empty-state">Выберите съёмку</div>';
    return;
  }

  var proj = App.projects[App.selectedProject];
  var stage = proj._stage || 0;

  var html = '<div class="pipeline-steps">';
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var s = PIPELINE_STAGES[i];
    var cls = '';
    if (i < stage) cls = 'done';
    else if (i === stage) cls = 'active';

    html += '<div class="pipeline-step ' + cls + '">';
    html += '<div class="step-dot">' + (i < stage ? '&#10003;' : (i + 1)) + '</div>';
    html += '<div class="step-info">';
    html += '<div class="step-name">' + esc(s.name) + '</div>';
    if (i === stage) {
      html += '<button class="step-action" onclick="advanceStage()">Завершить этап</button>';
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Перейти к следующему этапу пайплайна.
 * TODO (задача 1.12): добавить проверку триггеров перед переходом.
 */
function advanceStage() {
  if (App.selectedProject < 0) return;
  var proj = App.projects[App.selectedProject];
  if (proj._stage < PIPELINE_STAGES.length - 1) {
    proj._stage++;
  } else {
    proj._stage = PIPELINE_STAGES.length;
  }
  renderPipeline();
}
