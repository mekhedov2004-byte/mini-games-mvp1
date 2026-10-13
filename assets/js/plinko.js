/* ============================================================
   plinko.js — логика Плинко.
   Все числа берутся из nl-config.js, здесь их быть не должно.
   Тираж, баланс и аналитика — через общие модули.
   ============================================================ */

(function () {
  const CFG  = window.NL_CONFIG;
  const P    = CFG.plinko;
  const T    = window.NLTrack;
  const S    = window.NLShell;
  const D    = window.NLDraw;

  const NSLOT = P.MULT.length;
  const fmt = S.fmt;

  const tier = m => m >= 280 ? 'hot' : (m >= 20 ? 'mid' : 'low');
  const catName = m => m >= 280 ? 'Куш' : (m >= 20 ? 'Средняя' : 'Частая');

  /* Число 1..10000 → номер слота по таблице корзин */
  function slotFromN(n) {
    let acc = 0;
    for (let i = 0; i < NSLOT; i++) { acc += P.BUCKET[i]; if (n <= acc) return i; }
    return NSLOT - 1;
  }

  const ui = {
    selected: new Set(),
    stake: 1,
    counts: new Array(NSLOT).fill(0),
    lastResult: null,
  };

  /* ============================================================
     ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
     ============================================================ */
  S.init({
    gameId: 'plinko',
    tabs: [
      { id: 'game',    label: 'Игра' },
      { id: 'how',     label: 'Как играть' },
      { id: 'prizes',  label: 'Выигрыши' },
      { id: 'history', label: 'Архив тиражей' },
    ],
  });

  T.send('gc_game_open', {
    entry: document.referrer.indexOf('index.html') >= 0 ? 'hub' : 'direct',
    draw_mode: 'timer',
  }, { throttle: 0 });

  /* ============================================================
     СЕТКА СЛОТОВ, ТАБЛИЦА ПРИЗОВ, ГИСТОГРАММА
     ============================================================ */
  const slotsHost = document.getElementById('plSlots');
  P.MULT.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'slotbtn tier-' + tier(m);
    d.dataset.i = i;
    d.innerHTML = '<div class="n">' + (i + 1) + '</div>' +
                  '<div class="m">x' + m + '</div>' +
                  '<div class="p">' + P.CHANCE[i] + '</div>';
    d.onclick = () => toggleSlot(i);
    slotsHost.appendChild(d);
  });

  const prizesHost = document.getElementById('plPrizes');
  P.MULT.forEach((m, i) => {
    const note = i === 7 ? ' (центр)' : ((i === 0 || i === NSLOT - 1) ? ' (край)' : '');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (i + 1) + note + '</td><td>' + catName(m) + '</td>' +
      '<td class="r">' + P.CHANCE[i] + '</td>' +
      '<td class="r mlt">x' + m + '</td>' +
      '<td class="r">' + fmt(P.baseStake * m) + ' ◆</td>';
    prizesHost.appendChild(tr);
  });

  const barsHost = document.getElementById('plBars');
  for (let i = 0; i < NSLOT; i++) {
    barsHost.innerHTML += '<div class="bar"><div class="fill" id="plBar' + i +
      '" style="height:2px"></div><div class="bn">' + (i + 1) + '</div></div>';
  }

  /* ============================================================
     ВЫБОР СЛОТОВ И НОМИНАЛА
     ============================================================ */
  function toggleSlot(i) {
    if (ui.selected.has(i)) ui.selected.delete(i); else ui.selected.add(i);
    document.querySelector('.slotbtn[data-i="' + i + '"]').classList.toggle('sel', ui.selected.has(i));
    // Троттлинг внутри трекера: клики по слотам быстрые, часть событий
    // иначе потерялась бы на ограничении Метрики.
    T.send('gc_combination_select', {
      market: 'slot', combination: 'slot_' + (i + 1),
      multiplier: P.MULT[i], probability: P.CHANCE[i],
    });
    board.draw(); refresh();
  }

  function clearSelection() {
    ui.selected.clear();
    document.querySelectorAll('.slotbtn').forEach(e => e.classList.remove('sel'));
    board.draw(); refresh();
  }

  const stakeInput = document.getElementById('plStake');
  stakeInput.oninput = function () {
    ui.stake = +stakeInput.value;
    document.getElementById('plStakeVal').textContent =
      P.baseStake + ' ◆ ×' + ui.stake + ' = ' + fmt(P.baseStake * ui.stake) + ' ◆';
    refresh();
    // Ползунок за одно перетаскивание срабатывает десяток раз — гасим.
    T.send('gc_stake_change', {
      stake_multiplier: ui.stake, stake_amount: P.baseStake * ui.stake,
    }, { throttle: 800 });
  };

  const selPrice = () => P.baseStake * ui.stake * ui.selected.size;
  function selMaxWin() {
    let mx = 0;
    ui.selected.forEach(i => { if (P.MULT[i] > mx) mx = P.MULT[i]; });
    return mx * P.baseStake * ui.stake;
  }

  function refresh() {
    const price = selPrice();
    document.getElementById('plSelText').textContent = ui.selected.size
      ? 'Выбрано слотов: ' + ui.selected.size + ' · итого ' + fmt(price) + ' ◆'
      : 'Слоты не выбраны';
    document.getElementById('plPotWin').textContent = price ? fmt(selMaxWin()) + ' ◆' : '—';

    const btn = document.getElementById('plAddBtn');
    const enough = price <= S.getBalance();
    btn.disabled = price <= 0 || !enough;
    btn.textContent = !enough && price > 0
      ? 'Недостаточно баланса'
      : 'Добавить в билет' + (price ? ' · ' + fmt(price) + ' ◆' : '');
  }

  /* ============================================================
     БИЛЕТ
     ============================================================ */
  document.getElementById('plAddBtn').onclick = function () {
    if (!ui.selected.size) return;
    const each = P.baseStake * ui.stake;
    const bets = [];
    ui.selected.forEach(i => bets.push({
      slot: i, mult: P.MULT[i], price: each,
      label: 'Слот ' + (i + 1), stakeMult: ui.stake,
    }));

    bets.forEach(b => T.send('gc_bet_add', {
      market: 'slot', combination: 'slot_' + (b.slot + 1),
      multiplier: b.mult, stake_amount: b.price, bets_in_slip: bets.length,
    }, { throttle: 0 }));

    const t = D.submitTicket(bets, { game: 'plinko' });
    if (!t) return;

    if (ui.lastResult) {
      T.send('gc_bet_repeat', {
        same_combination: false,
        prev_result: ui.lastResult.win ? 'win' : 'loss',
      }, { throttle: 0 });
    }
    clearSelection();
  };

  document.getElementById('plRandom').onclick = function () {
    clearSelection();
    const n = 1 + Math.floor(Math.random() * 3);
    while (ui.selected.size < n) {
      const i = Math.floor(Math.random() * NSLOT);
      if (!ui.selected.has(i)) {
        ui.selected.add(i);
        document.querySelector('.slotbtn[data-i="' + i + '"]').classList.add('sel');
      }
    }
    T.send('gc_random_ticket', { picks: n }, { throttle: 0 });
    board.draw(); refresh();
  };

  document.getElementById('plAuto').onchange = function () {
    D.setAutorepeat(this.checked);
  };

  function renderTickets(tickets) {
    const host = document.getElementById('plSlip');
    const rows = [];
    let totalStake = 0;

    tickets.forEach(t => {
      totalStake += t.total;
      t.bets.forEach(b => {
        const won = t.resolved && t.detail && t.detail.slot === b.slot;
        const right = t.resolved
          ? '<div class="amount' + (won ? ' w' : '') + '">' + (won ? '+' + fmt(b.price * b.mult) + ' ◆' : '—') + '</div>'
          : '<div class="amount">до ' + fmt(b.price * b.mult) + ' ◆</div>' +
            '<button class="rm" data-rm="' + t.id + '" aria-label="убрать">×</button>';
        rows.push('<div class="bet-row ' + (t.resolved ? (won ? 'win' : 'lose') : '') + '">' +
          '<div class="info"><div class="name">' + b.label +
          (t.targetDraw > D.state.drawNo ? ' · тираж ' + t.targetDraw : '') + '</div>' +
          '<div class="meta">x' + b.mult + ' · ' + P.baseStake + ' ◆ ×' + b.stakeMult + ' = ' + fmt(b.price) + ' ◆</div></div>' +
          right + '</div>');
      });
    });

    host.innerHTML = rows.length ? rows.join('')
      : '<div class="slip-empty">Билет пуст. Отметьте слоты и добавьте ставку.</div>';
    host.querySelectorAll('[data-rm]').forEach(b => {
      b.onclick = () => D.removeTicket(+b.dataset.rm);
    });

    const nBets = tickets.reduce((a, t) => a + t.bets.length, 0);
    document.getElementById('plSlipCnt').textContent = nBets + ' ставок';
    document.getElementById('plTotStake').textContent = fmt(totalStake) + ' ◆';

    let best = 0;
    for (let s = 0; s < NSLOT; s++) {
      let sum = 0;
      tickets.forEach(t => t.bets.forEach(b => { if (b.slot === s) sum += b.price * b.mult; }));
      if (sum > best) best = sum;
    }
    document.getElementById('plTotWin').textContent = fmt(best) + ' ◆';

    const left = tickets.length && tickets[0].repeatLeft
      ? 'осталось тиражей: ' + tickets[0].repeatLeft : '';
    document.getElementById('plAutoLeft').textContent = left;

    board.draw();
    refresh();
  }

  /* ============================================================
     ДОСКА (canvas)
     ============================================================ */
  const board = (function () {
    const cv = document.getElementById('board');
    const ctx = cv.getContext('2d');
    const ROWS = P.rows, W = 600, H = 620, SW = 38, CX = 300, SY = 54, LG = 34, PEGR = 4, BR = 9;
    const DPR = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = W * DPR; cv.height = H * DPR; ctx.scale(DPR, DPR);

    const xs = i => CX + (i - (NSLOT - 1) / 2) * SW;
    const yL = l => SY + l * LG;

    let ball = null, landed = null, landTime = 0, trail = [];
    const PEGS = [];
    for (let r = 0; r < ROWS; r++) for (let i = 0; i <= r; i++) PEGS.push({ x: CX + (i - r / 2) * SW, y: yL(r + 1) });
    const pegHit = new Float64Array(PEGS.length);

    function pingPeg(x, y) {
      let bi = 0, bd = 1e9;
      for (let p = 0; p < PEGS.length; p++) {
        const dx = PEGS[p].x - x, dy = PEGS[p].y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = p; }
      }
      pegHit[bi] = performance.now();
    }

    function rr(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function draw() {
      const now = performance.now();
      ctx.clearRect(0, 0, W, H);

      for (let p = 0; p < PEGS.length; p++) {
        const pg = PEGS[p], g = Math.max(0, 1 - (now - pegHit[p]) / 320);
        if (g > 0) {
          ctx.save(); ctx.shadowColor = '#FFE7F1'; ctx.shadowBlur = 13 * g;
          ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(pg.x, pg.y, PEGR + 1.8 * g, 0, 7); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(206,203,246,.55)';
          ctx.beginPath(); ctx.arc(pg.x, pg.y, PEGR, 0, 7); ctx.fill();
        }
      }

      const inSlip = new Set();
      D.state.tickets.forEach(t => t.bets.forEach(b => inSlip.add(b.slot)));

      const top = yL(ROWS) + 14, h = 56;
      ctx.fillStyle = 'rgba(150,143,224,.30)';
      const wy = yL(1) - 4, wh = top + h - wy, ww = 5;
      rr(CX - (NSLOT / 2) * SW - ww / 2, wy, ww, wh, 2.5); ctx.fill();
      rr(CX + (NSLOT / 2) * SW - ww / 2, wy, ww, wh, 2.5); ctx.fill();

      for (let i = 0; i < NSLOT; i++) {
        const x = xs(i), w = SW - 3;
        const m = P.MULT[i], isHot = m >= 280, isMid = m >= 20 && m < 280;
        const win = landed === i, sel = ui.selected.has(i), slip = inSlip.has(i);
        const pulse = win ? Math.max(0, 1 - (now - landTime) / 700) : 0;

        ctx.fillStyle = win ? '#3CE0A0' : sel ? 'rgba(229,56,138,.34)'
          : slip ? 'rgba(229,56,138,.16)'
          : (isHot ? 'rgba(255,200,61,.14)' : isMid ? 'rgba(255,91,166,.12)' : 'rgba(127,119,221,.12)');
        if (pulse > 0) { ctx.save(); ctx.shadowColor = '#3CE0A0'; ctx.shadowBlur = 24 * pulse; }
        rr(x - w / 2, top - pulse * 3, w, h + pulse * 3, 7); ctx.fill();
        if (pulse > 0) ctx.restore();

        ctx.strokeStyle = win ? '#3CE0A0' : sel ? '#E5388A'
          : slip ? 'rgba(229,56,138,.7)' : 'rgba(255,255,255,.10)';
        ctx.lineWidth = (sel || win || slip) ? 2 : 1; ctx.stroke();

        ctx.fillStyle = win ? '#06351f' : isHot ? '#FFC83D' : isMid ? '#FF5BA6' : '#CECBF6';
        ctx.font = 'bold 12px system-ui, Arial'; ctx.textAlign = 'center';
        ctx.fillText('x' + m, x, top + 23);
        ctx.fillStyle = win ? 'rgba(6,53,31,.75)' : 'rgba(255,255,255,.5)';
        ctx.font = '10px system-ui, Arial'; ctx.fillText(i + 1, x, top + 41);
        if (slip && !win) {
          ctx.fillStyle = '#FF5BA6'; ctx.beginPath(); ctx.arc(x, top + 48, 2.2, 0, 7); ctx.fill();
        }
      }

      for (let t = 0; t < trail.length; t++) {
        const a = (t + 1) / trail.length;
        ctx.fillStyle = 'rgba(255,91,166,' + (a * a * 0.5) + ')';
        ctx.beginPath(); ctx.arc(trail[t].x, trail[t].y, BR * (0.32 + 0.5 * a), 0, 7); ctx.fill();
      }
      if (ball && isFinite(ball.x) && isFinite(ball.y)) {
        const sy = ball.sy || 1, sx = 1 / sy;
        ctx.save(); ctx.shadowColor = '#FF5BA6'; ctx.shadowBlur = 18;
        ctx.fillStyle = '#E5388A';
        ctx.beginPath(); ctx.ellipse(ball.x, ball.y, BR * sx, BR * sy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#FFD2E6';
        ctx.beginPath(); ctx.arc(ball.x - 2.5 * sx, ball.y - 2.5 * sy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* Траектория строится под уже известный слот: анимация показывает
       зафиксированный исход, а не получает его. */
    function animate(targetSlot, done) {
      const slow = window.NLAB && window.NLAB.variant('anim_speed', T.getContext().uid) === 'slow';
      const G = slow ? 1400 : 2200;

      const dec = [];
      for (let k = 0; k < ROWS; k++) dec.push(k < targetSlot ? 1 : 0);
      for (let k = dec.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [dec[k], dec[j]] = [dec[j], dec[k]];
      }

      const OFF = BR + 2;
      const pts = [{ x: CX, y: yL(0) - 4 }];
      let rights = 0;
      for (let r = 0; r < ROWS; r++) {
        pts.push({ x: CX + (rights - r / 2) * SW, y: yL(r + 1) - OFF });
        if (dec[r]) rights++;
      }
      pts.push({ x: xs(targetSlot), y: yL(ROWS) + 40 });

      const NS = pts.length - 1;
      let k = 0, segT0 = null, vy0 = 0, vx = 0, Tc = 0, finished = false;
      const started = performance.now();
      trail = [];

      function setupSeg() {
        const dy = pts[k + 1].y - pts[k].y, dx = pts[k + 1].x - pts[k].x;
        const tN = Math.sqrt(2 * Math.max(dy, 1) / G);
        const pop = k > 0 && k < NS - 1 && Math.random() < 0.26;
        Tc = tN * (pop ? (1.3 + Math.random() * 0.3) : (0.8 + Math.random() * 0.14));
        vy0 = (dy - 0.5 * G * Tc * Tc) / Tc;
        vx = dx / Tc;
      }

      function step(now) {
        if (finished) return;
        if (segT0 === null) { segT0 = now; setupSeg(); }
        let t = (now - segT0) / 1000;
        if (t >= Tc) {
          k++;
          if (k <= ROWS) pingPeg(pts[k].x, yL(k));
          if (k >= NS) { finished = true; clearTimeout(watch); settle(); return; }
          segT0 = now; setupSeg(); t = 0;
        }
        const x = pts[k].x + vx * t;
        const y = pts[k].y + vy0 * t + 0.5 * G * t * t;
        const sy = 1 - 0.15 * Math.exp(-Math.min(t, Tc - t) * 16);
        ball = { x, y, sy };
        trail.push({ x, y }); if (trail.length > 10) trail.shift();
        draw(); requestAnimationFrame(step);
      }

      function settle() {
        const sx = pts[NS].x, floorY = yL(ROWS) + 40, gg = 1500, e = 0.4;
        let py = yL(ROWS) + 10, vy = 170, last = performance.now();
        landed = targetSlot; landTime = performance.now();
        function s(now) {
          const dt = Math.min(0.034, (now - last) / 1000); last = now;
          vy += gg * dt; py += vy * dt;
          if (py >= floorY) {
            py = floorY; vy = -vy * e;
            if (Math.abs(vy) < 28) {
              ball = { x: sx, y: floorY, sy: 1 }; trail = []; draw();
              T.send('gc_animation_complete', {
                duration_sec: +((performance.now() - started) / 1000).toFixed(1),
              }, { throttle: 0 });
              done(); return;
            }
          }
          ball = { x: sx, y: py, sy: py >= floorY - 3 ? 0.8 : 1 };
          if (trail.length) trail.shift();
          draw(); requestAnimationFrame(s);
        }
        requestAnimationFrame(s);
      }

      const watch = setTimeout(function () {
        if (finished) return;
        finished = true;
        ball = { x: pts[NS].x, y: yL(ROWS) + 40, sy: 1 };
        landed = targetSlot; landTime = performance.now(); trail = []; draw();
        T.send('gc_animation_skip', { skip_at_sec: 10 }, { throttle: 0 });
        done();
      }, 10000);

      requestAnimationFrame(step);
    }

    /* Слоты под пирамидой тоже кликабельны: та же ставка, что и кнопками справа.
       Пересчитываем координаты клика в логические координаты холста. */
    function slotAtEvent(e) {
      const rect = cv.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height * H;
      const top = yL(ROWS) + 14, h = 56;
      if (y < top - 8 || y > top + h + 8) return -1;
      const x = (e.clientX - rect.left) / rect.width * W;
      let best = -1, bd = 1e9;
      for (let i = 0; i < NSLOT; i++) { const d = Math.abs(xs(i) - x); if (d < bd) { bd = d; best = i; } }
      return bd <= SW / 2 + 2 ? best : -1;
    }
    cv.addEventListener('click', e => { const i = slotAtEvent(e); if (i >= 0) toggleSlot(i); });
    cv.addEventListener('mousemove', e => { cv.style.cursor = slotAtEvent(e) >= 0 ? 'pointer' : 'default'; });

    return { draw, animate, reset: () => { landed = null; ball = null; trail = []; } };
  })();

  /* ============================================================
     ПОДКЛЮЧЕНИЕ К ТИРАЖУ
     ============================================================ */
  D.init({
    gameId: 'plinko',
    prefillHistory: 20,

    /* Исход тиража детерминирован его номером: rng приходит из nl-draw,
       засеянный номером тиража, поэтому число одинаково у всех игроков. */
    generate: function (rng) {
      const n = 1 + Math.floor(rng() * P.outcomeMax);
      return { number: n, slot: slotFromN(n) };
    },

    outcomeLabel: o => 'slot_' + (o.slot + 1),

    resolve: function (ticket, outcome) {
      let payout = 0;
      ticket.bets.forEach(b => { if (b.slot === outcome.slot) payout += b.price * b.mult; });
      return { payout, detail: { slot: outcome.slot, number: outcome.number } };
    },

    onTick: function (s) {
      document.getElementById('plDrawNo').textContent = fmt(s.drawNo);
      document.getElementById('plTimer').textContent = s.label;
      const w = document.getElementById('plTimerWrap');
      w.classList.toggle('soon', s.tleft <= 10 && s.open && !s.busy);
      w.classList.toggle('closed', !s.open && !s.busy);
    },

    onTickets: renderTickets,

    onDrawStart: function (outcome, finish) {
      board.reset();
      const banner = document.getElementById('plBanner');
      banner.className = 'result-banner';
      banner.textContent = 'Розыгрыш № ' + fmt(D.state.drawNo) + ' — шар летит…';
      board.animate(outcome.slot, finish);
    },

    onResult: function (r) {
      const banner = document.getElementById('plBanner');
      const slot = r.outcome.slot;
      ui.counts[slot]++;
      ui.lastResult = { win: r.totalPay > 0, slot };

      if (!r.playing.length) {
        banner.className = 'result-banner';
        banner.innerHTML = '<div class="big">Слот ' + (slot + 1) + ' · x' + P.MULT[slot] + '</div>' +
          '<div class="sub">число ' + fmt(r.outcome.number) + ' · ставок в этом тираже не было</div>';
      } else if (r.totalPay > 0) {
        banner.className = 'result-banner win';
        banner.innerHTML = '<div class="big">Выигрыш +' + fmt(r.totalPay) + ' ◆</div>' +
          '<div class="sub">слот ' + (slot + 1) + ' · число ' + fmt(r.outcome.number) +
          ' · сыграло ставок: ' + r.wins + '</div>';
      } else {
        banner.className = 'result-banner lose';
        banner.innerHTML = '<div class="big">Слот ' + (slot + 1) + ' · x' + P.MULT[slot] + '</div>' +
          '<div class="sub">число ' + fmt(r.outcome.number) + ' — билет не сыграл</div>';
      }
      renderHistory();
    },
  });

  function renderHistory() {
    const host = document.getElementById('plHist');
    const h = D.history.slice(0, 20);
    host.innerHTML = h.length
      ? h.map(o => '<div class="chip c-' + tier(P.MULT[o.slot]) + '">' + (o.slot + 1) + '</div>').join('')
      : '<span style="color:var(--faint);font-size:13px">Пока пусто — дождитесь первого розыгрыша.</span>';
    const mx = Math.max(1, ...ui.counts);
    for (let i = 0; i < NSLOT; i++) {
      const el = document.getElementById('plBar' + i);
      if (el) el.style.height = (2 + ui.counts[i] / mx * 78) + 'px';
    }
  }

  /* ---------- старт ---------- */
  S.onBalance(refresh);
  stakeInput.dispatchEvent(new Event('input'));
  board.draw();
  renderTickets([]);
  renderHistory();
})();
