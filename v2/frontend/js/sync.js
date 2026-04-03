/* ══════════════════════════════════════════════
   sync.js — Синхронизация / Rate Setter
   ══════════════════════════════════════════════ */

/**
 * Переключить режим ввода: текст / папка.
 */
function toggleRsMode() {
  var mode = document.querySelector('input[name="rs-mode"]:checked').value;
  document.getElementById('rs-text-mode').style.display = mode === 'text' ? '' : 'none';
  document.getElementById('rs-folder-mode').style.display = mode === 'folder' ? '' : 'none';
}

/**
 * Выбрать папку через нативный диалог (desktop only).
 * @param {string} inputId — id текстового поля для пути
 */
function pickFolder(inputId) {
  if (!window.pywebview || !window.pywebview.api) {
    alert('Выбор папки доступен только в приложении');
    return;
  }
  try {
    var result = window.pywebview.api.select_folder();
    if (result && typeof result.then === 'function') {
      result.then(function(path) {
        if (path) document.getElementById(inputId).value = path;
      })['catch'](function() {});
    } else if (result) {
      document.getElementById(inputId).value = result;
    }
  } catch(e) {}
}

/**
 * Автозаполнить список Rate Setter из текущего проекта.
 * Берёт имена файлов из: карточки (slots) + otherContent.
 * Вызывается при открытии вкладки синхронизации.
 */
function rsAutoFillFromProject() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) return;

  var names = {};

  /* Из карточек: все заполненные слоты */
  if (proj.cards) {
    for (var c = 0; c < proj.cards.length; c++) {
      var card = proj.cards[c];
      if (!card.slots) continue;
      for (var s = 0; s < card.slots.length; s++) {
        var f = card.slots[s].file;
        if (f) names[f] = true;
      }
    }
  }

  /* Из otherContent */
  if (proj.otherContent) {
    for (var i = 0; i < proj.otherContent.length; i++) {
      if (proj.otherContent[i].name) names[proj.otherContent[i].name] = true;
    }
  }

  var list = Object.keys(names);
  if (list.length === 0) return;

  /* Убираем расширение (.jpg, .jpeg, .tif и т.д.) — Rate Setter работает со stems */
  var stems = list.map(function(n) {
    return n.replace(/\.(jpe?g|tiff?|png|cr[23w]|nef|arw|raf|dng)$/i, '');
  });

  var textEl = document.getElementById('rs-text');
  if (textEl) {
    textEl.value = stems.join('\n');
    /* Переключить на текстовый режим */
    var radioText = document.querySelector('input[name="rs-mode"][value="text"]');
    if (radioText) {
      radioText.checked = true;
      toggleRsMode();
    }
  }

  /* Показать откуда загружено */
  var infoEl = document.getElementById('rs-auto-info');
  if (infoEl) {
    infoEl.textContent = 'Загружено из проекта "' + (proj.brand || '') + '": ' + stems.length + ' файлов';
    infoEl.style.display = '';
  }
}

/**
 * Очистить список и переключить в ручной режим.
 */
function rsClearAutoFill() {
  var textEl = document.getElementById('rs-text');
  if (textEl) textEl.value = '';
  var infoEl = document.getElementById('rs-auto-info');
  if (infoEl) infoEl.style.display = 'none';
}

/**
 * Запустить Rate Setter.
 * @param {boolean} dryRun — тестовый прогон (без записи .cos)
 */
function runRateSetter(dryRun) {
  var mode = document.querySelector('input[name="rs-mode"]:checked').value;
  var sessionDir = document.getElementById('rs-session-dir').value;
  if (!sessionDir) { alert('Выберите папку сессии Capture One'); return; }

  var payload = {
    mode: mode,
    session_dir: sessionDir,
    strip_tails: document.getElementById('rs-strip-tails').checked,
  };

  if (mode === 'text') {
    payload.text_list = document.getElementById('rs-text').value;
    if (!payload.text_list.trim()) { alert('Введите список имён'); return; }
  } else {
    payload.source_dir = document.getElementById('rs-source-dir').value;
    if (!payload.source_dir) { alert('Выберите папку-источник'); return; }
  }

  if (dryRun) payload.dry_run = true;

  var logEl = document.getElementById('rs-log');
  var resultEl = document.getElementById('rs-result');
  logEl.innerHTML = 'Запуск...';
  resultEl.style.display = 'none';

  document.getElementById('rs-run-btn').disabled = true;

  if (window.pywebview && window.pywebview.api) {
    try {
      var result = window.pywebview.api.rate_setter_run(payload);
      if (result && typeof result.then === 'function') {
        result['catch'](function(e) {
          logEl.innerHTML += '\n<span class="log-err">Ошибка: ' + esc(String(e)) + '</span>';
          document.getElementById('rs-run-btn').disabled = false;
        });
      }
    } catch(e) {
      logEl.innerHTML += '\n<span class="log-err">Ошибка: ' + esc(String(e)) + '</span>';
      document.getElementById('rs-run-btn').disabled = false;
    }
  } else {
    /* Демо-режим (браузер) */
    logEl.innerHTML = '<span class="log-ok">DEMO OK   IMG_0001 -> IMG_0001.cos</span>\n' +
      '<span class="log-ok">DEMO OK   IMG_0002 -> IMG_0002.cos</span>\n' +
      '<span class="log-miss">DEMO MISS IMG_0003 -- .cos не найден</span>';
    document.getElementById('rs-run-btn').disabled = false;
  }
}

/* Push-события от бэкенда */
window.onRateSetterLog = function(msg) {
  var logEl = document.getElementById('rs-log');
  var cls = 'log-ok';
  if (msg.indexOf('MISS') === 0) cls = 'log-miss';
  else if (msg.indexOf('ERR') === 0) cls = 'log-err';
  else if (msg.indexOf('SKIP') === 0) cls = 'log-skip';
  else if (msg.indexOf('DRY') === 0) cls = 'log-dry';

  if (logEl.textContent === 'Запуск...') logEl.innerHTML = '';
  logEl.innerHTML += '<span class="' + cls + '">' + esc(msg) + '</span>\n';
  logEl.scrollTop = logEl.scrollHeight;
};

window.onRateSetterDone = function(result) {
  document.getElementById('rs-run-btn').disabled = false;

  if (result.error) {
    document.getElementById('rs-log').innerHTML += '<span class="log-err">' + esc(result.error) + '</span>\n';
    return;
  }

  var el = document.getElementById('rs-result');
  el.style.display = '';
  el.innerHTML = 'Обновлено: <span>' + (result.updated || 0) + '</span> | ' +
    'Без изменений: <span>' + (result.unchanged || 0) + '</span> | ' +
    'Не найдено: <span>' + (result.missing || 0) + '</span> | ' +
    'Ошибок: <span>' + (result.errors || 0) + '</span>';
};
