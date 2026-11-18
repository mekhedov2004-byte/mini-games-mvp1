/* Часы и результаты тиражей общие для всех клиентов демоверсии. */
window.NLDraw = (function () {
  const CFG = window.NL_CONFIG;
  const T = window.NLTrack;
  const S = window.NLShell;
  const rules = window.NLRules;

  const DS = CFG.drawSeconds;
  const EPOCH = CFG.drawEpoch;
  const START = CFG.drawStartNo;
  const openedAt = Date.now();
  let confirmedCount = 0;
  let ticking = false;
  let hooks;
  const state = { drawNo: 0, tleft: DS, tickets: [], history: [] };

  function drawNoAt(t) { return START + Math.floor((t - EPOCH) / 1000 / DS); }
  function tleftAt(t) { return DS - (Math.floor((t - EPOCH) / 1000) % DS); }
  function drawTime(drawNo) { return EPOCH + (drawNo - START + 1) * DS * 1000; }

  function hashSeed(n, salt) {
    let h = (2166136261 ^ n) >>> 0;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 16777619) >>> 0;
    return h >>> 0;
  }

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function outcomeFor(game, drawNo) {
    return { drawNo, ...rules[game].generate(makeRng(hashSeed(drawNo, game))) };
  }

  function settleDue(at = Date.now()) {
    return S.settleTickets(drawNoAt(at), ticket => {
      const game = ticket.meta.game;
      return rules[game].resolve(ticket, outcomeFor(game, ticket.targetDraw));
    });
  }

  function refreshHistory() {
    state.history = hooks.gameId
      ? Array.from({ length: Math.min(10, Math.max(0, state.drawNo - START)) },
          (_, i) => outcomeFor(hooks.gameId, state.drawNo - 1 - i))
      : [];
  }

  async function loop() {
    if (ticking) return;
    ticking = true;
    try {
      const previous = state.drawNo;
      const now = Date.now();
      await settleDue(now);
      state.drawNo = drawNoAt(now);
      state.tleft = tleftAt(now);
      if (previous !== state.drawNo) refreshHistory();
      refreshTickets();
      const open = state.tleft > CFG.betCloseBefore;
      const seconds = String(state.tleft % 60).padStart(2, '0');
      hooks.onTick?.({ ...state, open, label: Math.floor(state.tleft / 60) + ':' + seconds });

      if (hooks.gameId && previous < state.drawNo) {
        const result = resultFor(previous);
        const { outcome, playing, totalPay } = result;

        T.send('gc_draw_result', {
          draw_no: previous,
          outcome: hooks.outcomeLabel(outcome),
          tickets: playing.length,
          is_win: totalPay > 0,
          payout: totalPay,
        }, { throttle: 0 });

        hooks.onResult?.(result);
      }
    } finally {
      ticking = false;
    }
  }

  function resultFor(drawNo, resolved = S.getTickets(hooks.gameId)) {
    const playing = resolved.filter(t => t.targetDraw === drawNo && t.resolved);
    const totalPay = playing.reduce((sum, t) => sum + t.payout, 0);
    return { drawNo, outcome: outcomeFor(hooks.gameId, drawNo), playing, totalPay };
  }

  function latestResult() {
    const finished = S.getTickets(hooks.gameId).filter(t => t.resolved);
    if (!finished.length) return null;
    const drawNo = finished.reduce((latest, t) => Math.max(latest, t.targetDraw), 0);
    return resultFor(drawNo, finished);
  }

  function refreshTickets() {
    if (!hooks.gameId) return;
    const tickets = S.getTickets(hooks.gameId).filter(t => !t.resolved);
    if (tickets.length === state.tickets.length &&
        tickets.every((ticket, i) => ticket.id === state.tickets[i].id)) return;
    state.tickets = tickets;
    hooks.onTickets?.(tickets);
  }

  function init(opts = {}) {
    hooks = opts;
    state.drawNo = drawNoAt(Date.now());
    refreshHistory();
    S.onBalance(refreshTickets);
    const ready = loop();
    setInterval(loop, 300);
    window.addEventListener('pageshow', loop);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    return ready;
  }

  async function submitTicket(bets, meta) {
    await settleDue();
    const total = bets.reduce((sum, b) => sum + b.price, 0);
    const t = await S.buyTicket(bets, meta, total, () => {
      const now = Date.now();
      return drawNoAt(now) + Number(tleftAt(now) <= CFG.betCloseBefore);
    });
    if (!t) return null;

    confirmedCount++;
    T.send('gc_ticket_confirm', {
      ticket_id: t.id,
      ticket_no: confirmedCount,
      is_first_ticket: confirmedCount === 1,
      sec_since_open: Math.round((Date.now() - openedAt) / 1000),
      bets_count: bets.length,
      total_stake: total,
      draw_no: t.targetDraw,
      queued: t.targetDraw !== drawNoAt(Date.now()),
      autorepeat: false,
    }, { throttle: 0 });

    T.send('gc_draw_wait_start', { ticket_id: t.id, wait_sec: tleftAt(Date.now()) });

    if (meta.game) {
      T.send('fn_' + meta.game + '_buy', { bets_count: bets.length, total_stake: total }, { throttle: 0 });
      (meta.goals || []).forEach(function (g) { T.send(g, {}, { throttle: 0 }); });
      let n = 0;
      try { n = +(sessionStorage.getItem('nl_buys:' + meta.game) || 0); sessionStorage.setItem('nl_buys:' + meta.game, String(n + 1)); } catch (e) {}
      if (n >= 1) T.send('fn_' + meta.game + '_rebuy', { ticket_no: n + 1 }, { throttle: 0 });
      markPlayed(meta.game);
    }
    return t;
  }

  function markPlayed(game) {
    try {
      const p = JSON.parse(localStorage.getItem('nl_played') || '[]');
      if (p.indexOf(game) < 0) { p.push(game); localStorage.setItem('nl_played', JSON.stringify(p)); }
      if (p.indexOf('poker') >= 0 && p.indexOf('plinko') >= 0 && sessionStorage.getItem('nl_both') !== '1') {
        sessionStorage.setItem('nl_both', '1');
        T.send('fn_both_games', {}, { throttle: 0 });
      }
    } catch (e) {}
  }

  return {
    init, submitTicket, state, drawTime, settleDue, latestResult, resultFor,
    get history() { return state.history; },
  };
})();
