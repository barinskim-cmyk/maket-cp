/* ══════════════════════════════════════════════
   layout_v1_archived.js — Архив layout-движка v1
   ══════════════════════════════════════════════

   Заменён layout.js (v2) — justified rows, row model, auto-packing.
   Хранится для возможности отката.

   Содержит: cpFindHero, cpBuildLayout, cpBuildPortrait, cpBuildLandscape,
             cpBuildSimpleGrid, cpPackRows

   Дата архивации: 2026-03-28
*/

// --- cpFindHero ---
function cpFindHero(slots) {
  var maxW = 1;
  var heroIdx = -1;
  for (var i = 0; i < slots.length; i++) {
    var w = slots[i].weight || 1;
    if (w > maxW) { maxW = w; heroIdx = i; }
  }
  return heroIdx;
}

// --- cpBuildLayout ---
function cpBuildLayout(card) {
  var slots = card.slots || [];
  if (slots.length === 0) {
    return '<div class="cp-layout"><div class="cp-empty">Добавьте слоты кнопкой +</div></div>';
  }
  var heroIdx = cpFindHero(slots);
  if (heroIdx < 0) {
    return cpBuildSimpleGrid(card, slots);
  }
  var restIdxs = [];
  for (var i = 0; i < slots.length; i++) {
    if (i !== heroIdx) restIdxs.push(i);
  }
  if (slots[heroIdx].orient === 'h') {
    return cpBuildPortrait(card, heroIdx, restIdxs);
  } else {
    return cpBuildLandscape(card, heroIdx, restIdxs);
  }
}

// --- cpBuildPortrait ---
function cpBuildPortrait(card, heroIdx, restIdxs) {
  var html = '<div class="cp-layout cp-portrait">';
  html += '<div class="cp-hero">' + cpSlotHTML(heroIdx, 1) + '</div>';
  if (restIdxs.length > 0) {
    var restSlots = restIdxs.map(function(idx) { return card.slots[idx]; });
    var rows = cpPackRows(restSlots);
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      html += '<div class="cp-rest-row" style="grid-template-columns:repeat(' + row.units + ',1fr)">';
      for (var s = 0; s < row.items.length; s++) {
        var cardIdx = restIdxs[row.items[s].idx];
        html += cpSlotHTML(cardIdx, row.items[s].span);
      }
      html += '</div>';
    }
  }
  html += '</div>';
  return html;
}

// --- cpBuildLandscape ---
function cpBuildLandscape(card, heroIdx, restIdxs) {
  var restCols;
  if (restIdxs.length <= 2) restCols = 1;
  else if (restIdxs.length <= 6) restCols = 2;
  else restCols = 3;
  var html = '<div class="cp-layout cp-landscape" style="grid-template-columns:2fr 3fr">';
  html += '<div class="cp-hero cp-hero-stretch">' + cpSlotHTML(heroIdx, 1) + '</div>';
  if (restIdxs.length > 0) {
    html += '<div class="cp-rest" style="grid-template-columns:repeat(' + restCols + ',1fr)">';
    for (var i = 0; i < restIdxs.length; i++) {
      html += cpSlotHTML(restIdxs[i], 1);
    }
    html += '</div>';
  } else {
    html += '<div class="cp-rest"></div>';
  }
  html += '</div>';
  return html;
}

// --- cpBuildSimpleGrid ---
function cpBuildSimpleGrid(card, slots) {
  var CAP = 4;
  var rows = [];
  var curItems = [], curUnits = 0;
  for (var i = 0; i < slots.length; i++) {
    var u = (slots[i].orient === 'h') ? 2 : 1;
    if (curUnits + u > CAP && curItems.length > 0) {
      rows.push({ items: curItems, units: curUnits });
      curItems = []; curUnits = 0;
    }
    curItems.push({ idx: i, span: u });
    curUnits += u;
  }
  if (curItems.length > 0) rows.push({ items: curItems, units: curUnits });
  var html = '<div class="cp-layout">';
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    html += '<div class="cp-row" style="grid-template-columns:repeat(' + row.units + ',1fr)">';
    for (var s = 0; s < row.items.length; s++) {
      html += cpSlotHTML(row.items[s].idx, row.items[s].span);
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// --- cpPackRows ---
function cpPackRows(slots) {
  var CAP = 4;
  var rows = [];
  var curItems = [], curUnits = 0;
  for (var i = 0; i < slots.length; i++) {
    var u = (slots[i].orient === 'h') ? 2 : 1;
    if (curUnits + u > CAP && curItems.length > 0) {
      rows.push({ items: curItems, units: curUnits });
      curItems = []; curUnits = 0;
    }
    curItems.push({ idx: i, span: u });
    curUnits += u;
  }
  if (curItems.length > 0) rows.push({ items: curItems, units: curUnits });
  return rows;
}
