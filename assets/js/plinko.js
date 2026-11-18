/* Интерфейс Плинко, включая анимацию падения шарика. */
(function () {
  const CFG = window.NL_CONFIG;
  const P = CFG.plinko;
  const T = window.NLTrack;
  const S = window.NLShell;
  const D = window.NLDraw;
  const Archive = window.NLArchive;
  const { fmt } = S;
  const $ = id => document.getElementById(id);
  const NSLOT = P.MULT.length;
  const ui = { selected: new Set(), stake: 1, buying: false, lastResult: null, drawingTickets: [], purchased: new Set() };
  const money = amount => fmt(amount) + ' ◆';
  const tier = m => m >= 280 ? 'hot' : (m >= 20 ? 'mid' : 'low');

  S.init({
    gameId: 'plinko',
    tabs: [
      { id: 'game', label: 'Игра' },
      { id: 'how', label: 'Как играть' },
      { id: 'history', label: 'Архив тиражей' },
    ],
  });

  T.send('gc_game_open', {
    entry: document.referrer.indexOf('index.html') >= 0 ? 'hub' : 'direct',
    draw_mode: 'timer',
  }, { throttle: 0 });

  const slots = P.MULT.map((mult, i) => {
    const button = document.createElement('button');
    button.className = 'slotbtn tier-' + tier(mult);
    button.setAttribute('aria-label', 'Слот ' + (i + 1) + ', коэффициент ' + mult);
    button.innerHTML = '<span>' + (i + 1) + '</span><b>×' + mult + '</b>';
    button.onclick = () => {
      if (ui.buying) return;
      if (ui.selected.has(i)) ui.selected.delete(i); else ui.selected.add(i);
      T.send('gc_combination_select', {
        market: 'slot', combination: 'slot_' + (i + 1),
        multiplier: P.MULT[i], probability: P.CHANCE[i],
      });
      refresh();
    };
    $('plSlots').appendChild(button);
    return button;
  });

  const boardSlots = P.MULT.map((_, i) => {
    const item = document.createElement('li');
    item.textContent = i + 1;
    $('plBoardSlots').appendChild(item);
    return item;
  });

  $('plPrizes').innerHTML = P.MULT.map((mult, i) =>
    '<tr><td>' + (i + 1) + '</td><td class="r">×' +
    mult + '</td><td class="r">' + money(P.baseStake * mult) + '</td></tr>').join('');

  const stakeInput = $('plStake');
  stakeInput.max = P.stakeMultMax;
  stakeInput.oninput = function () {
    ui.stake = +stakeInput.value;
    refresh();
    T.send('gc_stake_change', {
      stake_multiplier: ui.stake, stake_amount: P.baseStake * ui.stake,
    }, { throttle: 800 });
  };

  function refresh() {
    const each = P.baseStake * ui.stake;
    const price = each * ui.selected.size;
    const balance = S.getBalance();
    const maxMult = Math.max(0, ...[...ui.selected].map(i => P.MULT[i]));
    $('plStakeVal').textContent = money(each);
    stakeInput.setAttribute('aria-valuetext', fmt(each) + ' кристаллов на слот');
    $('plSelText').textContent = price ? 'Выбрано слотов: ' + ui.selected.size : 'Выберите слот';
    $('plPotWin').textContent = price ? (price > balance ? 'Недостаточно кристаллов'
      : 'Выигрыш до ' + money(each * maxMult)) : '';
    $('plAddBtn').disabled = !price || price > balance || ui.buying;
    $('plAddBtn').textContent = price ? 'Купить билет · ' + money(price) : 'Купить билет';
    slots.forEach((button, i) => button.setAttribute('aria-pressed', String(ui.selected.has(i))));
  }

  $('plAddBtn').onclick = async function () {
    if (!ui.selected.size || ui.buying) return;
    ui.buying = true;
    const each = P.baseStake * ui.stake;
    const bets = [...ui.selected].sort((a, b) => a - b).map(i => ({
      slot: i, mult: P.MULT[i], price: each, stakeMult: ui.stake,
    }));
    refresh();
    let receipt = '';
    try {
      bets.forEach(b => T.send('gc_bet_add', {
        market: 'slot', combination: 'slot_' + (b.slot + 1),
        multiplier: b.mult, stake_amount: b.price, bets_in_slip: bets.length,
      }, { throttle: 0 }));

      const ticket = await D.submitTicket(bets, { game: 'plinko' });
      if (!ticket) return;
      receipt = 'Билет № ' + ticket.id + ' куплен';
      if (ui.lastResult) {
        T.send('gc_bet_repeat', {
          same_combination: false, prev_result: ui.lastResult.totalPay > 0 ? 'win' : 'loss',
        }, { throttle: 0 });
      }
      ui.selected.clear();
    } catch (e) {
      receipt = 'Не удалось сохранить билет. Попробуйте ещё раз';
    } finally {
      ui.buying = false;
      refresh();
      if (receipt) $('plSelText').textContent = receipt;
    }
  };

  $('plRandom').onclick = () => {
    if (ui.buying) return;
    ui.selected.clear();
    const n = 1 + Math.floor(Math.random() * 3);
    while (ui.selected.size < n) ui.selected.add(Math.floor(Math.random() * NSLOT));
    T.send('gc_random_ticket', { picks: n }, { throttle: 0 });
    refresh();
  };

  function paintPurchased(tickets) {
    const active = [...tickets, ...ui.drawingTickets];
    ui.purchased = new Set(active.flatMap(t => t.bets.map(b => b.slot)));
    boardSlots.forEach((item, i) => {
      const bought = ui.purchased.has(i);
      item.classList.toggle('purchased', bought);
      const draws = [...new Set(active.filter(t => t.bets.some(b => b.slot === i)).map(t => t.targetDraw))];
      item.title = bought ? 'Слот ' + (i + 1) + ' куплен · тираж № ' + draws.map(fmt).join(', ') : '';
      item.setAttribute('aria-label', bought ? item.title : String(i + 1));
    });
    $('plPurchasedKey').hidden = !ui.purchased.size;
    board.draw();
  }

  function renderTickets(tickets) {
    paintPurchased(tickets);
    $('plSlipCnt').textContent = fmt(tickets.length);
    $('plSlip').innerHTML = tickets.length ? tickets.slice().reverse().map(t =>
      '<article class="ticket-row ticket-main">' +
      '<div class="ticket-line"><strong>Билет № ' + t.id + '</strong><b>' + money(t.total) +
      '</b></div><p>Тираж № ' + fmt(t.targetDraw) + '</p><ul class="pl-ticket-bets">' +
      t.bets.map(b => '<li><span>Слот ' + (b.slot + 1) + ' · ×' + b.mult + '</span><span>' +
        money(b.price) + '</span></li>').join('') + '</ul></article>'
    ).join('') : '<p class="empty-state">Здесь появятся купленные билеты</p>';
  }

  const board = (function () {
    const cv = document.getElementById('board');
    const ctx = cv.getContext('2d');
    const ROWS = P.rows, W = 600, H = 390, SW = 40, CX = 300, SY = 12, LG = 23, PEGR = 3.5, BR = 9;
    const DPR = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = W * DPR; cv.height = H * DPR; ctx.scale(DPR, DPR);

    const xs = i => CX + (i - (NSLOT - 1) / 2) * SW;
    const yL = l => SY + l * LG;
    const slotTop = yL(ROWS) + 14;
    const slotBottom = H - 5;
    const landingY = slotBottom - BR;
    const frame = ctx.createLinearGradient(30, 60, W - 30, slotTop);
    frame.addColorStop(0, '#663cdc');
    frame.addColorStop(.44, '#75bcff');
    frame.addColorStop(1, '#9a58ff');
    const slotColors = P.MULT.map(mult => ({
      hot: ['#432936', '#b58062'],
      mid: ['#3b2350', '#98578b'],
      low: ['#202853', '#5d65ac'],
    })[tier(mult)]);

    let ball = { x: CX, y: yL(0) + 3, sy: 1 }, trail = [], landedSlot = null;
    const PEGS = [];
    for (let r = 0; r < ROWS; r++) for (let i = 0; i <= r; i++) PEGS.push({ x: CX + (i - r / 2) * SW, y: yL(r + 1) });
    const pegHit = new Float64Array(PEGS.length).fill(-Infinity);

    function pingPeg(x, y) {
      let bi = 0, bd = 1e9;
      for (let p = 0; p < PEGS.length; p++) {
        const dx = PEGS[p].x - x, dy = PEGS[p].y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = p; }
      }
      pegHit[bi] = performance.now();
    }

    function draw() {
      const now = performance.now();
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(7, slotTop - 4);
      ctx.lineTo(CX - 18, yL(0) + 7);
      ctx.quadraticCurveTo(CX, yL(0) - 9, CX + 18, yL(0) + 7);
      ctx.lineTo(W - 7, slotTop - 4);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#9358ff28';
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = frame;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#6a72ff';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();

      for (let p = 0; p < PEGS.length; p++) {
        const pg = PEGS[p], g = Math.max(0, 1 - (now - pegHit[p]) / 320);
        if (g > 0) {
          ctx.save(); ctx.shadowColor = '#80baff'; ctx.shadowBlur = 15 * g;
          ctx.fillStyle = '#d2efff'; ctx.beginPath(); ctx.arc(pg.x, pg.y, PEGR + 1.8 * g, 0, 7); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = '#8596df';
          ctx.beginPath(); ctx.arc(pg.x, pg.y, PEGR, 0, 7); ctx.fill();
          ctx.fillStyle = '#c1d8ff';
          ctx.beginPath(); ctx.arc(pg.x - .7, pg.y - .9, 1.45, 0, 7); ctx.fill();
        }
      }

      boardSlots.forEach((_, i) => {
        const x = xs(i) - SW / 2 + 1.5;
        ctx.beginPath();
        ctx.roundRect(x, slotTop, SW - 3, slotBottom - slotTop, [3, 3, 6, 6]);
        const [fill, edge] = i === landedSlot ? ['#225b4d', '#7aebc1']
          : ui.purchased.has(i) ? ['#532d92', '#c69cff'] : slotColors[i];
        ctx.fillStyle = fill;
        ctx.strokeStyle = edge;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = edge;
        ctx.fillRect(x + 5, slotTop + 4, SW - 13, 1);
      });

      for (let t = 0; t < trail.length; t++) {
        const a = (t + 1) / trail.length;
        ctx.fillStyle = 'rgba(149,121,255,' + (a * a * 0.55) + ')';
        ctx.beginPath(); ctx.arc(trail[t].x, trail[t].y, BR * (0.32 + 0.5 * a), 0, 7); ctx.fill();
      }
      if (ball && isFinite(ball.x) && isFinite(ball.y)) {
        const sy = ball.sy || 1, sx = 1 / sy;
        const light = ctx.createRadialGradient(ball.x - 3, ball.y - 4, 0, ball.x, ball.y, BR * 1.18);
        light.addColorStop(0, '#f5faff');
        light.addColorStop(.32, '#8adeff');
        light.addColorStop(.65, '#9461f3');
        light.addColorStop(1, '#502dba');
        ctx.save(); ctx.shadowColor = '#936cff'; ctx.shadowBlur = 18;
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.ellipse(ball.x, ball.y, BR * sx, BR * sy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* Траектория строится под уже известный слот: анимация показывает
       зафиксированный исход, а не получает его. */
    function animate(targetSlot, done) {
      landedSlot = null;
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
      pts.push({ x: xs(targetSlot), y: landingY });

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
          if (k >= NS) { settle(); return; }
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
        const sx = pts[NS].x, floorY = landingY, gg = 1500, e = 0.4;
        let py = yL(ROWS) + 10, vy = 170, last = performance.now();
        function s(now) {
          if (finished) return;
          const dt = Math.min(0.034, (now - last) / 1000); last = now;
          vy += gg * dt; py += vy * dt;
          if (py >= floorY) {
            py = floorY; vy = -vy * e;
            if (Math.abs(vy) < 28) {
              finished = true; clearTimeout(watch);
              land(targetSlot);
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
        land(targetSlot);
        T.send('gc_animation_skip', { skip_at_sec: 10 }, { throttle: 0 });
        done();
      }, 10000);

      requestAnimationFrame(step);
    }

    function land(slot) {
      landedSlot = slot;
      ball = { x: xs(slot), y: landingY, sy: 1 };
      trail = [];
      draw();
    }

    return { draw, animate, land };
  })();

  function resultStats(tickets) {
    const bets = tickets.flatMap(t => t.detail.perBet);
    return { bets: bets.length, wins: bets.filter(b => b.payout > 0).length };
  }

  function renderResult(result) {
    const banner = $('plBanner');
    const { outcome, drawNo, playing, totalPay } = result;
    const { bets, wins } = resultStats(playing);
    banner.className = 'result-banner' + (totalPay ? ' win' : '');
    banner.hidden = false;
    banner.innerHTML = '<p>Тираж № ' + fmt(drawNo) + '</p><strong>Выпал слот ' + (outcome.slot + 1) +
      ' · ×' + P.MULT[outcome.slot] + '</strong><p>' + (bets ? 'Ваших ставок: ' + bets +
        ' · выигрышных: ' + wins : 'Ваших ставок в этом тираже нет') + '</p>' +
      (bets ? '<p><b>' + (totalPay ? 'Выигрыш +' + money(totalPay) : 'В этом тираже без выигрыша') + '</b></p>' : '');
    slots.forEach((button, i) => button.classList.toggle('landed', i === outcome.slot));
    boardSlots.forEach((item, i) => {
      item.classList.toggle('landed', i === outcome.slot);
      if (i === outcome.slot) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
  }

  function renderHistory() {
    const history = D.history;
    $('plArchiveVisuals').hidden = !history.length;
    $('plArchiveEmpty').hidden = !!history.length;
    if (history.length) {
      const counts = Array(NSLOT).fill(0);
      $('plArchiveSample').textContent = Archive.drawCount(history.length);
      $('plArchiveRecent').innerHTML = history.map(({ slot, drawNo }) => {
        counts[slot]++;
        const mult = P.MULT[slot];
        const label = 'Тираж № ' + fmt(drawNo) + ' · слот ' + (slot + 1) + ' · ×' + mult;
        return '<li class="slot-result tier-' + tier(mult) + '" title="' + label +
          '" aria-label="' + label + '">' + (slot + 1) + '</li>';
      }).join('');
      Archive.renderColumns($('plArchivePlot'), P.MULT.map((_, i) => i + 1), counts, 'Слот');
    }
    const tickets = S.getTickets('plinko');
    $('plHist').innerHTML = history.slice(0, 10).map(o => {
      const { bets, wins } = resultStats(tickets.filter(t => t.targetDraw === o.drawNo && t.resolved));
      return '<article class="card archive-row"><div><h3>Тираж № ' + fmt(o.drawNo) + '</h3><time>' +
        S.dateTime.format(D.drawTime(o.drawNo)) + '</time></div><div class="slot-result tier-' + tier(P.MULT[o.slot]) +
        '">Слот ' + (o.slot + 1) + ' <b>×' + P.MULT[o.slot] + '</b></div><div class="archive-result"><span>' +
        (bets ? 'Ваших ставок: ' + bets + ' · выигрышных: ' + wins : 'Ваших ставок в тираже нет') +
        '</span></div></article>';
    }).join('');
  }

  renderTickets([]);
  S.onBalance(refresh);
  board.draw();

  D.init({
    gameId: 'plinko',
    historyLimit: 20,
    outcomeLabel: o => 'slot_' + (o.slot + 1),
    onTick(s) {
      $('plDrawNo').textContent = fmt(s.drawNo);
      $('plTimer').textContent = s.label;
      $('plTimerWrap').classList.toggle('soon', s.tleft <= 15);
    },
    onTickets: renderTickets,
    onResult(result) {
      renderHistory();
      if (result.playing.length) ui.lastResult = result;
      slots.forEach(button => button.classList.remove('landed'));
      boardSlots.forEach(item => {
        item.classList.remove('landed');
        item.removeAttribute('aria-current');
      });
      ui.drawingTickets = result.playing;
      paintPurchased(D.state.tickets);
      const finish = () => {
        ui.drawingTickets = [];
        renderResult(result);
        paintPurchased(D.state.tickets);
      };
      if ($('view-game').classList.contains('active') && !document.hidden &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        $('plBanner').hidden = false;
        $('plBanner').className = 'result-banner';
        $('plBanner').textContent = 'Тираж № ' + fmt(result.drawNo) + ' · идёт розыгрыш';
        board.animate(result.outcome.slot, finish);
      } else {
        board.land(result.outcome.slot);
        finish();
      }
    },
  }).then(() => {
    ui.lastResult = D.latestResult();
    if (ui.lastResult) {
      board.land(ui.lastResult.outcome.slot);
      renderResult(ui.lastResult);
    }
    S.onBalance(renderHistory);
  });
})();
