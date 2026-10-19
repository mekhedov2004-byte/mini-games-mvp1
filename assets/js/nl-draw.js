/* ============================================================
   nl-draw.js — общий механизм тиража для всех игр.
   Таймер, закрытие приёма, очередь билетов, автоповтор.

   БЕЗ СЕРВЕРА, НО ТИРАЖ ОБЩИЙ ДЛЯ ВСЕХ.
   Номер тиража и таймер выводятся из настенных часов:
       drawNo = drawStartNo + floor((now - drawEpoch) / drawSeconds)
   поэтому одинаковы у всех клиентов без синхронизации.
   Исход тиража детерминирован: ГПСЧ засевается номером тиража,
   значит одно и то же «зерно» → одна и та же последовательность →
   одинаковые карты/числа на каждом устройстве. Соль по gameId
   делает исходы Плинко и Покера независимыми, оставаясь общими
   внутри своей игры.

   Игра передаёт две функции:
     generate(rng) → исход тиража (rng() — детерминированный [0,1))
     resolve(ticket, outcome) → { payout, detail }
   ============================================================ */

window.NLDraw = (function () {
  const CFG = window.NL_CONFIG;
  const T = window.NLTrack;
  const S = window.NLShell;

  const DS = CFG.drawSeconds;
  const EPOCH = CFG.drawEpoch;
  const START = CFG.drawStartNo;

  /* Для метрики «время до первой ставки»: каждая игра — отдельная страница,
     поэтому момент загрузки скрипта = момент входа в игру. */
  const openedAt = Date.now();
  let confirmedCount = 0;

  /* Часы; baseNow подменяется в тестах. */
  let baseNow = () => Date.now();
  const now = () => baseNow();

  const st = {
    gameId: null,
    drawNo: 0,
    tleft: DS,
    busy: false,          // идёт розыгрыш и анимация
    tickets: [],          // { id, targetDraw, bets, stake, total, repeatLeft }
    lastOutcome: null,
    history: [],          // последние исходы, новые впереди
    autorepeat: false,
    hooks: {},
    uid: 1,
  };

  /* ---------- часы → номер тиража и остаток ---------- */
  function drawNoAt(t) { return START + Math.floor((t - EPOCH) / 1000 / DS); }
  function tleftAt(t) { return DS - (Math.floor((t - EPOCH) / 1000) % DS); }

  /* ---------- детерминированный ГПСЧ (mulberry32), засев номером тиража ---------- */
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
  /* Исход конкретного тиража — чистая функция от его номера. */
  function outcomeFor(drawNo) {
    return st.hooks.generate(makeRng(hashSeed(drawNo, String(st.gameId))), drawNo);
  }

  /* Приём открыт, пока до розыгрыша больше порога и не идёт анимация */
  function isOpen() { return !st.busy && st.tleft > CFG.betCloseBefore; }

  /* В какой тираж поедет билет, собранный прямо сейчас */
  function targetDraw() { return isOpen() ? st.drawNo : st.drawNo + 1; }

  function init(opts) {
    st.gameId = opts.gameId;
    st.hooks = opts;
    if (opts.now) baseNow = opts.now;
    const t = now();
    st.drawNo = drawNoAt(t);
    st.tleft = tleftAt(t);

    /* Предзаполняем архив прошлыми тиражами — он одинаков у всех,
       так что «Архив тиражей» непустой сразу и совпадает между клиентами. */
    const pre = opts.prefillHistory || 0;
    for (let k = 1; k <= pre; k++) {
      const n = st.drawNo - k;
      if (n >= START) st.history.push(outcomeFor(n));   // сразу в порядке «новые впереди»
    }

    tick();
    setInterval(loop, 1000);
    return st;
  }

  function loop() {
    if (st.busy) { tick(); return; }
    const nowNo = drawNoAt(now());
    if (nowNo > st.drawNo) { run(); return; }   // граница тиража пройдена — разыгрываем
    st.tleft = tleftAt(now());
    tick();
  }

  function tick() {
    const open = isOpen();
    const mm = String(Math.floor(st.tleft / 60)).padStart(2, '0');
    const ss = String(st.tleft % 60).padStart(2, '0');
    const label = st.busy ? 'розыгрыш…' : (open ? mm + ':' + ss : 'приём закрыт');
    if (st.hooks.onTick) st.hooks.onTick({ drawNo: st.drawNo, tleft: st.tleft, open, label, busy: st.busy });
  }

  /* ---------- билеты ---------- */

  /* Билет всегда попадает в ближайший тираж, приём в который ещё открыт.
     Не успел в текущий — едет в следующий, ничего не теряется. */
  function submitTicket(bets, meta) {
    meta = meta || {};
    const total = bets.reduce((a, b) => a + b.price, 0);
    if (!S.spend(total)) return null;

    const t = {
      id: st.uid++,
      targetDraw: targetDraw(),
      bets: bets,
      total: total,
      repeatLeft: st.autorepeat ? CFG.autorepeat.maxDraws : 0,
      meta: meta,
    };
    st.tickets.push(t);
    confirmedCount++;

    T.send('gc_ticket_confirm', {
      ticket_id: t.id,
      ticket_no: confirmedCount,                               // какой по счёту билет за заход в игру
      is_first_ticket: confirmedCount === 1,
      sec_since_open: Math.round((Date.now() - openedAt) / 1000), // время от входа в игру
      bets_count: bets.length,
      total_stake: total,
      draw_no: t.targetDraw,
      queued: t.targetDraw !== st.drawNo,
      autorepeat: st.autorepeat,
    }, { throttle: 0 });

    T.send('gc_draw_wait_start', { ticket_id: t.id, wait_sec: st.tleft });

    if (st.hooks.onTickets) st.hooks.onTickets(st.tickets);
    return t;
  }

  function removeTicket(id) {
    const i = st.tickets.findIndex(t => t.id === id);
    if (i < 0) return;
    const t = st.tickets[i];
    if (t.targetDraw === st.drawNo && st.busy) return;   // розыгрыш уже идёт
    S.award(t.total);
    st.tickets.splice(i, 1);
    T.send('gc_bet_remove', { ticket_id: id, reason: 'manual' });
    if (st.hooks.onTickets) st.hooks.onTickets(st.tickets);
  }

  /* ---------- автоповтор ---------- */
  function setAutorepeat(on) {
    st.autorepeat = !!on;
    if (on) T.send('gc_autorepeat_on', { max_draws: CFG.autorepeat.maxDraws }, { throttle: 0 });
    else T.send('gc_autorepeat_off', { reason: 'manual' }, { throttle: 0 });
    st.tickets.forEach(t => { t.repeatLeft = on ? CFG.autorepeat.maxDraws : 0; });
    if (st.hooks.onTickets) st.hooks.onTickets(st.tickets);
  }

  /* Начисление + автоповтор для одного разыгранного тиража. Общая часть
     для обычного розыгрыша и «догоняющего» пересчёта пропущенных тиражей. */
  function settle(drawNo, outcome) {
    const playing = st.tickets.filter(t => t.targetDraw === drawNo);
    let totalPay = 0, wins = 0;
    playing.forEach(t => {
      const res = st.hooks.resolve(t, outcome) || { payout: 0 };
      t.payout = res.payout || 0;
      t.detail = res.detail;
      t.resolved = true;
      totalPay += t.payout;
      if (t.payout > 0) wins++;
    });
    if (totalPay > 0) S.award(totalPay);

    st.history.unshift(outcome);
    if (st.history.length > 50) st.history.pop();

    /* Автоповтор: тот же билет едет в следующий тираж, пока хватает баланса
       и не исчерпан лимит. */
    const repeats = [];
    playing.forEach(t => {
      if (t.repeatLeft > 0) {
        if (S.spend(t.total)) {
          repeats.push({
            id: st.uid++, targetDraw: drawNo + 1, bets: t.bets,
            total: t.total, repeatLeft: t.repeatLeft - 1, meta: t.meta,
          });
        } else {
          st.autorepeat = false;
          T.send('gc_autorepeat_off', { reason: 'no_balance' }, { throttle: 0 });
        }
      }
    });
    repeats.forEach(r => {
      if (r.repeatLeft === 0) T.send('gc_autorepeat_off', { reason: 'limit_reached' }, { throttle: 0 });
    });
    st.tickets = st.tickets.filter(t => t.targetDraw > drawNo).concat(repeats);

    return { playing, totalPay, wins };
  }

  /* ---------- розыгрыш ---------- */
  function run() {
    if (st.busy) return;
    st.busy = true;
    tick();

    const endedNo = st.drawNo;              // тираж, который завершился
    const outcome = outcomeFor(endedNo);
    st.lastOutcome = outcome;

    const finish = function () {
      const r = settle(endedNo, outcome);

      T.send('gc_draw_result', {
        draw_no: endedNo,
        outcome: st.hooks.outcomeLabel ? st.hooks.outcomeLabel(outcome) : String(outcome),
        tickets: r.playing.length,
        is_win: r.totalPay > 0,
        payout: r.totalPay,
      }, { throttle: 0 });

      if (st.hooks.onResult) st.hooks.onResult({ outcome, playing: r.playing, totalPay: r.totalPay, wins: r.wins, drawNo: endedNo });

      /* Догоняем пропущенные тиражи (например, вкладка была свёрнута):
         тихо начисляем и продолжаем автоповтор, без анимации и событий. */
      const cur = drawNoAt(now());
      for (let n = endedNo + 1; n < cur; n++) settle(n, outcomeFor(n));

      st.drawNo = drawNoAt(now());
      st.tleft = tleftAt(now());
      st.busy = false;
      tick();
      if (st.hooks.onTickets) st.hooks.onTickets(st.tickets);
    };

    if (st.hooks.onDrawStart) st.hooks.onDrawStart(outcome, finish);
    else finish();
  }

  return {
    init, submitTicket, removeTicket, setAutorepeat,
    isOpen, targetDraw,
    peek: outcomeFor,     // исход любого тиража по номеру (архив/тесты)
    state: st,
    get history() { return st.history; },
  };
})();
