/* ============================================================
   hub.js — главная страница выбора игры.

   Порядок карточек меняется между сессиями. Без ротации первая
   позиция выиграет за счёт позиции, а не за счёт механики —
   и главный вывод эксперимента окажется испорченным.
   ============================================================ */

(function () {
  const CFG = window.NL_CONFIG;
  const T = window.NLTrack;
  const S = window.NLShell;

  S.init({ gameId: 'hub' });
  window.NLDraw.init();

  /* Порядок фиксируется на сессию: внутри одного визита карточки
     не должны прыгать — иначе игрок решит, что страница сломана. */
  function sessionOrder(games) {
    let saved = null;
    try { saved = sessionStorage.getItem('nl_hub_order'); } catch (e) {}
    if (saved) {
      const ids = saved.split(',');
      const byId = {};
      games.forEach(g => byId[g.id] = g);
      const restored = ids.map(id => byId[id]).filter(Boolean);
      if (restored.length === games.length) return restored;
    }
    const list = games.slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    try { sessionStorage.setItem('nl_hub_order', list.map(g => g.id).join(',')); } catch (e) {}
    return list;
  }

  const order = sessionOrder(CFG.games);
  T.setContext({ hub_order: order.map(g => g.id).join(',') });

  const host = document.getElementById('hubGrid');
  order.forEach(function (g, idx) {
    const card = document.createElement('a');
    card.className = 'card game-card';
    card.href = g.href;
    card.innerHTML =
      '<div class="art art-' + g.id + '" aria-hidden="true">' +
        '<img src="assets/img/' + g.id + '.jpg" alt="" decoding="async"></div>' +
      '<h2>' + g.title + '</h2>' +
      '<p>' + g.description + '</p>' +
      '<span class="game-link">Играть <span aria-hidden="true">→</span></span>';

    card.addEventListener('click', function () {
      let first = false;
      try {
        first = !sessionStorage.getItem('nl_first_pick');
        if (first) sessionStorage.setItem('nl_first_pick', g.id);
      } catch (e) {}
      // Первый выбор игры — самый чистый сигнал привлекательности механики:
      // он сделан до всякого опыта, только по названию и превью.
      T.send('gc_game_card_click', {
        picked_game: g.id, position: idx + 1, is_first_choice: first,
      }, { throttle: 0 });
    });

    host.appendChild(card);
  });

  S.onBalance(function (v) {
    const el = document.getElementById('hubBalance');
    if (el) el.textContent = S.fmt(v);
  });

  T.send('gc_landing_view', {
    entry_type: document.referrer ? 'internal' : 'first',
  }, { throttle: 0 });

  T.send('gc_balance_granted', {
    amount: CFG.balance.start, grant_reason: 'first_visit',
  }, { throttle: 0 });

  // Опрос — внешняя форма; клик размечен атрибутом data-track в index.html.
  document.getElementById('hubFeedback').href = CFG.links.survey;
})();
