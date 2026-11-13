// ---------------------------------------------------------------
//  demo.js -- demo-project for onboarding (feat0702-demo-project, slice 1)
//
//  Novyi polzovatel posle registratsii vidit pustoi ekran "Semki".
//  Etot modul daet knopku "Posmotret demo-proekt" v pustom sostoyanii
//  spiska proektov: po kliku v pamyat (i localStorage) zagruzhaetsya
//  gotovyi demonstratsionnyi proekt s kartochkami i zapolnennymi slotami --
//  tsennost produkta vidna pryamo v brauzere, bez ustanovki desktop.
//
//  VAZHNO: demo zhivet TOLKO v brauzere. U proekta net _cloudId, poetomu
//  oblachnaya sinhronizatsiya (_shDoCloudSync) ego ne trogaet (oba ee puti
//  trebuyut proj._cloudId). Zagruzchik NE vyzyvaet shCloudSyncExplicit.
//  Avtomaticheskoe sozdanie demo pri registratsii + oblachnyi sid -- sled.
//  slais (nuzhno reshenie Mashi po onbordingu, zatragivaet registratsiyu/BD).
//
//  Chistye funktsii: shBuildDemoProject, shDemoPlaceholder, shDemoEmptyActionHTML.
//  Stil: ES5 (var), bez emoji, HTML strokami, dizain "Temnaya plenka".
// ---------------------------------------------------------------

/**
 * Placeholder-izobrazhenie dlya slota demo-kartochki: temnyi kadr s tonkoi
 * ramkoi i mono-podpisyu. Vozvrashchaet data:image/svg+xml URI (bez emoji).
 * @param {string} label -- podpis v tsentre
 * @param {string} orient -- 'v' | 'h'
 * @returns {string} data URI
 */
function shDemoPlaceholder(label, orient) {
  var w = (orient === 'h') ? 400 : 300;
  var h = (orient === 'h') ? 300 : 400;
  var txt = String(label || '').toUpperCase();
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<rect width="' + w + '" height="' + h + '" fill="#161616"/>' +
    '<rect x="8" y="8" width="' + (w - 16) + '" height="' + (h - 16) + '" fill="none" stroke="#3a3a3a" stroke-width="1"/>' +
    '<text x="50%" y="50%" fill="#767676" font-family="monospace" font-size="18" letter-spacing="2" ' +
    'text-anchor="middle" dominant-baseline="middle">' + txt + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Sobrat odin slot demo-kartochki.
 * @param {string} label
 * @param {string} orient
 * @param {boolean} filled
 * @param {number} weight
 * @returns {Object} slot
 */
function shDemoSlot(label, orient, filled, weight) {
  var s = {
    orient: orient || 'v',
    weight: weight || 1,
    aspect: null,
    file: null,
    dataUrl: null,
    path: null
  };
  if (filled) {
    s.file = 'demo_' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.svg';
    s.dataUrl = shDemoPlaceholder(label, orient);
  }
  return s;
}

/**
 * Sobrat demonstratsionnyi proekt (chistaya, determinirovannaya funktsiya).
 * Bez _cloudId -- zhivet tolko v brauzere. Pomechen _demo:true.
 * @returns {Object} project
 */
function shBuildDemoProject() {
  function card(id, category, slots) {
    return {
      id: id,
      category: category,
      slots: slots,
      _hAspect: null,
      _vAspect: null,
      _lockRows: false
    };
  }
  var cards = [
    card('demo-c1', 'Обувь', [
      shDemoSlot('Demo 01', 'v', true, 2),
      shDemoSlot('Demo 02', 'v', true, 1),
      shDemoSlot('Demo 03', 'v', true, 1)
    ]),
    card('demo-c2', 'Обувь', [
      shDemoSlot('Demo 04', 'v', true, 2),
      shDemoSlot('Demo 05', 'v', true, 1),
      shDemoSlot('Demo 06', 'v', true, 1),
      shDemoSlot('', 'v', false, 1)
    ]),
    card('demo-c3', 'Сумки', [
      shDemoSlot('Demo 07', 'h', true, 1),
      shDemoSlot('Demo 08', 'h', true, 1)
    ])
  ];
  return {
    brand: 'Демо-витрина',
    shoot_date: '',
    categories: ['Обувь', 'Сумки'],
    channels: [],
    cards: cards,
    _stage: 0,
    _stageHistory: {},
    _demo: true
  };
}

/**
 * HTML knopki "Posmotret demo-proekt" dlya pustogo sostoyaniya spiska proektov.
 * Pusto dlya share-ssylki (klient/retushyor ne sozdaet demo).
 * @returns {string}
 */
function shDemoEmptyActionHTML() {
  if (window._isShareLink) return '';
  return '<div class="es-actions">' +
    '<button class="btn btn-sm" onclick="shLoadDemoProject()">Посмотреть демо-проект</button>' +
    '</div>';
}

/**
 * Zagruzit demo-proekt v App (v pamyat + localStorage cherez shAutoSave).
 * Idempotentno: esli demo uzhe est -- prosto vybiraet ego. Oblako ne trogaet.
 */
function shLoadDemoProject() {
  if (!window.App) return;
  if (!App.projects) App.projects = [];
  var idx = -1, i;
  for (i = 0; i < App.projects.length; i++) {
    if (App.projects[i] && App.projects[i]._demo) { idx = i; break; }
  }
  if (idx < 0) {
    App.projects.push(shBuildDemoProject());
    idx = App.projects.length - 1;
  }
  App.selectedProject = idx;
  App.currentCardIdx = -1;
  if (typeof renderProjects === 'function') renderProjects();
  if (typeof shAutoSave === 'function') { try { shAutoSave(); } catch (e) {} }
  /* Oblachnuyu sinhronizatsiyu NE zapuskaem: demo bez _cloudId, tolko brauzer. */
}
