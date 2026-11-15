import { TITLE_WORDS } from '../../../lib/titleDashRules';
import { count, dayLabel } from '../../../lib/creatorDashboardRules';
import { BarChart, DoneMark, MoneyCard, NeedLine, NumberTiles, ActionError } from './TitleBits';

// A title's Overview tab (the canvas's "Dashboard · a film"): what needs
// the creator, the four numbers, the last 30 days as bars (views or watch
// minutes), what it has earned, and beside them the checklist (each undone
// item's button runs its fix) and the history. Two columns from 1024px.

function dayOf(date) {
  return dayLabel(`${String(date).slice(0, 10)}T12:00:00Z`) || String(date);
}

function chartLabel(chart) {
  const what = chart.mode === 'watch' ? 'Minutes watched a day' : 'Views a day';
  const range = chart.from && chart.to ? ` from ${chart.from} to ${chart.to}` : '';
  const peakBar = chart.list.find((b) => b.value === chart.max);
  const peak = peakBar && chart.max > 0 ? ` The most was ${count(chart.max)} ${chart.unit} on ${dayOf(peakBar.date)}.` : '';
  return `${what}${range}.${peak}`;
}

export default function TitleOverview({ dash, detailState, moneyState, onRetryDetail, onRetryMoney, chartMode, setChartMode, run, busy, error, extract }) {
  const loading = [];
  if (detailState === 'loading') loading.push('views', 'avg', 'watched');
  if (moneyState === 'loading') loading.push('earned');
  const chart = dash.chart;

  const left = (
    <div className="td-col">
      {dash.need ? (
        <section className="td-need td-o0" aria-label="Needs you">
          <NeedLine text={dash.need} tone="need" />
        </section>
      ) : null}
      {dash.waiting ? <NeedLine text={dash.waiting} tone="wait" className="td-o0" /> : null}
      <NumberTiles tiles={dash.tiles} loading={loading} className="td-o1" />
      {dash.trackingOff && !dash.tiles.some((t) => t.note === TITLE_WORDS.noTracking) && <p className="dash-fine td-o1">{TITLE_WORDS.noTracking}</p>}
      {detailState !== 'refused' && !(dash.trackingOff && chart.empty) && (
        <section className="dash-card td-card td-o3" aria-labelledby="td-chart-h">
          <div className="td-card-head">
            <h2 id="td-chart-h" className="td-h2">{chart.title}</h2>
            <div className="td-toggle" role="group" aria-label="What the bars show">
              <button type="button" className={`td-toggle-btn${chartMode === 'views' ? ' on' : ''}`} aria-pressed={chartMode === 'views'} onClick={() => setChartMode('views')}>{TITLE_WORDS.chartViews}</button>
              <button type="button" className={`td-toggle-btn${chartMode === 'watch' ? ' on' : ''}`} aria-pressed={chartMode === 'watch'} onClick={() => setChartMode('watch')}>{TITLE_WORDS.chartWatch}</button>
            </div>
          </div>
          {!chart.available ? (
            detailState === 'loading' ? <p className="dash-empty">{TITLE_WORDS.loading}</p> : (
              <div className="td-failed" role="alert">
                <p className="dash-empty">{TITLE_WORDS.failed}</p>
                <button type="button" className="td-btn" onClick={onRetryDetail}>Try again</button>
              </div>
            )
          ) : chart.empty ? (
            <p className="dash-empty">{TITLE_WORDS.chartEmpty}</p>
          ) : (
            <BarChart
              chart={chart}
              label={chartLabel(chart)}
              hint="Point at a day, or use the arrow keys, to read it."
              readOf={(i, bar) => `${dayOf(bar.date)} · ${count(bar.value)} ${chart.mode === 'watch' ? 'min watched' : bar.value === 1 ? 'view' : 'views'}`}
            />
          )}
        </section>
      )}
      <MoneyCard card={dash.money} heading={TITLE_WORDS.money} state={moneyState} onRetry={onRetryMoney} id="td-money-h" className="td-o4" />
    </div>
  );

  const right = (
    <div className="td-col">
      <section className="dash-card td-card td-o2" aria-labelledby="td-check-h">
        <h2 id="td-check-h" className="td-h2">{TITLE_WORDS.checklist}</h2>
        <ul className="td-checks">
          {dash.checklist.map((c) => (
            <li key={c.key} className={`td-check${c.done ? ' done' : ''}`}>
              <DoneMark done={c.done} />
              <span className="td-check-text">
                <span className="td-check-label">{c.label}</span>
                {c.note ? <span className="td-dim"> · {c.note}</span> : null}
                <span className="visually-hidden">{c.done ? ' (done)' : ' (not done)'}</span>
              </span>
              {c.action && (
                <button type="button" className="td-btn gold" disabled={busy === c.action.key} onClick={() => run(c.action.key, 'checklist')}>
                  {busy === c.action.key ? 'Saving…' : c.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
        {extract && <p className="td-sub" role="status">Extracting the audio…{extract.pct != null ? ` ${Math.round(extract.pct)}%` : ''}</p>}
        <ActionError error={error} where="checklist" />
      </section>
      {dash.history.length > 0 && (
        <section className="dash-card td-card td-o5" aria-labelledby="td-history-h">
          <h2 id="td-history-h" className="td-h2">{TITLE_WORDS.history}</h2>
          <ol className="td-history">
            {dash.history.map((h, i) => (
              <li key={`${h.when}-${i}`} className="td-history-row">
                <span className="td-when">{h.when}</span>
                <span className="td-what">{h.what}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );

  return <div className="td-cols">{left}{right}</div>;
}
