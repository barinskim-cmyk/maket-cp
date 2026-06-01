/**
 * rename.js — конструктор имён файлов для CSV-экспорта.
 *
 * Хранение конфига: `localStorage.maketcp_rename_config_<projectId>` (jsonb-like).
 * Без миграций БД. Когда дозреем до облака — переедем без потери совместимости.
 *
 * Структура конфига:
 *   {
 *     version: 1,
 *     separator: '_',           // склейка между сегментами
 *     case:     'asis'|'upper'|'lower',
 *     ext_case: 'asis'|'lower', // расширение
 *     segments: [
 *       { type: 'variable', var: 'article_sku'|'card_name'|'project_brand'|'shoot_date',
 *         fallback: '...' },
 *       { type: 'slot_map', map: { '0': 'promo', '1': 'vert', '2': 'dop' },
 *         fallback: 'extra' },
 *       { type: 'slot_number', padding: 2 },     // 01, 02, …
 *       { type: 'card_number', padding: 3 },     // 001, 002, …
 *       { type: 'literal',   text: '26W' }
 *     ]
 *   }
 *
 * Добавление нового типа = +case в `rnResolveSegment` + опц. форма в UI.
 *
 * Маша 2026-06-01.
 */

/* eslint-disable no-var */

/** Текущий контекст для резолверов. */
function _rnMakeCtx(project, card, cardIdx, slot, slotIdx, article) {
  return {
    project: project || null,
    card: card || null,
    cardIdx: (typeof cardIdx === 'number') ? cardIdx : 0,
    slot: slot || null,
    slotIdx: (typeof slotIdx === 'number') ? slotIdx : 0,
    article: article || null
  };
}

/** Применить case к строке. */
function _rnApplyCase(s, mode) {
  if (!s) return s;
  if (mode === 'upper') return String(s).toUpperCase();
  if (mode === 'lower') return String(s).toLowerCase();
  return String(s);
}

/** Падд числа нулями до width знаков. */
function _rnPad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * Резолвить один сегмент → строка. Возвращает '' если значение неизвестно
 * И нет fallback'а — в этом случае склейщик не вставит разделитель.
 */
function rnResolveSegment(seg, ctx) {
  if (!seg || !seg.type) return '';
  switch (seg.type) {
    case 'literal':
      return String(seg.text || '');

    case 'variable': {
      var v = '';
      switch (seg.var) {
        case 'article_sku':
          v = (ctx.article && ctx.article.sku) || '';
          /* fallback на card.name если артикула нет */
          if (!v && ctx.card && ctx.card.name) v = ctx.card.name;
          break;
        case 'card_name':
          v = (ctx.card && ctx.card.name) || '';
          break;
        case 'project_brand':
          v = (ctx.project && ctx.project.brand) || '';
          break;
        case 'shoot_date':
          v = (ctx.project && ctx.project.shoot_date) || '';
          break;
      }
      return v || String(seg.fallback || '');
    }

    case 'slot_map': {
      var map = seg.map || {};
      var key = String(ctx.slotIdx);
      if (map.hasOwnProperty(key)) return String(map[key]);
      return String(seg.fallback || '');
    }

    case 'slot_number': {
      var pad = typeof seg.padding === 'number' ? seg.padding : 2;
      /* отсчёт с 1: slot 0 → "01" */
      return _rnPad(ctx.slotIdx + 1, pad);
    }

    case 'card_number': {
      var padC = typeof seg.padding === 'number' ? seg.padding : 3;
      return _rnPad(ctx.cardIdx + 1, padC);
    }

    default:
      return '';
  }
}

/**
 * Собрать имя файла из конфига для одного слота.
 * Расширение берётся из текущего `ctx.slot.file` (или дефолт '.jpg').
 *
 * @returns {string} — новое имя файла (без пути).
 */
function rnBuildName(config, ctx) {
  if (!config || !Array.isArray(config.segments) || config.segments.length === 0) {
    /* Дефолт: card.name_NN (с padding 2) */
    var defCardName = (ctx.card && ctx.card.name) || ('card_' + (ctx.cardIdx + 1));
    var defNum = _rnPad(ctx.slotIdx + 1, 2);
    return defCardName + '_' + defNum + _rnGetExt(ctx);
  }

  var sep = (typeof config.separator === 'string') ? config.separator : '_';
  var parts = [];
  for (var i = 0; i < config.segments.length; i++) {
    var piece = rnResolveSegment(config.segments[i], ctx);
    if (piece) parts.push(piece);
  }
  var name = parts.join(sep);
  name = _rnApplyCase(name, config.case || 'asis');

  /* sanitize: убираем символы которые ломают filesystem */
  name = name.replace(/[\\/:*?"<>|]/g, '_');

  return name + _rnGetExt(ctx, config.ext_case || 'lower');
}

/** Извлечь расширение из ctx.slot.file (или .jpg по умолчанию). */
function _rnGetExt(ctx, extCase) {
  var src = (ctx.slot && ctx.slot.file) || '';
  var dot = src.lastIndexOf('.');
  var ext = (dot >= 0) ? src.substring(dot) : '.jpg';
  if (extCase === 'lower') ext = ext.toLowerCase();
  return ext;
}

/* ──────────────────────────────────────────
   localStorage IO
   ────────────────────────────────────────── */

/** Ключ localStorage для проекта. */
function _rnStorageKey(projectId) {
  return 'maketcp_rename_config_' + String(projectId || 'noproject');
}

/**
 * Загрузить конфиг из localStorage для проекта. Если ничего нет — null
 * (вызывающий код может применить дефолт или пресет).
 */
function rnLoadConfig(projectId) {
  try {
    var raw = localStorage.getItem(_rnStorageKey(projectId));
    if (!raw) return null;
    var cfg = JSON.parse(raw);
    if (cfg && cfg.version) return cfg;
  } catch (e) { console.warn('rnLoadConfig:', e); }
  return null;
}

/** Сохранить конфиг в localStorage. */
function rnSaveConfig(projectId, config) {
  try {
    localStorage.setItem(_rnStorageKey(projectId), JSON.stringify(config));
    return true;
  } catch (e) {
    console.warn('rnSaveConfig:', e);
    return false;
  }
}

/** Сбросить конфиг проекта (вернёт null при следующем rnLoadConfig). */
function rnClearConfig(projectId) {
  try { localStorage.removeItem(_rnStorageKey(projectId)); } catch (e) {}
}

/* ──────────────────────────────────────────
   Пресеты — готовые шаблоны под конкретный бренд
   Кнопка «Применить пресет» в UI пишет это в config.
   ────────────────────────────────────────── */

/** Дефолтный шаблон: card_name + slot number. */
function rnPresetDefault() {
  return {
    version: 1,
    separator: '_',
    case: 'asis',
    ext_case: 'lower',
    segments: [
      { type: 'variable', var: 'card_name', fallback: 'card' },
      { type: 'slot_number', padding: 2 }
    ]
  };
}

/** EKONIKA: артикул + slot_map (0→promo / 1→vert / 2→dop). */
function rnPresetEkonika() {
  return {
    version: 1,
    separator: '_',
    case: 'asis',
    ext_case: 'lower',
    segments: [
      { type: 'variable', var: 'article_sku', fallback: 'no_sku' },
      { type: 'slot_map',
        map: { '0': 'promo', '1': 'vert', '2': 'dop' },
        fallback: 'extra' }
    ]
  };
}

/** Все известные пресеты для UI-выбора. */
var RN_PRESETS = [
  { id: 'default', label: 'По умолчанию (имя карточки + №)', build: rnPresetDefault },
  { id: 'ekonika', label: 'EKONIKA (артикул + promo/vert/dop)', build: rnPresetEkonika }
];

/* ──────────────────────────────────────────
   Загрузка с авто-пресетом для известных брендов.
   Используется при первом открытии — если в localStorage пусто.
   ────────────────────────────────────────── */

/**
 * Получить эффективный конфиг для проекта.
 * Приоритет:
 *   1. localStorage (если есть)
 *   2. Бренд-пресет (EKONIKA → rnPresetEkonika)
 *   3. Дефолт (rnPresetDefault)
 *
 * Если применился пресет — он НЕ записывается автоматически в localStorage,
 * чтобы пользователь в UI видел "по умолчанию" и мог редактировать.
 */
function rnGetEffectiveConfig(project) {
  var pid = project && (project._cloudId || project.id);
  var stored = rnLoadConfig(pid);
  if (stored) return stored;
  var brand = (project && project.brand) || '';
  if (brand.toUpperCase() === 'EKONIKA') return rnPresetEkonika();
  return rnPresetDefault();
}

/* ──────────────────────────────────────────
   UI — конструктор шаблона (модалка)
   ────────────────────────────────────────── */

/** Список доступных типов для добавления через UI. */
var RN_SEGMENT_TYPES = [
  { type: 'variable',    label: 'Переменная (артикул / имя карточки / бренд / дата)' },
  { type: 'slot_map',    label: 'По номеру слота: 0 → ..., 1 → ..., 2 → ...' },
  { type: 'slot_number', label: 'Номер слота (01, 02 ...)' },
  { type: 'card_number', label: 'Номер карточки (001, 002 ...)' },
  { type: 'literal',     label: 'Произвольный текст' }
];

var RN_VARIABLE_OPTIONS = [
  { value: 'article_sku',   label: 'Артикул (article_sku)' },
  { value: 'card_name',     label: 'Имя карточки (card_name)' },
  { value: 'project_brand', label: 'Бренд проекта (project_brand)' },
  { value: 'shoot_date',    label: 'Дата съёмки (shoot_date)' }
];

/** Чёрный текущий конфиг — состояние модалки (живёт между открытиями). */
var _rnEditorState = null;

/** Открыть модалку редактора. */
function rnOpenConfigEditor() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) { alert('Сначала выберите проект'); return; }
  /* Закрыть существующую если открыта */
  var existing = document.getElementById('rn-modal');
  if (existing) existing.remove();

  /* Загрузить эффективный конфиг (saved | brand-preset | default) */
  _rnEditorState = rnGetEffectiveConfig(proj);
  /* deep-clone чтобы Cancel не модифицировал исходник */
  _rnEditorState = JSON.parse(JSON.stringify(_rnEditorState));

  var overlay = document.createElement('div');
  overlay.id = 'rn-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.addEventListener('click', function(ev) {
    if (ev.target === overlay) _rnCloseModal();
  });

  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:640px;width:100%;max-height:90vh;overflow:auto;font-family:system-ui,-apple-system,sans-serif;';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  _rnRenderEditor(dialog, proj);
}

function _rnCloseModal() {
  var m = document.getElementById('rn-modal');
  if (m) m.remove();
  _rnEditorState = null;
}

/** Перерисовать содержимое модалки на основе _rnEditorState. */
function _rnRenderEditor(dialog, proj) {
  var cfg = _rnEditorState;
  var html = '';

  html += '<div style="padding:20px 24px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:12px;">';
  html += '<h3 style="margin:0;font-size:16px;flex:1">Шаблон имён файлов</h3>';
  html += '<button onclick="_rnCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;line-height:1">&times;</button>';
  html += '</div>';

  html += '<div style="padding:16px 24px;">';

  /* Пресеты */
  html += '<div style="margin-bottom:14px;font-size:12px;color:#666">Готовые пресеты:</div>';
  html += '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">';
  for (var p = 0; p < RN_PRESETS.length; p++) {
    var pr = RN_PRESETS[p];
    html += '<button class="btn btn-sm" onclick="_rnApplyPreset(\'' + pr.id + '\')">' + _rnEsc(pr.label) + '</button>';
  }
  html += '</div>';

  /* Общие настройки */
  html += '<div style="display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap">';
  html += '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#666;flex:1;min-width:120px">';
  html += '<span>Разделитель</span>';
  html += '<input type="text" id="rn-sep" value="' + _rnEsc(cfg.separator || '_') + '" maxlength="3" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-family:monospace;font-size:14px" oninput="_rnEditorState.separator=this.value;_rnUpdatePreview()">';
  html += '</label>';
  html += '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#666;flex:1;min-width:120px">';
  html += '<span>Регистр</span>';
  html += '<select id="rn-case" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:14px" onchange="_rnEditorState.case=this.value;_rnUpdatePreview()">';
  ['asis', 'upper', 'lower'].forEach(function(c) {
    html += '<option value="' + c + '"' + (cfg.case === c ? ' selected' : '') + '>' + c + '</option>';
  });
  html += '</select>';
  html += '</label>';
  html += '</div>';

  /* Сегменты */
  html += '<div style="margin-bottom:8px;font-size:12px;color:#666">Сегменты имени (склеиваются разделителем):</div>';
  html += '<div id="rn-segments">';
  for (var i = 0; i < (cfg.segments || []).length; i++) {
    html += _rnRenderSegment(cfg.segments[i], i, cfg.segments.length);
  }
  html += '</div>';

  /* Добавить сегмент */
  html += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">';
  html += '<select id="rn-add-type" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;flex:1">';
  for (var t = 0; t < RN_SEGMENT_TYPES.length; t++) {
    html += '<option value="' + RN_SEGMENT_TYPES[t].type + '">' + _rnEsc(RN_SEGMENT_TYPES[t].label) + '</option>';
  }
  html += '</select>';
  html += '<button class="btn btn-sm" onclick="_rnAddSegment()">+ Добавить сегмент</button>';
  html += '</div>';

  /* Превью */
  html += '<div style="margin-top:22px;padding:12px 14px;background:#f7f7f7;border-radius:8px">';
  html += '<div style="font-size:12px;color:#666;margin-bottom:6px">Превью (первые 3 верифицированных пары):</div>';
  html += '<div id="rn-preview" style="font-family:monospace;font-size:13px;line-height:1.6;color:#333"></div>';
  html += '</div>';

  html += '</div>'; /* /padding */

  /* Footer */
  html += '<div style="padding:14px 24px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end">';
  html += '<button class="btn btn-sm" onclick="_rnCloseModal()">Отмена</button>';
  html += '<button class="btn btn-sm" onclick="_rnSaveAndClose()" style="background:#333;color:#fff;border-color:#333">Сохранить</button>';
  html += '</div>';

  dialog.innerHTML = html;
  _rnUpdatePreview();
}

/** HTML для одного сегмента. */
function _rnRenderSegment(seg, idx, total) {
  var h = '<div data-rn-seg="' + idx + '" style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:8px;background:#fafafa">';
  h += '<div style="display:flex;flex-direction:column;gap:2px">';
  h += '<button class="btn btn-sm" ' + (idx === 0 ? 'disabled' : '') + ' onclick="_rnMoveSegment(' + idx + ',-1)" title="Выше" style="padding:2px 8px;font-size:11px">↑</button>';
  h += '<button class="btn btn-sm" ' + (idx === total - 1 ? 'disabled' : '') + ' onclick="_rnMoveSegment(' + idx + ',1)" title="Ниже" style="padding:2px 8px;font-size:11px">↓</button>';
  h += '</div>';
  h += '<div style="flex:1;display:flex;flex-direction:column;gap:6px">';
  h += '<div style="font-size:11px;color:#666;text-transform:uppercase">' + _rnSegTypeLabel(seg.type) + '</div>';
  h += _rnRenderSegmentBody(seg, idx);
  h += '</div>';
  h += '<button class="btn btn-sm" onclick="_rnRemoveSegment(' + idx + ')" title="Удалить" style="padding:2px 8px;color:#c00">&times;</button>';
  h += '</div>';
  return h;
}

function _rnSegTypeLabel(t) {
  for (var i = 0; i < RN_SEGMENT_TYPES.length; i++) if (RN_SEGMENT_TYPES[i].type === t) return RN_SEGMENT_TYPES[i].label;
  return t;
}

function _rnRenderSegmentBody(seg, idx) {
  var h = '';
  if (seg.type === 'variable') {
    h += '<select onchange="_rnUpdateSegField(' + idx + ',\'var\',this.value)" style="padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px">';
    for (var v = 0; v < RN_VARIABLE_OPTIONS.length; v++) {
      var opt = RN_VARIABLE_OPTIONS[v];
      h += '<option value="' + opt.value + '"' + (seg.var === opt.value ? ' selected' : '') + '>' + _rnEsc(opt.label) + '</option>';
    }
    h += '</select>';
    h += '<input type="text" placeholder="Запасной текст (если пусто)" value="' + _rnEsc(seg.fallback || '') + '" oninput="_rnUpdateSegField(' + idx + ',\'fallback\',this.value)" style="padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px;font-family:monospace">';
  } else if (seg.type === 'literal') {
    h += '<input type="text" placeholder="Текст" value="' + _rnEsc(seg.text || '') + '" oninput="_rnUpdateSegField(' + idx + ',\'text\',this.value)" style="padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px;font-family:monospace">';
  } else if (seg.type === 'slot_map') {
    var map = seg.map || {};
    var keys = Object.keys(map).sort(function(a, b) { return Number(a) - Number(b); });
    if (keys.length === 0) keys = ['0'];
    h += '<div style="display:flex;flex-direction:column;gap:4px">';
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      h += '<div style="display:flex;gap:6px;align-items:center">';
      h += '<span style="font-family:monospace;font-size:13px;color:#666">slot ' + _rnEsc(key) + ' →</span>';
      h += '<input type="text" value="' + _rnEsc(map[key] || '') + '" oninput="_rnUpdateSlotMap(' + idx + ',\'' + key + '\',this.value)" style="flex:1;padding:4px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px;font-family:monospace">';
      h += '<button class="btn btn-sm" onclick="_rnRemoveSlotMapKey(' + idx + ',\'' + key + '\')" style="padding:1px 6px;font-size:11px;color:#c00">&times;</button>';
      h += '</div>';
    }
    /* Добавить новый ключ */
    var nextKey = keys.length > 0 ? (Number(keys[keys.length - 1]) + 1) : 0;
    h += '<button class="btn btn-sm" onclick="_rnAddSlotMapKey(' + idx + ',' + nextKey + ')" style="align-self:flex-start;font-size:11px">+ Слот ' + nextKey + '</button>';
    h += '</div>';
    h += '<input type="text" placeholder="Если слот не в списке (fallback)" value="' + _rnEsc(seg.fallback || '') + '" oninput="_rnUpdateSegField(' + idx + ',\'fallback\',this.value)" style="margin-top:4px;padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px;font-family:monospace">';
  } else if (seg.type === 'slot_number' || seg.type === 'card_number') {
    h += '<label style="display:flex;gap:8px;align-items:center;font-size:12px;color:#666">';
    h += '<span>Padding (сколько знаков):</span>';
    h += '<input type="number" min="1" max="5" value="' + (seg.padding || 2) + '" oninput="_rnUpdateSegField(' + idx + ',\'padding\',parseInt(this.value)||2)" style="width:60px;padding:4px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px">';
    h += '</label>';
  }
  return h;
}

function _rnApplyPreset(presetId) {
  for (var i = 0; i < RN_PRESETS.length; i++) {
    if (RN_PRESETS[i].id === presetId) {
      _rnEditorState = RN_PRESETS[i].build();
      var dialog = document.querySelector('#rn-modal > div');
      var proj = getActiveProject();
      if (dialog && proj) _rnRenderEditor(dialog, proj);
      return;
    }
  }
}

function _rnAddSegment() {
  var sel = document.getElementById('rn-add-type');
  if (!sel) return;
  var type = sel.value;
  var seg = { type: type };
  /* Дефолтные параметры для нового сегмента */
  if (type === 'variable')      { seg.var = 'article_sku'; seg.fallback = ''; }
  else if (type === 'literal')   { seg.text = ''; }
  else if (type === 'slot_map')  { seg.map = { '0': '' }; seg.fallback = ''; }
  else if (type === 'slot_number' || type === 'card_number') { seg.padding = 2; }
  _rnEditorState.segments = _rnEditorState.segments || [];
  _rnEditorState.segments.push(seg);
  _rnRerender();
}

function _rnRemoveSegment(idx) {
  _rnEditorState.segments.splice(idx, 1);
  _rnRerender();
}

function _rnMoveSegment(idx, dir) {
  var segs = _rnEditorState.segments;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= segs.length) return;
  var tmp = segs[idx]; segs[idx] = segs[newIdx]; segs[newIdx] = tmp;
  _rnRerender();
}

function _rnUpdateSegField(idx, field, value) {
  if (!_rnEditorState.segments[idx]) return;
  _rnEditorState.segments[idx][field] = value;
  _rnUpdatePreview();
}

function _rnUpdateSlotMap(segIdx, key, value) {
  var seg = _rnEditorState.segments[segIdx];
  if (!seg) return;
  if (!seg.map) seg.map = {};
  seg.map[key] = value;
  _rnUpdatePreview();
}

function _rnAddSlotMapKey(segIdx, key) {
  var seg = _rnEditorState.segments[segIdx];
  if (!seg) return;
  if (!seg.map) seg.map = {};
  seg.map[String(key)] = '';
  _rnRerender();
}

function _rnRemoveSlotMapKey(segIdx, key) {
  var seg = _rnEditorState.segments[segIdx];
  if (!seg || !seg.map) return;
  delete seg.map[key];
  _rnRerender();
}

function _rnRerender() {
  var dialog = document.querySelector('#rn-modal > div');
  var proj = getActiveProject();
  if (dialog && proj) _rnRenderEditor(dialog, proj);
}

function _rnSaveAndClose() {
  var proj = getActiveProject();
  if (!proj) { _rnCloseModal(); return; }
  var pid = proj._cloudId || proj.id;
  rnSaveConfig(pid, _rnEditorState);
  _rnCloseModal();
  /* Перерисовать тулбар верификации — там сразу видны новые имена в превью */
  if (typeof arRenderVerification === 'function') arRenderVerification();
  if (typeof arUpdateStats === 'function') arUpdateStats();
}

function _rnUpdatePreview() {
  var preview = document.getElementById('rn-preview');
  if (!preview) return;
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.articles) {
    preview.innerHTML = '<em style="color:#999">Нет верифицированных артикулов</em>';
    return;
  }
  /* Берём первые 3 пары (verified + есть фото в слоте) */
  var lines = [];
  var found = 0;
  for (var i = 0; i < proj.articles.length && found < 3; i++) {
    var art = proj.articles[i];
    if (art.cardIdx < 0 || art.status !== 'verified') continue;
    var card = proj.cards[art.cardIdx];
    if (!card || !card.slots) continue;
    for (var s = 0; s < card.slots.length && found < 3; s++) {
      var slot = card.slots[s];
      if (!slot.file) continue;
      var name = rnBuildName(_rnEditorState, {
        project: proj, card: card, cardIdx: art.cardIdx,
        slot: slot, slotIdx: s, article: art
      });
      lines.push('<div>' + _rnEsc(slot.file) + ' &rarr; <b>' + _rnEsc(name) + '</b></div>');
      found++;
    }
  }
  preview.innerHTML = lines.length > 0 ? lines.join('') : '<em style="color:#999">Нет верифицированных артикулов с фото</em>';
}

function _rnEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ──────────────────────────────────────────
   Десктоп: переименовать файлы в папке
   ────────────────────────────────────────── */

/**
 * Применить шаблон к файлам в выбранной папке (pywebview).
 * Шаги:
 *   1. Получить CSV-маппинг old→new из текущего проекта и конфига.
 *   2. Открыть native-диалог выбора папки (Python).
 *   3. Python проходится os.rename для каждой пары, пишет лог.
 *   4. UI: показать результат.
 */
function rnRenameFolder() {
  if (!(window.pywebview && window.pywebview.api && window.pywebview.api.rename_in_folder)) {
    alert('«Переименовать папку» доступно только в десктоп-приложении.');
    return;
  }
  var proj = getActiveProject();
  if (!proj || !proj.cards || !proj.articles) {
    alert('Нет данных в проекте.');
    return;
  }
  var cfg = rnGetEffectiveConfig(proj);

  /* Построить маппинг old → new (только verified-пары с файлами) */
  var mapping = [];
  for (var i = 0; i < proj.articles.length; i++) {
    var art = proj.articles[i];
    if (art.cardIdx < 0 || art.status !== 'verified') continue;
    var card = proj.cards[art.cardIdx];
    if (!card || !card.slots) continue;
    for (var s = 0; s < card.slots.length; s++) {
      var slot = card.slots[s];
      if (!slot.file) continue;
      var newName = rnBuildName(cfg, {
        project: proj, card: card, cardIdx: art.cardIdx,
        slot: slot, slotIdx: s, article: art
      });
      mapping.push({ old: slot.file, new: newName });
    }
  }
  if (mapping.length === 0) {
    alert('Нет верифицированных пар для переименования. Сначала подтверди артикулы во вкладке Артикулы.');
    return;
  }

  /* Проверка коллизий: два разных old → одинаковый new */
  var seen = {};
  var collisions = [];
  for (var c = 0; c < mapping.length; c++) {
    if (seen[mapping[c].new]) collisions.push(mapping[c].new);
    seen[mapping[c].new] = true;
  }
  if (collisions.length > 0) {
    alert('Коллизии в шаблоне — несколько файлов получили бы одинаковое имя:\n\n' +
      collisions.slice(0, 5).join('\n') + (collisions.length > 5 ? '\n... +' + (collisions.length - 5) : '') +
      '\n\nИзмени шаблон чтобы имена были уникальны.');
    return;
  }

  /* Зовём Python с маппингом — он сам откроет native-диалог. */
  window.pywebview.api.rename_in_folder({ mapping: mapping }).then(function(result) {
    if (result && result.cancelled) return;
    if (result && result.error) { alert('Ошибка: ' + result.error); return; }
    var msg = 'Переименовано: ' + (result.renamed || 0) + ' из ' + mapping.length + '\n';
    if (result.skipped && result.skipped.length) {
      msg += '\nПропущено (не найдено в папке):\n' + result.skipped.slice(0, 10).join('\n');
      if (result.skipped.length > 10) msg += '\n... +' + (result.skipped.length - 10);
    }
    if (result.log_path) msg += '\n\nЛог: ' + result.log_path;
    alert(msg);
  });
}


/* ──────────────────────────────────────────
   Юнит-тесты (вызываются вручную из консоли:
   rnRunTests() → true если ок).
   ────────────────────────────────────────── */
function rnRunTests() {
  var ok = true;
  function expect(label, actual, expected) {
    var pass = actual === expected;
    if (!pass) {
      console.error('FAIL ' + label + ' — expected:', expected, 'actual:', actual);
      ok = false;
    } else {
      console.log('PASS ' + label);
    }
  }

  /* Дефолтный конфиг */
  var def = rnPresetDefault();
  expect('default: card_name + 01',
    rnBuildName(def, _rnMakeCtx({}, { name: 'Карточка1' }, 0, { file: 'photo.JPG' }, 0)),
    'Карточка1_01.jpg');
  expect('default: padding 02',
    rnBuildName(def, _rnMakeCtx({}, { name: 'C' }, 0, { file: 'x.png' }, 1)),
    'C_02.png');

  /* EKONIKA */
  var ek = rnPresetEkonika();
  expect('ekonika slot 0 → promo',
    rnBuildName(ek, _rnMakeCtx({}, { name: 'fallback' }, 0,
      { file: 'a.jpg' }, 0,
      { sku: 'EN001CN-26-black-26W' })),
    'EN001CN-26-black-26W_promo.jpg');
  expect('ekonika slot 1 → vert',
    rnBuildName(ek, _rnMakeCtx({}, {}, 0, { file: 'a.jpg' }, 1, { sku: 'SKU' })),
    'SKU_vert.jpg');
  expect('ekonika slot 2 → dop',
    rnBuildName(ek, _rnMakeCtx({}, {}, 0, { file: 'a.jpg' }, 2, { sku: 'SKU' })),
    'SKU_dop.jpg');
  expect('ekonika slot 3 → extra (fallback)',
    rnBuildName(ek, _rnMakeCtx({}, {}, 0, { file: 'a.jpg' }, 3, { sku: 'SKU' })),
    'SKU_extra.jpg');

  /* Article missing → fallback на card.name */
  expect('variable fallback на card.name',
    rnBuildName(ek, _rnMakeCtx({}, { name: 'CardN' }, 0, { file: 'a.jpg' }, 0, null)),
    'CardN_promo.jpg');

  /* Sanitize запрещённых символов */
  expect('sanitize: / → _',
    rnBuildName({
      version: 1, separator: '_', segments: [{ type: 'literal', text: 'a/b' }]
    }, _rnMakeCtx({}, {}, 0, { file: 'x.jpg' }, 0)),
    'a_b.jpg');

  /* Бренд-пресет */
  expect('ekonika brand auto-preset',
    rnGetEffectiveConfig({ brand: 'EKONIKA', id: 'p1' }).segments[0].var,
    'article_sku');
  expect('non-ekonika default preset',
    rnGetEffectiveConfig({ brand: 'OTHER', id: 'p2' }).segments[0].var,
    'card_name');

  console.log(ok ? 'rnRunTests: OK' : 'rnRunTests: ОШИБКИ выше');
  return ok;
}
