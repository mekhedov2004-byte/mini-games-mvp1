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

  const shell = S.init({ gameId: 'hub' });

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

  /* Превью игр рисуются кодом, чтобы не тащить картинки */
  const ART = {
    plinko:
      '<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">' +
        (function () {
          let s = '';
          for (let r = 0; r < 5; r++)
            for (let i = 0; i <= r; i++)
              s += '<circle cx="' + (100 + (i - r / 2) * 22) + '" cy="' + (22 + r * 17) + '" r="3" fill="rgba(206,203,246,.55)"/>';
          for (let i = 0; i < 7; i++)
            s += '<rect x="' + (32 + i * 20) + '" y="106" width="16" height="10" rx="3" fill="' +
                 (i === 3 ? 'rgba(127,119,221,.35)' : i === 0 || i === 6 ? 'rgba(255,200,61,.35)' : 'rgba(255,91,166,.25)') + '"/>';
          return s;
        })() +
        '<circle cx="100" cy="12" r="7" fill="#E5388A"/><circle cx="97.5" cy="9.5" r="2.4" fill="#FFD2E6"/>' +
      '</svg>',
    poker:
      '<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">' +
        [-2, -1, 0, 1, 2].map(function (k) {
          const x = 100 + k * 30, rot = k * 8;
          return '<g transform="translate(' + x + ' 62) rotate(' + rot + ')">' +
            '<rect x="-19" y="-28" width="38" height="56" rx="5" fill="#F7F5FF" stroke="rgba(0,0,0,.15)"/>' +
            '<text x="0" y="6" text-anchor="middle" font-size="20" font-family="Arial" fill="' +
            (k % 2 ? '#C8302A' : '#171432') + '">' + ['♠', '♥', '♣', '♦', '♠'][k + 2] + '</text></g>';
        }).join('') +
      '</svg>',
  };

  const host = document.getElementById('hubGrid');
  order.forEach(function (g, idx) {
    const card = document.createElement('a');
    card.className = 'card game-card';
    card.href = g.href;
    card.innerHTML =
      '<div class="art">' + (ART[g.id] || '') +
        (g.badge ? '<span class="badge">' + g.badge + '</span>' : '') + '</div>' +
      '<h2>' + g.title + '</h2>' +
      '<div class="tagline">' + g.tagline + '</div>' +
      '<p>' + g.description + '</p>' +
      '<span class="btn btn-primary btn-wide" style="text-align:center">Играть</span>';

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
