/* ============================================================
   nl-track.js — слой аналитики. Единственная точка отправки событий.
   Игры не шлют данные сами: они говорят «случилось вот это»,
   а этот файл решает, куда и как это отправить.

   Не должен знать ни о Плинко, ни о Покере: никаких условий
   вида «если это Плинко». Иначе разметка игр разъедется, а вместе
   с ней и сравнение механик — то, ради чего весь эксперимент.
   ============================================================ */

window.NLTrack = (function () {
  const CFG = (window.NL_CONFIG || {}).track || {};
  const API = (window.NL_CONFIG || {}).api || {};

  const journal = [];      // весь журнал сессии
  const queue = [];        // очередь на отправку
  const lastSent = {};     // время последней отправки каждого события
  let ctx = {};            // сквозной контекст
  let panel = null;

  const debugOn = () =>
    CFG.toPanel || /[?&]debug=1/.test(location.search);

  /* ---------- сквозной контекст ---------- */
  function setContext(obj) { Object.assign(ctx, obj || {}); metrikaContext(); }
  function getContext() { return Object.assign({}, ctx); }

  /* ---------- Яндекс.Метрика ----------
     Единственный сток данных: своего бэка нет. Счётчик инициализируется
     кодом в <head> каждой страницы — так просмотр засчитывается, даже если
     игрок закрыл вкладку до загрузки скриптов игры. Трекер только шлёт в
     него события целями (reachGoal). Если код в <head> забыли, трекер
     подгрузит счётчик сам — страховка, а не основной путь. */
  function metrikaOn() { return !!(CFG.toMetrika && CFG.metrikaId); }

  function loadMetrika() {
    if (!metrikaOn() || window.ym) return;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + CFG.metrikaId, 'ym');
    window.ym(CFG.metrikaId, 'init', {
      ssr: true, webvisor: !!CFG.webvisor, clickmap: true, ecommerce: 'dataLayer',
      referrer: document.referrer, url: location.href, accurateTrackBounce: true, trackLinks: true,
    });
    metrikaContext();
  }

  /* Сквозные параметры уходят в Метрику как параметры визита + UserID,
     чтобы события можно было резать по игроку, устройству и A/B-варианту. */
  function metrikaContext() {
    if (!metrikaOn() || !window.ym) return;
    try {
      if (ctx.uid) window.ym(CFG.metrikaId, 'userParams', { UserID: String(ctx.uid) });
      window.ym(CFG.metrikaId, 'params', Object.assign({}, ctx));
    } catch (e) {}
  }

  /* ---------- отправка ---------- */
  function send(event, params, opts) {
    params = params || {};
    opts = opts || {};

    // Ограничитель частоты. У Метрики одно событие принимается не чаще
    // раза в секунду — гасим здесь, а не в 29 местах бизнес-логики.
    const gap = opts.throttle !== undefined ? opts.throttle : CFG.defaultThrottleMs;
    if (gap) {
      const now = Date.now();
      if (now - (lastSent[event] || 0) < gap) return;
      lastSent[event] = now;
    }

    const payload = Object.assign({ event: event, client_ts: Date.now() }, ctx, params);
    journal.push(payload);

    if (CFG.toConsole) console.log('[track]', event, params);
    if (debugOn()) paint(event, params);
    if (CFG.toApi && API.baseUrl) { queue.push(payload); if (queue.length >= (API.eventsMaxBatch || 50)) flush(); }
    if (metrikaOn() && window.ym) {
      // К каждой цели прикладываем сквозной контекст — для сегментации в Метрике.
      try { window.ym(CFG.metrikaId, 'reachGoal', event, Object.assign({}, ctx, params)); } catch (e) {}
    }
  }

  function flush(useBeacon) {
    if (!queue.length || !API.baseUrl) return;
    const batch = queue.splice(0, queue.length);
    const body = JSON.stringify({ uid: ctx.uid, session_id: ctx.session_id, events: batch });
    const url = API.baseUrl + '/api/events';
    try {
      // sendBeacon браузер доводит до конца, даже когда вкладка закрывается.
      // Обычный запрос в этот момент оборвётся — а это самые ценные события,
      // те, после которых человек ушёл.
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
          .catch(function () { /* автономный режим — молча */ });
      }
    } catch (e) { /* автономный режим — молча */ }
  }

  /* ---------- панель отладки ---------- */
  function paint(event, params) {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'nl-debug';
      panel.innerHTML = '<div class="hd"><span>СОБЫТИЯ АНАЛИТИКИ</span>' +
        '<button class="btn btn-ghost btn-mini" id="nlDbgClose">скрыть</button></div>' +
        '<div id="nlDbgList"></div>';
      document.body.appendChild(panel);
      panel.querySelector('#nlDbgClose').onclick = function () { panel.remove(); panel = null; };
    }
    const list = panel.querySelector('#nlDbgList');
    const t = new Date().toTimeString().slice(0, 8);
    const shown = {};
    Object.keys(params).forEach(function (k) { shown[k] = params[k]; });
    const row = document.createElement('div');
    row.className = 'ev';
    row.innerHTML = '<span class="p">' + t + '</span>  <span class="n">' + event + '</span>  ' +
      '<span class="p">' + (Object.keys(shown).length ? JSON.stringify(shown) : '') + '</span>';
    list.appendChild(row);
    panel.scrollTop = panel.scrollHeight;
  }

  /* ---------- жизненный цикл ---------- */
  loadMetrika();   // страховка: срабатывает, только если счётчика в <head> нет
  setInterval(function () { flush(false); }, API.eventsFlushMs || 5000);
  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });

  /* ---------- разметка кликов атрибутами ----------
     data-track="имя_события" data-track-params='{"ключ":"значение"}'
     Атрибуты — часть содержимого страницы, а не кода. Они переживают
     переписывание вёрстки, а обработчик, вписанный в кнопку, — нет. */
  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest('[data-track]');
    if (!el) return;
    let p = {};
    try { p = JSON.parse(el.getAttribute('data-track-params') || '{}'); } catch (err) {}
    send(el.getAttribute('data-track'), p);
  });

  return {
    send: send,
    setContext: setContext,
    getContext: getContext,
    flush: flush,
    dump: function () { return journal.slice(); },
  };
})();
