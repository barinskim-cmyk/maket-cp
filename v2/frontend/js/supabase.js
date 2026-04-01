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

  var projData = {
    owner_id: sbUser.id,
    brand: proj.brand || '',
    shoot_date: proj.shoot_date || proj.shootDate || '',
    template_id: proj.templateId || '',
    stage: proj._stage || proj.stage || 0,
    channels: JSON.stringify(proj.channels || []),
    other_content: JSON.stringify(ocNames),
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
      _stage: remote.stage || 0,
      _stageHistory: {},
      channels: (typeof remote.channels === 'string') ? JSON.parse(remote.channels || '[]') : (remote.channels || []),
      _ocNames: (typeof remote.other_content === 'string') ? JSON.parse(remote.other_content || '[]') : (remote.other_content || []),
      cards: [],
      previews: [],
      otherContent: []
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

        // Собираем карточки
        var remoteCards = cardRes.data || [];
        for (var c = 0; c < remoteCards.length; c++) {
          var rc = remoteCards[c];
          var card = {
            id: rc.id,
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
            card.slots.push({
              orient: rs.orient,
              weight: rs.weight,
              row: rs.row_num,
              rotation: rs.rotation,
              file: rs.file_name,
              dataUrl: rs.thumb_path || null,
              path: null
            });
          }

          proj.cards.push(card);
        }

        // Загружаем превью-галерею
        sbDownloadPreviews(cloudId, function(pvErr, pvList) {
          if (!pvErr && pvList) proj.previews = pvList;

          /* Кросс-ссылка: заполняем dataUrl слотов из превью если thumb_path был пуст.
             Это покрывает случай когда слоты вставлены через SQL без thumb_path,
             а превью загружены отдельно через UI. */
          if (proj.previews && proj.previews.length > 0) {
            var pvByName = {};
            for (var pi = 0; pi < proj.previews.length; pi++) {
              pvByName[proj.previews[pi].name] = proj.previews[pi];
            }

            for (var ci = 0; ci < proj.cards.length; ci++) {
              var cardSlots = proj.cards[ci].slots;
              for (var si = 0; si < cardSlots.length; si++) {
                if (!cardSlots[si].dataUrl && cardSlots[si].file) {
                  var matchPv = pvByName[cardSlots[si].file];
                  if (matchPv) {
                    cardSlots[si].dataUrl = matchPv.thumb || matchPv.preview || null;
                    console.log('supabase.js: slot thumb восстановлен из превью: ' + cardSlots[si].file);
                  }
                }
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
          }
          delete proj._ocNames;

          callback(null, proj);
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

  sbClient.from('projects')
    .select('id, brand, shoot_date, stage, updated_at')
    .eq('owner_id', sbUser.id)
    .order('updated_at', { ascending: false })
    .then(function(res) {
      if (res.error) callback(res.error.message, []);
      else callback(null, res.data || []);
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
    /* Share-ссылки всегда через GitHub Pages (Netlify заблокирован в России).
       Если сайт открыт на Netlify или localhost — подставляем GitHub Pages URL. */
    var origin = window.location.origin;
    var pathname = window.location.pathname;
    if (origin.indexOf('netlify.app') !== -1 || origin.indexOf('localhost') !== -1 || origin.indexOf('127.0.0.1') !== -1) {
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
  /* Ждём пока Supabase SDK загрузится */
  var attempts = 0;
  var interval = setInterval(function() {
    attempts++;
    if (sbClient) {
      clearInterval(interval);
      _sbDoLoadByToken(token);
    } else if (attempts > 50) {
      clearInterval(interval);
      alert('Не удалось подключиться к серверу');
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
      _stage: data.stage || 0,
      _stageHistory: {},
      _role: data.role || 'client',
      channels: [],
      _ocNames: (typeof ocRaw === 'string') ? JSON.parse(ocRaw) : (ocRaw || []),
      cards: [],
      previews: [],
      otherContent: []
    };

    /* Если RPC вернул карточки — распарсить */
    if (data.cards && Array.isArray(data.cards)) {
      for (var c = 0; c < data.cards.length; c++) {
        var rc = data.cards[c];
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
            card.slots.push({
              orient: rs.orient || 'v',
              weight: rs.weight || 1,
              row: rs.row_num,
              rotation: rs.rotation || 0,
              file: rs.file_name || null,
              dataUrl: rs.preview_path || rs.thumb_path || null,
              thumbUrl: rs.thumb_path || null,
              path: null
            });
          }
        }
        proj.cards.push(card);
      }
    }

    /* Загружаем превью-галерею для клиента */
    sbDownloadPreviews(data.project_id, function(pvErr, pvList) {
      if (!pvErr && pvList && pvList.length > 0) {
        proj.previews = pvList;
        console.log('supabase.js: загружено ' + pvList.length + ' превью по share-ссылке');
      }

      /* Кросс-ссылка: заполняем dataUrl слотов из превью если thumb_path был пуст */
      if (proj.previews && proj.previews.length > 0) {
        var pvByName = {};
        for (var pi = 0; pi < proj.previews.length; pi++) {
          pvByName[proj.previews[pi].name] = proj.previews[pi];
        }

        for (var ci = 0; ci < proj.cards.length; ci++) {
          var cardSlots = proj.cards[ci].slots;
          for (var si = 0; si < cardSlots.length; si++) {
            if (!cardSlots[si].dataUrl && cardSlots[si].file) {
              var matchPv = pvByName[cardSlots[si].file];
              if (matchPv) {
                cardSlots[si].dataUrl = matchPv.thumb || matchPv.preview || null;
              }
            }
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
          console.log('supabase.js: восстановлено ' + proj.otherContent.length + ' доп. контент');
        }
      }
      delete proj._ocNames;

      /* Share-ссылка: заменяем все проекты, чтобы гарантировать правильный выбор */
      App.projects = [proj];
      App.selectedProject = 0;
      if (typeof renderProjects === 'function') renderProjects();

      /* Клиентский режим */
      if (proj._role === 'client' && typeof shEnterClientMode === 'function') {
        shEnterClientMode();
      }

      /* Отрисовать превью */
      if (typeof pvRenderGallery === 'function') {
        setTimeout(function() { pvRenderGallery(); }, 200);
      }

      console.log('Проект загружен по share-ссылке:', proj.brand, 'роль:', proj._role);
    });
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

  sbClient.rpc('save_cards_by_token', {
    share_token: token,
    cards_data: cardsJson,
    oc_data: JSON.stringify(ocNames)
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

  /* Обновить other_content в проекте */
  var proj = getActiveProject();
  if (proj) {
    var ocNames = (proj.otherContent || []).map(function(oc) { return oc.name; });
    sbClient.from('projects').update({
      other_content: JSON.stringify(ocNames),
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
 * Вызывается из cpSaveHistory после каждого изменения карточки.
 * Debounce: синхронизирует карточки через 2 сек после последнего изменения.
 * Использует sbSyncCardsLight (без перезаливки картинок).
 * Для клиента: sbSaveCardsByToken через RPC.
 */
function sbAutoSyncCards() {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;

  /* Не запускать если предыдущая синхронизация ещё идёт */
  if (_sbCardSyncRunning) return;

  /* Клиент по share-ссылке (не авторизован, есть токен) */
  var isClient = !!window._shareToken;
  /* Фотограф (авторизован) */
  var isOwner = sbIsLoggedIn();

  if (!isClient && !isOwner) return;

  if (_sbCardSyncTimer) clearTimeout(_sbCardSyncTimer);
  _sbCardSyncTimer = setTimeout(function() {
    _sbCardSyncTimer = null;
    _sbCardSyncRunning = true;

    function onDone(err) {
      _sbCardSyncRunning = false;
      if (err) console.warn('Авто-синхронизация карточек:', err);
      else console.log('supabase.js: карточки синхронизированы');
    }

    if (isClient) {
      sbSaveCardsByToken(window._shareToken, proj.cards || [], onDone);
    } else {
      sbSyncCardsLight(proj._cloudId, proj.cards || [], onDone);
    }
  }, SB_CARD_SYNC_DELAY);
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
