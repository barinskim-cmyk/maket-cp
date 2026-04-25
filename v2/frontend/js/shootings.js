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
    _stageDates: proj._stageDates || {},
    _stageBatches: proj._stageBatches || [],
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
/* Флаг: первичная загрузка из облака завершена (или облака нет).
   Пока false — показываем "Загружаю проекты..." вместо "Нет проектов". */
var _shCloudLoadDone = false;
/* Таймаут: если через 10с проекты так и не загрузились — показать реальное сообщение */
setTimeout(function() {
  if (!_shCloudLoadDone) {
    _shCloudLoadDone = true;
    if (typeof renderProjects === 'function') renderProjects();
  }
}, 10000);

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
  console.log('[renderProjects] App.projects:', App.projects.length, 'filtered:', filtered.length);

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
    /* Если Supabase подключён (и ещё не авторизован, или авторизован но проекты ещё
       не подгрузились) — показать "Загружаю..." чтобы не пугать пустым экраном.
       После первой успешной загрузки _shCloudLoadDone станет true и покажется реальное сообщение. */
    var _isLoading = (typeof sbIsConnected === 'function' && sbIsConnected() && !_shCloudLoadDone);
    var emptyMsg = hiddenCount > 0 ? 'Все проекты скрыты' :
                   (_isLoading ? 'Загружаю проекты...' : 'Нет открытых проектов');
    list.innerHTML = '<div class="empty-state">' + emptyMsg + '</div>';
    document.getElementById('pipeline-container').innerHTML =
      '<div class="empty-state">' + (_isLoading ? '' : 'Выберите съёмку') + '</div>';
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

  try { renderPipeline(); } catch(e) { console.error('renderPipeline error:', e); }
  cpRenderList();
}


// ══════════════════════════════════════════════
//  Пайплайн
// ══════════════════════════════════════════════

/**
 * Отрисовать визуальный пайплайн (8 этапов) для выбранного проекта.
 * Этапы: done → active → будущие. Активный этап имеет кнопку "Завершить".
 */
/**
 * Проставить _stage каждому фото, если ещё нет.
 * Backward-compatible: новые фото получают proj._stage, старые проекты — тоже.
 * @param {Object} proj
 */
function shEnsurePhotoStages(proj) {
  var defaultStage = proj._stage || 0;
  if (!proj.previews) return;
  var needsInit = false;
  for (var i = 0; i < proj.previews.length; i++) {
    if (typeof proj.previews[i]._stage !== 'number') {
      proj.previews[i]._stage = defaultStage;
      needsInit = true;
    }
  }
  /* При первой инициализации — зафиксировать дату начала текущего этапа */
  if (needsInit && proj.previews.length > 0) {
    if (!proj._stageDates) proj._stageDates = {};
    if (!proj._stageDates[defaultStage]) {
      proj._stageDates[defaultStage] = { firstEnter: new Date().toISOString() };
    }
  }
}

/**
 * Сгенерировать короткий уникальный ID для batch-события.
 * Формат: b_<timestamp36>_<rnd36> — 12-15 символов, читается, сортируется по времени.
 * @returns {string}
 */
function shGenBatchId() {
  return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Записать batch-событие перемещения группы фото между этапами.
 * Заводит уникальный id, собирает parent batch IDs из предыдущей истории фото,
 * обновляет proj._photoLastBatch для трассировки веток.
 *
 * Это фундамент для tree-визуализации детального пайплайна:
 * каждое событие знает, ИЗ КАКИХ предыдущих батчей пришли фото.
 * Когда придёт версионирование — дерево строится из накопленной истории.
 *
 * @param {Object} proj — проект
 * @param {string[]} photoNames — имена фото, которые движутся
 * @param {number} fromStage — индекс этапа-источника
 * @param {number} toStage — индекс этапа-цели
 * @param {string} trigger — что вызвало переход (manual, send_client_link, client_approved, client_extra_request, auto, и т.д.)
 * @returns {string|null} id созданного batch-события (или null если photoNames пуст)
 */
function shRecordBatchMove(proj, photoNames, fromStage, toStage, trigger) {
  if (!photoNames || photoNames.length === 0) return null;

  /* Инициализация структур */
  if (!proj._stageBatches) proj._stageBatches = [];
  if (!proj._photoLastBatch) proj._photoLastBatch = {};

  /* Собрать уникальные parent batch IDs из текущей истории фото */
  var parentSet = {};
  for (var i = 0; i < photoNames.length; i++) {
    var prev = proj._photoLastBatch[photoNames[i]];
    if (prev) parentSet[prev] = true;
  }
  var parentBatchIds = [];
  for (var pid in parentSet) {
    if (parentSet.hasOwnProperty(pid)) parentBatchIds.push(pid);
  }

  /* Создать batch-событие */
  var batchId = shGenBatchId();
  var batch = {
    id: batchId,
    photos: photoNames.slice(),       /* копия для безопасности */
    fromStage: fromStage,
    toStage: toStage,
    date: new Date().toISOString(),
    trigger: trigger || 'manual',
    count: photoNames.length,
    parentBatchIds: parentBatchIds    /* откуда пришли — для дерева */
  };
  proj._stageBatches.push(batch);

  /* Обновить указатель «последний batch» для каждого фото */
  for (var j = 0; j < photoNames.length; j++) {
    proj._photoLastBatch[photoNames[j]] = batchId;
  }

  /* Синхронизировать в облако, чтобы маршруты пережили refresh */
  if (typeof sbSyncStageBatches === 'function') {
    sbSyncStageBatches(proj);
  }

  return batchId;
}

/**
 * Подсчитать количество фотографий на каждом этапе пайплайна.
 * @param {Object} proj
 * @returns {number[]} массив длиной PIPELINE_STAGES.length, counts[i] = кол-во фото на этапе i
 */
function shPhotosPerStage(proj) {
  var counts = [];
  for (var i = 0; i < PIPELINE_STAGES.length; i++) counts.push(0);
  if (!proj.previews) return counts;
  for (var p = 0; p < proj.previews.length; p++) {
    var s = proj.previews[p]._stage || 0;
    if (s >= 0 && s < counts.length) counts[s]++;
  }
  return counts;
}

/**
 * Кол-во уникальных фото, помещённых в слоты карточек.
 * Используется как «selected count» — фактическое число фото,
 * с которыми команда/клиент работают после отбора клиента.
 *
 * @param {Object} proj
 * @returns {number}
 */
function shSelectedCount(proj) {
  if (!proj) return 0;
  var seen = {};
  var n = 0;

  // 1. Фото в карточках товара
  var cards = proj.cards || [];
  for (var c = 0; c < cards.length; c++) {
    var slots = (cards[c] && cards[c].slots) || [];
    for (var s = 0; s < slots.length; s++) {
      var f = slots[s] && slots[s].file;
      if (f && !seen[f]) { seen[f] = true; n++; }
    }
  }

  // 2. Контейнеры доп.контента
  var ocCnt = proj.ocContainers || [];
  for (var ci = 0; ci < ocCnt.length; ci++) {
    var items = (ocCnt[ci] && ocCnt[ci].items) || [];
    for (var cj = 0; cj < items.length; cj++) {
      var name = items[cj] && items[cj].name;
      if (name && !seen[name]) { seen[name] = true; n++; }
    }
  }

  // 3. Свободные фото в доп.контенте
  var oc = proj.otherContent || [];
  for (var i = 0; i < oc.length; i++) {
    var nm = oc[i] && oc[i].name;
    if (nm && !seen[nm]) { seen[nm] = true; n++; }
  }

  return n;
}

/**
 * Cumulative: сколько фото УЖЕ ПРОШЛИ каждый этап (находятся дальше).
 * cumulative[i] = кол-во фото с _stage > i (завершили этап i).
 *
 * Метрика «потенциал vs масштаб»:
 * - Потенциал = все превью (proj.previews.length)
 * - Масштаб (scale) = текущий объём работы:
 *     • до завершения «Отбор клиента» — фото с _stage >= 1 (прошли преотбор)
 *     • после завершения «Отбор клиента» — selectedCount (фото в слотах карточек)
 *       fallback: cumulative[CLIENT_STAGE_INDEX] если карточки ещё не заполнены.
 *
 * @param {Object} proj
 * @param {number[]} photoCounts — результат shPhotosPerStage()
 * @returns {{ cumulative: number[], scale: number, potential: number,
 *             selectedCount: number, clientStageDone: boolean,
 *             clientStageIndex: number, passedPreselect: number }}
 */
function shCumulativeMetrics(proj, photoCounts) {
  var potential = proj.previews ? proj.previews.length : 0;
  var cumulative = [];
  /* Для каждого этапа i: прошли = сумма фото на всех этапах ПОСЛЕ i */
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var passed = 0;
    for (var j = i + 1; j < PIPELINE_STAGES.length; j++) {
      passed += photoCounts[j];
    }
    cumulative.push(passed);
  }
  /* CLIENT_STAGE_INDEX совпадает с индексом 'client' в PIPELINE_STAGES
     (см. state.js — preselect=0, selection=1, client=2).
     TEAM_STAGE_INDEX = индекс «Отбор команды» (этап перед клиентским). */
  var CLIENT_STAGE_INDEX = 2;
  var TEAM_STAGE_INDEX = 1;
  var passedPreselect = cumulative[0] || 0;
  var passedTeam = cumulative[TEAM_STAGE_INDEX] || 0;
  var passedClient = cumulative[CLIENT_STAGE_INDEX] || 0;
  /* Этап «Отбор клиента» считается завершённым если:
     1. зафиксировано client_approved в _stageHistory, или
     2. на самом этапе client уже нет фото, а дальше есть (т.е. он уже опустел). */
  var clientStageDone = !!(proj && proj._stageHistory && proj._stageHistory['client_approved']);
  if (!clientStageDone && photoCounts[CLIENT_STAGE_INDEX] === 0 && passedClient > 0) {
    clientStageDone = true;
  }
  var selectedCount = shSelectedCount(proj);
  /* Масштаб (новое определение):
     — до отбора клиента: passed_preselect (legacy-совместимое)
     — после отбора клиента: selectedCount (фото в карточках), fallback на passedClient. */
  var scale;
  if (clientStageDone) {
    scale = selectedCount > 0 ? selectedCount : (passedClient || passedPreselect);
  } else {
    scale = passedPreselect;
  }
  return {
    cumulative: cumulative,
    scale: scale,
    potential: potential,
    selectedCount: selectedCount,
    clientStageDone: clientStageDone,
    clientStageIndex: CLIENT_STAGE_INDEX,
    teamStageIndex: TEAM_STAGE_INDEX,
    passedPreselect: passedPreselect,
    passedTeam: passedTeam,
    passedClient: passedClient
  };
}

/**
 * Определить «текущий фронт» проекта — самый ранний этап, на котором ещё есть фото.
 * Все этапы до него считаются завершёнными.
 * @param {Object} proj
 * @returns {number} индекс этапа-фронта (или PIPELINE_STAGES.length если всё завершено)
 */
function shProjectFront(proj) {
  var counts = shPhotosPerStage(proj);
  /* Если на этапе 0 фото — этап завершён. Ищем первый непустой. */
  for (var i = 0; i < counts.length; i++) {
    if (counts[i] > 0) return i;
  }
  /* Все этапы пусты — либо нет фото, либо всё завершено */
  return (proj.previews && proj.previews.length > 0) ? counts.length : 0;
}

function renderPipeline() {
  var container = document.getElementById('pipeline-container');
  if (App.selectedProject < 0 || App.selectedProject >= App.projects.length) {
    container.innerHTML = '<div class="empty-state">Выберите съёмку</div>';
    return;
  }

  var proj = App.projects[App.selectedProject];
  shEnsurePhotoStages(proj);
  var stage = proj._stage || 0;
  var photoCounts = shPhotosPerStage(proj);
  var totalPhotos = proj.previews ? proj.previews.length : 0;
  var metrics = shCumulativeMetrics(proj, photoCounts);

  /* Кнопка синхронизации (если проект в облаке) */
  var html = '';
  if (proj._cloudId) {
    html += '<div class="pipeline-sync-bar">';
    html += '<span id="pipeline-sync-status" style="font-size:11px;color:#999">Облако</span>';
    html += ' <button class="btn btn-sm" onclick="sbPullProject(function(e){var s=document.getElementById(\'pipeline-sync-status\');if(s)s.textContent=e?\'Ошибка\':\'Обновлено\';setTimeout(function(){if(s)s.textContent=\'Облако\'},2000)})" style="font-size:11px;padding:2px 8px">Синхронизировать</button>';
    html += ' <button class="btn btn-sm" onclick="shOpenProjectMembersModal()" style="font-size:11px;padding:2px 8px">Участники</button>';
    html += '</div>';
  }

  /* ── Определяем параметры ветки комментирования ── */
  var _cmtBranchStart = -1; /* индекс этапа, где ветка стартует */
  var _cmtBranchEnd = -1;   /* индекс этапа, где ветка заканчивается (-1 = не завершена) */
  var _cmtBranchActive = false;
  var _cmtCount = 0;
  var _annotCount = 0;

  if (proj.cards) {
    for (var ci = 0; ci < proj.cards.length; ci++) {
      if (proj.cards[ci]._comments && proj.cards[ci]._comments.length > 0) {
        _cmtCount += proj.cards[ci]._comments.length;
      }
    }
  }
  if (proj._annotations) {
    for (var aKey in proj._annotations) {
      if (proj._annotations.hasOwnProperty(aKey)) {
        _annotCount += proj._annotations[aKey].length;
      }
    }
  }

  if (proj._commentingStarted) {
    _cmtBranchActive = true;
    /* Определяем стартовый этап: сохранённый или текущий */
    _cmtBranchStart = (typeof proj._commentingStartedStageIdx === 'number')
      ? proj._commentingStartedStageIdx : (proj._stage || 0);
    if (proj._commentingDone) {
      _cmtBranchEnd = (typeof proj._commentingDoneStageIdx === 'number')
        ? proj._commentingDoneStageIdx : (proj._stage || 0);
    }
  }

  /* ── Классификация этапов: done / active / future ── */
  var hasBranch = _cmtBranchActive;
  var stageStates = []; /* массив {cls, cnt, cum} для каждого этапа */
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var cnt = photoCounts[i];
    var cls = '';
    var hasPhotosAfter = false;
    for (var j = i + 1; j < PIPELINE_STAGES.length; j++) {
      if (photoCounts[j] > 0) { hasPhotosAfter = true; break; }
    }
    if (cnt === 0 && hasPhotosAfter) cls = 'done';
    else if (cnt > 0) cls = 'active';
    /* else: future — cls остаётся '' */
    if (totalPhotos === 0) {
      if (i < stage) cls = 'done';
      else if (i === stage) cls = 'active';
    }
    stageStates.push({ cls: cls, cnt: cnt, cum: metrics.cumulative[i] });
  }

  /* ── Компактный пайплайн: рисуем ТОЛЬКО этапы с активностью ── */
  html += '<div class="pipeline-steps">';
  for (var i = 0; i < PIPELINE_STAGES.length; i++) {
    var s = PIPELINE_STAGES[i];
    var ss = stageStates[i];
    var cnt = ss.cnt;
    var cls = ss.cls;

    /* Пропускаем этапы без активности (future) — их просто нет в UI */
    if (!cls) continue;

    var isSnapshotCtx = (typeof _snActiveSnapshot !== 'undefined' && _snActiveSnapshot &&
      _snActiveSnapshot.stageId === s.id);
    if (isSnapshotCtx) cls += ' sn-active-stage';

    var clickable = (cls === 'done' && proj._cloudId);

    html += '<div class="pipeline-step ' + cls + (clickable ? ' step-clickable' : '') + '"' +
      (clickable ? ' onclick="shLoadStageSnapshot(\'' + s.id + '\')" title="Посмотреть состояние на этом этапе"' : '') + '>';
    html += '<div class="step-dot">' + (cls === 'done' ? '&#10003;' : (i + 1)) + '</div>';
    html += '<div class="step-info">';
    html += '<div class="step-name">' + esc(s.name);
    /* Счётчик: для done — N/M, для active — "N на этапе".
       Числитель/знаменатель зависят от позиции этапа:
       — этап 0 (преотбор) done: passedPreselect/potential
       — этап team (1) done: passedTeam/passedPreselect (cum/passedPreselect, как было)
       — этап client (2) done: selectedCount/passedTeam — фактически отобранные
         клиентом из того, что показала команда (если команда не использовалась,
         passedTeam == passedPreselect, и формула даёт 134/453 по концепции Маши).
       — этапы > client (3+) done: cum/scale, scale = selectedCount после client. */
    if (totalPhotos > 0) {
      var cum = ss.cum;
      var num = cum;
      var denom = 0;
      if (i === 0) {
        denom = metrics.potential;
      } else if (i === metrics.teamStageIndex) {
        denom = metrics.passedPreselect || metrics.potential;
      } else if (i === metrics.clientStageIndex) {
        /* Знаменатель: то, что прошло team (вход в стадию client).
           Если team пустой — passedTeam == passedPreselect, отображаем
           selectedCount/passedPreselect, что и хочет Маша. */
        denom = metrics.passedTeam || metrics.passedPreselect || metrics.potential;
        /* Числитель: если этап завершён — реально отобранные (selectedCount),
           а не cumulative (последний почти всегда == passedTeam, потому что
           shClientApprove массово advance'ит все фото). */
        if (cls === 'done' && metrics.clientStageDone && metrics.selectedCount > 0) {
          num = metrics.selectedCount;
        }
      } else {
        /* После «Отбор клиента»: знаменатель = scale (selectedCount если client done). */
        denom = metrics.clientStageDone
          ? (metrics.scale || metrics.passedPreselect || metrics.potential)
          : (metrics.passedPreselect || metrics.potential);
      }
      if (i === 0) {
        if (cls === 'done') {
          if (denom > 0) html += '<span class="step-photo-count">' + num + '/' + denom + '</span>';
        } else if (cnt > 0) {
          html += '<span class="step-photo-count">' + cnt + ' фото</span>';
        }
      } else {
        if (cls === 'done') {
          if (denom > 0) {
            html += '<span class="step-photo-count">' + num + '/' + denom + '</span>';
          } else if (num > 0) {
            html += '<span class="step-photo-count">' + num + ' фото</span>';
          }
        } else if (cls === 'active') {
          /* "N на этапе": после клиентского отбора показываем известную нижнюю
             границу (scale) если фактический cnt больше — это защищает от
             ситуации, когда все фото были автоматически перемещены вперёд
             без партиальной фильтрации. */
          var displayCnt = cnt;
          if (i > metrics.clientStageIndex && metrics.clientStageDone &&
              metrics.scale > 0 && cnt > metrics.scale) {
            displayCnt = metrics.scale;
          }
          html += '<span class="step-photo-count">' + displayCnt + ' на этапе</span>';
        } else if (cnt > 0) {
          html += '<span class="step-photo-count">' + cnt + ' фото</span>';
        }
      }
    }
    html += '</div>';

    /* Даты этапа: done = диапазон (бледный), active = «с [дата]» */
    if (cls === 'done') {
      var doneNote = '';
      var sd = proj._stageDates && proj._stageDates[i];
      if (sd && sd.firstEnter) {
        var dEnter = new Date(sd.firstEnter).toLocaleDateString('ru-RU');
        var dLeave = sd.lastLeave ? new Date(sd.lastLeave).toLocaleDateString('ru-RU') : '';
        doneNote = dLeave && dLeave !== dEnter ? dEnter + ' — ' + dLeave : dEnter;
      } else if (proj._stageHistory && proj._stageHistory[i]) {
        doneNote = proj._stageHistory[i];
      }
      if (doneNote) html += '<div class="step-note">' + doneNote + '</div>';
    } else if (cls === 'active' && proj._stageDates && proj._stageDates[i] && proj._stageDates[i].firstEnter) {
      var enterDate = new Date(proj._stageDates[i].firstEnter);
      html += '<div class="step-note">c ' + enterDate.toLocaleDateString('ru-RU') + '</div>';
    }

    /* Кнопки действий — только на active этапах */
    if (cls === 'active') {
      html += '<button class="step-action" onclick="shShowJumpMenu(' + i + ', this)">Завершить этап</button>';
      if (s.id === 'selection') {
        html += '<button class="step-action" style="border-color:#333;color:#333;margin-left:6px" onclick="shSendClientLink()">Ссылка на преотбор</button>';
      }
      if (s.id === 'color') {
        html += '<button class="step-action" style="border-color:#333;color:#333;margin-left:6px" onclick="pvOnLoadVersionSelect({value:\'color\'})" title="Загрузить ЦК версию для отбора">Загрузить ЦК</button>';
      }
      if (s.id === 'retouch') {
        html += '<button class="step-action" style="border-color:#333;color:#333;margin-left:6px" onclick="pvOnLoadVersionSelect({value:\'retouch\'})" title="Загрузить ретушь версию для отбора">Загрузить ретушь</button>';
      }
    }
    html += '</div>'; /* /step-info */

    /* ── Встроенная ветка (комментирование) ── */
    if (hasBranch) {
      var branchHtml = _shRenderBranchCell(i, stage, _cmtBranchStart, _cmtBranchEnd, _cmtCount, _annotCount);
      if (branchHtml) html += branchHtml;
    }

    html += '</div>'; /* /pipeline-step */
  }
  html += '</div>'; /* /pipeline-steps */

  /* ── Строка масштаба + ссылка на детальный вид ── */
  if (totalPhotos > 0) {
    html += '<div class="pipeline-scale">';
    if (metrics.scale > 0) {
      html += 'Масштаб: ' + metrics.scale + ' фото';
      if (metrics.potential > metrics.scale) {
        html += ' (из ' + metrics.potential + ' превью)';
      }
    } else {
      html += 'Потенциал: ' + metrics.potential + ' превью';
    }
    html += ' <a href="#" onclick="shShowDetailedPipeline();return false" style="margin-left:8px;font-size:11px;color:#999;text-decoration:underline">подробнее</a>';
    html += '</div>';
  }

  /* Кнопка сверки: если есть хотя бы 2 снимка */
  if (proj._cloudId && typeof _snCachedSnapshots !== 'undefined' && _snCachedSnapshots.length >= 2) {
    html += '<div style="margin-top:8px">';
    html += '<button class="btn btn-sm" onclick="shOpenDiffMode()" style="font-size:11px;padding:2px 8px">Сверка состояний</button>';
    html += '</div>';
  }

  /* ── Таймлайн контрольных точек ── */
  html += _shRenderTimeline(proj);

  container.innerHTML = html;
}

/**
 * Показать меню выбора следующего этапа (нелинейный переход).
 * Позволяет перепрыгивать этапы — например, из «Отбор команды» сразу в «Ретушь».
 * @param {number} currentIdx — индекс текущего active-этапа
 * @param {HTMLElement} btn — кнопка для позиционирования
 */
function shShowJumpMenu(currentIdx, btn) {
  /* Удаляем предыдущее меню если есть */
  var old = document.getElementById('sh-jump-menu');
  if (old) { old.remove(); return; }

  var menu = document.createElement('div');
  menu.id = 'sh-jump-menu';
  menu.className = 'sh-jump-menu';

  /* Предлагаем этапы ПОСЛЕ текущего */
  var hasOptions = false;
  for (var i = currentIdx + 1; i < PIPELINE_STAGES.length; i++) {
    hasOptions = true;
    var s = PIPELINE_STAGES[i];
    var item = document.createElement('div');
    item.className = 'sh-jump-item';
    item.textContent = s.name;
    item.setAttribute('data-idx', i);
    item.onclick = function() {
      var targetIdx = parseInt(this.getAttribute('data-idx'));
      document.getElementById('sh-jump-menu').remove();
      advanceStage(currentIdx, targetIdx);
    };
    menu.appendChild(item);
  }

  if (!hasOptions) {
    /* Последний этап — просто завершаем */
    advanceStage(currentIdx);
    return;
  }

  /* Заголовок */
  var header = document.createElement('div');
  header.className = 'sh-jump-header';
  header.textContent = 'Перейти к этапу:';
  menu.insertBefore(header, menu.firstChild);

  btn.parentNode.appendChild(menu);

  /* Закрыть по клику снаружи */
  setTimeout(function() {
    document.addEventListener('click', function _close(e) {
      var m = document.getElementById('sh-jump-menu');
      if (m && !m.contains(e.target)) {
        m.remove();
        document.removeEventListener('click', _close);
      }
    });
  }, 50);
}

/**
 * Показать детальный пайплайн во всплывающем окне.
 * Отображает путь групп фото по этапам: сколько фото на каждом, куда идут.
 * Пройденные этапы — бледные, активные — яркие.
 */
function shShowDetailedPipeline() {
  var proj = getActiveProject();
  if (!proj) return;

  shEnsurePhotoStages(proj);
  var batches = proj._stageBatches || [];
  var totalPhotos = proj.previews ? proj.previews.length : 0;

  /* ---------- Таблица триггер → человекочитаемое название ---------- */
  var triggerLabels = {
    'manual': 'Переход вручную',
    'manual_advance': 'Переход этапа',
    'send_client_link': 'Отправлено клиенту',
    'client_approved': 'Клиент согласовал',
    'client_extra_request': 'Клиент запросил ещё',
    'preview_loaded': 'Превью загружены',
    'selection_done': 'Отбор завершён',
    'cc_loaded': 'ЦК загружена',
    'cc_confirmed': 'ЦК подтверждена',
    'retouch_comments': 'Комментарии отправлены',
    'retouch_loaded': 'Ретушь загружена',
    'retouch_approved': 'Ретушь согласована',
    'retouch_returned': 'Ретушь возвращена',
    'adaptation_done': 'Финал'
  };

  var html = '<div class="sh-detail-pipeline">';
  html += '<h3 style="margin:0 0 16px 0;font-size:16px">Маршруты фотографий</h3>';

  /* Если реальных батчей нет — синтезируем линейный таймлайн из _stageHistory
     (для проектов, созданных до появления batch-трекинга). */
  var synthesized = false;
  if (batches.length === 0 && proj._stageHistory) {
    var histKeys = [];
    for (var _hk in proj._stageHistory) {
      if (proj._stageHistory.hasOwnProperty(_hk) && /^\d+$/.test(_hk)) {
        histKeys.push(parseInt(_hk, 10));
      }
    }
    histKeys.sort(function(a, b) { return a - b; });
    if (histKeys.length >= 1) {
      var synthBatches = [];
      var _prevId = null;
      for (var _hi = 0; _hi < histKeys.length; _hi++) {
        var _toH = histKeys[_hi];
        var _fromH = (_hi === 0) ? Math.max(0, _toH - 1) : histKeys[_hi - 1];
        if (_toH === _fromH) continue;
        var _timeStr = proj._stageHistory[_toH] || '';
        var _synthId = 'synth_' + _toH + '_' + _hi;
        synthBatches.push({
          id: _synthId,
          photos: [],
          fromStage: _fromH,
          toStage: _toH,
          date: new Date().toISOString(),
          _dateDisplay: _timeStr,
          trigger: 'manual',
          count: totalPhotos,
          parentBatchIds: _prevId ? [_prevId] : [],
          _synthesized: true
        });
        _prevId = _synthId;
      }
      if (synthBatches.length > 0) {
        batches = synthBatches;
        synthesized = true;
      }
    }
  }

  if (synthesized) {
    html += '<div style="font-size:11px;color:#8a6d00;background:#fff8dc;padding:6px 8px;border-radius:4px;margin-bottom:12px;line-height:1.4">';
    html += 'Маршруты реконструированы по истории этапов. Подробности ветвлений появятся при следующих переходах.';
    html += '</div>';
  }

  if (batches.length === 0) {
    /* Нет ни батчей, ни истории — показать текущее распределение */
    var photoCounts = shPhotosPerStage(proj);
    html += '<div style="color:#888;font-size:13px;margin-bottom:12px">';
    html += 'Пока нет записанных перемещений. Текущее распределение:';
    html += '</div>';
    for (var i = 0; i < PIPELINE_STAGES.length; i++) {
      if (photoCounts[i] === 0) continue;
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">';
      html += '<span style="color:#aaa;width:16px;text-align:right">' + (i + 1) + '</span>';
      html += '<span>' + esc(PIPELINE_STAGES[i].name) + '</span>';
      html += '<span style="color:#888;font-size:12px">' + photoCounts[i] + ' фото</span>';
      html += '</div>';
    }
    html += '<div style="margin-top:12px;font-size:11px;color:#bbb">';
    html += 'Маршруты начнут записываться при переходах между этапами.</div>';
  } else {
    /* ---------- Дерево маршрутов ---------- */
    /* Индекс batch по ID для быстрого поиска */
    var batchById = {};
    for (var bi = 0; bi < batches.length; bi++) {
      batchById[batches[bi].id] = batches[bi];
    }

    /* Найти сколько потомков у каждого batch (для определения точек ветвления) */
    var childCount = {};
    for (var ci = 0; ci < batches.length; ci++) {
      var pids = batches[ci].parentBatchIds || [];
      for (var pi = 0; pi < pids.length; pi++) {
        childCount[pids[pi]] = (childCount[pids[pi]] || 0) + 1;
      }
    }

    /* Рисуем хронологически (batches уже в порядке создания) */
    for (var ri = 0; ri < batches.length; ri++) {
      var b = batches[ri];
      var fromName = PIPELINE_STAGES[b.fromStage] ? PIPELINE_STAGES[b.fromStage].name : ('Этап ' + b.fromStage);
      var toName = PIPELINE_STAGES[b.toStage] ? PIPELINE_STAGES[b.toStage].name : ('Этап ' + b.toStage);
      var label = triggerLabels[b.trigger] || b.trigger;
      var dateStr;
      if (b._dateDisplay) {
        dateStr = b._dateDisplay;
      } else {
        var d = new Date(b.date);
        dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      }
      var photoCount = b.count || (b.photos ? b.photos.length : 0);

      /* Определить тип узла: обычный, ветвление, слияние */
      var parents = b.parentBatchIds || [];
      var isMerge = parents.length > 1;
      var isBranch = false;
      for (var pp = 0; pp < parents.length; pp++) {
        if ((childCount[parents[pp]] || 0) > 1) { isBranch = true; break; }
      }
      var isSkip = (b.toStage - b.fromStage) > 1;

      /* Цвет линии: обычный серый, ветвление — тёмный, слияние — тёмный */
      var lineColor = (isMerge || isBranch) ? '#333' : '#ccc';
      var dotBorder = (isMerge || isBranch) ? '2px solid #333' : '2px solid #ccc';
      var dotBg = isMerge ? '#333' : '#fff';
      var dotColor = isMerge ? '#fff' : '#333';

      html += '<div style="display:flex;gap:10px;position:relative;min-height:44px">';

      /* Вертикальная линия + точка */
      html += '<div style="display:flex;flex-direction:column;align-items:center;width:20px;flex-shrink:0">';
      if (ri > 0) {
        html += '<div style="width:2px;height:8px;background:' + lineColor + '"></div>';
      } else {
        html += '<div style="height:8px"></div>';
      }
      /* Точка — кружок или ромб для ветвления */
      if (isMerge) {
        html += '<div style="width:12px;height:12px;border-radius:50%;background:' + dotBg + ';border:' + dotBorder + ';flex-shrink:0"></div>';
      } else if (isBranch) {
        html += '<div style="width:10px;height:10px;transform:rotate(45deg);background:#fff;border:' + dotBorder + ';flex-shrink:0"></div>';
      } else {
        html += '<div style="width:10px;height:10px;border-radius:50%;background:' + dotBg + ';border:' + dotBorder + ';flex-shrink:0"></div>';
      }
      if (ri < batches.length - 1) {
        html += '<div style="width:2px;flex:1;background:#e0e0e0"></div>';
      }
      html += '</div>';

      /* Содержимое */
      html += '<div style="flex:1;padding-bottom:8px">';

      /* Заголовок: N фото: From -> To */
      html += '<div style="font-size:13px;font-weight:500;color:#333">';
      html += photoCount + ' фото: ';
      html += esc(fromName) + ' &rarr; ' + esc(toName);
      if (isSkip) html += ' <span style="font-size:11px;color:#c62828">(пропуск)</span>';
      html += '</div>';

      /* Подробности: триггер, дата */
      html += '<div style="font-size:11px;color:#888;margin-top:2px">';
      html += esc(label) + ' &middot; ' + dateStr;
      html += '</div>';

      /* Индикаторы ветвления/слияния */
      if (isMerge) {
        html += '<div style="font-size:11px;color:#555;margin-top:2px">';
        html += 'Слияние ' + parents.length + ' потоков';
        html += '</div>';
      }

      html += '</div>'; /* /flex:1 */
      html += '</div>'; /* /row */
    }
  }

  /* Итого */
  html += '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee;font-size:12px;color:#888">';
  html += 'Всего: ' + totalPhotos + ' фото';
  if (batches.length > 0) html += ' &middot; ' + batches.length + ' перемещений';
  html += '</div>';
  html += '</div>';

  /* Динамическая модалка */
  var overlay = document.getElementById('sh-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sh-detail-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal" style="max-width:520px;padding:24px;max-height:80vh;overflow-y:auto"></div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.classList.remove('open');
    });
    document.body.appendChild(overlay);
  }
  overlay.querySelector('.modal').innerHTML = html;
  overlay.classList.add('open');
}

/**
 * Рендерить ячейку ветки комментирования для данного этапа пайплайна.
 * Встраивается прямо внутрь pipeline-step для идеальной синхронизации высот.
 *
 * @param {number} i — индекс этапа
 * @param {number} stage — текущий активный этап
 * @param {number} branchStart — этап начала ветки
 * @param {number} branchEnd — этап конца ветки (-1 = не завершена)
 * @param {number} cmtCount — кол-во комментариев к карточкам
 * @param {number} annotCount — кол-во аннотаций к фото
 * @returns {string|null} HTML или null если нет ветки на этом этапе
 */
function _shRenderBranchCell(i, stage, branchStart, branchEnd, cmtCount, annotCount) {
  /* Этап вне диапазона ветки — ничего не рисуем */
  if (i < branchStart) return null;
  if (branchEnd >= 0 && i > branchEnd) return null;
  if (branchEnd < 0 && i > stage) return null;

  var html = '<div class="pl-branch">';

  /* Счётчик комментариев/аннотаций (только на стартовом этапе) */
  var stats = '';
  if (i === branchStart) {
    var parts = [];
    if (cmtCount > 0) parts.push(cmtCount + ' комм.');
    if (annotCount > 0) parts.push(annotCount + ' аннот.');
    stats = parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
  }

  /* Однострочная ветка (начало=конец на одном этапе, уже завершена) */
  if (branchEnd >= 0 && i === branchStart && i === branchEnd) {
    html += '<span class="pl-branch-line pl-branch-done"></span>';
    html += '<span class="pl-branch-dot pl-branch-dot-done"></span>';
    html += '<span class="pl-branch-label">Комментарии отправлены' + stats + '</span>';
  }
  /* Старт ветки (ответвление) */
  else if (i === branchStart) {
    html += '<span class="pl-branch-line"></span>';
    html += '<span class="pl-branch-dot"></span>';
    html += '<span class="pl-branch-label">Комментирование' + stats + '</span>';
    /* Кнопка "Отправить" — на стартовом этапе, если ветка не завершена */
    if (branchEnd < 0) {
      html += '<button class="pl-send-btn" onclick="event.stopPropagation();shFinishCommenting()">Отправить комментарии</button>';
    }
  }
  /* Промежуточные этапы (параллельная линия) */
  else if (i > branchStart && (branchEnd < 0 ? i < stage : i < branchEnd)) {
    html += '<span class="pl-branch-line pl-branch-cont"></span>';
  }
  /* Точка слияния (конец ветки) */
  else if (branchEnd >= 0 && i === branchEnd) {
    html += '<span class="pl-branch-line pl-branch-done"></span>';
    html += '<span class="pl-branch-dot pl-branch-dot-done"></span>';
    html += '<span class="pl-branch-label">Комментарии отправлены</span>';
  }
  /* Текущий активный этап, ветка ещё идёт (пунктирное окончание) */
  else if (branchEnd < 0 && i === stage && i > branchStart) {
    html += '<span class="pl-branch-line pl-branch-dashed"></span>';
    html += '<button class="pl-send-btn" onclick="event.stopPropagation();shFinishCommenting()">Отправить комментарии</button>';
  }

  html += '</div>';
  return html;
}

/**
 * Отрисовать таймлайн контрольных точек для пайплайна.
 * @param {Object} proj — проект
 * @returns {string} HTML
 */
function _shRenderTimeline(proj) {
  var checkpoints = proj._checkpoints || [];
  if (checkpoints.length === 0) return '';

  /* Человекочитаемые названия триггеров */
  var triggerLabelsMap = {
    'preview_loaded': 'Превью загружены',
    'selection_done': 'Отбор отправлен клиенту',
    'client_received': 'Клиент открыл',
    'client_saved': 'Клиент сохранил изменения',
    'client_approved': 'Клиент согласовал',
    'client_returned': 'Возврат на доработку',
    'photo_killed': 'Фото удалено из отбора',
    'cc_loaded': 'ЦК загружена',
    'cc_confirmed': 'ЦК подтверждена',
    'retouch_comments': 'Комментарии завершены',
    'retouch_loaded': 'Ретушь загружена',
    'retouch_approved': 'Ретушь согласована',
    'retouch_returned': 'Ретушь возвращена',
    'manual': 'Ручная фиксация',
    'adaptation_done': 'Финал'
  };

  /* Цвета по этапам */
  var stageColors = {
    'preselect': '#e3f2fd',
    'selection': '#e8f5e9',
    'client': '#fffde7',
    'color': '#fff3e0',
    'retouch_task': '#f3e5f5',
    'retouch': '#fce4ec',
    'retouch_ok': '#e0f7fa',
    'adaptation': '#f5f5f5'
  };

  var html = '<div class="pipeline-timeline">';
  html += '<div class="pipeline-timeline-title">Контрольные точки</div>';

  for (var i = 0; i < checkpoints.length; i++) {
    var cp = checkpoints[i];
    var d = new Date(cp.date);
    var dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var label = triggerLabelsMap[cp.trigger] || cp.trigger;
    var bgColor = stageColors[cp.stage] || '#f5f5f5';
    var photoCount = cp.photos ? cp.photos.length : 0;

    html += '<div class="pipeline-cp" style="border-left-color:' + bgColor + '">';
    html += '<div class="pipeline-cp-header">';
    html += '<span class="pipeline-cp-label">' + esc(label) + '</span>';
    html += '<span class="pipeline-cp-date">' + dateStr + '</span>';
    html += '</div>';

    /* Инфо-строка: кол-во фото + примечание */
    var infoParts = [];
    if (photoCount > 0) infoParts.push(photoCount + ' фото');
    if (cp.added && cp.added.length > 0) infoParts.push('+' + cp.added.length + ' добавлено');
    if (cp.removed && cp.removed.length > 0) infoParts.push('-' + cp.removed.length + ' убрано');
    if (cp.iteration > 0) infoParts.push('итерация ' + cp.iteration);
    if (cp.note) infoParts.push(cp.note);

    if (infoParts.length > 0) {
      html += '<div class="pipeline-cp-info">' + esc(infoParts.join(' / ')) + '</div>';
    }

    html += '</div>';
  }

  /* Ветка комментирования теперь рисуется inline в pipeline-steps, а не здесь */

  html += '</div>';
  return html;
}

/* TODO: shOpenDetailedPipeline() — подробный полноэкранный пайплайн
   с историей batch-перемещений, ветками, возвратами.
   Отложено до после беты — требует миграции БД. */

/**
 * Завершить процесс комментирования: отметить проект как "комменты завершены",
 * записать дату и текущий этап в проект, перерисовать пайплайн.
 */
function shFinishCommenting() {
  var proj = getActiveProject();
  if (!proj) return;
  if (proj._commentingDone) return; /* Уже завершено */

  proj._commentingDone = new Date().toISOString();

  /* Записываем текущий этап для визуализации на таймлайне */
  var stageNames = ['Преотбор', 'Отбор', 'Клиент', 'ЦК', 'Ретушь (ТЗ)', 'Ретушь', 'Согласование', 'Адаптация'];
  proj._commentingDoneStage = stageNames[proj._stage || 0] || '';
  proj._commentingDoneStageIdx = proj._stage || 0;

  /* Добавить контрольную точку */
  if (!proj._checkpoints) proj._checkpoints = [];
  proj._checkpoints.push({
    trigger: 'retouch_comments',
    stage: 'retouch_task',
    date: proj._commentingDone,
    note: 'Комментарии отправлены'
  });

  /* Автосохранение + перерисовка */
  if (typeof shAutoSave === 'function') shAutoSave();
  if (typeof renderPipeline === 'function') renderPipeline();
  if (typeof shCloudSyncExplicit === 'function') shCloudSyncExplicit();
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
 * Перевести все фотографии с этапа stageIdx на следующий этап.
 * Записывает batch event в proj._stageBatches, обновляет _stageHistory.
 *
 * @param {number} [stageIdx] — индекс этапа, с которого двигаем фото.
 *   Если не указан, используется proj._stage (backward compatible).
 */
function advanceStage(stageIdx, targetIdx) {
  if (App.selectedProject < 0) return;
  var proj = App.projects[App.selectedProject];
  shEnsurePhotoStages(proj);

  /* Определяем этап */
  if (typeof stageIdx !== 'number') stageIdx = proj._stage || 0;
  if (stageIdx >= PIPELINE_STAGES.length - 1) return; /* последний этап — некуда двигать */

  var currentStageObj = PIPELINE_STAGES[stageIdx];
  /* Нелинейный переход: targetIdx позволяет прыгнуть через этапы */
  var nextStageIdx = (typeof targetIdx === 'number' && targetIdx > stageIdx) ? targetIdx : stageIdx + 1;

  /* Собираем фото на этом этапе */
  var movedPhotos = [];
  if (proj.previews) {
    for (var i = 0; i < proj.previews.length; i++) {
      if (proj.previews[i]._stage === stageIdx) {
        proj.previews[i]._stage = nextStageIdx;
        movedPhotos.push(proj.previews[i].name);
      }
    }
  }

  if (movedPhotos.length === 0 && proj.previews && proj.previews.length > 0) {
    /* На этапе нет фото — нечего двигать */
    return;
  }

  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  /* ── Даты этапов ── */
  if (!proj._stageHistory) proj._stageHistory = {};
  if (!proj._stageDates) proj._stageDates = {};

  /* Дата первого попадания фото на следующий этап */
  if (!proj._stageDates[nextStageIdx]) {
    proj._stageDates[nextStageIdx] = { firstEnter: now.toISOString() };
  }

  /* Дата завершения этапа: перезаписывается каждый раз, когда этап становится пустым.
     Если клиент вернул фото — этап "откроется", а дата перезапишется когда они снова уйдут. */
  var remaining = shPhotosPerStage(proj);
  if (remaining[stageIdx] === 0) {
    proj._stageHistory[stageIdx] = timeStr;
    if (!proj._stageDates[stageIdx]) proj._stageDates[stageIdx] = {};
    proj._stageDates[stageIdx].lastLeave = now.toISOString();
  }

  /* Batch event: группа фото переехала (с parent links для дерева) */
  shRecordBatchMove(proj, movedPhotos, stageIdx, nextStageIdx, 'manual');

  /* Обновить проектный этап (для backward compat) — минимальный этап с фото */
  proj._stage = shProjectFront(proj);

  /* Checkpoint: ручная фиксация */
  if (typeof cpkCreate === 'function') {
    cpkCreate('manual', {
      stage: currentStageObj.id,
      photos: movedPhotos,
      note: movedPhotos.length + ' фото: "' + currentStageObj.name + '" -> "' + PIPELINE_STAGES[nextStageIdx].name + '"'
    });
  }

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

      /* Шаг 3: зафиксировать этап + время, переместить все фото на этап "client" */
      if (!proj._stageHistory) proj._stageHistory = {};
      var now = new Date();
      var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      proj._stageHistory[proj._stage] = timeStr;

      /* Переместить все фото до этапа client (2) — на client.
         Группируем по исходному этапу, чтобы каждый source-этап стал отдельным batch
         (для корректной отрисовки веток в детальном пайплайне). */
      shEnsurePhotoStages(proj);
      if (proj.previews) {
        var movedByStage = {};
        for (var _pi = 0; _pi < proj.previews.length; _pi++) {
          var _src = proj.previews[_pi]._stage;
          if (_src < 2) {
            if (!movedByStage[_src]) movedByStage[_src] = [];
            movedByStage[_src].push(proj.previews[_pi].name);
            proj.previews[_pi]._stage = 2;
          }
        }
        /* Записать batch event для каждой исходной группы */
        for (var _src in movedByStage) {
          if (movedByStage.hasOwnProperty(_src)) {
            shRecordBatchMove(proj, movedByStage[_src], parseInt(_src, 10), 2, 'send_client_link');
          }
        }
      }

      /* Шаг 4: перейти к этапу "Отбор клиента" */
      proj._stage = 2; /* client */
      renderPipeline();
      shAutoSave();

      /* Синхронизация этапа с облаком */
      if (typeof sbSyncStage === 'function') sbSyncStage('send_client_link', timeStr);

      /* Checkpoint: отправка клиенту */
      if (typeof cpkCreate === 'function') {
        cpkCreate('selection_done', {
          stage: 'selection',
          photos: (typeof cpkGetSelectionList === 'function') ? cpkGetSelectionList() : [],
          note: 'Ссылка отправлена клиенту'
        });
      }

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

/** @type {boolean} Флаг "есть ожидающие изменения":
 *  устанавливается каждым shCloudSyncExplicit(), очищается в начале фактического sync.
 *  Если во время работы sync пришёл новый shCloudSyncExplicit — флаг снова true,
 *  и после завершения текущего sync запускаем повторный (очередь длиной 1).
 *  Без этого механизма быстрые серии изменений (напр. 57 карточек подряд) могли
 *  потеряться: таймер срабатывал, видел _shCloudSyncRunning=true и молча выходил,
 *  а после завершения долгой первичной заливки ничего не перезапускало sync. */
var _shCloudSyncPending = false;

/** @type {number|null} Таймер debounce для явной синхронизации */
var _shExplicitSyncTimer = null;

/** @type {number} Задержка debounce для явной синхронизации (мс) — как в v0.9 */
var SH_EXPLICIT_SYNC_DELAY = 3000;

/** @type {number} Короткая задержка повторного sync после завершения текущего (мс).
 *  Достаточно малая чтобы pending изменения быстро долетели до облака,
 *  достаточно большая чтобы новые действия пользователя успели "прилипнуть". */
var SH_REFLUSH_DELAY = 500;

/**
 * ОТКЛЮЧЕНА. Автосинхронизация вызывала перезапись облачных данных.
 * Оставлена как заглушка — вызовы из старого кода не сломаются.
 */
function shAutoCloudSync() {
  /* Отключена. Облако обновляется только через shCloudSyncExplicit(). */
}

/**
 * Завершить цикл sync: сбросить running-флаг и, если за время работы
 * пришли новые изменения (_shCloudSyncPending=true), запустить повторный sync.
 * Вызывается из КАЖДОГО callback'а _shDoCloudSync и из safety-таймаута.
 */
function _shFinishSync() {
  _shCloudSyncRunning = false;
  if (_shCloudSyncPending) {
    /* За время sync были новые изменения — запланировать повторный sync
       через короткую паузу. Это гарантирует что 57-я карточка долетит,
       даже если первая заливка заняла 10 секунд. */
    if (_shExplicitSyncTimer) clearTimeout(_shExplicitSyncTimer);
    _shExplicitSyncTimer = setTimeout(function() {
      _shExplicitSyncTimer = null;
      _shDoCloudSync();
    }, SH_REFLUSH_DELAY);
  }
}

/**
 * Явная синхронизация с облаком (debounced 3 сек, как в v0.9).
 * Несколько быстрых действий собираются в один sync.
 * Блокирует pull на время работы.
 */
function shCloudSyncExplicit() {
  /* Пометить что есть локальные изменения — pull будет пропущен */
  if (typeof sbMarkPushDone === 'function') sbMarkPushDone();

  /* Пометить что есть несинхронизированные изменения.
     Флаг будет сброшен в начале фактического _shDoCloudSync.
     Если sync уже идёт — флаг останется true и _shFinishSync запустит повторный. */
  _shCloudSyncPending = true;

  if (_shExplicitSyncTimer) clearTimeout(_shExplicitSyncTimer);
  _shExplicitSyncTimer = setTimeout(function() {
    _shExplicitSyncTimer = null;
    _shDoCloudSync();
  }, SH_EXPLICIT_SYNC_DELAY);
}

/**
 * Внутренняя: выполнить облачную синхронизацию.
 */
function _shDoCloudSync() {
  /* Если sync уже идёт — просто выходим. _shCloudSyncPending уже true,
     _shFinishSync после завершения увидит его и запустит повторный sync. */
  if (_shCloudSyncRunning) return;

  /* Снять флаг ожидания: мы сейчас начнём sync. Если за время работы придут
     новые изменения, shCloudSyncExplicit() снова поставит _shCloudSyncPending=true,
     и _shFinishSync запустит повторный sync после завершения текущего. */
  _shCloudSyncPending = false;

  var isOwner = (typeof sbIsLoggedIn === 'function') && sbIsLoggedIn();
  var isClient = !!window._shareToken;
  if (!isOwner && !isClient) return;

  var proj = getActiveProject();
  if (!proj) return;

  /* Safety-таймаут: если sync не завершился за 30 сек — сбрасываем флаг.
     Защита от зависания при необработанном exception внутри promise. */
  var _syncSafetyTimer = setTimeout(function() {
    if (_shCloudSyncRunning) {
      console.warn('cloud-sync: safety timeout — сброс флага _shCloudSyncRunning');
      /* Используем _shFinishSync: если за 30 сек пришли изменения — они не потеряются,
         а запустят повторный sync. */
      _shFinishSync();
    }
  }, 30000);

  /* Если пользователь залогинен — ВСЕГДА используем owner-путь (прямой доступ к таблицам).
     Это надёжнее чем RPC save_cards_by_token (которая может не существовать).
     Owner-путь работает через RLS: залогиненный пользователь = владелец проекта. */
  if (isOwner && proj._cloudId) {
    _shCloudSyncRunning = true;
    sbSyncCardsLight(proj._cloudId, proj.cards || [], function(err) {
      clearTimeout(_syncSafetyTimer);
      _shFinishSync();
      if (typeof sbMarkPushDone === 'function') sbMarkPushDone();
      if (err) {
        console.warn('cloud-sync: ошибка:', err);
        if (typeof _sbShowSyncStatus === 'function') _sbShowSyncStatus('Ошибка синхронизации', true);
      } else {
        console.log('cloud-sync: синхронизировано (owner path)');
        if (typeof _sbShowSyncStatus === 'function') _sbShowSyncStatus('Сохранено');

        /* Синхронизировать артикулы и лог переименований — fire-and-forget.
           Вызывается только если в проекте есть артикулы (не трогать если пустые).
           Не блокирует основной флаг _shCloudSyncRunning. */
        if (typeof sbSaveArticles === 'function' && proj.articles && proj.articles.length > 0) {
          sbSaveArticles(proj, function(artErr) {
            if (artErr) console.warn('cloud-sync: articles error:', artErr);
          });
        }
        if (typeof sbSaveRenameLog === 'function' && proj._renameLog && proj._renameLog.length > 0) {
          sbSaveRenameLog(proj, function(logErr) {
            if (logErr) console.warn('cloud-sync: rename_log error:', logErr);
          });
        }
      }
    });
    return;
  }

  /* Анонимный клиент по share-ссылке — синхронизация через RPC */
  if (isClient && !isOwner && proj._cloudId) {
    _shCloudSyncRunning = true;
    sbSaveCardsByToken(window._shareToken, proj.cards || [], function(err) {
      clearTimeout(_syncSafetyTimer);
      _shFinishSync();
      if (typeof sbMarkPushDone === 'function') sbMarkPushDone();
      if (err) {
        console.warn('cloud-sync (client): ошибка:', err);
        if (typeof _sbShowSyncStatus === 'function') _sbShowSyncStatus('Ошибка сохранения', true);
      } else {
        console.log('cloud-sync (client): синхронизировано');
        if (typeof _sbShowSyncStatus === 'function') _sbShowSyncStatus('Сохранено');
      }
    });
    return;
  }

  /* Фотограф: проект ещё не в облаке — загружаем впервые */
  if (!proj._cloudId) {
    _shCloudSyncRunning = true;
    console.log('cloud-sync: первичная загрузка "' + proj.brand + '" в облако...');
    /* КРИТИЧНО: первичная заливка сохраняет снапшот proj.cards на момент вызова.
       Если во время заливки пользователь добавит ещё карточек — они останутся в
       _shCloudSyncPending=true, и _shFinishSync запустит повторный sync (на этот
       раз через owner-путь sbSyncCardsLight, т.к. _cloudId уже установлен).
       Так мы гарантированно догоним все карточки, добавленные во время первой
       долгой заливки. */
    sbUploadProject(App.selectedProject, function(err, cloudId) {
      clearTimeout(_syncSafetyTimer);
      if (err) {
        console.warn('cloud-sync: ошибка загрузки:', err);
        /* При ошибке первичной заливки вернуть pending=true — следующий sync
           снова попытается через owner-путь или повторит первичную заливку. */
        _shCloudSyncPending = true;
      } else {
        console.log('cloud-sync: проект загружен, cloudId:', cloudId);
        if (typeof _sbShowSyncStatus === 'function') _sbShowSyncStatus('Сохранено');
      }
      _shFinishSync();
    });
    return;
  }
  clearTimeout(_syncSafetyTimer);
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

    /* GC: почистить maketcp_pv_* ключи для проектов, которых больше нет
       в App.projects (удалены или перенесены в облако). Эти ключи
       могут занимать сотни KB и душить квоту localStorage. */
    var activeKeys = {};
    for (var ai = 0; ai < App.projects.length; ai++) {
      if (!App.projects[ai]._cloudId) {
        activeKeys[SH_PREVIEWS_KEY_PREFIX + _shProjKey(App.projects[ai])] = true;
      }
    }
    var lsKeys = Object.keys(localStorage);
    for (var lk = 0; lk < lsKeys.length; lk++) {
      var k = lsKeys[lk];
      if (k.indexOf(SH_PREVIEWS_KEY_PREFIX) === 0 && !activeKeys[k]) {
        try {
          localStorage.removeItem(k);
          console.log('localStorage GC: удалён orphan превью-ключ', k);
        } catch(gcErr) { /* ignore */ }
      }
    }

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

/** @type {boolean} Флаг: мобильный режим владельца (зарегистрированный пользователь на мобиле) */
var _appMobileOwner = false;

/**
 * Проверить, нужен ли мобильный режим для залогиненного пользователя.
 * Вызывается после загрузки проектов из облака.
 * @returns {boolean} true если активирован мобильный режим
 */
function shCheckMobileOwner() {
  if (window.innerWidth >= 768) return false;
  if (window._isShareLink) return false;
  /* Desktop (pywebview) — никогда не переключать на мобильный режим */
  if (window.pywebview && window.pywebview.api) return false;

  _appMobileOwner = true;
  _appClientMode = true; /* чтобы cpIsMobileClient() и мобильный UI работали */

  /* Показать экран выбора проекта */
  _mobShowProjectPicker();
  return true;
}

/**
 * Показать мобильный экран выбора проекта.
 * Полноэкранный список проектов из облака.
 */
function _mobShowProjectPicker() {
  var appMain = document.getElementById('app-main');
  if (!appMain) return;

  /* Убрать лоадер если был */
  var mobLoader = document.getElementById('mob-loader');
  if (mobLoader) mobLoader.remove();

  /* Скрыть всё десктопное */
  for (var i = 0; i < appMain.children.length; i++) {
    var child = appMain.children[i];
    if (child.id !== 'mob-wrap') child.style.display = 'none';
  }

  /* Создать мобильный контейнер */
  var mobWrap = document.getElementById('mob-wrap');
  if (!mobWrap) {
    mobWrap = document.createElement('div');
    mobWrap.id = 'mob-wrap';
    appMain.appendChild(mobWrap);
  }

  var projects = App.projects || [];
  var html = '';

  /* Шапка */
  html += '<div class="mob-picker-header">';
  html += '<div class="mob-picker-title">Maket CP</div>';
  if (typeof sbUser !== 'undefined' && sbUser && sbUser.email) {
    html += '<div class="mob-picker-user">' + esc(sbUser.email) + '</div>';
  }
  html += '</div>';

  /* Список проектов */
  html += '<div class="mob-picker-list">';

  if (projects.length === 0) {
    html += '<div class="mob-picker-empty">Нет проектов</div>';
  } else {
    for (var p = 0; p < projects.length; p++) {
      var proj = projects[p];
      if (proj._deletedAt) continue; /* скрытые не показываем */
      var brandName = esc(shProjectDisplayName(proj));
      var cardsCount = proj.cards ? proj.cards.length : 0;
      var pvCount = proj.previews ? proj.previews.length : 0;
      var stageText = '';
      if (typeof PIPELINE_STAGES !== 'undefined' && PIPELINE_STAGES[proj._stage || 0]) {
        stageText = PIPELINE_STAGES[proj._stage || 0].name || '';
      }

      html += '<div class="mob-picker-item" onclick="_mobSelectProject(' + p + ')">';
      html += '<div class="mob-picker-brand">' + (brandName || 'Без названия') + '</div>';
      html += '<div class="mob-picker-meta">';
      if (proj.shoot_date) html += '<span>' + esc(proj.shoot_date) + '</span>';
      html += '<span>' + cardsCount + ' карт.</span>';
      html += '<span>' + pvCount + ' фото</span>';
      if (stageText) html += '<span>' + esc(stageText) + '</span>';
      html += '</div>';
      html += '</div>';
    }
  }
  html += '</div>';

  mobWrap.innerHTML = html;
}

/**
 * Выбрать проект в мобильном режиме владельца.
 * Переключает на мобильный UI с карточками (как у клиента, но с правами owner).
 * @param {number} idx — индекс проекта в App.projects
 */
function _mobSelectProject(idx) {
  App.selectedProject = idx;
  App.currentCardIdx = -1;

  var proj = getActiveProject();
  if (proj) {
    proj._role = 'owner';
    /* Восстановить активную версию превью */
    if (proj._activeVersion && typeof PV_ACTIVE_VERSION !== 'undefined') {
      PV_ACTIVE_VERSION = proj._activeVersion;
    }
  }

  /* Скрыть навигацию, шапку и прочее десктопное */
  var navbar = document.querySelector('.nav');
  if (navbar) navbar.style.display = 'none';
  var projHeader = document.querySelector('.projects-header');
  if (projHeader) projHeader.style.display = 'none';
  var projList = document.querySelector('.shootings-left');
  if (projList) projList.style.display = 'none';
  var pipelinePanel = document.querySelector('.pipeline-panel');
  if (pipelinePanel) pipelinePanel.style.display = 'none';

  /* Запустить синхронизацию для выбранного проекта */
  if (typeof sbStartAutoPull === 'function') sbStartAutoPull();
  if (proj && proj._cloudId && typeof sbSubscribeVersions === 'function') {
    sbSubscribeVersions(proj._cloudId);
  }
  /* Подтянуть превью из IndexedDB если ещё не загружены */
  if (proj && typeof pvDbRestoreProjectPreviews === 'function') {
    pvDbRestoreProjectPreviews(proj, function() {
      if (typeof cpMobileInit === 'function') cpMobileInit();
    });
  } else {
    if (typeof cpMobileInit === 'function') cpMobileInit();
  }
}

/**
 * Вернуться к экрану выбора проектов (мобильный режим владельца).
 */
function _mobBackToProjects() {
  /* Сбросить выбор проекта */
  App.selectedProject = -1;
  App.currentCardIdx = -1;

  /* Выйти из мобильного фида */
  if (typeof cpMobileExitFeed === 'function') cpMobileExitFeed();

  /* Показать пикер заново */
  _mobShowProjectPicker();
}

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

  /* Вернуть все фото на этап 1 (Отбор фотографа) — клиент хочет дополнительные кадры.
     Группируем по исходному этапу для корректных batch events (ветки в дереве). */
  shEnsurePhotoStages(proj);
  if (proj.previews) {
    var _movedByStage = {};
    for (var _pi = 0; _pi < proj.previews.length; _pi++) {
      var _src = proj.previews[_pi]._stage;
      if (_src !== 1) {
        if (!_movedByStage[_src]) _movedByStage[_src] = [];
        _movedByStage[_src].push(proj.previews[_pi].name);
        proj.previews[_pi]._stage = 1;
      }
    }
    for (var _src2 in _movedByStage) {
      if (_movedByStage.hasOwnProperty(_src2)) {
        shRecordBatchMove(proj, _movedByStage[_src2], parseInt(_src2, 10), 1, 'client_extra_request');
      }
    }
  }
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

  /* Переместить все фото на этап 3 (Цветокоррекция).
     Группируем по исходному этапу для корректных batch events. */
  shEnsurePhotoStages(proj);
  if (proj.previews) {
    var _movedByStageA = {};
    for (var _pi = 0; _pi < proj.previews.length; _pi++) {
      var _src = proj.previews[_pi]._stage;
      if (_src < 3) {
        if (!_movedByStageA[_src]) _movedByStageA[_src] = [];
        _movedByStageA[_src].push(proj.previews[_pi].name);
        proj.previews[_pi]._stage = 3;
      }
    }
    for (var _src3 in _movedByStageA) {
      if (_movedByStageA.hasOwnProperty(_src3)) {
        shRecordBatchMove(proj, _movedByStageA[_src3], parseInt(_src3, 10), 3, 'client_approved');
      }
    }
  }
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
