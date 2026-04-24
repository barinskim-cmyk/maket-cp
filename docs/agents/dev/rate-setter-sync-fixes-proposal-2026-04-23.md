---
type: spec
status: active
owner: PA
created: 2026-04-24
updated: 2026-04-24
tags:
  - product
  - ongoing
  - dev
related:
  - "[[agent-team-v2]]"
  - "[[strategy-2026]]"
  - "[[release-review-playbook]]"
priority: medium
cycle: ongoing
---

> **TL;DR:** **Автор:** Product Architect, overnight autonomous pass. **Companion:** `rate-setter-sync-analysis-2026-04-23.md`. Риски R-01 … R-06 ссылаются на раздел 2 анализа. **Статус:** предложения к merge.

# Rate Setter sync — предложения фиксов (2026-04-23)

**Автор:** Product Architect, overnight autonomous pass.
**Companion:** `rate-setter-sync-analysis-2026-04-23.md`. Риски R-01 … R-06 ссылаются на раздел 2 анализа.
**Статус:** предложения к merge. В prod-код ничего не внесено. Каждый фикс оформлен как inline diff + описание влияния + тестовый сценарий. Итоговые правки выполнит Маша (или PA на следующей сессии после approval).

---

## Приоритезация (итоговая)

| # | Код | Что | Impact | Risk | Effort | Зависимости |
|---|---|---|---|---|---|---|
| F-01 | R-02 | Error surfacing + pending-queue на `sbSyncStage` | High | Low (локальные изменения) | 1–2 дня | DAD (UX toast), QA (test plan) |
| F-02 | R-04 | Guard на пустой stems + валидация после clean | High | Minimal | полдня | QA |
| F-03 | R-01 | COS round-trip PoC (upload .cos после update_rating) | Critical | Medium (storage bucket, RLS) | 3–5 дней | CoS (OQ-RS-01), photo_versions миграция (audit R1) |
| F-04 | R-05 | ASCII sanitize в `sbUploadPostprodFile` | High (после F-03) | Low | полдня | F-03 |
| F-05 | R-02 | Replace `sbSyncStage` + `snCreateSnapshot` на RPC-транзакцию | Medium | Medium (SQL work) | 2–3 дня | CoS (OQ-RS-02) |
| F-06 | R-03 | Fresh-snapshot refresh в `rsFillDeltaFromLatest` | Medium | Low | полдня | — |
| F-07 | R-06 | `.cos.bak` — versioned backup с timestamp | Low | Low | полдня | — |
| F-08 | R-03 | Optimistic lock на `sbSelectPhotoVersion` | Medium | Medium (требует SQL RPC) | 2 дня | F-05 |
| F-09 | R-02 | Sentry-аналог через Supabase `error_log` таблицу | Low | Low | 1 день | CoS (T-03 в audit) |
| F-10 | — | Rate Setter пишет keywords в `.cos` (отдельный KPI ставки 4) | High | Medium | 2 дня | OQ-RS-04 |

**Параллельно можно делать:** F-01, F-02, F-06, F-07 (независимые).
**Последовательно:** F-03 → F-04 → F-05 → F-08 (накапливают storage + RLS + RPC).
**Отдельная ветка:** F-10 (не пересекается с round-trip).

---

## F-01 — Error surfacing + pending-queue на `sbSyncStage`

**Проблема:** `sbSyncStage` при ошибке RLS / network делает `console.warn` и никто об этом не знает. Stage продвинулся в `projects.stage`, но `stage_events` пусто. Аналог [anchor client] 14.04 в миниатюре.

**Предложенный код (v2/frontend/js/supabase.js):**

```javascript
/* ── В начале файла, рядом с другими module-level ── */

/* Очередь отложенных stage_events для offline/reconnect */
var _sbPendingStageEvents = [];
var _SB_STAGE_QUEUE_KEY = 'maket_pending_stage_events_v1';

/* Подгрузить очередь из localStorage при старте (дополнить в init). */
function sbRestoreStageQueue() {
  try {
    var raw = localStorage.getItem(_SB_STAGE_QUEUE_KEY);
    if (raw) _sbPendingStageEvents = JSON.parse(raw) || [];
  } catch(e) { _sbPendingStageEvents = []; }
}

function sbPersistStageQueue() {
  try {
    /* cap 500 событий, чтобы не раздувать localStorage */
    if (_sbPendingStageEvents.length > 500) {
      _sbPendingStageEvents = _sbPendingStageEvents.slice(-500);
    }
    localStorage.setItem(_SB_STAGE_QUEUE_KEY, JSON.stringify(_sbPendingStageEvents));
  } catch(e) {}
}

/* Flush очереди — вызывать при reconnect / после login */
function sbFlushStageQueue() {
  if (!sbClient || !sbIsLoggedIn() || _sbPendingStageEvents.length === 0) return;
  var queue = _sbPendingStageEvents.slice();
  _sbPendingStageEvents = [];
  sbPersistStageQueue();

  queue.forEach(function(ev) {
    sbClient.from('stage_events').insert(ev).then(function(res) {
      if (res.error) {
        /* Снова в очередь (но с отметкой retry) */
        ev._retry = (ev._retry || 0) + 1;
        if (ev._retry < 5) {
          _sbPendingStageEvents.push(ev);
          sbPersistStageQueue();
        } else {
          /* 5 попыток провалены — показать пользователю и логировать */
          sbShowError('Не удалось сохранить событие этапа после 5 попыток', ev);
        }
      }
    });
  });
}

/* ── Переработанная sbSyncStage ── */

function sbSyncStage(triggerDesc, note) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;
  if (!sbClient) return;

  var isClient = !!window._shareToken;
  var isOwner = sbIsLoggedIn();
  if (!isClient && !isOwner) return;

  var stage = proj._stage || 0;
  var cloudId = proj._cloudId;
  var stageIds = ['preselect', 'selection', 'client', 'color', 'retouch_task', 'retouch', 'retouch_ok', 'adaptation'];
  var completedIdx = stage > 0 ? stage - 1 : 0;
  var stageId = stageIds[completedIdx] || ('stage_' + completedIdx);

  var event = {
    project_id: cloudId,
    stage_id: stageId,
    trigger_desc: triggerDesc || null,
    note: note || null,
    client_timestamp: new Date().toISOString()  /* для de-dup на сервере */
  };

  /* Idempotency: если только что писали то же событие — skip (anti double-click) */
  var key = cloudId + '|' + stageId + '|' + (triggerDesc || '');
  if (window._lastStageEventKey === key && window._lastStageEventAt &&
      (Date.now() - window._lastStageEventAt) < 3000) {
    console.log('sbSyncStage: skip duplicate within 3s');
    return;
  }
  window._lastStageEventKey = key;
  window._lastStageEventAt = Date.now();

  /* 1. Обновить stage в projects (только владелец) */
  if (isOwner) {
    sbClient.from('projects').update({
      stage: stage,
      updated_at: new Date().toISOString()
    }).eq('id', cloudId).then(function(res) {
      if (res.error) {
        sbShowError('Не удалось обновить этап проекта в облаке', res.error);
        /* stage_event всё равно пробуем записать — он append-only */
      }
    });
  }

  /* 2. Вставить stage_event с pending-queue fallback */
  sbClient.from('stage_events').insert(event).then(function(res) {
    if (res.error) {
      console.warn('sbSyncStage: offline или RLS? в очередь:', res.error.message);
      _sbPendingStageEvents.push(event);
      sbPersistStageQueue();
      sbShowError('Событие этапа отложено (сеть/доступ). Повтор при восстановлении связи.', res.error);
    } else {
      console.log('sbSyncStage: stage_event OK');
    }
  })['catch'](function(err) {
    _sbPendingStageEvents.push(event);
    sbPersistStageQueue();
    sbShowError('Событие этапа отложено (сбой сети)', err);
  });
}

/* Вспомогательная функция (выносить в отдельный модуль error-toast) */
function sbShowError(msg, detail) {
  console.error('[sync error]', msg, detail);
  /* Вызывает UI-toast, если есть. Заглушка: window.uiToast? */
  if (typeof uiToast === 'function') {
    uiToast(msg, 'error');
  }
}
```

**Влияние на UX:**
- Пользователь видит toast «Событие отложено. Повтор при восстановлении связи». Не блокирует работу.
- При reconnect — тихий flush. Если всё ок — без уведомления. Если снова падает — агрегированный toast через 5 retry.
- Idempotency 3-секундный — защитит от двойных нажатий.

**Тестовый сценарий (RS-REG-01):**
1. Запустить Rate Setter online → `stage_events` получает 1 строку. `_sbPendingStageEvents` пустой.
2. Выключить сеть → запустить Rate Setter → `stage_events` 0 новых строк, `_sbPendingStageEvents` 1 событие (в localStorage).
3. Включить сеть → вызвать `sbFlushStageQueue()` → `stage_events` получает недостающую строку, очередь пустая.
4. Double-click «Запуск» → только один `stage_event` (idempotency).

---

## F-02 — Guard на пустой stems + валидация после clean

**Проблема:** `runRateSetter` проверяет только что textarea не пустой, но после `parse_stems_from_text + strip_tails` может получиться пустой set (все имена отфильтровались как невалидные). Пользователь получает `{updated: 0}` и думает «всё ок».

**Предложенный код (v2/frontend/js/sync.js):**

```javascript
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

    /* Доп. проверка: после очистки остаются ли непустые стемы */
    var previewStems = payload.text_list.split(/\n/)
      .map(function(l) { return l.trim().replace(/\.(jpe?g|tiff?|png|cr[23w]|nef|arw|raf|dng|psd|psb)$/i, ''); })
      .filter(function(l) { return l.length > 0; });

    if (previewStems.length === 0) {
      alert('После очистки имён список пустой. Проверьте, что вы вводите имена файлов, а не пути.');
      return;
    }

    /* Warning: если ожидалось N, а получилось < N/2 — предупредить */
    var originalLines = payload.text_list.split(/\n/).filter(function(l) { return l.trim().length > 0; });
    if (originalLines.length > 0 && previewStems.length < originalLines.length * 0.5) {
      if (!confirm('Из ' + originalLines.length + ' строк распознано только ' + previewStems.length + ' имён. Продолжить?')) {
        return;
      }
    }
  } else {
    payload.source_dir = document.getElementById('rs-source-dir').value;
    if (!payload.source_dir) { alert('Выберите папку-источник'); return; }
  }
  /* ...далее как было... */
}
```

И дополнительный guard в Python (v2/backend/core/services/rate_setter.py):

```python
def run(self, stems, session_root, log=None, dry_run=False):
    if log is None:
        log = print

    # Guard: пустой stems
    if not stems:
        log("ABORT пустой список имён — нечего синхронизировать")
        return {
            "updated": 0, "unchanged": 0, "missing": 0,
            "duplicates": 0, "errors": 0,
            "aborted": "empty_stems"
        }

    # Guard: session_root существует и содержит .cos
    if not session_root.exists() or not session_root.is_dir():
        log(f"ABORT папка сессии не найдена: {session_root}")
        return {"updated": 0, "unchanged": 0, "missing": 0,
                "duplicates": 0, "errors": 0,
                "aborted": "session_not_found"}

    # ...existing code...
```

И в AppAPI (`app_api.py`) пробросить `aborted` в UI:

```python
# В AppAPI.rate_setter_run, в конце task():
result = self.rate_setter.run(stems=stems, session_root=session_root, log=log)
if result.get("aborted"):
    self._emit("onRateSetterDone", {
        "error": f"Прервано: {result['aborted']}",
        **result
    })
else:
    self._emit("onRateSetterDone", result)
```

И в JS:

```javascript
window.onRateSetterDone = function(result) {
  document.getElementById('rs-run-btn').disabled = false;

  if (result.error) {
    document.getElementById('rs-log').innerHTML += '<span class="log-err">' + esc(result.error) + '</span>\n';
    /* Не вызывать rsSyncCompleted при ошибке */
    return;
  }

  /* Если reported updated=0 и unchanged=0 и missing>0 — это почти ошибка */
  if ((result.updated || 0) === 0 && (result.unchanged || 0) === 0) {
    document.getElementById('rs-log').innerHTML +=
      '<span class="log-err">Ничего не обновлено. Проверьте путь к сессии Capture One и список имён.</span>\n';
    return;
  }

  /* ...остальное как было... */
};
```

**Влияние на UX:**
- Фотограф получает явный алерт при пустом stems (а не success 0 updated).
- Warning при > 50% отсева — помогает поймать неверно скопированные имена.
- UI не даст «молча завершить» sync без эффекта.

**Тестовый сценарий (RS-REG-02):**
1. Textarea = `.` (одна точка) → alert «список пустой».
2. Textarea = `IMG_0001.jpg\n.\n\n` → previewStems = 1, originalLines = 1 → продолжаем.
3. Textarea = 100 строк, где 60 — пути (`/Users/.../IMG_0001.jpg`) → parse даст 40 валидных → confirm-диалог.
4. Python получает пустой set (edge case сжатия) → return aborted=empty_stems → UI показывает «Ничего не обновлено».

---

## F-03 — COS round-trip PoC (upload .cos после update_rating)

**Проблема (R-01):** `.cos` остаётся только на локальном диске фотографа; ретушёр не видит. KPI ставки 4 не закрывается.

**Архитектурное решение:**
- После `RateSetterService.run` — опциональный шаг upload в bucket `postprod`. Python читает финальные `.cos`, передаёт base64 в JS, JS вызывает `sbUploadPostprodFile` + `sbSavePhotoVersion`.
- Почему не напрямую из Python: `supabase-py` потребует дополнительной зависимости и service-role ключа. Из JS — используем уже аутентифицированный сеанс.
- `photo_versions.stage` для Rate Setter — `'color_correction'` с `version_num = iteration` (iter1 при первом прогоне, iter2 при delta и т.д.).

**Предложенный код (v2/backend/core/services/rate_setter.py):**

```python
class RateSetterService:
    def run(self, stems, session_root, log=None, dry_run=False,
            collect_changed_cos=False):
        """
        ...existing docstring...

        Args:
            collect_changed_cos: если True — возвращает список путей к
                .cos, которые были изменены (для последующего upload).
        """
        # ...existing init...
        changed_cos_paths = []

        for stem in sorted(stems):
            matches = cos_index.get(stem)
            if not matches:
                log(f"MISS {stem} — .cos не найден")
                missing += 1
                continue

            for cos_path in matches:
                try:
                    if dry_run:
                        log(f"DRY  {stem} -> {cos_path.name}")
                        updated += 1
                    else:
                        changed = repo.update_rating(cos_path, self.rating)
                        if changed:
                            log(f"OK   {stem} -> {cos_path.name} (Basic_Rating={self.rating})")
                            updated += 1
                            if collect_changed_cos:
                                changed_cos_paths.append(str(cos_path))
                        else:
                            log(f"SKIP {stem} -> {cos_path.name} (уже {self.rating})")
                            unchanged += 1
                except Exception as e:
                    log(f"ERR  {stem} -> {cos_path} ({e})")
                    errors += 1

        return {
            "updated": updated,
            "unchanged": unchanged,
            "missing": missing,
            "duplicates": duplicates,
            "errors": errors,
            "changed_cos_paths": changed_cos_paths if collect_changed_cos else [],
        }
```

**Предложенный код (v2/backend/core/api/app_api.py):**

```python
def rate_setter_run(self, payload):
    def task():
        # ...existing init and stems collection...

        def log(msg):
            self._emit("onRateSetterLog", msg)

        # New: collect_changed_cos=True — чтобы вернуть пути
        result = self.rate_setter.run(
            stems=stems,
            session_root=session_root,
            log=log,
            dry_run=payload.get("dry_run", False),
            collect_changed_cos=True,
        )

        # Опциональный upload: прочитать .cos, отправить base64 в UI для storage.upload
        if result.get("changed_cos_paths") and payload.get("upload_cos", True):
            cos_files = []
            for p in result["changed_cos_paths"][:500]:  # cap 500 per run
                try:
                    import base64
                    path = Path(p)
                    # photo_stem: IMG_0001.CR3.cos → stem "IMG_0001.CR3" → stem "IMG_0001"
                    photo_stem = Path(path.stem).stem
                    data = base64.b64encode(path.read_bytes()).decode('ascii')
                    cos_files.append({
                        "photo_stem": photo_stem,
                        "cos_filename": path.name,
                        "base64": data,
                    })
                except Exception as e:
                    log(f"WARN cannot read {p}: {e}")
            result["cos_files"] = cos_files

        self._emit("onRateSetterDone", result)

    threading.Thread(target=task, daemon=True).start()
    return {"status": "started"}
```

**Предложенный код (v2/frontend/js/sync.js, extend rsSyncCompleted):**

```javascript
function rsSyncCompleted(result) {
  var now = new Date();
  var timeStr = now.toLocaleDateString('ru-RU') + ' ' +
                now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  var note = 'CO Sync: ' + (result.updated || 0) + ' обновлено, ' +
             (result.unchanged || 0) + ' без изменений';

  /* 1. stage_event (как было) */
  if (typeof sbSyncStage === 'function') {
    sbSyncStage('co_sync_done', note);
  }

  /* 2. Snapshot (как было) */
  if (typeof snCreateSnapshot === 'function') {
    var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
    var stageId = 'preselect';
    if (proj && typeof PIPELINE_STAGES !== 'undefined') {
      var idx = proj._stage || 0;
      stageId = (PIPELINE_STAGES[idx] && PIPELINE_STAGES[idx].id) || 'preselect';
    }
    snCreateSnapshot(stageId, 'co_sync_done', note);
  }

  /* 3. NEW: upload .cos в postprod */
  if (result.cos_files && result.cos_files.length > 0) {
    rsUploadCosFiles(result.cos_files, result);
  }
}

/**
 * Загрузить пачку .cos в bucket postprod и создать photo_versions.
 * Sequential, чтобы не превысить rate-limit Supabase Storage.
 */
function rsUploadCosFiles(cosFiles, result) {
  var proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  if (!proj || !proj._cloudId) {
    console.warn('rsUploadCosFiles: проект не синхронизирован с облаком');
    return;
  }

  var projectId = proj._cloudId;
  var iterNum = (typeof rsGetIterationNumber === 'function') ? rsGetIterationNumber() : 1;
  var uploaded = 0;
  var failed = 0;

  var logEl = document.getElementById('rs-log');
  var progressMsg = function(msg, cls) {
    if (logEl) {
      logEl.innerHTML += '<span class="' + (cls || 'log-ok') + '">' + esc(msg) + '</span>\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
  };

  function uploadNext(i) {
    if (i >= cosFiles.length) {
      progressMsg('Upload complete: ' + uploaded + ' ok, ' + failed + ' failed',
                  failed > 0 ? 'log-err' : 'log-ok');
      return;
    }

    var cf = cosFiles[i];
    /* Sanitize stem for path (F-04) */
    var stemSafe = (typeof sbSanitizeStorageKey === 'function')
      ? sbSanitizeStorageKey(cf.photo_stem)
      : cf.photo_stem;
    var storagePath = projectId + '/' + stemSafe +
                      '/color_correction_' + iterNum + '.cos';

    sbUploadPostprodFile(storagePath, cf.base64, 'application/octet-stream',
      function(err, publicUrl) {
        if (err) {
          failed++;
          progressMsg('UPLOAD ERR ' + cf.cos_filename + ' ' + err, 'log-err');
          uploadNext(i + 1);
          return;
        }

        /* Создать/обновить photo_version */
        sbSavePhotoVersion({
          project_id: projectId,
          photo_name: cf.photo_stem,  /* оригинал без sanitize — как в DB */
          stage: 'color_correction',
          version_num: iterNum,
          preview_path: '',
          cos_path: storagePath,
        }, function(err2) {
          if (err2) {
            failed++;
            progressMsg('SAVE VER ERR ' + cf.cos_filename + ' ' + err2, 'log-err');
          } else {
            uploaded++;
          }
          uploadNext(i + 1);
        });
      });
  }

  progressMsg('Upload .cos files: ' + cosFiles.length + ' (iter ' + iterNum + ')');
  uploadNext(0);
}
```

**Влияние на UX:**
- После локального run пользователь видит дополнительные строки `Upload complete: 500 ok`.
- Время выполнения растёт (upload ≈ 1-2 сек на файл → 500 файлов ≈ 10 мин).
- Ретушёр, открывая проект по share-link, видит `photo_versions` с `cos_path` — может скачать через `sbUploadPostprodFile` counterparts.

**Тестовый сценарий (RS-REG-03):**
1. Проект с 10 фото, Rate Setter с `upload_cos=true` → `photo_versions` содержит 10 строк со stage='color_correction', version_num=1, cos_path=непустой.
2. Повторный run (дельта на 3 фото) → 3 новые строки с version_num=2.
3. Ретушёр по share-link: `sbLoadPhotoVersions(projectId)` возвращает строки → UI показывает рейтинги.
4. Network fail на 5-м файле из 10 → uploaded=4, failed=5 (остальные скипнуты), UI показывает «5 failed».

**Зависимости:**
- **OQ-RS-01** — bucket `postprod` создан, Policies для owner-upload.
- **Audit R1** — `photo_versions` миграция в prod.

---

## F-04 — ASCII sanitize в `sbUploadPostprodFile`

**Проблема (R-05):** Если Rate Setter запущен на проекте с cyrillic `photo_name` ([test user A] на [anchor client]), upload упадёт с `400 InvalidKey`.

**Предложенный код (v2/frontend/js/supabase.js, перед `sbUploadPostprodFile`):**

```javascript
function sbUploadPostprodFile(storagePath, base64Data, contentType, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  /* NEW: validate path ASCII before upload */
  if (!_isAsciiSafePath(storagePath)) {
    var sanitized = _sanitizePath(storagePath);
    console.warn('sbUploadPostprodFile: ASCII-sanitize ' + storagePath + ' → ' + sanitized);
    storagePath = sanitized;
  }

  /* ... остальное как было ... */
}

function _isAsciiSafePath(p) {
  /* a-z A-Z 0-9 . _ - / — допустимый набор для Storage key */
  return /^[A-Za-z0-9._/-]+$/.test(p);
}

function _sanitizePath(p) {
  /* Поэлементно: транслит + замена */
  return p.split('/').map(function(seg) {
    if (typeof sbSanitizeStorageKey === 'function') {
      return sbSanitizeStorageKey(seg);
    }
    /* fallback */
    return seg.replace(/[^A-Za-z0-9._-]/g, '_');
  }).join('/');
}
```

**Влияние на UX:**
- Прозрачно для пользователя. Console.warn в dev-mode.
- DB `photo_versions.photo_name` — остаётся с cyrillic (lookups UI работают).
- Bucket path — только ASCII (Storage не ругается).

**Тестовый сценарий (RS-REG-04):**
1. Проект с `photo_name = "Солнце_17774.CR3"` → sanitize даёт `Solntse_17774.CR3` (или `_17774.CR3` в минимальном варианте) → upload проходит.
2. `photo_versions.photo_name` = `Солнце_17774.CR3` (оригинал).
3. `photo_versions.cos_path` = `{uuid}/Solntse_17774.CR3/color_correction_1.cos`.
4. UI при загрузке рисует cyrillic-имя и скачивает по ASCII пути → ок.

---

## F-05 — `sbSyncStage` + `snCreateSnapshot` как одна RPC-транзакция

**Проблема (R-02 продолжение):** Сейчас это 3 независимых SQL-операции (UPDATE projects, INSERT stage_events, INSERT snapshots). Если вторая падает — state неконсистентен.

**Предложенный SQL (v2/supabase/031_rpc_sync_stage_atomic.sql, NEW FILE, не выполнять автоматически):**

```sql
-- Атомарная запись stage + event + snapshot в одной транзакции.
-- Вызывается из JS вместо трёх отдельных операций.

CREATE OR REPLACE FUNCTION public.sync_stage_atomic(
  p_project_id   uuid,
  p_stage        int,
  p_stage_id     text,
  p_trigger_desc text,
  p_note         text,
  p_snapshot_data jsonb DEFAULT NULL  -- если передан — создаётся snapshot
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_event_id uuid;
  v_snapshot_id uuid;
BEGIN
  -- 1. Update stage
  UPDATE projects
    SET stage = p_stage,
        updated_at = now()
    WHERE id = p_project_id
      AND owner_id = auth.uid();   -- RLS проверка

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % not found or not owned by current user', p_project_id;
  END IF;

  -- 2. Insert stage_event
  INSERT INTO stage_events (project_id, stage_id, trigger_desc, note, created_at)
  VALUES (p_project_id, p_stage_id, p_trigger_desc, p_note, now())
  RETURNING id INTO v_event_id;

  -- 3. Insert snapshot (опционально)
  IF p_snapshot_data IS NOT NULL THEN
    INSERT INTO snapshots (project_id, stage_id, trigger, note, data, created_at)
    VALUES (p_project_id, p_stage_id, p_trigger_desc, p_note, p_snapshot_data, now())
    RETURNING id INTO v_snapshot_id;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'snapshot_id', v_snapshot_id
  );
END;
$$;

-- Grant для аутентифицированных
GRANT EXECUTE ON FUNCTION public.sync_stage_atomic TO authenticated;
```

**JS side (v2/frontend/js/supabase.js):**

```javascript
function sbSyncStageAtomic(triggerDesc, note, snapshotData) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return Promise.resolve();
  if (!sbClient || !sbIsLoggedIn()) return Promise.resolve();

  var stage = proj._stage || 0;
  var stageIds = ['preselect', 'selection', 'client', 'color', 'retouch_task', 'retouch', 'retouch_ok', 'adaptation'];
  var completedIdx = stage > 0 ? stage - 1 : 0;
  var stageId = stageIds[completedIdx] || ('stage_' + completedIdx);

  return sbClient.rpc('sync_stage_atomic', {
    p_project_id: proj._cloudId,
    p_stage: stage,
    p_stage_id: stageId,
    p_trigger_desc: triggerDesc || null,
    p_note: note || null,
    p_snapshot_data: snapshotData || null
  }).then(function(res) {
    if (res.error) {
      console.warn('sbSyncStageAtomic:', res.error.message);
      /* В pending-queue (F-01) */
      _sbPendingStageEvents.push({
        rpc: 'sync_stage_atomic',
        args: { p_project_id: proj._cloudId, ... }
      });
      sbPersistStageQueue();
    }
    return res;
  });
}
```

**Влияние:**
- Если одна из 3 операций падает — все откатываются (транзакция).
- Race conditions между UPDATE и INSERT исключены.
- Retry становится безопасным (идемпотентность отдельный вопрос — нужно добавить client_event_id UUID в payload и проверять в SQL).

**Тестовый сценарий (RS-REG-05):**
1. Happy path: RPC возвращает `{event_id, snapshot_id}` — обе строки записаны.
2. Если юзер не owner — RPC exception, ни одной строки не записано.
3. Если `stage_events` INSERT падает (невозможно при RLS `authenticated`-роли) — `projects.stage` не обновлён (rollback).

---

## F-06 — Fresh-snapshot refresh в `rsFillDeltaFromLatest`

**Проблема (R-03):** Кэш `_snCachedSnapshots` может быть стейлым, дельта вычислится неверно.

**Предложенный код (v2/frontend/js/sync.js):**

```javascript
function rsFillDeltaFromLatest() {
  /* Всегда принудительно обновить snapshots перед delta */
  if (typeof snLoadSnapshots === 'function') {
    snLoadSnapshots(function(err, snaps) {
      if (err) {
        /* Если не получилось — предложить пользователю явное решение */
        var useCache = confirm(
          'Не удалось загрузить снимки с сервера (' + err + ').\n' +
          'Использовать локальный кэш? (Данные могут быть устаревшими)'
        );
        if (!useCache) return;
      } else {
        _snCachedSnapshots = snaps || [];
      }
      _rsFillDeltaFromCache();
    });
  } else {
    alert('Снимки недоступны. Синхронизируйте проект с облаком.');
  }
}
```

**Тестовый сценарий (RS-REG-06):**
1. Local cache содержит 2 снимка. В облаке 3 (новый создан с другого девайса). Пользователь жмёт «Только изменения».
2. `snLoadSnapshots` возвращает 3 → кэш обновлён → delta вычислена относительно последнего снимка.
3. Если network fail → диалог «использовать старый кэш?».

---

## F-07 — Versioned `.cos.bak` с timestamp

**Проблема (R-06):** `.cos.bak` пишется только один раз и не помогает откатиться после второго прогона.

**Предложенный код (v2/backend/core/infra/cos_repository.py):**

```python
def update_rating(self, cos_path: Path, rating: str, backup: bool = True) -> bool:
    data = cos_path.read_bytes()
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise RuntimeError(f"XML parse error in {cos_path}: {e}") from e

    changed = False
    found = False
    for elem in root.iter("E"):
        if elem.get("K") == "Basic_Rating":
            found = True
            if elem.get("V") != rating:
                elem.set("V", rating)
                changed = True
    if not found:
        dl = root.find(".//DL")
        if dl is None:
            raise RuntimeError(f"Не найден тег <DL> в {cos_path}")
        dl.insert(0, ET.Element("E", {"K": "Basic_Rating", "V": rating}))
        changed = True

    if changed:
        if backup:
            # CHANGED: versioned backup в папке .maket_backups рядом с сессией
            import time
            ts = int(time.time())
            bak_dir = cos_path.parent / ".maket_backups"
            bak_dir.mkdir(exist_ok=True)
            bak_file = bak_dir / f"{cos_path.name}.{ts}.bak"
            bak_file.write_bytes(data)

            # Cleanup: оставить только 10 последних бэкапов для этого файла
            self._rotate_backups(bak_dir, cos_path.name, keep=10)

        cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))

    return changed

def _rotate_backups(self, bak_dir: Path, cos_filename: str, keep: int = 10):
    """Оставить только `keep` последних бэкапов для файла."""
    pattern = f"{cos_filename}.*.bak"
    backups = sorted(bak_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[keep:]:
        try:
            old.unlink()
        except Exception:
            pass
```

**Тестовый сценарий (RS-REG-07):**
1. Rate Setter прогонит 1 раз → `.maket_backups/IMG_0001.CR3.cos.1714000000.bak` (оригинал без рейтинга).
2. Rate Setter прогонит второй раз с другим рейтингом → `.maket_backups/IMG_0001.CR3.cos.1714003600.bak` (версия 5).
3. 11-й прогон → самый старый бэкап удалён.
4. Rollback вручную: `cp .maket_backups/IMG_0001.CR3.cos.1714000000.bak IMG_0001.CR3.cos`.

---

## F-08 — Optimistic lock на `sbSelectPhotoVersion`

**Проблема (R-03):** Two-phase update без lock. Параллельные выборки могут оставить две версии selected=true.

**Предложенный SQL (v2/supabase/032_rpc_select_photo_version_atomic.sql, NEW FILE):**

```sql
CREATE OR REPLACE FUNCTION public.select_photo_version_atomic(
  p_version_id uuid,
  p_project_id uuid,
  p_photo_name text,
  p_stage      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_selected_before uuid;
BEGIN
  -- Lock row для записи (advisory), чтобы другой клиент ждал
  PERFORM pg_advisory_xact_lock(hashtext(p_project_id::text || p_photo_name || p_stage));

  -- Reset all selected
  UPDATE photo_versions
    SET selected = false
    WHERE project_id = p_project_id
      AND photo_name = p_photo_name
      AND stage = p_stage
    RETURNING id INTO v_selected_before;  -- для diagnostics (берёт любую)

  -- Set target
  UPDATE photo_versions
    SET selected = true
    WHERE id = p_version_id
      AND project_id = p_project_id   -- belt-and-suspenders RLS
    ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % not found in project %', p_version_id, p_project_id;
  END IF;

  RETURN jsonb_build_object(
    'selected_id', p_version_id,
    'previous_id', v_selected_before
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.select_photo_version_atomic TO authenticated, anon;
```

**JS side:**

```javascript
function sbSelectPhotoVersion(versionId, projectId, photoName, stage, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.rpc('select_photo_version_atomic', {
    p_version_id: versionId,
    p_project_id: projectId,
    p_photo_name: photoName,
    p_stage: stage
  }).then(function(res) {
    if (res.error) {
      console.warn('sbSelectPhotoVersion:', res.error.message);
      callback(res.error.message);
      return;
    }
    callback(null, res.data);
  })['catch'](function(err) {
    callback(String(err));
  });
}
```

**Тестовый сценарий (RS-REG-08):** см. RS-REG-11 в плане регрессии (concurrent select).

---

## F-09 — Supabase `error_log` таблица

**Проблема:** Ошибки теряются в console.warn. Отладка на проде невозможна.

**Предложенный SQL (кратко):**

```sql
CREATE TABLE IF NOT EXISTS error_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  module text NOT NULL,           -- 'rate_setter', 'sync', ...
  severity text NOT NULL CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  message text,
  context jsonb,
  client_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_log_module ON error_log (module, created_at DESC);
ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY error_log_insert_own ON error_log
  FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY error_log_select_owner ON error_log
  FOR SELECT
  USING (user_id = auth.uid());
```

**JS side:**

```javascript
function sbLogError(module, severity, message, context) {
  if (!sbClient) return;
  sbClient.from('error_log').insert({
    user_id: sbClient.auth.user() ? sbClient.auth.user().id : null,
    project_id: (getActiveProject() && getActiveProject()._cloudId) || null,
    module: module,
    severity: severity,
    message: String(message).slice(0, 2000),
    context: context || null,
    client_timestamp: new Date().toISOString()
  }).then(function() {}, function() {}); /* best-effort, не блокирует UI */
}
```

Влияние: Маша может смотреть `error_log` из Supabase Studio после инцидента.

---

## F-10 — Rate Setter пишет keywords в `.cos`

**Проблема (отдельный трек):** Ставка 4 требует, чтобы ключевые слова (артикул, название карточки, stage) попадали в `.cos`. Сейчас `update_rating` пишет только `Basic_Rating`. См. `audit-2026-04-23.md:34`.

**Предложенный код (v2/backend/core/infra/cos_repository.py):**

```python
def update_keywords(self, cos_path: Path, keywords: list[str], backup: bool = True) -> bool:
    """Обновить <Keywords> в .cos файле (union existing + new).

    Capture One хранит ключевые слова в теге <K> внутри <KeywordsContainer>.
    Формат: <K N="KeywordName" S="KeywordSet"/>.
    """
    data = cos_path.read_bytes()
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise RuntimeError(f"XML parse error in {cos_path}: {e}") from e

    # Точный тег/аттрибут уточнить по референсу (Capture One session dump)
    # Ниже — эскизный паттерн. До merge проверить на реальном .cos.
    container = root.find(".//KeywordsContainer")
    if container is None:
        dl = root.find(".//DL")
        if dl is None:
            raise RuntimeError(f"Не найден тег <DL> в {cos_path}")
        container = ET.SubElement(dl, "KeywordsContainer")

    existing = {k.get("N") for k in container.findall("K")}
    changed = False
    for kw in keywords:
        if kw and kw not in existing:
            ET.SubElement(container, "K", {"N": kw, "S": "MaketCP"})
            changed = True

    if changed:
        if backup:
            # использовать versioned backup (F-07)
            ...
        cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))

    return changed
```

И соответствующее расширение `RateSetterService.run(..., keywords_by_stem={})`.

**Зависимости:** OQ-RS-04 (нужен реальный референс XML от Capture One — PA не может угадать точный тег).

---

## Параллельность и последовательность

**Можно делать параллельно:**
- F-01, F-02 — JS-only, не трогают БД.
- F-06 — JS-only.
- F-07 — Python-only, не трогает облако.

**Последовательная ветка (зависит от photo_versions миграции и bucket postprod):**
1. Audit R1 (photo_versions в 030_*.sql) → OQ-RS-02 закрыт.
2. OQ-RS-01 closed (bucket + policies).
3. F-03 (round-trip PoC).
4. F-04 (sanitize) — одновременно с F-03.
5. F-05 (RPC-транзакция).
6. F-08 (atomic select).

**Отдельная ветка:**
- F-10 — требует референса Capture One XML, не пересекается с round-trip.
- F-09 — инфраструктура, можно сделать до всех остальных.

---

## Связь с audit-2026-04-23

| Рекомендация audit | Что из proposal | Статус |
|---|---|---|
| R1 (photo_versions миграция) | блокер для F-03, F-05, F-08 | TODO в PA, deadline 2026-04-30 |
| R5 (Rate Setter COS round-trip) | = F-03 + F-04 + F-05 | пакет готов |
| R3 (feature flags) | использовать для rollout F-03 | optional |
| R4 (smoke test suite) | см. `rate-setter-sync-regression.md` + Playwright skeleton | готово |

---

**Следующий шаг:** Masha review → approval по импактным F-01, F-02, F-03 → создание ADR-003 (COS round-trip), уточнение F-10 через референс Capture One.
