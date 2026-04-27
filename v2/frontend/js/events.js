/* ══════════════════════════════════════════════
   events.js — Canonical event log (pipeline ledger)
   ══════════════════════════════════════════════

   Принцип: pipeline = ledger живого процесса, не workflow engine.
   Реальная работа = фиксировать события. «Где сейчас фото» = derived
   state из последнего события.

   Schema одного события:
   {
     id: string,                 // 'ev_<ts>_<rand>'
     ts: ISO timestamp,
     type: string,               // open vocabulary
     actor: {
       user_id?:    UUID,        // если зарегистрированный
       share_link?: token,       // если действие через share-link
       name?:       string       // optional display label
     },
     photos: string[],           // имена файлов из proj.previews
     from?: task_id,             // для переходов
     to?: task_id,
     payload?: object,           // type-specific
     parent_event_id?: string    // для tree связей
   }

   Хранится в proj._events[]. Persist в supabase.projects.events (jsonb).
   ────────────────────────────────────────────── */

/* Mapping event_type → typical task bucket (UI grouping).
   Бакеты — это PIPELINE_STAGES (preselect, selection, client, color,
   retouch_task, retouch, retouch_ok, adaptation, delivered).
   Vocabulary НЕ enforced — unknown типы просто не двигают bucket. */
var EVENT_TYPE_TO_TASK = {
  preview_loaded:           'preselect',
  selection_added:          'selection',
  selection_removed:        'selection',
  selection_approved:       'client',
  cc_loaded:                'color',
  cc_returned:              'color',
  cc_ready_unchanged:       'color',     // ЦК осталась прежней — фото готово
  retouch_loaded:           'retouch',
  retouch_returned:         'retouch',
  retouch_ready_unchanged:  'retouch',   // ретушь осталась прежней
  delivered:                'delivered',
  manual_skip:              null         // skip-маркер, не двигает bucket
};

/* ──────────────────────────────────────────────
   Actor — кто инициировал событие
   ────────────────────────────────────────────── */

/**
 * Determine current actor (sync, best-effort).
 * @returns {{user_id?: string, share_link?: string, name?: string}}
 */
function evGetCurrentActor() {
  var actor = {};
  /* 1. Supabase signed-in user (cached on sb.auth) */
  try {
    var sb = window.sbClient || window.supabaseClient || null;
    if (sb && sb.auth) {
      if (typeof sb.auth.user === 'function') {
        var u = sb.auth.user();
        if (u && u.id) {
          actor.user_id = u.id;
          actor.name = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email || '';
          return actor;
        }
      }
      if (sb.auth.session && typeof sb.auth.session === 'function') {
        var s = sb.auth.session();
        if (s && s.user && s.user.id) {
          actor.user_id = s.user.id;
          actor.name = (s.user.user_metadata && (s.user.user_metadata.full_name || s.user.user_metadata.name)) || s.user.email || '';
          return actor;
        }
      }
    }
    if (window.currentUser && window.currentUser.id) {
      actor.user_id = window.currentUser.id;
      actor.name = window.currentUser.name || window.currentUser.email || '';
      return actor;
    }
  } catch (e) { /* swallow */ }

  /* 2. Share-link guest */
  try {
    var p = new URLSearchParams(window.location.search);
    var token = p.get('share');
    if (token) {
      actor.share_link = token;
      actor.name = window._shareGuestName || 'guest';
      return actor;
    }
  } catch (e) { /* swallow */ }

  /* 3. System fallback */
  actor.name = 'system';
  return actor;
}

/* ──────────────────────────────────────────────
   Write API — emitEvent
   ────────────────────────────────────────────── */

function _evGenId() {
  return 'ev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Add a new event to proj._events. Triggers autosave.
 * @param {Object} proj — target project (must be the live App.projects entry)
 * @param {string} type
 * @param {Object} [actor] — defaults to evGetCurrentActor()
 * @param {string[]} [photos]
 * @param {Object} [opts] — { from, to, payload, parent_event_id }
 * @returns {Object|null} the created event
 */
function emitEvent(proj, type, actor, photos, opts) {
  if (!proj) return null;
  if (!Array.isArray(proj._events)) proj._events = [];
  opts = opts || {};
  var ev = {
    id: _evGenId(),
    ts: new Date().toISOString(),
    type: String(type || 'unknown'),
    actor: (actor && typeof actor === 'object') ? actor : evGetCurrentActor(),
    photos: Array.isArray(photos) ? photos.slice() : []
  };
  if (opts.from) ev.from = opts.from;
  if (opts.to)   ev.to   = opts.to;
  if (opts.payload) ev.payload = opts.payload;
  if (opts.parent_event_id) ev.parent_event_id = opts.parent_event_id;

  proj._events.push(ev);

  /* Persist (best-effort) */
  if (typeof shAutoSave === 'function') {
    try { shAutoSave(); } catch (e) { console.warn('emitEvent: shAutoSave failed', e); }
  }

  console.log('[evt]', ev.type, ev.photos.length + 'p', 'by', (ev.actor.name || ev.actor.user_id || ev.actor.share_link || '?'));
  return ev;
}

/* ──────────────────────────────────────────────
   Derived state — pure read-only fns over proj._events
   ────────────────────────────────────────────── */

function _evTaskFromType(type) {
  return EVENT_TYPE_TO_TASK.hasOwnProperty(type) ? EVENT_TYPE_TO_TASK[type] : undefined;
}

/** Last event in the log. If photoName is given — last event mentioning it. */
function lastEventOf(proj, photoName) {
  if (!proj || !Array.isArray(proj._events) || proj._events.length === 0) return null;
  if (!photoName) return proj._events[proj._events.length - 1];
  for (var i = proj._events.length - 1; i >= 0; i--) {
    var ev = proj._events[i];
    if (ev.photos && ev.photos.indexOf(photoName) >= 0) return ev;
  }
  return null;
}

/**
 * Determine the current task bucket of one photo (derived from last event).
 * Unknown event types и manual_skip — рассматриваются как «не двигают bucket»,
 * откатываемся к предыдущему известному task'у.
 *
 * @returns {string} task_id (см. PIPELINE_STAGES) — default 'preselect'
 */
function currentTaskOf(proj, photoName) {
  if (!proj || !Array.isArray(proj._events) || proj._events.length === 0) return 'preselect';
  for (var i = proj._events.length - 1; i >= 0; i--) {
    var ev = proj._events[i];
    if (!ev.photos || ev.photos.indexOf(photoName) < 0) {
      /* events без явного photoName всё равно могут быть «глобальными» —
         например preview_loaded. Для глобальных используем как fallback. */
      if (i === 0 && ev.type === 'preview_loaded') return 'preselect';
      continue;
    }
    var task = _evTaskFromType(ev.type);
    /* explicit override через ev.to */
    if (ev.to) return ev.to;
    if (task !== undefined && task !== null) return task;
    /* unknown / manual_skip — продолжаем поиск глубже */
  }
  return 'preselect';
}

/**
 * Group all photos by their derived current task.
 * @returns {{[task_id: string]: string[]}}
 */
function photosByTask(proj) {
  var out = {};
  if (typeof PIPELINE_STAGES !== 'undefined' && Array.isArray(PIPELINE_STAGES)) {
    PIPELINE_STAGES.forEach(function (s) { out[s.id] = []; });
  }
  out['delivered'] = out['delivered'] || [];
  if (!proj || !Array.isArray(proj.previews)) return out;
  for (var i = 0; i < proj.previews.length; i++) {
    var name = proj.previews[i] && proj.previews[i].name;
    if (!name) continue;
    var task = currentTaskOf(proj, name);
    if (!Array.isArray(out[task])) out[task] = [];
    out[task].push(name);
  }
  return out;
}

/** Was selection_approved ever emitted for this project? */
function selectionApproved(proj) {
  if (!proj || !Array.isArray(proj._events)) return false;
  for (var i = 0; i < proj._events.length; i++) {
    if (proj._events[i].type === 'selection_approved') return true;
  }
  return false;
}

/** Unique actors who participated. */
function allActorsOf(proj) {
  if (!proj || !Array.isArray(proj._events)) return [];
  var seen = {};
  var out = [];
  proj._events.forEach(function (ev) {
    var a = ev.actor || {};
    var key = a.user_id || a.share_link || a.name || '?';
    if (!seen[key]) { seen[key] = true; out.push(a); }
  });
  return out;
}

function projectStartedAt(proj) {
  if (!proj || !Array.isArray(proj._events) || proj._events.length === 0) return null;
  /* events не обязательно отсортированы — берём минимальный ts */
  var min = null;
  for (var i = 0; i < proj._events.length; i++) {
    var t = new Date(proj._events[i].ts || 0).getTime();
    if (!isNaN(t) && (min === null || t < min)) min = t;
  }
  return min ? new Date(min).toISOString() : null;
}

function projectFinishedAt(proj) {
  if (!proj || !Array.isArray(proj._events)) return null;
  var max = null;
  for (var i = 0; i < proj._events.length; i++) {
    if (proj._events[i].type !== 'delivered') continue;
    var t = new Date(proj._events[i].ts || 0).getTime();
    if (!isNaN(t) && (max === null || t > max)) max = t;
  }
  return max ? new Date(max).toISOString() : null;
}

/**
 * Cumulative wall-clock time photos spent at the given task (ms).
 * Sum across all photos: time between entering this task and the next event
 * that moves them out (or now if none).
 */
function timeAt(proj, taskId) {
  if (!proj || !Array.isArray(proj._events) || proj._events.length === 0) return 0;
  var evs = proj._events.slice().sort(function (a, b) {
    return new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime();
  });
  var byPhoto = {};
  evs.forEach(function (ev) {
    if (!ev.photos) return;
    var t = (ev.to) ? ev.to : _evTaskFromType(ev.type);
    if (t === undefined || t === null) return;
    ev.photos.forEach(function (p) {
      (byPhoto[p] = byPhoto[p] || []).push({ ts: ev.ts, task: t });
    });
  });
  var total = 0;
  var now = Date.now();
  Object.keys(byPhoto).forEach(function (p) {
    var seq = byPhoto[p];
    for (var i = 0; i < seq.length; i++) {
      if (seq[i].task !== taskId) continue;
      var start = new Date(seq[i].ts).getTime();
      var end = (i + 1 < seq.length) ? new Date(seq[i + 1].ts).getTime() : now;
      total += Math.max(0, end - start);
    }
  });
  return total;
}

/* ──────────────────────────────────────────────
   Migration — synthetic preview_loaded for legacy projects
   ────────────────────────────────────────────── */

/**
 * Ensure proj._events exists. If absent, synthesize a single preview_loaded
 * event so the project can be rendered. Старые `_stage` / `_stageHistory` /
 * `_checkpoints` НЕ конвертируются — clean wipe (см. spec).
 */
function migrateProjectToEvents(proj) {
  if (!proj) return;
  if (proj._migratedToEvents && Array.isArray(proj._events)) return;
  if (!Array.isArray(proj._events)) proj._events = [];

  if (proj._events.length === 0) {
    var ts = proj._previewLoadDate
          || proj.created_at
          || proj.createdAt
          || proj._createdAt
          || new Date().toISOString();
    var owner = proj._owner && typeof proj._owner === 'object'
          ? proj._owner
          : { name: 'system' };
    var photos = Array.isArray(proj.previews)
          ? proj.previews.map(function (p) { return p && p.name; }).filter(Boolean)
          : [];
    proj._events.push({
      id: _evGenId(),
      ts: ts,
      type: 'preview_loaded',
      actor: owner,
      photos: photos
    });
  }
  proj._migratedToEvents = true;
}

function migrateAllProjectsToEvents() {
  if (typeof App === 'undefined' || !Array.isArray(App.projects)) return;
  App.projects.forEach(migrateProjectToEvents);
}

/* ──────────────────────────────────────────────
   Diagnostics — small helpers for debugging in console
   ────────────────────────────────────────────── */

function evDumpProject(proj) {
  proj = proj || (typeof getActiveProject === 'function' ? getActiveProject() : null);
  if (!proj) return console.log('evDumpProject: no project');
  console.log('— events for', proj.title || proj.name || proj.id);
  console.log('  total:', (proj._events || []).length);
  (proj._events || []).forEach(function (ev, i) {
    console.log('  ' + (i + 1).toString().padStart(3, ' '),
      ev.ts.slice(0, 19).replace('T', ' '),
      ev.type.padEnd(20, ' '),
      'photos=' + (ev.photos || []).length,
      'by=' + (ev.actor && (ev.actor.name || ev.actor.user_id || ev.actor.share_link)) || '?');
  });
  console.log('— photosByTask:', photosByTask(proj));
}

/* ──────────────────────────────────────────────
   Globals — expose so it can be called from anywhere
   ────────────────────────────────────────────── */
window.EVENT_TYPE_TO_TASK = EVENT_TYPE_TO_TASK;
window.evGetCurrentActor = evGetCurrentActor;
window.emitEvent = emitEvent;
window.lastEventOf = lastEventOf;
window.currentTaskOf = currentTaskOf;
window.photosByTask = photosByTask;
window.selectionApproved = selectionApproved;
window.allActorsOf = allActorsOf;
window.projectStartedAt = projectStartedAt;
window.projectFinishedAt = projectFinishedAt;
window.timeAt = timeAt;
window.migrateProjectToEvents = migrateProjectToEvents;
window.migrateAllProjectsToEvents = migrateAllProjectsToEvents;
window.evDumpProject = evDumpProject;
