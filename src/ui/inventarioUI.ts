import { ETICHETTE_CATEGORIA, ORDINE_CATEGORIE } from '../data/tabacchi';
import {
  aggiungiGratta,
  aggiungiTabacco,
  caricaCatalogoGratta,
  caricaCatalogoTabacchi,
  CategoriaTabacco,
  eliminaGratta,
  eliminaTabacco,
  salvaCopiaLocale,
  VoceCatalogoGratta,
  VoceCatalogoTabacco
} from '../services/catalogo';
import { fetchInventario, salvaInventario } from '../services/inventario';
import { GrattaEVinciConta, SigaretteConta } from '../types';
import { formatCurrency, formatDateItalian, parseInputValue } from '../utils/calculations';

// Cataloghi caricati dal database
let catalogoGratta: VoceCatalogoGratta[] = [];
let catalogoTabacchi: VoceCatalogoTabacco[] = [];

// Differenze contate, indicizzate per nome dell'articolo
let contaGratta = new Map<string, { pacchi: number; pezzi: number }>();
let contaTabacchi = new Map<string, { stecche: number; pacchetti: number }>();

let dataCorrente = '';
let salvaTimer: number | null = null;
let filtroGratta = '';
let filtroTabacchi = '';
let categoriaAttiva: CategoriaTabacco = 'sigarette';
let modificaGratta = false;
let modificaTabacchi = false;

const invTabs = Array.from(document.querySelectorAll('.inv-tab')) as HTMLButtonElement[];
const invPanes = Array.from(document.querySelectorAll('.inv-pane')) as HTMLElement[];
const listaGratta = document.getElementById('inv-gratta-lista') as HTMLDivElement;
const listaTabacchi = document.getElementById('inv-sigarette-lista') as HTMLDivElement;
const totaleGratta = document.getElementById('inv-gratta-totale') as HTMLSpanElement;
const cercaGratta = document.getElementById('inv-gratta-cerca') as HTMLInputElement;
const cercaTabacchi = document.getElementById('inv-sigarette-cerca') as HTMLInputElement;
const btnStampaGratta = document.getElementById('btn-print-inventario-gratta') as HTMLButtonElement;
const btnStampaTabacchi = document.getElementById('btn-print-inventario-sigarette') as HTMLButtonElement;
const btnModificaGratta = document.getElementById('btn-modifica-gratta') as HTMLButtonElement;
const btnModificaTabacchi = document.getElementById('btn-modifica-tabacchi') as HTMLButtonElement;
const formNuovoGratta = document.getElementById('form-nuovo-gratta') as HTMLDivElement;
const formNuovoTabacco = document.getElementById('form-nuovo-tabacco') as HTMLDivElement;
const categorieBtn = Array.from(document.querySelectorAll('[data-categoria]')) as HTMLButtonElement[];

function parseIntero(testo: string): number {
  const pulito = testo.replace(/\s/g, '');
  if (pulito === '' || pulito === '-') return 0;
  const n = parseInt(pulito, 10);
  return isNaN(n) ? 0 : n;
}

function mostraIntero(valore: number): string {
  return valore === 0 ? '' : String(valore);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function corrisponde(testo: string, filtro: string): boolean {
  return filtro === '' || testo.toLowerCase().includes(filtro.toLowerCase());
}

/**
 * Valore in euro della differenza sui Gratta e Vinci: un pacco vale il suo
 * numero di pezzi, e ogni pezzo vale il taglio del gioco.
 */
function calcolaTotaleGratta(): number {
  let totale = 0;

  catalogoGratta.forEach(voce => {
    const v = contaGratta.get(voce.gioco);
    if (!v) return;
    totale += (v.pacchi * voce.pezziPerPacco + v.pezzi) * voce.prezzo;
  });

  return Number(totale.toFixed(2));
}

function campoHtml(etichetta: string, campo: string, valore: number): string {
  const negativo = valore < 0;

  return `
    <div class="inv-field">
      <label class="inv-field-label">${etichetta}</label>
      <div class="inv-input-group">
        <button
          type="button"
          class="btn-sign-toggle is-compact ${negativo ? 'is-negative' : ''}"
          data-action="segno"
          data-campo="${campo}"
          aria-label="Inverti il segno"
        >&plusmn;</button>
        <input
          type="text"
          class="inv-input ${negativo ? 'is-negative' : ''}"
          data-campo="${campo}"
          inputmode="numeric"
          placeholder="0"
          value="${mostraIntero(valore)}"
        />
      </div>
    </div>
  `;
}

function pulsanteElimina(inModifica: boolean): string {
  return inModifica
    ? '<button type="button" class="todo-icon-btn is-danger" data-action="elimina" aria-label="Elimina dal catalogo"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>'
    : '';
}

/**
 * Un gruppo di articoli, sempre aperto: dover cliccare per vedere cosa c'è
 * dentro rallenta chi sta contando la merce con l'inventario in mano.
 */
function gruppoHtml(titolo: string, meta: string, righe: string, colonne: [string, string]): string {
  return `
    <section class="inv-group">
      <header class="inv-group-header">
        <h3 class="inv-group-title">${titolo}</h3>
        <span class="inv-group-meta">${meta}</span>
      </header>

      <div class="inv-legend" aria-hidden="true">
        <span class="inv-legend-label">${colonne[0]}</span>
        <span class="inv-legend-label">${colonne[1]}</span>
      </div>

      <div class="inv-group-body">${righe}</div>
    </section>
  `;
}

function renderGratta() {
  if (!listaGratta) return;

  // Raggruppa per taglio di prezzo, come negli ordini
  const tagli = Array.from(new Set(catalogoGratta.map(v => v.prezzo))).sort((a, b) => a - b);

  const gruppi = tagli.map(prezzo => {
    const voci = catalogoGratta
      .filter(v => v.prezzo === prezzo && corrisponde(v.gioco, filtroGratta))
      .sort((a, b) => a.gioco.localeCompare(b.gioco));

    if (voci.length === 0) return '';


    const righe = voci.map(voce => {
      const c = contaGratta.get(voce.gioco) || { pacchi: 0, pezzi: 0 };
      return `
        <div class="inv-row" data-chiave="${escapeHtml(voce.gioco)}">
          <span class="inv-name">${escapeHtml(voce.gioco)}</span>
          <div class="inv-fields">
            ${campoHtml('Pacchi', 'pacchi', c.pacchi)}
            ${campoHtml('Pezzi', 'pezzi', c.pezzi)}
            ${pulsanteElimina(modificaGratta)}
          </div>
        </div>
      `;
    }).join('');

    const pezzi = voci[0].pezziPerPacco;

    return gruppoHtml(
      `${prezzo} €`,
      `${voci.length} giochi · ${pezzi} pezzi per pacco`,
      righe,
      ['Pacchi', 'Pezzi']
    );
  }).join('');

  listaGratta.innerHTML = gruppi || `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <p class="empty-state-text">Nessun gioco corrisponde alla ricerca.</p>
    </div>
  `;

  aggiornaTotaleGratta();
}

function aggiornaTotaleGratta() {
  if (!totaleGratta) return;

  const totale = calcolaTotaleGratta();
  totaleGratta.textContent = formatCurrency(totale);
  totaleGratta.classList.toggle('is-negative', totale < 0);
}

function renderTabacchi() {
  if (!listaTabacchi) return;

  const dellaCategoria = catalogoTabacchi.filter(v => v.categoria === categoriaAttiva);
  const marche = Array.from(new Set(dellaCategoria.map(v => v.marca)));

  const gruppi = marche.map(marca => {
    const voci = dellaCategoria
      .filter(v => v.marca === marca)
      .filter(v => corrisponde(v.prodotto, filtroTabacchi) || corrisponde(marca, filtroTabacchi))
      .sort((a, b) => a.prodotto.localeCompare(b.prodotto));

    if (voci.length === 0) return '';


    const righe = voci.map(voce => {
      const c = contaTabacchi.get(voce.prodotto) || { stecche: 0, pacchetti: 0 };
      return `
        <div class="inv-row" data-chiave="${escapeHtml(voce.prodotto)}">
          <span class="inv-name">${escapeHtml(voce.prodotto)}</span>
          <div class="inv-fields">
            ${campoHtml('Stecche', 'stecche', c.stecche)}
            ${campoHtml('Pacchetti', 'pacchetti', c.pacchetti)}
            ${pulsanteElimina(modificaTabacchi)}
          </div>
        </div>
      `;
    }).join('');

    return gruppoHtml(escapeHtml(marca), `${voci.length}`, righe, ['Stecche', 'Pacchetti']);
  }).join('');

  listaTabacchi.innerHTML = gruppi || `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <p class="empty-state-text">Nessun prodotto in questa categoria.</p>
    </div>
  `;
}

/** Salvataggio ritardato, come per gli incassi */
function salvaConRitardo() {
  if (salvaTimer !== null) window.clearTimeout(salvaTimer);

  salvaTimer = window.setTimeout(() => {
    const gratta: GrattaEVinciConta[] = [];
    contaGratta.forEach((v, gioco) => {
      const voce = catalogoGratta.find(x => x.gioco === gioco);
      gratta.push({ gioco, prezzo: voce?.prezzo ?? 0, pacchi: v.pacchi, pezzi: v.pezzi });
    });

    const tabacchi: SigaretteConta[] = [];
    contaTabacchi.forEach((v, marca) => {
      tabacchi.push({ marca, stecche: v.stecche, pacchetti: v.pacchetti });
    });

    salvaInventario(dataCorrente, gratta, tabacchi).catch(err => {
      console.error('Errore salvataggio inventario:', err);
    });
  }, 600);
}

function aggiornaValore(chiave: string, campo: string, valore: number) {
  if (campo === 'pacchi' || campo === 'pezzi') {
    const attuale = contaGratta.get(chiave) || { pacchi: 0, pezzi: 0 };
    if (campo === 'pacchi') attuale.pacchi = valore;
    else attuale.pezzi = valore;

    contaGratta.set(chiave, attuale);
    aggiornaTotaleGratta();
    return;
  }

  const attuale = contaTabacchi.get(chiave) || { stecche: 0, pacchetti: 0 };
  if (campo === 'stecche') attuale.stecche = valore;
  else attuale.pacchetti = valore;

  contaTabacchi.set(chiave, attuale);
}

/**
 * Un solo gestore per lista: le righe sono oltre cento e riagganciare un
 * listener per ogni campo a ogni render sarebbe superfluo.
 */
function collegaLista(lista: HTMLElement, tipo: 'gratta' | 'tabacchi') {
  lista.addEventListener('input', e => {
    const campo = e.target as HTMLInputElement;
    if (!campo.classList.contains('inv-input')) return;

    const riga = campo.closest('.inv-row') as HTMLElement | null;
    const nome = campo.getAttribute('data-campo');
    const chiave = riga?.getAttribute('data-chiave');
    if (!riga || !nome || !chiave) return;

    const valore = parseIntero(campo.value);
    campo.classList.toggle('is-negative', valore < 0);
    riga.querySelector(`[data-action="segno"][data-campo="${nome}"]`)
      ?.classList.toggle('is-negative', valore < 0);

    aggiornaValore(chiave, nome, valore);
    salvaConRitardo();
  });

  lista.addEventListener('click', async e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.inv-row') as HTMLElement | null;
    const chiave = riga?.getAttribute('data-chiave');
    if (!riga || !chiave) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'elimina') {
      if (tipo === 'gratta') {
        catalogoGratta = catalogoGratta.filter(v => v.gioco !== chiave);
        contaGratta.delete(chiave);
        await eliminaGratta(chiave);
        renderGratta();
      } else {
        catalogoTabacchi = catalogoTabacchi.filter(v => v.prodotto !== chiave);
        contaTabacchi.delete(chiave);
        await eliminaTabacco(chiave);
        renderTabacchi();
      }

      salvaCopiaLocale(catalogoGratta, catalogoTabacchi);
      salvaConRitardo();
      return;
    }

    if (azione !== 'segno') return;

    const nome = pulsante.getAttribute('data-campo');
    const campo = riga.querySelector(`input[data-campo="${nome}"]`) as HTMLInputElement | null;
    if (!campo || !nome) return;

    // Si inverte il testo, non il numero: così si può premere ± a campo vuoto
    // e poi scrivere le cifre, come nel campo Sisal
    const grezzo = campo.value.trim();
    campo.value = grezzo.startsWith('-') ? grezzo.slice(1) : `-${grezzo}`;

    const valore = parseIntero(campo.value);
    campo.classList.toggle('is-negative', valore < 0);
    pulsante.classList.toggle('is-negative', valore < 0);

    campo.focus();
    aggiornaValore(chiave, nome, valore);
    salvaConRitardo();
  });
}

/**
 * Prepara e manda in stampa il foglio dell'inventario.
 * Si stampano solo le voci con una differenza: un elenco di zeri non serve
 * a nessuno e occuperebbe decine di pagine.
 */
function stampaInventario(tipo: 'gratta' | 'tabacchi') {
  const titolo = document.getElementById('doc-inv-titolo');
  const data = document.getElementById('doc-inv-data');
  const col1 = document.getElementById('doc-inv-col1');
  const col2 = document.getElementById('doc-inv-col2');
  const corpo = document.getElementById('doc-inv-corpo');
  const piede = document.getElementById('doc-inv-piede');

  if (!corpo || !piede) return;

  if (titolo) titolo.textContent = tipo === 'gratta' ? 'Inventario Gratta e Vinci' : 'Inventario Tabacchi';
  if (data) data.textContent = `Data: ${formatDateItalian(dataCorrente)}`;
  if (col1) col1.textContent = tipo === 'gratta' ? 'Pacchi' : 'Stecche';
  if (col2) col2.textContent = tipo === 'gratta' ? 'Pezzi' : 'Pacchetti';

  const righe: string[] = [];
  const segno = (n: number) => `${n > 0 ? '+' : ''}${n}`;

  if (tipo === 'gratta') {
    const tagli = Array.from(new Set(catalogoGratta.map(v => v.prezzo))).sort((a, b) => a - b);

    tagli.forEach(prezzo => {
      const voci = catalogoGratta
        .filter(v => v.prezzo === prezzo)
        .filter(v => {
          const c = contaGratta.get(v.gioco);
          return c && (c.pacchi !== 0 || c.pezzi !== 0);
        });

      if (voci.length === 0) return;

      righe.push(`<tr class="doc-section-divider"><td colspan="3">${prezzo} €</td></tr>`);

      voci.forEach(voce => {
        const c = contaGratta.get(voce.gioco)!;
        righe.push(`
          <tr>
            <td>${escapeHtml(voce.gioco)}</td>
            <td class="doc-amount">${segno(c.pacchi)}</td>
            <td class="doc-amount">${segno(c.pezzi)}</td>
          </tr>
        `);
      });
    });

    piede.innerHTML = `
      <tr class="doc-grand-total-row">
        <td colspan="2"><span class="doc-symbol sym-equal">=</span> DIFFERENZA</td>
        <td class="doc-total-amount">${formatCurrency(calcolaTotaleGratta())}</td>
      </tr>
    `;
  } else {
    ORDINE_CATEGORIE.forEach(categoria => {
      const voci = catalogoTabacchi
        .filter(v => v.categoria === categoria)
        .filter(v => {
          const c = contaTabacchi.get(v.prodotto);
          return c && (c.stecche !== 0 || c.pacchetti !== 0);
        })
        .sort((a, b) => a.marca.localeCompare(b.marca) || a.prodotto.localeCompare(b.prodotto));

      if (voci.length === 0) return;

      righe.push(
        `<tr class="doc-section-divider"><td colspan="3">${ETICHETTE_CATEGORIA[categoria]}</td></tr>`
      );

      voci.forEach(voce => {
        const c = contaTabacchi.get(voce.prodotto)!;
        righe.push(`
          <tr>
            <td>${escapeHtml(voce.prodotto)}</td>
            <td class="doc-amount">${segno(c.stecche)}</td>
            <td class="doc-amount">${segno(c.pacchetti)}</td>
          </tr>
        `);
      });
    });

    piede.innerHTML = '';
  }

  corpo.innerHTML = righe.length > 0
    ? righe.join('')
    : '<tr><td colspan="3">Nessuna differenza rilevata: il conto torna.</td></tr>';

  // Manda in stampa il foglio dell'inventario invece di quello contabile
  document.querySelectorAll('.print-host').forEach(host => {
    host.classList.toggle('is-printing', host.id === 'print-inventario-host');
  });

  window.print();

  document.querySelectorAll('.print-host').forEach(host => {
    host.classList.toggle('is-printing', host.id === 'print-document-host');
  });
}

async function aggiungiNuovoGratta() {
  const nome = (document.getElementById('nuovo-gratta-nome') as HTMLInputElement)?.value?.trim();
  const costoPacco = parseInputValue((document.getElementById('nuovo-gratta-costo') as HTMLInputElement)?.value || '');
  const pezzi = parseIntero((document.getElementById('nuovo-gratta-pezzi') as HTMLInputElement)?.value || '');

  if (!nome || costoPacco <= 0 || pezzi <= 0) return;
  if (catalogoGratta.some(v => v.gioco.toLowerCase() === nome.toLowerCase())) return;

  // Il taglio del biglietto si ricava dal costo del pacco diviso i pezzi
  const prezzo = Number((costoPacco / pezzi).toFixed(2));
  const voce: VoceCatalogoGratta = { gioco: nome, prezzo, pezziPerPacco: pezzi };

  catalogoGratta.push(voce);
  await aggiungiGratta(voce);
  salvaCopiaLocale(catalogoGratta, catalogoTabacchi);

  (document.getElementById('nuovo-gratta-nome') as HTMLInputElement).value = '';
  (document.getElementById('nuovo-gratta-costo') as HTMLInputElement).value = '';
  (document.getElementById('nuovo-gratta-pezzi') as HTMLInputElement).value = '';

  renderGratta();
}

async function aggiungiNuovoTabacco() {
  const nome = (document.getElementById('nuovo-tabacco-nome') as HTMLInputElement)?.value?.trim();
  const marca = (document.getElementById('nuovo-tabacco-marca') as HTMLInputElement)?.value?.trim();

  if (!nome || !marca) return;
  if (catalogoTabacchi.some(v => v.prodotto.toLowerCase() === nome.toLowerCase())) return;

  const voce: VoceCatalogoTabacco = { prodotto: nome, marca, categoria: categoriaAttiva };

  catalogoTabacchi.push(voce);
  await aggiungiTabacco(voce);
  salvaCopiaLocale(catalogoGratta, catalogoTabacchi);

  (document.getElementById('nuovo-tabacco-nome') as HTMLInputElement).value = '';
  (document.getElementById('nuovo-tabacco-marca') as HTMLInputElement).value = '';

  renderTabacchi();
}

function alternaModifica(tipo: 'gratta' | 'tabacchi') {
  if (tipo === 'gratta') {
    modificaGratta = !modificaGratta;
    btnModificaGratta?.classList.toggle('is-active', modificaGratta);
    if (btnModificaGratta) btnModificaGratta.textContent = modificaGratta ? 'Fine' : 'Modifica';
    formNuovoGratta?.classList.toggle('is-hidden', !modificaGratta);
    renderGratta();
  } else {
    modificaTabacchi = !modificaTabacchi;
    btnModificaTabacchi?.classList.toggle('is-active', modificaTabacchi);
    if (btnModificaTabacchi) btnModificaTabacchi.textContent = modificaTabacchi ? 'Fine' : 'Modifica';
    formNuovoTabacco?.classList.toggle('is-hidden', !modificaTabacchi);
    renderTabacchi();
  }
}

/**
 * Carica l'inventario della giornata indicata
 */
export async function caricaInventario(dateStr: string) {
  dataCorrente = dateStr;

  const dati = await fetchInventario(dateStr);

  contaGratta = new Map();
  dati.grattaEVinci.forEach(v => {
    contaGratta.set(v.gioco, { pacchi: v.pacchi, pezzi: v.pezzi });
  });

  contaTabacchi = new Map();
  dati.sigarette.forEach(v => {
    contaTabacchi.set(v.marca, { stecche: v.stecche, pacchetti: v.pacchetti });
  });

  renderGratta();
  renderTabacchi();
}

/**
 * Carica i cataloghi e aggancia i gestori dell'inventario
 */
export async function initInventario() {
  invTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const scelto = tab.getAttribute('data-inv');

      invTabs.forEach(t => {
        const attivo = t === tab;
        t.classList.toggle('is-active', attivo);
        t.setAttribute('aria-selected', String(attivo));
      });

      invPanes.forEach(p => {
        p.classList.toggle('is-active', p.id === `inv-pane-${scelto}`);
      });
    });
  });

  categorieBtn.forEach(btn => {
    btn.addEventListener('click', () => {
      categoriaAttiva = btn.getAttribute('data-categoria') as CategoriaTabacco;
      categorieBtn.forEach(b => b.classList.toggle('is-active', b === btn));
      renderTabacchi();
    });
  });

  if (listaGratta) collegaLista(listaGratta, 'gratta');
  if (listaTabacchi) collegaLista(listaTabacchi, 'tabacchi');

  if (cercaGratta) {
    cercaGratta.addEventListener('input', () => {
      filtroGratta = cercaGratta.value.trim();
      renderGratta();
    });
  }

  if (cercaTabacchi) {
    cercaTabacchi.addEventListener('input', () => {
      filtroTabacchi = cercaTabacchi.value.trim();
      renderTabacchi();
    });
  }

  btnModificaGratta?.addEventListener('click', () => alternaModifica('gratta'));
  btnModificaTabacchi?.addEventListener('click', () => alternaModifica('tabacchi'));

  document.getElementById('btn-add-gratta')?.addEventListener('click', aggiungiNuovoGratta);
  document.getElementById('btn-add-tabacco')?.addEventListener('click', aggiungiNuovoTabacco);

  if (btnStampaGratta) btnStampaGratta.addEventListener('click', () => stampaInventario('gratta'));
  if (btnStampaTabacchi) btnStampaTabacchi.addEventListener('click', () => stampaInventario('tabacchi'));

  // Se il caricamento dei cataloghi fallisce l'inventario resterebbe vuoto:
  // meglio partire dagli elenchi di riserva e aggiornarli se la rete risponde.
  try {
    [catalogoGratta, catalogoTabacchi] = await Promise.all([
      caricaCatalogoGratta(),
      caricaCatalogoTabacchi()
    ]) as [VoceCatalogoGratta[], VoceCatalogoTabacco[]];
  } catch (err) {
    console.error('Cataloghi non caricati, uso gli elenchi locali:', err);
  }

  renderGratta();
  renderTabacchi();
}
