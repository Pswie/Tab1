import { amministratore } from '../services/auth';

/** Arrange the existing register after access; the original inputs and totals
 * retain their references, listeners and accounting rules. */
export function initAdminEntryUI(): void {
  const form = document.getElementById('daily-log-form');
  const pane = document.getElementById('tab-incassi');
  if (!amministratore() || !form || !pane || form.dataset.adminEntry === 'ready') return;
  form.dataset.adminEntry = 'ready';

  const field = (id: string) => document.getElementById(id)?.closest<HTMLElement>('.field-item');
  const cash = field('input-contanti');
  const services = ['input-mooney', 'input-lis', 'input-printer'].map(field);
  const actual = field('input-effettivo');
  const reserve = field('input-b');
  const sisal = form.querySelector<HTMLElement>('.sisal-box-container');
  const lotto = form.querySelector<HTMLElement>('.lotto-box-container');
  const invoices = form.querySelector<HTMLElement>('.fatture-box-container');
  const statistics = form.querySelector<HTMLElement>('.stat-box-container');
  const totals = form.querySelector<HTMLElement>('.totali-turni-block');
  const grand = form.querySelector<HTMLElement>('.totale-grand-block');
  const print = document.getElementById('btn-print-document');
  const save = document.getElementById('auto-save-badge');
  if (!cash || services.some(item => !item) || !actual || !reserve || !sisal || !lotto || !invoices || !statistics || !totals || !grand || !print) return;

  const fields = document.createElement('div');
  fields.className = 'admin-entry-fields';
  const income = document.createElement('section');
  income.className = 'admin-entry-section admin-entry-income';
  income.setAttribute('aria-labelledby', 'admin-entry-income-title');
  income.innerHTML = '<h2 id="admin-entry-income-title">Incassi e servizi</h2><div class="admin-entry-income-grid"></div>';
  income.querySelector('.admin-entry-income-grid')!.append(cash, ...services as HTMLElement[]);

  const movements = document.createElement('section');
  movements.className = 'admin-entry-section admin-entry-movements';
  movements.setAttribute('aria-label', 'Movimenti Sisal e Lotto');
  movements.append(sisal, lotto);
  invoices.classList.add('admin-entry-section', 'admin-entry-invoices');
  statistics.classList.add('admin-entry-section', 'admin-entry-statistics');
  fields.append(income, movements, invoices, statistics);

  const aside = document.createElement('aside');
  aside.className = 'admin-entry-summary';
  aside.setAttribute('aria-label', 'Riepilogo della chiusura');
  const footer = document.createElement('div');
  footer.className = 'admin-entry-summary-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'admin-entry-review-toggle';
  toggle.setAttribute('aria-controls', 'admin-entry-review');
  toggle.innerHTML = '<span>Controllo cassa</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const oldPrintParent = print.parentElement;
  print.setAttribute('aria-label', 'Stampa la chiusura');
  print.querySelector('span')!.textContent = 'Stampa chiusura';
  footer.append(toggle, print);

  const review = document.createElement('div');
  review.className = 'admin-entry-review';
  review.id = 'admin-entry-review';
  const heading = document.createElement('h2');
  heading.className = 'admin-entry-reconcile-title';
  heading.textContent = 'Controllo cassa';
  const controls = document.createElement('div');
  controls.className = 'admin-entry-reconcile-fields';
  controls.append(actual, reserve);
  review.append(heading, controls, totals);
  aside.append(grand);
  if (save) aside.append(save);
  aside.append(footer, review);
  form.append(fields, aside);
  oldPrintParent?.remove();
  form.querySelector('.admin-services-grid')?.remove();

  form.querySelectorAll<HTMLElement>('.field-item').forEach((item, index) => {
    const text = item.querySelector<HTMLElement>('.field-label');
    const input = item.querySelector<HTMLInputElement>('input');
    if (!text || !input) return;
    if (!text.id) text.id = `admin-entry-label-${index}`;
    input.setAttribute('aria-labelledby', text.id);
    input.name = input.id;
    input.autocomplete = 'off';
    if (!text.closest('label')) {
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.className = 'admin-entry-input-label';
      text.before(label);
      label.append(text);
    }
  });
  const title = pane.querySelector('.section-title > span');
  if (title) title.textContent = 'Registro della giornata';
  const invoiceStatus = document.getElementById('fatture-avviso');
  invoiceStatus?.setAttribute('role', 'status');

  const desktop = window.matchMedia('(min-width: 1200px)');
  const setReview = (open: boolean) => {
    review.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    aside.classList.toggle('is-expanded', open);
  };
  setReview(desktop.matches);
  desktop.addEventListener('change', event => setReview(event.matches));
  toggle.addEventListener('click', () => setReview(review.hidden));

  const shiftSelector = pane.querySelector('.shift-selector');
  const syncShift = () => {
    const morning = shiftSelector?.querySelector('[data-shift="mattina"]')?.getAttribute('aria-selected') === 'true';
    const label = grand.querySelector('.totale-grand-title');
    if (label) label.textContent = morning ? 'Totale mattina' : 'Totale giornata';
  };
  if (shiftSelector) new MutationObserver(syncShift).observe(shiftSelector, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  syncShift();
}
