/* ══════════════════════════════════════════════
 *  Compare view — side-by-side просмотр версий фото (MVP)
 * ══════════════════════════════════════════════
 *
 *  Stand-alone страница для сравнения 2-х версий одного фото
 *  (ЦК / ретушь / грейдинг) и выбора победителя (selected=true).
 *
 *  Query params:
 *    - project_id  (required, UUID)
 *    - photo_name  (required, IMG_0001.CR3)
 *    - photo_id    (alias для photo_name, для форвард-совместимости)
 *
 *  Зависимости (см. compare-view.html):
 *    - @supabase/supabase-js (UMD)
 *    - js/supabase.js → sbInit(), sbGetPhotoVersions(),
 *                       sbSelectPhotoVersion(), _compareViewEnabled(),
 *                       sbClient
 *
 *  Feature flag: localStorage.DEBUG_COMPARE_VIEW=1
 *    Без флага страница рендерит «в разработке» (см. _cvRenderGate).
 *
 *  Дизайн минимальный — финальный UX делает DAD.
 *  См. docs/agents/design/compare-view/ (когда будет готово).
 */

(function() {
  'use strict';

  /* ---- Локальное состояние страницы ---- */
  var _cvVersions = [];      /* все версии фото, отсортированные */
  var _cvProjectId = '';
  var _cvPhotoName = '';
  var _cvSelA = null;        /* выбранный id версии в слоте A */
  var _cvSelB = null;        /* выбранный id версии в слоте B */

  /* ---- Утилиты ---- */

  function _cvGetParam(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    } catch (e) { return ''; }
  }

  function _cvStageLabel(stage) {
    if (stage === 'color_correction') return 'ЦК';
    if (stage === 'retouch')          return 'Ретушь';
    if (stage === 'grading')          return 'Грейдинг';
    return stage || '—';
  }

  function _cvFormatVersion(v) {
    /* Например: «ЦК v3 • selected» или «Ретушь v1» */
    var s = _cvStageLabel(v.stage) + ' v' + v.version_num;
    if (v.selected) s += ' • выбрано';
    return s;
  }

  function _cvResolvePreviewUrl(previewPath) {
    /* Если путь уже абсолютный — отдать как есть.
       Иначе построить публичный URL к Storage через sbClient. */
    if (!previewPath) return '';
    if (/^https?:\/\//i.test(previewPath)) return previewPath;
    if (typeof sbClient === 'undefined' || !sbClient || !sbClient.storage) return previewPath;
    try {
      var res = sbClient.storage.from('postprod').getPublicUrl(previewPath);
      return (res && res.data && res.data.publicUrl) || previewPath;
    } catch (e) {
      return previewPath;
    }
  }

  function _cvEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  /* ---- Feature-flag gate ---- */

  function _cvRenderGate() {
    var root = document.getElementById('cv-root');
    if (!root) return;
    root.innerHTML = '';
    root.className = 'cv-flag-gate';

    var h = _cvEl('h2', null, 'Compare view в разработке');
    var p1 = _cvEl('p', null,
      'Эта страница сравнивает версии одной фотографии (ЦК, ретушь, грейдинг). ' +
      'Фича закрыта флагом на время разработки.');

    var p2 = _cvEl('p', null, '');
    p2.appendChild(document.createTextNode('Включить: '));
    var code = _cvEl('code', null, "localStorage.setItem('DEBUG_COMPARE_VIEW', '1')");
    p2.appendChild(code);
    p2.appendChild(document.createTextNode(' и обновить страницу.'));

    root.appendChild(h);
    root.appendChild(p1);
    root.appendChild(p2);
  }

  function _cvRenderError(msg) {
    var root = document.getElementById('cv-root');
    if (!root) return;
    root.innerHTML = '';
    root.className = 'cv-grid';
    var div = _cvEl('div', 'cv-error', msg);
    root.appendChild(div);
  }

  /* ---- Рендер одного слота ---- */

  function _cvRenderSlot(label, initialSel, onPick, onSelect) {
    var slot = _cvEl('div', 'cv-slot');

    /* Заголовок: A/B — dropdown — кнопка «Выбрать как победителя» */
    var header = _cvEl('div', 'cv-slot-header');
    var tag = _cvEl('div', 'cv-slot-label', label);
    header.appendChild(tag);

    var dd = document.createElement('select');
    dd.className = 'cv-dropdown';
    for (var i = 0; i < _cvVersions.length; i++) {
      var v = _cvVersions[i];
      var opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = _cvFormatVersion(v);
      if (v.id === initialSel) opt.selected = true;
      dd.appendChild(opt);
    }
    dd.onchange = function() { onPick(dd.value); };
    header.appendChild(dd);

    var selBtn = _cvEl('button', 'cv-select-btn', 'Выбрать');
    selBtn.onclick = function() { onSelect(dd.value, selBtn); };
    header.appendChild(selBtn);

    slot.appendChild(header);

    /* Картинка */
    var imgWrap = _cvEl('div', 'cv-img-wrap');
    var img = document.createElement('img');
    imgWrap.appendChild(img);
    slot.appendChild(imgWrap);

    /* Метаданные */
    var meta = _cvEl('div', 'cv-slot-meta', '');
    slot.appendChild(meta);

    /* Заполняем начальной версией */
    _cvFillSlot(slot, initialSel);

    return slot;
  }

  function _cvFillSlot(slot, versionId) {
    var v = null;
    for (var i = 0; i < _cvVersions.length; i++) {
      if (_cvVersions[i].id === versionId) { v = _cvVersions[i]; break; }
    }
    var img = slot.querySelector('img');
    var meta = slot.querySelector('.cv-slot-meta');
    var selBtn = slot.querySelector('.cv-select-btn');

    if (!v) {
      if (img) img.src = '';
      if (meta) meta.textContent = '(нет версии)';
      if (selBtn) {
        selBtn.disabled = true;
        selBtn.classList.remove('cv-selected');
        selBtn.textContent = 'Выбрать';
      }
      return;
    }

    if (img) img.src = _cvResolvePreviewUrl(v.preview_path);
    if (meta) {
      var ts = v.created_at ? (new Date(v.created_at)).toLocaleString() : '—';
      meta.textContent = _cvStageLabel(v.stage) + ' v' + v.version_num +
        '   •   id=' + String(v.id).slice(0, 8) +
        '   •   ' + ts;
    }
    if (selBtn) {
      selBtn.disabled = false;
      if (v.selected) {
        selBtn.classList.add('cv-selected');
        selBtn.textContent = 'Выбрано';
      } else {
        selBtn.classList.remove('cv-selected');
        selBtn.textContent = 'Выбрать';
      }
    }
  }

  /* ---- Логика «выбрать версию как победителя» ---- */

  function _cvHandleSelect(versionId, btn) {
    var v = null;
    for (var i = 0; i < _cvVersions.length; i++) {
      if (_cvVersions[i].id === versionId) { v = _cvVersions[i]; break; }
    }
    if (!v) return;
    if (typeof sbSelectPhotoVersion !== 'function') {
      console.warn('[compare-view] sbSelectPhotoVersion not available');
      return;
    }

    btn.disabled = true;
    btn.textContent = '…';

    sbSelectPhotoVersion(v.id, _cvProjectId, _cvPhotoName, v.stage, function(err) {
      if (err) {
        console.warn('[compare-view] select failed', err);
        btn.disabled = false;
        btn.textContent = 'Ошибка';
        return;
      }
      /* Обновить локальное состояние: у всех той же stage — selected=false,
         у выбранной — selected=true. */
      for (var i = 0; i < _cvVersions.length; i++) {
        if (_cvVersions[i].stage === v.stage) {
          _cvVersions[i].selected = (_cvVersions[i].id === v.id);
        }
      }
      _cvRerender();
    });
  }

  /* ---- Главный рендер ---- */

  function _cvRerender() {
    var root = document.getElementById('cv-root');
    if (!root) return;
    root.innerHTML = '';
    root.className = 'cv-grid';

    if (!_cvVersions.length) {
      var empty = _cvEl('div', 'cv-empty-msg', 'Нет версий для этого фото. Вероятно, этапы ЦК/ретушь ещё не начинались.');
      root.appendChild(empty);
      return;
    }

    /* Дефолт:
       - A = первая версия (самая поздняя по stage ASC, version_num DESC),
       - B = вторая (если есть) или та же первая. */
    if (!_cvSelA) _cvSelA = _cvVersions[0].id;
    if (!_cvSelB) _cvSelB = (_cvVersions[1] || _cvVersions[0]).id;

    var slotA = _cvRenderSlot('A', _cvSelA,
      function(id) { _cvSelA = id; _cvFillSlot(slotA, id); },
      function(id, btn) { _cvHandleSelect(id, btn); });

    var slotB = _cvRenderSlot('B', _cvSelB,
      function(id) { _cvSelB = id; _cvFillSlot(slotB, id); },
      function(id, btn) { _cvHandleSelect(id, btn); });

    root.appendChild(slotA);
    root.appendChild(slotB);
  }

  /* ---- Загрузка данных ---- */

  function _cvLoad() {
    _cvProjectId = _cvGetParam('project_id');
    _cvPhotoName = _cvGetParam('photo_name') || _cvGetParam('photo_id');

    var nameEl = document.getElementById('cv-photo-name');
    if (nameEl && _cvPhotoName) {
      nameEl.textContent = ' — ' + _cvPhotoName;
    }

    if (!_cvProjectId || !_cvPhotoName) {
      _cvRenderError('Укажите project_id и photo_name в URL: ?project_id=<uuid>&photo_name=<name>');
      return;
    }

    if (typeof sbGetPhotoVersions !== 'function') {
      _cvRenderError('supabase.js не загружен (sbGetPhotoVersions отсутствует).');
      return;
    }

    sbGetPhotoVersions(_cvProjectId, _cvPhotoName).then(function(versions) {
      _cvVersions = versions || [];
      _cvRerender();
    })['catch'](function(err) {
      console.warn('[compare-view] load failed', err);
      _cvRenderError('Не удалось загрузить версии: ' + (err && err.message ? err.message : String(err)));
    });
  }

  /* ---- Навигация назад ---- */

  window.cvGoBack = function() {
    if (window.history && window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  };

  /* ---- Bootstrap ---- */

  function _cvBoot() {
    /* 1. Фича-гейт */
    if (typeof _compareViewEnabled !== 'function' || !_compareViewEnabled()) {
      _cvRenderGate();
      return;
    }

    /* 2. Инициализация Supabase (sbInit подтягивает sbClient + session). */
    if (typeof sbInit === 'function') {
      try { sbInit(); } catch (e) { console.warn('[compare-view] sbInit failed', e); }
    }

    /* 3. Если нет sbClient — показать ошибку. */
    if (typeof sbClient === 'undefined' || !sbClient) {
      _cvRenderError('Supabase-клиент не инициализирован. Проверьте конфигурацию.');
      return;
    }

    /* 4. Основная загрузка. */
    _cvLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _cvBoot);
  } else {
    _cvBoot();
  }

  /* Экспорт для отладки / wire-up */
  window.cvBoot = _cvBoot;
  window.cvRerender = _cvRerender;
})();
