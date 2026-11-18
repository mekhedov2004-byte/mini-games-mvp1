/* Общая шкала частот для архивов Плинко и Покера 52. */
window.NLArchive = (function () {
  const plural = new Intl.PluralRules('ru');
  const drawForms = { one: 'тираж', few: 'тиража', many: 'тиражей', other: 'тиража' };
  const drawCount = count => count + ' ' + drawForms[plural.select(count)];

  function renderColumns(host, labels, counts, category) {
    const peak = Math.max(1, ...counts);
    const step = Math.ceil(peak / 4);
    const steps = Math.ceil(peak / step);
    const scaleMax = steps * step;
    const level = count => ' style="--level:' + count / scaleMax * 100 + '%"';
    const ticks = Array.from({ length: steps + 1 }, (_, i) => {
      const count = i * step;
      return '<span' + level(count) + '>' + count + '</span>';
    }).join('');

    host.innerHTML = '<div class="archive-plot" style="--columns:' + labels.length + '">' +
      '<div class="archive-plot-scale" aria-hidden="true">' + ticks + '</div>' +
      '<dl class="archive-plot-values">' + labels.map((label, i) =>
        '<div class="archive-plot-column"' + level(counts[i]) + '>' +
        '<dt><span class="archive-plot-unit">' + category + ' </span>' + label + '</dt>' +
        '<dd><span class="archive-plot-fill" aria-hidden="true"></span>' +
        '<span class="archive-plot-count">' + counts[i] + '</span></dd></div>'
      ).join('') + '</dl></div>';
  }

  return { drawCount, renderColumns };
})();
