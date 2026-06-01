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
