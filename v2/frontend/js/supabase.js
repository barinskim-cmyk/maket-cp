/* ══════════════════════════════════════════════
   supabase.js — Клиент Supabase для Maket CP
   ══════════════════════════════════════════════

   Зависит от: state.js (App, getActiveProject)
   CDN: подключается через <script> в index.html

   Модуль инициализирует Supabase-клиент и предоставляет
   функции для аутентификации, синхронизации проектов,
   управления ссылками доступа.

   Конфигурация:
     SB_URL  — Project URL из Supabase Dashboard
     SB_ANON — anon public key из Supabase Dashboard

   Эти значения задаются один раз при настройке.
   В продакшене — хардкод (anon key безопасен для клиента).

   Функции с префиксом sb* — публичный API модуля.
*/

// ── Конфигурация (заполнить после создания проекта в Supabase) ──

/** @type {string} Supabase Project URL */
var SB_URL = 'https://mukiyeuxulasvtlpckjf.supabase.co';

/** @type {string} Supabase anon public key (JWT — используется SDK) */
var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11a2l5ZXV4dWxhc3Z0bHBja2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTMyMjEsImV4cCI6MjA5MDI4OTIyMX0.zYB28Pn4u6zSNP2ZbF7WLz0JeaGwH7LQhRwmw1-niPc';

/** @type {object|null} Supabase client instance */
var sbClient = null;

/** @type {object|null} Текущий авторизованный пользователь */
var sbUser = null;

/** @type {string} localStorage key для хранения конфига */
var SB_CONFIG_KEY = 'maketcp_sb_config';


// ══════════════════════════════════════════════
//  Инициализация
// ══════════════════════════════════════════════

/**
 * Инициализировать Supabase-клиент.
 * Читает конфиг из localStorage (если задан) или из констант выше.
 * Вызывается при загрузке страницы.
 * @returns {boolean} true если клиент создан
 */
function sbInit() {
  // Попробовать загрузить конфиг из localStorage
  try {
    var saved = localStorage.getItem(SB_CONFIG_KEY);
    if (saved) {
      var cfg = JSON.parse(saved);
      if (cfg.url) SB_URL = cfg.url;
      if (cfg.anon) SB_ANON = cfg.anon;
    }
  } catch(e) {}

  if (!SB_URL || !SB_ANON) {
    console.log('supabase.js: SB_URL / SB_ANON не заданы — облачная синхронизация отключена');
    return false;
  }

  // Проверяем что Supabase SDK загружен
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('supabase.js: Supabase SDK не загружен. Добавьте <script> в HTML.');
    return false;
  }

  sbClient = supabase.createClient(SB_URL, SB_ANON);

  // Проверяем текущую сессию
  sbClient.auth.getSession().then(function(res) {
    if (res.data && res.data.session) {
      sbUser = res.data.session.user;
      sbOnAuthChange('SIGNED_IN', res.data.session);
    }
  });

  // Слушаем изменения аутентификации
  sbClient.auth.onAuthStateChange(function(event, session) {
    sbOnAuthChange(event, session);
  });

  console.log('supabase.js: клиент инициализирован');
  return true;
}

/**
 * Сохранить конфиг Supabase (URL + anon key) в localStorage.
 * Вызывается из настроек приложения.
 * @param {string} url
 * @param {string} anon
 */
function sbSaveConfig(url, anon) {
  SB_URL = url;
  SB_ANON = anon;
  try {
    localStorage.setItem(SB_CONFIG_KEY, JSON.stringify({ url: url, anon: anon }));
  } catch(e) {}
  sbInit();
}

/**
 * Проверить подключён ли Supabase.
 * @returns {boolean}
 */
function sbIsConnected() {
  return !!(sbClient && SB_URL && SB_ANON);
}

/**
 * Проверить авторизован ли пользователь.
 * @returns {boolean}
 */
function sbIsLoggedIn() {
  return !!(sbClient && sbUser);
}


// ══════════════════════════════════════════════
//  Аутентификация
// ══════════════════════════════════════════════

/**
 * Войти по email через Magic Link (без пароля).
 * Supabase отправляет email со ссылкой для входа.
 * @param {string} email
 * @param {function} [callback] — callback(error)
 */
function sbLoginMagicLink(email, callback) {
  if (!sbClient) { if (callback) callback('Supabase не подключён'); return; }

  sbClient.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  }).then(function(res) {
    if (res.error) {
      if (callback) callback(res.error.message);
    } else {
      if (callback) callback(null);
    }
  });
}

/**
 * Войти по email + пароль (для фотографа на десктопе).
 * @param {string} email
 * @param {string} password
 * @param {function} callback — callback(error, user)
 */
function sbLoginPassword(email, password, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.auth.signInWithPassword({
    email: email,
    password: password
  }).then(function(res) {
    if (res.error) callback(res.error.message, null);
    else callback(null, res.data.user);
  });
}

/**
 * Зарегистрировать нового пользователя (email + пароль).
 * @param {string} email
 * @param {string} password
 * @param {string} name
 * @param {function} callback — callback(error, user)
 */
function sbSignup(email, password, name, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.auth.signUp({
    email: email,
    password: password,
    options: { data: { name: name } }
  }).then(function(res) {
    if (res.error) callback(res.error.message, null);
    else callback(null, res.data.user);
  });
}

/**
 * Выйти из аккаунта.
 * @param {function} [callback]
 */
function sbLogout(callback) {
  if (!sbClient) { if (callback) callback(); return; }
  sbClient.auth.signOut().then(function() {
    sbUser = null;
    if (callback) callback();
  });
}

/**
 * Обработчик изменения состояния аутентификации.
 * Обновляет UI (кнопки входа/выхода, статус синхронизации).
 * @param {string} event — 'SIGNED_IN', 'SIGNED_OUT', etc.
 * @param {object} session
 */
function sbOnAuthChange(event, session) {
  if (event === 'SIGNED_IN' && session) {
    sbUser = session.user;
    console.log('supabase.js: Вошли как', sbUser.email);
    /* Разблокировать приложение */
    if (typeof authUnlock === 'function') authUnlock();
  } else if (event === 'SIGNED_OUT') {
    sbUser = null;
    console.log('supabase.js: Вышли');
    /* Заблокировать приложение (только в браузере) */
    if (typeof authLock === 'function' && !(window.pywebview && window.pywebview.api)) {
      authLock();
    }
  }
  // Обновляем UI если функция есть
  if (typeof sbUpdateUI === 'function') sbUpdateUI();
}


// ══════════════════════════════════════════════
//  Синхронизация проектов: Desktop → Cloud
// ══════════════════════════════════════════════

/**
 * Загрузить проект в облако (создать или обновить).
 * Конвертирует локальный формат App.projects[idx] в таблицы Supabase.
 *
 * @param {number} projIdx — индекс проекта в App.projects
 * @param {function} callback — callback(error, cloudProjectId)
 */
function sbUploadProject(projIdx, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  var proj = App.projects[projIdx];
  if (!proj) { callback('Проект не найден'); return; }

  var cloudId = proj._cloudId || null;

  // Формируем данные проекта
  /* Собрать имена файлов доп. контента (без base64) */
  var ocNames = (proj.otherContent || []).map(function(oc) { return oc.name; });
  /* Контейнеры: сохраняем id, name и имена файлов (без base64) */
  var ocContainersData = (proj.ocContainers || []).map(function(cnt) {
    return { id: cnt.id, name: cnt.name, items: (cnt.items || []).map(function(it) { return it.name; }) };
  });

  var projData = {
    owner_id: sbUser.id,
    brand: proj.brand || '',
    shoot_date: proj.shoot_date || proj.shootDate || '',
    template_id: proj.templateId || '',
    template_config: proj._template || null,
    stage: proj._stage || proj.stage || 0,
    channels: JSON.stringify(proj.channels || []),
    other_content: JSON.stringify(ocNames),
    oc_containers: JSON.stringify(ocContainersData),
    updated_at: new Date().toISOString()
  };

  /**
   * Если _cloudId нет — ищем существующий проект по brand + shoot_date,
   * чтобы не создавать дубли при повторной загрузке.
   */
  function doUpload(existingId) {
    var upsertProject;
    if (existingId) {
      upsertProject = sbClient.from('projects').update(projData).eq('id', existingId).select().single();
    } else {
      upsertProject = sbClient.from('projects').insert(projData).select().single();
    }

    upsertProject.then(function(res) {
      if (res.error) { callback('Ошибка проекта: ' + res.error.message); return; }

      var savedProj = res.data;
      proj._cloudId = savedProj.id;

      // Загружаем карточки
      sbUploadCards(savedProj.id, proj.cards || [], function(err) {
        if (err) { callback(err); return; }

        // Загружаем превью-галерею
        sbUploadPreviews(savedProj.id, proj.previews || [], function(err2) {
          if (err2) console.warn('sbUploadPreviews:', err2);
          callback(null, savedProj.id);
        });
      });
    });
  }

  if (cloudId) {
    /* cloudId известен — обновляем существующий */
    doUpload(cloudId);
  } else {
    /* cloudId нет — ищем проект по brand + shoot_date у текущего пользователя */
    var brand = proj.brand || '';
    var shootDate = proj.shoot_date || proj.shootDate || '';
    sbClient.from('projects')
      .select('id')
      .eq('owner_id', sbUser.id)
      .eq('brand', brand)
      .eq('shoot_date', shootDate)
      .order('updated_at', { ascending: false })
      .limit(1)
      .then(function(findRes) {
        if (findRes.data && findRes.data.length > 0) {
          var foundId = findRes.data[0].id;
          console.log('supabase.js: найден существующий проект', brand, '->', foundId);
          doUpload(foundId);
        } else {
          doUpload(null);
        }
      });
  }
}

/**
 * Загрузить карточки проекта в облако.
 * Стратегия: удалить старые → загрузить миниатюры в Storage → вставить новые.
 *
 * @param {string} projectId — UUID проекта в Supabase
 * @param {Array} cards — массив карточек из локального проекта
 * @param {function} callback — callback(error)
 */
function sbUploadCards(projectId, cards, callback) {
  /* Сначала сохраняем существующие thumb_path чтобы не потерять их */
  sbClient.from('slots').select('file_name, thumb_path').eq('project_id', projectId).then(function(existRes) {
    var thumbMap = {};
    (existRes.data || []).forEach(function(r) {
      if (r.file_name && r.thumb_path) thumbMap[r.file_name] = r.thumb_path;
    });

    // Удаляем старые карточки (каскадно удалит слоты)
    sbClient.from('cards').delete().eq('project_id', projectId).then(function(delRes) {
      if (delRes.error) { callback('Ошибка удаления карточек: ' + delRes.error.message); return; }

      if (!cards || cards.length === 0) { callback(null); return; }

      // Подготовка строк cards + slots
      var cardRows = [];
      var slotRows = [];
      /** @type {Array<{slotIdx: number, dataUrl: string, fileName: string}>} */
      var uploadsNeeded = [];

      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        /* Генерируем новый UUID чтобы избежать конфликта PK при перезаписи */
        var cardId = crypto.randomUUID ? crypto.randomUUID() : ('card_' + projectId.slice(0,8) + '_' + c + '_' + Date.now());

        cardRows.push({
          id: cardId,
          project_id: projectId,
          position: c,
          name: card.name || null,
          status: card.status || 'draft',
          has_hero: card._hasHero !== undefined ? card._hasHero : true,
          h_aspect: card._hAspect || '3/2',
          v_aspect: card._vAspect || '2/3',
          lock_rows: card._lockRows || false
        });

        if (card.slots) {
          for (var s = 0; s < card.slots.length; s++) {
            var slot = card.slots[s];
            var slotIdx = slotRows.length;
            var fileName = slot.file || ('slot_' + c + '_' + s + '.jpg');

            /* Сохраняем существующий thumb_path если есть, или URL из dataUrl */
            var existingThumb = thumbMap[fileName] || null;
            var dataUrl = slot.dataUrl || slot.thumbUrl || slot.thumb || null;

            /* Если dataUrl — это уже URL из Storage, используем как thumb_path */
            if (!existingThumb && dataUrl && dataUrl.indexOf('http') === 0) {
              existingThumb = dataUrl;
            }

            slotRows.push({
              card_id: cardId,
              project_id: projectId,
              position: s,
              orient: slot.orient || 'v',
              weight: slot.weight || 1,
              row_num: (slot.row !== undefined) ? slot.row : null,
              rotation: slot.rotation || 0,
              file_name: fileName,
              thumb_path: existingThumb,
              original_path: null
            });

            /* Собираем слоты с base64 картинками для загрузки в Storage */
            if (dataUrl && dataUrl.indexOf('data:') === 0) {
              uploadsNeeded.push({ slotIdx: slotIdx, dataUrl: dataUrl, fileName: fileName });
            }
          }
        }
      }

      /* Загружаем миниатюры в Supabase Storage, затем вставляем записи */
      _sbUploadSlotImages(projectId, slotRows, uploadsNeeded, function() {
        // Вставляем карточки
        sbClient.from('cards').insert(cardRows).then(function(cardRes) {
          if (cardRes.error) { callback('Ошибка карточек: ' + cardRes.error.message); return; }

          if (slotRows.length === 0) { callback(null); return; }

          // Вставляем слоты (thumb_path уже заполнен после загрузки)
          sbClient.from('slots').insert(slotRows).then(function(slotRes) {
            if (slotRes.error) { callback('Ошибка слотов: ' + slotRes.error.message); return; }
            callback(null);
          });
        });
      });
    });
  });
}

/**
 * Загрузить миниатюры слотов в Supabase Storage (параллельно).
 * По завершении заполняет slotRows[i].thumb_path публичным URL.
 *
 * @param {string} projectId
 * @param {Array} slotRows — массив строк для вставки в таблицу slots
 * @param {Array} uploads — [{slotIdx, dataUrl, fileName}]
 * @param {function} done — callback() без аргументов, вызывается после всех загрузок
 */
function _sbUploadSlotImages(projectId, slotRows, uploads, done) {
  if (!uploads || uploads.length === 0) { done(); return; }

  var BATCH = 5;
  var idx = 0;
  console.log('supabase.js: загрузка ' + uploads.length + ' миниатюр слотов в Storage...');

  function nextBatch() {
    if (idx >= uploads.length) { done(); return; }

    var end = Math.min(idx + BATCH, uploads.length);
    var batchCount = end - idx;
    var batchDone = 0;

    for (var i = idx; i < end; i++) {
      (function(upload) {
        sbUploadThumb(projectId, upload.fileName, upload.dataUrl, function(err, publicUrl) {
          if (!err && publicUrl) {
            slotRows[upload.slotIdx].thumb_path = publicUrl;
          } else {
            console.warn('supabase.js: не удалось загрузить', upload.fileName, err);
          }
          batchDone++;
          if (batchDone >= batchCount) nextBatch();
        });
      })(uploads[i]);
    }

    idx = end;
  }

  nextBatch();
}


// ══════════════════════════════════════════════
//  Загрузка превью-галереи в облако
// ══════════════════════════════════════════════

/**
 * Загрузить все превью проекта в облако:
 * 1) Удалить старые записи из таблицы previews
 * 2) Загрузить миниатюры (thumb) в Supabase Storage
 * 3) Вставить метаданные в таблицу previews
 *
 * @param {string} projectId — UUID проекта
 * @param {Array} previews — массив превью [{name, thumb, preview, rating, orient, ...}]
 * @param {function} callback — callback(error)
 */
/**
 * Синхронизировать превью проекта с облаком (инкрементально).
 * Сравнивает локальные превью с уже загруженными по file_name.
 * Загружает только новые, не дублирует существующие.
 *
 * @param {string} projectId — UUID проекта
 * @param {Array} previews — массив превью [{name, thumb, preview, rating, orient, ...}]
 * @param {function} callback — callback(error)
 */
function sbUploadPreviews(projectId, previews, callback) {
  if (!previews || previews.length === 0) { callback(null); return; }

  /* Шаг 1: получить список уже загруженных превью по file_name */
  sbClient.from('previews')
    .select('file_name')
    .eq('project_id', projectId)
    .then(function(existRes) {
      if (existRes.error) { callback('Ошибка чтения превью: ' + existRes.error.message); return; }

      /* Множество уже существующих имён */
      var existingNames = {};
      (existRes.data || []).forEach(function(r) { existingNames[r.file_name] = true; });

      /* Фильтруем: только новые превью */
      var newPreviews = [];
      for (var i = 0; i < previews.length; i++) {
        if (!existingNames[previews[i].name]) {
          newPreviews.push({ pv: previews[i], position: i });
        }
      }

      if (newPreviews.length === 0) {
        console.log('supabase.js: все ' + previews.length + ' превью уже в облаке, пропускаем');
        callback(null);
        return;
      }

      console.log('supabase.js: ' + newPreviews.length + ' новых превью из ' + previews.length + ' (пакетами по 5)...');

      /* Шаг 2: загружаем только новые */
      var rows = [];
      var BATCH = 5;
      var idx = 0;

      function nextBatch() {
        if (idx >= newPreviews.length) {
          console.log('supabase.js: загружено ' + rows.length + ' новых превью');
          _sbInsertPreviewRows(rows, callback);
          return;
        }

        var end = Math.min(idx + BATCH, newPreviews.length);
        var batchCount = end - idx;
        var batchDone = 0;

        for (var i = idx; i < end; i++) {
          (function(item) {
            var pv = item.pv;
            var thumbData = pv.thumb || '';
            var previewData = pv.preview || '';

            if (thumbData && thumbData.indexOf('data:') === 0) {
              /* Загрузить 300px thumb */
              sbUploadThumb(projectId, 'pv_' + pv.name, thumbData, function(err, thumbUrl) {
                /* Загрузить 1200px preview (если есть) */
                if (previewData && previewData.indexOf('data:') === 0) {
                  sbUploadThumb(projectId, 'full_' + pv.name, previewData, function(err2, previewUrl) {
                    rows.push({
                      project_id: projectId,
                      file_name: pv.name,
                      thumb_path: thumbUrl || null,
                      preview_path: previewUrl || null,
                      rating: pv.rating || 0,
                      orient: pv.orient || 'v',
                      position: item.position
                    });
                    batchDone++;
                    if (batchDone >= batchCount) {
                      if (rows.length % 50 === 0 || idx + batchCount >= newPreviews.length) {
                        console.log('supabase.js: загружено ' + rows.length + '/' + newPreviews.length + ' превью');
                      }
                      nextBatch();
                    }
                  });
                } else {
                  rows.push({
                    project_id: projectId,
                    file_name: pv.name,
                    thumb_path: thumbUrl || null,
                    preview_path: null,
                    rating: pv.rating || 0,
                    orient: pv.orient || 'v',
                    position: item.position
                  });
                  batchDone++;
                  if (batchDone >= batchCount) {
                    if (rows.length % 50 === 0 || idx + batchCount >= newPreviews.length) {
                      console.log('supabase.js: загружено ' + rows.length + '/' + newPreviews.length + ' превью');
                    }
                    nextBatch();
                  }
                }
              });
            } else {
              rows.push({
                project_id: projectId,
                file_name: pv.name,
                thumb_path: (pv.thumb && pv.thumb.indexOf('http') === 0) ? pv.thumb : null,
                preview_path: (pv.preview && pv.preview.indexOf('http') === 0) ? pv.preview : null,
                rating: pv.rating || 0,
                orient: pv.orient || 'v',
                position: item.position
              });
              batchDone++;
              if (batchDone >= batchCount) nextBatch();
            }
          })(newPreviews[i]);
        }

        idx = end;
      }

      nextBatch();
    });
}

/**
 * Вставить строки превью в таблицу (батчами по 50).
 * @param {Array} rows
 * @param {function} callback
 */
function _sbInsertPreviewRows(rows, callback) {
  if (rows.length === 0) { callback(null); return; }

  // Сортируем по position
  rows.sort(function(a, b) { return a.position - b.position; });

  // Вставляем батчами (Supabase лимит ~1000 строк)
  var batchSize = 50;
  var batches = [];
  for (var i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  var batchIdx = 0;
  function nextBatch() {
    if (batchIdx >= batches.length) {
      console.log('supabase.js: загружено ' + rows.length + ' превью в таблицу');
      callback(null);
      return;
    }
    sbClient.from('previews').insert(batches[batchIdx]).then(function(res) {
      if (res.error) { callback('Ошибка превью: ' + res.error.message); return; }
      batchIdx++;
      nextBatch();
    });
  }
  nextBatch();
}

/**
 * Скачать превью проекта из облака.
 * Возвращает массив в формате [{name, thumb, rating, orient}].
 *
 * @param {string} projectId
 * @param {function} callback — callback(error, previews[])
 */
function sbDownloadPreviews(projectId, callback) {
  sbClient.from('previews')
    .select('*')
    .eq('project_id', projectId)
    .order('position')
    .then(function(res) {
      if (res.error) { callback(res.error.message, []); return; }

      var previews = [];
      var rows = res.data || [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        previews.push({
          name: r.file_name,
          thumb: r.thumb_path || '',
          preview: r.preview_path || r.thumb_path || '',
          width: r.width || 0,
          height: r.height || 0,
          rating: r.rating || 0,
          orient: r.orient || 'v',
          path: '',
          folders: []
        });
      }
      callback(null, previews);
    })['catch'](function(err) {
      console.error('sbDownloadPreviews catch:', err);
      callback(err.message || 'Network error', []);
    });
}


/**
 * Скачать проект из облака по ID.
 * Конвертирует таблицы Supabase обратно в локальный формат.
 *
 * @param {string} cloudId — UUID проекта в Supabase
 * @param {function} callback — callback(error, project)
 */
function sbDownloadProject(cloudId, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  // Загружаем проект
  sbClient.from('projects').select('*').eq('id', cloudId).single().then(function(res) {
    if (res.error) { callback('Ошибка загрузки: ' + res.error.message); return; }

    var remote = res.data;
    var proj = {
      _cloudId: remote.id,
      brand: remote.brand,
      shoot_date: remote.shoot_date,
      templateId: remote.template_id,
      _template: remote.template_config || null,
      _stage: remote.stage || 0,
      _stageHistory: {},
      _deletedAt: remote.deleted_at || null,
      channels: (typeof remote.channels === 'string') ? JSON.parse(remote.channels || '[]') : (remote.channels || []),
      _ocNames: (typeof remote.other_content === 'string') ? JSON.parse(remote.other_content || '[]') : (remote.other_content || []),
      _ocContainersRaw: (typeof remote.oc_containers === 'string') ? JSON.parse(remote.oc_containers || '[]') : (remote.oc_containers || []),
      cards: [],
      previews: [],
      otherContent: [],
      ocContainers: []
    };

    // Загружаем карточки + слоты
    sbClient.from('cards').select('*').eq('project_id', cloudId).order('position').then(function(cardRes) {
      if (cardRes.error) { callback('Ошибка карточек: ' + cardRes.error.message); return; }

      sbClient.from('slots').select('*').eq('project_id', cloudId).order('position').then(function(slotRes) {
        if (slotRes.error) { callback('Ошибка слотов: ' + slotRes.error.message); return; }

        // Группируем слоты по card_id
        var slotsByCard = {};
        var allSlots = slotRes.data || [];
        for (var s = 0; s < allSlots.length; s++) {
          var sl = allSlots[s];
          if (!slotsByCard[sl.card_id]) slotsByCard[sl.card_id] = [];
          slotsByCard[sl.card_id].push(sl);
        }

        /* ── Сначала загружаем превью — это единственный источник правды о фото ── */
        sbDownloadPreviews(cloudId, function(pvErr, pvList) {
          if (!pvErr && pvList) proj.previews = pvList;

          /* Строим карту превью по имени файла:
             pvByName['photo.jpg'] = { name, thumb (300px URL), preview (1200px URL), ... } */
          var pvByName = {};
          if (proj.previews) {
            for (var pi = 0; pi < proj.previews.length; pi++) {
              pvByName[proj.previews[pi].name] = proj.previews[pi];
            }
          }

          /* Собираем карточки. Слот хранит только file_name + структуру (orient, weight, row).
             Картинку берём из превью по имени: preview (1200px) приоритет, thumb (300px) фолбэк. */
          var remoteCards = cardRes.data || [];
          for (var c = 0; c < remoteCards.length; c++) {
            var rc = remoteCards[c];
            var card = {
              id: rc.id,
              name: rc.name || '',
              status: rc.status,
              _hasHero: rc.has_hero,
              _hAspect: rc.h_aspect,
              _vAspect: rc.v_aspect,
              _lockRows: rc.lock_rows,
              slots: []
            };

            var cardSlots = slotsByCard[rc.id] || [];
            for (var j = 0; j < cardSlots.length; j++) {
              var rs = cardSlots[j];
              var fileName = rs.file_name;
              var pv = fileName ? pvByName[fileName] : null;

              /* dataUrl: preview (1200px) > thumb (300px) > slot.thumb_path (legacy fallback) */
              var imgUrl = null;
              if (pv) {
                imgUrl = pv.preview || pv.thumb || null;
              }
              if (!imgUrl && rs.thumb_path) {
                imgUrl = rs.thumb_path; /* legacy: если превью нет, берём из слота */
              }

              card.slots.push({
                orient: rs.orient,
                weight: rs.weight,
                row: rs.row_num,
                rotation: rs.rotation,
                file: fileName,
                dataUrl: imgUrl,
                thumbUrl: pv ? (pv.thumb || null) : (rs.thumb_path || null),
                path: null
              });
            }

            proj.cards.push(card);
          }

          /* Восстановить otherContent из имён файлов + превью */
          if (proj._ocNames && proj._ocNames.length > 0) {
            for (var oi = 0; oi < proj._ocNames.length; oi++) {
              var ocPv = pvByName[proj._ocNames[oi]];
              if (ocPv) {
                proj.otherContent.push({ name: ocPv.name, path: '', thumb: ocPv.thumb, preview: ocPv.preview || '' });
              }
            }
          }
          delete proj._ocNames;

          /* Восстановить ocContainers из raw данных + превью */
          if (proj._ocContainersRaw && proj._ocContainersRaw.length > 0) {
            for (var ci2 = 0; ci2 < proj._ocContainersRaw.length; ci2++) {
              var rawCnt = proj._ocContainersRaw[ci2];
              var cnt = { id: rawCnt.id, name: rawCnt.name, items: [] };
              var rawItems = rawCnt.items || [];
              for (var ri = 0; ri < rawItems.length; ri++) {
                var cntPv = pvByName[rawItems[ri]];
                if (cntPv) {
                  cnt.items.push({ name: cntPv.name, path: '', thumb: cntPv.thumb, preview: cntPv.preview || '' });
                }
              }
              proj.ocContainers.push(cnt);
            }
          }
          delete proj._ocContainersRaw;

          /* Загрузить историю этапов из stage_events */
          sbLoadStageHistory(cloudId, function(history) {
            proj._stageHistory = history;

            /* Загрузить версии (ЦК/Ретушь) из photo_versions и привязать к превью */
            _sbLoadAndAttachVersions(cloudId, proj, pvByName, function() {
              /* Подписаться на realtime-обновления версий (для веб-клиента) */
              if (typeof sbSubscribeVersions === 'function') {
                sbSubscribeVersions(cloudId);
              }
              callback(null, proj);
            });
          });
        });
      });
    });
  });
}

/**
 * Получить список проектов текущего пользователя из облака.
 * @param {function} callback — callback(error, [{id, brand, shoot_date, updated_at}])
 */
function sbListProjects(callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  /* Свои проекты по owner_id (надёжный запрос без project_members).
     Shared-проекты подтянутся отдельно когда RLS-рекурсия будет решена. */
  sbClient.from('projects')
    .select('id, brand, shoot_date, stage, updated_at, deleted_at')
    .eq('owner_id', sbUser.id)
    .order('updated_at', { ascending: false })
    .then(function(res) {
      if (res.error) callback(res.error.message, []);
      else callback(null, res.data || []);
    });
}


/**
 * Soft delete проекта: установить deleted_at в текущее время.
 * Проект не удаляется из БД — только помечается.
 * @param {string} projectId — UUID проекта в Supabase
 * @param {function} callback — callback(error)
 */
function sbSoftDeleteProject(projectId, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  sbClient.from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('owner_id', sbUser.id)
    .then(function(res) {
      if (res.error) callback(res.error.message);
      else callback(null);
    });
}

/**
 * Восстановить soft-удалённый проект: обнулить deleted_at.
 * @param {string} projectId — UUID проекта в Supabase
 * @param {function} callback — callback(error)
 */
function sbRestoreProject(projectId, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  sbClient.from('projects')
    .update({ deleted_at: null })
    .eq('id', projectId)
    .eq('owner_id', sbUser.id)
    .then(function(res) {
      if (res.error) callback(res.error.message);
      else callback(null);
    });
}


// ══════════════════════════════════════════════
//  Share links — ссылки доступа
// ══════════════════════════════════════════════

/**
 * Создать ссылку доступа к проекту.
 * @param {string} projectId — UUID проекта в Supabase
 * @param {string} role — 'client' | 'retoucher'
 * @param {string} [label] — метка ("Для Лены")
 * @param {function} callback — callback(error, {token, url})
 */
function sbCreateShareLink(projectId, role, label, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  var row = {
    project_id: projectId,
    role: role || 'client',
    label: label || null
  };

  sbClient.from('share_links').insert(row).select().single().then(function(res) {
    if (res.error) { callback(res.error.message); return; }

    var link = res.data;
    if (!link || !link.token) { callback('Сервер не вернул токен ссылки'); return; }
    /* Share-ссылки всегда через GitHub Pages (Netlify заблокирован в России).
       Если сайт открыт на Netlify, localhost или file:// — подставляем GitHub Pages URL. */
    var origin = window.location.origin;
    var pathname = window.location.pathname;
    if (origin.indexOf('netlify.app') !== -1 || origin.indexOf('localhost') !== -1 || origin.indexOf('127.0.0.1') !== -1 || origin.indexOf('file://') !== -1 || origin === 'null') {
      origin = 'https://barinskim-cmyk.github.io';
      pathname = '/maket-cp/';
    }
    var url = origin + pathname + '?share=' + link.token;

    callback(null, { token: link.token, url: url, id: link.id });
  });
}

/**
 * Получить список ссылок доступа к проекту.
 * @param {string} projectId
 * @param {function} callback — callback(error, links[])
 */
function sbListShareLinks(projectId, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  sbClient.from('share_links')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .then(function(res) {
      if (res.error) callback(res.error.message, []);
      else callback(null, res.data || []);
    });
}

/**
 * Деактивировать ссылку доступа.
 * @param {string} linkId
 * @param {function} callback
 */
function sbDeactivateLink(linkId, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  sbClient.from('share_links')
    .update({ is_active: false })
    .eq('id', linkId)
    .then(function(res) {
      if (res.error) callback(res.error.message);
      else callback(null);
    });
}

/**
 * Присоединиться к проекту по share-токену.
 * Вызывается клиентом/ретушёром при переходе по ссылке.
 * @param {string} token
 * @param {function} callback — callback(error, {project_id, role})
 */
function sbJoinByToken(token, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  sbClient.rpc('join_by_token', { share_token: token }).then(function(res) {
    if (res.error) callback(res.error.message);
    else callback(null, res.data);
  });
}


// ══════════════════════════════════════════════
//  Анонимный доступ по share-ссылке (без регистрации)
// ══════════════════════════════════════════════

/**
 * Загрузить проект по share-токену БЕЗ авторизации.
 * Использует Supabase RPC-функцию get_project_by_token (security definer).
 * @param {string} token — share-токен из URL (?share=TOKEN)
 */
function sbLoadByShareToken(token) {
  /* Ждём пока Supabase SDK загрузится.
     Пробуем инициализировать при каждой попытке на случай если SDK загрузился позже. */
  var attempts = 0;
  var interval = setInterval(function() {
    attempts++;
    /* Повторная попытка инициализации если sbClient ещё не создан */
    if (!sbClient && typeof sbInit === 'function') {
      try { sbInit(); } catch(e) {}
    }
    if (sbClient) {
      clearInterval(interval);
      _sbDoLoadByToken(token);
    } else if (attempts > 100) {
      clearInterval(interval);
      alert('Не удалось подключиться к серверу. Попробуйте обновить страницу.');
      if (typeof _hideShareLoader === 'function') _hideShareLoader();
    }
  }, 100);
}

/**
 * Внутренняя: вызвать RPC и загрузить проект.
 */
function _sbDoLoadByToken(token) {
  sbClient.rpc('get_project_by_token', { share_token: token }).then(function(res) {
    if (res.error) {
      console.error('get_project_by_token:', res.error);
      alert('Ссылка недействительна или истекла');
      return;
    }

    var data = res.data;
    if (!data || !data.project_id) {
      alert('Ссылка недействительна или истекла');
      return;
    }

    /* Собираем проект из ответа RPC */
    var ocRaw = data.other_content || '[]';
    var proj = {
      _cloudId: data.project_id,
      brand: data.brand || '',
      shoot_date: data.shoot_date || '',
      templateId: data.template_id || '',
      _template: data.template_config || null,
      _stage: data.stage || 0,
      _stageHistory: {},
      _role: data.role || 'client',
      channels: [],
      _ocNames: (typeof ocRaw === 'string') ? JSON.parse(ocRaw) : (ocRaw || []),
      _ocContainersRaw: (function() { var raw = data.oc_containers || '[]'; return (typeof raw === 'string') ? JSON.parse(raw) : (raw || []); })(),
      cards: [],
      previews: [],
      otherContent: [],
      ocContainers: []
    };

    /* Временно сохраняем карточки из RPC — соберём после загрузки превью */
    var _rpcCards = data.cards || [];

    /* ── Сначала загружаем превью — единственный источник правды о фото ── */
    sbDownloadPreviews(data.project_id, function(pvErr, pvList) {
      if (!pvErr && pvList && pvList.length > 0) {
        proj.previews = pvList;
        console.log('supabase.js: загружено ' + pvList.length + ' превью по share-ссылке');
      }

      /* Карта превью по имени файла */
      var pvByName = {};
      if (proj.previews) {
        for (var pi = 0; pi < proj.previews.length; pi++) {
          pvByName[proj.previews[pi].name] = proj.previews[pi];
        }
      }

      /* Собираем карточки. Слот берёт картинку из превью по file_name. */
      if (_rpcCards && Array.isArray(_rpcCards)) {
        for (var c = 0; c < _rpcCards.length; c++) {
          var rc = _rpcCards[c];
          var card = {
            id: rc.id,
            status: rc.status || 'draft',
            _hasHero: rc.has_hero,
            _hAspect: rc.h_aspect || '3/2',
            _vAspect: rc.v_aspect || '2/3',
            _lockRows: rc.lock_rows || false,
            slots: []
          };
          if (rc.slots && Array.isArray(rc.slots)) {
            for (var s = 0; s < rc.slots.length; s++) {
              var rs = rc.slots[s];
              var fileName = rs.file_name || null;
              var pv = fileName ? pvByName[fileName] : null;

              /* dataUrl: preview (1200px) > thumb (300px) > slot paths (legacy) */
              var imgUrl = null;
              if (pv) {
                imgUrl = pv.preview || pv.thumb || null;
              }
              if (!imgUrl) {
                imgUrl = rs.preview_path || rs.thumb_path || null;
              }

              card.slots.push({
                orient: rs.orient || 'v',
                weight: rs.weight || 1,
                row: rs.row_num,
                rotation: rs.rotation || 0,
                file: fileName,
                dataUrl: imgUrl,
                thumbUrl: pv ? (pv.thumb || null) : (rs.thumb_path || null),
                path: null
              });
            }
          }
          proj.cards.push(card);
        }
      }

      /* Восстановить otherContent из имён файлов + превью */
      if (proj._ocNames && proj._ocNames.length > 0) {
        for (var oi = 0; oi < proj._ocNames.length; oi++) {
          var ocPv = pvByName[proj._ocNames[oi]];
          if (ocPv) {
            proj.otherContent.push({ name: ocPv.name, path: '', thumb: ocPv.thumb, preview: ocPv.preview || '' });
          }
        }
      }
      delete proj._ocNames;

      /* Восстановить ocContainers из raw данных + превью */
      if (proj._ocContainersRaw && proj._ocContainersRaw.length > 0) {
        for (var ci3 = 0; ci3 < proj._ocContainersRaw.length; ci3++) {
          var rawCnt2 = proj._ocContainersRaw[ci3];
          var cnt2 = { id: rawCnt2.id, name: rawCnt2.name, items: [] };
          var rawItems2 = rawCnt2.items || [];
          for (var ri2 = 0; ri2 < rawItems2.length; ri2++) {
            var cntPv2 = pvByName[rawItems2[ri2]];
            if (cntPv2) {
              cnt2.items.push({ name: cntPv2.name, path: '', thumb: cntPv2.thumb, preview: cntPv2.preview || '' });
            }
          }
          proj.ocContainers.push(cnt2);
        }
      }
      delete proj._ocContainersRaw;

      /* Загрузить историю этапов из stage_events */
      sbLoadStageHistory(data.project_id, function(history) {
        proj._stageHistory = history;

        /* Share-ссылка: заменяем все проекты, чтобы гарантировать правильный выбор.
           Помечаем как _cloudClean — не перезаписывать облако. */
        proj._cloudClean = true;
        App.projects = [proj];
        App.selectedProject = 0;
        if (typeof renderProjects === 'function') renderProjects();

        /* Клиентский/гостевой режим (все роли кроме owner) */
        if (proj._role && proj._role !== 'owner' && typeof shEnterClientMode === 'function') {
          shEnterClientMode();
        }

        /* Отрисовать превью */
        if (typeof pvRenderGallery === 'function') {
          setTimeout(function() { pvRenderGallery(); }, 200);
        }

        /* Запустить авто-обновление из облака (каждые 30 сек) */
        if (typeof sbStartAutoPull === 'function') sbStartAutoPull();

        /* Подписаться на realtime-обновления версий */
        if (typeof sbSubscribeVersions === 'function') sbSubscribeVersions(data.project_id);

        console.log('Проект загружен по share-ссылке:', proj.brand, 'роль:', proj._role);
      });
    });
  })['catch'](function(err) {
    console.error('_sbDoLoadByToken catch:', err);
    alert('Ошибка загрузки: ' + (err.message || 'сетевая ошибка'));
    if (typeof _hideShareLoader === 'function') _hideShareLoader();
  });
}


// ══════════════════════════════════════════════
//  Сохранение карточек клиентом (по share-токену)
// ══════════════════════════════════════════════

/**
 * Сохранить изменения карточек от клиента через RPC.
 * Клиент не авторизован — используем share_token для проверки доступа.
 * RPC save_cards_by_token: security definer, проверяет токен, обновляет слоты.
 *
 * @param {string} token — share-токен из URL
 * @param {Array} cards — массив карточек из App.projects[].cards
 * @param {function} callback — callback(error)
 */
function sbSaveCardsByToken(token, cards, callback) {
  if (!token) { callback('Нет share-токена'); return; }
  if (!sbClient) { callback('Supabase не инициализирован'); return; }

  /* Собираем JSON для RPC: массив карточек со слотами */
  var cardsJson = [];
  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var slotsJson = [];
    if (card.slots) {
      for (var s = 0; s < card.slots.length; s++) {
        var slot = card.slots[s];
        slotsJson.push({
          position: s,
          orient: slot.orient || 'v',
          weight: slot.weight || 1,
          row_num: (slot.row !== undefined) ? slot.row : null,
          rotation: slot.rotation || 0,
          file_name: slot.file || null
        });
      }
    }
    cardsJson.push({
      position: c,
      status: card.status || 'draft',
      has_hero: card._hasHero !== undefined ? card._hasHero : true,
      h_aspect: card._hAspect || '3/2',
      v_aspect: card._vAspect || '2/3',
      lock_rows: card._lockRows || false,
      slots: slotsJson
    });
  }

  /* Собираем доп. контент (имена файлов) */
  var proj = getActiveProject();
  var ocNames = (proj && proj.otherContent) ? proj.otherContent.map(function(oc) { return oc.name; }) : [];
  /* Контейнеры */
  var ocCntData = (proj && proj.ocContainers) ? proj.ocContainers.map(function(cnt) {
    return { id: cnt.id, name: cnt.name, items: (cnt.items || []).map(function(it) { return it.name; }) };
  }) : [];

  sbClient.rpc('save_cards_by_token', {
    share_token: token,
    cards_data: cardsJson,
    oc_data: JSON.stringify(ocNames),
    oc_containers_data: JSON.stringify(ocCntData)
  }).then(function(res) {
    if (res.error) {
      console.error('save_cards_by_token:', res.error);
      callback('Ошибка сохранения: ' + res.error.message);
    } else {
      console.log('supabase.js: данные клиента сохранены (' + cards.length + ' карточек, ' + ocNames.length + ' доп. контент)');
      callback(null);
    }
  });
}

// ══════════════════════════════════════════════
//  Комментарии
// ══════════════════════════════════════════════

/**
 * Добавить комментарий к карточке или проекту.
 * @param {string} projectId
 * @param {string|null} cardId — null для комментария к проекту
 * @param {string} text
 * @param {function} callback
 */
function sbAddComment(projectId, cardId, text, callback) {
  if (!sbIsLoggedIn()) { callback('Не авторизован'); return; }

  var row = {
    project_id: projectId,
    card_id: cardId || null,
    author_id: sbUser.id,
    author_name: sbUser.user_metadata ? (sbUser.user_metadata.name || sbUser.email) : sbUser.email,
    text: text
  };

  sbClient.from('comments').insert(row).select().single().then(function(res) {
    if (res.error) callback(res.error.message);
    else callback(null, res.data);
  });
}

/**
 * Получить комментарии к проекту/карточке.
 * @param {string} projectId
 * @param {string|null} cardId — null = все комментарии проекта
 * @param {function} callback — callback(error, comments[])
 */
function sbGetComments(projectId, cardId, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  var query = sbClient.from('comments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (cardId) query = query.eq('card_id', cardId);

  query.then(function(res) {
    if (res.error) callback(res.error.message, []);
    else callback(null, res.data || []);
  });
}


// ══════════════════════════════════════════════
//  Аудит-лог действий (action_log)
//
//  Два уровня:
//    1. Метка _addedBy на фото — перезаписывается всегда (лёгкая)
//    2. action_log в Supabase — пишется только с этапа >= 3
// ══════════════════════════════════════════════

/** Минимальный этап проекта для записи в action_log */
var SB_LOG_MIN_STAGE = 3;

/**
 * Получить информацию о текущем акторе.
 * Возвращает {id, token, name, role}.
 */
function sbGetActor() {
  var proj = getActiveProject();
  var role = (proj && proj._role) ? proj._role : 'owner';

  if (sbUser) {
    var name = sbUser.email || '';
    if (sbUser.user_metadata && sbUser.user_metadata.name) {
      name = sbUser.user_metadata.name;
    }
    return { id: sbUser.id, token: null, name: name, role: role };
  }

  if (window._shareToken) {
    return { id: null, token: window._shareToken, name: role + ' (ссылка)', role: role };
  }

  return { id: null, token: null, name: 'local', role: 'owner' };
}

/**
 * Поставить метку актора на объект (slot item, OC item и т.д.).
 * Перезаписывает _addedBy / _addedAt при каждом действии.
 *
 * @param {Object} item — объект с полем name (slot, OC item и т.д.)
 */
function sbStampActor(item) {
  if (!item) return;
  var actor = sbGetActor();
  item._addedBy = actor.name;
  item._addedRole = actor.role;
  item._addedAt = new Date().toISOString();
}

/**
 * Записать действие в action_log (Supabase RPC).
 * Пишет только если:
 *   - есть облачный проект (_cloudId)
 *   - этап >= SB_LOG_MIN_STAGE
 *
 * @param {string} action       — add_to_card, remove_from_card, approve_card, ...
 * @param {string} targetType   — card | container | slot | project
 * @param {string} targetId     — id карточки/контейнера
 * @param {string} [targetName] — имя для снапшота
 * @param {string} [photoName]  — имя файла фото
 * @param {Object} [details]    — доп. контекст
 */
function sbLogAction(action, targetType, targetId, targetName, photoName, details) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;
  if ((proj._stage || 0) < SB_LOG_MIN_STAGE) return;
  if (!sbClient) return;

  var actor = sbGetActor();

  sbClient.rpc('log_action', {
    p_project_id:  proj._cloudId,
    p_share_token: actor.token || null,
    p_actor_name:  actor.name,
    p_actor_role:  actor.role,
    p_action:      action,
    p_target_type: targetType || null,
    p_target_id:   targetId || null,
    p_target_name: targetName || null,
    p_photo_name:  photoName || null,
    p_details:     details || null
  }).then(function(res) {
    if (res.error) console.warn('action_log error:', res.error.message);
  });
}

/**
 * Получить журнал действий проекта.
 * @param {string} projectId
 * @param {Object} [opts] — {photo_name, target_id, limit}
 * @param {function} callback — callback(error, logs[])
 */
function sbGetActionLog(projectId, opts, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }
  if (!opts) opts = {};

  var query = sbClient.from('action_log')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(opts.limit || 100);

  if (opts.photo_name) query = query.eq('photo_name', opts.photo_name);
  if (opts.target_id) query = query.eq('target_id', opts.target_id);

  query.then(function(res) {
    if (res.error) callback(res.error.message, []);
    else callback(null, res.data || []);
  });
}


// ══════════════════════════════════════════════
//  Загрузка миниатюр в Storage
// ══════════════════════════════════════════════

/**
 * Загрузить base64 миниатюру в Supabase Storage.
 * @param {string} projectId
 * @param {string} fileName — имя файла
 * @param {string} base64Data — data:image/jpeg;base64,...
 * @param {function} callback — callback(error, publicUrl)
 */
function sbUploadThumb(projectId, fileName, base64Data, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  // Конвертируем base64 в Blob
  var parts = base64Data.split(',');
  var mime = parts[0].match(/:(.*?);/)[1];
  var binary = atob(parts[1]);
  var array = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  var blob = new Blob([array], { type: mime });

  var path = projectId + '/' + fileName;

  sbClient.storage.from('thumbnails').upload(path, blob, {
    contentType: mime,
    upsert: true
  }).then(function(res) {
    if (res.error) { callback(res.error.message); return; }

    var urlRes = sbClient.storage.from('thumbnails').getPublicUrl(path);
    callback(null, urlRes.data.publicUrl);
  });
}


// ══════════════════════════════════════════════
//  Инициализация при загрузке
// ══════════════════════════════════════════════

/**
 * Проверяем URL на наличие share-токена (?share=xxx).
 * Анонимный доступ обрабатывается в authCheckOnLoad → sbLoadByShareToken.
 * Эта функция — фолбэк для авторизованных пользователей (не должна вызываться для анонимов).
 */
function sbCheckShareToken() {
  /* Анонимный доступ по share-ссылке теперь обрабатывается в authCheckOnLoad.
     Здесь ничего не делаем — оставлено для обратной совместимости. */
}

// ══════════════════════════════════════════════
//  Авто-синхронизация карточек (debounce)
// ══════════════════════════════════════════════

var _sbCardSyncTimer = null;
var _sbCardSyncRunning = false; // блокировка: не запускать новый sync пока старый не завершился
var SB_CARD_SYNC_DELAY = 3000; // 3 секунды после последнего изменения

/**
 * Лёгкая синхронизация карточек: только метаданные (без перезаливки картинок).
 * Удаляет старые карточки/слоты и вставляет новые, но thumb_path берёт из
 * существующих записей в базе (по file_name), а не загружает заново.
 *
 * @param {string} projectId
 * @param {Array} cards
 * @param {function} callback — callback(error)
 */
function sbSyncCardsLight(projectId, cards, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  /* Обновить other_content + oc_containers + stage в проекте */
  var proj = getActiveProject();
  if (proj) {
    var ocNames = (proj.otherContent || []).map(function(oc) { return oc.name; });
    var ocCntData = (proj.ocContainers || []).map(function(cnt) {
      return { id: cnt.id, name: cnt.name, items: (cnt.items || []).map(function(it) { return it.name; }) };
    });
    sbClient.from('projects').update({
      other_content: JSON.stringify(ocNames),
      oc_containers: JSON.stringify(ocCntData),
      template_config: proj._template || null,
      stage: proj._stage || 0,
      updated_at: new Date().toISOString()
    }).eq('id', projectId).then(function() {});
  }

  /* Сначала получаем существующие thumb_path по file_name */
  sbClient.from('slots').select('file_name, thumb_path').eq('project_id', projectId).then(function(existRes) {
    var thumbMap = {};
    (existRes.data || []).forEach(function(r) {
      if (r.file_name && r.thumb_path) thumbMap[r.file_name] = r.thumb_path;
    });

    /* Удаляем старые карточки (каскадно удалит слоты) */
    sbClient.from('cards').delete().eq('project_id', projectId).then(function(delRes) {
      if (delRes.error) { callback('Ошибка удаления: ' + delRes.error.message); return; }
      if (!cards || cards.length === 0) { callback(null); return; }

      var cardRows = [];
      var slotRows = [];

      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        var cardId = crypto.randomUUID ? crypto.randomUUID() : ('card_' + projectId.slice(0,8) + '_' + c + '_' + Date.now());

        cardRows.push({
          id: cardId,
          project_id: projectId,
          position: c,
          name: card.name || null,
          status: card.status || 'draft',
          has_hero: card._hasHero !== undefined ? card._hasHero : true,
          h_aspect: card._hAspect || '3/2',
          v_aspect: card._vAspect || '2/3',
          lock_rows: card._lockRows || false
        });

        if (card.slots) {
          for (var s = 0; s < card.slots.length; s++) {
            var slot = card.slots[s];
            var fileName = slot.file || ('slot_' + c + '_' + s + '.jpg');
            slotRows.push({
              card_id: cardId,
              project_id: projectId,
              position: s,
              orient: slot.orient || 'v',
              weight: slot.weight || 1,
              row_num: (slot.row !== undefined) ? slot.row : null,
              rotation: slot.rotation || 0,
              file_name: fileName,
              thumb_path: thumbMap[fileName] || null,
              original_path: null
            });
          }
        }
      }

      sbClient.from('cards').insert(cardRows).then(function(cardRes) {
        if (cardRes.error) { callback('Ошибка карточек: ' + cardRes.error.message); return; }
        if (slotRows.length === 0) { callback(null); return; }

        sbClient.from('slots').insert(slotRows).then(function(slotRes) {
          if (slotRes.error) { callback('Ошибка слотов: ' + slotRes.error.message); return; }
          callback(null);
        });
      });
    });
  });
}

/**
 * ОТКЛЮЧЕНА. Раньше вызывалась из cpSaveHistory и других мест.
 * Проблема: DELETE + INSERT pattern уничтожал облачные данные при race condition.
 * Теперь облако обновляется ТОЛЬКО через shCloudSyncExplicit() в shootings.js.
 * Все прямые вызовы sbAutoSyncCards() по коду стали no-op.
 */
function sbAutoSyncCards() {
  /* No-op. Облако синхронизируется только через shCloudSyncExplicit(). */
}

/**
 * Принудительная синхронизация карточек (без debounce).
 * Можно вызвать из консоли: sbForceSyncCards()
 */
function sbForceSyncCards() {
  var proj = getActiveProject();
  if (!proj) { console.error('Нет активного проекта'); return; }
  if (!proj._cloudId) { console.error('Проект не привязан к облаку (_cloudId отсутствует)'); return; }
  if (!sbIsLoggedIn()) { console.error('Не авторизован в Supabase'); return; }

  console.log('Принудительная синхронизация: ' + (proj.cards || []).length + ' карточек...');
  sbUploadCards(proj._cloudId, proj.cards || [], function(err) {
    if (err) console.error('Ошибка синхронизации:', err);
    else console.log('Синхронизация завершена успешно!');
  });
}

// ══════════════════════════════════════════════
// Pull: подтянуть свежие данные из облака в локальный проект
// ══════════════════════════════════════════════

/** @type {boolean} Блокировка: не запускать параллельные pull */
var _sbPullRunning = false;

/** @type {number|null} Таймер периодического pull */
var _sbPullTimer = null;

/** @type {number} Интервал авто-pull (мс) */
var SB_PULL_INTERVAL = 30000; /* 30 сек */

/** @type {number} Таймстемп последнего push — pull блокируется на 5 сек после push */
var _sbLastPushTime = 0;

/**
 * Пометить что push отправлен — pull будет пропущен ближайшие 5 секунд.
 * Вызывать из shCloudSyncExplicit / sbSaveCardsByToken callback.
 */
function sbMarkPushDone() {
  _sbLastPushTime = Date.now();
}

/**
 * Подтянуть свежее состояние проекта из Supabase в локальный объект.
 * Обновляет: cards, slots, otherContent, stage, stageHistory.
 * НЕ перезагружает превью (они тяжёлые и уже загружены).
 *
 * @param {function} [callback] — callback(error)
 */
function sbPullProject(callback) {
  if (!callback) callback = function() {};
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) { callback('Нет облачного проекта'); return; }
  if (!sbClient) { callback('Supabase не подключён'); return; }
  if (_sbPullRunning) { callback('Pull уже идёт'); return; }

  /* Пропустить pull если недавно был push (предотвращает гонку данных) */
  if (_sbLastPushTime && (Date.now() - _sbLastPushTime) < 5000) {
    callback('Пропущен: недавний push');
    return;
  }

  var isOwner = sbIsLoggedIn();
  var isClient = !!window._shareToken;
  if (!isOwner && !isClient) { callback('Не авторизован'); return; }

  _sbPullRunning = true;
  var cloudId = proj._cloudId;
  console.log('sbPullProject: подтягиваем данные из облака...');

  /* Клиент по share-ссылке: pull через RPC (прямой SELECT заблокирован RLS) */
  if (isClient && window._shareToken) {
    sbClient.rpc('get_project_by_token', { share_token: window._shareToken }).then(function(res) {
      _sbPullRunning = false;
      if (res.error || !res.data || !res.data.project_id) {
        callback(res.error ? res.error.message : 'no data');
        return;
      }
      var data = res.data;
      var pvByName = {};
      if (proj.previews) {
        for (var pi = 0; pi < proj.previews.length; pi++) {
          pvByName[proj.previews[pi].name] = proj.previews[pi];
        }
      }

      /* Обновить карточки */
      var newCards = [];
      var _rpcCards = data.cards || [];
      for (var c = 0; c < _rpcCards.length; c++) {
        var rc = _rpcCards[c];
        var card = {
          id: rc.id, status: rc.status || 'draft',
          _hasHero: rc.has_hero, _hAspect: rc.h_aspect || '3/2',
          _vAspect: rc.v_aspect || '2/3', _lockRows: rc.lock_rows || false,
          slots: []
        };
        if (rc.slots && Array.isArray(rc.slots)) {
          for (var s = 0; s < rc.slots.length; s++) {
            var rs = rc.slots[s];
            var fn = rs.file_name || null;
            var pv = fn ? pvByName[fn] : null;
            var imgUrl = pv ? (pv.preview || pv.thumb || null) : (rs.preview_path || rs.thumb_path || null);
            card.slots.push({
              orient: rs.orient || 'v', weight: rs.weight || 1,
              row: rs.row_num, rotation: rs.rotation || 0,
              file: fn, dataUrl: imgUrl,
              thumbUrl: pv ? (pv.thumb || null) : (rs.thumb_path || null), path: null
            });
          }
        }
        newCards.push(card);
      }

      /* Обновить OC */
      var ocRaw = data.other_content || '[]';
      var ocNames = (typeof ocRaw === 'string') ? JSON.parse(ocRaw) : (ocRaw || []);
      var newOC = [];
      for (var oi = 0; oi < ocNames.length; oi++) {
        var ocPv = pvByName[ocNames[oi]];
        if (ocPv) newOC.push({ name: ocPv.name, path: '', thumb: ocPv.thumb, preview: ocPv.preview || '' });
      }

      /* Обновить контейнеры */
      var cntRaw = data.oc_containers || '[]';
      var cntArr = (typeof cntRaw === 'string') ? JSON.parse(cntRaw) : (cntRaw || []);
      var newContainers = [];
      for (var ci = 0; ci < cntArr.length; ci++) {
        var rawCnt = cntArr[ci];
        var cnt = { id: rawCnt.id, name: rawCnt.name, items: [] };
        var rawItems = rawCnt.items || [];
        for (var ri = 0; ri < rawItems.length; ri++) {
          var cntPv = pvByName[rawItems[ri]];
          if (cntPv) cnt.items.push({ name: cntPv.name, path: '', thumb: cntPv.thumb, preview: cntPv.preview || '' });
        }
        newContainers.push(cnt);
      }

      proj.cards = newCards;
      proj.otherContent = newOC;
      proj.ocContainers = newContainers;
      proj._stage = data.stage || 0;

      /* Обновить UI */
      if (typeof renderPipeline === 'function') renderPipeline();
      if (typeof cpRenderList === 'function') cpRenderList();
      if (typeof cpRenderCard === 'function') cpRenderCard();
      if (typeof acRenderField === 'function') acRenderField();
      if (typeof ocRenderField === 'function') ocRenderField();
      if (typeof pvRenderAll === 'function') pvRenderAll();
      if (typeof shAutoSave === 'function') shAutoSave();

      console.log('sbPullProject (client): обновлено — ' + newCards.length + ' карт., ' + newOC.length + ' OC');
      callback(null);
    })['catch'](function(err) {
      _sbPullRunning = false;
      callback(String(err));
    });
    return;
  }

  /* 1. Загрузить проект (stage, other_content) */
  sbClient.from('projects').select('stage, other_content, oc_containers, updated_at').eq('id', cloudId).single().then(function(projRes) {
    if (projRes.error) { _sbPullRunning = false; callback(projRes.error.message); return; }

    var remote = projRes.data;

    /* 2. Загрузить карточки + слоты параллельно */
    sbClient.from('cards').select('*').eq('project_id', cloudId).order('position').then(function(cardRes) {
      if (cardRes.error) { _sbPullRunning = false; callback(cardRes.error.message); return; }

      sbClient.from('slots').select('*').eq('project_id', cloudId).order('position').then(function(slotRes) {
        if (slotRes.error) { _sbPullRunning = false; callback(slotRes.error.message); return; }

        /* Группировка слотов по card_id */
        var slotsByCard = {};
        (slotRes.data || []).forEach(function(sl) {
          if (!slotsByCard[sl.card_id]) slotsByCard[sl.card_id] = [];
          slotsByCard[sl.card_id].push(sl);
        });

        /* Карта локальных превью по имени (для dataUrl/thumbUrl) */
        var pvByName = {};
        if (proj.previews) {
          for (var pi = 0; pi < proj.previews.length; pi++) {
            pvByName[proj.previews[pi].name] = proj.previews[pi];
          }
        }

        /* Собираем карточки */
        var newCards = [];
        var remoteCards = cardRes.data || [];
        for (var c = 0; c < remoteCards.length; c++) {
          var rc = remoteCards[c];
          var card = {
            id: rc.id,
            status: rc.status || 'draft',
            _hasHero: rc.has_hero,
            _hAspect: rc.h_aspect || '3/2',
            _vAspect: rc.v_aspect || '2/3',
            _lockRows: rc.lock_rows || false,
            slots: []
          };

          var cardSlots = slotsByCard[rc.id] || [];
          for (var j = 0; j < cardSlots.length; j++) {
            var rs = cardSlots[j];
            var fileName = rs.file_name;
            var pv = fileName ? pvByName[fileName] : null;

            var imgUrl = null;
            if (pv) imgUrl = pv.preview || pv.thumb || null;
            if (!imgUrl && rs.thumb_path) imgUrl = rs.thumb_path;

            card.slots.push({
              orient: rs.orient || 'v',
              weight: rs.weight || 1,
              row: rs.row_num,
              rotation: rs.rotation || 0,
              file: fileName,
              dataUrl: imgUrl,
              thumbUrl: pv ? (pv.thumb || null) : (rs.thumb_path || null),
              path: null
            });
          }
          newCards.push(card);
        }

        /* Восстановить otherContent из имён */
        var ocRaw = remote.other_content || '[]';
        var ocNames = (typeof ocRaw === 'string') ? JSON.parse(ocRaw) : (ocRaw || []);
        var newOC = [];
        for (var oi = 0; oi < ocNames.length; oi++) {
          var ocPv = pvByName[ocNames[oi]];
          if (ocPv) {
            newOC.push({ name: ocPv.name, path: '', thumb: ocPv.thumb, preview: ocPv.preview || '' });
          }
        }

        /* Восстановить ocContainers из облака */
        var cntRaw = remote.oc_containers || '[]';
        var cntParsed = (typeof cntRaw === 'string') ? JSON.parse(cntRaw) : (cntRaw || []);
        var newContainers = [];
        for (var ci4 = 0; ci4 < cntParsed.length; ci4++) {
          var rawC = cntParsed[ci4];
          var newCnt = { id: rawC.id, name: rawC.name, items: [] };
          var rawI = rawC.items || [];
          for (var ri4 = 0; ri4 < rawI.length; ri4++) {
            var cPv = pvByName[rawI[ri4]];
            if (cPv) {
              newCnt.items.push({ name: cPv.name, path: '', thumb: cPv.thumb, preview: cPv.preview || '' });
            }
          }
          newContainers.push(newCnt);
        }

        /* Применить обновления к локальному проекту */
        proj.cards = newCards;
        proj.otherContent = newOC;
        proj.ocContainers = newContainers;
        proj._stage = remote.stage || 0;

        /* Загрузить историю этапов */
        sbLoadStageHistory(cloudId, function(history) {
          proj._stageHistory = history;
          _sbPullRunning = false;

          /* Обновить UI */
          if (typeof renderPipeline === 'function') renderPipeline();
          if (typeof cpRenderList === 'function') cpRenderList();
          if (typeof acRenderField === 'function') acRenderField();
          if (typeof ocRenderField === 'function') ocRenderField();
          if (typeof pvRenderAll === 'function') pvRenderAll();

          /* Сохранить в localStorage */
          if (typeof shAutoSave === 'function') shAutoSave();

          console.log('sbPullProject: данные обновлены (' + newCards.length + ' карт., ' + newOC.length + ' OC, stage=' + proj._stage + ')');
          callback(null);
        });
      });
    });
  });
}

/**
 * Запустить периодический авто-pull из облака.
 * Вызывается при выборе облачного проекта.
 */
function sbStartAutoPull() {
  sbStopAutoPull();
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;

  /* Первый pull — сразу */
  sbPullProject(function(err) {
    if (err) console.warn('sbStartAutoPull: первый pull:', err);
  });

  /* Далее — каждые SB_PULL_INTERVAL мс */
  _sbPullTimer = setInterval(function() {
    var p = getActiveProject();
    if (!p || !p._cloudId) { sbStopAutoPull(); return; }
    sbPullProject(function(err) {
      if (err) console.warn('sbAutoPull:', err);
    });
  }, SB_PULL_INTERVAL);
}

/**
 * Остановить периодический авто-pull.
 */
function sbStopAutoPull() {
  if (_sbPullTimer) {
    clearInterval(_sbPullTimer);
    _sbPullTimer = null;
  }
}

// ══════════════════════════════════════════════
// Синхронизация этапов пайплайна (stage + stage_events)
// ══════════════════════════════════════════════

/**
 * Синхронизировать текущий этап проекта с облаком.
 * 1. Обновляет projects.stage
 * 2. Вставляет запись в stage_events (история)
 *
 * @param {string} [triggerDesc] — описание триггера ("preview_loaded", "client_approved", etc.)
 * @param {string} [note] — доп. заметка (например время из _stageHistory)
 */
function sbSyncStage(triggerDesc, note) {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;
  if (!sbClient) return;

  var isClient = !!window._shareToken;
  var isOwner = sbIsLoggedIn();
  if (!isClient && !isOwner) return;

  var stage = proj._stage || 0;
  var cloudId = proj._cloudId;

  /* 1. Обновить stage в projects (только владелец; клиент обновляет через sbUploadProject) */
  if (isOwner) {
    sbClient.from('projects').update({
      stage: stage,
      updated_at: new Date().toISOString()
    }).eq('id', cloudId).then(function(res) {
      if (res.error) console.warn('sbSyncStage: ошибка обновления stage:', res.error.message);
      else console.log('sbSyncStage: stage=' + stage + ' сохранён');
    });
  }

  /* 2. Вставить запись в stage_events */
  var stageIds = ['preselect', 'selection', 'client', 'color', 'retouch_task', 'retouch', 'retouch_ok', 'adaptation'];
  /* Записываем событие о завершённом этапе (stage - 1) если stage > 0,
     иначе записываем установку на этап 0 */
  var completedIdx = stage > 0 ? stage - 1 : 0;
  var stageId = stageIds[completedIdx] || ('stage_' + completedIdx);

  sbClient.from('stage_events').insert({
    project_id: cloudId,
    stage_id: stageId,
    trigger_desc: triggerDesc || null,
    note: note || null
  }).then(function(res) {
    if (res.error) console.warn('sbSyncStage: ошибка записи stage_event:', res.error.message);
    else console.log('sbSyncStage: stage_event записан для "' + stageId + '"');
  });
}

/**
 * Загрузить историю этапов (stage_events) из Supabase и восстановить _stageHistory.
 * Вызывается при открытии проекта из облака.
 *
 * @param {string} projectId — UUID проекта
 * @param {function} callback — callback(stageHistory) — объект {stageIdx: timeStr}
 */
function sbLoadStageHistory(projectId, callback) {
  if (!sbClient) { callback({}); return; }

  sbClient.from('stage_events')
    .select('stage_id, created_at, trigger_desc, note')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .then(function(res) {
      if (res.error) {
        console.warn('sbLoadStageHistory:', res.error.message);
        callback({});
        return;
      }

      var stageIds = ['preselect', 'selection', 'client', 'color', 'retouch_task', 'retouch', 'retouch_ok', 'adaptation'];
      var history = {};

      (res.data || []).forEach(function(ev) {
        var idx = stageIds.indexOf(ev.stage_id);
        if (idx < 0) return;

        /* Используем note (если есть, это локальное время фотографа),
           иначе форматируем created_at из базы */
        if (ev.note) {
          history[idx] = ev.note;
        } else {
          var d = new Date(ev.created_at);
          history[idx] = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }

        /* Спец. ключи: client_approved, client_extra_request */
        if (ev.trigger_desc === 'client_approved') {
          history['client_approved'] = history[idx];
        }
        if (ev.trigger_desc === 'client_extra_request') {
          history['client_extra_request'] = history[idx];
        }
      });

      callback(history);
    })['catch'](function(err) {
      console.error('sbLoadStageHistory catch:', err);
      callback({});
    });
}

/**
 * Загрузить версии фото из photo_versions и привязать к объектам превью.
 * Вызывается при загрузке проекта из облака.
 *
 * @param {string} cloudId — UUID проекта
 * @param {Object} proj — объект проекта
 * @param {Object} pvByName — карта превью по имени
 * @param {function} done — callback()
 */
function _sbLoadAndAttachVersions(cloudId, proj, pvByName, done) {
  if (!sbClient) { done(); return; }

  sbClient.from('photo_versions')
    .select('photo_name, stage, preview_path')
    .eq('project_id', cloudId)
    .then(function(res) {
      if (res.error || !res.data || res.data.length === 0) {
        done();
        return;
      }

      var rows = res.data;
      console.log('sbVersions: загружено ' + rows.length + ' версий');

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var pv = pvByName[r.photo_name];
        if (!pv) continue;
        if (!pv.versions) pv.versions = {};
        /* Не перезаписывать если уже есть (из IndexedDB) */
        if (!pv.versions[r.stage]) {
          pv.versions[r.stage] = {
            thumb: r.preview_path || '',
            preview: r.preview_path || ''
          };
        }
      }

      done();
    })['catch'](function(err) {
      console.warn('_sbLoadAndAttachVersions:', err);
      done();
    });
}

// ══════════════════════════════════════════════
//  Photo Versions (постпродакшн: ЦК, ретушь, грейдинг)
// ══════════════════════════════════════════════

/**
 * Загрузить все версии фото для проекта.
 * Сортировка: photo_name → stage → version_num.
 *
 * @param {string} projectId - UUID проекта
 * @param {function} callback - function(err, versions)
 *   versions: [{id, photo_name, stage, version_num, preview_path, cos_path, selected, created_at}]
 */
function sbLoadPhotoVersions(projectId, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.from('photo_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('photo_name', { ascending: true })
    .order('stage', { ascending: true })
    .order('version_num', { ascending: true })
    .then(function(res) {
      if (res.error) {
        console.warn('sbLoadPhotoVersions:', res.error.message);
        callback(res.error.message);
        return;
      }
      callback(null, res.data || []);
    })['catch'](function(err) {
      console.error('sbLoadPhotoVersions catch:', err);
      callback(String(err));
    });
}

/**
 * Загрузить версии конкретного фото (все этапы).
 *
 * @param {string} projectId
 * @param {string} photoName - имя файла (IMG_0001.CR3)
 * @param {function} callback - function(err, versions)
 */
function sbLoadPhotoVersionsByPhoto(projectId, photoName, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.from('photo_versions')
    .select('*')
    .eq('project_id', projectId)
    .eq('photo_name', photoName)
    .order('stage', { ascending: true })
    .order('version_num', { ascending: true })
    .then(function(res) {
      if (res.error) {
        console.warn('sbLoadPhotoVersionsByPhoto:', res.error.message);
        callback(res.error.message);
        return;
      }
      callback(null, res.data || []);
    })['catch'](function(err) {
      console.error('sbLoadPhotoVersionsByPhoto catch:', err);
      callback(String(err));
    });
}

/**
 * Загрузить версии для этапа (например, все CC-версии проекта).
 *
 * @param {string} projectId
 * @param {string} stage - 'color_correction' | 'retouch' | 'grading'
 * @param {function} callback - function(err, versions)
 */
function sbLoadPhotoVersionsByStage(projectId, stage, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.from('photo_versions')
    .select('*')
    .eq('project_id', projectId)
    .eq('stage', stage)
    .order('photo_name', { ascending: true })
    .order('version_num', { ascending: true })
    .then(function(res) {
      if (res.error) {
        console.warn('sbLoadPhotoVersionsByStage:', res.error.message);
        callback(res.error.message);
        return;
      }
      callback(null, res.data || []);
    })['catch'](function(err) {
      console.error('sbLoadPhotoVersionsByStage catch:', err);
      callback(String(err));
    });
}

/**
 * Сохранить (insert) новую версию фото.
 * Использует upsert по unique constraint (project_id, photo_name, stage, version_num).
 *
 * @param {object} version - {project_id, photo_name, stage, version_num, preview_path, cos_path}
 * @param {function} callback - function(err, saved)
 */
function sbSavePhotoVersion(version, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  var row = {
    project_id:  version.project_id,
    photo_name:  version.photo_name,
    stage:       version.stage,
    version_num: version.version_num,
    preview_path: version.preview_path || '',
    cos_path:    version.cos_path || '',
    selected:    version.selected || false
  };

  sbClient.from('photo_versions')
    .upsert(row, { onConflict: 'project_id,photo_name,stage,version_num' })
    .select()
    .then(function(res) {
      if (res.error) {
        console.warn('sbSavePhotoVersion:', res.error.message);
        callback(res.error.message);
        return;
      }
      callback(null, (res.data && res.data[0]) || null);
    })['catch'](function(err) {
      console.error('sbSavePhotoVersion catch:', err);
      callback(String(err));
    });
}

/**
 * Обновить поле selected у версии (заказчик выбрал вариант).
 * Сбрасывает selected у остальных версий того же фото+этапа.
 *
 * @param {string} versionId - UUID версии
 * @param {string} projectId
 * @param {string} photoName
 * @param {string} stage
 * @param {function} callback - function(err)
 */
function sbSelectPhotoVersion(versionId, projectId, photoName, stage, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  /* Шаг 1: сбросить selected у всех версий этого фото на этом этапе */
  sbClient.from('photo_versions')
    .update({ selected: false })
    .eq('project_id', projectId)
    .eq('photo_name', photoName)
    .eq('stage', stage)
    .then(function(res1) {
      if (res1.error) {
        console.warn('sbSelectPhotoVersion reset:', res1.error.message);
        callback(res1.error.message);
        return;
      }

      /* Шаг 2: установить selected=true у выбранной */
      sbClient.from('photo_versions')
        .update({ selected: true })
        .eq('id', versionId)
        .then(function(res2) {
          if (res2.error) {
            console.warn('sbSelectPhotoVersion set:', res2.error.message);
            callback(res2.error.message);
            return;
          }
          callback(null);
        })['catch'](function(err) {
          callback(String(err));
        });
    })['catch'](function(err) {
      callback(String(err));
    });
}

/**
 * Удалить версию фото (и файлы из Storage).
 *
 * @param {string} versionId - UUID версии
 * @param {string} previewPath - путь превью в Storage (для удаления файла)
 * @param {string} cosPath - путь COS в Storage (для удаления файла)
 * @param {function} callback - function(err)
 */
function sbDeletePhotoVersion(versionId, previewPath, cosPath, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  /* Удаляем файлы из Storage (игнорируем ошибки — файлов может не быть) */
  var filesToRemove = [];
  if (previewPath) filesToRemove.push(previewPath);
  if (cosPath) filesToRemove.push(cosPath);

  function deleteRow() {
    sbClient.from('photo_versions')
      .delete()
      .eq('id', versionId)
      .then(function(res) {
        if (res.error) {
          console.warn('sbDeletePhotoVersion:', res.error.message);
          callback(res.error.message);
          return;
        }
        callback(null);
      })['catch'](function(err) {
        callback(String(err));
      });
  }

  if (filesToRemove.length > 0) {
    sbClient.storage.from('postprod').remove(filesToRemove)
      .then(function() { deleteRow(); })
      ['catch'](function() { deleteRow(); }); /* удаляем запись даже если файл не удалился */
  } else {
    deleteRow();
  }
}


// ══════════════════════════════════════════════
//  Postprod Storage (загрузка/скачивание файлов)
// ══════════════════════════════════════════════

/**
 * Загрузить файл в бакет postprod (превью JPEG или COS).
 * Конвертирует base64 data URL в Blob.
 *
 * @param {string} storagePath - путь внутри бакета: {project_id}/{stem}/{stage}_{N}.jpg
 * @param {string} base64Data  - data URL (data:image/jpeg;base64,...) или raw base64
 * @param {string} contentType - MIME тип ('image/jpeg' или 'application/octet-stream')
 * @param {function} callback  - function(err, publicUrl)
 */
function sbUploadPostprodFile(storagePath, base64Data, contentType, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  /* Конвертируем base64 в Blob */
  var raw;
  if (base64Data.indexOf('data:') === 0) {
    /* data URL: data:mime;base64,XXXXX */
    var parts = base64Data.split(',');
    raw = atob(parts[1]);
  } else {
    /* чистый base64 */
    raw = atob(base64Data);
  }
  var array = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
  var blob = new Blob([array], { type: contentType });

  sbClient.storage.from('postprod').upload(storagePath, blob, {
    contentType: contentType,
    upsert: true
  }).then(function(res) {
    if (res.error) {
      console.warn('sbUploadPostprodFile:', res.error.message);
      callback(res.error.message);
      return;
    }
    /* Получаем URL для скачивания (signed или public) */
    var urlRes = sbClient.storage.from('postprod').getPublicUrl(storagePath);
    callback(null, urlRes.data.publicUrl);
  })['catch'](function(err) {
    console.error('sbUploadPostprodFile catch:', err);
    callback(String(err));
  });
}

/**
 * Скачать файл из бакета postprod как Blob.
 * Используется для скачивания COS-файлов (клиент → Python → диск).
 *
 * @param {string} storagePath - путь внутри бакета
 * @param {function} callback - function(err, base64)
 */
function sbDownloadPostprodFile(storagePath, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  sbClient.storage.from('postprod').download(storagePath)
    .then(function(res) {
      if (res.error) {
        console.warn('sbDownloadPostprodFile:', res.error.message);
        callback(res.error.message);
        return;
      }

      /* Blob → base64 через FileReader */
      var reader = new FileReader();
      reader.onload = function() {
        /* result = data:...;base64,XXXX — извлекаем чистый base64 */
        var dataUrl = reader.result;
        var b64 = dataUrl.split(',')[1] || '';
        callback(null, b64);
      };
      reader.onerror = function() {
        callback('Ошибка чтения файла');
      };
      reader.readAsDataURL(res.data);
    })['catch'](function(err) {
      console.error('sbDownloadPostprodFile catch:', err);
      callback(String(err));
    });
}

/**
 * Получить публичный URL для превью версии (JPEG в бакете postprod).
 *
 * @param {string} storagePath - путь внутри бакета
 * @returns {string} публичный URL или ''
 */
function sbGetPostprodUrl(storagePath) {
  if (!sbClient || !storagePath) return '';
  var res = sbClient.storage.from('postprod').getPublicUrl(storagePath);
  return (res.data && res.data.publicUrl) || '';
}

/**
 * Загрузить версию ЦК с desktop: превью JPEG + COS файл → Storage + запись в БД.
 * Высокоуровневая функция: объединяет upload файлов и insert записи.
 *
 * Используется из desktop (pywebview): Python читает файлы с диска,
 * JS загружает в Supabase Storage и создаёт запись.
 *
 * @param {object} opts
 *   opts.projectId   — UUID проекта
 *   opts.photoName   — имя файла (IMG_0001.CR3)
 *   opts.stage       — 'color_correction' | 'retouch' | 'grading'
 *   opts.versionNum  — номер версии (1, 2, 3...)
 *   opts.previewB64  — base64 превью JPEG (от Python version_read_preview)
 *   opts.cosB64      — base64 COS файла (от Python version_collect_cos), может быть ''
 * @param {function} callback — function(err, savedVersion)
 */
function sbUploadPhotoVersion(opts, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }

  var stem = opts.photoName.replace(/\.[^.]+$/, ''); /* IMG_0001.CR3 → IMG_0001 */
  var prefix = opts.projectId + '/' + stem + '/' + opts.stage + '_' + opts.versionNum;

  var previewStoragePath = '';
  var cosStoragePath = '';

  /* Шаг 1: загрузить превью JPEG */
  function uploadPreview(done) {
    if (!opts.previewB64) { done(); return; }

    previewStoragePath = prefix + '.jpg';
    sbUploadPostprodFile(previewStoragePath, opts.previewB64, 'image/jpeg', function(err) {
      if (err) console.warn('sbUploadPhotoVersion: ошибка загрузки превью —', err);
      /* продолжаем даже при ошибке превью */
      done();
    });
  }

  /* Шаг 2: загрузить COS файл */
  function uploadCos(done) {
    if (!opts.cosB64) { done(); return; }

    cosStoragePath = prefix + '.cos';
    sbUploadPostprodFile(cosStoragePath, opts.cosB64, 'application/octet-stream', function(err) {
      if (err) console.warn('sbUploadPhotoVersion: ошибка загрузки COS —', err);
      done();
    });
  }

  /* Шаг 3: создать запись в БД */
  function saveRecord() {
    sbSavePhotoVersion({
      project_id:   opts.projectId,
      photo_name:   opts.photoName,
      stage:        opts.stage,
      version_num:  opts.versionNum,
      preview_path: previewStoragePath,
      cos_path:     cosStoragePath
    }, callback);
  }

  /* Выполняем последовательно: превью → COS → запись */
  uploadPreview(function() {
    uploadCos(function() {
      saveRecord();
    });
  });
}

/**
 * Скачать COS версии и восстановить на диск через Python API.
 * Для desktop: JS скачивает из Storage, Python пишет на диск.
 *
 * @param {string} cosStoragePath - путь COS в бакете postprod
 * @param {string} photoStem - имя фото без расширения (IMG_0001)
 * @param {function} callback - function(err, localPath)
 */
function sbRestoreCosToDesktop(cosStoragePath, photoStem, callback) {
  if (!sbClient) { callback('Supabase не подключён'); return; }
  if (!window.pywebview || !window.pywebview.api) {
    callback('Доступно только в desktop-режиме');
    return;
  }

  sbDownloadPostprodFile(cosStoragePath, function(err, cosBase64) {
    if (err) { callback(err); return; }

    window.pywebview.api.version_restore_cos(photoStem, cosBase64)
      .then(function(result) {
        if (result.error) { callback(result.error); return; }
        callback(null, result.path);
      })['catch'](function(e) {
        callback(String(e));
      });
  });
}


// ══════════════════════════════════════════════
//  Команды и участники проекта (b23)
// ══════════════════════════════════════════════

/**
 * Загрузить команду текущего пользователя.
 * Пользователь может быть владельцем одной команды и участником нескольких.
 * @param {function(err, {owned: object|null, memberOf: Array})} callback
 */
function sbLoadTeams(callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  var result = { owned: null, memberOf: [] };

  /* Команда, которой я владею (одна) */
  sbClient.from('teams').select('*').eq('owner_id', sbCurrentUserId())
    .then(function(res) {
      if (res.error) { callback(res.error.message); return; }
      result.owned = (res.data && res.data.length > 0) ? res.data[0] : null;

      /* Команды, в которых я участник */
      sbClient.from('team_members').select('team_id, role, teams(id, name, owner_id, profiles!teams_owner_id_fkey(email, name))')
        .eq('user_id', sbCurrentUserId())
        .then(function(res2) {
          if (res2.error) { callback(res2.error.message); return; }
          result.memberOf = res2.data || [];
          callback(null, result);
        });
    });
}

/**
 * Создать команду (одна на пользователя).
 * @param {string} name - название команды (студия, агентство)
 * @param {function(err, team)} callback
 */
function sbCreateTeam(name, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('teams').insert({ name: name, owner_id: sbCurrentUserId() })
    .select().single()
    .then(function(res) {
      if (res.error) { callback(res.error.message); return; }
      callback(null, res.data);
    });
}

/**
 * Переименовать команду.
 * @param {string} teamId
 * @param {string} newName
 * @param {function(err)} callback
 */
function sbRenameTeam(teamId, newName, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('teams').update({ name: newName }).eq('id', teamId)
    .then(function(res) {
      callback(res.error ? res.error.message : null);
    });
}

/**
 * Загрузить участников команды.
 * @param {string} teamId
 * @param {function(err, Array)} callback
 */
function sbLoadTeamMembers(teamId, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('team_members')
    .select('user_id, role, joined_at, profiles(email, name)')
    .eq('team_id', teamId)
    .then(function(res) {
      if (res.error) { callback(res.error.message); return; }
      callback(null, res.data || []);
    });
}

/**
 * Пригласить в команду по email (RPC).
 * @param {string} teamId
 * @param {string} email
 * @param {string} role - 'admin' | 'member'
 * @param {function(err, result)} callback - result: {status, user_id, email, name}
 */
function sbInviteToTeam(teamId, email, role, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.rpc('invite_to_team', {
    p_team_id: teamId,
    p_email: email.trim().toLowerCase(),
    p_role: role || 'member'
  }).then(function(res) {
    if (res.error) { callback(res.error.message); return; }
    callback(null, res.data);
  });
}

/**
 * Удалить участника из команды.
 * @param {string} teamId
 * @param {string} userId
 * @param {function(err)} callback
 */
function sbRemoveTeamMember(teamId, userId, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .then(function(res) {
      callback(res.error ? res.error.message : null);
    });
}

/**
 * Привязать проект к команде (все участники увидят).
 * @param {string} projectCloudId
 * @param {string|null} teamId - null = открепить от команды
 * @param {function(err)} callback
 */
function sbSetProjectTeam(projectCloudId, teamId, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('projects').update({ team_id: teamId }).eq('id', projectCloudId)
    .then(function(res) {
      callback(res.error ? res.error.message : null);
    });
}

/**
 * Пригласить в проект по email (RPC).
 * @param {string} projectCloudId
 * @param {string} email
 * @param {string} role - 'editor' | 'viewer'
 * @param {function(err, result)} callback
 */
function sbInviteToProject(projectCloudId, email, role, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.rpc('invite_to_project', {
    p_project_id: projectCloudId,
    p_email: email.trim().toLowerCase(),
    p_role: role || 'editor'
  }).then(function(res) {
    if (res.error) { callback(res.error.message); return; }
    callback(null, res.data);
  });
}

/**
 * Загрузить участников конкретного проекта.
 * @param {string} projectCloudId
 * @param {function(err, Array)} callback
 */
function sbLoadProjectMembers(projectCloudId, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('project_members')
    .select('user_id, role, joined_at, profiles(email, name)')
    .eq('project_id', projectCloudId)
    .then(function(res) {
      if (res.error) { callback(res.error.message); return; }
      callback(null, res.data || []);
    });
}

/**
 * Удалить участника из проекта.
 * @param {string} projectCloudId
 * @param {string} userId
 * @param {function(err)} callback
 */
function sbRemoveProjectMember(projectCloudId, userId, callback) {
  if (!sbClient) { callback('SDK not initialized'); return; }

  sbClient.from('project_members')
    .delete()
    .eq('project_id', projectCloudId)
    .eq('user_id', userId)
    .then(function(res) {
      callback(res.error ? res.error.message : null);
    });
}

/**
 * Получить ID текущего пользователя.
 * @returns {string|null}
 */
function sbCurrentUserId() {
  if (!sbClient) return null;
  var session = sbClient.auth.getSession && sbClient.auth.getSession();
  /* getSession() может вернуть promise в новых версиях SDK */
  if (session && session.data && session.data.session) {
    return session.data.session.user.id;
  }
  /* fallback: проверяем _sbUser (может быть установлен при логине) */
  if (typeof _sbUser !== 'undefined' && _sbUser && _sbUser.id) return _sbUser.id;
  return null;
}


// ══════════════════════════════════════════════
//  Snapshots — снимки состояния проекта
// ══════════════════════════════════════════════

/**
 * Активный снимок-контекст.
 * Если не null — Rate Setter, синхронизация и другие инструменты
 * читают список фото из этого снимка, а не из живых карточек.
 *
 * @type {null|{id: string, stageId: string, trigger: string, note: string, data: object, created_at: string}}
 */
var _snActiveSnapshot = null;

/**
 * Кэш загруженных снимков для текущего проекта.
 * @type {Array}
 */
var _snCachedSnapshots = [];

/**
 * Установить активный снимок-контекст (или null для текущего состояния).
 * Обновляет индикатор в UI.
 *
 * @param {object|null} snapshot — объект снимка из Supabase или null
 */
function snSetActiveContext(snapshot) {
  _snActiveSnapshot = snapshot;
  _snUpdateContextIndicator();
  console.log('snSetActiveContext:', snapshot ? ('снимок ' + snapshot.trigger + ' ' + snapshot.created_at) : 'текущее состояние');
}

/**
 * Получить список файлов из активного контекста.
 * Если активен снимок — берёт из снимка. Иначе — из живых карточек.
 *
 * Используется Rate Setter, синхронизацией и другими инструментами
 * вместо прямого чтения proj.cards.
 *
 * @returns {string[]} — массив имён файлов (stems без расширения НЕ убираются)
 */
function snGetActiveFiles() {
  if (_snActiveSnapshot && _snActiveSnapshot.data) {
    var data = _snActiveSnapshot.data;
    var names = {};
    (data.cards || []).forEach(function(card) {
      (card.slots || []).forEach(function(slot) {
        if (slot.file) names[slot.file] = true;
      });
    });
    (data.ocContainers || []).forEach(function(cnt) {
      (cnt.items || []).forEach(function(it) {
        var name = (typeof it === 'string') ? it : it.name || it;
        if (name) names[name] = true;
      });
    });
    return Object.keys(names);
  }

  /* Фолбэк: текущее состояние проекта */
  var proj = getActiveProject();
  if (!proj) return [];
  var names = {};
  (proj.cards || []).forEach(function(card) {
    (card.slots || []).forEach(function(slot) {
      if (slot.file) names[slot.file] = true;
    });
  });
  (proj.otherContent || []).forEach(function(oc) {
    if (oc.name) names[oc.name] = true;
  });
  (proj.ocContainers || []).forEach(function(cnt) {
    (cnt.items || []).forEach(function(it) {
      if (it.name) names[it.name] = true;
    });
  });
  return Object.keys(names);
}

/**
 * Получить данные карточек из активного контекста (для отображения).
 * @returns {object} — { cards: [...], ocContainers: [...] } из снимка или текущего состояния
 */
function snGetActiveData() {
  if (_snActiveSnapshot && _snActiveSnapshot.data) {
    return _snActiveSnapshot.data;
  }
  return snBuildSnapshotData();
}

/**
 * Проверить, активен ли режим просмотра снимка.
 * @returns {boolean}
 */
function snIsViewingSnapshot() {
  return _snActiveSnapshot !== null;
}

/**
 * Обновить индикатор контекста в UI (баннер вверху экрана).
 * @private
 */
function _snUpdateContextIndicator() {
  var existing = document.getElementById('sn-context-banner');
  if (existing) existing.remove();

  if (!_snActiveSnapshot) return;

  var snap = _snActiveSnapshot;
  var triggerLabels = {
    'client_approved': 'Согласование клиента',
    'client_changes': 'Изменения клиента',
    'client_edit_start': 'До изменений клиента',
    'manual_advance': 'Переход этапа',
    'manual': 'Ручной снимок'
  };
  var label = triggerLabels[snap.trigger] || snap.trigger;
  var dateStr = '';
  if (snap.created_at) {
    var d = new Date(snap.created_at);
    dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  var banner = document.createElement('div');
  banner.id = 'sn-context-banner';
  banner.className = 'sn-context-banner';
  banner.innerHTML =
    '<span class="sn-ctx-label">Просмотр: ' + esc(label) + (dateStr ? ' (' + dateStr + ')' : '') + '</span>' +
    '<span class="sn-ctx-note">' + esc(snap.note || '') + '</span>' +
    '<button class="btn sn-ctx-close" onclick="snSetActiveContext(null)">Вернуться к текущему</button>';

  var appMain = document.getElementById('app-main');
  if (appMain) appMain.insertBefore(banner, appMain.firstChild);
}

/**
 * Собрать слепок текущего состояния проекта (cards + ocContainers).
 * Возвращает компактный JSON без base64/dataUrl.
 *
 * @returns {object} { cards: [...], ocContainers: [...] }
 */
function snBuildSnapshotData() {
  var proj = getActiveProject();
  if (!proj) return { cards: [], ocContainers: [] };

  /* Карточки: для каждого слота сохраняем имя файла + ориентацию + вес */
  var cardsData = (proj.cards || []).map(function(card, ci) {
    var slotsData = (card.slots || []).map(function(slot, si) {
      return {
        position: si,
        orient: slot.orient || 'v',
        weight: slot.weight || 1,
        row: slot.row !== undefined ? slot.row : null,
        file: slot.file || null,
        rotation: slot.rotation || 0
      };
    });
    return {
      position: ci,
      status: card.status || 'draft',
      category: card.category || '',
      hasHero: card._hasHero !== undefined ? card._hasHero : true,
      hAspect: card._hAspect || '3/2',
      vAspect: card._vAspect || '2/3',
      lockRows: card._lockRows || false,
      slots: slotsData
    };
  });

  /* Контейнеры: id, name, список имён файлов */
  var cntData = (proj.ocContainers || []).map(function(cnt) {
    return {
      id: cnt.id,
      name: cnt.name,
      items: (cnt.items || []).map(function(it) { return it.name; })
    };
  });

  return { cards: cardsData, ocContainers: cntData };
}

/**
 * Создать снимок и сохранить в Supabase (через RPC create_snapshot).
 *
 * @param {string} stageId — 'client', 'color', etc.
 * @param {string} trigger — 'client_approved', 'client_changes', 'manual'
 * @param {string} [note] — описание
 * @param {function(err, snapshotId)} callback
 */
function snCreateSnapshot(stageId, trigger, note, callback) {
  callback = callback || function() {};
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) { callback('Нет cloudId'); return; }
  if (!sbClient) { callback('SDK not initialized'); return; }

  var data = snBuildSnapshotData();
  var actor = (typeof sbGetActor === 'function') ? sbGetActor() : {};

  sbClient.rpc('create_snapshot', {
    p_project_id: proj._cloudId,
    p_stage_id: stageId,
    p_trigger: trigger,
    p_actor_id: actor.id || null,
    p_actor_token: actor.token || null,
    p_actor_name: actor.name || null,
    p_data: data,
    p_note: note || null
  }).then(function(res) {
    if (res.error) {
      console.error('snCreateSnapshot:', res.error);
      callback(res.error.message);
    } else {
      console.log('snCreateSnapshot: снимок создан, id=' + res.data);
      callback(null, res.data);
    }
  });
}

/**
 * Загрузить все снимки проекта.
 * Владелец: напрямую из таблицы. Клиент: через RPC get_snapshots_by_token.
 *
 * @param {function(err, snapshots[])} callback
 */
function snLoadSnapshots(callback) {
  callback = callback || function() {};
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) { callback('Нет cloudId', []); return; }
  if (!sbClient) { callback('SDK not initialized', []); return; }

  var isClient = !!window._shareToken;

  if (isClient) {
    sbClient.rpc('get_snapshots_by_token', { p_token: window._shareToken })
      .then(function(res) {
        if (res.error) { callback(res.error.message, []); return; }
        callback(null, res.data || []);
      });
  } else {
    sbClient.from('snapshots')
      .select('*')
      .eq('project_id', proj._cloudId)
      .order('created_at', { ascending: true })
      .then(function(res) {
        if (res.error) { callback(res.error.message, []); return; }
        callback(null, res.data || []);
      });
  }
}

/**
 * Сравнить два снимка (или снимок vs текущее состояние).
 * Возвращает diff: какие фото добавлены, удалены, перемещены.
 *
 * @param {object} before — snapshot.data (cards + ocContainers)
 * @param {object} after — snapshot.data или snBuildSnapshotData()
 * @returns {object} { added: [filename,...], removed: [filename,...], moved: [{file, fromCard, toCard},...] }
 */
function snCompareSnapshots(before, after) {
  var result = { added: [], removed: [], moved: [] };

  /* Собираем карту: filename → {cardIdx, slotIdx} для обоих состояний */
  function buildFileMap(data) {
    var map = {};
    (data.cards || []).forEach(function(card, ci) {
      (card.slots || []).forEach(function(slot, si) {
        if (slot.file) {
          map[slot.file] = { card: ci, slot: si, location: 'card' };
        }
      });
    });
    (data.ocContainers || []).forEach(function(cnt, ci) {
      (cnt.items || []).forEach(function(itemName) {
        var name = (typeof itemName === 'string') ? itemName : itemName.name || itemName;
        if (name) map[name] = { container: ci, containerName: cnt.name, location: 'container' };
      });
    });
    return map;
  }

  var mapBefore = buildFileMap(before);
  var mapAfter = buildFileMap(after);

  /* Удалённые: были в before, нет в after */
  for (var fb in mapBefore) {
    if (!mapAfter[fb]) {
      result.removed.push(fb);
    } else if (mapBefore[fb].card !== mapAfter[fb].card || mapBefore[fb].slot !== mapAfter[fb].slot ||
               mapBefore[fb].location !== mapAfter[fb].location) {
      result.moved.push({
        file: fb,
        from: mapBefore[fb],
        to: mapAfter[fb]
      });
    }
  }

  /* Добавленные: есть в after, нет в before */
  for (var fa in mapAfter) {
    if (!mapBefore[fa]) {
      result.added.push(fa);
    }
  }

  return result;
}

/**
 * Получить набор имён файлов в снимке (или текущем состоянии) — для быстрых проверок.
 * @param {object} snapshotData — { cards, ocContainers }
 * @returns {object} — { fileInSlots: {filename: true}, fileInContainers: {filename: true} }
 */
function snGetFileSet(snapshotData) {
  var slots = {};
  var containers = {};
  (snapshotData.cards || []).forEach(function(card) {
    (card.slots || []).forEach(function(slot) {
      if (slot.file) slots[slot.file] = true;
    });
  });
  (snapshotData.ocContainers || []).forEach(function(cnt) {
    (cnt.items || []).forEach(function(it) {
      var name = (typeof it === 'string') ? it : it.name || it;
      if (name) containers[name] = true;
    });
  });
  return { fileInSlots: slots, fileInContainers: containers };
}


// ══════════════════════════════════════════════
//  Realtime: подписка на новые версии (ЦК/ретушь)
//  Веб-клиент автоматически получает обновления
//  когда десктоп загружает новую версию в облако.
// ══════════════════════════════════════════════

/** @type {Object|null} Активная realtime-подписка */
var _sbVersionChannel = null;

/**
 * Подписаться на изменения photo_versions для проекта.
 * При получении INSERT — подтянуть новую версию и обновить превью.
 * @param {string} projectId — cloud ID проекта
 */
function sbSubscribeVersions(projectId) {
  if (!sbClient || !projectId) return;

  /* Отписаться от предыдущей подписки */
  sbUnsubscribeVersions();

  try {
    _sbVersionChannel = sbClient
      .channel('photo_versions_' + projectId)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'photo_versions',
        filter: 'project_id=eq.' + projectId
      }, function(payload) {
        var row = payload.new;
        if (!row) return;
        console.log('realtime: новая версия — ' + row.photo_name + ' (' + row.stage + ')');
        _sbApplyVersionUpdate(row);
      })
      .subscribe(function(status) {
        console.log('realtime photo_versions: ' + status);
      });
  } catch(err) {
    console.warn('sbSubscribeVersions:', err);
  }
}

/**
 * Отписаться от realtime-канала версий.
 */
function sbUnsubscribeVersions() {
  if (_sbVersionChannel && sbClient) {
    try { sbClient.removeChannel(_sbVersionChannel); } catch(e) {}
    _sbVersionChannel = null;
  }
}

/**
 * Применить обновление версии из realtime-события.
 * Находит pv-объект по имени, добавляет версию, перерисовывает.
 * @param {Object} row — строка из photo_versions (photo_name, stage, preview_path)
 */
function _sbApplyVersionUpdate(row) {
  var proj = getActiveProject();
  if (!proj || !proj.previews || !proj._cloudId) return;
  if (proj._cloudId !== row.project_id) return;

  /* Найти pv-объект по имени */
  var pv = null;
  for (var i = 0; i < proj.previews.length; i++) {
    if (proj.previews[i].name === row.photo_name) {
      pv = proj.previews[i];
      break;
    }
  }
  if (!pv) return;

  /* Добавить/обновить версию */
  if (!pv.versions) pv.versions = {};
  if (!pv.versions[row.stage]) {
    pv.versions[row.stage] = {
      thumb: row.preview_path || '',
      preview: row.preview_path || ''
    };
  }

  /* Автопереключение на новую версию + перерисовка */
  if (typeof PV_ACTIVE_VERSION !== 'undefined') {
    PV_ACTIVE_VERSION = row.stage;
    proj._activeVersion = row.stage;
  }
  if (typeof pvRenderAll === 'function') pvRenderAll();
  if (typeof pvUpdateCardSlotsForVersion === 'function') pvUpdateCardSlotsForVersion();
}

/**
 * Ручное обновление версий из облака (кнопка "Обновить").
 * Загружает photo_versions и применяет к текущему проекту.
 */
function sbRefreshVersions() {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId || !sbClient) return;

  var pvByName = {};
  if (proj.previews) {
    for (var i = 0; i < proj.previews.length; i++) {
      pvByName[proj.previews[i].name] = proj.previews[i];
    }
  }

  _sbLoadAndAttachVersions(proj._cloudId, proj, pvByName, function() {
    console.log('sbRefreshVersions: версии обновлены');
    /* Определить активную версию: последняя загруженная */
    var latestStage = '';
    for (var name in pvByName) {
      if (!pvByName.hasOwnProperty(name)) continue;
      var pv = pvByName[name];
      if (pv.versions) {
        if (pv.versions.retouch) { latestStage = 'retouch'; break; }
        if (pv.versions.color) latestStage = 'color';
      }
    }
    if (latestStage && typeof PV_ACTIVE_VERSION !== 'undefined') {
      PV_ACTIVE_VERSION = latestStage;
      proj._activeVersion = latestStage;
    }
    if (typeof pvRenderAll === 'function') pvRenderAll();
    if (typeof pvUpdateCardSlotsForVersion === 'function') pvUpdateCardSlotsForVersion();
  });
}


// Автоинициализация
if (typeof window !== 'undefined') {
  // Вызовется после загрузки Supabase SDK
  window.addEventListener('DOMContentLoaded', function() {
    // Даём SDK время загрузиться (он async)
    setTimeout(function() {
      sbInit();
      sbCheckShareToken();
    }, 100);
  });
}
