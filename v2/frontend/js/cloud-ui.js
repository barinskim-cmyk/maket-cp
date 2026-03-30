/* ══════════════════════════════════════════════
   cloud-ui.js — UI для облачной синхронизации
   ══════════════════════════════════════════════

   Зависит от: state.js (App, getActiveProject, openModal, closeModal)
               supabase.js (sb* функции)
               shootings.js (shRenderList)

   Обработчики модалок и кнопок для:
   - Настройки подключения к Supabase
   - Входа / регистрации
   - Синхронизации проектов
   - Создания share-ссылок
*/


// ══════════════════════════════════════════════
//  Настройка облака
// ══════════════════════════════════════════════

/**
 * Применить настройки Supabase из модалки.
 */
function sbApplySetup() {
  var url = document.getElementById('inp-sb-url').value.trim();
  var anon = document.getElementById('inp-sb-anon').value.trim();

  if (!url || !anon) {
    alert('Заполните оба поля');
    return;
  }

  sbSaveConfig(url, anon);
  closeModal('modal-cloud-setup');
  sbUpdateUI();
}


// ══════════════════════════════════════════════
//  Вход / Регистрация
// ══════════════════════════════════════════════

/**
 * Войти по email + пароль.
 */
function sbDoLogin() {
  var email = document.getElementById('inp-login-email').value.trim();
  var pass = document.getElementById('inp-login-pass').value;
  var errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email) { errEl.textContent = 'Введите email'; errEl.style.display = 'block'; return; }
  if (!pass) { errEl.textContent = 'Введите пароль'; errEl.style.display = 'block'; return; }

  sbLoginPassword(email, pass, function(err, user) {
    if (err) {
      errEl.textContent = err;
      errEl.style.display = 'block';
    } else {
      closeModal('modal-login');
      sbUpdateUI();
    }
  });
}

/**
 * Отправить magic link на email.
 */
function sbDoMagicLink() {
  var email = document.getElementById('inp-login-email').value.trim();
  var errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email) { errEl.textContent = 'Введите email'; errEl.style.display = 'block'; return; }

  sbLoginMagicLink(email, function(err) {
    if (err) {
      errEl.textContent = err;
      errEl.style.display = 'block';
    } else {
      errEl.textContent = 'Ссылка отправлена на ' + email + '. Проверьте почту.';
      errEl.style.color = '#2e7d32';
      errEl.style.display = 'block';
    }
  });
}

/**
 * Зарегистрировать нового пользователя.
 */
function sbDoSignup() {
  var name = document.getElementById('inp-signup-name').value.trim();
  var email = document.getElementById('inp-signup-email').value.trim();
  var pass = document.getElementById('inp-signup-pass').value;
  var errEl = document.getElementById('signup-error');
  errEl.style.display = 'none';

  if (!name) { errEl.textContent = 'Введите имя'; errEl.style.display = 'block'; return; }
  if (!email) { errEl.textContent = 'Введите email'; errEl.style.display = 'block'; return; }
  if (!pass || pass.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; errEl.style.display = 'block'; return; }

  sbSignup(email, pass, name, function(err, user) {
    if (err) {
      errEl.textContent = err;
      errEl.style.display = 'block';
    } else {
      errEl.textContent = 'Проверьте email для подтверждения.';
      errEl.style.color = '#2e7d32';
      errEl.style.display = 'block';
    }
  });
}


// ══════════════════════════════════════════════
//  Синхронизация проектов
// ══════════════════════════════════════════════

/**
 * Загрузить текущий проект в облако.
 * Привязывается к кнопке на экране съёмок.
 */
function sbUploadCurrentProject() {
  if (!sbIsLoggedIn()) {
    openModal('modal-login');
    return;
  }

  var idx = App.selectedProject;
  if (idx < 0) { alert('Выберите проект'); return; }

  var statusEl = document.getElementById('cloud-status');
  if (statusEl) statusEl.textContent = 'Загрузка...';

  sbUploadProject(idx, function(err, cloudId) {
    if (err) {
      if (statusEl) statusEl.textContent = 'Ошибка: ' + err;
      console.error('sbUploadProject:', err);
      alert('Ошибка загрузки в облако: ' + err);
    } else {
      if (statusEl) statusEl.textContent = 'Синхронизировано';
      alert('Проект синхронизирован с облаком');
      console.log('Проект загружен, cloudId:', cloudId);
    }
  });
}

/**
 * Скачать проект из облака.
 * Показывает список облачных проектов, пользователь выбирает.
 */
function sbShowCloudProjects() {
  if (!sbIsLoggedIn()) {
    openModal('modal-login');
    return;
  }

  sbListProjects(function(err, projects) {
    if (err) { alert('Ошибка: ' + err); return; }
    if (projects.length === 0) { alert('В облаке нет проектов'); return; }

    // Простой выбор через prompt (потом заменим на модалку)
    var list = '';
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      list += (i + 1) + '. ' + (p.brand || 'Без бренда') + ' (' + (p.shoot_date || '?') + ')\n';
    }
    var choice = prompt('Облачные проекты:\n\n' + list + '\nВведите номер:');
    var num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > projects.length) return;

    var selected = projects[num - 1];
    var statusEl = document.getElementById('cloud-status');
    if (statusEl) statusEl.textContent = 'Загрузка...';

    sbDownloadProject(selected.id, function(err2, proj) {
      if (err2) {
        if (statusEl) statusEl.textContent = 'Ошибка: ' + err2;
        alert('Ошибка загрузки: ' + err2);
      } else {
        App.projects.push(proj);
        App.selectedProject = App.projects.length - 1;
        if (typeof renderProjects === 'function') renderProjects();
        if (statusEl) statusEl.textContent = 'Загружено из облака';
      }
    });
  });
}


// ══════════════════════════════════════════════
//  Share links
// ══════════════════════════════════════════════

/**
 * Открыть модалку создания share-ссылки.
 */
function sbOpenShareModal() {
  if (!sbIsLoggedIn()) { openModal('modal-login'); return; }

  var proj = getActiveProject();
  if (!proj || !proj._cloudId) {
    // Сначала нужно синхронизировать
    if (confirm('Проект ещё не в облаке. Загрузить сейчас?')) {
      sbUploadCurrentProject();
    }
    return;
  }

  document.getElementById('share-result').style.display = 'none';
  document.getElementById('inp-share-label').value = '';
  openModal('modal-share');
}

/**
 * Создать share-ссылку из модалки.
 */
function sbDoCreateShare() {
  var proj = getActiveProject();
  if (!proj || !proj._cloudId) return;

  var role = document.getElementById('inp-share-role').value;
  var label = document.getElementById('inp-share-label').value.trim();

  document.getElementById('btn-create-share').disabled = true;

  sbCreateShareLink(proj._cloudId, role, label, function(err, data) {
    document.getElementById('btn-create-share').disabled = false;

    if (err) {
      alert('Ошибка: ' + err);
    } else {
      document.getElementById('share-url').value = data.url;
      document.getElementById('share-result').style.display = 'block';
    }
  });
}

/**
 * Скопировать share URL в буфер обмена.
 */
function sbCopyShareUrl() {
  var input = document.getElementById('share-url');
  input.select();
  document.execCommand('copy');
}


// ══════════════════════════════════════════════
//  UI: обновление статус-бара и кнопок
// ══════════════════════════════════════════════

/**
 * Обновить статус-бар: облако, пользователь.
 * Вызывается при каждом изменении auth-состояния.
 */
function sbUpdateUI() {
  var cloudEl = document.getElementById('cloud-status');
  var userEl = document.getElementById('user-status');
  if (!cloudEl || !userEl) return;

  if (!sbIsConnected()) {
    cloudEl.innerHTML = 'Облако: <a href="#" onclick="openModal(\'modal-cloud-setup\');return false" style="color:#2196f3">настроить</a>';
    userEl.textContent = '';
  } else if (!sbIsLoggedIn()) {
    cloudEl.textContent = 'Облако: подключено';
    userEl.innerHTML = '<a href="#" onclick="openModal(\'modal-login\');return false" style="color:#2196f3">Войти</a>';
  } else {
    cloudEl.textContent = 'Облако: подключено';
    var name = sbUser.user_metadata ? (sbUser.user_metadata.name || sbUser.email) : sbUser.email;
    userEl.innerHTML = name + ' <a href="#" onclick="sbLogout(sbUpdateUI);return false" style="color:#999;font-size:11px">(выйти)</a>';
  }
}

/**
 * Показать форму входа для пользователя, перешедшего по share-ссылке.
 * @param {string} token — share-токен из URL
 */
function sbShowLoginForShare(token) {
  // Сохраняем токен чтобы использовать после входа
  window._pendingShareToken = token;
  openModal('modal-login');
}

// ══════════════════════════════════════════════
//  Auth Gate: обязательный вход перед использованием
// ══════════════════════════════════════════════

/**
 * Показать форму входа (auth gate).
 */
function authShowLogin() {
  document.getElementById('auth-login-form').style.display = '';
  document.getElementById('auth-signup-form').style.display = 'none';
  document.getElementById('auth-error').textContent = '';
}

/**
 * Показать форму регистрации (auth gate).
 */
function authShowSignup() {
  document.getElementById('auth-login-form').style.display = 'none';
  document.getElementById('auth-signup-form').style.display = '';
  document.getElementById('auth-signup-error').textContent = '';
}

/**
 * Войти по email + пароль (auth gate).
 */
function authDoLogin() {
  var email = document.getElementById('auth-email').value.trim();
  var pass = document.getElementById('auth-pass').value;
  var errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  errEl.className = 'auth-error';

  if (!email) { errEl.textContent = 'Введите email'; return; }
  if (!pass) { errEl.textContent = 'Введите пароль'; return; }

  sbLoginPassword(email, pass, function(err, user) {
    if (err) {
      errEl.textContent = err;
    } else {
      authUnlock();
    }
  });
}

/**
 * Отправить magic link (auth gate).
 */
function authDoMagicLink() {
  var email = document.getElementById('auth-email').value.trim();
  var errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  errEl.className = 'auth-error';

  if (!email) { errEl.textContent = 'Введите email'; return; }

  sbLoginMagicLink(email, function(err) {
    if (err) {
      errEl.textContent = err;
    } else {
      errEl.textContent = 'Ссылка отправлена на ' + email + '. Проверьте почту.';
      errEl.className = 'auth-error success';
    }
  });
}

/**
 * Зарегистрироваться (auth gate).
 */
function authDoSignup() {
  var name = document.getElementById('auth-signup-name').value.trim();
  var email = document.getElementById('auth-signup-email').value.trim();
  var pass = document.getElementById('auth-signup-pass').value;
  var errEl = document.getElementById('auth-signup-error');
  errEl.textContent = '';
  errEl.className = 'auth-error';

  if (!name) { errEl.textContent = 'Введите имя'; return; }
  if (!email) { errEl.textContent = 'Введите email'; return; }
  if (!pass || pass.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; return; }

  sbSignup(email, pass, name, function(err, user) {
    if (err) {
      errEl.textContent = err;
    } else {
      errEl.innerHTML = 'Мы отправили письмо на <b>' + email + '</b>.<br>Перейдите по ссылке в письме, потом вернитесь сюда и войдите.';
      errEl.className = 'auth-error success';
    }
  });
}

/**
 * Разблокировать приложение после успешного входа.
 * В браузерном режиме — загружает проекты из облака.
 */
function authUnlock() {
  var gate = document.getElementById('auth-gate');
  var app = document.getElementById('app-main');
  if (gate) gate.classList.add('hidden');
  if (app) app.style.display = '';
  sbUpdateUI();

  /* В браузере: загружаем проекты из облака (не из localStorage).
     Пропускаем для share-ссылок (там загрузка идёт через sbLoadByShareToken). */
  if (!(window.pywebview && window.pywebview.api) && !window._isShareLink && sbIsLoggedIn() && !window._cloudLoaded) {
    window._cloudLoaded = true;
    sbLoadAllFromCloud();
  }
}

/**
 * Загрузить все проекты пользователя из Supabase.
 * Заменяет App.projects облачными данными, потом
 * подтягивает превью из IndexedDB.
 */
function sbLoadAllFromCloud() {
  var statusEl = document.getElementById('cloud-status');
  if (statusEl) statusEl.textContent = 'Загрузка проектов...';

  sbListProjects(function(err, list) {
    if (err || !list || list.length === 0) {
      if (statusEl) statusEl.textContent = err ? ('Ошибка: ' + err) : 'Нет проектов в облаке';
      return;
    }

    var loaded = 0;
    var projects = [];

    for (var i = 0; i < list.length; i++) {
      (function(idx) {
        sbDownloadProject(list[idx].id, function(err2, proj) {
          if (!err2 && proj) {
            projects.push(proj);
          }
          loaded++;
          if (loaded >= list.length) {
            /* Все проекты загружены — обновляем приложение */
            App.projects = projects;
            if (projects.length > 0) App.selectedProject = 0;

            /* Сохраняем лёгкий кэш в localStorage (без base64) */
            _authSaveLightCache(projects);

            if (typeof renderProjects === 'function') renderProjects();
            if (typeof cpRenderList === 'function') cpRenderList();

            /* Подтянуть превью из IndexedDB */
            if (typeof pvDbRestoreProjectPreviews === 'function') {
              for (var p = 0; p < projects.length; p++) {
                pvDbRestoreProjectPreviews(projects[p], function() {
                  if (typeof pvRenderGallery === 'function') pvRenderGallery();
                });
              }
            }

            if (statusEl) statusEl.textContent = 'Загружено ' + projects.length + ' проектов';
            console.log('cloud-ui: загружено', projects.length, 'проектов из облака');
          }
        });
      })(i);
    }
  });
}

/**
 * Сохранить лёгкий кэш проектов в localStorage (без base64 картинок).
 * Используется как фолбэк, основные данные — в облаке.
 * @param {Array} projects
 */
function _authSaveLightCache(projects) {
  try {
    var light = projects.map(function(p) {
      var clone = {
        _cloudId: p._cloudId,
        brand: p.brand,
        shoot_date: p.shoot_date,
        templateId: p.templateId,
        _stage: p._stage,
        _stageHistory: p._stageHistory || {},
        channels: p.channels || [],
        cards: (p.cards || []).map(function(c) {
          return {
            id: c.id, status: c.status,
            _hasHero: c._hasHero, _hAspect: c._hAspect,
            _vAspect: c._vAspect, _lockRows: c._lockRows,
            slots: (c.slots || []).map(function(s) {
              return { orient: s.orient, weight: s.weight, row: s.row,
                       rotation: s.rotation, file: s.file, dataUrl: null };
            })
          };
        }),
        previews: [],
        otherContent: []
      };
      return clone;
    });
    localStorage.setItem('maketcp_autosave', JSON.stringify(light));
  } catch(e) {
    console.warn('cloud-ui: не удалось сохранить кэш в localStorage');
  }
}

/**
 * Показать auth gate (заблокировать приложение).
 */
function authLock() {
  var gate = document.getElementById('auth-gate');
  var app = document.getElementById('app-main');
  if (gate) gate.classList.remove('hidden');
  if (app) app.style.display = 'none';
}

/**
 * Проверить авторизацию при загрузке.
 * Desktop (pywebview): пропускаем auth gate.
 * Share link (?share=TOKEN): пропускаем auth gate, грузим проект по токену.
 * Browser: показываем auth gate если не залогинен.
 */
function authCheckOnLoad() {
  /* Desktop: не требуем авторизации */
  if (window.pywebview && window.pywebview.api) {
    authUnlock();
    return;
  }

  /* Share link: пропускаем auth gate, загружаем проект по токену */
  var params = new URLSearchParams(window.location.search);
  var shareToken = params.get('share');
  if (shareToken) {
    window._isShareLink = true;  /* флаг: не грузить все проекты */
    window._shareToken = shareToken; /* сохраняем для записи клиента */
    authUnlock();
    sbLoadByShareToken(shareToken);
    return;
  }

  /* Browser: проверяем сессию через Supabase */
  if (sbIsLoggedIn()) {
    authUnlock();
  } else {
    authLock();
  }
}

// Инициализация UI при загрузке
window.addEventListener('DOMContentLoaded', function() {
  /* Даём Supabase время проверить сессию */
  setTimeout(function() {
    authCheckOnLoad();
    sbUpdateUI();
  }, 500);
});
