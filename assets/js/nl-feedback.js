/* ============================================================
   nl-feedback.js — форма обратной связи (модальное окно).

   Фронт-онли, без зависимостей. Рисуется поверх страницы в
   document.body по вызову window.NLFeedback.open(entryPoint).
   Данные игр берёт из window.NL_CONFIG.games. События аналитики
   уходят ТОЛЬКО через window.NLTrack.send(..., { throttle: 0 }).

   Поток из 4 шагов:
     1. Оцените игры            — оценка 1..5 каждой игре.
     2. Что можно улучшить      — ТОЛЬКО для игр с оценкой 1..3;
                                  если таких нет — шаг пропускается.
     3. Играли бы за деньги?    — общая оценка 1..5.
     4. Комментарий             — необязательный текст + Отправить.
   ============================================================ */

window.NLFeedback = (function () {
  const T = window.NLTrack;

  // Готовые причины низкой оценки (шаг 2). Одна на игру.
  const REASONS = ['Скучно', 'Непонятно, как играть', 'Мало выигрышей', 'Долго ждать тираж', 'Не зацепило'];

  const TOTAL = 4;

  let root = null;              // корневой оверлей (null = закрыто)
  let entry = 'hub';            // точка входа для gc_feedback_open
  let step = 1;                 // текущий логический шаг 1..4
  let state = null;             // { ratings, reasons, money, comment }
  let lastReasonFired = {};     // защита от повторной отправки той же причины
  let focusCustomGame = null;   // какому блоку отдать фокус после render()
  let prevOverflow = '';        // сохранённый overflow <body>
  let thanksTimer = null;       // таймер авто-закрытия экрана «Спасибо!»
  let onKey = null;             // ссылка на обработчик Esc для снятия

  const games = () => (window.NL_CONFIG && window.NL_CONFIG.games) || [];

  /* Игры с низкой оценкой (1..3) — именно для них показываем шаг 2. */
  function lowGames() {
    return games().filter(function (g) {
      const r = state.ratings[g.id];
      return r >= 1 && r <= 3;
    });
  }
  function hasStep2() { return lowGames().length > 0; }

  /* ---------- экранирование (титулы игр — из конфига, но на всякий) ---------- */
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- состояние ---------- */
  function reset() {
    step = 1;
    state = { ratings: {}, reasons: {}, money: 0, comment: '' };
    lastReasonFired = {};
    focusCustomGame = null;
  }

  /* ---------- условия перехода «Далее» ---------- */
  function reasonValid(id) {
    const r = state.reasons[id];
    if (!r) return false;
    if (r.custom) return r.text.trim().length > 0;
    return !!r.value;
  }
  function canProceed(s) {
    if (s === 1) return games().length > 0 && games().every(function (g) { return !!state.ratings[g.id]; });
    if (s === 2) return lowGames().every(function (g) { return reasonValid(g.id); });
    if (s === 3) return state.money >= 1;
    return true; // шаг 4 — комментарий необязателен
  }

  /* ---------- компоненты оценки ---------- */
  function starsHTML(id, current) {
    let s = '<div class="nlfb-stars" data-game="' + id + '">';
    for (let i = 1; i <= 5; i++) {
      s += '<button type="button" class="nlfb-star' + (i <= current ? ' on' : '') +
           '" data-val="' + i + '" aria-label="Оценка ' + i + '">★</button>';
    }
    return s + '</div>';
  }
  function scaleHTML(current) {
    let s = '<div class="nlfb-scale" data-role="money">';
    for (let i = 1; i <= 5; i++) {
      s += '<button type="button" class="nlfb-scale-btn' + (i === current ? ' on' : '') +
           '" data-val="' + i + '">' + i + '</button>';
    }
    return s + '</div>';
  }

  /* ---------- разметка тела по шагам ---------- */
  function reasonBlockHTML(g) {
    const r = state.reasons[g.id] || { value: null, custom: false, text: '' };
    let chips = REASONS.map(function (label) {
      const on = (!r.custom && r.value === label) ? ' on' : '';
      return '<button type="button" class="nlfb-chip' + on + '" data-reason="' + escHtml(label) + '">' +
             escHtml(label) + '</button>';
    }).join('');
    chips += '<button type="button" class="nlfb-chip' + (r.custom ? ' on' : '') + '" data-custom>Свой вариант</button>';

    const custom = r.custom
      ? '<textarea class="nlfb-custom" rows="2" placeholder="Опишите своими словами">' + escHtml(r.text) + '</textarea>'
      : '';

    return '<div class="nlfb-reason-block" data-game="' + g.id + '">' +
             '<div class="nlfb-reason-name">' + escHtml(g.title) + '</div>' +
             '<div class="nlfb-chips">' + chips + '</div>' +
             custom +
           '</div>';
  }

  function bodyHTML() {
    if (step === 1) {
      return '<h3 class="nlfb-title">Оцените игры</h3>' +
             '<p class="nlfb-sub">Поставьте оценку каждой игре — от 1 до 5.</p>' +
             games().map(function (g) {
               return '<div class="nlfb-game-row">' +
                        '<span class="nlfb-game-name">' + escHtml(g.title) + '</span>' +
                        starsHTML(g.id, state.ratings[g.id] || 0) +
                      '</div>';
             }).join('');
    }
    if (step === 2) {
      return '<h3 class="nlfb-title">Что можно улучшить</h3>' +
             '<p class="nlfb-sub">Подскажите, что помешало. Выберите один вариант для каждой игры.</p>' +
             lowGames().map(reasonBlockHTML).join('');
    }
    if (step === 3) {
      return '<h3 class="nlfb-title">Играли бы за деньги?</h3>' +
             '<p class="nlfb-sub">Насколько вероятно, что вы стали бы играть в это на реальные деньги? ' +
             '1 — точно нет, 5 — точно да.</p>' +
             scaleHTML(state.money);
    }
    // шаг 4
    return '<h3 class="nlfb-title">Комментарий</h3>' +
           '<p class="nlfb-sub">По желанию — пара слов напоследок.</p>' +
           '<textarea class="nlfb-comment" rows="4" placeholder="Что понравилось или чего не хватило">' +
           escHtml(state.comment) + '</textarea>';
  }

  /* ---------- отрисовка текущего шага ---------- */
  function render() {
    root.querySelector('.nlfb-step-label').textContent = 'Шаг ' + step + ' из ' + TOTAL;
    root.querySelector('.nlfb-progress-fill').style.width = (step / TOTAL * 100) + '%';

    const body = root.querySelector('.nlfb-body');
    body.innerHTML = bodyHTML();
    body.scrollTop = 0;

    renderFoot();

    if (focusCustomGame) {
      const ta = body.querySelector('.nlfb-reason-block[data-game="' + focusCustomGame + '"] .nlfb-custom');
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
      focusCustomGame = null;
    }
  }

  function renderFoot() {
    const foot = root.querySelector('.nlfb-foot');
    const backBtn = step > 1
      ? '<button type="button" class="btn btn-ghost nlfb-back">Назад</button>'
      : '<span class="nlfb-foot-spacer"></span>';
    const label = step === TOTAL ? 'Отправить' : 'Далее';

    foot.innerHTML = backBtn +
      '<button type="button" class="btn btn-primary nlfb-next"' + (canProceed(step) ? '' : ' disabled') + '>' +
      label + '</button>';

    const back = foot.querySelector('.nlfb-back');
    if (back) back.onclick = goBack;
    foot.querySelector('.nlfb-next').onclick = onPrimary;
  }

  function updateNav() {
    const next = root && root.querySelector('.nlfb-next');
    if (next) next.disabled = !canProceed(step);
  }

  /* ---------- переходы (с пропуском шага 2) ---------- */
  function onPrimary() {
    if (step === TOTAL) { submit(); return; }
    goNext();
  }
  function goNext() {
    if (!canProceed(step)) return;
    let target = step + 1;
    if (target === 2 && !hasStep2()) target = 3;   // пропуск вперёд
    if (target > TOTAL) { submit(); return; }
    step = target;
    render();
  }
  function goBack() {
    let target = step - 1;
    if (target === 2 && !hasStep2()) target = 1;    // пропуск назад
    if (target < 1) return;
    step = target;
    render();
  }

  /* ---------- обработчики выбора + аналитика ---------- */
  function pickRating(id, val) {
    state.ratings[id] = val;
    T.send('gc_game_rate', { game_id: id, rating: val }, { throttle: 0 });
    render();
  }

  function fireReason(id, reason, isCustom) {
    // Без штробы, но не шлём подряд одну и ту же причину для игры.
    const key = JSON.stringify({ r: reason, c: isCustom });
    if (lastReasonFired[id] === key) return;
    lastReasonFired[id] = key;
    T.send('gc_rate_reason', { game_id: id, reason: reason, is_custom: isCustom }, { throttle: 0 });
  }

  function pickReason(id, chip) {
    if (!state.reasons[id]) state.reasons[id] = { value: null, custom: false, text: '' };
    const r = state.reasons[id];

    if (chip.hasAttribute('data-custom')) {
      r.custom = true;
      r.value = null;
      focusCustomGame = id;      // событие уйдёт, когда игрок введёт текст (blur)
      render();
      return;
    }
    r.custom = false;
    r.value = chip.getAttribute('data-reason');
    fireReason(id, r.value, false);
    render();
  }

  function setCustomText(id, text) {
    if (!state.reasons[id]) state.reasons[id] = { value: null, custom: true, text: '' };
    state.reasons[id].text = text;
    updateNav();                 // без пере-render, чтобы не терять фокус
  }
  function commitCustom(id) {
    const r = state.reasons[id];
    if (r && r.custom) {
      const t = r.text.trim();
      if (t) fireReason(id, t, true);
    }
  }

  function pickMoney(val) {
    state.money = val;
    T.send('gc_game_vote', { rating: val }, { throttle: 0 });
    render();
  }

  /* ---------- отправка ---------- */
  function submit() {
    T.send('gc_feedback_submit', {
      overall_rating: state.money,               // оценка из шага 3
      text_len: state.comment.trim().length,     // длина комментария
    }, { throttle: 0 });
    showThanks();
  }

  function showThanks() {
    const modal = root.querySelector('.nlfb-modal');
    modal.innerHTML =
      '<div class="nlfb-thanks">' +
        '<div class="nlfb-thanks-ico">✓</div>' +
        '<div class="nlfb-thanks-title">Спасибо!</div>' +
        '<div class="nlfb-thanks-sub">Ваша оценка поможет нам выбрать, какую игру делать по-настоящему.</div>' +
        '<button type="button" class="btn btn-primary nlfb-close2">Закрыть</button>' +
      '</div>';
    modal.querySelector('.nlfb-close2').onclick = close;
    thanksTimer = setTimeout(close, 1500);
  }

  /* ---------- построение оболочки окна ---------- */
  function build() {
    root = document.createElement('div');
    root.className = 'nlfb-overlay';
    root.innerHTML =
      '<div class="nlfb-modal" role="dialog" aria-modal="true" aria-label="Обратная связь">' +
        '<div class="nlfb-head">' +
          '<span class="nlfb-step-label"></span>' +
          '<button type="button" class="nlfb-close" aria-label="Закрыть">×</button>' +
        '</div>' +
        '<div class="nlfb-progress"><div class="nlfb-progress-fill"></div></div>' +
        '<div class="nlfb-body"></div>' +
        '<div class="nlfb-foot"></div>' +
      '</div>';

    // Закрытие: крестик, клик по оверлею (но не по самому окну), Esc.
    root.querySelector('.nlfb-close').onclick = close;
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    // Делегирование внутри тела.
    const body = root.querySelector('.nlfb-body');
    body.addEventListener('click', function (e) {
      const star = e.target.closest('.nlfb-star');
      if (star) { pickRating(star.closest('.nlfb-stars').dataset.game, +star.dataset.val); return; }
      const chip = e.target.closest('.nlfb-chip');
      if (chip) { pickReason(chip.closest('.nlfb-reason-block').dataset.game, chip); return; }
      const num = e.target.closest('.nlfb-scale-btn');
      if (num) { pickMoney(+num.dataset.val); return; }
    });
    body.addEventListener('input', function (e) {
      if (e.target.classList.contains('nlfb-custom')) {
        setCustomText(e.target.closest('.nlfb-reason-block').dataset.game, e.target.value);
      } else if (e.target.classList.contains('nlfb-comment')) {
        state.comment = e.target.value;
      }
    });
    // blur не всплывает — слушаем на фазе перехвата, чтобы поймать свой текст.
    body.addEventListener('blur', function (e) {
      if (e.target.classList.contains('nlfb-custom')) {
        commitCustom(e.target.closest('.nlfb-reason-block').dataset.game);
      }
    }, true);

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(root);
  }

  function close() {
    if (!root) return;
    if (thanksTimer) { clearTimeout(thanksTimer); thanksTimer = null; }
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    document.body.style.overflow = prevOverflow;
    root.remove();
    root = null;
  }

  /* ---------- публичный вход ---------- */
  function open(entryPoint) {
    if (root) return;                 // уже открыто
    entry = entryPoint || 'hub';
    reset();
    build();
    T.send('gc_feedback_open', { entry_point: entry }, { throttle: 0 });
    render();
  }

  return { open: open, close: close };
})();
