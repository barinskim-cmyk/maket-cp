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
  // Маша 2026-05-02: «появляется и карточка и удаляется» / «опять не
  // сохраняет новые картинки в карточки». sbStartAutoPull keeps pulling
  // cloud state every SB_PULL_INTERVAL ms while the project has a
  // _cloudId, and overwrites proj.cards from the cloud version (which
  // doesn't know about hotkey-built cards because we explicitly don't
  // push them during testing). Stopping the timer isn't enough — a
  // pull already in flight when we stop still completes and overwrites
  // local state. Belt + suspenders: stop the interval AND monkey-patch
  // sbPullProject to no-op for the duration of the live shoot.
  if (typeof sbStopAutoPull === 'function') {
    try { sbStopAutoPull(); } catch (e) {}
  }
  if (typeof window.sbPullProject === 'function' && !window._smOriginalSbPullProject) {
    window._smOriginalSbPullProject = window.sbPullProject;
    window.sbPullProject = function(cb) {
      // Don't surface this as an error — the interval timer expects
      // graceful 'skipped' results during local edits.
      if (typeof cb === 'function') cb('Пропущен: shoot session active');
    };
  }
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

function smExportPreviews() {
  if (!smHasDesktop()) {
    alert('Экспорт превью доступен только в десктоп-версии Maket CP.');
    return;
  }
  if (!window.pywebview.api.shoot_export_previews) {
    alert('Команда экспорта не подключена в этой сборке.');
    return;
  }
  smAppendEvent('export: trigger Process Recipe in Capture One...');
  window.pywebview.api.shoot_export_previews().then(function(res) {
    if (!res) return;
    if (res.error) {
      smAppendEvent('export error: ' + res.error);
      alert('Не удалось запустить экспорт: ' + res.error);
      return;
    }
    var msg = 'export queued: ' + (res.count || 0) + ' variants → ' + (res.output_dir || 'C1 default');
    smAppendEvent(msg);
    alert('C1 обрабатывает в очереди. Когда фото появятся в Output папке, watcher их подхватит и заменит превью на полноразмерные.');
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

/* Symmetric to smPickAndStart — restore cloud auto-pull when the user
   finishes the live shoot. Without this the project would stop syncing
   between devices after Маша closes shoot mode. */
function _smRestoreAutoPullIfNeeded() {
  try {
    // Restore the real sbPullProject before re-enabling the interval.
    if (window._smOriginalSbPullProject) {
      window.sbPullProject = window._smOriginalSbPullProject;
      window._smOriginalSbPullProject = null;
    }
    var proj = smCurrentProj();
    if (proj && proj._cloudId && typeof sbStartAutoPull === 'function') {
      sbStartAutoPull();
    }
  } catch (e) {}
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
      _smRestoreAutoPullIfNeeded();
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
  // The existing gallery (previews.js) renders proj.previews, NOT
  // proj.previews. Маша 2026-05-02: «проблема со связью с проектом» —
  // exactly this. Storing under .photos meant pvRenderGallery never
  // saw our shoot-mode entries; she got events in the log but an empty
  // gallery. We now own a slot in proj.previews and let the existing
  // pvGetThumb / pvGetPreview / pvGetPath pipeline pick it up.
  if (!proj.previews) proj.previews = [];
  var stem = info.stem || (info.name ? String(info.name).replace(/\.[^.]+$/, '') : '');
  if (!stem) return null;
  var imgPath = info.image_path || null;
  if (!imgPath && info.path && !/\.cos$/i.test(info.path)) {
    imgPath = info.path;
  }
  var name = info.name || stem + (imgPath ? imgPath.replace(/.*\./, '.') : '.jpg');
  // Маша 2026-05-06: «давай при загрузке будем извлекать дату и время
  // съёмки из exif или из чего мы там рейтинг тащим». session_watcher
  // emits captured_at (file mtime of the image, equals capture time on
  // a fresh shoot). Store it so the gallery sort can use a real
  // chronological key instead of the brittle stem-based one.
  var capturedAt = (typeof info.captured_at === 'number' && isFinite(info.captured_at))
    ? info.captured_at
    : (typeof info.captured_at_seed === 'number' && isFinite(info.captured_at_seed)
        ? info.captured_at_seed
        : null);
  for (var i = 0; i < proj.previews.length; i++) {
    var existing = proj.previews[i];
    if (existing && (existing.stem === stem || existing.name === name)) {
      if (imgPath && !existing.path) existing.path = imgPath;
      if (capturedAt != null && existing.captured_at == null) {
        existing.captured_at = capturedAt;
      }
      return existing;
    }
  }
  var photo = {
    name: name,
    stem: stem,
    path: imgPath,
    rating: info.rating != null ? info.rating : 0,
    rotation: 0,
    tags: Array.isArray(info.keywords) ? info.keywords.slice() : [],
    folders: [],
    source: 'shoot',
    captured_at: capturedAt
  };
  // preview/thumb get filled by smLoadThumbFor with a base64 data URL.
  // Skipping the broken file:// URL avoids a flash of <img onerror>.
  proj.previews.push(photo);
  return photo;
}

/* Извлекает хвостовые цифры stem'а — это camera counter. Маша 2026-05-07
   просила сортировать по нему как primary key. EKONIKA_2026-05-060335 →
   060335 → 60335. parseInt чтобы 0301 / 301 сравнивались корректно. */
function _smTailCounter(s) {
  if (!s) return null;
  var m = String(s).match(/(\d+)$/);
  if (!m) return null;
  var n = parseInt(m[1], 10);
  return isFinite(n) ? n : null;
}

/* UI refresh is intentionally debounced. The watcher can fire 1000+ events
   in a burst when an existing C1 session has many already-rated photos —
   re-rendering on every event freezes the WebKit. We coalesce into one
   refresh per ~250ms. */
var _smRefreshTimer = null;
var _smRefreshProj = null;
function smRefreshUI(proj) {
  _smRefreshProj = proj || _smRefreshProj;
  if (_smRefreshTimer) return;
  _smRefreshTimer = setTimeout(function() {
    _smRefreshTimer = null;
    var p = _smRefreshProj;
    _smRefreshProj = null;
    if (!p) return;
    // Маша 2026-05-07: первичный ключ — счётчик камеры (хвостовые
    // цифры stem'а, типа EKONIKA_2026-05-060335 → 060335). Это самый
    // стабильный порядок: монотонно растёт по факту срабатывания
    // затвора, не зависит от mtime'а файла. Если у одного из файлов
    // счётчика нет (или совпали) — fallback на captured_at, далее на
    // stem-numeric.
    if (Array.isArray(p.previews)) {
      try {
        p.previews.sort(function(a, b) {
          var ca = _smTailCounter(a && (a.stem || a.name));
          var cb = _smTailCounter(b && (b.stem || b.name));
          if (ca != null && cb != null && ca !== cb) return ca - cb;
          var ta = a && typeof a.captured_at === 'number' && isFinite(a.captured_at) ? a.captured_at : null;
          var tb = b && typeof b.captured_at === 'number' && isFinite(b.captured_at) ? b.captured_at : null;
          if (ta != null && tb != null && ta !== tb) return ta - tb;
          if (ta != null && tb == null) return -1;
          if (ta == null && tb != null) return 1;
          var sa = (a && (a.stem || a.name)) || '';
          var sb = (b && (b.stem || b.name)) || '';
          return String(sa).localeCompare(String(sb), undefined, { numeric: true, sensitivity: 'base' });
        });
      } catch (e) {}
    }
    try { if (typeof shAutoSave === 'function') shAutoSave(); } catch (e) {}
    try { if (typeof pvRenderAll === 'function') pvRenderAll(); } catch (e) {}
    try { if (typeof cpRenderCards === 'function') cpRenderCards(); } catch (e) {}
    try { if (typeof renderProjects === 'function') renderProjects(); } catch (e) {}
  }, 250);
}

/* Cap the number of events kept in the DOM. Append-only would balloon
   the events panel into a 1000+ row table on a populated session and
   slow the renderer. */
var SM_EVENTS_MAX = 200;
var _smAppendCount = 0;
var _smAppendOriginal = window.smAppendEvent;
window.smAppendEvent = function(text) {
  try {
    if (typeof _smAppendOriginal === 'function') _smAppendOriginal(text);
    _smAppendCount++;
    if (_smAppendCount % 50 !== 0) return;
    var pane = document.getElementById('sm-events');
    if (!pane) return;
    while (pane.children.length > SM_EVENTS_MAX) {
      pane.removeChild(pane.firstChild);
    }
  } catch (e) {}
};

/* Bounded-concurrency thumb loader. Without a queue, a 1000+ event burst
   spawns 1000+ concurrent pywebview ↔ Python calls and freezes the WebKit. */
var SM_THUMB_PARALLEL = 4;
var _smThumbQueue = [];
var _smThumbInflight = 0;
function smLoadThumbFor(photo) {
  if (!photo || !photo.path) return;
  if (photo._thumbLoading) return;
  if (photo.preview && photo.preview.indexOf('data:') === 0) return;  // already loaded
  if (!smHasDesktop() || !window.pywebview.api.shoot_get_thumb) return;
  photo._thumbLoading = true;
  _smThumbQueue.push(photo);
  _smThumbDrain();
}
function _smThumbDrain() {
  while (_smThumbInflight < SM_THUMB_PARALLEL && _smThumbQueue.length > 0) {
    var photo = _smThumbQueue.shift();
    _smThumbInflight++;
    (function(ph) {
      // Ask for 1200px on the long edge — .cot itself is ~300-450px, so
      // shoot_get_thumb LANCZOS-upscales to the request. Doesn't add new
      // detail but stops the WebKit nearest-neighbor stretch, and gives
      // the lightbox a cleaner read.
      window.pywebview.api.shoot_get_thumb(ph.path, 1200).then(function(res) {
        ph._thumbLoading = false;
        if (res && res.data_url) {
          ph.preview = res.data_url;
          ph.thumb = res.data_url;
          var proj = smCurrentProj();
          if (proj && Array.isArray(proj.cards)) {
            for (var ci = 0; ci < proj.cards.length; ci++) {
              var slots = proj.cards[ci].slots || [];
              for (var si = 0; si < slots.length; si++) {
                if (slots[si].stem === ph.stem) {
                  slots[si].dataUrl = res.data_url;
                  slots[si].preview = res.data_url;
                  slots[si].thumb = res.data_url;
                }
              }
            }
          }
          if (proj) smRefreshUI(proj);
        }
      })['catch'](function() {
        ph._thumbLoading = false;
      })['finally'](function() {
        _smThumbInflight--;
        _smThumbDrain();
      });
    })(photo);
  }
}

/* Маша 2026-05-02: «сохраняются все кадры с 0 рейтингом тоже». Filter
   here — only photos that meet the selection criteria (rating >= 1 OR
   has _card: keyword) belong in proj.previews. Photos with rating 0
   and no card tag stay invisible to Maket CP until the user actually
   rates or assigns them. */
function _smShouldKeepPhoto(p) {
  if (!p) return false;
  if (typeof p.rating === 'number' && p.rating >= 1) return true;
  if (typeof p.rating_after === 'number' && p.rating_after >= 1) return true;
  if (Array.isArray(p.keywords)) {
    for (var i = 0; i < p.keywords.length; i++) {
      if (typeof p.keywords[i] === 'string' && p.keywords[i].indexOf('_card:') === 0) {
        return true;
      }
    }
  }
  if (Array.isArray(p.keywords_added)) {
    for (var j = 0; j < p.keywords_added.length; j++) {
      if (typeof p.keywords_added[j] === 'string' && p.keywords_added[j].indexOf('_card:') === 0) {
        return true;
      }
    }
  }
  return false;
}

function _smRemovePhotoByStem(proj, stem) {
  if (!stem || !Array.isArray(proj.previews)) return;
  for (var i = proj.previews.length - 1; i >= 0; i--) {
    if (proj.previews[i] && proj.previews[i].stem === stem) {
      proj.previews.splice(i, 1);
    }
  }
}

window.onShoot_watcher_photo_added = function(p) {
  smAppendEvent('photo added: ' + (p && p.stem ? p.stem : '?') + ' rating=' + (p && p.rating != null ? p.rating : '-'));
  if (!p) return;
  if (!_smShouldKeepPhoto(p)) return;
  var proj = smCurrentProj(); if (!proj) return;
  var photo = smEnsurePhoto(proj, p);
  if (photo && p.rating != null) photo.rating = p.rating;
  if (photo && p.rating != null && p.rating >= 1) photo._preselect = true;
  if (photo) smLoadThumbFor(photo);
  smRefreshUI(proj);
};
window.onShoot_watcher_photo_changed = function(p) {
  if (!p) return;
  var msg = 'photo changed: ' + (p.stem || '?');
  if (p.rating_before !== p.rating_after) msg += ' rating ' + p.rating_before + '->' + p.rating_after;
  if (p.keywords_added && p.keywords_added.length) msg += ' +kw[' + p.keywords_added.join(',') + ']';
  smAppendEvent(msg);
  var proj = smCurrentProj(); if (!proj) return;
  // Rating dropped to 0 and no card tag → remove from gallery.
  if (!_smShouldKeepPhoto(p)) {
    _smRemovePhotoByStem(proj, p.stem);
    smRefreshUI(proj);
    return;
  }
  var photo = smEnsurePhoto(proj, p);
  if (photo && p.rating_after != null) {
    photo.rating = p.rating_after;
    photo._preselect = (p.rating_after >= 1);
  }
  if (photo) smLoadThumbFor(photo);
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
    smLoadThumbFor(photo);
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
window.onShoot_watcher_thumb_updated = function(p) {
  if (!p || !p.stem) return;
  // C1 re-rendered the .cot/.cop (e.g. after a CC tweak). Drop our
  // cached data URL and re-fetch via shoot_get_thumb so the gallery
  // shows the new render.
  var proj = smCurrentProj(); if (!proj) return;
  if (!Array.isArray(proj.previews)) return;
  for (var i = 0; i < proj.previews.length; i++) {
    var ph = proj.previews[i];
    if (ph && ph.stem === p.stem) {
      ph.preview = null;
      ph.thumb = null;
      ph._thumbLoading = false;
      if (p.image_path && !ph.path) ph.path = p.image_path;
      smLoadThumbFor(ph);
      // Also nudge any card slots that reference this stem.
      if (Array.isArray(proj.cards)) {
        for (var ci = 0; ci < proj.cards.length; ci++) {
          var slots = proj.cards[ci].slots || [];
          for (var si = 0; si < slots.length; si++) {
            if (slots[si].stem === p.stem) {
              slots[si].dataUrl = null;
              slots[si].preview = null;
              slots[si].thumb = null;
            }
          }
        }
      }
      break;
    }
  }
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
  if (!proj) {
    var idx = (window.App && App.selectedProject != null) ? App.selectedProject : 'undef';
    var len = (window.App && Array.isArray(App.projects)) ? App.projects.length : 'undef';
    smAppendEvent('  ! no active project (selectedProject=' + idx + ', projects.length=' + len + ')');
    return;
  }
  smAppendEvent('  → push to proj.cards (current: ' + (proj.cards ? proj.cards.length : 0) + ', brand: ' + (proj.brand || '?') + ')');

  // Make sure each photo exists in proj.previews; build the slots list.
  var slots = [];
  var variants = (p.variants || []).slice().sort(function(a, b) {
    return (a.slot || 0) - (b.slot || 0);
  });
  // First variant defines the hero. Backend already probed orient from the
  // C1 .cot cache so it matches what the user sees inside C1 (rotation
  // already applied) — better than guessing from EXIF.
  var heroOrient = (variants.length > 0 && variants[0].orient) ? variants[0].orient : 'v';
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    var imgPath = v.path || null;
    if (imgPath && /\.cos$/i.test(imgPath)) imgPath = null;  // safety
    var photoInfo = { stem: v.stem, image_path: imgPath, name: v.stem };
    var photo = smEnsurePhoto(proj, photoInfo);
    if (photo) smLoadThumbFor(photo);
    // photo.name is what proj.previews lookups in cards.js compare against
    // (line ~618: `proj.previews[pi].name === slot.file`). Use the photo's
    // own name rather than re-deriving — they were drifting (smEnsurePhoto
    // sets name=stem, while we were building 'stem.ext' here).
    var slotFile = (photo && photo.name) || (v.stem || null);
    // Маша 2026-05-02: «первая карточка сохранила состав, остальные нет
    // только карточки создаются». Cause: smLoadThumbFor returns early
    // when photo._thumbLoading or photo.preview already set, so slots
    // built AFTER the first card never receive the data URL. We now
    // pre-fill slot.dataUrl directly when the photo already has one.
    var existingPreview = photo && typeof photo.preview === 'string'
                           && photo.preview.indexOf('data:') === 0
                           ? photo.preview : null;
    slots.push({
      orient: v.orient || 'v',
      weight: i === 0 ? 2 : 1,  // hero → книжная / альбомная in cards.js
      aspect: null,
      file: slotFile,
      dataUrl: existingPreview,
      preview: existingPreview,
      thumb: existingPreview,
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
      _hAspect: '3/2',          // sensible default; cards.js falls back if null
      _vAspect: '2/3',
      _hasHero: slots.length > 1,
      _heroOrient: heroOrient
    });
    // Diagnostic so Маша can see what landed in the slots from the events
    // panel without opening DevTools.
    var diagPaths = slots.map(function(s) {
      return s.stem + ':' + (s.dataUrl ? 'thumb-loaded' : 'pending') + ':' + (s.file || '?');
    }).join(' | ');
    smAppendEvent('  card push: ' + slots.length + ' slots — ' + diagPaths);
    smAppendEvent('  proj.previews.length=' + (proj.previews ? proj.previews.length : 0)
                  + ', proj.cards.length=' + (proj.cards ? proj.cards.length : 0));
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
