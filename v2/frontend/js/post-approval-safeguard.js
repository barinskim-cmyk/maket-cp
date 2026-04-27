/**
 * post-approval-safeguard.js
 *
 * Защита от случайного изменения отбора после того, как клиент нажал
 * «Согласовать отбор». Реализована поверх существующего стека
 * (shClientApprove / shCloudSyncExplicit / sbPullProject / sbLogAction /
 * sbSyncStage / sbStartAutoPull / sbUploadProject) через wrapper-функции —
 * без правок в shootings.js / supabase.js.
 *
 * Сценарий:
 *  1. Любое state-changing действие в защищённом проекте (есть
 *     proj._stageHistory['client_approved']) триггерит модалку:
 *       «Отбор уже согласован. Вы хотите просто посмотреть варианты
 *        или изменить отбор?»
 *
 *  2. Mode A — «Просто посмотреть»:
 *       • Forward sync no-op (shCloudSyncExplicit, sbUploadProject,
 *         sbLogAction, sbSyncStage)
 *       • Reverse sync no-op (sbPullProject, sbStartAutoPull)
 *       • Локальные изменения visible, но не уходят в облако
 *       • Reload → откат к облачному состоянию
 *
 *  3. Mode B — «Изменить отбор»:
 *       • Sync работает как обычно (push/pull)
 *       • В client-action-bar появляется кнопка
 *         «Сохранить изменения после отбора» (только когда есть pending
 *         vs последний approved snapshot)
 *       • Click → checkpoint snCreateSnapshot trigger=
 *         'selection_modified_post_approval'
 *       • beforeunload + pending → confirmation
 *
 *  4. Choice сохраняется в sessionStorage('maketcp_post_approval_intent').
 *     На reload очищается (новая сессия = заново спросим).
 *
 *  5. Approved snapshot (фингерпринт) хранится в
 *     sessionStorage('maketcp_pa_approved_snapshot') и
 *     обновляется при commit changes.
 *
 * Public API (window.*):
 *   paGetIntent()         — 'view' | 'edit' | null
 *   paIsApproved(proj?)   — boolean
 *   paHasPendingChanges() — boolean (Mode B only)
 *   paUpdateSaveButton()  — перерисовать кнопку «Сохранить изменения»
 *   paOpenModal()         — открыть модалку явно (для тестов)
 *
 * См. docs/agents/dev/post-approval-safeguard.md
 */
(function() {
'use strict';

var INTENT_KEY    = 'maketcp_post_approval_intent';
var SNAPSHOT_KEY  = 'maketcp_pa_approved_snapshot';
var MODAL_ID      = 'modal-post-approval-intent';
var SAVE_BTN_ID   = 'pa-save-changes-btn';

var _paApprovedSnapshot   = null;
var _paModalOpen          = false;
var _paWrapped            = false;
var _paBeforeUnloadHooked = false;
var _paSaveBtnTimer       = null;

/* На reload очищаем intent — новая сессия = заново спросим.
   sessionStorage сам по себе не очищается на reload; делаем это явно. */
try { sessionStorage.removeItem(INTENT_KEY); } catch (e) {}
try { sessionStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}

// ─── helpers ─────────────────────────────────────────────────────────

function _paIsApproved(proj) {
  proj = proj || (typeof getActiveProject === 'function' ? getActiveProject() : null);
  if (!proj) return false;
  if (!proj._stageHistory) return false;
  return !!proj._stageHistory['client_approved'];
}

function _paGetIntent() {
  try { return sessionStorage.getItem(INTENT_KEY) || null; }
  catch (e) { return null; }
}

function _paSetIntent(v) {
  try { sessionStorage.setItem(INTENT_KEY, v); } catch (e) {}
}

function _paBuildFingerprint(proj) {
  if (!proj) return '';
  if (typeof _sbProjectFingerprint === 'function') {
    try { return _sbProjectFingerprint(proj); } catch (e) {}
  }
  /* Fallback — груботочный хеш по cards/slots */
  try {
    var c = (proj.cards || []).map(function(card) {
      var sl = (card.slots || []).map(function(s) { return s.file || ''; }).join(',');
      return (card.id || '') + ':' + sl;
    }).join('|');
    return 'fb:' + c + '|s:' + (proj._stage || 0);
  } catch (e) { return ''; }
}

function _paCaptureApprovedSnapshot() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) return;
  _paApprovedSnapshot = _paBuildFingerprint(proj);
  try { sessionStorage.setItem(SNAPSHOT_KEY, _paApprovedSnapshot); } catch (e) {}
}

function _paLoadApprovedSnapshot() {
  if (_paApprovedSnapshot) return _paApprovedSnapshot;
  try { _paApprovedSnapshot = sessionStorage.getItem(SNAPSHOT_KEY) || null; }
  catch (e) { _paApprovedSnapshot = null; }
  return _paApprovedSnapshot;
}

function _paHasPendingChanges() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj || !_paIsApproved(proj)) return false;
  var snap = _paLoadApprovedSnapshot();
  if (!snap) return false;
  return _paBuildFingerprint(proj) !== snap;
}

function _paShouldGate() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) return false;
  if (!_paIsApproved(proj)) return false;
  return true;
}

// ─── modal ───────────────────────────────────────────────────────────

function _paEnsureModal() {
  var modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'modal-overlay';
  modal.style.zIndex = '10100';
  modal.innerHTML =
    '<div class="modal" style="max-width:440px;padding:24px;border-radius:10px">' +
      '<h3 style="margin:0 0 12px;font-size:17px;font-weight:600">Отбор уже согласован</h3>' +
      '<p style="margin:0 0 20px;font-size:14px;color:#444;line-height:1.5">' +
        'Вы хотите просто посмотреть варианты или изменить отбор?' +
      '</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
        '<button class="btn" id="pa-modal-view" style="min-width:140px">Просто посмотреть</button>' +
        '<button class="btn btn-primary" id="pa-modal-edit" style="min-width:140px">Изменить отбор</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  document.getElementById('pa-modal-view').addEventListener('click', function() {
    _paChooseIntent('view');
  });
  document.getElementById('pa-modal-edit').addEventListener('click', function() {
    _paChooseIntent('edit');
  });
  /* Click вне модалки = «Просто посмотреть» (default secondary).
     Это менее опасно — sync не сломается. */
  modal.addEventListener('click', function(e) {
    if (e.target === modal) _paChooseIntent('view');
  });
  return modal;
}

function _paOpenModal() {
  if (_paModalOpen) return;
  _paModalOpen = true;
  var modal = _paEnsureModal();
  modal.classList.add('open');
  /* Фокус на secondary, как в спецификации (default = «Просто посмотреть») */
  setTimeout(function() {
    var btn = document.getElementById('pa-modal-view');
    if (btn) btn.focus();
  }, 50);
}

function _paCloseModal() {
  var modal = document.getElementById(MODAL_ID);
  if (modal) modal.classList.remove('open');
  _paModalOpen = false;
}

function _paChooseIntent(intent) {
  _paSetIntent(intent);
  _paCloseModal();
  if (intent === 'edit') {
    /* Снимок текущего состояния = baseline для pending detection.
       К этому моменту локальная мутация (которая вызвала модалку)
       уже произошла — её мы считаем частью «новых правок», поэтому
       снапшот делаем БЕЗ неё нельзя. Это та цена, что пользователь
       платит за защитный режим: точкой отсчёта pending становится
       момент выбора Mode B, не момент approval. Так UX честнее —
       «всё что после клика edit» = pending. */
    _paCaptureApprovedSnapshot();
    /* Дёрнуть pending sync, который мы заглушили перед модалкой */
    if (typeof _origShCloudSync === 'function') {
      try { _origShCloudSync.apply(window, []); } catch (e) {}
    }
    _paUpdateSaveButton();
    _paInstallBeforeUnload();
    /* Запустить auto-pull если выключали */
    if (typeof _origSbStartAutoPull === 'function') {
      try { _origSbStartAutoPull.apply(window, []); } catch (e) {}
    }
  } else {
    /* view: остановить активный pull-таймер, чтобы фантомные изменения
       не откатывались автоматически */
    if (typeof sbStopAutoPull === 'function') {
      try { sbStopAutoPull(); } catch (e) {}
    }
  }
}

// ─── wrap sync funcs ─────────────────────────────────────────────────

var _origShCloudSync     = null;
var _origSbPullProject   = null;
var _origSbStartAutoPull = null;
var _origSbLogAction     = null;
var _origSbSyncStage     = null;
var _origSbUploadProject = null;

function _paInstallWrappers() {
  if (_paWrapped) return;
  _paWrapped = true;

  if (typeof shCloudSyncExplicit === 'function') {
    _origShCloudSync = shCloudSyncExplicit;
    window.shCloudSyncExplicit = function() {
      if (!_paShouldGate()) return _origShCloudSync.apply(this, arguments);
      var intent = _paGetIntent();
      if (intent === 'view') return; /* no-op */
      if (intent === 'edit') {
        var r = _origShCloudSync.apply(this, arguments);
        /* Перерисовать save-кнопку по фону — pending мог измениться */
        _paScheduleBtnUpdate();
        return r;
      }
      _paOpenModal();
      return; /* deferred */
    };
  }

  if (typeof sbPullProject === 'function') {
    _origSbPullProject = sbPullProject;
    window.sbPullProject = function(cb) {
      cb = cb || function() {};
      if (_paShouldGate() && _paGetIntent() === 'view') {
        cb('Пропущен: post-approval view-mode'); return;
      }
      return _origSbPullProject.apply(this, arguments);
    };
  }

  if (typeof sbStartAutoPull === 'function') {
    _origSbStartAutoPull = sbStartAutoPull;
    window.sbStartAutoPull = function() {
      if (_paShouldGate() && _paGetIntent() === 'view') return;
      return _origSbStartAutoPull.apply(this, arguments);
    };
  }

  if (typeof sbLogAction === 'function') {
    _origSbLogAction = sbLogAction;
    window.sbLogAction = function() {
      if (_paShouldGate() && _paGetIntent() === 'view') return;
      return _origSbLogAction.apply(this, arguments);
    };
  }

  if (typeof sbSyncStage === 'function') {
    _origSbSyncStage = sbSyncStage;
    window.sbSyncStage = function() {
      if (_paShouldGate() && _paGetIntent() === 'view') return;
      return _origSbSyncStage.apply(this, arguments);
    };
  }

  if (typeof sbUploadProject === 'function') {
    _origSbUploadProject = sbUploadProject;
    window.sbUploadProject = function(idx, callback) {
      if (_paShouldGate() && _paGetIntent() === 'view') {
        if (typeof callback === 'function') callback(null, null);
        return;
      }
      return _origSbUploadProject.apply(this, arguments);
    };
  }
}

// ─── save-changes button (Mode B) ────────────────────────────────────

function _paScheduleBtnUpdate() {
  if (_paSaveBtnTimer) clearTimeout(_paSaveBtnTimer);
  _paSaveBtnTimer = setTimeout(function() {
    _paSaveBtnTimer = null;
    _paUpdateSaveButton();
  }, 200);
}

function _paUpdateSaveButton() {
  var bar = document.getElementById('client-action-bar');
  if (!bar) return;
  var existing = document.getElementById(SAVE_BTN_ID);

  var proj   = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  var should = proj && _paIsApproved(proj) &&
               _paGetIntent() === 'edit' &&
               _paHasPendingChanges();

  if (!should) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  var btn = document.createElement('button');
  btn.id = SAVE_BTN_ID;
  btn.className = 'btn btn-primary';
  btn.style.marginLeft = '8px';
  btn.textContent = 'Сохранить изменения после отбора';
  btn.title = 'Зафиксировать изменения как новый чекпоинт';
  btn.onclick = _paCommitChanges;

  var row = bar.querySelector('.client-bar-buttons');
  if (row) row.appendChild(btn); else bar.appendChild(btn);
}

function _paCommitChanges() {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj) return;
  if (!confirm('Зафиксировать текущий отбор как новый чекпоинт?')) return;

  function _onDone(snapId) {
    /* Обновить approved snapshot — pending становится пустым */
    _paCaptureApprovedSnapshot();
    _paUpdateSaveButton();
    if (typeof _sbShowSyncStatus === 'function') {
      _sbShowSyncStatus('Изменения сохранены');
    } else {
      console.log('post-approval: snapshot id=' + snapId);
    }
  }

  if (typeof snCreateSnapshot === 'function' && proj._cloudId) {
    var now = new Date();
    var timeStr = now.toLocaleDateString('ru-RU') + ' ' +
                  now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    snCreateSnapshot('client', 'selection_modified_post_approval',
      'Изменения после согласования ' + timeStr,
      function(err, snapId) {
        if (err) {
          console.warn('post-approval commit:', err);
          alert('Ошибка сохранения: ' + err);
          return;
        }
        _onDone(snapId);
      });
  } else {
    /* Нет облака — фиксируем только локально через checkpoints */
    if (!proj._checkpoints) proj._checkpoints = [];
    proj._checkpoints.push({
      ts: new Date().toISOString(),
      trigger: 'selection_modified_post_approval',
      stage: proj._stage || 0
    });
    _onDone(null);
  }

  /* Принудительный sync на случай если в edit-mode debounce ещё не сработал */
  if (typeof _origShCloudSync === 'function') {
    try { _origShCloudSync.apply(window, []); } catch (e) {}
  }
}

// ─── beforeunload ────────────────────────────────────────────────────

function _paInstallBeforeUnload() {
  if (_paBeforeUnloadHooked) return;
  _paBeforeUnloadHooked = true;
  window.addEventListener('beforeunload', function(e) {
    if (_paShouldGate() &&
        _paGetIntent() === 'edit' &&
        _paHasPendingChanges()) {
      var msg = 'У вас есть несохранённые изменения отбора';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }
  });
}

// ─── public API + init ───────────────────────────────────────────────

window.paGetIntent         = _paGetIntent;
window.paIsApproved        = _paIsApproved;
window.paHasPendingChanges = _paHasPendingChanges;
window.paUpdateSaveButton  = _paUpdateSaveButton;
window.paOpenModal         = _paOpenModal;
/* Для отладки и интеграции */
window.paResetIntent       = function() {
  try { sessionStorage.removeItem(INTENT_KEY); } catch (e) {}
  try { sessionStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
  _paApprovedSnapshot = null;
  _paUpdateSaveButton();
};

function _paInit() {
  _paInstallWrappers();
  _paInstallBeforeUnload();
  /* На случай если client-action-bar уже отрисован — попробовать обновить */
  setTimeout(_paUpdateSaveButton, 1500);
  /* Поллер каждые 2 сек для перерисовки save-button после действий клиента
     (drag/drop меняет state, save-кнопка должна появиться/исчезнуть) */
  setInterval(function() {
    if (_paGetIntent() === 'edit') _paUpdateSaveButton();
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _paInit);
} else {
  _paInit();
}
})();
