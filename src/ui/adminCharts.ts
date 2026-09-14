import type { MeseIncasso } from '../services/statistiche';
import { numero, vuoto } from './grafici';

interface ChartState {
  selectedMonth: string;
  months: readonly MeseIncasso[];
  root: HTMLElement;
  axis: HTMLElement;
  scroll: HTMLElement;
  canvas: HTMLElement;
  grid: HTMLElement;
  columns: HTMLElement;
  readout: HTMLElement;
  buttons: Map<string, HTMLButtonElement>;
}

const chartStates = new WeakMap<HTMLElement, ChartState>();
const chartCurrency = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true
});

/** Four evenly spaced references, including zero even when totals are negative. */
function chartDomain(months: readonly MeseIncasso[]): { min: number; max: number; step: number } {
  let low = 0;
  let high = 0;
  for (const month of months) {
    if (!Number.isFinite(month.totale)) continue;
    low = Math.min(low, month.totale);
    high = Math.max(high, month.totale);
  }

  const niceStep = (value: number): number => {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const multiple = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      .find(candidate => candidate * magnitude >= value) ?? 10;
    return Math.max(multiple * magnitude, 0.01);
  };

  if (low === 0) {
    const step = niceStep(high / 3);
    return { min: 0, max: step * 3, step };
  }
  if (high === 0) {
    const step = niceStep(-low / 3);
    return { min: -step * 3, max: 0, step };
  }

  // Allocate one or two intervals below zero; use the tighter valid domain.
  const candidates = [1, 2].map(negativeIntervals => {
    const step = niceStep(Math.max(-low / negativeIntervals, high / (3 - negativeIntervals)));
    return { min: -step * negativeIntervals, max: step * (3 - negativeIntervals), step };
  });
  return candidates[0].step <= candidates[1].step ? candidates[0] : candidates[1];
}

function daysLabel(month: MeseIncasso): string {
  return `${numero(month.giornate)} ${month.giornate === 1 ? 'giornata registrata' : 'giornate registrate'}`;
}

function amountLabel(month: MeseIncasso): string {
  return Number.isFinite(month.totale) ? chartCurrency.format(month.totale) : 'Importo non disponibile';
}

function updateSelection(state: ChartState): void {
  for (const [month, button] of state.buttons) {
    const selected = month === state.selectedMonth;
    button.tabIndex = selected ? 0 : -1;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
  }

  const selected = state.months.find(month => month.mese === state.selectedMonth);
  if (!selected) return;
  const values = [
    ['adm-chart-readout-period', selected.etichetta],
    ['adm-chart-readout-value', amountLabel(selected)],
    ['adm-chart-readout-days', daysLabel(selected)],
    ['adm-chart-readout-partial', selected.inCorso ? 'Mese in corso, dato parziale' : 'Mese concluso']
  ];
  for (const [className, value] of values) {
    const element = state.readout.querySelector<HTMLElement>(`.${className}`)!;
    if (element.textContent !== value) element.textContent = value;
  }
  state.readout.classList.toggle('is-partial', selected.inCorso);
}

/** Scroll only this chart, without moving the page or transferring focus. */
function revealSelection(state: ChartState): void {
  const button = state.buttons.get(state.selectedMonth);
  if (!button || state.scroll.clientWidth === 0) return;
  const bounds = button.getBoundingClientRect();
  const viewport = state.scroll.getBoundingClientRect();
  if (bounds.left < viewport.left) state.scroll.scrollLeft -= viewport.left - bounds.left;
  else if (bounds.right > viewport.right) state.scroll.scrollLeft += bounds.right - viewport.right;
}

function createChart(container: HTMLElement, selectedMonth: string): ChartState {
  const root = document.createElement('div');
  root.className = 'adm-chart';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Incassi mensili in euro. Seleziona un mese con le frecce sinistra e destra.');
  root.innerHTML = `
    <div class="adm-chart-plot">
      <div class="adm-chart-axis" aria-hidden="true"></div>
      <div class="adm-chart-scroll" tabindex="-1">
        <div class="adm-chart-canvas">
          <div class="adm-chart-grid" aria-hidden="true"></div>
          <div class="adm-chart-columns"></div>
        </div>
      </div>
    </div>
    <div class="adm-chart-readout" role="status" aria-live="polite" aria-atomic="true">
      <span class="adm-chart-readout-period"></span>
      <strong class="adm-chart-readout-value"></strong>
      <span class="adm-chart-readout-days"></span>
      <span class="adm-chart-readout-partial"></span>
    </div>
    <p class="adm-chart-hint">Seleziona un mese per vedere il dettaglio. Da tastiera, usa le frecce.</p>
  `;
  container.replaceChildren(root);
  const state: ChartState = {
    selectedMonth,
    months: [],
    root,
    axis: root.querySelector('.adm-chart-axis')!,
    scroll: root.querySelector('.adm-chart-scroll')!,
    canvas: root.querySelector('.adm-chart-canvas')!,
    grid: root.querySelector('.adm-chart-grid')!,
    columns: root.querySelector('.adm-chart-columns')!,
    readout: root.querySelector('.adm-chart-readout')!,
    buttons: new Map()
  };
  chartStates.set(container, state);

  const selectFromEvent = (event: Event): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.adm-chart-column') : null;
    if (!button || !state.columns.contains(button) || !button.dataset.month) return;
    state.selectedMonth = button.dataset.month;
    updateSelection(state);
  };
  state.columns.addEventListener('click', selectFromEvent);
  state.columns.addEventListener('focusin', selectFromEvent);
  state.columns.addEventListener('keydown', event => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.adm-chart-column') : null;
    if (!button) return;
    const index = state.months.findIndex(month => month.mese === button.dataset.month);
    const last = state.months.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(0, index - 1); break;
      case 'ArrowRight': next = Math.min(last, index + 1); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    event.preventDefault();
    state.selectedMonth = state.months[next].mese;
    updateSelection(state);
    state.buttons.get(state.selectedMonth)?.focus({ preventScroll: true });
    revealSelection(state);
  });
  return state;
}

/** Admin-only monthly chart. Existing month buttons survive refreshes to retain focus. */
export function renderAdminMonthlyChart(container: HTMLElement, months: readonly MeseIncasso[]): void {
  let state = chartStates.get(container);
  if (months.length === 0) {
    container.innerHTML = vuoto('Nessun incasso registrato nel periodo selezionato.');
    if (state) state.months = [];
    return;
  }

  const previousSelection = state?.selectedMonth ?? '';
  const latest = months.reduce((newest, month) => month.mese > newest.mese ? month : newest);
  const selectedMonth = months.some(month => month.mese === previousSelection) ? previousSelection : latest.mese;
  const newChart = !state || state.root.parentElement !== container;
  if (newChart) state = createChart(container, selectedMonth);
  if (!state) return;
  state.months = months;
  state.selectedMonth = selectedMonth;

  const domain = chartDomain(months);
  const span = domain.max - domain.min;
  const position = (value: number): number => (value - domain.min) / span * 100;
  const axisNumber = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
  const compactAxisNumber = new Intl.NumberFormat('it-IT', {
    notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1
  });
  state.axis.replaceChildren();
  state.grid.replaceChildren();
  for (let interval = 0; interval <= 3; interval++) {
    const value = domain.min + domain.step * interval;
    const bottom = `${interval / 3 * 100}%`;
    const tick = document.createElement('span');
    tick.className = 'adm-chart-tick';
    tick.style.bottom = bottom;
    tick.textContent = Math.abs(value) >= 1_000_000
      ? compactAxisNumber.format(value).replace(/\s/g, '')
      : axisNumber.format(value);
    state.axis.append(tick);
    const gridline = document.createElement('span');
    gridline.className = `adm-chart-gridline${Math.abs(value) < domain.step / 1000 ? ' adm-chart-zero' : ''}`;
    gridline.style.bottom = bottom;
    state.grid.append(gridline);
  }

  const monthKeys = new Set(months.map(month => month.mese));
  for (const [key, button] of state.buttons) {
    if (monthKeys.has(key)) continue;
    button.remove();
    state.buttons.delete(key);
  }
  months.forEach((month, index) => {
    let button = state.buttons.get(month.mese);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'adm-chart-column';
      button.dataset.month = month.mese;
      button.innerHTML = '<span class="adm-chart-track" aria-hidden="true"><span class="adm-chart-bar"></span></span><span class="adm-chart-label" aria-hidden="true"></span>';
      state.buttons.set(month.mese, button);
    }
    button.setAttribute('aria-label', `${month.etichetta}: ${amountLabel(month)}, ${daysLabel(month)}${month.inCorso ? ', mese in corso, dato parziale' : ''}`);
    button.classList.toggle('is-partial', month.inCorso);
    button.classList.toggle('is-negative', month.totale < 0);
    button.classList.toggle('is-unavailable', !Number.isFinite(month.totale));
    const label = button.querySelector<HTMLElement>('.adm-chart-label')!;
    const labelParts = month.etichettaBreve.trim().split(/\s+/);
    const yearLabel = document.createElement('span');
    yearLabel.className = 'adm-chart-label-year';
    yearLabel.textContent = labelParts.length > 1 ? labelParts.pop()! : '';
    const monthLabel = document.createElement('span');
    monthLabel.className = 'adm-chart-label-month';
    monthLabel.textContent = labelParts.join(' ');
    label.replaceChildren(monthLabel, yearLabel);
    const bar = button.querySelector<HTMLElement>('.adm-chart-bar')!;
    const value = Number.isFinite(month.totale) ? month.totale : 0;
    bar.style.bottom = `${position(Math.min(0, value))}%`;
    bar.style.height = `${Math.abs(value) / span * 100}%`;
    // Avoid detaching existing nodes during ordinary data refreshes.
    if (state!.columns.children[index] !== button) {
      state!.columns.insertBefore(button, state!.columns.children[index] ?? null);
    }
  });
  state.canvas.style.minWidth = `${months.length * 44}px`;
  updateSelection(state);
  if (newChart || selectedMonth !== previousSelection) revealSelection(state);
}
