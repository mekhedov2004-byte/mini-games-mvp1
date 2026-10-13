/* ============================================================
   poker.js — логика Покера 52.
   Все числа берутся из nl-config.js, здесь их быть не должно.
   Тираж, баланс и аналитика — через общие модули (NLDraw/NLShell/NLTrack).
   Своей тиражной логики тут нет: 5 карт розыгрыша приходят из NLDraw.generate,
   выплаты считает NLDraw.resolve — те же карты для всех игроков.
   ============================================================ */

(function () {
  const CFG = window.NL_CONFIG;
  const PK  = CFG.poker;
  const T   = window.NLTrack;
  const S   = window.NLShell;
  const D   = window.NLDraw;
  const fmt = S.fmt;
  const A   = PK.anim;

  const $ = id => document.getElementById(id);

  /* ============================================================
     КОЛОДА И ПОКЕРНАЯ ЛОГИКА
     Портировано из прототипа. Призы и состав колоды — из конфига.
     ============================================================ */
  const RED = new Set(PK.redSuits);
  const DECK = [];
  PK.ranks.forEach(r => PK.suits.forEach(s => DECK.push({ rank: r, suit: s })));

  const isRed = c => RED.has(c.suit);
  const suitColor = c => isRed(c) ? 'red' : 'black';
  const sameCard = (a, b) => a.rank === b.rank && a.suit === b.suit;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Перетасовка с внешним ГПСЧ — для детерминированного тиража (один на всех). */
  function shuffleRng(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function nCk(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
  }
  const combosForHand = n => nCk(n, 5);
  const priceForHand  = n => combosForHand(n) * PK.betPrice;

  function cardFaceHTML(card) {
    const cls = isRed(card) ? 'red' : 'black';
    return '<div class="pcard-corner tl ' + cls + '"><div class="pcard-rank">' + card.rank +
      '</div><div class="pcard-suit-sm">' + card.suit + '</div></div>' +
      '<div class="pcard-suit-lg ' + cls + '">' + card.suit + '</div>' +
      '<div class="pcard-corner br ' + cls + '"><div class="pcard-rank">' + card.rank +
      '</div><div class="pcard-suit-sm">' + card.suit + '</div></div>';
  }

  /* Все подмножества руки по 5 карт */
  function allFiveSubsets(cards) {
    const n = cards.length;
    if (n === 5) return [cards];
    const out = [], combo = [];
    (function rec(start) {
      if (combo.length === 5) { out.push(combo.slice()); return; }
      for (let i = start; i < n; i++) { combo.push(cards[i]); rec(i + 1); combo.pop(); }
    })(0);
    return out;
  }

  /* Оценка ровно 5 карт → название комбинации (ключ comboPrizes) */
  function evalFive(hand) {
    const rankVals = hand.map(c => PK.rankVal[c.rank]).sort((a, b) => a - b);
    const suits = hand.map(c => c.suit);
    const rc = {};
    rankVals.forEach(r => { rc[r] = (rc[r] || 0) + 1; });
    const counts = Object.values(rc).sort((a, b) => b - a);
    const isFlush = suits.every(s => s === suits[0]);
    const uniq = [...new Set(rankVals)];
    const isStr = uniq.length === 5 && (rankVals[4] - rankVals[0] === 4);
    const isWheel = uniq.length === 5 &&
      uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14;
    const isStraight = isStr || isWheel;
    const isRoyal = isFlush && rankVals[0] === 10 && rankVals[4] === 14 && new Set(rankVals).size === 5;
    if (isRoyal) return 'Роял Флеш';
    if (isFlush && isStraight) return 'Стрит Флеш';
    if (counts[0] === 4) return 'Каре';
    if (counts[0] === 3 && counts[1] === 2) return 'Фулл Хаус';
    if (isFlush) return 'Флеш';
    if (isStraight) return 'Стрит';
    if (counts[0] === 3) return 'Сет';
    if (counts[0] === 2 && counts[1] === 2) return 'Две пары';
    if (counts[0] === 2) {
      const pr = parseInt(Object.keys(rc).find(k => rc[k] === 2), 10);
      const nm = { 14: 'Тузов', 13: 'Королей', 12: 'Дам', 11: 'Валетов' };
      return pr >= 11 ? 'Пара ' + nm[pr] : 'Пара 10 и ниже';
    }
    return 'Старшая карта';
  }

  /* Лучшая комбинация руки (для показа) */
  function evaluateHand(cards) {
    let best = 'Старшая карта', bestRank = PK.comboOrder.length - 1;
    allFiveSubsets(cards).forEach(sub => {
      const c = evalFive(sub);
      const r = PK.comboOrder.indexOf(c);
      if (r >= 0 && r < bestRank) { best = c; bestRank = r; }
    });
    return best;
  }

  /* Тур 2: каждая 5-карточная комбинация руки оплачивается отдельно */
  function comboPayout(cards) {
    let total = 0;
    allFiveSubsets(cards).forEach(sub => { total += PK.comboPrizes[evalFive(sub)] || 0; });
    return total;
  }

  /* Тур 1: n карт в руке, m совпали с картами тиража. Комбинаций ровно
     с j совпадениями = C(m,j)·C(n-m,5-j); каждая платится по таблице. */
  function matchPayout(n, m) {
    let total = 0;
    for (let j = 0; j <= 5; j++) {
      const k = nCk(m, j) * nCk(n - m, 5 - j);
      if (k > 0) total += k * (PK.matchPrizes[j] || 0);
    }
    return total;
  }

  const countMatches = (cards, drawCards) =>
    cards.reduce((acc, pc) => acc + (drawCards.some(dc => sameCard(dc, pc)) ? 1 : 0), 0);

  /* ============================================================
     СОСТОЯНИЕ ИНТЕРФЕЙСА
     ============================================================ */
  const ui = {
    mainCards: [],    // индексы DECK текущей руки тура 1
    mainExtra: [],
    blindBase: [],    // 5 выданных карт тура 2 (объекты)
    blindExtra: [],
    color: null,      // выбранный цвет тура 2
    mainTickets: [],  // [{cards:[idx], extra:[idx]}]
    extraTickets: [], // [{nExtra, color}]
    active: null,     // билет NLDraw, который сейчас раскрывается
    phase: 'build',   // build | waiting | revealing | result
    lastResult: null,
    marketSeen: {},
  };

  const ticketHandSize = t => t.cards.length + t.extra.length;

  function markMarket(market) {
    if (ui.marketSeen[market]) return;
    ui.marketSeen[market] = true;
    T.send('gc_market_select', { market: market });
  }

  /* ============================================================
     ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
     ============================================================ */
  S.init({
    gameId: 'poker',
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

  /* ---------- статические значения из конфига ---------- */
  $('pkHeroPrice').textContent = fmt(PK.betPrice) + ' ◆';
  $('pkHeroSuper').textContent = fmt(PK.matchPrizes[5]) + ' ◆';
  $('pkMetaPrice').textContent = fmt(PK.betPrice) + ' ◆';
  $('pkMetaSuper').textContent = fmt(PK.matchPrizes[5]) + ' ◆';

  /* ---------- таблицы выигрышей ---------- */
  (function buildPrizeTables() {
    let mt = '';
    for (let m = 1; m <= 5; m++) {
      mt += '<tr><td>' + m + ' из 5</td><td class="r">' + fmt(PK.matchPrizes[m]) + ' ◆</td></tr>';
    }
    $('pkMatchPrizes').innerHTML = mt;

    /* Четыре пары J+ в конфиге равны — в таблице сводим в одну строку. */
    const rows = [
      ['Роял Флеш',        PK.comboPrizes['Роял Флеш']],
      ['Стрит Флеш',       PK.comboPrizes['Стрит Флеш']],
      ['Каре',             PK.comboPrizes['Каре']],
      ['Фулл Хаус',        PK.comboPrizes['Фулл Хаус']],
      ['Флеш',             PK.comboPrizes['Флеш']],
      ['Стрит',            PK.comboPrizes['Стрит']],
      ['Сет',              PK.comboPrizes['Сет']],
      ['Две пары',         PK.comboPrizes['Две пары']],
      ['Пара валетов и старше', PK.comboPrizes['Пара Валетов']],
      ['Пара 10 и ниже · старшая карта', PK.comboPrizes['Пара 10 и ниже']],
    ];
    $('pkComboPrizes').innerHTML = rows.map(r =>
      '<tr><td>' + r[0] + '</td><td class="r">' + (r[1] > 0 ? fmt(r[1]) + ' ◆' : '—') + '</td></tr>'
    ).join('');
  })();

  /* ============================================================
     ТУР 1 — СЕТКА 52 КАРТ
     ============================================================ */
  function buildGrid() {
    const grid = $('cardsGrid');
    grid.innerHTML = '';
    PK.suits.forEach(suit => {
      const row = document.createElement('div');
      row.className = 'grid-row';
      const red = RED.has(suit);
      const sc = document.createElement('div');
      sc.className = 'grid-row-suit ' + (red ? 'red' : 'black');
      sc.textContent = suit;
      row.appendChild(sc);
      PK.ranks.forEach(rank => {
        const idx = DECK.findIndex(c => c.rank === rank && c.suit === suit);
        const card = DECK[idx];
        const d = document.createElement('div');
        d.className = 'grid-card ' + (red ? 'red-card' : 'black-card');
        d.id = 'gc' + idx;
        d.innerHTML = '<div class="gc-rank">' + card.rank + '</div>' +
          '<div class="gc-suit">' + card.suit + '</div><div class="tick">✓</div>';
        d.onclick = () => toggleCard(idx);
        row.appendChild(d);
      });
      grid.appendChild(row);
    });
  }

  function toggleCard(idx) {
    const inMain = ui.mainCards.includes(idx);
    const inExtra = ui.mainExtra.includes(idx);
    if (inMain) {
      ui.mainCards = ui.mainCards.filter(i => i !== idx);
      if (ui.mainExtra.length) ui.mainCards.push(ui.mainExtra.shift());
    } else if (inExtra) {
      ui.mainExtra = ui.mainExtra.filter(i => i !== idx);
    } else if (ui.mainCards.length < 5) {
      ui.mainCards.push(idx);
    } else if (ui.mainExtra.length < PK.maxHand - 5) {
      ui.mainExtra.push(idx);
    } else {
      return;
    }
    const card = DECK[idx];
    markMarket('match');
    T.send('gc_combination_select', { market: 'match', combination: 'card_' + card.rank + card.suit });
    refreshGrid();
    updatePrice();
  }

  function refreshGrid() {
    const total = ui.mainCards.length + ui.mainExtra.length;
    DECK.forEach((c, i) => {
      const el = $('gc' + i);
      if (!el) return;
      el.classList.remove('selected-main', 'selected-extra', 'disabled');
      if (ui.mainCards.includes(i)) el.classList.add('selected-main');
      else if (ui.mainExtra.includes(i)) el.classList.add('selected-extra');
      else if (total >= PK.maxHand) el.classList.add('disabled');
    });
    $('mainCount').textContent = ui.mainCards.length;
    const tag = $('mainExtraTag');
    if (ui.mainExtra.length) { tag.style.display = ''; $('mainExtraNum').textContent = ui.mainExtra.length; }
    else tag.style.display = 'none';
  }

  function clearMain() { ui.mainCards = []; ui.mainExtra = []; refreshGrid(); updatePrice(); }

  function randomMain() {
    clearMain();
    ui.mainCards = shuffle(DECK.map((_, i) => i)).slice(0, 5);
    markMarket('match');
    T.send('gc_random_ticket', { picks: 5, market: 'match' }, { throttle: 0 });
    refreshGrid();
    updatePrice();
  }

  /* ============================================================
     ТУР 2 — ВЫДАННАЯ РУКА И ЦВЕТ
     ============================================================ */
  function dealBlindBase() { ui.blindBase = shuffle(DECK).slice(0, 5); }

  function renderBlind() {
    const row = $('blindRow');
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += '<div class="blind-card"><div class="card-back"><div class="card-back-mono">' +
        '<div class="mono-lg">П52</div><div class="mono-sm">ЛОТЕРЕЯ</div></div></div></div>';
    }
    ui.blindExtra.forEach((_, i) => {
      html += '<div class="blind-card is-extra" data-rm-blind="' + i + '" title="Убрать доп. карту" style="cursor:pointer">' +
        '<div class="card-back"><div class="card-back-mono"><div class="mono-lg">+1</div>' +
        '<div class="mono-sm">ДОП</div></div></div><div class="extra-tag">EXTRA</div></div>';
    });
    const canAdd = ui.blindExtra.length < PK.maxHand - 5;
    html += '<button class="add-blind-btn" id="pkBlindAdd"' + (canAdd ? '' : ' disabled') + '>' +
      '<div class="add-blind-icon">+</div><div>Доп. карта</div></button>';
    row.innerHTML = html;

    $('blindCount').textContent = 5 + ui.blindExtra.length;
    const tag = $('blindExtraTag');
    if (ui.blindExtra.length) { tag.style.display = ''; $('blindExtraNum').textContent = ui.blindExtra.length; }
    else tag.style.display = 'none';

    $('pkBlindAdd').onclick = addBlindExtra;
    row.querySelectorAll('[data-rm-blind]').forEach(el => {
      el.onclick = () => removeBlindExtra(+el.dataset.rmBlind);
    });
  }

  function addBlindExtra() {
    if (ui.blindExtra.length >= PK.maxHand - 5) return;
    const used = new Set([...ui.blindBase, ...ui.blindExtra].map(c => c.suit + c.rank));
    const pool = shuffle(DECK).filter(c => !used.has(c.suit + c.rank));
    ui.blindExtra.push(pool[0]);
    renderBlind();
    updatePrice();
  }

  function removeBlindExtra(i) { ui.blindExtra.splice(i, 1); renderBlind(); updatePrice(); }

  function resetBlind() { ui.blindExtra = []; dealBlindBase(); renderBlind(); updatePrice(); }

  function toggleColor(color) {
    ui.color = ui.color === color ? null : color;
    $('pkColorRed').classList.toggle('selected', ui.color === 'red');
    $('pkColorBlack').classList.toggle('selected', ui.color === 'black');
    if (ui.color) {
      markMarket('combo');
      T.send('gc_combination_select', { market: 'combo', combination: 'color_' + ui.color });
    }
    updatePrice();
  }

  /* ============================================================
     СБОРКА БИЛЕТА (корзина)
     ============================================================ */
  function addMainTicket() {
    if (ui.mainCards.length < 5) return;
    const t = { cards: ui.mainCards.slice(), extra: ui.mainExtra.slice() };
    ui.mainTickets.push(t);
    const n = ticketHandSize(t);
    T.send('gc_bet_add', {
      market: 'match', combination: 'match_' + n,
      multiplier: combosForHand(n), stake_amount: priceForHand(n),
      bets_in_slip: ui.mainTickets.length + ui.extraTickets.length,
    }, { throttle: 0 });
    clearMain();
  }

  function removeMainTicket(i) {
    ui.mainTickets.splice(i, 1);
    T.send('gc_bet_remove', { market: 'match', reason: 'manual' });
    updatePrice();
  }

  function addExtraTicket() {
    if (!ui.color) return;
    ui.extraTickets.push({ nExtra: ui.blindExtra.length, color: ui.color });
    const n = 5 + ui.blindExtra.length;
    T.send('gc_bet_add', {
      market: 'combo', combination: 'color_' + ui.color,
      multiplier: combosForHand(n), stake_amount: priceForHand(n),
      bets_in_slip: ui.mainTickets.length + ui.extraTickets.length,
    }, { throttle: 0 });
    ui.color = null;
    $('pkColorRed').classList.remove('selected');
    $('pkColorBlack').classList.remove('selected');
    ui.blindExtra = [];
    dealBlindBase();
    renderBlind();
    updatePrice();
  }

  function removeExtraTicket(i) {
    ui.extraTickets.splice(i, 1);
    T.send('gc_bet_remove', { market: 'combo', reason: 'manual' });
    updatePrice();
  }

  const mainTicketsPrice = () => ui.mainTickets.reduce((s, t) => s + priceForHand(ticketHandSize(t)), 0);
  const extraTicketsPrice = () => ui.extraTickets.reduce((s, t) => s + priceForHand(5 + t.nExtra), 0);

  function updatePrice() {
    /* Черновики: подсказки на кнопках «Добавить билет» */
    const nMain = ui.mainCards.length + ui.mainExtra.length;
    if (ui.mainCards.length >= 5) {
      $('pkMainAdd').disabled = false;
      $('mainAddInfo').textContent =
        'Рука ' + nMain + ' карт · ' + fmt(priceForHand(nMain)) + ' ◆ (' + combosForHand(nMain) + ' комб.)';
    } else {
      $('pkMainAdd').disabled = true;
      $('mainAddInfo').textContent = 'Выберите 5 карт, чтобы сформировать ставку';
    }

    const nExtra = 5 + ui.blindExtra.length;
    if (ui.color) {
      $('pkExtraAdd').disabled = false;
      $('extraAddInfo').textContent =
        'Цвет: ' + (ui.color === 'red' ? '♥ красный' : '♠ чёрный') + ' · ' + fmt(priceForHand(nExtra)) + ' ◆';
    } else {
      $('pkExtraAdd').disabled = true;
      $('extraAddInfo').textContent = 'Выберите цвет, чтобы сформировать ставку';
    }

    /* Корзина */
    const total = mainTicketsPrice() + extraTicketsPrice();
    const nTickets = ui.mainTickets.length + ui.extraTickets.length;
    $('ticketsCount').textContent = nTickets;
    $('priceValue').textContent = fmt(total);

    const bd = $('priceBreakdown');
    if (!nTickets) {
      bd.innerHTML = '<div class="cart-empty">Сформируйте ставку в любом туре<br>и нажмите «Добавить билет»</div>';
    } else {
      let rows = '';
      ui.mainTickets.forEach((t, i) => {
        const n = ticketHandSize(t);
        rows += '<div class="cart-row"><span class="cart-row-name">Тур 1 · ' + n + ' карт</span>' +
          '<span class="cart-row-price">' + fmt(priceForHand(n)) + ' ◆</span>' +
          '<button class="cart-rm" data-rm-main="' + i + '" aria-label="убрать">×</button></div>';
      });
      ui.extraTickets.forEach((t, i) => {
        const n = 5 + t.nExtra;
        rows += '<div class="cart-row"><span class="cart-row-name">Тур 2 · ' + (t.color === 'red' ? '♥' : '♠') +
          ' · ' + n + ' карт</span><span class="cart-row-price">' + fmt(priceForHand(n)) + ' ◆</span>' +
          '<button class="cart-rm" data-rm-extra="' + i + '" aria-label="убрать">×</button></div>';
      });
      bd.innerHTML = rows;
      bd.querySelectorAll('[data-rm-main]').forEach(b => b.onclick = () => removeMainTicket(+b.dataset.rmMain));
      bd.querySelectorAll('[data-rm-extra]').forEach(b => b.onclick = () => removeExtraTicket(+b.dataset.rmExtra));
    }

    const pay = $('pkPay');
    const enough = total <= S.getBalance();
    pay.disabled = !nTickets || !enough || ui.phase !== 'build';
    pay.textContent = nTickets ? 'Купить билет · ' + fmt(total) + ' ◆' : 'Купить билет';
    $('payHint').textContent = !nTickets ? 'Билетов пока нет'
      : (!enough ? 'Недостаточно баланса'
      : 'Списывается ' + fmt(total) + ' ◆ · билет едет в ближайший тираж');
  }

  /* ============================================================
     ПОКУПКА → ЭКРАН 2 (карты игрока раскрываются сразу)
     ============================================================ */
  function buyTicket() {
    if (ui.phase !== 'build') return;
    const bets = [];
    ui.mainTickets.forEach(t => {
      const cards = [...t.cards, ...t.extra].map(i => DECK[i]);
      bets.push({ market: 'match', cards: cards, price: priceForHand(cards.length), hand: cards.length });
    });
    /* Рука тура 2 фиксируется в момент покупки — resolve детерминирован. */
    ui.extraTickets.forEach(t => {
      const cards = shuffle(DECK).slice(0, 5 + t.nExtra);
      bets.push({
        market: 'combo', cards: cards, color: t.color, combo: evaluateHand(cards),
        price: priceForHand(cards.length), hand: cards.length,
      });
    });
    if (!bets.length) return;

    const ticket = D.submitTicket(bets, { game: 'poker' });
    if (!ticket) { updatePrice(); return; }   // не хватило баланса

    if (ui.lastResult) {
      T.send('gc_bet_repeat', {
        same_combination: false, prev_result: ui.lastResult.win ? 'win' : 'loss',
      }, { throttle: 0 });
    }

    ui.active = ticket;
    ui.phase = 'waiting';
    /* конструктор очищаем под возможный следующий билет */
    ui.mainTickets = []; ui.extraTickets = [];
    clearMain();
    ui.color = null;
    $('pkColorRed').classList.remove('selected');
    $('pkColorBlack').classList.remove('selected');
    ui.blindExtra = []; dealBlindBase(); renderBlind();

    revealYourCards(ticket);
    setStep(2);
    updatePrice();
  }

  /* Раскрытие карт игрока — анимация из прототипа, момент перенесён до тиража */
  function revealYourCards(ticket) {
    const matchBets = ticket.bets.filter(b => b.market === 'match');
    const comboBets = ticket.bets.filter(b => b.market === 'combo');

    const mainWrap = $('mainReveal');
    if (matchBets.length) {
      mainWrap.style.display = '';
      $('mainRevealRow').innerHTML = matchBets.map((b, ti) => {
        const cells = b.cards.map((c, i) =>
          '<div class="mini-card ' + (i >= 5 ? 'is-extra' : '') + '">' + cardFaceHTML(c) +
          (i >= 5 ? '<div class="mini-extra-tag">+</div>' : '') + '</div>').join('');
        const title = matchBets.length > 1
          ? '<div class="hand-col-sub" style="margin:0 0 8px">Билет №' + (ti + 1) + '</div>' : '';
        return '<div style="margin-bottom:14px">' + title + '<div class="mini-row">' + cells + '</div></div>';
      }).join('');
    } else mainWrap.style.display = 'none';

    const extraWrap = $('extraReveal');
    if (comboBets.length) {
      extraWrap.style.display = '';
      const first = comboBets[0];
      renderFan(first.cards);
      $('comboName').textContent = first.combo;
      const prize = comboPayout(first.cards);
      const cp = $('comboPrize');
      if (prize > 0) { cp.textContent = fmt(prize) + ' ◆'; cp.classList.remove('zero'); }
      else { cp.textContent = 'без приза'; cp.classList.add('zero'); }
      $('colorPickSummary').innerHTML =
        '<span style="color:var(--muted);font-size:13px;align-self:center">Ваш цвет:</span>' +
        '<span class="color-chip ' + first.color + '"><span class="color-chip-dot">' +
        (first.color === 'red' ? '♥' : '♠') + '</span>' +
        (first.color === 'red' ? 'Красная' : 'Чёрная') + '</span>';
      $('extraMoreList').innerHTML = comboBets.slice(1).map((b, k) =>
        '<div class="hand-col" style="margin-bottom:16px"><div class="hand-col-title">Билет №' + (k + 2) +
        ' · ' + b.combo + ' · ' + (comboPayout(b.cards) > 0 ? fmt(comboPayout(b.cards)) + ' ◆' : 'без приза') +
        '</div><div class="mini-row">' + b.cards.map(c => '<div class="mini-card">' + cardFaceHTML(c) + '</div>').join('') +
        '</div><div class="hand-col-sub">Цвет: ' + (b.color === 'red' ? '♥ красный' : '♠ чёрный') + '</div></div>').join('');
    } else extraWrap.style.display = 'none';

    $('pkWaitDraw').textContent = fmt(ticket.targetDraw);
  }

  /* Веер карт тура 2 — раскрытие как в прототипе (геометрия — как в plinko.js
     доска: пиксельные величины остаются в рендере, тайминги в конфиге). */
  function renderFan(cards) {
    const fan = $('revealFan');
    fan.innerHTML = '';
    const total = cards.length;
    const vw = window.innerWidth, narrow = vw <= 720;
    const cardW = narrow ? Math.max(58, Math.min(88, Math.floor((vw - 40) / 3.2))) : 140;
    const cardH = Math.round(cardW * 1.43);
    const angleStep = narrow ? 7 : (total <= 5 ? 11 : 9);
    const xStep = narrow
      ? Math.max(26, Math.min(cardW * 0.62, (vw - cardW - 28) / Math.max(1, total - 1)))
      : (total <= 5 ? 110 : 90);
    const center = (total - 1) / 2;
    cards.forEach((card, i) => {
      const off = i - center;
      const el = document.createElement('div');
      el.className = 'pcard';
      el.style.width = cardW + 'px';
      el.style.height = cardH + 'px';
      el.style.transform = 'rotate(' + (off * angleStep) + 'deg) translateX(' + (off * xStep) +
        'px) translateY(' + (Math.abs(off) * 8) + 'px)';
      el.style.zIndex = total - Math.abs(off);
      el.style.transformOrigin = 'bottom center';
      el.style.left = '50%';
      el.style.marginLeft = -(cardW / 2) + 'px';
      el.innerHTML = cardFaceHTML(card);
      fan.appendChild(el);
      setTimeout(() => el.classList.add('flipped'), A.fanBaseMs + i * A.fanStepMs);
    });
  }

  /* ============================================================
     СТЕППЕР
     ============================================================ */
  function setStep(n) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $('page' + n).classList.add('active');
    document.querySelectorAll('.stepper-item').forEach(el => {
      const s = +el.dataset.step;
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     ЭКРАН 3 — РОЗЫГРЫШ (раскрытие карт тиража)
     ============================================================ */
  function prepareDrawScreen(ticket) {
    const matchBets = ticket.bets.filter(b => b.market === 'match');
    const comboBets = ticket.bets.filter(b => b.market === 'combo');

    $('handColumns').classList.toggle('single', !(matchBets.length && comboBets.length));
    $('mainHandCol').style.display = matchBets.length ? '' : 'none';
    $('extraHandCol').style.display = comboBets.length ? '' : 'none';

    if (matchBets.length) {
      $('mainMiniRow').innerHTML = matchBets.map((b, ti) => {
        const cells = b.cards.map((c, i) =>
          '<div class="mini-card ' + (i >= 5 ? 'is-extra' : '') + '" id="mainMini' + ti + '_' + i + '">' +
          cardFaceHTML(c) + (i >= 5 ? '<div class="mini-extra-tag">+</div>' : '') + '</div>').join('');
        const title = matchBets.length > 1
          ? '<div class="hand-col-sub" style="margin:0 0 8px">Билет №' + (ti + 1) + '</div>' : '';
        return '<div style="margin-bottom:14px">' + title + '<div class="mini-row">' + cells + '</div></div>';
      }).join('');
    }
    if (comboBets.length) {
      $('extraMiniRow').innerHTML = comboBets.map((b, ti) => {
        const cells = b.cards.map((c, i) =>
          '<div class="mini-card ' + (i >= 5 ? 'is-extra' : '') + '">' + cardFaceHTML(c) +
          (i >= 5 ? '<div class="mini-extra-tag">+</div>' : '') + '</div>').join('');
        return '<div style="margin-bottom:14px;width:100%"><div class="hand-col-sub" style="margin:0 0 8px">' +
          (comboBets.length > 1 ? 'Билет №' + (ti + 1) + ' · ' : '') + b.combo + ' · цвет ' +
          (b.color === 'red' ? '♥' : '♠') + '</div><div class="mini-row">' + cells + '</div></div>';
      }).join('');
    }

    $('drawRow').innerHTML = '<div class="dcard empty"></div>'.repeat(PK.drawCards);
    $('summaryGrid').classList.remove('show');
    $('summaryGrid').innerHTML = '';
    $('replayRow').classList.remove('show');
    const banner = $('firstCardBanner');
    banner.classList.remove('show', 'win');
    banner.innerHTML = '';

    const sub = $('s3Sub');
    if (matchBets.length && comboBets.length)
      sub.textContent = 'Из колоды выпадают 5 карт. Совпадения и цвет первой карты определяют выигрыш.';
    else if (matchBets.length)
      sub.textContent = 'Из колоды выпадают 5 карт. Совпадения с вашими картами приносят приз.';
    else
      sub.textContent = 'Из колоды выпадают 5 карт. Если цвет первой совпадёт — комбинация активирована.';
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  /* Раскрытие 5 карт тиража. Порядок, тайминги и подача — как в прототипе. */
  async function runReveal(outcome, ticket, finish) {
    const ov = $('spinOverlay');
    $('spinText').textContent = 'Тасуем колоду…';
    $('spinSub').textContent = 'Карты розыгрыша готовятся';
    ov.classList.add('active');
    await delay(A.spinnerMs);
    ov.classList.remove('active');

    const started = performance.now();
    const drawCards = outcome.cards;
    const matchBets = ticket.bets.filter(b => b.market === 'match');
    const comboBets = ticket.bets.filter(b => b.market === 'combo');

    const perTicket = matchBets.map(b => {
      const matchedIdx = [], matchedDrawIdx = [];
      drawCards.forEach((dc, di) => {
        const pi = b.cards.findIndex((pc, ix) => sameCard(pc, dc) && matchedIdx.indexOf(ix) < 0);
        if (pi >= 0) { matchedIdx.push(pi); matchedDrawIdx.push(di); }
      });
      return { matchedIdx: matchedIdx, matchedDrawIdx: matchedDrawIdx };
    });
    const matchedDraw = [...new Set(perTicket.flatMap(p => p.matchedDrawIdx))];
    const markMinis = di => perTicket.forEach((p, ti) => {
      const k = p.matchedDrawIdx.indexOf(di);
      if (k >= 0) { const el = $('mainMini' + ti + '_' + p.matchedIdx[k]); if (el) el.classList.add('matched'); }
    });

    const slots = document.querySelectorAll('#drawRow .dcard');

    await delay(A.firstCardMs);
    const slot0 = slots[0];
    slot0.classList.remove('empty');
    slot0.classList.add('flipped', 'is-first');
    slot0.innerHTML = cardFaceHTML(drawCards[0]);

    if (comboBets.length) {
      await delay(A.colorBannerMs);
      const firstColor = suitColor(drawCards[0]);
      const won = comboBets.some(b => b.color === firstColor);
      const banner = $('firstCardBanner');
      if (won) {
        slot0.classList.add('win-color');
        banner.classList.add('show', 'win');
        banner.innerHTML = '<strong>Цвет угадан — ' + (firstColor === 'red' ? '♥ красный' : '♠ чёрный') +
          '.</strong> Выигрыш по покерной комбинации активирован.';
      } else {
        slot0.classList.add('lose-color');
        banner.classList.add('show');
        banner.innerHTML = 'Первая карта — ' + (firstColor === 'red' ? '♥ красная' : '♠ чёрная') +
          '. Цвет не совпал — выигрыш по комбинации не активирован.';
      }
    }
    if (matchedDraw.indexOf(0) >= 0) {
      await delay(A.matchFirstMs);
      slot0.classList.add('matched');
      slot0.insertAdjacentHTML('beforeend', '<div class="match-tag">совпало</div>');
      markMinis(0);
    }

    for (let i = 1; i < PK.drawCards; i++) {
      await delay(A.betweenCardsMs);
      const slot = slots[i];
      slot.classList.remove('empty');
      slot.classList.add('flipped');
      slot.innerHTML = cardFaceHTML(drawCards[i]);
      if (matchedDraw.indexOf(i) >= 0) {
        await delay(A.matchMs);
        slot.classList.add('matched');
        slot.insertAdjacentHTML('beforeend', '<div class="match-tag">совпало</div>');
        markMinis(i);
      }
    }

    await delay(A.resultMs);
    T.send('gc_animation_complete', {
      duration_sec: +((performance.now() - started) / 1000).toFixed(1),
    }, { throttle: 0 });
    finish();
  }

  /* ============================================================
     ИТОГ ТИРАЖА (числа считает NLDraw.resolve, здесь только показ)
     ============================================================ */
  function renderSummary(r) {
    const sg = $('summaryGrid');
    let html = '';
    let matchPrize = 0, comboPrize = 0, hasMatch = false, hasCombo = false, bestMatch = 0;
    let anyColorWon = false;
    const comboLines = [];
    r.playing.forEach(t => {
      if (!t.detail) return;
      matchPrize += t.detail.matchPrize;
      comboPrize += t.detail.comboPrize;
      t.detail.perBet.forEach(pb => {
        if (pb.market === 'match') { hasMatch = true; if (pb.matches > bestMatch) bestMatch = pb.matches; }
        else {
          hasCombo = true;
          if (pb.colorWon) anyColorWon = true;
          comboLines.push(pb.combo + (pb.colorWon && pb.payout > 0 ? ' — ' + fmt(pb.payout) + ' ◆' : ''));
        }
      });
    });
    const total = r.totalPay;

    if (hasMatch) {
      html += '<div class="sum-card"><div class="sum-card-label">Тур 1 · Совпадения</div>' +
        '<div class="sum-card-value ' + (matchPrize > 0 ? 'gold' : 'muted') + '">' + bestMatch + ' / 5</div>' +
        '<div class="sum-card-desc">' + (matchPrize > 0 ? '+' + fmt(matchPrize) + ' ◆'
          : (bestMatch > 0 ? 'Совпадений мало для приза' : 'Совпадений нет')) + '</div></div>';
    }
    if (hasCombo) {
      let val, cls, desc;
      if (!anyColorWon) { val = 'не активна'; cls = 'muted'; desc = 'Цвет первой карты не совпал<br>' + comboLines.join('<br>'); }
      else if (comboPrize === 0) { val = 'без приза'; cls = 'muted'; desc = 'Цвет угадан, комбинация без приза<br>' + comboLines.join('<br>'); }
      else { val = '+' + fmt(comboPrize) + ' ◆'; cls = 'gold'; desc = 'Цвет угадан<br>' + comboLines.join('<br>'); }
      html += '<div class="sum-card"><div class="sum-card-label">Тур 2 · Комбинация</div>' +
        '<div class="sum-card-value ' + cls + '">' + val + '</div><div class="sum-card-desc">' + desc + '</div></div>';
    }
    if (total > 0) {
      html += '<div class="sum-card total"><div class="sum-card-label">Итог</div>' +
        '<div class="sum-card-value">+' + fmt(total) + ' ◆</div><div class="sum-card-desc">' +
        [matchPrize > 0 ? 'Тур 1: ' + fmt(matchPrize) + ' ◆' : null,
         comboPrize > 0 ? 'Тур 2: ' + fmt(comboPrize) + ' ◆' : null].filter(Boolean).join(' · ') +
        '</div></div>';
      setTimeout(launchConfetti, A.confettiMs);
    } else {
      html += '<div class="sum-card total no-win"><div class="sum-card-label">Итог</div>' +
        '<div class="sum-card-value">В этот раз без приза</div>' +
        '<div class="sum-card-desc">Удача — на следующий тираж</div></div>';
    }
    sg.innerHTML = html;
    sg.classList.add('show');
    $('replayRow').classList.add('show');
  }

  function launchConfetti() {
    const c = $('confetti');
    if (!c) return;
    const colors = ['#E5388A', '#FF5BA6', '#7F77DD', '#FFC83D', '#FFFFFF'];
    for (let i = 0; i < PK.confettiCount; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      const size = 6 + Math.random() * 10;
      p.style.cssText = 'left:' + (Math.random() * 100) + '%;width:' + size + 'px;height:' + size +
        'px;background:' + colors[Math.floor(Math.random() * colors.length)] + ';border-radius:' +
        (Math.random() > 0.5 ? '50%' : '2px') + ';animation-duration:' + (1.5 + Math.random() * 2) +
        's;animation-delay:' + (Math.random() * 0.6) + 's;transform:rotate(' + (Math.random() * 360) + 'deg);';
      c.appendChild(p);
      setTimeout(() => p.remove(), PK.confettiLifeMs);
    }
  }

  function resetGame() {
    ui.active = null;
    ui.phase = 'build';
    ui.marketSeen = {};
    ui.mainTickets = []; ui.extraTickets = [];
    clearMain();
    ui.color = null;
    $('pkColorRed').classList.remove('selected');
    $('pkColorBlack').classList.remove('selected');
    ui.blindExtra = []; dealBlindBase(); renderBlind();
    setStep(1);
    updatePrice();
  }

  /* Автоповтор: NLDraw переотправляет билет в следующий тираж. Как только
     появился повторный билет — возвращаемся в ожидание (с задержкой, чтобы
     игрок успел увидеть итог). */
  function resumeForRepeat() {
    if (ui.phase !== 'result') return;
    const up = D.state.tickets.find(t => t.targetDraw === D.state.drawNo);
    if (!up) return;
    setTimeout(() => {
      if (ui.phase !== 'result') return;
      ui.active = up;
      ui.phase = 'waiting';
      revealYourCards(up);
      setStep(2);
    }, 2500);
  }

  function renderAutoLeft() {
    const tks = D.state.tickets;
    $('pkAutoLeft').textContent = tks.length && tks[0].repeatLeft ? 'осталось тиражей: ' + tks[0].repeatLeft : '';
  }

  function renderHistory() {
    const h = D.history.slice(0, 30);
    const colorHost = $('pkFirstColorStat');
    const barsHost = $('pkRankBars');
    if (!h.length) {
      colorHost.innerHTML = '<span style="color:var(--faint);font-size:13px">Пока пусто — дождитесь первого розыгрыша.</span>';
      barsHost.innerHTML = '';
      return;
    }

    /* Цвет первой карты — что решает второй тур */
    let red = 0, black = 0;
    h.forEach(o => { if (isRed(o.cards[0])) red++; else black++; });
    const tot = red + black;
    const pct = n => tot ? Math.round(n / tot * 100) : 0;
    const row = (cls, label, n) =>
      '<div class="pk-color-row"><span class="pk-color-lbl ' + cls + '">' + label + '</span>' +
      '<div class="pk-color-track"><div class="pk-color-fill ' + cls + '" style="width:' + pct(n) + '%"></div></div>' +
      '<span class="pk-color-val">' + n + ' · ' + pct(n) + '%</span></div>';
    colorHost.innerHTML = row('red', '♥ ♦ Красная', red) + row('black', '♠ ♣ Чёрная', black) +
      '<div class="pk-color-note">По последним ' + tot + ' тиражам</div>';

    /* Частота выпадения номиналов среди всех выпавших карт */
    const cnt = {};
    PK.ranks.forEach(r => { cnt[r] = 0; });
    h.forEach(o => o.cards.forEach(c => { cnt[c.rank]++; }));
    const mx = Math.max(1, ...PK.ranks.map(r => cnt[r]));
    barsHost.innerHTML = PK.ranks.map(r =>
      '<div class="bar"><div class="fill" style="height:' + (2 + cnt[r] / mx * 78) + 'px"></div>' +
      '<div class="bn">' + r + '</div></div>').join('');
  }

  /* ============================================================
     ПОДКЛЮЧЕНИЕ К ОБЩЕМУ ТИРАЖУ
     ============================================================ */
  D.init({
    gameId: 'poker',
    prefillHistory: 20,

    /* Исход детерминирован номером тиража: rng приходит из nl-draw
       (засев номером тиража), поэтому 5 карт одинаковы у всех игроков. */
    generate: function (rng) {
      const cards = shuffleRng(DECK, rng).slice(0, PK.drawCards);
      return { cards: cards, firstColor: suitColor(cards[0]) };
    },

    outcomeLabel: o => 'first_' + o.firstColor,

    resolve: function (ticket, outcome) {
      let matchPrize = 0, comboPrize = 0;
      const perBet = [];
      ticket.bets.forEach(b => {
        if (b.market === 'match') {
          const m = countMatches(b.cards, outcome.cards);
          const p = matchPayout(b.cards.length, m);
          matchPrize += p;
          perBet.push({ market: 'match', hand: b.cards.length, matches: m, payout: p });
        } else {
          const won = suitColor(outcome.cards[0]) === b.color;
          const p = won ? comboPayout(b.cards) : 0;
          comboPrize += p;
          perBet.push({ market: 'combo', combo: b.combo, color: b.color, colorWon: won, payout: p });
        }
      });
      return { payout: matchPrize + comboPrize, detail: { matchPrize: matchPrize, comboPrize: comboPrize, perBet: perBet } };
    },

    onTick: function (s) {
      $('pkDrawNo').textContent = fmt(s.drawNo);
      $('pkTimer').textContent = s.label;
      $('pkMetaDraw').textContent = fmt(s.drawNo);
      $('pkMetaTimer').textContent = s.label;
      const w = $('pkTimerWrap');
      w.classList.toggle('soon', s.tleft <= 10 && s.open && !s.busy);
      w.classList.toggle('closed', !s.open && !s.busy);
      if (ui.phase === 'waiting') {
        $('pkWaitTimer').textContent = s.label;
        if (ui.active) $('pkWaitDraw').textContent = fmt(ui.active.targetDraw);
      }
    },

    onTickets: function () { renderAutoLeft(); resumeForRepeat(); },

    onDrawStart: function (outcome, finish) {
      const playing = D.state.tickets.filter(t => t.targetDraw === D.state.drawNo);
      const mine = ui.active && ui.active.targetDraw === D.state.drawNo && playing.indexOf(ui.active) >= 0;
      if (ui.phase === 'waiting' && mine) {
        ui.phase = 'revealing';
        $('pkS3Draw').textContent = fmt(D.state.drawNo);
        prepareDrawScreen(ui.active);
        setStep(3);
        runReveal(outcome, ui.active, finish);
      } else {
        finish();   // тираж не наш — считаем молча
      }
    },

    onResult: function (r) {
      renderHistory();
      if (ui.phase !== 'revealing') return;   // молчаливый тираж — итог не показываем
      renderSummary(r);
      ui.phase = 'result';
      ui.lastResult = { win: r.totalPay > 0 };
    },
  });

  /* ============================================================
     СТАРТ
     ============================================================ */
  buildGrid();
  dealBlindBase();
  renderBlind();

  $('pkMainRandom').onclick = randomMain;
  $('pkMainClear').onclick = clearMain;
  $('pkMainAdd').onclick = addMainTicket;
  $('pkBlindReset').onclick = resetBlind;
  $('pkColorRed').onclick = () => toggleColor('red');
  $('pkColorBlack').onclick = () => toggleColor('black');
  $('pkExtraAdd').onclick = addExtraTicket;
  $('pkPay').onclick = buyTicket;
  $('pkReplay').onclick = resetGame;
  $('pkAuto').onchange = function () { D.setAutorepeat(this.checked); };

  S.onBalance(updatePrice);
  refreshGrid();
  updatePrice();
  renderHistory();
})();
