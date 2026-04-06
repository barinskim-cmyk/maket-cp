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
 * Сформировать отображаемое имя проекта: Brand_YYYY_MM_DD.
 * @param {object} proj - проект с полями brand, shoot_date
 * @returns {string} отформатированное имя
 */
function shProjectDisplayName(proj) {
  if (!proj) return '';
  var brand = (proj.brand || '').trim();
  var date = (proj.shoot_date || '').trim();
  if (!brand && !date) return 'Без названия';
  if (!date) return brand;
  /* date приходит как YYYY-MM-DD, преобразуем в YYYY_MM_DD */
  var formatted = date.replace(/-/g, '_');
  if (!brand) return formatted;
  return brand + '_' + formatted;
}

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
 * Шаблон сохраняется как templateId и полная копия в proj._template.
 * cards.js использует proj._template (если существует) или proj.templateId → getUserTemplate().
 *
 * В desktop-режиме вызывает Python API new_project().
 * В браузерном фолбэке создаёт объект локально.
 */
function createProject() {
  var brand = document.getElementById('inp-brand').value.trim();
  var date = document.getElementById('inp-date').value;
  var templateId = document.getElementById('inp-template').value; /* '' = без шаблона */
  if (!brand) { alert('Введите бренд'); return; }

  closeModal('modal-new-project');

  /**
   * Общая логика после получения данных проекта.
   * @param {Object} data — данные проекта (из Python или браузерный фолбэк)
   */
  function onProjectData(data) {
    data._stage = 0;
    data.templateId = templateId;
    if (templateId) {
      var tmpl = getUserTemplate(templateId);
      if (tmpl) data._template = templateToProjFormat(tmpl);
    }
    App.projects.push(data);
    App.selectedProject = App.projects.length - 1;
    renderProjects();
    shAutoSave();
  }

  if (window.pywebview && window.pywebview.api) {
    /* Desktop: вызов Python API (возвращает Promise) */
    try {
      var result = window.pywebview.api.new_project(brand, date, templateId);
      if (result && typeof result.then === 'function') {
        result.then(function(data) {
          if (data) onProjectData(data);
        })['catch'](function(e) { alert('Ошибка: ' + e); });
      } else if (result) {
        onProjectData(result);
      }
    } catch(e) { alert('Ошибка: ' + e); }
  } else {
    /* Браузерный фолбэк */
    onProjectData({
      brand: brand,
      shoot_date: date,
      categories: [],
      channels: [],
      cards: [],
      _stageHistory: {}
    });
  }
}

/**
 * Загрузить существующий проект из файла (desktop only).
 * Вызывает Python API load_project(), который показывает диалог выбора файла.
 */
function loadProject() {
  if (!window.pywebview || !window.pywebview.api) return;

  try {
    var result = window.pywebview.api.load_project();
    if (result && typeof result.then === 'function') {
      result.then(function(data) {
        if (data && !data.cancelled) {
          data._stage = data._stage || 0;
          if (data.template && typeof data.template === 'object' && !data.templateId) {
            data.templateId = data.template.id || '';
          }
          App.projects.push(data);
          App.selectedProject = App.projects.length - 1;
          renderProjects();
        }
      })['catch'](function(e) { alert('Ошибка: ' + e); });
    } else if (result && !result.cancelled) {
      result._stage = result._stage || 0;
      if (result.template && typeof result.template === 'object' && !result.templateId) {
        result.templateId = result.template.id || '';
      }
      App.projects.push(result);
      App.selectedProject = App.projects.length - 1;
      renderProjects();
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

  /* Восстановить активную версию превью из проекта */
  var proj = (idx >= 0 && idx < App.projects.length) ? App.projects[idx] : null;
  if (proj && proj._activeVersion && typeof PV_ACTIVE_VERSION !== 'undefined') {
    PV_ACTIVE_VERSION = proj._activeVersion;
  } else if (typeof PV_ACTIVE_VERSION !== 'undefined') {
    PV_ACTIVE_VERSION = '';
  }

  renderProjects();

  /* Запустить авто-синхронизацию из облака для облачного проекта */
  if (typeof sbStartAutoPull === 'function') sbStartAutoPull();

  /* Подписаться на realtime-обновления версий (для веб-клиента) */
  if (proj && proj._cloudId && typeof sbSubscribeVersions === 'function') {
    sbSubscribeVersions(proj._cloudId);
  }
}

// ══════════════════════════════════════════════
//  Экспорт / импорт проекта (.maketcp файл)
//
//  .maketcp = JSON файл с полными данными проекта:
//  - метаданные (brand, shoot_date, stage, template и т.д.)
//  - карточки со слотами
//  - превью (thumb + preview base64) включая все версии
//  - аннотации ретуши
//  - OC контейнеры
//  - история пайплайна
//
//  Используется для:
//  - Архивации проектов старше 3 месяцев (экономия облака)
//  - Передачи проекта между устройствами
//  - Бэкапа
//  - Бета-тестирования (тестер присылает проект разработчику)
// ══════════════════════════════════════════════

/**
 * Экспортировать текущий проект в .maketcp файл.
 * Собирает все данные включая превью из IndexedDB.
 */
function shExportProject() {
  var proj = getActiveProject();
  if (!proj) { alert('Нет активного проекта'); return; }

  /* Собрать полный snapshot проекта */
  var exportData = {
    _format: 'maketcp',
    _version: 1,
    _exportDate: new Date().toISOString(),
    brand: proj.brand || '',
    shoot_date: proj.shoot_date || '',
    templateId: proj.templateId || '',
    _template: proj._template || null,
    _stage: proj._stage || 0,
    _stageHistory: proj._stageHistory || {},
    channels: proj.channels || [],
    categories: proj.categories || [],
    _annotations: proj._annotations || {},
    cards: [],
    previews: [],
    ocContainers: proj.ocContainers || [],
    otherContent: proj.otherContent || []
  };

  /* Карточки: полные данные */
  if (proj.cards) {
    for (var c = 0; c < proj.cards.length; c++) {
      var card = proj.cards[c];
      var cardCopy = {};
      for (var k in card) {
        if (card.hasOwnProperty(k)) cardCopy[k] = card[k];
      }
      exportData.cards.push(cardCopy);
    }
  }

  /* Превью: включая все версии и полные base64 */
  if (proj.previews) {
    for (var p = 0; p < proj.previews.length; p++) {
      var pv = proj.previews[p];
      var pvCopy = {
        name: pv.name,
        path: pv.path || '',
        thumb: pv.thumb || '',
        preview: pv.preview || '',
        rating: pv.rating || 0,
        orient: pv.orient || 'v',
        folders: pv.folders || []
      };
      if (pv.versions) pvCopy.versions = pv.versions;
      exportData.previews.push(pvCopy);
    }
  }

  /* Генерировать JSON и скачать */
  var json = JSON.stringify(exportData);
  var blob = new Blob([json], { type: 'application/json' });
  var filename = (proj.brand || 'project').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_') + '_' + (proj.shoot_date || 'export') + '.maketcp';

  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('Экспорт: ' + filename + ' (' + Math.round(json.length / 1024) + ' KB)');
}

/**
 * Импортировать проект из .maketcp файла.
 * Открывает диалог выбора файла, парсит JSON, добавляет в App.projects.
 */
function shImportProject() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.maketcp,.json';
  input.onchange = function() {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (data._format !== 'maketcp') {
          alert('Неизвестный формат файла');
          return;
        }

        /* Восстановить проект */
        var proj = {
          brand: data.brand || 'Импортированный',
          shoot_date: data.shoot_date || '',
          templateId: data.templateId || '',
          _template: data._template || null,
          _stage: data._stage || 0,
          _stageHistory: data._stageHistory || {},
          channels: data.channels || [],
          categories: data.categories || [],
          _annotations: data._annotations || {},
          cards: data.cards || [],
          previews: data.previews || [],
          ocContainers: data.ocContainers || [],
          otherContent: data.otherContent || []
        };

        App.projects.push(proj);
        App.selectedProject = App.projects.length - 1;
        renderProjects();

        /* Сохранить превью в IndexedDB */
        if (typeof pvDbSaveProjectPreviews === 'function') {
          pvDbSaveProjectPreviews(proj);
        }

        /* Автосохранение */
        if (typeof shAutoSave === 'function') shAutoSave();

        console.log('Импорт: ' + proj.brand + ' (' + (proj.previews ? proj.previews.length : 0) + ' превью, ' + (proj.cards ? proj.cards.length : 0) + ' карточек)');
        alert('Проект "' + proj.brand + '" импортирован');
      } catch(e) {
        alert('Ошибка чтения файла: ' + e.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/**
 * Отрисовать список проектов и обновить пайплайн + карточки.
 */
/** @type {boolean} Показывать ли скрытые (удалённые) проекты */
var shShowHidden = false;

/**
 * Переключить видимость скрытых проектов.
 */
function shToggleHidden() {
  shShowHidden = !shShowHidden;
  var cb = document.getElementById('sh-show-hidden');
  if (cb) cb.checked = shShowHidden;
  renderProjects();
}

/**
 * Получить отфильтрованный список проектов (без удалённых, если не включён фильтр).
 * Возвращает массив объектов { project, originalIndex }.
 */
function shFilteredProjects() {
  var result = [];
  for (var i = 0; i < App.projects.length; i++) {
    var p = App.projects[i];
    if (p._deletedAt && !shShowHidden) continue;
    result.push({ project: p, originalIndex: i });
  }
  return result;
}

/**
 * Soft-удаление проекта: помечаем _deletedAt, синхронизируем с облаком.
 * Проект не удаляется из массива — только скрывается.
 * @param {number} originalIdx — индекс в App.projects
 */
function shDeleteProject(originalIdx) {
  var proj = App.projects[originalIdx];
  if (!proj) return;

  var name = shProjectDisplayName(proj);
  if (!confirm('Скрыть проект "' + name + '"?\nПроект можно восстановить через фильтр "Показать скрытые".')) return;

  proj._deletedAt = new Date().toISOString();

  /* Если удалённый проект был выбранным — сбросить выделение */
  if (App.selectedProject === originalIdx) {
    App.selectedProject = -1;
    App.currentCardIdx = -1;
    /* Выбрать первый видимый проект */
    var visible = shFilteredProjects();
    if (visible.length > 0) {
      App.selectedProject = visible[0].originalIndex;
    }
  }

  /* Синхронизация soft delete с облаком */
  if (proj._cloudId && typeof sbSoftDeleteProject === 'function') {
    sbSoftDeleteProject(proj._cloudId, function(err) {
      if (err) console.warn('shDeleteProject: cloud sync error:', err);
    });
  }

  shAutoSave();
  renderProjects();
}

/**
 * Восстановить soft-удалённый проект.
 * @param {number} originalIdx — индекс в App.projects
 */
function shRestoreProject(originalIdx) {
  var proj = App.projects[originalIdx];
  if (!proj) return;

  delete proj._deletedAt;

  /* Восстановить в облаке */
  if (proj._cloudId && typeof sbRestoreProject === 'function') {
    sbRestoreProject(proj._cloudId, function(err) {
      if (err) console.warn('shRestoreProject: cloud sync error:', err);
    });
  }

  shAutoSave();
  renderProjects();
}

function renderProjects() {
  var list = document.getElementById('project-list');
  var filtered = shFilteredProjects();

  /* Обновить счётчик скрытых */
  var hiddenCount = 0;
  for (var h = 0; h < App.projects.length; h++) {
    if (App.projects[h]._deletedAt) hiddenCount++;
  }
  var hiddenLabel = document.getElementById('sh-hidden-label');
  if (hiddenLabel) {
    hiddenLabel.textContent = 'Показать скрытые (' + hiddenCount + ')';
    var hiddenWrap = document.getElementById('sh-hidden-wrap');
    if (hiddenWrap) hiddenWrap.style.display = hiddenCount > 0 ? '' : 'none';
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">' +
      (hiddenCount > 0 ? 'Все проекты скрыты' : 'Нет открытых проектов') + '</div>';
    document.getElementById('pipeline-container').innerHTML =
      '<div class="empty-state">Выберите съёмку</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var entry = filtered[i];
    var p = entry.project;
    var sel = entry.originalIndex === App.selectedProject ? ' selected' : '';
    var isDeleted = !!p._deletedAt;
    var cardsCount = p.cards ? p.cards.length : 0;
    html += '<div class="project-item' + sel + (isDeleted ? ' project-deleted' : '') + '" onclick="selectProject(' + entry.originalIndex + ')">';
    html += '<span class="project-brand">' + esc(shProjectDisplayName(p)) + '</span>';
    if (p._shared) html += '<span class="project-shared-tag">общий</span>';
    html += '<span class="project-stats">' + cardsCount + ' карт.</span>';
    if (isDeleted) {
      html += '<button class="btn btn-sm project-restore-btn" onclick="event.stopPropagation(); shRestoreProject(' + entry.originalIndex + ')" title="Восстановить">Восстановить</button>';
    } else {
      html += '<button class="btn btn-sm project-delete-btn" onclick="event.stopPropagation(); shDeleteProject(' + entry.originalIndex + ')" title="Скрыть проект">X</button>';
    }
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

  /* Кнопка синхронизации (если проект в облаке) */
  var html = '';
  if (proj._cloudId) {
    html += '<div class="pipeline-sync-bar">';
    html += '<span id="pipeline-sync-status" style="font-size:11px;color:#999">Облако</span>';
    html += ' <button class="btn btn-sm" onclick="sbPullProject(function(e){var s=document.getElementById(\'pipeline-sync-status\');if(s)s.textContent=e?\'Ошибка\':\'Обновлено\';setTimeout(function(){if(s)s.textContent=\'Облако\'},2000)})" style="font-size:11px;padding:2px 8px">Синхронизировать</button>';
    html += ' <button class="btn btn-sm" onclick="shOpenProjectMembersModal()" style="font-size:11px;padding:2px 8px">Участники</button>';
    html += '</div>';
  }

  html += '<div class="pipeline-steps">';
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var s = PIPELINE_STAGES[i];

    var cls = '';
    if (i < stage) cls = 'done';
    else if (i === stage) cls = 'active';

    /* Активный снимок-контекст: подсветить соответствующий этап */
    var isSnapshotCtx = (typeof _snActiveSnapshot !== 'undefined' && _snActiveSnapshot &&
      _snActiveSnapshot.stageId === s.id);
    if (isSnapshotCtx) cls += ' sn-active-stage';

    /* Завершённые этапы — кликабельны для загрузки снимка */
    var clickable = (i < stage && proj._cloudId);
    html += '<div class="pipeline-step ' + cls + (clickable ? ' step-clickable' : '') + '"' +
      (clickable ? ' onclick="shLoadStageSnapshot(\'' + s.id + '\')" title="Посмотреть состояние на этом этапе"' : '') + '>';
    html += '<div class="step-dot">' + (i < stage ? '&#10003;' : (i + 1)) + '</div>';
    html += '<div class="step-info">';
    html += '<div class="step-name">' + esc(s.name) + '</div>';

    /* Показать время завершения этапа (если есть в истории) */
    if (i < stage && proj._stageHistory && proj._stageHistory[i]) {
      var ts = proj._stageHistory[i];
      html += '<div class="step-note">' + ts + '</div>';
    }

    if (i === stage) {
      html += '<button class="step-action" onclick="advanceStage()">Завершить этап</button>';
      /* На этапе "Отбор фотографа" (1) -- кнопка отправки ссылки клиенту */
      if (s.id === 'selection') {
        html += '<button class="step-action" style="border-color:#333;color:#333;margin-left:6px" onclick="shSendClientLink()">Ссылка на преотбор</button>';
      }
    }

    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  /* Кнопка сверки: если есть хотя бы 2 снимка */
  if (proj._cloudId && typeof _snCachedSnapshots !== 'undefined' && _snCachedSnapshots.length >= 2) {
    html += '<div style="margin-top:8px">';
    html += '<button class="btn btn-sm" onclick="shOpenDiffMode()" style="font-size:11px;padding:2px 8px">Сверка состояний</button>';
    html += '</div>';
  }

  container.innerHTML = html;
}

/**
 * Загрузить снимок для конкретного этапа и установить его как активный контекст.
 * Кликается из пайплайна.
 *
 * @param {string} stageId — 'preselect', 'selection', 'client', ...
 */
function shLoadStageSnapshot(stageId) {
  /* Если уже смотрим этот этап — вернуться к текущему */
  if (typeof _snActiveSnapshot !== 'undefined' && _snActiveSnapshot &&
      _snActiveSnapshot.stageId === stageId) {
    snSetActiveContext(null);
    renderPipeline();
    return;
  }

  /* Ищем в кэше */
  if (typeof _snCachedSnapshots !== 'undefined' && _snCachedSnapshots.length > 0) {
    var found = _findSnapshotForStage(stageId);
    if (found) {
      /* Нормализуем stageId для удобства */
      found.stageId = found.stage_id || stageId;
      snSetActiveContext(found);
      renderPipeline();
      return;
    }
  }

  /* Кэш пуст — загрузить с сервера */
  if (typeof snLoadSnapshots === 'function') {
    snLoadSnapshots(function(err, snaps) {
      if (err) { console.warn('shLoadStageSnapshot:', err); return; }
      _snCachedSnapshots = snaps || [];
      var found = _findSnapshotForStage(stageId);
      if (found) {
        found.stageId = found.stage_id || stageId;
        snSetActiveContext(found);
      } else {
        alert('Снимок для этого этапа ещё не создан. Снимки создаются при согласовании.');
      }
      renderPipeline();
    });
  }
}

/**
 * Найти последний снимок для указанного этапа.
 * @param {string} stageId
 * @returns {object|null}
 * @private
 */
function _findSnapshotForStage(stageId) {
  if (!_snCachedSnapshots || !_snCachedSnapshots.length) return null;
  /* Ищем последний снимок с этим stage_id */
  var found = null;
  for (var i = 0; i < _snCachedSnapshots.length; i++) {
    if (_snCachedSnapshots[i].stage_id === stageId) {
      found = _snCachedSnapshots[i];
    }
  }
  return found;
}

/**
 * Открыть режим сверки (diff mode): выбрать два снимка и показать различия.
 */
function shOpenDiffMode() {
  if (typeof _snCachedSnapshots === 'undefined' || _snCachedSnapshots.length < 2) {
    /* Загрузить если нет в кэше */
    if (typeof snLoadSnapshots === 'function') {
      snLoadSnapshots(function(err, snaps) {
        if (err) { alert('Ошибка загрузки снимков: ' + err); return; }
        _snCachedSnapshots = snaps || [];
        if (_snCachedSnapshots.length < 2) {
          alert('Для сверки нужно минимум 2 снимка. Пока создано: ' + _snCachedSnapshots.length);
          return;
        }
        _shShowDiffModal();
      });
    }
    return;
  }
  _shShowDiffModal();
}

/**
 * Показать модалку выбора двух снимков для сверки.
 * @private
 */
function _shShowDiffModal() {
  var triggerLabels = {
    'client_approved': 'Согласование клиента',
    'client_changes': 'Изменения клиента',
    'client_edit_start': 'До изменений клиента',
    'manual_advance': 'Переход этапа',
    'manual': 'Ручной снимок'
  };

  var optionsHtml = '';
  for (var i = 0; i < _snCachedSnapshots.length; i++) {
    var sn = _snCachedSnapshots[i];
    var label = triggerLabels[sn.trigger] || sn.trigger;
    var d = new Date(sn.created_at);
    var dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    optionsHtml += '<option value="' + i + '">' + label + ' (' + dateStr + ')' + (sn.note ? ' -- ' + esc(sn.note) : '') + '</option>';
  }

  /* Добавить вариант "Текущее состояние" */
  optionsHtml += '<option value="current">Текущее состояние</option>';

  var html = '<div class="sn-diff-modal-body">' +
    '<p style="margin:0 0 12px 0;font-size:13px">Выберите два состояния для сравнения:</p>' +
    '<div style="display:flex;gap:12px;margin-bottom:16px">' +
      '<div style="flex:1">' +
        '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Было (до)</label>' +
        '<select id="sn-diff-before" style="width:100%;padding:6px;font-size:12px">' + optionsHtml + '</select>' +
      '</div>' +
      '<div style="flex:1">' +
        '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Стало (после)</label>' +
        '<select id="sn-diff-after" style="width:100%;padding:6px;font-size:12px">' + optionsHtml + '</select>' +
      '</div>' +
    '</div>' +
    '<div id="sn-diff-result" style="max-height:300px;overflow-y:auto"></div>' +
    '<div style="margin-top:12px;text-align:right">' +
      '<button class="btn" onclick="closeModal(\'modal-diff\')">Закрыть</button>' +
      '<button class="btn btn-primary" style="margin-left:8px" onclick="_shRunDiff()">Сравнить</button>' +
    '</div>' +
  '</div>';

  /* Используем openModal если доступен, иначе создаём свой */
  var modal = document.getElementById('modal-diff');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-diff';
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3>Сверка состояний</h3><button class="modal-close" onclick="closeModal(\'modal-diff\')">&times;</button></div><div id="diff-content"></div></div>';
    document.body.appendChild(modal);
  }
  var contentEl = document.getElementById('diff-content');
  if (contentEl) contentEl.innerHTML = html;

  /* Выбрать по умолчанию: первый и последний снимок */
  var selBefore = document.getElementById('sn-diff-before');
  var selAfter = document.getElementById('sn-diff-after');
  if (selBefore) selBefore.value = '0';
  if (selAfter) selAfter.value = 'current';

  if (typeof openModal === 'function') openModal('modal-diff');
}

/**
 * Выполнить сравнение выбранных снимков и отобразить результат.
 * @private
 */
function _shRunDiff() {
  var selBefore = document.getElementById('sn-diff-before');
  var selAfter = document.getElementById('sn-diff-after');
  if (!selBefore || !selAfter) return;

  var beforeData, afterData;

  if (selBefore.value === 'current') {
    beforeData = (typeof snBuildSnapshotData === 'function') ? snBuildSnapshotData() : { cards: [], ocContainers: [] };
  } else {
    beforeData = _snCachedSnapshots[parseInt(selBefore.value)].data;
  }

  if (selAfter.value === 'current') {
    afterData = (typeof snBuildSnapshotData === 'function') ? snBuildSnapshotData() : { cards: [], ocContainers: [] };
  } else {
    afterData = _snCachedSnapshots[parseInt(selAfter.value)].data;
  }

  if (typeof snCompareSnapshots !== 'function') {
    alert('Функция сравнения не найдена');
    return;
  }

  var diff = snCompareSnapshots(beforeData, afterData);
  var resultEl = document.getElementById('sn-diff-result');
  if (!resultEl) return;

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.moved.length === 0) {
    resultEl.innerHTML = '<div style="text-align:center;color:#888;padding:20px">Различий не найдено</div>';
    return;
  }

  var html = '';

  if (diff.added.length > 0) {
    html += '<div class="sn-diff-section">';
    html += '<div class="sn-diff-title sn-diff-added-title">Добавлено (' + diff.added.length + ')</div>';
    html += '<div class="sn-diff-files">';
    for (var a = 0; a < diff.added.length; a++) {
      html += '<span class="sn-diff-file sn-diff-file-added">' + esc(diff.added[a]) + '</span>';
    }
    html += '</div></div>';
  }

  if (diff.removed.length > 0) {
    html += '<div class="sn-diff-section">';
    html += '<div class="sn-diff-title sn-diff-removed-title">Удалено (' + diff.removed.length + ')</div>';
    html += '<div class="sn-diff-files">';
    for (var r = 0; r < diff.removed.length; r++) {
      html += '<span class="sn-diff-file sn-diff-file-removed">' + esc(diff.removed[r]) + '</span>';
    }
    html += '</div></div>';
  }

  if (diff.moved.length > 0) {
    html += '<div class="sn-diff-section">';
    html += '<div class="sn-diff-title">Перемещено (' + diff.moved.length + ')</div>';
    html += '<div class="sn-diff-files">';
    for (var m = 0; m < diff.moved.length; m++) {
      var mv = diff.moved[m];
      var fromLabel = mv.from.location === 'card' ? ('Карточка ' + (mv.from.card + 1)) : ('Контейнер ' + (mv.from.containerName || ''));
      var toLabel = mv.to.location === 'card' ? ('Карточка ' + (mv.to.card + 1)) : ('Контейнер ' + (mv.to.containerName || ''));
      html += '<span class="sn-diff-file sn-diff-file-moved">' + esc(mv.file) + ' <span style="color:#888;font-size:10px">' + fromLabel + ' -> ' + toLabel + '</span></span>';
    }
    html += '</div></div>';
  }

  resultEl.innerHTML = html;
}

/**
 * Перейти к следующему этапу пайплайна.
 * Записывает время завершения в _stageHistory.
 * TODO (задача 1.12): добавить проверку триггеров перед переходом.
 */
function advanceStage() {
  if (App.selectedProject < 0) return;
  var proj = App.projects[App.selectedProject];
  if (proj._stage >= PIPELINE_STAGES.length) return;

  var currentStageObj = PIPELINE_STAGES[proj._stage];

  /* Записать время завершения этапа */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj._stageHistory[proj._stage] = timeStr;

  proj._stage++;
  renderPipeline();
  shAutoSave();

  /* Синхронизация этапа с облаком */
  if (typeof sbSyncStage === 'function') sbSyncStage('manual_advance', timeStr);
}

/**
 * Отправить ссылку на преотбор клиенту.
 * 1. Загружает проект в облако (если ещё не загружен)
 * 2. Создаёт share link с ролью client
 * 3. Фиксирует этап "Отбор фотографа" + время
 * 4. Переводит на этап "Отбор клиента"
 */
function shSendClientLink() {
  var proj = getActiveProject();
  if (!proj) { alert('Выберите проект'); return; }

  if (!sbIsLoggedIn()) { openModal('modal-login'); return; }

  /* Шаг 1: убедиться что проект в облаке */
  var doCreate = function() {
    var cloudId = proj._cloudId;
    if (!cloudId) {
      alert('Сначала загрузите проект в облако (кнопка "В облако")');
      return;
    }

    /* Шаг 2: создать share link для клиента */
    sbCreateShareLink(cloudId, 'client', 'Преотбор для клиента', function(err, data) {
      if (err) { alert('Ошибка создания ссылки: ' + err); return; }

      /* Шаг 3: зафиксировать этап + время */
      if (!proj._stageHistory) proj._stageHistory = {};
      var now = new Date();
      var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      proj._stageHistory[proj._stage] = timeStr;

      /* Шаг 4: перейти к этапу "Отбор клиента" */
      proj._stage = 2; /* client */
      renderPipeline();
      shAutoSave();

      /* Синхронизация этапа с облаком */
      if (typeof sbSyncStage === 'function') sbSyncStage('send_client_link', timeStr);

      /* Показать ссылку */
      var url = data.url;
      prompt('Ссылка для клиента (скопируйте):', url);
    });
  };

  /* Если проект ещё не в облаке -- загрузить сначала */
  if (!proj._cloudId) {
    var statusEl = document.getElementById('cloud-status');
    if (statusEl) statusEl.textContent = 'Загрузка...';
    sbUploadProject(App.selectedProject, function(err, cloudId) {
      if (err) {
        alert('Ошибка загрузки в облако: ' + err);
        if (statusEl) statusEl.textContent = 'Ошибка';
        return;
      }
      if (statusEl) statusEl.textContent = 'Синхронизировано';
      doCreate();
    });
  } else {
    doCreate();
  }
}


// ══════════════════════════════════════════════
//  Автосохранение (browser: localStorage, desktop: файл)
// ══════════════════════════════════════════════

/** @type {string} localStorage key для автосохранения проектов */
var SH_AUTOSAVE_KEY = 'maketcp_projects';

/** @type {number|null} Таймер debounce для автосохранения */
var _shAutoSaveTimer = null;

/** @type {number} Задержка автосохранения (мс) */
var SH_AUTOSAVE_DELAY = 2000;

/**
 * Запланировать автосохранение (debounce 2 сек).
 * Вызывается после значимых действий: drop фото, удаление, смена этапа и т.д.
 * Сохраняет в localStorage + автоматически синхронизирует с облаком.
 *
 * ВАЖНО: автосинхронизация с облаком ОТКЛЮЧЕНА.
 * Облако = источник правды. Запись в облако только при явных действиях
 * пользователя (кнопка "Поделиться", drop фото и т.д.).
 * Автосохранение работает только в localStorage.
 */
function shAutoSave() {
  if (_shAutoSaveTimer) clearTimeout(_shAutoSaveTimer);
  _shAutoSaveTimer = setTimeout(function() {
    _shAutoSaveTimer = null;
    _shDoAutoSave();

    /* Авто-синхронизация с облаком ОТКЛЮЧЕНА.
       Облако обновляется только при явных действиях пользователя:
       - drop фото в слот
       - удаление/добавление карточки
       - смена этапа пайплайна
       Это предотвращает перезапись облачных данных пустой локальной копией. */
    // shAutoCloudSync();  -- ОТКЛЮЧЕНО, см. shCloudSyncExplicit()
  }, SH_AUTOSAVE_DELAY);

  /* Показать индикатор "не сохранено" */
  shSetSaveStatus('saving');
}


/* ──────────────────────────────────────────────
   Авто-синхронизация с облаком
   ──────────────────────────────────────────────
   Единый flow для desktop и browser:
   - При каждом shAutoSave → пытаемся синхронизировать с Supabase
   - Если проект ещё не в облаке (нет _cloudId) → автоматически загружаем
   - Если нет интернета → сохраняем в localStorage, ставим флаг _pendingSync
   - При восстановлении интернета → синхронизируем все pending проекты
   ────────────────────────────────────────────── */

/** @type {boolean} Блокировка: не запускать новый cloud sync пока старый идёт */
var _shCloudSyncRunning = false;

/**
 * ОТКЛЮЧЕНА. Автосинхронизация вызывала перезапись облачных данных.
 * Оставлена как заглушка — вызовы из старого кода не сломаются.
 */
function shAutoCloudSync() {
  /* Отключена. Облако обновляется только через shCloudSyncExplicit(). */
}

/**
 * Явная синхронизация с облаком — вызывать ТОЛЬКО из действий пользователя:
 * - drop фото в слот карточки
 * - добавление/удаление карточки
 * - смена этапа пайплайна
 * - soft delete / restore проекта
 *
 * НЕ вызывать из: автосохранения, рендера, загрузки из облака.
 */
function shCloudSyncExplicit() {
  if (_shCloudSyncRunning) return;

  var isOwner = (typeof sbIsLoggedIn === 'function') && sbIsLoggedIn();
  var isClient = !!window._shareToken;
  if (!isOwner && !isClient) return;

  var proj = getActiveProject();
  if (!proj) return;

  /* Клиент по share-ссылке — синхронизация через RPC */
  if (isClient && proj._cloudId) {
    _shCloudSyncRunning = true;
    sbSaveCardsByToken(window._shareToken, proj.cards || [], function(err) {
      _shCloudSyncRunning = false;
      if (err) console.warn('cloud-sync (client): ошибка:', err);
      else console.log('cloud-sync (client): карточки синхронизированы');
    });
    return;
  }

  /* Фотограф: проект ещё не в облаке — загружаем впервые */
  if (!proj._cloudId) {
    _shCloudSyncRunning = true;
    console.log('cloud-sync: первичная загрузка "' + proj.brand + '" в облако...');
    sbUploadProject(App.selectedProject, function(err, cloudId) {
      _shCloudSyncRunning = false;
      if (err) {
        console.warn('cloud-sync: ошибка загрузки:', err);
      } else {
        console.log('cloud-sync: проект загружен, cloudId:', cloudId);
      }
    });
    return;
  }

  /* Фотограф: проект уже в облаке — лёгкая синхронизация карточек напрямую.
     НЕ через sbAutoSyncCards (он отключён) — вызываем sbSyncCardsLight. */
  _shCloudSyncRunning = true;
  sbSyncCardsLight(proj._cloudId, proj.cards || [], function(err) {
    _shCloudSyncRunning = false;
    if (err) console.warn('cloud-sync: ошибка синхронизации карточек:', err);
    else console.log('cloud-sync: карточки синхронизированы');
  });
}

/**
 * Синхронизировать все проекты с флагом _pendingSync.
 * Вызывается при восстановлении интернета.
 */
function shSyncPendingProjects() {
  if (typeof sbIsLoggedIn !== 'function' || !sbIsLoggedIn()) return;

  for (var i = 0; i < App.projects.length; i++) {
    var proj = App.projects[i];
    if (!proj._pendingSync) continue;

    if (!proj._cloudId) {
      /* Первичная загрузка */
      (function(idx) {
        sbUploadProject(idx, function(err) {
          if (!err) {
            App.projects[idx]._pendingSync = false;
            console.log('cloud-sync: pending проект загружен:', App.projects[idx].brand);
          }
        });
      })(i);
    } else {
      /* Синхронизация карточек + превью (b02: retry при ошибке) */
      (function(p) {
        sbSyncCardsLight(p._cloudId, p.cards || [], function(err) {
          if (err) return;
          /* Также дозагрузить превью, если есть незагруженные */
          if (typeof sbUploadPreviews === 'function' && p.previews && p.previews.length > 0) {
            sbUploadPreviews(p._cloudId, p.previews, function(pvErr) {
              if (!pvErr) {
                p._pendingSync = false;
                console.log('cloud-sync: pending карточки + превью синхронизированы:', p.brand);
              }
            });
          } else {
            p._pendingSync = false;
            console.log('cloud-sync: pending карточки синхронизированы:', p.brand);
          }
        });
      })(proj);
    }
  }
}

/* Слушатель: при восстановлении интернета — синхронизировать pending */
window.addEventListener('online', function() {
  console.log('cloud-sync: интернет восстановлен, синхронизируем...');
  shSyncPendingProjects();
});

/* Слушатель: при потере интернета — пометить */
window.addEventListener('offline', function() {
  console.log('cloud-sync: интернет потерян, работаем в оффлайн-режиме');
  var statusEl = document.getElementById('cloud-status');
  if (statusEl) statusEl.textContent = 'Оффлайн';
});

/** @type {string} localStorage key prefix для превью проекта */
var SH_PREVIEWS_KEY_PREFIX = 'maketcp_pv_';

/**
 * Получить уникальный ключ проекта для хранения превью.
 * @param {Object} proj
 * @returns {string}
 */
function _shProjKey(proj) {
  var base = (proj.brand || 'noname') + '_' + (proj.shoot_date || '');
  /* Убираем спецсимволы для безопасности ключа */
  return base.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
}

/**
 * Облегчить превью для сохранения: оставить только thumb (300px),
 * убрать тяжёлый preview (1200px).
 * @param {Array} previews
 * @returns {Array}
 */
function _shLightenPreviews(previews) {
  var result = [];
  for (var i = 0; i < previews.length; i++) {
    var pv = previews[i];
    var lightPv = {
      name: pv.name,
      path: pv.path || '',
      thumb: pv.thumb || '',
      rating: pv.rating || 0,
      orient: pv.orient || 'v',
      folders: pv.folders || []
    };
    /* Сохраняем мета-информацию о версиях (какие этапы загружены),
       но без тяжёлых base64 данных -- они в IndexedDB.
       Формат: versions: {stageId: {thumb: '300px base64'}} -- только thumbs */
    if (pv.versions) {
      lightPv.versions = {};
      for (var sid in pv.versions) {
        if (pv.versions.hasOwnProperty(sid)) {
          lightPv.versions[sid] = { thumb: pv.versions[sid].thumb || '' };
        }
      }
    }
    result.push(lightPv);
  }
  return result;
}

/**
 * Выполнить автосохранение.
 * Сохраняет проекты в основной ключ + превью отдельно.
 */
function _shDoAutoSave() {
  if (App.projects.length === 0) return;

  try {
    /* Browser: сохраняем все проекты в localStorage.
       Исключаем тяжёлые данные (preview 1200px) для экономии места.
       Превью (thumbs 300px) сохраняются отдельно по ключу проекта.
       Для слотов карточек: сохраняем thumbUrl (300px) вместо dataUrl (1200px). */
    var toSave = _shBuildSavePayload(false);

    /* Сохраняем превью отдельно (только для локальных проектов) */
    for (var i = 0; i < App.projects.length; i++) {
      var proj = App.projects[i];
      if (proj.previews && proj.previews.length > 0 && !proj._cloudId) {
        var pvKey = SH_PREVIEWS_KEY_PREFIX + _shProjKey(proj);
        try {
          localStorage.setItem(pvKey, JSON.stringify(_shLightenPreviews(proj.previews)));
        } catch(pvErr) {
          console.warn('Превью не поместились в localStorage для ' + proj.brand + ':', pvErr);
        }
      }
    }

    /* Попытка сохранить; при переполнении — aggressive mode */
    try {
      localStorage.setItem(SH_AUTOSAVE_KEY, JSON.stringify(toSave));
    } catch(quotaErr) {
      console.warn('Автосохранение: localStorage переполнен, aggressive mode...');
      toSave = _shBuildSavePayload(true);
      try {
        localStorage.setItem(SH_AUTOSAVE_KEY, JSON.stringify(toSave));
      } catch(quotaErr2) {
        /* Совсем не помещается — сохраняем только метаданные без карточек */
        console.warn('Автосохранение: aggressive не помог, сохраняем минимум...');
        for (var qi = 0; qi < toSave.length; qi++) {
          if (toSave[qi]._cloudId) {
            /* Облачный проект: карточки восстановятся из Supabase */
            toSave[qi].cards = [];
            toSave[qi]._needsCloudRestore = true;
          }
        }
        try {
          localStorage.setItem(SH_AUTOSAVE_KEY, JSON.stringify(toSave));
        } catch(quotaErr3) {
          console.error('Автосохранение: невозможно сохранить даже минимум:', quotaErr3);
        }
      }
    }
    shSetSaveStatus('saved');
  } catch(e) {
    console.error('Автосохранение:', e);
    shSetSaveStatus('error');
  }
}

/**
 * Облегчить карточки для сохранения: заменить тяжёлый dataUrl на thumbUrl.
 * Возвращает копию массива (не мутирует оригинал).
 */
/**
 * Облегчить артикулы для сохранения: убрать тяжёлые refImage (base64).
 * Сохраняет все остальные поля (sku, category, color, status, cardIdx).
 * @param {Array} articles
 * @returns {Array}
 */
function _shLightenArticles(articles) {
  var result = [];
  for (var i = 0; i < articles.length; i++) {
    var art = articles[i];
    var copy = {};
    for (var k in art) {
      if (!art.hasOwnProperty(k)) continue;
      if (k === 'refImage') continue;  /* base64 каталожное фото — тяжёлое */
      copy[k] = art[k];
    }
    result.push(copy);
  }
  return result;
}

/**
 * Собрать payload для localStorage: облегчённые проекты.
 * @param {boolean} aggressive — если true, убирает ВСЕ base64 из всех проектов
 * @returns {Array}
 */
function _shBuildSavePayload(aggressive) {
  var toSave = [];
  for (var i = 0; i < App.projects.length; i++) {
    var proj = App.projects[i];
    var light = {};
    for (var key in proj) {
      if (!proj.hasOwnProperty(key)) continue;
      if (key === 'previews' || key === 'otherContent') continue;
      /* Контейнеры: сохраняем структуру, но без base64 (восстановим из превью) */
      if (key === 'ocContainers' && proj.ocContainers) {
        light.ocContainers = proj.ocContainers.map(function(cnt) {
          return {
            id: cnt.id,
            name: cnt.name,
            items: (cnt.items || []).map(function(it) { return { name: it.name }; })
          };
        });
        continue;
      }
      if (key === '_history') continue;
      if (key === '_cloudClean') continue; /* не сохранять — при рестарте грузим из облака заново */
      light[key] = proj[key];
    }
    /* Для облачных проектов ВСЕГДА aggressive (base64 не нужен — есть URL).
       Для локальных — aggressive только если явно запрошено (quota fallback). */
    var useAggressive = aggressive || !!proj._cloudId;
    if (light.cards && light.cards.length > 0) {
      light.cards = _shLightenCards(light.cards, useAggressive);
    }
    if (light.articles && light.articles.length > 0) {
      light.articles = _shLightenArticles(light.articles);
    }
    toSave.push(light);
  }
  return toSave;
}

/**
 * Облегчить карточки для localStorage.
 * @param {Array} cards
 * @param {boolean} aggressive — если true, убирает ВСЕ base64 (для облачных проектов)
 * @returns {Array}
 */
function _shLightenCards(cards, aggressive) {
  var result = [];
  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var copy = {};
    for (var k in card) {
      if (!card.hasOwnProperty(k)) continue;
      if (k === 'slots' && card.slots) {
        copy.slots = [];
        for (var s = 0; s < card.slots.length; s++) {
          var slot = card.slots[s];
          var ls = {};
          for (var sk in slot) {
            if (!slot.hasOwnProperty(sk)) continue;
            ls[sk] = slot[sk];
          }
          /* aggressive: убрать ВСЕ base64 (data:image/...) — облако восстановит */
          if (aggressive) {
            if (ls.dataUrl && ls.dataUrl.indexOf('data:') === 0) delete ls.dataUrl;
            if (ls.thumbUrl && ls.thumbUrl.indexOf('data:') === 0) delete ls.thumbUrl;
          } else {
            /* Сохраняем маленький thumb вместо большого preview */
            if (ls.thumbUrl) {
              ls.dataUrl = ls.thumbUrl;
            }
          }
          delete ls.thumbUrl;
          copy.slots.push(ls);
        }
      } else {
        copy[k] = card[k];
      }
    }
    result.push(copy);
  }
  return result;
}

/**
 * Загрузить автосохранённые проекты из localStorage (при старте).
 * Восстанавливает превью из отдельных ключей.
 */
function shLoadAutoSaved() {
  try {
    var raw = localStorage.getItem(SH_AUTOSAVE_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return;

    for (var i = 0; i < saved.length; i++) {
      var proj = saved[i];
      /* Восстанавливаем массивы если пропущены */
      if (!proj.otherContent) proj.otherContent = [];
      if (!proj.cards) proj.cards = [];
      if (!proj.channels) proj.channels = [];

      /* Восстанавливаем превью из отдельного ключа */
      if (!proj.previews || proj.previews.length === 0) {
        var pvKey = SH_PREVIEWS_KEY_PREFIX + _shProjKey(proj);
        try {
          var pvRaw = localStorage.getItem(pvKey);
          if (pvRaw) {
            var pvData = JSON.parse(pvRaw);
            if (Array.isArray(pvData)) {
              proj.previews = pvData;
              console.log('Восстановлено ' + pvData.length + ' превью для ' + proj.brand);
            }
          }
        } catch(pvErr) {
          console.warn('Ошибка загрузки превью:', pvErr);
        }
      }
      if (!proj.previews) proj.previews = [];

      /* Восстановить ocContainers: обогатить items thumb/preview из превью */
      if (proj.ocContainers && proj.previews.length > 0) {
        var pvMap = {};
        for (var pi = 0; pi < proj.previews.length; pi++) {
          pvMap[proj.previews[pi].name] = proj.previews[pi];
        }
        for (var ci = 0; ci < proj.ocContainers.length; ci++) {
          var items = proj.ocContainers[ci].items || [];
          for (var ii = 0; ii < items.length; ii++) {
            if (!items[ii].thumb && pvMap[items[ii].name]) {
              items[ii].thumb = pvMap[items[ii].name].thumb || '';
              items[ii].preview = pvMap[items[ii].name].preview || '';
            }
          }
        }
      }
      if (!proj.ocContainers) proj.ocContainers = [];

      App.projects.push(proj);
    }
    if (App.projects.length > 0) {
      App.selectedProject = 0;
    }
  } catch(e) {
    console.error('Загрузка автосохранения:', e);
  }
}

/**
 * Обновить индикатор статуса сохранения.
 * @param {string} status — 'saved' | 'saving' | 'error'
 */
function shSetSaveStatus(status) {
  var el = document.getElementById('save-status');
  if (!el) return;
  if (status === 'saved') {
    el.textContent = 'Сохранено';
    el.style.color = '#999';
  } else if (status === 'saving') {
    el.textContent = 'Сохранение...';
    el.style.color = '#ff9800';
  } else {
    el.textContent = 'Ошибка сохранения';
    el.style.color = '#c62828';
  }
}


// ══════════════════════════════════════════════
//  Клиентский режим (share link)
// ══════════════════════════════════════════════

/** @type {boolean} Флаг: приложение открыто клиентом по share-ссылке */
var _appClientMode = false;

/**
 * Активировать клиентский режим.
 * Скрывает элементы фотографа, показывает кнопки клиента.
 * Вызывается из sbCheckShareToken после загрузки проекта.
 */
function shEnterClientMode() {
  _appClientMode = true;

  /* Скрыть навигацию фотографа (элемент .nav, без id) */
  var navbar = document.querySelector('.nav');
  if (navbar) navbar.style.display = 'none';

  /* Скрыть шапку проектов (кнопки "Новая съёмка", "В облако" и т.д.) */
  var projHeader = document.querySelector('.projects-header');
  if (projHeader) projHeader.style.display = 'none';

  /* Скрыть список проектов (левая колонка) */
  var projList = document.querySelector('.shootings-left');
  if (projList) projList.style.display = 'none';

  /* Скрыть пайплайн фотографа */
  var pipelinePanel = document.querySelector('.pipeline-panel');
  if (pipelinePanel) pipelinePanel.style.display = 'none';

  /* Сайдбар: оставить "Добавить карточку", скрыть экспорт и шаблон */
  var sidebarBtns = document.querySelectorAll('.cp-sidebar .btn');
  for (var i = 0; i < sidebarBtns.length; i++) sidebarBtns[i].style.display = 'none';
  /* Кнопка "Добавить карточку" остаётся для клиента */

  /* Превью-панель: оставляем для клиента (просмотр всех кадров) */

  /* Скрыть тулбар карточки (Редактировать шаблон, +V, +H и т.д.) */
  var cpToolbar = document.querySelector('.cp-toolbar');
  if (cpToolbar) cpToolbar.style.display = 'none';

  /* Субтабы: оставить для клиента (Карточки товара / Доп. контент) */

  /* Показать панель клиента на главном экране */
  shRenderClientBar();

  /* Автоматически перейти на страницу Контент → Карточки */
  showPage('content');
  if (typeof showSubpage === 'function') showSubpage('cp');

  /* Убрать лоадер share-ссылки */
  if (typeof _hideShareLoader === 'function') _hideShareLoader();

  /* Мобильный режим клиента: если viewport < 768px, активировать ленту */
  if (typeof cpMobileInit === 'function') {
    cpMobileInit();
  }
}

/**
 * Флаг: popup "вы редактируете после согласования" уже показан в этой сессии.
 * @type {boolean}
 */
var _shPostApprovePopupShown = false;

/**
 * Отрисовать панель действий клиента.
 * - До согласования: "Запросить доп. кадры" + "Согласовать отбор"
 * - После согласования: "Запросить доп. кадры" + "Внести изменения в отбор"
 *   Клиент свободно редактирует. Снимок — закладка для отката, не блокировка.
 */
function shRenderClientBar() {
  /* Удалить существующую панель если есть */
  var existing = document.getElementById('client-action-bar');
  if (existing) existing.remove();

  var proj = getActiveProject();
  var brandName = proj ? esc(proj.brand) : '';

  var bar = document.createElement('div');
  bar.id = 'client-action-bar';
  bar.className = 'client-action-bar';
  var role = proj ? (proj._role || 'client') : 'client';
  var isApproved = proj && proj._stageHistory && proj._stageHistory['client_approved'];
  var buttonsHtml = '';
  var subtitle = '';

  if (role === 'client') {
    if (isApproved) {
      /* Согласовано — клиент может свободно редактировать,
         "Внести изменения" = пуш команде (новый снимок + уведомление) */
      var approvedTime = proj._stageHistory['client_approved'];
      subtitle = 'Отбор согласован ' + approvedTime + '. Вы можете вносить правки.';
      buttonsHtml =
        '<div class="client-bar-buttons">' +
          '<button class="btn client-btn-extra" onclick="shClientRequestExtra()">Запросить доп. кадры</button>' +
          '<button class="btn btn-primary client-btn-edit" onclick="shClientSubmitChanges()">Внести изменения в отбор</button>' +
        '</div>';
    } else {
      /* Ещё не согласовано — стандартные кнопки */
      subtitle = 'Просмотрите карточки и примите решение';
      buttonsHtml =
        '<div class="client-bar-buttons">' +
          '<button class="btn client-btn-extra" onclick="shClientRequestExtra()">Запросить доп. кадры</button>' +
          '<button class="btn btn-primary client-btn-approve" onclick="shClientApprove()">Согласовать отбор</button>' +
        '</div>';
    }
  } else if (role === 'retoucher') {
    subtitle = 'Ретушёр';
    buttonsHtml =
      '<div class="client-bar-buttons">' +
        '<span style="color:#888;font-size:12px">Ретушёр</span>' +
      '</div>';
  } else {
    /* viewer */
    subtitle = 'Режим просмотра';
  }

  bar.innerHTML =
    '<div class="client-bar-info">' +
      '<div class="client-bar-title">' + (brandName || 'Преотбор') + '</div>' +
      '<div class="client-bar-subtitle">' + subtitle + '</div>' +
    '</div>' +
    buttonsHtml;

  /* Вставить перед основным контентом */
  var appMain = document.getElementById('app-main');
  if (appMain) {
    appMain.insertBefore(bar, appMain.firstChild);
  }
}

/**
 * Клиент: запросить дополнительные кадры.
 * Возвращает проект на предыдущий этап (Отбор фотографа).
 * Фотограф увидит это при синхронизации.
 */
function shClientRequestExtra() {
  var proj = getActiveProject();
  if (!proj) return;

  var comment = prompt('Опишите, какие кадры нужны (или оставьте пустым):');
  if (comment === null) return; /* отмена */

  /* Записать историю: возврат на этап "Отбор фотографа" */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj._stageHistory['client_extra_request'] = timeStr;

  /* Сохранить комментарий клиента */
  if (comment) {
    if (!proj._clientComments) proj._clientComments = [];
    proj._clientComments.push({
      type: 'extra_request',
      text: comment,
      date: timeStr
    });
  }

  /* Вернуть на этап 1 (Отбор фотографа) */
  proj._stage = 1;

  /* Синхронизировать этап с облаком */
  if (typeof sbSyncStage === 'function') sbSyncStage('client_extra_request', timeStr);

  /* Синхронизировать изменения в облако */
  if (proj._cloudId && typeof sbUploadProject === 'function') {
    sbUploadProject(App.selectedProject, function(err) {
      if (err) console.error('Ошибка синхронизации:', err);
    });
  }

  shAutoSave();
  alert('Запрос на дополнительные кадры отправлен фотографу.' + (comment ? '\nКомментарий: ' + comment : ''));
}

/**
 * Клиент: согласовать отбор.
 * 1. Создаёт снимок текущего состояния (закладка для отката)
 * 2. Переводит проект на этап 3 (Цветокоррекция)
 * 3. Обновляет панель (кнопка → "Внести изменения в отбор")
 */
function shClientApprove() {
  var proj = getActiveProject();
  if (!proj) return;

  if (!confirm('Подтвердить отбор? После согласования начнётся цветокоррекция.')) return;

  /* Записать историю */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj._stageHistory[proj._stage] = timeStr;
  proj._stageHistory['client_approved'] = timeStr;

  /* Создать снимок состояния — закладка, к которой можно откатиться */
  if (typeof snCreateSnapshot === 'function') {
    snCreateSnapshot('client', 'client_approved', 'Согласование клиента ' + timeStr, function(err, snapId) {
      if (err) console.warn('Ошибка создания снимка:', err);
      else console.log('shClientApprove: снимок создан, id=' + snapId);
    });
  }

  /* Перейти на этап 3 (Цветокоррекция) */
  proj._stage = 3;

  /* Синхронизировать этап с облаком */
  if (typeof sbSyncStage === 'function') sbSyncStage('client_approved', timeStr);

  /* Синхронизировать в облако */
  if (proj._cloudId && typeof sbUploadProject === 'function') {
    sbUploadProject(App.selectedProject, function(err) {
      if (err) console.error('Ошибка синхронизации:', err);
    });
  }

  shAutoSave();
  alert('Отбор согласован! Фотограф получит уведомление.');

  /* Обновить панель — теперь покажет "Внести изменения в отбор" */
  shRenderClientBar();
}

/**
 * Клиент: внести изменения в отбор после согласования.
 *
 * 1. Сравнивает текущее состояние с последним снимком согласования
 * 2. Если есть удалённые фото — спрашивает: убрать из работы или оставить?
 * 3. Создаёт снимок + синхронизирует с облаком
 *
 * Клиент свободно редактирует всё время — эта кнопка фиксирует
 * "вот мои правки, посмотрите" и защищает от случайных удалений.
 */
function shClientSubmitChanges() {
  var proj = getActiveProject();
  if (!proj) return;

  /* Первый раз — объяснить что происходит */
  if (!_shPostApprovePopupShown) {
    _shPostApprovePopupShown = true;
    var msg = 'Вы можете свободно менять отбор. ' +
      'Нажмите "Внести изменения", когда будете готовы — ' +
      'команда получит обновлённую версию.\n\n' +
      'Отправить изменения сейчас?';
    if (!confirm(msg)) return;
  } else {
    if (!confirm('Отправить изменения команде?')) return;
  }

  /* Загрузить снимки и сравнить с согласованием */
  if (typeof snLoadSnapshots === 'function' && typeof snCompareSnapshots === 'function') {
    snLoadSnapshots(function(err, snaps) {
      if (err || !snaps || !snaps.length) {
        /* Нет снимков — просто отправить */
        _shDoSubmitChanges(proj, []);
        return;
      }
      _snCachedSnapshots = snaps;

      /* Найти последний client_approved снимок */
      var approvedSnap = null;
      for (var i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].trigger === 'client_approved') { approvedSnap = snaps[i]; break; }
      }

      if (!approvedSnap) {
        _shDoSubmitChanges(proj, []);
        return;
      }

      /* Сравнить */
      var currentData = snBuildSnapshotData();
      var diff = snCompareSnapshots(approvedSnap.data, currentData);

      if (diff.removed.length > 0) {
        /* Есть удалённые фото — спросить клиента */
        _shShowRemovalDialog(proj, diff, approvedSnap);
      } else {
        /* Нет удалений — просто отправить */
        _shDoSubmitChanges(proj, []);
      }
    });
  } else {
    /* Нет функций снимков — просто отправить */
    _shDoSubmitChanges(proj, []);
  }
}

/**
 * Показать галерею удалённых фото.
 * Клиент видит превьюшки, может выбрать что оставить, а что убрать.
 * Это как повторный отбор, только из "мусорки".
 *
 * @param {object} proj
 * @param {object} diff — результат snCompareSnapshots
 * @param {object} approvedSnap — снимок согласования
 * @private
 */
function _shShowRemovalDialog(proj, diff, approvedSnap) {
  /* Собрать карту превью по имени файла */
  var pvMap = {};
  if (proj.previews) {
    for (var p = 0; p < proj.previews.length; p++) {
      pvMap[proj.previews[p].name] = proj.previews[p];
    }
  }

  /* Создать модалку */
  var modal = document.getElementById('modal-removals');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-removals';
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content" style="max-width:640px">' +
      '<div class="modal-header"><h3>Удалённые фото</h3>' +
      '<button class="modal-close" onclick="closeModal(\'modal-removals\')">&times;</button></div>' +
      '<div id="removals-content"></div></div>';
    document.body.appendChild(modal);
  }

  var contentEl = document.getElementById('removals-content');
  var html = '<div style="padding:16px">';
  html += '<p style="margin:0 0 4px;font-size:13px;color:#666">' +
    'Вы убрали ' + diff.removed.length + ' фото из согласованного отбора.</p>';
  html += '<p style="margin:0 0 16px;font-size:13px;color:#666">' +
    'Выберите, какие фото оставить в работе.</p>';

  /* Галерея превью с чекбоксами */
  html += '<div class="rm-gallery">';
  for (var i = 0; i < diff.removed.length; i++) {
    var fileName = diff.removed[i];
    var pv = pvMap[fileName];
    var thumbSrc = '';
    if (pv) {
      thumbSrc = pv.thumb || pv.preview || pv.thumbUrl || '';
    }
    /* Если thumb это Supabase URL — используем. Если base64 — тоже ок. Если нет — placeholder. */

    html += '<div class="rm-item" data-file="' + esc(fileName) + '" onclick="_shToggleRemovalItem(this)">';
    if (thumbSrc) {
      html += '<img class="rm-thumb" src="' + thumbSrc + '" alt="' + esc(fileName) + '">';
    } else {
      html += '<div class="rm-thumb rm-thumb-empty">' + esc(fileName.replace(/\.[^.]+$/, '')) + '</div>';
    }
    html += '<div class="rm-check">&#10003;</div>';
    html += '<div class="rm-name">' + esc(fileName.replace(/\.[^.]+$/, '')) + '</div>';
    html += '</div>';
  }
  html += '</div>';

  /* Подпись-легенда */
  html += '<p style="margin:12px 0 0;font-size:11px;color:#999">' +
    'Выделенные фото останутся в работе. Остальные будут исключены.</p>';

  /* Кнопки */
  html += '<div class="rm-actions">';
  html += '<div class="rm-bulk">';
  html += '<button class="btn btn-sm" onclick="_shSelectAllRemovals(true)">Выбрать все</button>';
  html += '<button class="btn btn-sm" onclick="_shSelectAllRemovals(false)">Снять все</button>';
  html += '<span class="rm-counter" id="rm-counter">' + diff.removed.length + ' из ' + diff.removed.length + ' останутся</span>';
  html += '</div>';
  html += '<div class="rm-confirm">';
  html += '<button class="btn" onclick="closeModal(\'modal-removals\')">Отмена</button>';
  html += '<button class="btn btn-primary" onclick="_shConfirmRemovals()">Отправить изменения</button>';
  html += '</div>';
  html += '</div>';

  html += '</div>';

  contentEl.innerHTML = html;

  /* По умолчанию все фото выделены (оставить) */
  var items = contentEl.querySelectorAll('.rm-item');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.add('rm-selected');
  }

  /* Сохранить данные */
  window._shPendingRemovals = diff.removed;
  window._shPendingDiff = diff;

  if (typeof openModal === 'function') openModal('modal-removals');
}

/**
 * Переключить выделение одного фото в галерее удалений.
 * @param {HTMLElement} el
 */
function _shToggleRemovalItem(el) {
  el.classList.toggle('rm-selected');
  _shUpdateRemovalCounter();
}

/**
 * Выбрать или снять все фото в галерее удалений.
 * @param {boolean} selectAll
 */
function _shSelectAllRemovals(selectAll) {
  var items = document.querySelectorAll('#removals-content .rm-item');
  for (var i = 0; i < items.length; i++) {
    if (selectAll) items[i].classList.add('rm-selected');
    else items[i].classList.remove('rm-selected');
  }
  _shUpdateRemovalCounter();
}

/**
 * Обновить счётчик выбранных фото.
 * @private
 */
function _shUpdateRemovalCounter() {
  var total = document.querySelectorAll('#removals-content .rm-item').length;
  var selected = document.querySelectorAll('#removals-content .rm-item.rm-selected').length;
  var counter = document.getElementById('rm-counter');
  if (counter) {
    counter.textContent = selected + ' из ' + total + ' останутся';
  }
}

/**
 * Подтвердить решения по удалённым фото и отправить изменения.
 * Выделенные = оставить в работе (keep). Не выделенные = убрать (kill).
 * @private
 */
function _shConfirmRemovals() {
  var proj = getActiveProject();
  if (typeof closeModal === 'function') closeModal('modal-removals');

  var items = document.querySelectorAll('#removals-content .rm-item');
  var removalRecords = [];
  var ts = new Date().toISOString();

  for (var i = 0; i < items.length; i++) {
    var fileName = items[i].getAttribute('data-file');
    var isSelected = items[i].classList.contains('rm-selected');
    removalRecords.push({
      file: fileName,
      decision: isSelected ? 'keep' : 'kill',
      timestamp: ts
    });
  }

  /* Сохранить в проект для аудита */
  if (!proj._removalLog) proj._removalLog = [];
  for (var r = 0; r < removalRecords.length; r++) {
    proj._removalLog.push(removalRecords[r]);
  }

  _shDoSubmitChanges(proj, removalRecords);
}

/**
 * Финальная отправка изменений клиента: снимок + синхронизация.
 * @param {object} proj
 * @param {Array} removalRecords — записи о решениях по удалённым фото
 * @private
 */
function _shDoSubmitChanges(proj, removalRecords) {
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  /* Записать историю */
  if (!proj._stageHistory) proj._stageHistory = {};
  proj._stageHistory['client_changes'] = timeStr;

  /* Описание снимка: включить инфу об удалениях */
  var note = 'Изменения клиента ' + timeStr;
  if (removalRecords.length > 0) {
    var decision = removalRecords[0].decision;
    note += '. Удалено ' + removalRecords.length + ' фото (' +
      (decision === 'kill' ? 'убраны из работы' : 'оставлены в работе') + ')';
  }

  /* Создать снимок изменений — новая закладка */
  if (typeof snCreateSnapshot === 'function') {
    /* Включить записи удалений в data снимка */
    var snapshotData = snBuildSnapshotData();
    snapshotData._removalRecords = removalRecords;

    sbClient.rpc('create_snapshot', {
      p_project_id: proj._cloudId,
      p_stage_id: 'client',
      p_trigger: 'client_changes',
      p_actor_id: (typeof sbGetActor === 'function' ? sbGetActor() : {}).id || null,
      p_actor_token: (typeof sbGetActor === 'function' ? sbGetActor() : {}).token || null,
      p_actor_name: (typeof sbGetActor === 'function' ? sbGetActor() : {}).name || null,
      p_data: snapshotData,
      p_note: note
    }).then(function(res) {
      if (res.error) console.warn('Ошибка снимка client_changes:', res.error);
      else console.log('shClientSubmitChanges: снимок изменений создан, id=' + res.data);
    });
  }

  /* Синхронизировать с облаком */
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
  if (typeof sbSyncStage === 'function') sbSyncStage('client_changes', timeStr);

  shAutoSave();
  alert('Изменения отправлены команде.');
}


// ══════════════════════════════════════════════
//  Команда (b23)
// ══════════════════════════════════════════════

/**
 * Открыть модалку управления командой.
 * Если команда ещё не создана — предлагает создать.
 */
function shOpenTeamModal() {
  if (!sbIsLoggedIn()) { openModal('modal-login'); return; }

  openModal('modal-team');
  var el = document.getElementById('team-content');
  el.innerHTML = '<div class="empty-state">Загрузка...</div>';

  sbLoadTeams(function(err, data) {
    if (err) { el.innerHTML = '<div class="empty-state">Ошибка: ' + esc(err) + '</div>'; return; }

    if (!data.owned) {
      /* Нет команды — предложить создать */
      el.innerHTML = _shTeamCreateHTML();
      return;
    }

    /* Загрузить участников команды */
    _shTeamId = data.owned.id;
    sbLoadTeamMembers(data.owned.id, function(err2, members) {
      if (err2) { el.innerHTML = '<div class="empty-state">Ошибка: ' + esc(err2) + '</div>'; return; }
      el.innerHTML = _shTeamHTML(data.owned, members);
    });
  });
}

/** @type {string|null} ID текущей команды (для вызовов из inline onclick) */
var _shTeamId = null;

/**
 * HTML формы создания команды.
 * @returns {string}
 */
function _shTeamCreateHTML() {
  var html = '<div style="text-align:center;padding:20px 0">';
  html += '<div style="font-size:14px;color:#666;margin-bottom:16px">У вас ещё нет команды.</div>';
  html += '<div style="margin-bottom:12px">';
  html += '<input type="text" id="inp-team-name" placeholder="Название студии / агентства" style="padding:8px 12px;border:1px solid #ccc;border-radius:5px;width:260px;font-size:13px">';
  html += '</div>';
  html += '<button class="btn btn-primary" onclick="shCreateTeam()">Создать команду</button>';
  html += '</div>';
  return html;
}

/**
 * Создать команду.
 */
function shCreateTeam() {
  var nameEl = document.getElementById('inp-team-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Введите название команды'); return; }

  sbCreateTeam(name, function(err, team) {
    if (err) { alert('Ошибка: ' + err); return; }
    _shTeamId = team.id;
    /* Перезагрузить модалку */
    shOpenTeamModal();
  });
}

/**
 * HTML страницы команды (название + список участников + форма приглашения).
 * @param {object} team - {id, name, owner_id}
 * @param {Array} members - [{user_id, role, profiles: {email, name}}]
 * @returns {string}
 */
function _shTeamHTML(team, members) {
  var html = '';

  /* Название команды */
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">';
  html += '<span style="font-size:16px;font-weight:600">' + esc(team.name) + '</span>';
  html += '<button class="btn btn-sm" onclick="shRenameTeam()" style="font-size:11px">Переименовать</button>';
  html += '</div>';

  /* Список участников */
  html += '<div style="margin-bottom:16px">';
  if (members.length === 0) {
    html += '<div style="color:#999;font-size:13px;padding:8px 0">Пока никого нет. Пригласите коллег по email.</div>';
  } else {
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var profile = m.profiles || {};
      var displayName = profile.name || profile.email || 'Без имени';
      var displayEmail = profile.email || '';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0">';
      html += '<div>';
      html += '<span style="font-size:13px;font-weight:500">' + esc(displayName) + '</span>';
      if (displayEmail) html += ' <span style="font-size:11px;color:#999">' + esc(displayEmail) + '</span>';
      html += ' <span style="font-size:10px;color:#888;background:#f5f5f5;padding:1px 6px;border-radius:3px">' + esc(m.role) + '</span>';
      html += '</div>';
      html += '<button class="btn btn-sm" onclick="shRemoveTeamMember(\'' + m.user_id + '\')" style="font-size:10px;color:#c62828;padding:2px 8px">Удалить</button>';
      html += '</div>';
    }
  }
  html += '</div>';

  /* Форма приглашения */
  html += '<div style="border-top:1px solid #eee;padding-top:12px">';
  html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px">Пригласить в команду</div>';
  html += '<div style="display:flex;gap:6px;align-items:center">';
  html += '<input type="email" id="inp-team-invite-email" placeholder="email@example.com" style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:12px">';
  html += '<select id="inp-team-invite-role" style="padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px">';
  html += '<option value="member">Участник</option>';
  html += '<option value="admin">Админ</option>';
  html += '</select>';
  html += '<button class="btn btn-primary btn-sm" onclick="shInviteToTeam()">Пригласить</button>';
  html += '</div>';
  html += '<div id="team-invite-status" style="font-size:11px;margin-top:6px;display:none"></div>';
  html += '</div>';

  return html;
}

/**
 * Переименовать команду (prompt).
 */
function shRenameTeam() {
  if (!_shTeamId) return;
  var newName = prompt('Новое название команды:');
  if (!newName || !newName.trim()) return;

  sbRenameTeam(_shTeamId, newName.trim(), function(err) {
    if (err) { alert('Ошибка: ' + err); return; }
    shOpenTeamModal();
  });
}

/**
 * Пригласить в команду по email.
 */
function shInviteToTeam() {
  if (!_shTeamId) return;
  var emailEl = document.getElementById('inp-team-invite-email');
  var roleEl = document.getElementById('inp-team-invite-role');
  var email = emailEl ? emailEl.value.trim() : '';
  var role = roleEl ? roleEl.value : 'member';

  if (!email) { alert('Введите email'); return; }

  var statusEl = document.getElementById('team-invite-status');

  sbInviteToTeam(_shTeamId, email, role, function(err, result) {
    if (err) {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#c62828'; statusEl.textContent = 'Ошибка: ' + err; }
      return;
    }

    if (result.status === 'not_found') {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#e65100'; statusEl.textContent = 'Пользователь с email ' + email + ' не найден. Он должен сначала зарегистрироваться.'; }
      return;
    }

    if (result.status === 'self') {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#e65100'; statusEl.textContent = 'Нельзя пригласить самого себя.'; }
      return;
    }

    /* Успех — перезагрузить список */
    if (emailEl) emailEl.value = '';
    if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#2e7d32'; statusEl.textContent = 'Приглашён: ' + (result.name || result.email); }
    /* Обновить список через секунду */
    setTimeout(function() { shOpenTeamModal(); }, 1000);
  });
}

/**
 * Удалить участника из команды.
 * @param {string} userId
 */
function shRemoveTeamMember(userId) {
  if (!_shTeamId) return;
  if (!confirm('Удалить участника из команды?')) return;

  sbRemoveTeamMember(_shTeamId, userId, function(err) {
    if (err) { alert('Ошибка: ' + err); return; }
    shOpenTeamModal();
  });
}


// ══════════════════════════════════════════════
//  Участники проекта (per-project invite)
// ══════════════════════════════════════════════

/**
 * Открыть модалку участников текущего проекта.
 */
function shOpenProjectMembersModal() {
  if (!sbIsLoggedIn()) { openModal('modal-login'); return; }
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) { alert('Сначала загрузите проект в облако'); return; }

  openModal('modal-project-members');
  var el = document.getElementById('project-members-content');
  el.innerHTML = '<div class="empty-state">Загрузка...</div>';

  sbLoadProjectMembers(proj._cloudId, function(err, members) {
    if (err) { el.innerHTML = '<div class="empty-state">Ошибка: ' + esc(err) + '</div>'; return; }
    el.innerHTML = _shProjectMembersHTML(proj, members);
  });
}

/**
 * HTML списка участников проекта + форма приглашения.
 * @param {object} proj
 * @param {Array} members
 * @returns {string}
 */
function _shProjectMembersHTML(proj, members) {
  var html = '';
  var projName = shProjectDisplayName(proj);
  html += '<div style="font-size:13px;color:#666;margin-bottom:12px">Проект: <strong>' + esc(projName) + '</strong></div>';

  /* Список */
  if (members.length === 0) {
    html += '<div style="color:#999;font-size:13px;padding:8px 0">Нет дополнительных участников.</div>';
  } else {
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var profile = m.profiles || {};
      var displayName = profile.name || profile.email || 'Без имени';
      var displayEmail = profile.email || '';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0">';
      html += '<div>';
      html += '<span style="font-size:13px;font-weight:500">' + esc(displayName) + '</span>';
      if (displayEmail) html += ' <span style="font-size:11px;color:#999">' + esc(displayEmail) + '</span>';
      html += ' <span style="font-size:10px;color:#888;background:#f5f5f5;padding:1px 6px;border-radius:3px">' + esc(m.role) + '</span>';
      html += '</div>';
      html += '<button class="btn btn-sm" onclick="shRemoveProjectMember(\'' + m.user_id + '\')" style="font-size:10px;color:#c62828;padding:2px 8px">Удалить</button>';
      html += '</div>';
    }
  }

  /* Форма приглашения */
  html += '<div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">';
  html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px">Пригласить в проект</div>';
  html += '<div style="display:flex;gap:6px;align-items:center">';
  html += '<input type="email" id="inp-proj-invite-email" placeholder="email@example.com" style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:12px">';
  html += '<select id="inp-proj-invite-role" style="padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px">';
  html += '<option value="editor">Редактор</option>';
  html += '<option value="viewer">Зритель</option>';
  html += '</select>';
  html += '<button class="btn btn-primary btn-sm" onclick="shInviteToProject()">Пригласить</button>';
  html += '</div>';
  html += '<div id="proj-invite-status" style="font-size:11px;margin-top:6px;display:none"></div>';
  html += '</div>';

  return html;
}

/**
 * Пригласить в проект по email.
 */
function shInviteToProject() {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;

  var emailEl = document.getElementById('inp-proj-invite-email');
  var roleEl = document.getElementById('inp-proj-invite-role');
  var email = emailEl ? emailEl.value.trim() : '';
  var role = roleEl ? roleEl.value : 'editor';

  if (!email) { alert('Введите email'); return; }

  var statusEl = document.getElementById('proj-invite-status');

  sbInviteToProject(proj._cloudId, email, role, function(err, result) {
    if (err) {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#c62828'; statusEl.textContent = 'Ошибка: ' + err; }
      return;
    }

    if (result.status === 'not_found') {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#e65100'; statusEl.textContent = 'Пользователь ' + email + ' не найден. Нужна регистрация.'; }
      return;
    }

    if (result.status === 'self') {
      if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#e65100'; statusEl.textContent = 'Вы уже владелец проекта.'; }
      return;
    }

    /* Успех */
    if (emailEl) emailEl.value = '';
    if (statusEl) { statusEl.style.display = ''; statusEl.style.color = '#2e7d32'; statusEl.textContent = 'Приглашён: ' + (result.name || result.email); }
    setTimeout(function() { shOpenProjectMembersModal(); }, 1000);
  });
}

/**
 * Удалить участника из проекта.
 * @param {string} userId
 */
function shRemoveProjectMember(userId) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;
  if (!confirm('Удалить участника из проекта?')) return;

  sbRemoveProjectMember(proj._cloudId, userId, function(err) {
    if (err) { alert('Ошибка: ' + err); return; }
    shOpenProjectMembersModal();
  });
}
