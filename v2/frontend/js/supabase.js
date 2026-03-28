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
  // Поддерживаем оба формата: shoot_date (browser) и shootDate (legacy)
  var projData = {
    owner_id: sbUser.id,
    brand: proj.brand || '',
    shoot_date: proj.shoot_date || proj.shootDate || '',
    template_id: proj.templateId || '',
    stage: proj._stage || proj.stage || 0,
    channels: JSON.stringify(proj.channels || []),
    updated_at: new Date().toISOString()
  };

  var upsertProject;
  if (cloudId) {
    // Обновляем существующий
    upsertProject = sbClient.from('projects').update(projData).eq('id', cloudId).select().single();
  } else {
    // Создаём новый
    upsertProject = sbClient.from('projects').insert(projData).select().single();
  }

  upsertProject.then(function(res) {
    if (res.error) { callback('Ошибка проекта: ' + res.error.message); return; }

    var savedProj = res.data;
    proj._cloudId = savedProj.id;

    // Загружаем карточки
    sbUploadCards(savedProj.id, proj.cards || [], function(err) {
      if (err) { callback(err); return; }
      callback(null, savedProj.id);
    });
  });
}

/**
 * Загрузить карточки проекта в облако.
 * Стратегия: удалить старые → вставить новые (проще чем diff).
 *
 * @param {string} projectId — UUID проекта в Supabase
 * @param {Array} cards — массив карточек из локального проекта
 * @param {function} callback — callback(error)
 */
function sbUploadCards(projectId, cards, callback) {
  // Удаляем старые карточки (каскадно удалит слоты)
  sbClient.from('cards').delete().eq('project_id', projectId).then(function(delRes) {
    if (delRes.error) { callback('Ошибка удаления карточек: ' + delRes.error.message); return; }

    if (!cards || cards.length === 0) { callback(null); return; }

    // Подготовка строк cards + slots
    var cardRows = [];
    var slotRows = [];

    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      var cardId = card.id || ('card_' + c);

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
          slotRows.push({
            card_id: cardId,
            project_id: projectId,
            position: s,
            orient: slot.orient || 'v',
            weight: slot.weight || 1,
            row_num: (slot.row !== undefined) ? slot.row : null,
            rotation: slot.rotation || 0,
            file_name: slot.file || null,
            thumb_path: null,      // TODO: загрузить thumb в storage
            original_path: null    // TODO: загрузить оригинал в storage
          });
        }
      }
    }

    // Вставляем карточки
    sbClient.from('cards').insert(cardRows).then(function(cardRes) {
      if (cardRes.error) { callback('Ошибка карточек: ' + cardRes.error.message); return; }

      if (slotRows.length === 0) { callback(null); return; }

      // Вставляем слоты
      sbClient.from('slots').insert(slotRows).then(function(slotRes) {
        if (slotRes.error) { callback('Ошибка слотов: ' + slotRes.error.message); return; }
        callback(null);
      });
    });
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
              dataUrl: null,
              path: null
            });
          }

          proj.cards.push(card);
        }

        callback(null, proj);
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
    var url = window.location.origin + window.location.pathname + '?share=' + link.token;

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
    var proj = {
      _cloudId: data.project_id,
      brand: data.brand || '',
      shoot_date: data.shoot_date || '',
      templateId: data.template_id || '',
      _stage: data.stage || 0,
      _stageHistory: {},
      _role: data.role || 'client',
      channels: [],
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
              dataUrl: null,
              path: null
            });
          }
        }
        proj.cards.push(card);
      }
    }

    App.projects.push(proj);
    App.selectedProject = App.projects.length - 1;
    if (typeof renderProjects === 'function') renderProjects();

    /* Клиентский режим */
    if (proj._role === 'client' && typeof shEnterClientMode === 'function') {
      shEnterClientMode();
    }

    console.log('Проект загружен по share-ссылке:', proj.brand, 'роль:', proj._role);
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
