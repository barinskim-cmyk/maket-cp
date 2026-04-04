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
  renderProjects();

  /* Запустить авто-синхронизацию из облака для облачного проекта */
  if (typeof sbStartAutoPull === 'function') sbStartAutoPull();
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
    html += '</div>';
  }

  html += '<div class="pipeline-steps">';
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var s = PIPELINE_STAGES[i];

    /* Скрыть не-beta этапы: показать только заглушку "скоро" */
    if (s.beta === false) {
      /* Первый не-beta этап — показать разделитель */
      if (i > 0 && PIPELINE_STAGES[i - 1].beta !== false) {
        html += '<div class="pipeline-coming-soon">Следующие этапы -- скоро</div>';
      }
      continue;
    }

    var cls = '';
    if (i < stage) cls = 'done';
    else if (i === stage) cls = 'active';

    html += '<div class="pipeline-step ' + cls + '">';
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
  container.innerHTML = html;
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

  /* Если текущий этап не beta — не давать завершить (не должно произойти) */
  var currentStageObj = PIPELINE_STAGES[proj._stage];
  if (currentStageObj && currentStageObj.beta === false) return;

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
 */
function shAutoSave() {
  if (_shAutoSaveTimer) clearTimeout(_shAutoSaveTimer);
  _shAutoSaveTimer = setTimeout(function() {
    _shAutoSaveTimer = null;
    _shDoAutoSave();

    /* Авто-синхронизация с облаком (desktop + browser) */
    shAutoCloudSync();
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
 * Автоматическая синхронизация активного проекта с облаком.
 * Вызывается после каждого автосохранения в localStorage.
 */
function shAutoCloudSync() {
  if (_shCloudSyncRunning) return;
  if (typeof sbIsLoggedIn !== 'function' || !sbIsLoggedIn()) return;

  var proj = getActiveProject();
  if (!proj) return;

  /* Проект ещё не в облаке — загружаем впервые */
  if (!proj._cloudId) {
    _shCloudSyncRunning = true;
    console.log('cloud-sync: первичная загрузка "' + proj.brand + '" в облако...');
    sbUploadProject(App.selectedProject, function(err, cloudId) {
      _shCloudSyncRunning = false;
      if (err) {
        console.warn('cloud-sync: ошибка загрузки:', err);
        proj._pendingSync = true; /* пометить для повторной попытки */
      } else {
        proj._pendingSync = false;
        console.log('cloud-sync: проект загружен, cloudId:', cloudId);
      }
    });
    return;
  }

  /* Проект уже в облаке — лёгкая синхронизация карточек */
  if (typeof sbAutoSyncCards === 'function') {
    sbAutoSyncCards();
  }
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
      /* Синхронизация карточек */
      (function(p) {
        sbSyncCardsLight(p._cloudId, p.cards || [], function(err) {
          if (!err) {
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
    result.push({
      name: pv.name,
      path: pv.path || '',
      thumb: pv.thumb || '',
      rating: pv.rating || 0,
      orient: pv.orient || 'v',
      folders: pv.folders || []
    });
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
      if (key === '_history') continue;
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
 * Отрисовать панель действий клиента.
 * Две кнопки: "Запросить доп. кадры" и "Согласовать отбор".
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
  var subtitle = role === 'viewer' ? 'Режим просмотра' : 'Просмотрите карточки и примите решение';
  var buttonsHtml = '';
  if (role === 'client') {
    buttonsHtml =
      '<div class="client-bar-buttons">' +
        '<button class="btn client-btn-extra" onclick="shClientRequestExtra()">Запросить доп. кадры</button>' +
        '<button class="btn btn-primary client-btn-approve" onclick="shClientApprove()">Согласовать отбор</button>' +
      '</div>';
  } else if (role === 'retoucher') {
    buttonsHtml =
      '<div class="client-bar-buttons">' +
        '<span style="color:#888;font-size:12px">Ретушёр</span>' +
      '</div>';
  }
  /* viewer: no buttons */

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
 * Переводит проект на следующий этап (Цветокоррекция).
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

  /* Обновить панель — убрать кнопки */
  var bar = document.getElementById('client-action-bar');
  if (bar) {
    bar.innerHTML =
      '<div class="client-bar-info">' +
        '<div class="client-bar-title">Отбор согласован</div>' +
        '<div class="client-bar-subtitle">Спасибо! Фотограф начнёт цветокоррекцию.</div>' +
      '</div>';
  }
}
