/* ═══════════════════════════════════════════════════════════════════════════
   diag.js — Диагностика для удалённого траблшутинга
   ═══════════════════════════════════════════════════════════════════════════

   Что делает:
   1. Перехватывает console.log / warn / error и складывает в буфер
   2. Оборачивает fetch() чтобы логировать все HTTP-ответы (Supabase и т.д.)
   3. Ловит window.onerror / unhandledrejection
   4. Функция dgDownloadLog() собирает снимок состояния App + буфер + IDB
      контент и даёт скачать JSON

   Подключать ПЕРВЫМ в index.html, до всех остальных скриптов,
   иначе ранние console-вызовы не попадут в лог.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var MAX_LOG_ENTRIES = 2000;   // бафер по кольцу, чтобы не утекать по памяти
  var MAX_ENTRY_LEN = 4000;     // чтобы один console.log с мегабайтом не раздул

  var buf = [];
  var startedAt = new Date().toISOString();

  function safeStringify(v) {
    try {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (v instanceof Error) {
        return v.name + ': ' + v.message + (v.stack ? '\n' + v.stack : '');
      }
      // Обрезаем большие объекты, чтобы лог не распух
      var s = JSON.stringify(v, function (k, val) {
        if (val instanceof Blob) return '[Blob ' + val.size + 'B]';
        if (val instanceof ArrayBuffer) return '[ArrayBuffer ' + val.byteLength + 'B]';
        if (typeof val === 'string' && val.length > 500) {
          return val.slice(0, 500) + '…(' + val.length + ' chars)';
        }
        return val;
      });
      if (s && s.length > MAX_ENTRY_LEN) s = s.slice(0, MAX_ENTRY_LEN) + '…';
      return s;
    } catch (e) {
      return '[unstringifiable: ' + e.message + ']';
    }
  }

  function push(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) parts.push(safeStringify(args[i]));
      var entry = {
        t: new Date().toISOString(),
        level: level,
        msg: parts.join(' ')
      };
      if (entry.msg.length > MAX_ENTRY_LEN) entry.msg = entry.msg.slice(0, MAX_ENTRY_LEN) + '…';
      buf.push(entry);
      if (buf.length > MAX_LOG_ENTRIES) buf.shift();
    } catch (e) {
      // диагностика не должна падать сама
    }
  }

  /* ─────────────── Перехват console ─────────────── */
  var origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console)
  };

  console.log = function () { push('log', arguments); origConsole.log.apply(null, arguments); };
  console.warn = function () { push('warn', arguments); origConsole.warn.apply(null, arguments); };
  console.error = function () { push('error', arguments); origConsole.error.apply(null, arguments); };
  console.info = function () { push('info', arguments); origConsole.info.apply(null, arguments); };
  console.debug = function () { push('debug', arguments); origConsole.debug.apply(null, arguments); };

  /* ─────────────── Ловушки для необработанных ошибок ─────────────── */
  window.addEventListener('error', function (e) {
    push('window.error', [
      (e.message || 'Unknown error') + ' at ' + (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?'),
      e.error && e.error.stack ? e.error.stack : ''
    ]);
  });

  window.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection', [
      e.reason && e.reason.message ? e.reason.message : String(e.reason),
      e.reason && e.reason.stack ? e.reason.stack : ''
    ]);
  });

  /* ─────────────── Оборачиваем fetch для сетевых логов ─────────────── */
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var reqT = performance.now ? performance.now() : Date.now();

      return origFetch(input, init).then(function (resp) {
        var dt = Math.round((performance.now ? performance.now() : Date.now()) - reqT);
        var short = url;
        try {
          var u = new URL(url, location.href);
          short = u.origin + u.pathname + (u.search ? u.search.slice(0, 120) : '');
        } catch (e) { /* noop */ }
        push(resp.ok ? 'net' : 'net.error', [
          method + ' ' + resp.status + ' ' + short + ' (' + dt + 'ms)'
        ]);

        // Для ошибок — попытаемся вытащить тело (клон чтобы не съесть оригинальный stream)
        if (!resp.ok) {
          try {
            resp.clone().text().then(function (txt) {
              push('net.body', [resp.status + ' ' + short + ' → ' + (txt || '').slice(0, 800)]);
            }).catch(function () { /* noop */ });
          } catch (e) { /* noop */ }
        }
        return resp;
      }).catch(function (err) {
        var dt = Math.round((performance.now ? performance.now() : Date.now()) - reqT);
        push('net.throw', [method + ' ' + url + ' (' + dt + 'ms) → ' + (err && err.message ? err.message : String(err))]);
        throw err;
      });
    };
  }

  /* ─────────────── Сбор снимка IDB ─────────────── */
  function idbSnapshot(callback) {
    var result = { stores: {} };
    if (!window.indexedDB) { callback(result); return; }
    try {
      var openReq = indexedDB.open('maketcp_previews');
      openReq.onerror = function () { result.error = 'indexedDB.open error'; callback(result); };
      openReq.onsuccess = function (ev) {
        var db = ev.target.result;
        result.dbName = db.name;
        result.dbVersion = db.version;
        var stores = [];
        for (var i = 0; i < db.objectStoreNames.length; i++) stores.push(db.objectStoreNames[i]);
        result.storeNames = stores;

        if (!stores.length) { db.close(); callback(result); return; }

        var remaining = stores.length;
        stores.forEach(function (storeName) {
          try {
            var tx = db.transaction(storeName, 'readonly');
            var store = tx.objectStore(storeName);
            var countReq = store.count();
            countReq.onsuccess = function () {
              var info = { count: countReq.result, sampleKeys: [] };
              // Возьмём 20 ключей для sample
              var keyReq = store.getAllKeys();
              keyReq.onsuccess = function () {
                var keys = keyReq.result || [];
                info.sampleKeys = keys.slice(0, 20).map(String);
                info.totalKeys = keys.length;
                // Группировка по префиксу до "/"
                var byProj = {};
                for (var k = 0; k < keys.length; k++) {
                  var key = String(keys[k]);
                  var slash = key.indexOf('/');
                  var prefix = slash > 0 ? key.slice(0, slash) : '(no-prefix)';
                  byProj[prefix] = (byProj[prefix] || 0) + 1;
                }
                info.byProjectPrefix = byProj;
                result.stores[storeName] = info;
                remaining--;
                if (remaining === 0) { db.close(); callback(result); }
              };
              keyReq.onerror = function () {
                result.stores[storeName] = info;
                remaining--;
                if (remaining === 0) { db.close(); callback(result); }
              };
            };
            countReq.onerror = function () {
              result.stores[storeName] = { error: 'count failed' };
              remaining--;
              if (remaining === 0) { db.close(); callback(result); }
            };
          } catch (e) {
            result.stores[storeName] = { error: e.message };
            remaining--;
            if (remaining === 0) { db.close(); callback(result); }
          }
        });
      };
    } catch (e) {
      result.error = e.message;
      callback(result);
    }
  }

  /* ─────────────── Снимок состояния App ─────────────── */
  function appSnapshot() {
    var snap = { hasApp: false };
    try {
      if (typeof App === 'undefined') return snap;
      snap.hasApp = true;
      snap.selectedProject = App.selectedProject;
      snap.projectsCount = (App.projects || []).length;

      var projs = [];
      (App.projects || []).forEach(function (p, idx) {
        projs.push({
          idx: idx,
          brand: p.brand,
          shoot_date: p.shoot_date,
          _cloudId: p._cloudId,
          _pendingSync: !!p._pendingSync,
          stage: p.stage,
          previewsLen: (p.previews || []).length,
          cardsLen: (p.cards || []).length,
          articlesLen: (p.articles || []).length,
          // Не сливаем полные массивы — объёмно; только первый элемент для sample
          firstPreview: (p.previews || [])[0] ? {
            name: (p.previews || [])[0].name,
            hasThumb: !!((p.previews || [])[0].thumb),
            hasPreview: !!((p.previews || [])[0].preview),
            rating: (p.previews || [])[0].rating
          } : null
        });
      });
      snap.projects = projs;

      // Активный проект — чуть подробнее
      var cur = (App.projects || [])[App.selectedProject];
      if (cur) {
        snap.active = {
          brand: cur.brand,
          _cloudId: cur._cloudId,
          previewsLen: (cur.previews || []).length,
          cardsLen: (cur.cards || []).length,
          articlesLen: (cur.articles || []).length,
          // Первые три имени превью, чтобы сравнить с IDB
          firstPreviewNames: (cur.previews || []).slice(0, 3).map(function (x) { return x && x.name; })
        };
      }
    } catch (e) {
      snap.error = e.message;
    }
    return snap;
  }

  /* ─────────────── Снимок Supabase-сессии ─────────────── */
  function supabaseSnapshot(callback) {
    var res = { hasClient: false };
    try {
      if (typeof sbClient === 'undefined' || !sbClient) { callback(res); return; }
      res.hasClient = true;
      sbClient.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (s) {
          res.hasSession = true;
          res.userId = s.user && s.user.id;
          res.email = s.user && s.user.email;
          res.expiresAt = s.expires_at ? new Date(s.expires_at * 1000).toISOString() : null;
          res.expiresInSec = s.expires_at ? s.expires_at - Math.floor(Date.now() / 1000) : null;
        } else {
          res.hasSession = false;
        }
        callback(res);
      }).catch(function (e) {
        res.error = e && e.message;
        callback(res);
      });
    } catch (e) {
      res.error = e.message;
      callback(res);
    }
  }

  /* ─────────────── Основная функция: скачать лог ─────────────── */
  window.dgDownloadLog = function () {
    supabaseSnapshot(function (sb) {
      idbSnapshot(function (idb) {
        var payload = {
          generatedAt: new Date().toISOString(),
          sessionStartedAt: startedAt,
          userAgent: navigator.userAgent,
          url: location.href,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          online: navigator.onLine,
          app: appSnapshot(),
          supabase: sb,
          idb: idb,
          localStorageKeys: (function () {
            var keys = [];
            try {
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                var v = localStorage.getItem(k);
                keys.push({ key: k, length: v ? v.length : 0 });
              }
            } catch (e) { keys.push({ error: e.message }); }
            return keys;
          })(),
          log: buf.slice() // копия буфера на момент скачивания
        };

        var json = JSON.stringify(payload, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = 'maketcp-log-' + ts + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);

        console.log('[diag] лог скачан, записей:', buf.length);
      });
    });
  };

  // Также доступно через globals для ручной отладки
  window.__maketDiag = {
    buf: buf,
    download: window.dgDownloadLog,
    clear: function () { buf.length = 0; },
    snapshot: appSnapshot
  };

  push('diag', ['diag.js loaded at ' + startedAt]);
})();
