import '../admin.css';
import '../admin-entry.css';
import '../admin-dashboard.css';
import { amministratore, nomeUtente } from '../services/auth';
import { caricaDashboard } from './dashboardUI';
import { caricaDashboardH24 } from './h24DashboardUI';
import { initAdminEntryUI } from './adminEntryUI';

const pages: Record<string, { title: string; description: string; group: string }> = {
  'tab-dashboard': { title: 'Panoramica', description: 'Incassi, andamento e controlli del negozio.', group: 'Tabaccheria' },
  'tab-incassi': { title: 'Incassi giornalieri', description: 'Chiusure, movimenti e controllo della cassa.', group: 'Tabaccheria' },
  'tab-turni': { title: 'Turni di lavoro', description: 'La settimana della tua squadra, giorno per giorno.', group: 'Organizzazione' },
  'tab-pulizie': { title: 'Pulizie', description: 'Attività, scadenze e cura degli spazi.', group: 'Organizzazione' },
  'tab-ordini': { title: 'Ordini settimanali', description: 'Le forniture da ordinare e i prossimi appuntamenti.', group: 'Organizzazione' },
  'tab-inventario': { title: 'Inventario', description: 'Giacenze e scorte del punto vendita.', group: 'Tabaccheria' },
  'tab-soggiorno': { title: 'Tassa di soggiorno', description: 'Soggiorni registrati e imposta dovuta.', group: 'Registri' },
  'tab-todos': { title: 'Attività', description: 'Le cose da fare, condivise con la squadra.', group: 'Organizzazione' },
  'tab-rubrica': { title: 'Rubrica', description: 'I contatti utili, sempre a portata di mano.', group: 'Registri' },
  'tab-dati-tabaccheria': { title: 'Dati tabaccheria', description: 'Accessi condivisi e procedure del negozio.', group: 'Registri' },
  'tab-h24-dashboard': { title: 'Panoramica H24', description: 'Incassi e vendite dei tuoi distributori.', group: 'Distributori H24' },
  'tab-h24-prodotti': { title: 'Scorte H24', description: 'I prodotti mancanti e i pacchi da portare.', group: 'Distributori H24' },
  'tab-h24-incassi': { title: 'Incassi H24', description: 'Le dichiarazioni mensili dei distributori.', group: 'Distributori H24' },
  'tab-anticipi': { title: 'Anticipi', description: 'Compensi e anticipi della squadra in un unico registro.', group: 'Amministrazione' },
  'tab-ammanchi': { title: 'Ammanchi', description: 'Differenze di cassa e saldi da verificare.', group: 'Amministrazione' }
};

const paths = {
  search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.5 9M4.5 15a8 8 0 0 0 13.4 2.9"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m5-12-3 4 3 4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>'
};

function icon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

let navigate: (id: string) => void = () => {};
let currentPage = 'tab-dashboard';

/** Admin chrome is created only after the existing access check succeeds. */
export function initAdminUI(openPage: (id: string) => void): void {
  if (!amministratore() || document.body.classList.contains('admin-ui')) return;
  navigate = openPage;
  document.body.classList.add('admin-ui');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff');
  // Allow browser zoom in this version without changing the employee viewport.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  const mobileBrand = document.querySelector('.brand-title-group h1');
  const mobileSubtitle = document.querySelector('.brand-title-group p');
  if (mobileBrand) mobileBrand.textContent = 'iNES caffè';
  if (mobileSubtitle) mobileSubtitle.textContent = 'Amministrazione';

  const nav = document.querySelector<HTMLElement>('.app-nav-tabs');
  const container = document.querySelector<HTMLElement>('.nav-tabs-container');
  const main = document.querySelector<HTMLElement>('.main-wrapper');
  if (!nav || !container || !main) return;

  const skip = document.createElement('a');
  skip.className = 'admin-skip';
  skip.href = '#admin-page-title';
  skip.textContent = 'Vai al contenuto';
  document.body.prepend(skip);

  nav.setAttribute('aria-label', 'Navigazione principale');
  nav.id = 'admin-sidebar';
  const brand = document.createElement('div');
  brand.className = 'admin-sidebar-brand';
  brand.innerHTML = '<img src="/icon-192.png" alt="iNES caffè" width="40" height="40"><div><strong>iNES caffè</strong><span>Gestione del negozio</span></div>';
  nav.prepend(brand);

  // Move the existing buttons, retaining their listeners, permissions and badges.
  const groups = [
    { name: 'Il negozio', ids: ['tab-dashboard', 'tab-incassi', 'tab-inventario'] },
    { name: 'Organizzazione', ids: ['tab-turni', 'tab-todos', 'tab-pulizie', 'tab-ordini'] },
    { name: 'Distributori H24', ids: ['tab-h24-dashboard', 'tab-h24-prodotti', 'tab-h24-incassi'] },
    { name: 'Amministrazione', ids: ['tab-anticipi', 'tab-ammanchi', 'tab-soggiorno', 'tab-rubrica', 'tab-dati-tabaccheria'] }
  ];
  container.querySelectorAll('.nav-gruppo').forEach(el => el.remove());
  groups.forEach(group => {
    const label = document.createElement('p');
    label.className = 'admin-nav-label';
    label.textContent = group.name;
    container.append(label);
    group.ids.forEach(id => {
      const button = container.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
      if (!button) return;
      button.childNodes.forEach(node => { if (node.nodeType === Node.TEXT_NODE) node.textContent = ''; });
      const text = document.createElement('span');
      text.className = 'admin-nav-text';
      text.textContent = pages[id].title;
      button.querySelector('.tab-icon')?.after(text);
      button.setAttribute('aria-label', pages[id].title);
      container.append(button);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.hotdog-menu-item').forEach(button => {
    const page = pages[button.dataset.tab || ''];
    if (!page) return;
    button.querySelector('.hotdog-text > strong')?.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) node.textContent = page.title + ' ';
    });
  });
  const mobileMenuTitle = document.querySelector('.hotdog-menu-header > span');
  if (mobileMenuTitle) mobileMenuTitle.textContent = 'Tutte le sezioni';
  const drawer = document.getElementById('hotdog-menu-drawer');
  if (drawer) {
    const mobileButtons = new Map(Array.from(drawer.querySelectorAll<HTMLButtonElement>('.hotdog-menu-item')).map(button => [button.dataset.tab, button]));
    const fragment = document.createDocumentFragment();
    groups.forEach(group => {
      const label = document.createElement('p');
      label.className = 'hotdog-gruppo';
      label.textContent = group.name;
      const items = document.createElement('div');
      items.className = 'hotdog-menu-items';
      group.ids.forEach(id => { const button = mobileButtons.get(id); if (button) items.append(button); });
      fragment.append(label, items);
    });
    drawer.querySelectorAll('.hotdog-gruppo, .hotdog-menu-items').forEach(el => el.remove());
    drawer.append(fragment);
  }

  const userName = nomeUtente() || 'Amministratore';
  const profile = document.createElement('div');
  profile.className = 'admin-profile';
  profile.innerHTML = `<span class="admin-avatar"></span><div><strong></strong><span>Amministratore</span></div>${icon('shield')}`;
  profile.querySelector('.admin-avatar')!.textContent = userName.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  profile.querySelector('strong')!.textContent = userName;
  nav.append(profile);

  const header = document.querySelector('.header-container')!;
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'admin-breadcrumb';
  breadcrumb.innerHTML = '<span>Tabaccheria</span><span aria-hidden="true">/</span><strong>Panoramica</strong>';
  header.prepend(breadcrumb);

  const toolbar = document.createElement('div');
  toolbar.className = 'admin-toolbar';
  toolbar.innerHTML = `<time class="admin-today"></time><button type="button" class="admin-search-trigger" aria-label="Cerca una sezione" aria-haspopup="dialog">${icon('search')}<span>Cerca nel gestionale</span><kbd>Ctrl K</kbd></button><span class="admin-role">${icon('shield')}<span>Area admin</span></span>`;
  header.insertBefore(toolbar, header.querySelector('.header-actions'));
  initSidebar(nav, header);

  const heading = document.createElement('div');
  heading.className = 'admin-page-heading';
  heading.innerHTML = `<div class="admin-page-intro"><h1 id="admin-page-title" tabindex="-1">Panoramica</h1><p id="admin-page-description"></p></div><div class="admin-page-actions"><button type="button" class="admin-icon-button" id="admin-refresh" aria-label="Aggiorna dashboard" title="Aggiorna dashboard">${icon('refresh')}</button><button type="button" class="admin-primary-button" id="admin-register">${icon('plus')}<span>Registra incassi</span></button></div>`;
  main.prepend(heading);
  const today = toolbar.querySelector('time')!;
  today.textContent = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Rome' }).format(new Date());
  today.dateTime = new Date().toISOString();
  heading.querySelector('#admin-register')!.addEventListener('click', () => navigate(currentPage === 'tab-h24-dashboard' ? 'tab-h24-incassi' : 'tab-incassi'));
  heading.querySelector('#admin-refresh')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await (currentPage === 'tab-h24-dashboard' ? caricaDashboardH24() : caricaDashboard());
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });

  const mobileNav = document.createElement('nav');
  mobileNav.className = 'admin-mobile-nav';
  mobileNav.setAttribute('aria-label', 'Navigazione rapida');
  mobileNav.innerHTML = `<button type="button" data-admin-page="tab-dashboard">${icon('grid')}<span>Panoramica</span></button><button type="button" data-admin-page="tab-incassi">${icon('wallet')}<span>Incassi</span></button><button type="button" data-admin-page="tab-turni">${icon('calendar')}<span>Turni</span></button><button type="button" id="admin-more" aria-label="Apri tutte le sezioni">${icon('menu')}<span>Altro</span></button>`;
  mobileNav.querySelectorAll<HTMLButtonElement>('[data-admin-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.adminPage!)));
  mobileNav.querySelector('#admin-more')!.addEventListener('click', () => document.getElementById('btn-hamburger-menu')?.click());
  document.body.append(mobileNav);

  initSearch(toolbar.querySelector('button')!, container);
  initAdminEntryUI();
  initMobileDrawer();
  updateAdminPage(document.querySelector('.tab-pane.active')?.id || 'tab-dashboard');
}

function initSidebar(nav: HTMLElement, header: Element): void {
  const storageKey = 'tabaccheria_admin_menu_compatto';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'admin-collapse-nav';
  toggle.className = 'admin-icon-button admin-sidebar-toggle';
  toggle.innerHTML = icon('panel');
  toggle.setAttribute('aria-controls', nav.id);
  header.prepend(toggle);
  function setCollapsed(collapsed: boolean): void {
    document.body.classList.toggle('admin-nav-compact', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Espandi menu laterale' : 'Riduci menu laterale');
    toggle.title = collapsed ? 'Espandi menu laterale' : 'Riduci menu laterale';
    nav.querySelectorAll<HTMLButtonElement>('.nav-tab-item').forEach(button => {
      if (collapsed) button.title = pages[button.dataset.tab!].title;
      else button.removeAttribute('title');
    });
  }
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === 'true'; } catch { /* Layout works without storage. */ }
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    setCollapsed(collapsed);
    try { localStorage.setItem(storageKey, String(collapsed)); } catch { /* Keep the current session preference. */ }
  });
}

export function updateAdminPage(id: string): void {
  if (!document.body.classList.contains('admin-ui') || !pages[id]) return;
  currentPage = id;
  const page = pages[id];
  document.getElementById('admin-page-title')!.textContent = page.title;
  document.getElementById('admin-page-description')!.textContent = page.description;
  document.querySelector('.admin-breadcrumb span')!.textContent = page.group;
  document.querySelector('.admin-breadcrumb strong')!.textContent = page.title;
  document.title = `${page.title} · iNES caffè`;
  const dashboard = id === 'tab-dashboard' || id === 'tab-h24-dashboard';
  document.getElementById('admin-refresh')!.hidden = !dashboard;
  document.getElementById('admin-register')!.hidden = !dashboard;
  document.querySelector('.admin-page-actions')?.classList.toggle('is-empty', !dashboard);
  document.querySelectorAll<HTMLElement>('.nav-tab-item, .hotdog-menu-item, [data-admin-page]').forEach(button => {
    const active = (button.dataset.tab || button.dataset.adminPage) === id;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const more = document.getElementById('admin-more');
  if (!['tab-dashboard', 'tab-incassi', 'tab-turni'].includes(id)) more?.setAttribute('aria-current', 'page');
  else more?.removeAttribute('aria-current');
}

function initSearch(trigger: HTMLButtonElement, nav: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-search-dialog';
  dialog.setAttribute('aria-labelledby', 'admin-search-title');
  dialog.innerHTML = `<div class="admin-search-head"><h2 id="admin-search-title">Dove vuoi andare?</h2><button type="button" class="admin-icon-button" aria-label="Chiudi ricerca">${icon('close')}</button></div><label class="admin-search-field">${icon('search')}<input type="search" name="admin-section-search" placeholder="Cerca incassi, turni, inventario…" aria-label="Cerca una sezione" autocomplete="off"></label><div class="admin-search-results"></div><p class="admin-search-help">Usa ↑ ↓ per scegliere e Invio per aprire</p>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input')!;
  const results = dialog.querySelector<HTMLElement>('.admin-search-results')!;
  const normalize = (text: string) => text.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function render(): void {
    results.replaceChildren();
    const query = normalize(input.value.trim());
    Object.entries(pages).filter(([id, page]) => {
      const original = nav.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
      return original && !original.hidden && normalize(`${page.title} ${page.description} ${page.group}`).includes(query);
    }).forEach(([id, page]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-search-result';
      const originalIcon = nav.querySelector(`[data-tab="${id}"] svg`);
      if (originalIcon) button.append(originalIcon.cloneNode(true));
      const label = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = page.title;
      const group = document.createElement('small');
      group.textContent = page.group;
      label.append(title, group);
      button.append(label);
      button.insertAdjacentHTML('beforeend', icon('arrow'));
      button.addEventListener('click', () => {
        dialog.close();
        navigate(id);
        document.getElementById('admin-page-title')?.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      });
      results.append(button);
    });
    if (!results.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'admin-search-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = 'Nessuna sezione trovata. Prova con “incassi” o “turni”.';
      results.append(empty);
    }
    results.querySelector('button')?.classList.add('is-selected');
  }
  function open(): void {
    if (dialog.open) return;
    input.value = '';
    render();
    dialog.showModal();
    input.focus();
  }
  trigger.addEventListener('click', open);
  dialog.querySelector('.admin-search-head button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    const buttons = Array.from(results.querySelectorAll('button'));
    if (!buttons.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1].focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      buttons[0].click();
    }
  });
  results.addEventListener('focusin', event => {
    results.querySelectorAll('button').forEach(button => button.classList.toggle('is-selected', button === event.target));
  });
  results.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(results.querySelectorAll('button'));
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowUp' && index === 0) input.focus();
    else buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
}

function initMobileDrawer(): void {
  const drawer = document.getElementById('hotdog-menu-drawer')!;
  const trigger = document.getElementById('btn-hamburger-menu')!;
  const close = document.getElementById('btn-close-hotdog')!;
  let returnFocus: HTMLElement | null = null;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Tutte le sezioni');
  trigger.setAttribute('aria-controls', drawer.id);
  trigger.setAttribute('aria-expanded', 'false');
  drawer.inert = true;
  const background = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== drawer && el.id !== 'hotdog-backdrop' && el.tagName !== 'SCRIPT');
  let previousInert: boolean[] = [];
  let wasOpen = false;
  new MutationObserver(() => {
    const open = drawer.classList.contains('is-open');
    if (open === wasOpen) return;
    wasOpen = open;
    drawer.inert = !open;
    trigger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('admin-menu-open', open);
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
      previousInert = background.map(el => el.inert);
      background.forEach(el => { el.inert = true; });
      close.focus();
    } else {
      background.forEach((el, index) => { el.inert = previousInert[index] || false; });
      returnFocus?.focus({ preventScroll: true });
    }
  }).observe(drawer, { attributes: true, attributeFilter: ['class'] });
  drawer.addEventListener('keydown', event => {
    if (event.key === 'Escape') close.click();
    if (event.key !== 'Tab') return;
    const buttons = Array.from(drawer.querySelectorAll<HTMLElement>('button:not([hidden]), a[href]')).filter(el => el.getClientRects().length > 0);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  window.matchMedia('(min-width: 1100px)').addEventListener('change', event => {
    if (event.matches && drawer.classList.contains('is-open')) close.click();
  });
}
