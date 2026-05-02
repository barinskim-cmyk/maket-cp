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
  // Step 0: ALWAYS ask the user where to write the session — current project,
  // a new one, or an existing one. Per-Маша feedback (2026-05-01): there is
  // always *some* project selected by default, so silently using it is
  // confusing. The chooser makes the destination explicit each time.
  smShowProjectChoiceModal();
}

/* Continues the start flow once a project is chosen (or confirmed). */
function smContinueAfterProjectChosen() {
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

/* ── Project choice (sessions always belong to a project) ────────── */

function smShowProjectChoiceModal() {
  // Reset list visibility on every open.
  var list = document.getElementById('sm-project-list');
  if (list) {
    list.style.display = 'none';
    list.innerHTML = '';
  }
  // Render the "use currently active project" row if there is one.
  var activeRow = document.getElementById('sm-active-project-row');
  if (activeRow) {
    activeRow.innerHTML = '';
    activeRow.style.display = 'none';
    if (window.App && Array.isArray(App.projects)
        && App.selectedProject >= 0
        && App.selectedProject < App.projects.length) {
      var p = App.projects[App.selectedProject];
      var brand = (p && p.brand) ? p.brand : '(без бренда)';
      var date = (p && (p.shoot_date || p.date)) ? (p.shoot_date || p.date) : '';
      var label = brand + (date ? ' · ' + date : '');
      activeRow.innerHTML =
        '<button class="btn btn-primary" style="width:100%;text-align:left" onclick="smUseActiveProject()">' +
          '<div style="font-size:11px;opacity:0.85">Активный проект</div>' +
          '<div style="font-size:14px;font-weight:600">' + label + '</div>' +
        '</button>';
      activeRow.style.display = 'block';
    }
  }
  if (typeof openModal === 'function') {
    openModal('modal-shoot-project-picker');
  }
}

function smUseActiveProject() {
  closeModal('modal-shoot-project-picker');
  smContinueAfterProjectChosen();
}

function smChooseNewProject() {
  closeModal('modal-shoot-project-picker');
  if (typeof openNewProjectModal === 'function') {
    openNewProjectModal();
    // Pre-select the "live" mode radio so the user doesn't have to click it.
    setTimeout(function() {
      var live = document.querySelector('input[name="np-mode"][value="live"]');
      if (live) { live.checked = true; }
    }, 50);
  }
}

function smShowProjectList() {
  var list = document.getElementById('sm-project-list');
  if (!list) return;
  var projects = (window.App && Array.isArray(App.projects)) ? App.projects : [];
  if (projects.length === 0) {
    list.innerHTML = '<div style="padding:14px;color:#888;font-size:13px">Проектов пока нет — нажми \"Создать новый\" слева.</div>';
    list.style.display = 'block';
    return;
  }
  var html = '';
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var brand = (p && p.brand) ? p.brand : '(без бренда)';
    var date = (p && (p.shoot_date || p.date)) ? (p.shoot_date || p.date) : '';
    var label = brand + (date ? ' · ' + date : '');
    html += '<div class="sm-project-item" onclick="smPickExistingProject(' + i + ')" style="padding:10px 14px;border-bottom:1px solid #f0f0f0;cursor:pointer">' + label + '</div>';
  }
  list.innerHTML = html;
  list.style.display = 'block';
}

function smPickExistingProject(idx) {
  if (!window.App || !Array.isArray(App.projects) || idx < 0 || idx >= App.projects.length) return;
  App.selectedProject = idx;
  if (typeof renderProjects === 'function') renderProjects();
  closeModal('modal-shoot-project-picker');
  // Continue without re-prompting (smStartFlow would just re-open this modal).
  smContinueAfterProjectChosen();
}

/* Entry from the New Project modal when "Снимаю прямо сейчас" is selected.
   Switches to the Съёмка tab and starts the live flow with project context. */
function smStartFromProjectParams(params) {
  if (typeof showPage === 'function') showPage('shoot');
  if (!smHasDesktop()) {
    alert('Live shoot mode доступен только в десктоп-версии Maket CP.');
    return;
  }
  // Same gating as manual start: perms first, then pick + start.
  smStartFlow();
}

function smPickAndStart() {
  if (!smHasDesktop()) return;
  window.pywebview.api.shoot_pick_session().then(function(res) {
    if (!res || res.cancelled) return;
    if (res.error) { alert('Ошибка: ' + res.error); return; }
    var path = res.path;
    // Resolve project_id from current selection. We require an active project
    // before reaching this function (smStartFlow gates on it), but be defensive.
    var projectId = null;
    if (window.App && Array.isArray(App.projects)
        && App.selectedProject >= 0
        && App.selectedProject < App.projects.length) {
      var p = App.projects[App.selectedProject];
      projectId = (p && (p.id || p.project_id || p.uuid)) || null;
    }
    if (!projectId && window.App && App.currentProjectId) {
      projectId = App.currentProjectId;
    }
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

function smAddToCardManual() {
  if (!_smActive || !smHasDesktop()) return;
  // Calls the same code path the Cmd+Shift+C hotkey uses; on macOS this is
  // the only way to fire it until we replace pynput with pyobjc NSEvent.
  window.pywebview.api.shoot_hotkey_smoke().then(function(out) {
    if (out && out.error) smAppendEvent('add-to-card error: ' + out.error);
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
    // Continue is ALWAYS enabled. The basic shoot flow (FilePicker + filesystem
    // watcher on .cos files) doesn't need any of these permissions. They are
    // required only for advanced features:
    //   - Accessibility / Input Monitoring → global Add-to-Card hotkey (Cmd+Shift+C)
    //   - Automation: Capture One → AppleScript queries (selection, session path)
    // Both can be granted later, when the user actually uses those features.
    // Gating the basic flow on all-three was overzealous (Маша 2026-05-01).
    var btn = document.getElementById('sm-perms-continue');
    if (btn) btn.disabled = false;
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

// Watcher push events (forwarded from SessionWatcher → ShootingService → AppAPI._emit).
window.onShoot_watcher_watcher_started = function(p) {
  smAppendEvent('watcher started — tracking ' + (p && p.tracked_photos != null ? p.tracked_photos : '?') + ' photos');
};
window.onShoot_watcher_watcher_stopped = function() {
  smAppendEvent('watcher stopped');
};
window.onShoot_watcher_watcher_error = function(p) {
  smAppendEvent('watcher error: ' + (p && p.error ? p.error : 'unknown'));
};
/* ── Project state wire-up ─────────────────────────────
   Watcher events used to just write to the events panel; now they also
   mutate the active project so previews + cards actually appear. */

function smCurrentProj() {
  if (!window.App || !Array.isArray(App.projects)
      || App.selectedProject < 0 || App.selectedProject >= App.projects.length) {
    return null;
  }
  return App.projects[App.selectedProject];
}

function smEnsurePhoto(proj, info) {
  if (!proj.photos) proj.photos = [];
  var stem = info.stem || (info.name ? String(info.name).replace(/\.[^.]+$/, '') : '');
  if (!stem) return null;
  // Prefer image_path (parent JPG/RAW) over path (which is the .cos file).
  // The .cos is XML metadata — pointing <img src> at it would render nothing.
  var imgPath = info.image_path || null;
  // Fall back to path only if it looks like an image (not a .cos file).
  if (!imgPath && info.path && !/\.cos$/i.test(info.path)) {
    imgPath = info.path;
  }
  for (var i = 0; i < proj.photos.length; i++) {
    if (proj.photos[i].stem === stem) {
      var existing = proj.photos[i];
      if (imgPath && !existing.path) existing.path = imgPath;
      if (existing.path && !existing.preview) existing.preview = 'file://' + encodeURI(existing.path);
      if (existing.path && !existing.thumb) existing.thumb = 'file://' + encodeURI(existing.path);
      return existing;
    }
  }
  var photo = {
    name: info.name || stem + (imgPath ? imgPath.replace(/.*\./, '.') : '.jpg'),
    stem: stem,
    path: imgPath,
    rating: info.rating != null ? info.rating : 0,
    rotation: 0,
    tags: Array.isArray(info.keywords) ? info.keywords.slice() : [],
    source: 'shoot'
  };
  if (photo.path) {
    var url = 'file://' + encodeURI(photo.path);
    photo.preview = url;
    photo.thumb = url;
  }
  proj.photos.push(photo);
  return photo;
}

function smRefreshUI(proj) {
  // Best-effort UI refresh — these functions exist in different modules.
  try { if (typeof shAutoSave === 'function') shAutoSave(); } catch (e) {}
  try { if (typeof pvRenderGallery === 'function') pvRenderGallery(proj); } catch (e) {}
  try { if (typeof cpRenderCards === 'function') cpRenderCards(); } catch (e) {}
  try { if (typeof renderProjects === 'function') renderProjects(); } catch (e) {}
}

window.onShoot_watcher_photo_added = function(p) {
  smAppendEvent('photo added: ' + (p && p.stem ? p.stem : '?') + ' rating=' + (p && p.rating != null ? p.rating : '-'));
  if (!p) return;
  var proj = smCurrentProj(); if (!proj) return;
  var photo = smEnsurePhoto(proj, p);
  if (photo && p.rating != null) photo.rating = p.rating;
  if (photo && p.rating != null && p.rating >= 2) photo._preselect = true;
  smRefreshUI(proj);
};
window.onShoot_watcher_photo_changed = function(p) {
  if (!p) return;
  var msg = 'photo changed: ' + (p.stem || '?');
  if (p.rating_before !== p.rating_after) msg += ' rating ' + p.rating_before + '->' + p.rating_after;
  if (p.keywords_added && p.keywords_added.length) msg += ' +kw[' + p.keywords_added.join(',') + ']';
  smAppendEvent(msg);
  var proj = smCurrentProj(); if (!proj) return;
  var photo = smEnsurePhoto(proj, p);
  if (photo && p.rating_after != null) photo.rating = p.rating_after;
  smRefreshUI(proj);
};
window.onShoot_watcher_selection_added = function(p) {
  smAppendEvent('+ selection: ' + (p && p.stem ? p.stem : '?') + ' rating=' + (p && p.rating != null ? p.rating : '-'));
  if (!p) return;
  var proj = smCurrentProj(); if (!proj) return;
  var photo = smEnsurePhoto(proj, p);
  if (photo) {
    photo._preselect = true;
    if (p.rating != null) photo.rating = p.rating;
  }
  smRefreshUI(proj);
};
window.onShoot_watcher_selection_removed = function(p) {
  smAppendEvent('- selection: ' + (p && p.stem ? p.stem : '?'));
  if (!p) return;
  var proj = smCurrentProj(); if (!proj) return;
  var photo = smEnsurePhoto(proj, p);
  if (photo) photo._preselect = false;
  smRefreshUI(proj);
};
window.onShoot_watcher_card_signal = function(p) {
  smAppendEvent('card signal: ' + (p && p.stem ? p.stem : '?') + ' card=' + (p && p.card_id ? p.card_id.slice(0, 8) : '?') + ' slot=' + (p && p.slot != null ? p.slot : '?'));
  // Card signals from XMP arrive one-per-photo; we already create the card
  // explicitly in onShoot_hotkey_card_created. If a user adds _card:/_slot:
  // tags manually in C1 we'd want to assemble cards here too, but that's a
  // separate workflow — defer to next iteration.
};
window.onShoot_hotkey_card_created = function(p) {
  if (!p) return;
  if (p.error) {
    smAppendEvent('hotkey error: ' + p.error);
    return;
  }
  smAppendEvent('hotkey: card ' + (p.card_id ? p.card_id.slice(0, 8) : '?') + ' = ' + p.count + ' photos');

  var proj = smCurrentProj();
  if (!proj) return;

  // Make sure each photo exists in proj.photos; build the slots list.
  var slots = [];
  var variants = (p.variants || []).slice().sort(function(a, b) {
    return (a.slot || 0) - (b.slot || 0);
  });
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    // The hotkey path comes from C1 directly — that's already a JPG/RAW.
    var imgPath = v.path || null;
    if (imgPath && /\.cos$/i.test(imgPath)) imgPath = null;  // safety
    var photoInfo = { stem: v.stem, image_path: imgPath, name: v.stem };
    smEnsurePhoto(proj, photoInfo);
    var fileUrl = imgPath ? 'file://' + encodeURI(imgPath) : null;
    slots.push({
      orient: 'v',
      weight: i === 0 ? 2 : 1,
      aspect: null,
      file: v.stem ? (v.stem + (imgPath ? imgPath.replace(/.*\./, '.') : '.jpg')) : null,
      dataUrl: fileUrl,
      preview: fileUrl,
      thumb: fileUrl,
      path: imgPath,
      stem: v.stem || null
    });
  }

  if (!proj.cards) proj.cards = [];
  // Avoid duplicate cards if the same card_id was emitted twice.
  var exists = false;
  for (var j = 0; j < proj.cards.length; j++) {
    if (proj.cards[j].id === p.card_id) { exists = true; break; }
  }
  if (!exists) {
    proj.cards.push({
      id: p.card_id,
      category: '',
      slots: slots,
      _hAspect: null, _vAspect: null
    });
  }
  smRefreshUI(proj);
};
window.onShoot_hotkey_error = function(p) {
  if (!p) return;
  smAppendEvent('hotkey unavailable: ' + (p.error || '?') + (p.remedy ? ' — ' + p.remedy : ''));
};
window.onAppUpdated = function(payload) {
  // Soft-restart notification: backend respawns and exits, so this is
  // mostly a courtesy banner the user might see for a frame.
  try {
    smAppendEvent('app updated ' + (payload && payload.from ? payload.from : '') + ' -> ' + (payload && payload.to ? payload.to : '') + ', restarting');
  } catch (e) {}
};
