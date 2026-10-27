/* ============================================================
   nl-shell.js — общая обвязка страниц: шапка, баланс, вкладки, футер.
   Всё, что одинаково на хабе и в обеих играх.
   ============================================================ */

window.NLShell = (function () {
  const CFG = window.NL_CONFIG;
  const T = window.NLTrack;

  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  /* ---------- идентификатор игрока ----------
     Хэш приходит в ссылке с баннера параметром u. Если его нет —
     генерируем свой и храним в браузере. Без него не связать
     поведение в играх с данными основного сайта. */
  function resolveUid() {
    const fromUrl = new URLSearchParams(location.search).get('u');
    if (fromUrl) { try { localStorage.setItem('nl_uid', fromUrl); } catch (e) {} return fromUrl; }
    let saved = null;
    try { saved = localStorage.getItem('nl_uid'); } catch (e) {}
    if (saved) return saved;
    const gen = 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem('nl_uid', gen); } catch (e) {}
    return gen;
  }

  function sessionId() {
    let s = null;
    try { s = sessionStorage.getItem('nl_sid'); } catch (e) {}
    if (!s) {
      s = 's' + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem('nl_sid', s); } catch (e) {}
    }
    return s;
  }

  /* ---------- состояние баланса ----------
     Бэка нет: баланс живёт в localStorage, свой у каждого игрока (uid из
     ссылки баннера). Внутри одного дня баланс переживает перезагрузку, а
     каждую местную полночь доливается до 10 000, если упал ниже — выигрыш
     выше 10 000 при этом сохраняется. Пополнение тоже открывается заново. */
  const state = {
    balance: CFG.balance.start,
    canTopup: true,
    lastTopup: '',
    day: '',
    listeners: [],
  };

  let walletKey = 'nl_wallet';

  /* Местная (не UTC) дата: «новый день» наступает в полночь по часам игрока. */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function loadWallet() {
    state.day = today();
    try {
      const raw = localStorage.getItem(walletKey);
      if (raw) {
        const w = JSON.parse(raw);
        if (w.day === state.day) {           // тот же день — восстанавливаем баланс
          if (typeof w.balance === 'number') state.balance = Math.max(0, Math.round(w.balance));
          state.lastTopup = w.lastTopup || '';
          state.canTopup = state.lastTopup !== state.day;
        } else {                              // новый день — доливаем до 10 000, выигрыш не срезаем
          const prev = typeof w.balance === 'number' ? Math.max(0, Math.round(w.balance)) : CFG.balance.start;
          state.balance = Math.max(prev, CFG.balance.start);
          state.lastTopup = '';
          state.canTopup = true;
        }
      }
    } catch (e) {}
    saveWallet();
  }
  function saveWallet() {
    try {
      localStorage.setItem(walletKey, JSON.stringify({
        balance: state.balance, lastTopup: state.lastTopup, day: state.day,
      }));
    } catch (e) {}
  }

  /* Пока вкладка открыта — доливаем баланс до 10 000 ровно в местную полночь. */
  function scheduleDailyReset() {
    const nowT = new Date();
    const next = new Date(nowT.getFullYear(), nowT.getMonth(), nowT.getDate() + 1, 0, 0, 2);
    setTimeout(function () {
      state.day = today();
      state.balance = Math.max(state.balance, CFG.balance.start);
      state.lastTopup = '';
      state.canTopup = true;
      emit();
      scheduleDailyReset();
    }, next - nowT);
  }

  function onBalance(fn) { state.listeners.push(fn); fn(state.balance); }
  function emit() { state.listeners.forEach(fn => fn(state.balance)); paintBalance(); saveWallet(); }

  function getBalance() { return state.balance; }
  function setBalance(v) { state.balance = Math.max(0, Math.round(v)); emit(); }
  function spend(v) {
    if (v > state.balance) return false;
    state.balance -= v; emit();
    if (state.balance <= 0) T.send('gc_balance_depleted', { balance_left: 0 });
    /* Цель «потратил 80% демобаланса»: осталось 20% стартового баланса или меньше.
       Ровно в ноль баланс почти никогда не уходит — не хватает на последнюю ставку. */
    if (state.balance <= CFG.balance.start * 0.2) {
      let sent = false;
      try { sent = sessionStorage.getItem('nl_bal80') === '1'; sessionStorage.setItem('nl_bal80', '1'); } catch (e) {}
      if (!sent) T.send('fn_balance_80', { balance_left: state.balance }, { throttle: 0 });
    }
    return true;
  }
  function award(v) { if (v > 0) { state.balance += v; emit(); } }

  function topup() {
    if (!state.canTopup) return false;
    state.balance += CFG.balance.topupAmount;
    state.lastTopup = today();
    state.canTopup = false;
    emit();
    T.send('gc_balance_topup', { amount: CFG.balance.topupAmount, method: 'daily' });
    return true;
  }

  function paintBalance() {
    const el = document.getElementById('nlBalance');
    if (el) el.textContent = fmt(state.balance);
    const btn = document.getElementById('nlTopup');
    if (btn) {
      btn.disabled = !state.canTopup;
      btn.title = state.canTopup ? 'Пополнить демобаланс' : 'Пополнение доступно раз в сутки';
    }
  }

  /* ---------- шапка ---------- */
  function renderHeader(opts) {
    opts = opts || {};
    const host = document.getElementById('nlHeader');
    if (!host) return;
    host.className = 'nl-header';
    host.innerHTML =
      '<a class="nl-logo" href="index.html" data-track="gc_return_to_hub">' +
        '<span class="mark">НЛ</span><span class="name">ЛАБОРАТОРИЯ МИНИ-ИГР</span>' +
      '</a>' +
      // Явный выход в хаб из игры. На самом хабе не показываем.
      (opts.gameId && opts.gameId !== 'hub'
        ? '<a class="nl-back" href="index.html" data-track="gc_return_to_hub" title="Ко всем играм">' +
            '<span class="nl-back-ico">←</span><span class="nl-back-txt">Все игры</span></a>'
        : '') +
      (opts.title ? '<span class="pill-title">' + opts.title + '</span>' : '') +
      '<span class="nl-header-spacer"></span>' +
      '<span class="nl-balance"><span class="label">Баланс:</span> ' +
        '<b id="nlBalance" class="tnum">' + fmt(state.balance) + '</b> ◆</span>' +
      '<button class="btn btn-ghost btn-mini" id="nlTopup">+ демо</button>' +
      // Выход на основной сайт НЛ — на всех страницах, включая хаб.
      '<a class="nl-site" href="' + CFG.links.site + '" data-track="gc_return_to_site" title="Вернуться на сайт Национальной Лотереи">' +
        '<span class="nl-site-long">Вернуться на сайт НЛ</span><span class="nl-site-short">На сайт НЛ</span></a>';

    host.querySelector('#nlTopup').onclick = function () {
      if (!topup()) alert('Пополнить демобаланс можно один раз в сутки. Приходите завтра.');
    };
    paintBalance();
  }

  /* ---------- вкладки разделов ---------- */
  function renderTabs(tabs, onSwitch) {
    const host = document.getElementById('nlTabs');
    if (!host) return;
    host.className = 'nl-tabs';
    host.innerHTML = tabs.map((t, i) =>
      '<button class="nl-tab' + (i === 0 ? ' active' : '') + '" data-view="' + t.id + '">' + t.label + '</button>'
    ).join('');

    host.addEventListener('click', function (e) {
      const btn = e.target.closest('.nl-tab');
      if (!btn) return;
      switchTo(btn.dataset.view, onSwitch);
    });
  }

  function switchTo(id, onSwitch) {
    document.querySelectorAll('.nl-tab').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    document.querySelectorAll('.nl-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (id === 'how') T.send('gc_rules_open', { trigger: 'manual' });
    if (onSwitch) onSwitch(id);
  }

  /* ---------- футер ---------- */
  function renderFooter() {
    const host = document.getElementById('nlFooter');
    if (!host) return;
    host.className = 'nl-footer';
    host.innerHTML =
      '<div class="row">' +
        '<div>© Национальная Лотерея · демонстрационная площадка · не является публичной офертой</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span class="age">18+</span> Играйте ответственно</div>' +
      '</div>';
  }

  /* ---------- пометка автономного режима ---------- */
  function markOffline() {
    if (document.querySelector('.demo-note')) return;
    const d = document.createElement('div');
    d.className = 'demo-note';
    d.textContent = 'Демонстрационный режим — сервер недоступен';
    document.body.appendChild(d);
  }

  /* ---------- инициализация страницы ---------- */
  function init(opts) {
    opts = opts || {};
    const uid = resolveUid();
    walletKey = 'nl_wallet:' + uid;
    loadWallet();
    scheduleDailyReset();

    T.setContext({
      uid: uid,
      session_id: sessionId(),
      game_id: opts.gameId || 'hub',
      device: matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop',
      source: new URLSearchParams(location.search).get('utm_source') || 'direct',
      schema_version: CFG.schemaVersion,
    });

    if (window.NLAB) T.setContext(window.NLAB.assign(uid));

    // Цель воронки «Вход в игру» — своё имя события на каждую игру.
    if (opts.gameId && opts.gameId !== 'hub') T.send('fn_' + opts.gameId + '_open', {}, { throttle: 0 });

    renderHeader(opts);
    renderFooter();
    if (opts.tabs) renderTabs(opts.tabs, opts.onSwitch);

    window.addEventListener('pagehide', function () {
      T.send('gc_session_end', { balance_left: state.balance }, { throttle: 0 });
    });

    return { uid: uid };
  }

  return {
    init, renderHeader, renderTabs, renderFooter, switchTo, markOffline,
    getBalance, setBalance, spend, award, topup, onBalance,
    canTopup: () => state.canTopup,
    fmt,
  };
})();
