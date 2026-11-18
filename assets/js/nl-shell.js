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

  /* ---------- демобаланс и купленные билеты ---------- */
  let walletKey;
  let legacyKey;
  let wallet;
  const listeners = [];

  function today() {
    const d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
  }

  function normalizeDay(day) {
    return day ? day.split('-').map(Number).join('-') : '';
  }

  function stored(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function newWallet() {
    const old = stored(legacyKey);
    const balance = typeof old?.balance === 'number' ? Math.max(0, Math.round(old.balance)) : CFG.balance.start;
    return {
      balance, day: normalizeDay(old?.day) || today(),
      lastTopup: normalizeDay(old?.lastTopup),
      tickets: [], nextId: 1,
      operations: [{ type: old ? 'opening' : 'start', amount: balance, date: Date.now(), balance }],
    };
  }

  function addOperation(w, type, amount, date = Date.now(), ticketId) {
    w.balance += amount;
    w.operations.push({ type, amount, date, ticketId, balance: w.balance });
  }

  function rollDay(w) {
    const day = today();
    if (day === w.day) return false;
    w.day = day;
    const grant = CFG.balance.start - w.balance;
    if (grant > 0) addOperation(w, 'daily', grant);
    return true;
  }

  function transact(change) {
    const apply = () => {
      const saved = stored(walletKey);
      const next = saved || (wallet ? structuredClone(wallet) : newWallet());
      const dayChanged = rollDay(next);
      const result = change(next);
      if (!saved || dayChanged || result) {
        try {
          localStorage.setItem(walletKey, JSON.stringify(next));
        } catch (e) {
          if (saved) throw e;
        }
        wallet = next;
        emit();
      } else {
        wallet = next;
      }
      return result;
    };
    return navigator.locks ? navigator.locks.request(walletKey, apply) : Promise.resolve(apply());
  }

  function onBalance(fn) { listeners.push(fn); fn(wallet.balance); }
  function emit() {
    paintBalance();
    renderWallet();
    listeners.forEach(fn => fn(wallet.balance));
  }

  function getBalance() { return wallet.balance; }
  function canTopup() { return wallet.lastTopup !== today(); }
  function getTickets(game) { return wallet.tickets.filter(t => t.meta.game === game); }

  async function buyTicket(bets, meta, total, targetDraw) {
    const ticket = await transact(w => {
      if (!Number.isFinite(total) || total <= 0 || total > w.balance) return null;
      const t = { id: w.nextId++, bets, meta, total, targetDraw: targetDraw() };
      w.tickets.push(t);
      addOperation(w, 'purchase', -total, Date.now(), t.id);
      return t;
    });
    if (!ticket) return null;
    if (wallet.balance <= 0) T.send('gc_balance_depleted', { balance_left: 0 });
    if (wallet.balance <= CFG.balance.start * 0.2) {
      let sent = false;
      try { sent = sessionStorage.getItem('nl_bal80') === '1'; sessionStorage.setItem('nl_bal80', '1'); } catch (e) {}
      if (!sent) T.send('fn_balance_80', { balance_left: wallet.balance }, { throttle: 0 });
    }
    return ticket;
  }

  function settleTickets(currentDraw, resolve) {
    if (wallet.day === today() && !wallet.tickets.some(t => !t.resolved && t.targetDraw < currentDraw)) {
      return Promise.resolve();
    }
    return transact(w => {
      const due = w.tickets.filter(t => !t.resolved && t.targetDraw < currentDraw)
        .sort((a, b) => a.targetDraw - b.targetDraw);
      due.forEach(t => {
        Object.assign(t, resolve(t), { resolved: true });
        if (t.payout > 0) addOperation(w, 'win', t.payout, Date.now(), t.id);
      });
      return due.length > 0;
    });
  }

  async function topup() {
    const applied = await transact(w => {
      if (w.lastTopup === today()) return false;
      addOperation(w, 'topup', CFG.balance.topupAmount);
      w.lastTopup = today();
      return true;
    });
    if (applied) T.send('gc_balance_topup', { amount: CFG.balance.topupAmount, method: 'daily' });
  }

  const dateTime = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const colorName = color => color === 'red' ? 'красный' : 'чёрный';

  function ticketSelection(ticket) {
    if (ticket.meta.game === 'plinko') {
      const slot = ticket.detail?.slot;
      return (Number.isInteger(slot) ? '<p class="wallet-selection-note">Выпал слот ' + (slot + 1) + '</p>' : '') +
        '<ul class="wallet-bets" aria-label="Ставки по слотам">' + ticket.bets.map((b, i) => {
          const payout = ticket.detail?.perBet?.[i]?.payout;
          const result = payout === undefined ? '' : '<span class="wallet-bet-result' +
            (payout > 0 ? ' positive">Выигрыш +' + fmt(payout) + ' ◆' : '">Без выигрыша') + '</span>';
          return '<li><strong>Слот ' + (b.slot + 1) + ' <span>×' + b.mult + '</span></strong><b>' +
            fmt(b.price) + ' ◆</b>' + result + '</li>';
        }).join('') + '</ul>';
    }
    const bet = ticket.bets[0];
    const result = ticket.detail?.perBet?.[0];
    const note = bet.color ? 'Прогноз — ' + colorName(bet.color) : 'Выбранные карты';
    const outcome = bet.color && typeof result?.colorWon === 'boolean'
      ? (result.colorWon ? 'Цвет угадан' : 'Цвет не угадан')
      : (Number.isInteger(result?.matches) ? 'Совпало карт — ' + result.matches : '');
    const cards = bet.cards.map(({ rank, suit }) => '<span>' + rank + suit + '</span>').join('');
    return '<p class="wallet-selection-note">' + note + '</p><div class="wallet-cards" aria-label="Карты в билете">' +
      cards + '</div>' + (outcome ? '<p class="wallet-selection-note">' + outcome + '</p>' : '');
  }

  function ticketStatus(t) {
    if (!t.resolved) return 'Ожидает розыгрыша';
    return t.payout ? 'Выигрыш +' + fmt(t.payout) + ' ◆' : 'Без выигрыша';
  }

  function renderWallet() {
    const dialog = document.getElementById('nlWallet');
    if (!dialog?.open) return;
    dialog.querySelector('#nlWalletBalance').textContent = fmt(wallet.balance) + ' ◆';
    const rows = dialog.querySelector('#nlWalletRows');
    const expanded = new Set([...rows.querySelectorAll('details[open]')].map(row => row.dataset.walletRecord));
    const focused = rows.contains(document.activeElement)
      ? document.activeElement.closest('details')?.dataset.walletRecord : undefined;
    const labels = { start: 'Стартовый баланс', opening: 'Остаток из предыдущей версии',
      daily: 'Ежедневное начисление', topup: 'Пополнение демобаланса',
      purchase: 'Покупка билета', win: 'Начисление выигрыша' };
    const tickets = new Map(wallet.tickets.map(t => [t.id, t]));
    const field = (label, value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    rows.innerHTML = wallet.operations.map((op, i) => {
      const t = tickets.get(op.ticketId);
      const amount = '<b class="wallet-amount' + (op.amount > 0 ? ' positive' : '') + '">' +
        (op.amount < 0 ? '−' : '+') + fmt(Math.abs(op.amount)) + ' ◆</b>';
      const time = '<time datetime="' + new Date(op.date).toISOString() + '">' + dateTime.format(op.date) + '</time>';
      const balance = fmt(op.balance) + ' ◆';
      const label = labels[op.type];
      if (!t) {
        return '<li class="wallet-row"><div class="wallet-summary wallet-summary-plain"><span class="wallet-row-title">' +
          '<strong>' + label + '</strong>' + time + '</span><span class="wallet-row-values">' + amount +
          '<span class="wallet-meta">Остаток ' + balance + '</span></span></div></li>';
      }
      const isPoker = t.meta.game === 'poker';
      const game = isPoker ? 'Покер 52' : 'Плинко';
      const mode = isPoker ? field('Режим', t.bets[0].market === 'match' ? 'Основная игра' : 'Дополнительная игра') : '';
      return '<li class="wallet-row"><details data-wallet-record="' + i + '"' +
        (expanded.has(String(i)) ? ' open' : '') + '><summary class="wallet-summary">' +
        '<span class="wallet-row-title"><strong>' + game + '</strong><span class="wallet-meta">Билет № ' +
        fmt(t.id) + '</span></span>' + amount + '<span class="wallet-chevron" aria-hidden="true"></span></summary>' +
        '<div class="wallet-details"><dl class="wallet-detail-grid">' + field('Тираж', '№ ' + fmt(t.targetDraw)) +
        field('Ставка', fmt(t.total) + ' ◆') + mode + field('Результат', ticketStatus(t)) +
        field('Операция', label) + field('Дата и время', time) + field('Остаток', balance) + '</dl>' +
        '<div class="wallet-selection">' + ticketSelection(t) + '</div></div></details></li>';
    }).reverse().join('');
    if (focused !== undefined) rows.querySelector('[data-wallet-record="' + focused + '"] > summary')?.focus({ preventScroll: true });
  }

  function paintBalance() {
    const el = document.getElementById('nlBalance');
    if (el) el.textContent = fmt(wallet.balance);
    const btn = document.getElementById('nlTopup');
    if (btn) {
      btn.disabled = !canTopup();
      btn.title = canTopup() ? 'Пополнить демобаланс' : 'Пополнение доступно раз в сутки';
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
        ? '<a class="nl-back" href="index.html" data-track="gc_return_to_hub" aria-label="Все игры" title="Ко всем играм">' +
            '<span class="nl-back-ico">←</span><span class="nl-back-txt">Все игры</span></a>'
        : '') +
      (opts.title ? '<span class="pill-title">' + opts.title + '</span>' : '') +
      '<span class="nl-header-spacer"></span>' +
      '<button type="button" class="nl-balance" id="nlBalanceBtn" aria-haspopup="dialog" title="История баланса"><span class="label">Баланс</span> ' +
        '<b id="nlBalance" class="tnum">' + fmt(wallet.balance) + '</b> ◆</button>' +
      '<button class="btn btn-ghost btn-mini" id="nlTopup">+ демо</button>' +
      // Выход на основной сайт НЛ — на всех страницах, включая хаб.
      '<a class="nl-site" href="' + CFG.links.site + '" data-track="gc_return_to_site" title="Вернуться на сайт Национальной Лотереи">' +
        '<span class="nl-site-long">Вернуться на сайт НЛ</span><span class="nl-site-short">На сайт НЛ</span></a>';

    host.insertAdjacentHTML('afterend',
      '<dialog class="wallet-dialog" id="nlWallet" aria-labelledby="nlWalletTitle">' +
      '<div class="wallet-head"><div><h2 id="nlWalletTitle">История баланса</h2>' +
      '<div class="wallet-current" id="nlWalletBalance"></div></div>' +
      '<form method="dialog"><button class="wallet-close" aria-label="Закрыть">×</button></form></div>' +
      '<ul id="nlWalletRows" class="wallet-rows"></ul></dialog>');
    host.querySelector('#nlBalanceBtn').onclick = async function () {
      document.getElementById('nlWallet').showModal();
      renderWallet();
      await window.NLDraw?.settleDue();
    };
    host.querySelector('#nlTopup').onclick = topup;
    paintBalance();
  }

  /* ---------- вкладки разделов ---------- */
  function renderTabs(tabs, onSwitch) {
    const host = document.getElementById('nlTabs');
    if (!host) return;
    host.className = 'nl-tabs';
    host.innerHTML = tabs.map((t, i) =>
      '<button class="nl-tab' + (i === 0 ? ' active" aria-current="page' : '') + '" data-view="' + t.id + '">' + t.label + '</button>'
    ).join('');

    host.addEventListener('click', function (e) {
      const btn = e.target.closest('.nl-tab');
      if (!btn) return;
      switchTo(btn.dataset.view, onSwitch);
    });
  }

  function switchTo(id, onSwitch) {
    document.querySelectorAll('.nl-tab').forEach(b => {
      const active = b.dataset.view === id;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
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
        '<div>© Национальная Лотерея · демонстрационная площадка</div>' +
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
    legacyKey = 'nl_wallet:' + uid;
    walletKey = 'nl_wallet_v2:' + uid;
    wallet = stored(walletKey) || newWallet();
    rollDay(wallet);
    transact(() => false);
    window.addEventListener('storage', e => {
      if (e.key !== walletKey || !e.newValue) return;
      wallet = stored(walletKey) || wallet;
      emit();
    });

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
    document.querySelectorAll('[data-survey]').forEach(link => { link.href = CFG.links.survey; });
    if (opts.tabs) renderTabs(opts.tabs, opts.onSwitch);

    window.addEventListener('pagehide', function () {
      T.send('gc_session_end', { balance_left: wallet.balance }, { throttle: 0 });
    });

    return { uid: uid };
  }

  return {
    init, renderHeader, renderTabs, renderFooter, switchTo, markOffline,
    getBalance, buyTicket, settleTickets, getTickets, onBalance, fmt, dateTime,
    colorName, ticketStatus,
  };
})();
