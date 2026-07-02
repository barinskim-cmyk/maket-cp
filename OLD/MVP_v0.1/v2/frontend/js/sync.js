/* ══════════════════════════════════════════════
   sync.js — Синхронизация / Rate Setter
   ══════════════════════════════════════════════ */

function toggleRsMode() {
  var mode = document.querySelector('input[name="rs-mode"]:checked').value;
  document.getElementById('rs-text-mode').style.display = mode === 'text' ? '' : 'none';
  document.getElementById('rs-folder-mode').style.display = mode === 'folder' ? '' : 'none';
}

async function pickFolder(inputId) {
  try {
    if (window.pywebview && window.pywebview.api) {
      var path = await window.pywebview.api.select_folder();
      if (path) document.getElementById(inputId).value = path;
    } else {
      alert('Выбор папки доступен только в приложении');
    }
  } catch(e) {}
}

async function runRateSetter(dryRun) {
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

  try {
    if (window.pywebview && window.pywebview.api) {
      await window.pywebview.api.rate_setter_run(payload);
    } else {
      // Демо-режим
      logEl.innerHTML = '<span class="log-ok">DEMO OK   IMG_0001 -> IMG_0001.cos</span>\n' +
        '<span class="log-ok">DEMO OK   IMG_0002 -> IMG_0002.cos</span>\n' +
        '<span class="log-miss">DEMO MISS IMG_0003 -- .cos не найден</span>';
      document.getElementById('rs-run-btn').disabled = false;
    }
  } catch(e) {
    logEl.innerHTML += '\n<span class="log-err">Ошибка: ' + esc(String(e)) + '</span>';
    document.getElementById('rs-run-btn').disabled = false;
  }
}

// Push-события от бэкенда
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
