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
 * Если активен снимок-контекст (_snActiveSnapshot) — берёт файлы из него.
 * Иначе — из живых карточек (slots) + otherContent.
 * Вызывается при открытии вкладки синхронизации.
 */
function rsAutoFillFromProject() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) return;

  /* Если доступна функция snGetActiveFiles — используем её (учитывает снимок-контекст) */
  var list;
  if (typeof snGetActiveFiles === 'function') {
    list = snGetActiveFiles();
  } else {
    /* Фолбэк: прямое чтение из проекта */
    var names = {};
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
    if (proj.otherContent) {
      for (var i = 0; i < proj.otherContent.length; i++) {
        if (proj.otherContent[i].name) names[proj.otherContent[i].name] = true;
      }
    }
    list = Object.keys(names);
  }

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
    var source = (typeof snIsViewingSnapshot === 'function' && snIsViewingSnapshot())
      ? 'из снимка'
      : 'из проекта "' + (proj.brand || '') + '"';
    infoEl.textContent = 'Загружено ' + source + ': ' + stems.length + ' файлов';
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
 * Проверить, включён ли новый путь Rate Setter sync (F-01/F-02).
 * Включается через localStorage.setItem('DEBUG_RATESETTER_FIX', '1').
 * @returns {boolean}
 */
function _rsSyncFixEnabled() {
  try {
    var v = localStorage.getItem('DEBUG_RATESETTER_FIX');
    return v === '1' || v === 'true' || v === 'on';
  } catch (e) {
    return false;
  }
}

/**
 * Очистить строку-имя до stem: убрать путь (если пользователь вставил
 * полный путь), затем расширение. Возвращает пустую строку, если
 * после очистки ничего не осталось.
 *
 * Используется F-02 для preview-валидации перед отправкой в Rate Setter.
 * @param {string} line
 * @returns {string}
 */
function _rsCleanLineToStem(line) {
  var s = String(line || '').trim();
  if (!s) return '';
  /* Убрать путь (и Windows, и Unix) — взять только basename. */
  var slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  /* Убрать расширение изображения. */
  s = s.replace(/\.(jpe?g|tiff?|png|cr[23w]|nef|arw|raf|dng|psd|psb)$/i, '');
  return s.trim();
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

    /* F-02 (за feature-flag): guard на пустой stems + warning при >50% отсева.
       Без флага — поведение идентично старому. */
    if (_rsSyncFixEnabled()) {
      var rawLines = payload.text_list.split(/\r?\n/);
      var originalLines = [];
      var previewStems = [];
      for (var ln = 0; ln < rawLines.length; ln++) {
        var trimmed = rawLines[ln].trim();
        if (trimmed.length === 0) continue;
        originalLines.push(trimmed);
        var stem = _rsCleanLineToStem(trimmed);
        if (stem.length > 0) previewStems.push(stem);
      }

      if (previewStems.length === 0) {
        alert('После очистки имён список пустой. Проверьте, что вы вводите имена файлов, а не пути или пустые строки.');
        return;
      }

      /* Warning: если после очистки осталось <50% от ввода — спросить. */
      if (originalLines.length > 0 &&
          previewStems.length < originalLines.length * 0.5) {
        var msg = 'Из ' + originalLines.length + ' строк распознано только ' +
                  previewStems.length + ' имён. ' +
                  'Возможно, вы вставили пути или лишние символы.\n\n' +
                  'Продолжить синхронизацию с ' + previewStems.length + ' именами?';
        if (!confirm(msg)) return;
      }
    }
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

  /* F-02 (за feature-flag): если Python вернул updated=0 И unchanged=0 —
     явно сообщить пользователю, что ничего не произошло. Без этого
     UI показывал "success" при полном отсутствии эффекта (см. analysis §2.5). */
  if (_rsSyncFixEnabled() &&
      (result.updated || 0) === 0 &&
      (result.unchanged || 0) === 0) {
    var logEl = document.getElementById('rs-log');
    if (logEl) {
      logEl.innerHTML += '<span class="log-err">Ничего не обновлено. ' +
        'Проверьте путь к сессии Capture One и список имён.</span>\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
    /* Не записываем stage_event — поведение стало фиктивным. */
    return;
  }

  /* Записать событие успешной синхронизации (скрытый этап пайплайна) */
  if (result.updated > 0 || result.unchanged > 0) {
    rsSyncCompleted(result);
  }
};

/**
 * Записать факт успешной синхронизации с Capture One.
 * Создаёт stage_event + снимок. Это скрытый подэтап пайплайна:
 * гарантия что рейтинги/ключевые слова записаны перед переходом.
 *
 * @param {object} result — результат Rate Setter {updated, unchanged, missing, errors}
 */
function rsSyncCompleted(result) {
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  var note = 'CO Sync: ' + (result.updated || 0) + ' обновлено, ' + (result.unchanged || 0) + ' без изменений';

  /* Записать stage_event */
  if (typeof sbSyncStage === 'function') {
    sbSyncStage('co_sync_done', note);
  }

  /* Создать снимок состояния */
  if (typeof snCreateSnapshot === 'function') {
    var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
    var stageId = 'preselect';
    if (proj && typeof PIPELINE_STAGES !== 'undefined') {
      var idx = proj._stage || 0;
      stageId = (PIPELINE_STAGES[idx] && PIPELINE_STAGES[idx].id) || 'preselect';
    }
    snCreateSnapshot(stageId, 'co_sync_done', note, function(err) {
      if (err) console.warn('rsSyncCompleted: ошибка снимка:', err);
      else console.log('rsSyncCompleted: снимок синхронизации создан');
    });
  }
}

// ══════════════════════════════════════════════
//  Дельта-синхронизация: только изменённые файлы
// ══════════════════════════════════════════════

/**
 * Автозаполнить Rate Setter только дельтой (новые/изменённые файлы)
 * между двумя снимками. Добавляет тег итерации.
 *
 * @param {object} beforeData — данные снимка "до"
 * @param {object} afterData — данные снимка "после" (или текущее состояние)
 * @param {number} iterNum — номер итерации (2, 3, ...)
 */
function rsFillDelta(beforeData, afterData, iterNum) {
  if (typeof snCompareSnapshots !== 'function') {
    alert('Функция сравнения снимков не найдена');
    return;
  }

  var diff = snCompareSnapshots(beforeData, afterData);
  /* Берём только добавленные + перемещённые (изменённые) файлы */
  var deltaFiles = [];
  for (var a = 0; a < diff.added.length; a++) deltaFiles.push(diff.added[a]);
  for (var m = 0; m < diff.moved.length; m++) deltaFiles.push(diff.moved[m].file);

  if (deltaFiles.length === 0) {
    alert('Нет изменений между выбранными состояниями');
    return;
  }

  /* Убираем расширения */
  var stems = deltaFiles.map(function(n) {
    return n.replace(/\.(jpe?g|tiff?|png|cr[23w]|nef|arw|raf|dng)$/i, '');
  });

  var textEl = document.getElementById('rs-text');
  if (textEl) {
    textEl.value = stems.join('\n');
    var radioText = document.querySelector('input[name="rs-mode"][value="text"]');
    if (radioText) { radioText.checked = true; toggleRsMode(); }
  }

  /* Показать информацию + номер итерации */
  var infoEl = document.getElementById('rs-auto-info');
  if (infoEl) {
    infoEl.textContent = 'Дельта (итерация ' + iterNum + '): ' + stems.length + ' файлов. Тег: iter' + iterNum;
    infoEl.style.display = '';
  }

  /* Запомнить номер итерации для добавления в ключевые слова при синхронизации */
  window._rsIterationTag = 'iter' + iterNum;
}

/**
 * Кнопка "Только изменения": загрузить дельту между последним снимком и текущим состоянием.
 * Автоматически определяет последний снимок-согласование и сравнивает с текущим.
 */
function rsFillDeltaFromLatest() {
  /* Загрузить снимки если нет в кэше */
  if (typeof _snCachedSnapshots === 'undefined' || !_snCachedSnapshots.length) {
    if (typeof snLoadSnapshots === 'function') {
      snLoadSnapshots(function(err, snaps) {
        if (err) { alert('Ошибка загрузки снимков: ' + err); return; }
        _snCachedSnapshots = snaps || [];
        _rsFillDeltaFromCache();
      });
    } else {
      alert('Снимки недоступны. Синхронизируйте проект с облаком.');
    }
    return;
  }
  _rsFillDeltaFromCache();
}

/**
 * Внутренняя: заполнить дельту из кэша снимков.
 * @private
 */
function _rsFillDeltaFromCache() {
  if (!_snCachedSnapshots || !_snCachedSnapshots.length) {
    alert('Снимков нет. Дельта будет доступна после первого согласования.');
    return;
  }

  /* Найти последний снимок-согласование (client_approved или co_sync_done) */
  var lastApproved = null;
  for (var i = _snCachedSnapshots.length - 1; i >= 0; i--) {
    var t = _snCachedSnapshots[i].trigger;
    if (t === 'client_approved' || t === 'co_sync_done') {
      lastApproved = _snCachedSnapshots[i];
      break;
    }
  }

  if (!lastApproved) {
    /* Берём просто последний снимок */
    lastApproved = _snCachedSnapshots[_snCachedSnapshots.length - 1];
  }

  var currentData = (typeof snBuildSnapshotData === 'function') ? snBuildSnapshotData() : { cards: [], ocContainers: [] };
  var iterNum = rsGetIterationNumber();

  rsFillDelta(lastApproved.data, currentData, iterNum);
}

/**
 * Подсчитать текущий номер итерации для этапа.
 * Считает сколько снимков с trigger содержащим 'client_changes' или 'client_approved'.
 *
 * @returns {number} — номер следующей итерации (1 = оригинал, 2+ = доработки)
 */
function rsGetIterationNumber() {
  if (typeof _snCachedSnapshots === 'undefined' || !_snCachedSnapshots.length) return 1;
  var count = 0;
  for (var i = 0; i < _snCachedSnapshots.length; i++) {
    var t = _snCachedSnapshots[i].trigger;
    if (t === 'client_approved' || t === 'client_changes') count++;
  }
  return count + 1;
}
