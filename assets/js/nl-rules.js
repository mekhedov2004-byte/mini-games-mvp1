/* Правила обеих игр используются и на страницах игр, и при расчёте билетов в кошельке. */
window.NLRules = (function () {
  const CFG = window.NL_CONFIG;
  const PK = CFG.poker;
  const RED = new Set(PK.redSuits);
  const DECK = [];
  PK.ranks.forEach(r => PK.suits.forEach(s => DECK.push({ rank: r, suit: s })));
  const PAIR_NAMES = [
    'Пара двоек', 'Пара троек', 'Пара четвёрок', 'Пара пятёрок', 'Пара шестёрок',
    'Пара семёрок', 'Пара восьмёрок', 'Пара девяток', 'Пара десяток', 'Пара валетов',
    'Пара дам', 'Пара королей', 'Пара тузов',
  ];
  const pairRanks = new Map(PAIR_NAMES.map((name, i) => [name, i + 2]));
  const comboOrder = PK.comboOrder.flatMap(name => name === 'Пара' ? PAIR_NAMES.slice().reverse() : name);
  // Старые билеты хранили карты и цвет без суммы возможного выигрыша.
  const legacyCombo = {
    minPairRank: 11,
    pairPrize: 750,
    comboPrizes: {
      'Роял Флеш': 3000000, 'Стрит Флеш': 200000, 'Каре': 30000, 'Фулл Хаус': 4000,
      'Флеш': 3000, 'Стрит': 2000, 'Сет': 1000, 'Две пары': 1200, 'Старшая карта': 0,
    },
  };

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

  /* Оценка ровно 5 карт → название комбинации. */
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
      return PAIR_NAMES[pr - 2];
    }
    return 'Старшая карта';
  }

  /* Карты лучшей комбинации для визуального примера в билете. */
  function bestFive(cards) {
    let best;
    let bestRank = Infinity;
    allFiveSubsets(cards).forEach(sub => {
      const name = evalFive(sub);
      const rank = comboOrder.indexOf(name);
      if (rank < bestRank) {
        best = { name, cards: sub };
        bestRank = rank;
      }
    });
    return best;
  }

  const evaluateHand = cards => bestFive(cards).name;

  /* Тур 2: каждая 5-карточная комбинация руки оплачивается отдельно */
  function comboPayout(cards, terms = PK) {
    let total = 0;
    allFiveSubsets(cards).forEach(sub => {
      const name = evalFive(sub);
      total += terms.comboPrizes[name] ?? (pairRanks.get(name) >= terms.minPairRank ? terms.pairPrize : 0);
    });
    return total;
  }

  const ticketComboPayout = bet => bet.possiblePayout ?? comboPayout(bet.cards, legacyCombo);

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

  function pokerOutcome(rng) {
    const cards = shuffleRng(DECK, rng).slice(0, PK.drawCards);
    return { cards, firstColor: suitColor(cards[0]) };
  }

  function pokerResult(ticket, outcome) {
    const perBet = ticket.bets.map(b => {
      if (b.market === 'match') {
        const matches = countMatches(b.cards, outcome.cards);
        return { market: 'match', matches, payout: matchPayout(b.cards.length, matches) };
      }
      const colorWon = outcome.firstColor === b.color;
      return { market: 'combo', colorWon, payout: colorWon ? ticketComboPayout(b) : 0 };
    });
    return { payout: perBet.reduce((sum, b) => sum + b.payout, 0), detail: { perBet } };
  }

  function plinkoOutcome(rng) {
    const P = CFG.plinko;
    let remaining = 1 + Math.floor(rng() * P.outcomeMax);
    const slot = P.BUCKET.findIndex(size => (remaining -= size) <= 0);
    return { slot };
  }

  function plinkoResult(ticket, outcome) {
    const perBet = ticket.bets.map(b => ({
      payout: b.slot === outcome.slot ? b.price * b.mult : 0,
    }));
    return { payout: perBet.reduce((sum, b) => sum + b.payout, 0), detail: { perBet, slot: outcome.slot } };
  }

  return {
    poker: { generate: pokerOutcome, resolve: pokerResult, DECK, isRed, sameCard, shuffle,
             combosForHand, priceForHand, evaluateHand, bestFive, comboPayout, ticketComboPayout },
    plinko: { generate: plinkoOutcome, resolve: plinkoResult },
  };
})();
