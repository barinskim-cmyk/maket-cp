// v2/frontend/js/error-reporter.js
// Auto-collects client-side JS errors and ships them to Supabase `client_errors`.
// MUST be loaded BEFORE other scripts so the global handlers catch their load-time errors too.
//
// Reads:  window.getActiveProject(), window.sbClient, window._isShareLink
// Writes: window.errPushBreadcrumb(action), window.errReport(message, stack?)
//
// Verbose mode: append `?errors=verbose` to URL to also forward console.error.

(function() {
  'use strict';

  var SUPA_URL = 'https://mukiyeuxulasvtlpckjf.supabase.co';
  var SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11a2l5ZXV4dWxhc3Z0bHBja2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTMyMjEsImV4cCI6MjA5MDI4OTIyMX0.zYB28Pn4u6zSNP2ZbF7WLz0JeaGwH7LQhRwmw1-niPc';

  var THROTTLE_MS = 5 * 60 * 1000; // 5 minutes per identical signature
  var MAX_BREADCRUMBS = 10;
  var MAX_MSG_LEN = 2000;
  var MAX_STACK_LEN = 5000;

  var sentHashes = Object.create(null);
  var breadcrumbs = [];
  var inFlight = false; // re-entrancy guard for the reporter itself

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return String(h);
  }

  function safeStr(v) {
    try { return v == null ? '' : (typeof v === 'string' ? v : (v.message || v.toString())); }
    catch (e) { return '[unserializable]'; }
  }

  function getQueryParam(name) {
    try { return new URLSearchParams(location.search).get(name); }
    catch (e) { return null; }
  }

  function getUserSync() {
    // supabase-js v2 doesn't expose .user() synchronously — try a few shapes.
    try {
      var sb = window.sbClient || window.supabaseClient || null;
      if (!sb) return null;
      if (sb.auth && typeof sb.auth.user === 'function') {
        var u = sb.auth.user();
        if (u) return u;
      }
      // Fallback: cached session on the SDK
      if (sb.auth && sb.auth.session && typeof sb.auth.session === 'function') {
        var s = sb.auth.session();
        if (s && s.user) return s.user;
      }
      // Last resort: app-level globals if the app exposes them
      if (window.currentUser) return window.currentUser;
      return null;
    } catch (e) { return null; }
  }

  function getActiveProjectSync() {
    try {
      if (typeof window.getActiveProject === 'function') {
        var p = window.getActiveProject();
        if (p) return p;
      }
      if (window.activeProject) return window.activeProject;
      return null;
    } catch (e) { return null; }
  }

  function getContext() {
    var proj = getActiveProjectSync();
    var user = getUserSync();
    var shareToken = getQueryParam('share');
    var role;
    if (window._isShareLink) role = 'guest_share_link';
    else if (user && user.id) role = 'team';
    else role = 'guest';

    return {
      project_cloud_id: (proj && (proj._cloudId || proj.cloud_id || proj.id)) || null,
      user_id: (user && user.id) || null,
      user_role: role,
      share_token: shareToken,
      page_url: location.href,
      user_agent: navigator.userAgent,
      screen_size: (window.screen && (screen.width + 'x' + screen.height)) || null,
      breadcrumbs: breadcrumbs.slice()
    };
  }

  function pushBreadcrumb(action) {
    try {
      breadcrumbs.push({ ts: Date.now(), action: safeStr(action).slice(0, 200) });
      if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
    } catch (e) { /* swallow */ }
  }

  function reportError(type, message, stack) {
    if (inFlight) return; // never recurse
    var msgStr = safeStr(message);
    if (!msgStr) return;
    var stackStr = stack ? safeStr(stack) : null;
    var sig = hash(type + '|' + msgStr + '|' + (stackStr || ''));
    var now = Date.now();
    if (sentHashes[sig] && now - sentHashes[sig] < THROTTLE_MS) return; // throttled
    sentHashes[sig] = now;

    var body;
    try {
      var ctx = getContext();
      body = {
        error_type: type,
        message: msgStr.slice(0, MAX_MSG_LEN),
        stack: stackStr ? stackStr.slice(0, MAX_STACK_LEN) : null,
        hash: sig,
        project_cloud_id: ctx.project_cloud_id,
        user_id: ctx.user_id,
        user_role: ctx.user_role,
        share_token: ctx.share_token,
        page_url: ctx.page_url,
        user_agent: ctx.user_agent,
        screen_size: ctx.screen_size,
        breadcrumbs: ctx.breadcrumbs
      };
    } catch (e) {
      // If even context-collection fails, send minimal payload
      body = { error_type: type, message: msgStr.slice(0, MAX_MSG_LEN), stack: null, hash: sig, page_url: location.href };
    }

    inFlight = true;
    try {
      // keepalive ensures the request survives page unload
      fetch(SUPA_URL + '/rest/v1/client_errors', {
        method: 'POST',
        headers: {
          'apikey': SUPA_ANON_KEY,
          'Authorization': 'Bearer ' + SUPA_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(body),
        keepalive: true,
        mode: 'cors'
      }).then(function() { inFlight = false; })
        .catch(function() { inFlight = false; });
    } catch (e) {
      inFlight = false;
      // never rethrow — would re-enter our own handler
    }
  }

  // === Global handlers ===
  window.addEventListener('error', function(e) {
    // Resource load failures (img/script/link) come as plain Event (not ErrorEvent).
    // e.target — failed element, no message/error/filename.
    if (e && e.target && e.target.tagName && e.target !== window) {
      var tag = String(e.target.tagName).toLowerCase();
      if (tag === 'img' || tag === 'script' || tag === 'link' || tag === 'video' || tag === 'audio') {
        var url = e.target.src || e.target.href || '(no url)';
        var detail = tag + ' load failed: ' + url;
        // Truncate URL for hash dedup
        reportError('resource_load', detail, null);
        return;
      }
    }
    var msg = (e && e.message) || 'unknown error';
    var stack = (e && e.error && e.error.stack) || null;
    if (!stack && e && e.filename) {
      stack = e.filename + ':' + (e.lineno || '?') + ':' + (e.colno || '?');
    }
    reportError('uncaught', msg, stack);
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e && e.reason;
    var msg = (reason && reason.message) ? reason.message : safeStr(reason) || 'unhandledrejection';
    var stack = (reason && reason.stack) || null;
    reportError('unhandled_rejection', msg, stack);
  });

  // === Optional verbose mode: forward console.error ===
  if (location.search.indexOf('errors=verbose') !== -1) {
    var origErr = console.error;
    console.error = function() {
      try {
        var msg = Array.prototype.map.call(arguments, function(a) {
          if (a instanceof Error) return (a.message || '') + (a.stack ? '\n' + a.stack : '');
          if (a == null) return String(a);
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return '[object]'; } }
          return String(a);
        }).join(' ');
        reportError('console_error', msg, null);
      } catch (e) { /* swallow */ }
      try { return origErr.apply(console, arguments); } catch (e) { /* swallow */ }
    };
  }

  // === Public API ===
  window.errPushBreadcrumb = pushBreadcrumb;
  window.errReport = function(message, stack) { reportError('manual', message, stack || null); };

  // Initial breadcrumb so we always have at least one entry
  pushBreadcrumb('page_load');

  try { console.log('[error-reporter] active'); } catch (e) {}
})();
