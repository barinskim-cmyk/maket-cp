/* ══════════════════════════════════════════════
   layout.js — Layout-движок v3 (JS-sizing)
   ══════════════════════════════════════════════

   Зависит от: ничего (автономный модуль)

   ═══════════════════════════════════════
   МОДЕЛЬ РАСКЛАДКИ v3
   ═══════════════════════════════════════

   Шаблон: { hAspect, vAspect, lockRows, hasHero }
   Слот:   { orient: 'h'|'v', row?: number }

   hasHero=true  → slot[0] = заглавное. orient='v' → LANDSCAPE, 'h' → PORTRAIT.
   hasHero=false → EQUAL (все одинаковые).

   ПРИНЦИП: photo-slot НИКОГДА не управляет своим размером.
   Размеры задаёт layout-контейнер. photo-slot заполняет контейнер.

   ── LANDSCAPE (hero V слева, rest справа) ──────

   HTML:
     .lay-container.lay-landscape
       .lay-hero-col[style=aspect-ratio]    ← AR героя, определяет высоту
         photo-slot                          ← fills hero-col (100% x 100%)
       .lay-rest-col                         ← flex-column, высота от grid
         .lay-row-ls                         ← flex:1 (равные доли высоты)
           .lay-cell-ls[data-ar]             ← JS ставит width/height в px
             photo-slot                      ← fills cell (100% x 100%)

   После рендера HTML → layApplySizes() читает высоту hero,
   вычисляет row_height и cell_width, ставит px-размеры на каждую ячейку.
   При ресайзе окна → layApplySizes() вызывается снова.

   Overflow (3+ рядов):
     .lay-container.lay-landscape.lay-overflow
       .lay-hero-col + .lay-rest-col         ← grid-row:1
       .lay-bottom                           ← grid-row:2, justified ряды

   ── PORTRAIT (hero H сверху, rest снизу) ───────

   Hero H на всю ширину, AR через inline style на lay-cell.
   Rest-ряды = justified: flex-grow ∝ AR, все заполняют ряд.

   HTML:
     .lay-container.lay-portrait
       .lay-row.lay-hero-row                ← содержит hero-cell
         .lay-cell[style=flex+AR]            ← hero
       .lay-row * N                          ← justified rest ряды
         .lay-cell[style=flex+AR]

   ── EQUAL (без hero) ───────────────────────────

   Все justified ряды, без hero. Структура как portrait rest.

   HTML:
     .lay-container.lay-equal
       .lay-row * N
         .lay-cell[style=flex+AR]

   ── Авто-ряды ─────────────────────────────────
   Landscape rest: 1→1ряд, 2→2(стопка), 3-5→2, 6+→3(overflow)
   Portrait/Equal: набивка по сумме AR (minAR=1.5, maxAR=4.0)

   ══════════════════════════════════════════════ */


var LAY_GAP = 4; /* px — единый gap для всех раскладок */


// ══════════════════════════════════════════════
//  Утилиты: aspect-ratio
// ══════════════════════════════════════════════

/**
 * CSS aspect-ratio строку ('3/2') → число (width / height).
 * @param {string} ar
 * @returns {number}
 */
function _layParseAR(ar) {
  if (!ar || typeof ar !== 'string') return 1;
  var parts = ar.split(/[\/\:]/);
  if (parts.length === 2) {
    var w = parseFloat(parts[0]);
    var h = parseFloat(parts[1]);
    if (w > 0 && h > 0) return w / h;
  }
  return 1;
}

/**
 * Числовой AR слота. Приоритет: slot.aspect → orient → дефолт.
 */
function _laySlotAR(slot, hAspect, vAspect) {
  if (slot.aspect) return _layParseAR(slot.aspect);
  return slot.orient === 'h' ? _layParseAR(hAspect || '3/2') : _layParseAR(vAspect || '2/3');
}

/**
 * CSS-строка AR для слота (например '2/3').
 */
function _laySlotARCss(slot, hAspect, vAspect) {
  if (slot.aspect) return slot.aspect;
  return slot.orient === 'h' ? (hAspect || '3/2') : (vAspect || '2/3');
}


// ══════════════════════════════════════════════
//  Авто-ряды
// ══════════════════════════════════════════════

/**
 * Justified-разбивка (portrait / equal).
 * Набиваем слоты пока сумма AR < maxAR.
 */
function layAutoRows(slots, hAspect, vAspect, opts) {
  if (slots.length === 0) return [];

  var minAR = (opts && opts.minRowAR) || 1.5;
  var maxAR = (opts && opts.maxRowAR) || 4.0;

  var rows = [];
  var curRow = [];
  var curSum = 0;

  for (var i = 0; i < slots.length; i++) {
    var ar = _laySlotAR(slots[i], hAspect, vAspect);
    if (curSum + ar > maxAR && curRow.length > 0) {
      rows.push(curRow);
      curRow = [];
      curSum = 0;
    }
    curRow.push(i);
    curSum += ar;
  }

  if (curRow.length > 0) {
    /* Если последний ряд слишком узкий — забрать слот из предыдущего */
    if (rows.length > 0 && curSum < minAR) {
      var prevRow = rows[rows.length - 1];
      if (prevRow.length > 1) {
        curRow.unshift(prevRow.pop());
      }
    }
    rows.push(curRow);
  }

  return rows;
}

/**
 * Landscape rest: фиксированные правила по количеству.
 * 3-й ряд когда > 3 слотов на ряд (т.е. 7+ rest при 2 рядах).
 *   1     → 1 ряд
 *   2     → 2 ряда (стопка)
 *   3-6   → 2 ряда (max 3 на ряд)
 *   7+    → 3 ряда (overflow)
 */
function layAutoRowsLandscape(slots) {
  if (slots.length === 0) return [];
  if (slots.length <= 2) return _layDistributeEvenly(slots.length, 1);
  if (slots.length <= 6) return _layDistributeEvenly(slots.length, 2);
  /* 7+ → overflow: 2 side-ряда + 1 bottom (bottom шире, получает больше) */
  return _layDistributeOverflow(slots.length, 2);
}

/**
 * Равномерно распределить count элементов по numRows рядов.
 * Возвращает [[0,1,2],[3,4,5]] — локальные индексы.
 */
function _layDistributeEvenly(count, numRows) {
  if (numRows < 1) numRows = 1;
  var perRow = Math.ceil(count / numRows);
  var rows = [];
  var idx = 0;
  for (var r = 0; r < numRows; r++) {
    var row = [];
    var end = Math.min(idx + perRow, count);
    for (var i = idx; i < end; i++) row.push(i);
    if (row.length > 0) rows.push(row);
    idx = end;
  }
  return rows;
}

/**
 * Распределение для overflow-раскладки (landscape 3+ рядов).
 * Первые 2 ряда (side, рядом с hero) получают floor(count/3) каждый,
 * остаток уходит в bottom-ряд (он шире — hero + rest, примерно 5/3 rest).
 * Примеры: 7→2+2+3, 8→2+2+4, 9→3+3+3, 10→3+3+4, 11→3+3+5.
 */
function _layDistributeOverflow(count, sideRowCount) {
  if (sideRowCount < 1) sideRowCount = 2;
  var totalRows = sideRowCount + 1;
  var perSide = Math.floor(count / totalRows);
  if (perSide < 1) perSide = 1;
  var rows = [];
  var idx = 0;
  /* Side-ряды: по perSide элементов */
  for (var r = 0; r < sideRowCount; r++) {
    var row = [];
    var end = Math.min(idx + perSide, count);
    for (var i = idx; i < end; i++) row.push(i);
    if (row.length > 0) rows.push(row);
    idx = end;
  }
  /* Bottom-ряд: все оставшиеся */
  if (idx < count) {
    var bottomRow = [];
    for (var i = idx; i < count; i++) bottomRow.push(i);
    rows.push(bottomRow);
  }
  return rows;
}


// ══════════════════════════════════════════════
//  Разбивка по рядам из модели (lockRows=true)
// ══════════════════════════════════════════════

/** Сгруппировать слоты по полю row. */
function layGroupByRow(slots) {
  var rowMap = {};
  var maxRow = 0;
  for (var i = 0; i < slots.length; i++) {
    var r = (slots[i].row !== undefined && slots[i].row !== null) ? slots[i].row : 0;
    if (!rowMap[r]) rowMap[r] = [];
    rowMap[r].push(i);
    if (r > maxRow) maxRow = r;
  }
  var result = [];
  for (var rr = 0; rr <= maxRow; rr++) {
    if (rowMap[rr]) result.push(rowMap[rr]);
  }
  return result;
}

/** Назначить slot.row из авто-разбивки. Мутирует! */
function layAssignRows(slots, rows) {
  for (var r = 0; r < rows.length; r++) {
    for (var i = 0; i < rows[r].length; i++) {
      slots[rows[r][i]].row = r;
    }
  }
}


// ══════════════════════════════════════════════
//  Hero detection
// ══════════════════════════════════════════════

/**
 * hasHero=true  → hero = idx 0.
 * hasHero=false → нет hero.
 * hasHero=undefined (legacy) → ищем weight>1.
 */
function layFindPrimaryHero(slots, hasHero) {
  if (hasHero === true) return slots.length > 0 ? 0 : -1;
  if (hasHero === false) return -1;
  /* Legacy: weight */
  var maxW = 1, heroIdx = -1;
  for (var i = 0; i < slots.length; i++) {
    var w = slots[i].weight || 1;
    if (w > maxW) { maxW = w; heroIdx = i; }
  }
  return heroIdx;
}

/** Определить тип раскладки: 'landscape' | 'portrait' | 'equal'. */
function layDetectMode(slots, hasHero) {
  var heroIdx = layFindPrimaryHero(slots, hasHero);
  if (heroIdx < 0) return 'equal';
  return slots[heroIdx].orient === 'h' ? 'portrait' : 'landscape';
}


// ══════════════════════════════════════════════
//  HTML: JUSTIFIED ROW (portrait, equal, overflow-bottom)
// ══════════════════════════════════════════════
//
//  Ячейки заполняют ряд целиком. flex-grow ∝ AR.
//  aspect-ratio на ЯЧЕЙКЕ (не на photo-slot) задаёт высоту ряда.
//  photo-slot внутри: width:100%, height:100%.
// ══════════════════════════════════════════════

function _layRowHTML(idxs, allSlots, hAspect, vAspect, slotHTMLFn, targetSumAR) {
  var rowSumAR = 0;
  for (var i = 0; i < idxs.length; i++) {
    rowSumAR += _laySlotAR(allSlots[idxs[i]], hAspect, vAspect);
  }

  /* data-row: номер ряда для drag-and-drop между рядами */
  var rowNum = (idxs.length > 0 && allSlots[idxs[0]].row !== undefined) ? allSlots[idxs[0]].row : '';
  var html = '<div class="lay-row" data-row="' + rowNum + '">';
  for (var i = 0; i < idxs.length; i++) {
    var slot = allSlots[idxs[i]];
    var ar = _laySlotAR(slot, hAspect, vAspect);
    var arCss = _laySlotARCss(slot, hAspect, vAspect);
    var grow = Math.round(ar * 1000);
    /* aspect-ratio на ячейке: ряд берёт высоту из AR самых широких ячеек,
       align-items:stretch выравнивает все ячейки по этой высоте. */
    html += '<div class="lay-cell" data-ar="' + ar.toFixed(4) + '" style="flex:' + grow + ' 1 0%;aspect-ratio:' + arCss + '">';
    html += slotHTMLFn(idxs[i]);
    html += '</div>';
  }

  /* Padding для неполного ряда */
  if (targetSumAR && rowSumAR < targetSumAR * 0.9) {
    var padGrow = Math.round((targetSumAR - rowSumAR) * 1000);
    html += '<div class="lay-pad" style="flex:' + padGrow + ' 1 0%"></div>';
  }

  html += '</div>';
  return html;
}


// ══════════════════════════════════════════════
//  HTML: LANDSCAPE REST ROW (рядом с hero)
// ══════════════════════════════════════════════
//
//  Ячейки НЕ заполняют ряд. Размеры ставит JS (layApplySizes).
//  data-ar на ячейке хранит числовой AR для JS-расчёта.
// ══════════════════════════════════════════════

function _layLandscapeRestRowHTML(idxs, allSlots, hAspect, vAspect, slotHTMLFn) {
  var rowNum = (idxs.length > 0 && allSlots[idxs[0]].row !== undefined) ? allSlots[idxs[0]].row : '';
  var html = '<div class="lay-row-ls" data-row="' + rowNum + '">';
  for (var i = 0; i < idxs.length; i++) {
    var slot = allSlots[idxs[i]];
    var ar = _laySlotAR(slot, hAspect, vAspect);
    /* data-ar — числовой AR для layApplySizes() */
    html += '<div class="lay-cell-ls" data-ar="' + ar.toFixed(4) + '">';
    html += slotHTMLFn(idxs[i]);
    html += '</div>';
  }
  html += '</div>';
  return html;
}


// ══════════════════════════════════════════════
//  Вспомогательная: maxAR среди рядов
// ══════════════════════════════════════════════

function _layMaxRowAR(rows, allSlots, hAspect, vAspect) {
  var maxAR = 0;
  for (var r = 0; r < rows.length; r++) {
    var sum = 0;
    for (var i = 0; i < rows[r].length; i++) {
      sum += _laySlotAR(allSlots[rows[r][i]], hAspect, vAspect);
    }
    if (sum > maxAR) maxAR = sum;
  }
  return maxAR;
}


// ══════════════════════════════════════════════
//  Главная функция: layBuildLayout
// ══════════════════════════════════════════════

/**
 * Построить HTML раскладки.
 * @param {Object}   card       — { slots }
 * @param {Object}   template   — { hAspect, vAspect, lockRows, hasHero }
 * @param {Function} slotHTMLFn — (slotIdx) → html (photo-slot без sizing)
 * @returns {string} HTML-строка
 *
 * ВАЖНО: после вставки HTML в DOM вызвать layApplySizes(containerEl)
 * для пересчёта px-размеров landscape rest ячеек.
 */
function layBuildLayout(card, template, slotHTMLFn) {
  var slots = card.slots || [];
  if (slots.length === 0) {
    return '<div class="lay-container"><div class="cp-empty">Добавьте слоты кнопкой +</div></div>';
  }

  var hAspect = (template && template.hAspect) || '3/2';
  var vAspect = (template && template.vAspect) || '2/3';
  var lockRows = (template && template.lockRows) || false;
  var hasHero = (template && template.hasHero !== undefined) ? template.hasHero : undefined;

  var mode = layDetectMode(slots, hasHero);

  if (mode === 'equal') {
    return _layBuildEqual(slots, hAspect, vAspect, lockRows, slotHTMLFn);
  }

  var heroIdx = layFindPrimaryHero(slots, hasHero);
  var restIdxs = [];
  for (var i = 0; i < slots.length; i++) {
    if (i !== heroIdx) restIdxs.push(i);
  }

  if (mode === 'portrait') {
    return _layBuildPortrait(slots, heroIdx, restIdxs, hAspect, vAspect, lockRows, slotHTMLFn);
  }
  return _layBuildLandscape(slots, heroIdx, restIdxs, hAspect, vAspect, lockRows, slotHTMLFn);
}


// ══════════════════════════════════════════════
//  EQUAL: все justified ряды
// ══════════════════════════════════════════════

function _layBuildEqual(slots, hAspect, vAspect, lockRows, slotHTMLFn) {
  var rows;
  if (lockRows) {
    rows = layGroupByRow(slots);
  } else {
    rows = layAutoRows(slots, hAspect, vAspect);
  }

  var maxAR = _layMaxRowAR(rows, slots, hAspect, vAspect);

  var html = '<div class="lay-container lay-equal">';
  for (var r = 0; r < rows.length; r++) {
    html += _layRowHTML(rows[r], slots, hAspect, vAspect, slotHTMLFn, maxAR);
  }
  html += '</div>';
  return html;
}


// ══════════════════════════════════════════════
//  PORTRAIT: hero H сверху, justified rest снизу
// ══════════════════════════════════════════════

function _layBuildPortrait(slots, heroIdx, restIdxs, hAspect, vAspect, lockRows, slotHTMLFn) {
  var restSlots = restIdxs.map(function(i) { return slots[i]; });
  var rowsLocal = lockRows ? layGroupByRow(restSlots) : layAutoRows(restSlots, hAspect, vAspect);
  var rowsGlobal = rowsLocal.map(function(row) {
    return row.map(function(li) { return restIdxs[li]; });
  });

  var heroSlot = slots[heroIdx];
  var heroArCss = _laySlotARCss(heroSlot, hAspect, vAspect);

  var html = '<div class="lay-container lay-portrait">';

  /* Hero: justified row с одной ячейкой */
  html += '<div class="lay-row lay-hero-row">';
  html += '<div class="lay-cell" style="flex:1 1 0%;aspect-ratio:' + heroArCss + '">';
  html += slotHTMLFn(heroIdx);
  html += '</div></div>';

  /* Justified rest rows */
  var maxAR = _layMaxRowAR(rowsGlobal, slots, hAspect, vAspect);
  for (var r = 0; r < rowsGlobal.length; r++) {
    html += _layRowHTML(rowsGlobal[r], slots, hAspect, vAspect, slotHTMLFn, maxAR);
  }

  html += '</div>';
  return html;
}


// ══════════════════════════════════════════════
//  LANDSCAPE: hero V слева, rest справа
// ══════════════════════════════════════════════
//
//  CSS Grid: hero-col (aspect-ratio → высота) + rest-col.
//  Rest: flex-column, ряды flex:1 (равные доли).
//  Ячейки rest: JS ставит px-размеры (layApplySizes).
//
//  Overflow (3+ рядов): hero+2ряда сверху, остальные justified снизу.
// ══════════════════════════════════════════════

function _layBuildLandscape(slots, heroIdx, restIdxs, hAspect, vAspect, lockRows, slotHTMLFn) {
  var restSlots = restIdxs.map(function(i) { return slots[i]; });
  var rowsLocal = lockRows ? layGroupByRow(restSlots) : layAutoRowsLandscape(restSlots);
  var rowsGlobal = rowsLocal.map(function(row) {
    return row.map(function(li) { return restIdxs[li]; });
  });

  var totalRows = rowsGlobal.length;
  var isOverflow = totalRows >= 3;
  var sideRows = isOverflow ? 2 : totalRows;

  var heroSlot = slots[heroIdx];
  var heroArCss = _laySlotARCss(heroSlot, hAspect, vAspect);

  var cls = 'lay-container lay-landscape' + (isOverflow ? ' lay-overflow' : '');
  var html = '<div class="' + cls + '">';

  /* Hero V — aspect-ratio на hero-col определяет высоту grid-row */
  html += '<div class="lay-hero-col" style="aspect-ratio:' + heroArCss + '">';
  html += slotHTMLFn(heroIdx);
  html += '</div>';

  /* Rest-col: ряды рядом с hero */
  html += '<div class="lay-rest-col">';
  for (var r = 0; r < sideRows; r++) {
    html += _layLandscapeRestRowHTML(rowsGlobal[r], slots, hAspect, vAspect, slotHTMLFn);
  }
  html += '</div>';

  /* Bottom: overflow ряды (такой же размер ячеек как в rest-col) */
  if (isOverflow) {
    html += '<div class="lay-bottom">';
    for (var rb = sideRows; rb < totalRows; rb++) {
      html += _layLandscapeRestRowHTML(rowsGlobal[rb], slots, hAspect, vAspect, slotHTMLFn);
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}


// ══════════════════════════════════════════════
//  JS-SIZING: layApplySizes
// ══════════════════════════════════════════════
//
//  Вызывать ПОСЛЕ вставки HTML в DOM.
//  Находит все .lay-landscape контейнеры, читает высоту hero,
//  вычисляет px-размеры rest-ячеек.
//
//  Landscape rest-ячейки:
//    heroHeight = lay-hero-col.offsetHeight
//    N = кол-во lay-row-ls в rest-col
//    rowHeight = (heroHeight - (N-1)*gap) / N
//    cellWidth = rowHeight * cellAR (из data-ar)
//    cellHeight = rowHeight
// ══════════════════════════════════════════════

/**
 * Пересчитать px-размеры landscape rest-ячеек.
 * @param {HTMLElement} root — корневой элемент (обычно #cp-view или #te-preview)
 */
function layApplySizes(root) {
  if (!root) return;

  var containers = root.querySelectorAll('.lay-landscape');
  for (var c = 0; c < containers.length; c++) {
    _laySizeLandscape(containers[c]);
  }

  /* Portrait / Equal: выровнять высоту rest-рядов */
  var eqContainers = root.querySelectorAll('.lay-portrait, .lay-equal');
  for (var e = 0; e < eqContainers.length; e++) {
    _laySizeEqualRows(eqContainers[e]);
  }
}

/**
 * Выровнять высоту рядов в portrait / equal контейнере.
 * Все rest-ряды (не hero-row) получают одинаковую высоту,
 * определённую самым «плотным» рядом (наибольшая сумма AR).
 */
function _laySizeEqualRows(container) {
  var allRows = container.querySelectorAll('.lay-row');
  /* Собрать rest-ряды (пропустить hero-row) */
  var restRows = [];
  for (var i = 0; i < allRows.length; i++) {
    if (!allRows[i].classList.contains('lay-hero-row')) {
      restRows.push(allRows[i]);
    }
  }
  if (restRows.length === 0) return;

  var containerWidth = container.offsetWidth;
  if (containerWidth <= 0) return;

  /* Найти минимальную высоту: ряд с наибольшей суммой AR = самый плотный */
  var minHeight = Infinity;
  for (var r = 0; r < restRows.length; r++) {
    var cells = restRows[r].querySelectorAll('.lay-cell');
    var sumAR = 0;
    for (var c = 0; c < cells.length; c++) {
      var ar = parseFloat(cells[c].getAttribute('data-ar')) || 1;
      sumAR += ar;
    }
    if (sumAR > 0) {
      var rowGap = (cells.length - 1) * LAY_GAP;
      var h = (containerWidth - rowGap) / sumAR;
      if (h < minHeight) minHeight = h;
    }
  }
  if (minHeight === Infinity || minHeight <= 0) return;

  var rowHeight = Math.floor(minHeight);

  /* Применить к каждому rest-ряду */
  for (var r = 0; r < restRows.length; r++) {
    restRows[r].style.height = rowHeight + 'px';
    var cells = restRows[r].querySelectorAll('.lay-cell');
    for (var c = 0; c < cells.length; c++) {
      var ar = parseFloat(cells[c].getAttribute('data-ar')) || 1;
      cells[c].style.width = Math.floor(rowHeight * ar) + 'px';
      cells[c].style.height = rowHeight + 'px';
      cells[c].style.flex = '0 0 auto';
      cells[c].style.aspectRatio = 'unset';
    }
  }
}

/**
 * Разобрать CSS aspect-ratio строку ('3/2' или '0.6667') в число.
 */
function _parseARString(s) {
  if (!s || s === 'unset') return 1;
  var parts = s.split('/');
  if (parts.length === 2) {
    var n = parseFloat(parts[0]);
    var d = parseFloat(parts[1]);
    return (d > 0) ? n / d : 1;
  }
  var v = parseFloat(s);
  return (v > 0) ? v : 1;
}

/**
 * Внутренний: рассчитать и применить px-размеры для одного landscape-контейнера.
 */
function _laySizeLandscape(container) {
  var heroCol = container.querySelector('.lay-hero-col');
  var restCol = container.querySelector('.lay-rest-col');
  if (!heroCol || !restCol) return;

  var heroHeight = heroCol.offsetHeight;
  if (heroHeight <= 0) return; /* ещё не отрендерен */

  /* Собрать ВСЕ lay-row-ls: и в rest-col, и в bottom */
  var sideRows = restCol.querySelectorAll('.lay-row-ls');
  var bottomEl = container.querySelector('.lay-bottom');
  var bottomRows = bottomEl ? bottomEl.querySelectorAll('.lay-row-ls') : [];
  var numSideRows = sideRows.length;

  /* Ширина для cap: rest-col для side, container для bottom */
  var restWidth = restCol.offsetWidth;
  var containerWidth = container.offsetWidth;

  /* 1. Идеальная высота ряда (hero высота / кол-во side-рядов) */
  var totalGapV = (numSideRows - 1) * LAY_GAP;
  var rowHeight = numSideRows > 0 ? Math.floor((heroHeight - totalGapV) / numSideRows) : heroHeight;

  /* 2. Cap по ширине: проверить все ряды (side + bottom) */
  var wasCapped = false;
  var allRowGroups = [
    { rows: sideRows, width: restWidth },
    { rows: bottomRows, width: containerWidth }
  ];
  for (var g = 0; g < allRowGroups.length; g++) {
    var grp = allRowGroups[g];
    for (var r = 0; r < grp.rows.length; r++) {
      var cells = grp.rows[r].querySelectorAll('.lay-cell-ls');
      var sumAR = 0;
      for (var i = 0; i < cells.length; i++) {
        sumAR += parseFloat(cells[i].getAttribute('data-ar')) || 1;
      }
      var rowGapH = (cells.length - 1) * LAY_GAP;
      var maxH = (grp.width - rowGapH) / sumAR;
      if (maxH < rowHeight) { rowHeight = Math.floor(maxH); wasCapped = true; }
    }
  }

  /* 3. Подогнать hero высоту под фактическую высоту side-рядов */
  var actualSideHeight = numSideRows * rowHeight + totalGapV;
  if (numSideRows > 0) {
    heroCol.style.height = actualSideHeight + 'px';
    heroCol.style.aspectRatio = 'unset';
  }

  /* 4. Применить размеры ко ВСЕМ рядам (side + bottom) */
  function applyRowSizes(rowList) {
    for (var r = 0; r < rowList.length; r++) {
      rowList[r].style.height = rowHeight + 'px';
      rowList[r].style.flex = 'none';
      var cells = rowList[r].querySelectorAll('.lay-cell-ls');
      for (var i = 0; i < cells.length; i++) {
        var ar = parseFloat(cells[i].getAttribute('data-ar')) || 1;
        cells[i].style.width = Math.floor(rowHeight * ar) + 'px';
        cells[i].style.height = rowHeight + 'px';
      }
    }
  }
  applyRowSizes(sideRows);
  applyRowSizes(bottomRows);
}

/**
 * Debounced-версия layApplySizes для привязки к resize.
 * Использование: window.addEventListener('resize', layOnResize)
 */
var _layResizeTimer = null;
var _layResizeRoot = null;

function layOnResize() {
  if (_layResizeTimer) clearTimeout(_layResizeTimer);
  _layResizeTimer = setTimeout(function() {
    if (_layResizeRoot) {
      /* Сбросить px-размеры перед пересчётом (дать CSS определить новую ширину) */
      _layResetSizes(_layResizeRoot);
      /* Дать браузеру перерисовать layout после сброса */
      requestAnimationFrame(function() {
        layApplySizes(_layResizeRoot);
      });
    }
  }, 100);
}

/**
 * Сбросить px-размеры чтобы CSS Grid пересчитал ширину колонок.
 */
function _layResetSizes(root) {
  if (!root) return;
  /* Сбросить hero override */
  var heroCols = root.querySelectorAll('.lay-hero-col');
  for (var h = 0; h < heroCols.length; h++) {
    heroCols[h].style.height = '';
    heroCols[h].style.aspectRatio = '';
  }
  /* Landscape rows */
  var rows = root.querySelectorAll('.lay-row-ls');
  for (var r = 0; r < rows.length; r++) {
    rows[r].style.height = '';
    rows[r].style.flex = '';
    var cells = rows[r].querySelectorAll('.lay-cell-ls');
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.width = '';
      cells[i].style.height = '';
    }
  }
  /* Portrait / Equal rows */
  var eqRows = root.querySelectorAll('.lay-row');
  for (var r = 0; r < eqRows.length; r++) {
    eqRows[r].style.height = '';
    var cells = eqRows[r].querySelectorAll('.lay-cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.width = '';
      cells[i].style.height = '';
      cells[i].style.flex = '';
      cells[i].style.aspectRatio = '';
    }
  }
}

/**
 * Инициализировать resize-listener для заданного root-элемента.
 * Вызывать один раз при инициализации экрана карточек.
 */
function layInitResize(root) {
  _layResizeRoot = root;
  window.addEventListener('resize', layOnResize);
}

/** Убрать resize-listener (при уходе с экрана). */
function layDestroyResize() {
  window.removeEventListener('resize', layOnResize);
  _layResizeRoot = null;
  if (_layResizeTimer) { clearTimeout(_layResizeTimer); _layResizeTimer = null; }
}


// ══════════════════════════════════════════════
//  Утилиты для template editor
// ══════════════════════════════════════════════

/** Сбросить weight всех слотов в 1. */
function layResetWeight(slots) {
  for (var i = 0; i < slots.length; i++) slots[i].weight = 1;
}

/** Переместить слот в другой ряд. */
function layMoveToRow(slots, slotIdx, newRow) {
  slots[slotIdx].row = newRow;
}

/** Пересчитать row для всех слотов. */
function layRecalcRows(slots, hAspect, vAspect, isLandscape) {
  var rows = isLandscape
    ? layAutoRowsLandscape(slots)
    : layAutoRows(slots, hAspect, vAspect);
  layAssignRows(slots, rows);
}

/** Максимальный номер ряда. */
function layMaxRow(slots) {
  var max = 0;
  for (var i = 0; i < slots.length; i++) {
    var r = slots[i].row || 0;
    if (r > max) max = r;
  }
  return max;
}
