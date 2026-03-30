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
 * Шаблон сохраняется как templateId и полная копия в proj._template.
 * cards.js использует proj._template (если существует) или proj.templateId → getUserTemplate().
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
        /* Сохранить полную копию шаблона в проект */
        if (templateId) {
          var tmpl = getUserTemplate(templateId);
          if (tmpl) {
            data._template = templateToProjFormat(tmpl);
          }
        }
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
      /* Сохранить полную копию шаблона в проект */
      if (templateId) {
        var tmpl2 = getUserTemplate(templateId);
        if (tmpl2) {
          proj._template = templateToProjFormat(tmpl2);
        }
      }
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

  /* Записать время завершения этапа */
  if (!proj._stageHistory) proj._stageHistory = {};
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  proj._stageHistory[proj._stage] = timeStr;

  proj._stage++;
  renderPipeline();
  shAutoSave();
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
 * В browser-режиме сохраняет в localStorage.
 * В desktop-режиме — помечает "не сохранено" (ручное сохранение через кнопку).
 */
function shAutoSave() {
  if (_shAutoSaveTimer) clearTimeout(_shAutoSaveTimer);
  _shAutoSaveTimer = setTimeout(function() {
    _shAutoSaveTimer = null;
    _shDoAutoSave();
  }, SH_AUTOSAVE_DELAY);

  /* Показать индикатор "не сохранено" */
  shSetSaveStatus('saving');
}

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
    var toSave = [];
    for (var i = 0; i < App.projects.length; i++) {
      var proj = App.projects[i];
      var light = {};
      for (var key in proj) {
        if (!proj.hasOwnProperty(key)) continue;
        /* Пропускаем превью — сохраняются отдельно */
        if (key === 'previews' || key === 'otherContent') continue;
        /* Пропускаем undo-историю */
        if (key === '_history') continue;
        light[key] = proj[key];
      }
      /* Заменяем тяжёлые dataUrl в слотах на лёгкие thumbUrl */
      if (light.cards && light.cards.length > 0) {
        light.cards = _shLightenCards(light.cards);
      }
      toSave.push(light);

      /* Сохраняем превью отдельно (только thumbs).
         Пропускаем если проект в облаке — там source of truth. */
      if (proj.previews && proj.previews.length > 0 && !proj._cloudId) {
        var pvKey = SH_PREVIEWS_KEY_PREFIX + _shProjKey(proj);
        try {
          localStorage.setItem(pvKey, JSON.stringify(_shLightenPreviews(proj.previews)));
        } catch(pvErr) {
          console.warn('Превью не поместились в localStorage для ' + proj.brand + ':', pvErr);
        }
      }
    }
    localStorage.setItem(SH_AUTOSAVE_KEY, JSON.stringify(toSave));
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
function _shLightenCards(cards) {
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
          /* Сохраняем маленький thumb вместо большого preview */
          if (ls.thumbUrl) {
            ls.dataUrl = ls.thumbUrl;
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

  /* Скрыть кнопки "Добавить карточку" и "Экспорт" в сайдбаре */
  var addBtn = document.querySelector('.cp-add-card-btn');
  if (addBtn) addBtn.style.display = 'none';
  var sidebarBtns = document.querySelectorAll('.cp-sidebar .btn');
  for (var i = 0; i < sidebarBtns.length; i++) sidebarBtns[i].style.display = 'none';

  /* Превью-панель: оставляем для клиента (просмотр всех кадров) */

  /* Скрыть тулбар карточки (Редактировать шаблон, +V, +H и т.д.) */
  var cpToolbar = document.querySelector('.cp-toolbar');
  if (cpToolbar) cpToolbar.style.display = 'none';

  /* Скрыть субтабы (Карточки товара / Доп. контент) */
  var subtabs = document.querySelector('.subtabs');
  if (subtabs) subtabs.style.display = 'none';

  /* Показать панель клиента на главном экране */
  shRenderClientBar();

  /* Автоматически перейти на страницу Контент → Карточки */
  showPage('content');
  if (typeof showSubpage === 'function') showSubpage('cp');
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
  bar.innerHTML =
    '<div class="client-bar-info">' +
      '<div class="client-bar-title">' + (brandName || 'Преотбор') + '</div>' +
      '<div class="client-bar-subtitle">Просмотрите карточки и примите решение</div>' +
    '</div>' +
    '<div class="client-bar-buttons">' +
      '<button class="btn client-btn-extra" onclick="shClientRequestExtra()">Запросить доп. кадры</button>' +
      '<button class="btn btn-primary client-btn-approve" onclick="shClientApprove()">Согласовать отбор</button>' +
    '</div>';

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
