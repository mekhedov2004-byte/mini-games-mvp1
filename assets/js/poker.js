/* Интерфейс Покера 52. Тиражи и начисления ведутся общими модулями. */
(function () {
  const CFG = window.NL_CONFIG;
  const PK = CFG.poker;
  const T = window.NLTrack;
  const S = window.NLShell;
  const D = window.NLDraw;
  const Archive = window.NLArchive;
  const R = window.NLRules.poker;
  const { DECK, isRed, sameCard, shuffle, combosForHand, priceForHand,
    evaluateHand, bestFive, comboPayout, ticketComboPayout } = R;
  const { fmt, colorName } = S;
  const $ = id => document.getElementById(id);
  const ui = { main: new Set(), blind: [], color: null, buying: false, marketSeen: new Set(),
    screen: null, lastResult: null, revealed: new Set(), combinations: new Map() };

  S.init({
    gameId: 'poker',
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

  $('pkHeroSuper').textContent = fmt(PK.matchPrizes[5]) + ' ◆';

  const suitNames = { '♠': 'пики', '♣': 'трефы', '♥': 'червы', '♦': 'бубны' };
  const cardName = c => c.rank + ', ' + suitNames[c.suit];
  const money = amount => fmt(amount) + ' ◆';
  const formatPercent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });

  function miniCard(card, highlighted = false, first = false) {
    return '<span class="mini-card' + (isRed(card) ? ' red' : '') + (highlighted ? ' matched' : '') +
      (first ? ' first-card' : '') + '" role="img" aria-label="' + (first ? 'Первая карта: ' : '') +
      cardName(card) + '"><b>' + card.rank + '</b><span>' + card.suit + '</span></span>';
  }

  function handHTML(cards, draw = []) {
    return cards.map(c => miniCard(c, draw.some(d => sameCard(c, d)))).join('');
  }

  function sampleHand(sample) {
    return sample.split(' ').map(text => ({ rank: text.slice(0, -1), suit: text.slice(-1) }));
  }

  function combinationCards(cards, name) {
    if (['Роял Флеш', 'Стрит Флеш', 'Фулл Хаус', 'Флеш', 'Стрит'].includes(name)) return cards;
    if (name === 'Старшая карта') {
      const high = Math.max(...cards.map(c => PK.rankVal[c.rank]));
      return cards.filter(c => PK.rankVal[c.rank] === high);
    }
    return cards.filter(c => cards.some(other => other.rank === c.rank && other.suit !== c.suit));
  }

  function buildPrizeTables() {
    const matches = Object.keys(PK.matchPrizes).map(Number).filter(Boolean)
      .sort((a, b) => PK.matchPrizes[b] - PK.matchPrizes[a]);
    $('pkMatchPrizes').innerHTML = matches.map(n =>
      '<tr><td>' + n + ' из 5</td><td class="r">' + money(PK.matchPrizes[n]) + '</td></tr>').join('');

    const examples = [
      ['Роял Флеш', '10♥ J♥ Q♥ K♥ A♥'],
      ['Стрит Флеш', '4♣ 5♣ 6♣ 7♣ 8♣'],
      ['Каре', '9♠ 9♣ 9♥ 9♦ K♦'],
      ['Фулл Хаус', 'Q♠ Q♣ Q♥ 6♦ 6♣'],
      ['Флеш', '2♦ 5♦ 8♦ J♦ K♦'],
      ['Стрит', '5♣ 6♦ 7♣ 8♠ 9♥'],
      ['Сет', '7♥ 7♣ 7♦ 4♠ A♦'],
      ['Две пары', '8♣ 8♥ J♠ J♦ A♠'],
      ['Пара шестёрок и старше', '6♣ 6♥ 3♠ 9♣ K♦'],
      ['Пара пятёрок и младше', '5♠ 5♦ 3♣ 8♥ K♣'],
      ['Старшая карта', '3♣ 6♦ 8♠ J♥ A♠'],
    ].map(([name, sample]) => {
      const cards = sampleHand(sample);
      const category = evaluateHand(cards);
      return { name, cards, category, payout: comboPayout(cards) };
    }).sort((a, b) => b.payout - a.payout);
    $('pkComboPrizes').innerHTML = examples.map(({ name, cards, category, payout }) =>
      '<tr><th scope="row">' + name + '</th><td><div class="mini-row prize-example">' +
        handHTML(cards, combinationCards(cards, category)) + '</div></td><td class="r">' + money(payout) + '</td></tr>'
    ).join('');
    $('pkMatchExample').innerHTML = handHTML(sampleHand('4♣ 7♥ 9♦ Q♠ A♣'), sampleHand('7♥ A♣'));
    const pair = sampleHand('6♣ 6♥ 3♠ 9♣ K♦');
    $('pkComboExample').innerHTML = handHTML(pair, combinationCards(pair, evaluateHand(pair)));
  }

  function markMarket(market) {
    if (ui.marketSeen.has(market)) return;
    ui.marketSeen.add(market);
    T.send('gc_market_select', { market });
  }

  function refreshPrice() {
    const mainSize = ui.main.size;
    const candidates = [
      [$('pkMainAdd'), $('mainAddInfo'), mainSize, mainSize >= 5, 'Выберите 5–10 карт'],
      [$('pkExtraAdd'), $('extraAddInfo'), ui.blind.length, !!ui.color, 'Выберите цвет первой карты'],
    ];
    candidates.forEach(([button, info, size, ready, hint]) => {
      const price = priceForHand(size);
      const enough = price <= S.getBalance();
      button.disabled = ui.buying || !ready || !enough;
      button.textContent = ready ? 'Купить билет · ' + money(price) : 'Купить билет';
      info.textContent = ready ? (enough ? 'Комбинаций в билете: ' + combosForHand(size) : 'Недостаточно кристаллов') : hint;
    });
  }

  function drawMainSelection() {
    $('mainCount').textContent = 'Выбрано ' + ui.main.size + ' из ' + PK.maxHand;
    $('pkMainClear').disabled = !ui.main.size;
    $('cardsGrid').querySelectorAll('button').forEach(button => {
      const active = ui.main.has(Number(button.dataset.card));
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !active && ui.main.size >= PK.maxHand;
    });
    refreshPrice();
  }

  function buildGrid() {
    const grid = $('cardsGrid');
    PK.suits.forEach(suit => {
      const row = document.createElement('div');
      row.className = 'grid-row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', suitNames[suit]);
      const symbol = document.createElement('span');
      symbol.className = 'suit-label' + (PK.redSuits.includes(suit) ? ' red' : '');
      symbol.innerHTML = '<span>' + suit + '</span><span class="suit-name">' + suitNames[suit] + '</span>';
      symbol.setAttribute('aria-hidden', 'true');
      row.appendChild(symbol);

      PK.ranks.forEach(rank => {
        const idx = DECK.findIndex(c => c.rank === rank && c.suit === suit);
        const card = DECK[idx];
        const button = document.createElement('button');
        button.className = 'grid-card' + (isRed(card) ? ' red' : '');
        button.dataset.card = idx;
        button.setAttribute('aria-label', cardName(card));
        button.innerHTML = '<b>' + rank + '</b><span>' + suit + '</span>';
        button.onclick = () => {
          if (ui.buying) return;
          if (ui.main.has(idx)) ui.main.delete(idx);
          else ui.main.add(idx);
          markMarket('match');
          T.send('gc_combination_select', { market: 'match', combination: 'card_' + card.rank + card.suit });
          drawMainSelection();
        };
        row.appendChild(button);
      });
      grid.appendChild(row);
    });
  }

  const newBlindHand = (count = 5) => shuffle(DECK).slice(0, count);
  function renderBlind(animate = false) {
    const host = $('blindRow');
    host.innerHTML = ui.blind.map((_, i) => i < 5
      ? '<span class="blind-card card-back-art" aria-label="Закрытая карта" role="img"></span>'
      : '<button class="blind-card card-back-art blind-extra" data-remove="' + i + '" aria-label="Убрать дополнительную карту"><span>−</span></button>'
    ).join('') + '<button class="add-blind" id="pkBlindAdd"' + (ui.blind.length >= PK.maxHand ? ' disabled' : '') +
      '><b>+</b> Карта</button>';
    $('blindCount').textContent = 'Карт в билете: ' + ui.blind.length;
    $('pkBlindAdd').onclick = () => {
      if (ui.buying) return;
      ui.blind.push(shuffle(DECK.filter(c => !ui.blind.includes(c)))[0]);
      renderBlind();
    };
    host.querySelectorAll('[data-remove]').forEach(button => {
      button.onclick = () => {
        if (ui.buying) return;
        ui.blind.splice(+button.dataset.remove, 1);
        renderBlind();
      };
    });

    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      host.querySelectorAll('.blind-card').forEach((card, i) => {
        card.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }],
          { delay: i * 25, duration: 230 });
      });
    }
    refreshPrice();
  }

  function selectColor(color) {
    ui.color = color;
    $('pkColorRed').setAttribute('aria-pressed', String(color === 'red'));
    $('pkColorBlack').setAttribute('aria-pressed', String(color === 'black'));
    refreshPrice();
  }

  function resetBlind() {
    ui.blind = newBlindHand();
    selectColor(null);
    renderBlind();
  }

  function drawTickets(tickets) {
    $('ticketsCount').textContent = fmt(tickets.length);
    $('pkTickets').innerHTML = tickets.length ? tickets.slice().reverse().map(t => {
      const b = t.bets[0];
      const main = b.market === 'match';
      const opened = main || ui.revealed.has(t.id);
      const pick = main ? 'Карт в билете: ' + b.cards.length : 'Ваш цвет — ' + colorName(b.color);
      const cards = opened ? '<div class="mini-row ticket-cards">' + handHTML(b.cards) + '</div>' : '';
      const action = main ? '' : '<button class="btn ' + (opened ? 'btn-ghost' : 'btn-primary') +
        ' btn-mini" data-open-hand="' + t.id + '">' + (opened ? 'Ваши карты' : 'Раскрыть карты') + '</button>';
      return '<article class="ticket-row ' + (main ? 'ticket-main' : 'ticket-extra') + '">' +
        '<div class="ticket-line"><strong>' + (main ? 'Основная игра' : 'Дополнительная игра') +
        '</strong><b>' + money(t.total) + '</b></div><p>Билет № ' + t.id + ' · тираж № ' +
        fmt(t.targetDraw) + '</p><p>' + pick + '</p>' + cards + action + '</article>';
    }).join('') : '<p class="empty-state">Здесь появятся купленные билеты</p>';
    updateWatch();
  }

  async function buy(market) {
    if (ui.buying || (market === 'match' ? ui.main.size < 5 : !ui.color)) return;
    ui.buying = true;
    const main = market === 'match';
    const cards = main ? [...ui.main].map(i => DECK[i]) : ui.blind.slice();
    const bet = { market, cards, price: priceForHand(cards.length), hand: cards.length };
    if (!main) Object.assign(bet, { color: ui.color, combo: evaluateHand(cards), possiblePayout: comboPayout(cards) });
    refreshPrice();
    let receipt = '';
    try {
      T.send('gc_bet_add', {
        market, combination: main ? 'match_' + cards.length : 'color_' + bet.color,
        multiplier: combosForHand(cards.length), stake_amount: bet.price, bets_in_slip: 1,
      }, { throttle: 0 });
      const ticket = await D.submitTicket([bet], { game: 'poker', goals: [main ? 'fn_poker_t1' : 'fn_poker_t2'] });
      if (!ticket) return;
      receipt = 'Билет № ' + ticket.id + ' куплен';

      if (ui.lastResult) {
        T.send('gc_bet_repeat', {
          same_combination: false, prev_result: ui.lastResult.totalPay > 0 ? 'win' : 'loss',
        }, { throttle: 0 });
      }
      if (main) { ui.main.clear(); drawMainSelection(); }
      else resetBlind();
    } catch (e) {
      receipt = 'Не удалось сохранить билет. Попробуйте ещё раз';
    } finally {
      ui.buying = false;
      refreshPrice();
      if (receipt) $(main ? 'mainAddInfo' : 'extraAddInfo').textContent = receipt;
    }
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function updateWatch(s = D.state) {
    const current = s.tickets.filter(t => t.targetDraw === s.drawNo);
    const left = D.drawTime(s.drawNo) - Date.now();
    $('pkWatch').hidden = left <= 0 || left > 15000 || !current.length || current.some(t => t.bets[0].market === 'combo');
    const previous = $('pkLastResult');
    previous.hidden = !ui.lastResult || !!s.tickets.length;
    if (ui.lastResult) previous.textContent = 'Результат тиража № ' + fmt(ui.lastResult.drawNo);
    $('pkWatchHint').hidden = !s.tickets.length && !ui.lastResult;
    $('pkWatchHint').textContent = 'Итоги прошедших тиражей доступны в архиве и истории баланса';
  }

  function setDrawPhase(title, label, sub) {
    $('pkDrawState').textContent = title;
    $('pkPhase').textContent = label;
    $('s3Sub').textContent = sub;
  }

  function updateCountdown(screen) {
    const left = Math.max(0, Math.ceil((D.drawTime(screen.drawNo) - Date.now()) / 1000));
    const countdown = left ? 'До начала ' + left + ' с. Карты тиража откроются по таймеру' : 'Готовим карты тиража…';
    if ($('s3Sub').textContent !== countdown) $('s3Sub').textContent = countdown;
  }

  function showCard(card) {
    const idx = '<span class="show-card-index"><b>' + card.rank + '</b><span>' + card.suit + '</span></span>';
    return '<span class="show-card" role="img" aria-label="Закрытая карта"><span class="show-card-turn" aria-hidden="true">' +
      '<span class="show-card-back card-back-art"></span><span class="show-card-front' + (isRed(card) ? ' red' : '') + '">' +
      idx + '<span class="show-card-suit">' + card.suit + '</span>' + idx + '</span></span></span>';
  }

  function flipCard(element, card, first = false) {
    element.classList.add('flipped');
    if (first) element.classList.add('is-first');
    element.setAttribute('aria-label', (first ? 'Первая карта: ' : '') + cardName(card));
  }

  function comboDetails(ticket) {
    let detail = ui.combinations.get(ticket.id);
    if (!detail) {
      const bet = ticket.bets[0];
      const best = bestFive(bet.cards);
      const possible = ticketComboPayout(bet);
      detail = { best, keys: possible ? combinationCards(best.cards, best.name) : [], possible };
      ui.combinations.set(ticket.id, detail);
    }
    return detail;
  }

  function goToHand(screen, index) {
    if (index < 0 || index >= screen.extra.length) return;
    const deck = $('pkHandDeck');
    const slide = deck.children[index];
    const direction = Math.sign(index - screen.index);
    screen.index = index;
    [...deck.children].forEach((item, i) => { item.hidden = i !== index; });
    $('pkHandPosition').textContent = (index + 1) + ' из ' + screen.extra.length;
    $('pkHandPrev').disabled = index === 0;
    $('pkHandNext').disabled = index === screen.extra.length - 1;
    if (direction && !reduceMotion.matches) {
      slide.animate([{ transform: 'translateX(' + direction * 12 + 'px)', opacity: .55 },
        { transform: 'translateX(0)', opacity: 1 }], { duration: 170, easing: 'ease-out' });
    }
    revealHand(screen, index);
  }

  function renderCarousel(screen, ticketId) {
    screen.extra = screen.tickets.filter(t => t.bets[0].market === 'combo');
    $('pkHandStage').hidden = !screen.extra.length;
    $('pkHandControls').hidden = screen.extra.length < 2;
    const deck = $('pkHandDeck');
    deck.tabIndex = screen.extra.length > 1 ? 0 : -1;
    deck.innerHTML = screen.extra.map(t => {
      const bet = t.bets[0];
      return '<article class="hand-slide" aria-label="Билет № ' + t.id + '">' +
        '<p class="hand-ticket-id">Билет № ' + t.id + '</p><div class="hand-fan">' +
        bet.cards.map(showCard).join('') + '</div><div class="hand-verdict" hidden></div></article>';
    }).join('');
    const selected = screen.extra.findIndex(t => t.id === ticketId);
    if (screen.extra.length) goToHand(screen, Math.max(0, selected));
  }

  async function revealHand(screen, index) {
    const ticket = screen.extra[index];
    const slide = $('pkHandDeck').children[index];
    if (!slide || slide.dataset.opening) return;
    slide.dataset.opening = 'true';
    const bet = ticket.bets[0];
    const { best, keys, possible } = comboDetails(ticket);
    const fan = slide.querySelector('.hand-fan');
    const animate = !reduceMotion.matches && !screen.result && !ui.revealed.has(ticket.id);
    for (const [i, card] of bet.cards.entries()) {
      if (animate) await wait(i ? PK.anim.fanStepMs : PK.anim.fanBaseMs);
      if (ui.screen !== screen || !slide.isConnected) return;
      flipCard(fan.children[i], card);
    }
    if (animate) await wait(PK.anim.resultMs / 2);
    if (ui.screen !== screen || !slide.isConnected) return;
    bet.cards.forEach((card, i) => {
      if (keys.some(key => sameCard(key, card))) fan.children[i].classList.add('is-key');
    });
    ui.revealed.add(ticket.id);
    const verdict = slide.querySelector('.hand-verdict');
    const condition = possible
      ? 'Если первая карта тиража будет ' + (bet.color === 'red' ? 'красной' : 'чёрной') + ', вы получите выигрыш'
      : 'В билете нет выигрышных комбинаций';
    verdict.innerHTML = '<div><span>Лучшая комбинация</span><strong>' + best.name +
      '</strong></div><div><span>Возможный выигрыш</span><strong>' + money(possible) +
      '</strong></div><p>Ваш прогноз — ' + colorName(bet.color) + '. ' + condition + '</p>';
    verdict.hidden = false;
  }

  function showDraw(drawNo, tickets, focusTicketId, result = null) {
    const screen = { drawNo, tickets, phase: 'waiting', result, index: 0, extra: [] };
    ui.screen = screen;
    $('page1').hidden = true;
    $('page3').hidden = false;
    $('page3').classList.remove('draw-complete');
    $('pkS3Draw').textContent = fmt(drawNo);
    $('pkDrawStage').hidden = false;
    $('drawRow').innerHTML = '<span class="draw-placeholder card-back-art" aria-hidden="true"></span>'.repeat(PK.drawCards);
    $('firstCardBanner').hidden = true;
    $('summaryGrid').hidden = true;
    $('replayRow').hidden = true;
    renderCarousel(screen, focusTicketId);
    if (result) {
      renderDrawCards(result);
      finishDraw(screen, result);
    } else {
      setDrawPhase('Ожидаем розыгрыш', 'Ожидание', '');
      updateCountdown(screen);
      renderHands(tickets);
    }
    $('pkBack').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function ticketResult(t, outcome) {
    const bet = t.bets[0];
    const result = t.detail.perBet[0];
    if (bet.market === 'match') {
      const reason = result.matches === 0
        ? 'Ни одна из ваших карт не совпала с картами тиража'
        : 'Совпало карт — ' + result.matches + ' из 5' +
          (bet.cards.length > 5 ? '. Сумма рассчитана по всем выигрышным пятёркам билета' : '');
      return '<p class="draw-reason">' + reason + '</p>';
    }

    const { best, possible } = comboDetails(t);
    const reason = !result.colorWon ? 'Цвет не совпал'
      : possible ? 'Цвет угадан, выплата за выигрышные комбинации начислена'
        : 'Цвет угадан, но в билете нет выигрышных комбинаций';
    return '<p class="draw-reason">' + reason + '</p><dl class="ticket-details">' +
      '<dt>Ваш прогноз</dt><dd>' + colorName(bet.color) + '</dd>' +
      '<dt>Цвет первой карты</dt><dd>' + colorName(outcome.firstColor) + '</dd>' +
      '<dt>Лучшая комбинация</dt><dd>' + best.name + '</dd>' +
      '<dt>Возможный выигрыш</dt><dd>' + money(possible) + '</dd></dl>';
  }

  function renderHands(tickets, outcome) {
    $('handColumns').innerHTML = [
      ['match', 'Основная игра', 'ticket-main'], ['combo', 'Дополнительная игра', 'ticket-extra'],
    ].map(([market, name, cls]) => {
      if (!outcome && market === 'combo') return '';
      const group = tickets.filter(t => t.bets[0].market === market);
      if (!group.length) return '';
      const rows = group.map(t => {
        const bet = t.bets[0];
        const result = outcome ? t.detail.perBet[0] : null;
        const keys = market === 'combo' ? comboDetails(t).keys : (outcome?.cards || []);
        const status = result
          ? '<strong class="ticket-status ' + (result.payout ? 'is-win">+' + money(result.payout) : 'is-loss">Без выигрыша') + '</strong>' : '';
        const info = result ? ticketResult(t, outcome)
          : '<p class="match-count">Совпало карт: <b>—</b></p>';
        return '<article class="draw-ticket" data-draw-ticket="' + t.id + '"><div class="ticket-line"><b>Билет № ' + t.id + '</b>' +
          status + '</div><div class="mini-row">' + handHTML(bet.cards, keys) + '</div>' + info + '</article>';
      }).join('');
      return '<section class="draw-hand ' + cls + '"><h3>' + name + '</h3>' + rows + '</section>';
    }).join('');
  }

  function markMatches(mainTickets, opened, card, drawElement) {
    let drawMatch = false;
    mainTickets.forEach(ticket => {
      const row = $('handColumns').querySelector('[data-draw-ticket="' + ticket.id + '"]');
      const faces = row.querySelectorAll('.mini-card');
      let matches = 0;
      ticket.bets[0].cards.forEach((c, i) => {
        if (opened.some(d => sameCard(c, d))) matches++;
        if (!sameCard(c, card)) return;
        drawMatch = true;
        faces[i].classList.add('matched', 'match-pop');
        faces[i].setAttribute('aria-label', cardName(c) + ', совпала');
      });
      row.querySelector('.match-count b').textContent = matches;
    });
    if (drawMatch) {
      drawElement.classList.add('is-match');
      const label = drawElement.getAttribute('aria-label');
      drawElement.setAttribute('aria-label', label + ', совпала');
    }
  }

  function showColor(color) {
    const banner = $('firstCardBanner');
    banner.textContent = 'Цвет первой карты — ' + colorName(color) + '. С ним сверяются все дополнительные билеты';
    banner.hidden = false;
  }

  function renderDrawCards(result) {
    const { outcome, playing } = result;
    const extra = playing.some(t => t.bets[0].market === 'combo');
    const main = playing.filter(t => t.bets[0].market === 'match');
    const row = $('drawRow');
    row.innerHTML = outcome.cards.map(showCard).join('');
    outcome.cards.forEach((card, i) => {
      const element = row.children[i];
      flipCard(element, card, extra && i === 0);
      if (main.some(t => t.bets[0].cards.some(c => sameCard(c, card)))) element.classList.add('is-match');
    });
    if (extra) showColor(outcome.firstColor);
  }

  function finishDraw(screen, result) {
    screen.phase = 'done';
    screen.result = result;
    $('page3').classList.add('draw-complete');
    setDrawPhase('Итоги розыгрыша', 'Завершён', '');
    renderHands(result.playing, result.outcome);
    const wins = result.playing.filter(t => t.payout > 0).length;
    const summary = $('summaryGrid');
    summary.classList.toggle('is-win', !!result.totalPay);
    summary.innerHTML = '<div><strong>' + (result.totalPay ? 'Вы выиграли' : 'В этом тираже без выигрыша') +
      '</strong><p>Выиграли ' + wins + ' из ' + result.playing.length + ' билетов</p></div>' +
      (result.totalPay ? '<b class="draw-payout">+' + money(result.totalPay) + '</b>' : '');
    summary.hidden = false;
    $('replayRow').hidden = false;
    if (!reduceMotion.matches) {
      summary.animate([{ opacity: .3, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, easing: 'ease-out' });
    }
  }

  async function runDraw(screen, result, replay = false) {
    if ((replay ? screen.phase !== 'done' : screen.phase !== 'waiting') || Date.now() < D.drawTime(screen.drawNo)) return;
    screen.phase = 'running';
    $('page3').classList.remove('draw-complete');
    $('summaryGrid').hidden = true;
    $('replayRow').hidden = true;
    $('firstCardBanner').hidden = true;
    const { outcome, playing } = result;
    const started = performance.now();
    const extra = playing.some(t => t.bets[0].market === 'combo');
    const main = playing.filter(t => t.bets[0].market === 'match');
    renderHands(playing);
    $('drawRow').innerHTML = outcome.cards.map(showCard).join('');
    setDrawPhase(replay ? 'Повтор розыгрыша' : 'Идёт розыгрыш', replay ? 'Повтор' : 'Розыгрыш', 'Карты открываются по очереди');
    if ($('view-game').classList.contains('active')) {
      $('pkDrawStage').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    }

    const opened = [];
    for (const [i, card] of outcome.cards.entries()) {
      if (!reduceMotion.matches) await wait(i ? PK.anim.betweenCardsMs : PK.anim.firstCardMs);
      if (ui.screen !== screen) return;
      const element = $('drawRow').children[i];
      flipCard(element, card, extra && i === 0);
      if (!reduceMotion.matches) await wait(i ? PK.anim.matchMs : PK.anim.matchFirstMs);
      if (ui.screen !== screen) return;
      opened.push(card);
      markMatches(main, opened, card, element);
      if (extra && i === 0) showColor(outcome.firstColor);
    }
    if (!reduceMotion.matches) await wait(PK.anim.resultMs);
    if (ui.screen !== screen) return;
    if (!replay) T.send('gc_animation_complete', {
      duration_sec: +((performance.now() - started) / 1000).toFixed(1),
    }, { throttle: 0 });
    finishDraw(screen, result);
    if ($('view-game').classList.contains('active')) {
      $('summaryGrid').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    }
  }

  function renderArchiveCharts(history) {
    $('pkArchiveVisuals').hidden = !history.length;
    $('pkArchiveEmpty').hidden = !!history.length;
    if (!history.length) return;

    let red = 0, totalCards = 0;
    const counts = new Map(PK.ranks.map(rank => [rank, 0]));
    for (const draw of history) {
      if (draw.firstColor === 'red') red++;
      for (const card of draw.cards) counts.set(card.rank, counts.get(card.rank) + 1);
      totalCards += draw.cards.length;
    }
    $('pkArchiveSample').textContent = 'В выборке ' + Archive.drawCount(history.length);
    $('pkArchiveCards').textContent = fmt(totalCards) + ' карт';
    for (const [id, count] of [['pkArchiveRed', red], ['pkArchiveBlack', history.length - red]]) {
      const row = $(id);
      const share = count / history.length;
      row.style.setProperty('--share', share * 100 + '%');
      row.querySelector('.archive-color-value').textContent = count + ' из ' + history.length + ' · ' + formatPercent.format(share);
    }
    Archive.renderColumns($('pkArchivePlot'), PK.ranks, PK.ranks.map(rank => counts.get(rank)), 'Номинал');
  }

  function renderHistory() {
    const history = D.history;
    renderArchiveCharts(history);
    const mine = S.getTickets('poker');
    $('pkHistory').innerHTML = history.slice(0, 10).map(o => {
      const playing = mine.filter(t => t.targetDraw === o.drawNo && t.resolved);
      const won = playing.filter(t => t.payout > 0).length;
      const personal = playing.length ? 'Ваши билеты: ' + playing.length + ' · выиграли: ' + won : 'Ваших билетов в тираже нет';
      const action = playing.length
        ? '<button class="btn btn-ghost btn-mini" data-result-draw="' + o.drawNo + '">Ваш результат</button>' : '';
      return '<article class="card archive-row"><div><h3>Тираж № ' + fmt(o.drawNo) +
        '</h3><time>' + S.dateTime.format(D.drawTime(o.drawNo)) + '</time></div><div class="mini-row">' +
        o.cards.map((card, i) => miniCard(card, false, i === 0)).join('') + '</div><div class="archive-result"><b>Цвет первой карты — ' +
        colorName(o.firstColor) + '</b><span>' + personal + '</span>' + action + '</div></article>';
    }).join('');
  }

  function backToTickets() {
    ui.screen = null;
    $('page3').hidden = true;
    $('page1').hidden = false;
    drawTickets(D.state.tickets);
    $('panelMain').scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  $('pkBack').onclick = backToTickets;
  $('pkReplay').onclick = backToTickets;
  $('pkReplayDraw').onclick = () => { if (ui.screen?.result) runDraw(ui.screen, ui.screen.result, true); };
  $('pkHandPrev').onclick = () => { if (ui.screen) goToHand(ui.screen, ui.screen.index - 1); };
  $('pkHandNext').onclick = () => { if (ui.screen) goToHand(ui.screen, ui.screen.index + 1); };
  const deck = $('pkHandDeck');
  let swipe = null;
  deck.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !(ui.screen?.extra.length > 1)) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    deck.setPointerCapture(event.pointerId);
  });
  deck.addEventListener('pointerup', event => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (ui.screen && Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      goToHand(ui.screen, ui.screen.index + (dx < 0 ? 1 : -1));
    }
  });
  deck.addEventListener('pointercancel', () => { swipe = null; });
  deck.addEventListener('keydown', event => {
    if (!ui.screen || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    goToHand(ui.screen, ui.screen.index + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  $('pkTickets').onclick = event => {
    const button = event.target.closest('[data-open-hand]');
    if (!button) return;
    const tickets = S.getTickets('poker');
    const ticket = tickets.find(t => t.id === +button.dataset.openHand);
    if (!ticket) return;
    showDraw(ticket.targetDraw, tickets.filter(t => t.targetDraw === ticket.targetDraw), ticket.id);
  };
  $('pkWatch').onclick = () => {
    const { drawNo, tickets } = D.state;
    const left = D.drawTime(drawNo) - Date.now();
    const mine = tickets.filter(t => t.targetDraw === drawNo);
    if (mine.length && left > 0 && left <= 15000) showDraw(drawNo, mine);
  };

  function openResult(drawNo) {
    if (Date.now() < D.drawTime(drawNo)) return;
    const result = D.resultFor(drawNo);
    if (!result.playing.length) return;
    S.switchTo('game');
    showDraw(drawNo, result.playing, null, result);
  }

  $('pkLastResult').onclick = () => {
    if (ui.lastResult && !D.state.tickets.length) openResult(ui.lastResult.drawNo);
  };
  $('pkHistory').onclick = event => {
    const button = event.target.closest('[data-result-draw]');
    if (button) openResult(+button.dataset.resultDraw);
  };

  $('pkMainRandom').onclick = () => {
    if (ui.buying) return;
    ui.main = new Set(shuffle(DECK.map((_, i) => i)).slice(0, 5));
    markMarket('match');
    T.send('gc_random_ticket', { picks: 5, market: 'match' }, { throttle: 0 });
    drawMainSelection();
  };
  $('pkMainClear').onclick = () => {
    if (ui.buying) return;
    ui.main.clear();
    drawMainSelection();
  };
  $('pkBlindRandom').onclick = () => {
    if (ui.buying) return;
    ui.blind = newBlindHand(ui.blind.length);
    markMarket('combo');
    T.send('gc_random_ticket', { picks: ui.blind.length, market: 'combo' }, { throttle: 0 });
    renderBlind(true);
  };
  $('pkBlindReset').onclick = () => { if (!ui.buying) resetBlind(); };
  ['red', 'black'].forEach(color => {
    $(color === 'red' ? 'pkColorRed' : 'pkColorBlack').onclick = () => {
      if (ui.buying) return;
      selectColor(ui.color === color ? null : color);
      if (ui.color) {
        markMarket('combo');
        T.send('gc_combination_select', { market: 'combo', combination: 'color_' + ui.color });
      }
    };
  });
  $('pkMainAdd').onclick = () => buy('match');
  $('pkExtraAdd').onclick = () => buy('combo');

  buildGrid();
  buildPrizeTables();
  drawMainSelection();
  resetBlind();
  drawTickets([]);
  S.onBalance(refreshPrice);

  D.init({
    gameId: 'poker',
    historyLimit: 30,
    outcomeLabel: o => 'first_' + o.firstColor,
    onTick(s) {
      $('pkDrawNo').textContent = fmt(s.drawNo);
      $('pkTimer').textContent = s.label;
      $('pkTimerWrap').classList.toggle('soon', s.tleft <= 15);
      const screen = ui.screen;
      if (screen?.phase === 'waiting') {
        updateCountdown(screen);
        if (Date.now() >= D.drawTime(screen.drawNo)) {
          const result = D.resultFor(screen.drawNo);
          if (result.playing.length) runDraw(screen, result);
        }
      }
      updateWatch(s);
    },
    onTickets(tickets) {
      drawTickets(tickets);
      const screen = ui.screen;
      if (screen?.phase !== 'waiting' || Date.now() >= D.drawTime(screen.drawNo)) return;
      const mine = tickets.filter(t => t.targetDraw === screen.drawNo);
      if (mine.length === screen.tickets.length) return;
      const currentId = screen.extra[screen.index]?.id;
      screen.tickets = mine;
      renderCarousel(screen, currentId);
      renderHands(mine);
    },
    onResult(result) {
      renderHistory();
      if (!result.playing.length) return;
      ui.lastResult = D.latestResult();
      updateWatch();
    },
  }).then(() => {
    ui.lastResult = D.latestResult();
    renderHistory();
    updateWatch();
    S.onBalance(() => {
      ui.lastResult = D.latestResult();
      renderHistory();
      updateWatch();
    });
  });
})();
