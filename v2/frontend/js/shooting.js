/* ══════════════════════════════════════════════
   shooting.js — Shoot Mode (active C1 capture session).

   Public surface: sm* functions only. State stays in module-private vars
   so /Контент/Артикулы tabs stay decoupled.

   Backend bridge: window.pywebview.api.shoot_*  /  permissions_*.
   No emoji in UI text (Masha rule). ES5-compatible (var, no const/let).
   ══════════════════════════════════════════════ */

var _smActive = null;          // active session payload from backend
var _smTimerInterval = null;   // window.setInterval id for the duration timer
var _smStartedAt = 0;          // ms epoch UTC of session start (for timer)

// Cached permission state for the modal — re-checked on demand.
var _smPerms = {
  accessibility: null,
  input_monitoring: null,
  automation_capture_one: null
};

// localStorage key — once user has cleared the first-run modal, we don't
// re-show on every Start. Re-check still happens silently in the background.
var SM_PERMS_OK_KEY = 'maketcp.shoot.perms_ok';
// Settings → Timezone stub (UTC display). No backend yet.
var SM_TZ_KEY = 'maketcp.settings.timezone';


/* ── Lifecycle ─────────────────────────────────── */

function smHasDesktop() {
  return !!(window.pywebview && window.pywebview.api && window.pywebview.api.shoot_pick_session);
}

function smStartFlow() {
  if (!smHasDesktop()) {
    alert('Shoot mode доступен только в десктоп-версии Maket CP.');
    return;
  }
  // Step 1: gate on first-run permission modal unless we've already passed.
  var passed = false;
  try { passed = localStorage.getItem(SM_PERMS_OK_KEY) === '1'; } catch (e) {}
  if (!passed) {
    smShowPermsModal(true);
    return;
  }
  // Step 2: pick the session folder, then start.
  smPickAndStart();
}

function smPickAndStart() {
  if (!smHasDesktop()) return;
  window.pywebview.api.shoot_pick_session().then(function(res) {
    if (!res || res.cancelled) return;
    if (res.error) { alert('Ошибка: ' + res.error); return; }
    var path = res.path;
    var projectId = (window.App && App.currentProjectId) ? App.currentProjectId : null;
    window.pywebview.api.shoot_start_session(path, projectId).then(function(out) {
      if (out && out.error) { alert('Не удалось начать съёмку: ' + out.error); return; }
      if (out && out.ok) {
        _smActive = out.session;
        _smStartedAt = Date.now();
        smRenderActive();
        smPersistToSupabase(out.session);
      }
    });
  });
}

function smEndFlow() {
  if (!_smActive || !smHasDesktop()) return;
  var ok = window.confirm('Завершить съёмку?');
  if (!ok) return;
  window.pywebview.api.shoot_end_session(_smActive.id).then(function(out) {
    if (out && out.error) { alert('Ошибка завершения: ' + out.error); return; }
    if (out && out.ok) {
      smPersistEndToSupabase(out.session);
      _smActive = null;
      smRenderIdle();
    }
  });
}


/* ── Render ────────────────────────────────────── */

function smRenderIdle() {
  var idle = document.getElementById('sm-idle');
  var act = document.getElementById('sm-active');
  if (idle) idle.style.display = '';
  if (act) act.style.display = 'none';
  if (_smTimerInterval) { clearInterval(_smTimerInterval); _smTimerInterval = null; }
}

function smRenderActive() {
  var idle = document.getElementById('sm-idle');
  var act = document.getElementById('sm-active');
  if (idle) idle.style.display = 'none';
  if (act) act.style.display = '';
  var pathEl = document.getElementById('sm-session-path');
  if (pathEl && _smActive) pathEl.textContent = _smActive.session_path || '—';
  smTickTimer();
  if (_smTimerInterval) clearInterval(_smTimerInterval);
  _smTimerInterval = setInterval(smTickTimer, 1000);
}

function smTickTimer() {
  if (!_smStartedAt) return;
  var el = document.getElementById('sm-timer');
  if (!el) return;
  var sec = Math.max(0, Math.floor((Date.now() - _smStartedAt) / 1000));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  el.textContent = (h < 10 ? '0' : '') + h + ':' +
                   (m < 10 ? '0' : '') + m + ':' +
                   (s < 10 ? '0' : '') + s;
}

function smAppendEvent(line) {
  var box = document.getElementById('sm-events');
  if (!box) return;
  var row = document.createElement('div');
  var ts = new Date().toISOString();
  row.textContent = '[' + ts + '] ' + line;
  if (box.firstChild && box.firstChild.style && box.firstChild.style.color === 'rgb(153, 153, 153)') {
    box.innerHTML = '';
  }
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}


/* ── Permissions modal ─────────────────────────── */

function smCheckPermissions() {
  smShowPermsModal(false);
}

function smShowPermsModal(blocking) {
  var ov = document.getElementById('modal-shoot-perms');
  if (!ov) return;
  ov.classList.add('show');
  ov.style.display = 'flex';
  ov._smBlocking = !!blocking;
  smRecheckPerms();
}

function smCloseModalPerms() {
  closeModal('modal-shoot-perms');
}

function smRecheckPerms() {
  if (!smHasDesktop()) {
    smRenderPermsRow('accessibility', null, 'desktop-only');
    smRenderPermsRow('input_monitoring', null, 'desktop-only');
    smRenderPermsRow('automation_capture_one', null, 'desktop-only');
    return;
  }
  window.pywebview.api.permissions_check_all().then(function(snap) {
    if (!snap) return;
    _smPerms = snap;
    smRenderPermsRow('accessibility', snap.accessibility);
    smRenderPermsRow('input_monitoring', snap.input_monitoring);
    smRenderPermsRow('automation_capture_one', snap.automation_capture_one);
    var allOk = !!(snap.accessibility && snap.input_monitoring && snap.automation_capture_one);
    var btn = document.getElementById('sm-perms-continue');
    if (btn) btn.disabled = !allOk;
  });
}

function smRenderPermsRow(name, granted, override) {
  var rows = document.querySelectorAll('#sm-perm-list .sm-perm-row');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-perm') === name) {
      var st = rows[i].querySelector('[data-status]');
      if (!st) return;
      if (override) {
        st.textContent = override;
        st.style.color = '#999';
      } else if (granted === true) {
        st.textContent = 'выдано';
        st.style.color = '#2a7d2a';
      } else if (granted === false) {
        st.textContent = 'не выдано';
        st.style.color = '#c62828';
      } else {
        st.textContent = 'проверяется…';
        st.style.color = '#999';
      }
      return;
    }
  }
}

function smOpenPerm(name) {
  if (!smHasDesktop()) return;
  window.pywebview.api.permissions_open_settings(name);
  // After a short delay re-poll — user may have granted by then.
  setTimeout(smRecheckPerms, 1500);
}

function smPermsContinue() {
  // Mark as passed so future Start clicks skip the modal.
  try { localStorage.setItem(SM_PERMS_OK_KEY, '1'); } catch (e) {}
  closeModal('modal-shoot-perms');
  smPickAndStart();
}


/* ── Supabase persistence (best effort) ────────── */

function smPersistToSupabase(session) {
  if (!window.supabase || !window._sbClient) return;
  try {
    window._sbClient.from('shoot_sessions').insert({
      id: session.id,
      project_id: session.project_id,
      session_path: session.session_path,
      start_time: session.start_time,
      status: 'active',
      events: []
    }).then(function() {});
  } catch (e) { /* fail silent — not blocking the desktop UX */ }
}

function smPersistEndToSupabase(session) {
  if (!window.supabase || !window._sbClient) return;
  try {
    window._sbClient.from('shoot_sessions').update({
      end_time: session.end_time,
      status: session.status
    }).eq('id', session.id).then(function() {});
  } catch (e) {}
}


/* ── Push events from Python ───────────────────── */

window.onShoot_shoot_session_started = function(payload) {
  smAppendEvent('session.started ' + (payload && payload.session_path ? payload.session_path : ''));
};
window.onShoot_shoot_session_ended = function(payload) {
  smAppendEvent('session.ended');
};
window.onShoot_shoot_session_aborted = function(payload) {
  smAppendEvent('session.aborted');
};
window.onAppUpdated = function(payload) {
  // Soft-restart notification: backend respawns and exits, so this is
  // mostly a courtesy banner the user might see for a frame.
  try {
    smAppendEvent('app updated ' + (payload && payload.from ? payload.from : '') + ' -> ' + (payload && payload.to ? payload.to : '') + ', restarting');
  } catch (e) {}
};
