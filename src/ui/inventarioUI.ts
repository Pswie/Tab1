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
import {
  elencaStoricoInventari,
  eliminaInventario,
  fetchInventario,
  pezziPerPaccoDefault,
  salvaInventario,
  ultimaDataInventario
} from '../services/inventario';
import { amministratore } from '../services/auth';
import { segnala } from './segnalazioni';
import { GrattaEVinciConta, SigaretteConta } from '../types';
import { formatCurrency, formatDateItalian, formatDateLocalISO, getWorkingDateString, parseInputValue } from '../utils/calculations';

// Cataloghi caricati dal database
let catalogoGratta: VoceCatalogoGratta[] = [];
let catalogoTabacchi: VoceCatalogoTabacco[] = [];

// Differenze contate per la giornata correntemente visualizzata
let contaGratta = new Map<string, { pacchi: number; pezzi: number }>();
let contaTabacchi = new Map<string, { stecche: number; pacchetti: number }>();

let dataCorrente = '';
let dataOggi = getWorkingDateString();
let salvaTimer: number | null = null;
let filtroGratta = '';
let filtroTabacchi = '';
let categoriaAttiva: CategoriaTabacco = 'sigarette';
let modificaGratta = false;
let modificaTabacchi = false;

// Elementi DOM Principali
const invTabs = Array.from(document.querySelectorAll('.inv-tab')) as HTMLButtonElement[];
const invPanes = Array.from(document.querySelectorAll('.inv-pane')) as HTMLElement[];
const tabBtnStorico = document.getElementById('tab-btn-inv-storico') as HTMLButtonElement | null;
const paneStorico = document.getElementById('inv-pane-storico') as HTMLElement | null;

const listaGratta = document.getElementById('inv-gratta-lista') as HTMLDivElement;
const listaTabacchi = document.getElementById('inv-sigarette-lista') as HTMLDivElement;
const totaleGratta = document.getElementById('inv-gratta-totale') as HTMLSpanElement;
const cercaGratta = document.getElementById('inv-gratta-cerca') as HTMLInputElement;
const cercaTabacchi = document.getElementById('inv-sigarette-cerca') as HTMLInputElement;

const btnStampaGratta = document.getElementById('btn-print-inventario-gratta') as HTMLButtonElement | null;
const btnStampaTabacchi = document.getElementById('btn-print-inventario-sigarette') as HTMLButtonElement | null;
const btnStampaCompleto = document.getElementById('btn-print-inventario-completo') as HTMLButtonElement | null;
const btnSalvaManuale = document.getElementById('btn-inv-salva-manuale') as HTMLButtonElement | null;
const invSalvataggioStato = document.getElementById('inv-salvataggio-stato') as HTMLElement | null;

const invDataDisplay = document.getElementById('inv-data-display') as HTMLElement | null;
const invDatePicker = document.getElementById('inv-date-picker') as HTMLInputElement | null;
const invAdminDateControls = document.getElementById('inv-admin-date-controls') as HTMLElement | null;
const invBannerStorico = document.getElementById('inv-banner-storico') as HTMLElement | null;
const invBannerDataTxt = document.getElementById('inv-banner-data-txt') as HTMLElement | null;
const btnInvTornaOggi = document.getElementById('btn-inv-torna-oggi') as HTMLButtonElement | null;

const btnModificaGratta = document.getElementById('btn-modifica-gratta') as HTMLButtonElement;
const btnModificaTabacchi = document.getElementById('btn-modifica-tabacchi') as HTMLButtonElement;
const formNuovoGratta = document.getElementById('form-nuovo-gratta') as HTMLDivElement;
const formNuovoTabacco = document.getElementById('form-nuovo-tabacco') as HTMLDivElement;
const categorieBtn = Array.from(document.querySelectorAll('[data-categoria]')) as HTMLButtonElement[];

const invStoricoElenco = document.getElementById('inv-storico-elenco') as HTMLDivElement | null;
const btnInvRicaricaStorico = document.getElementById('btn-inv-ricarica-storico') as HTMLButtonElement | null;

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

function impostaBadgeSalvataggio(stato: 'salvato' | 'in-corso' | 'modificato') {
  if (!invSalvataggioStato) return;
  if (stato === 'salvato') {
    invSalvataggioStato.textContent = 'Salvato ✓';
    invSalvataggioStato.style.color = '#15803d';
    invSalvataggioStato.style.borderColor = '#bbf7d0';
  } else if (stato === 'in-corso') {
    invSalvataggioStato.textContent = 'Salvataggio...';
    invSalvataggioStato.style.color = '#b45309';
    invSalvataggioStato.style.borderColor = '#fde68a';
  } else {
    invSalvataggioStato.textContent = 'Non salvato';
    invSalvataggioStato.style.color = '#b91c1c';
    invSalvataggioStato.style.borderColor = '#fecaca';
  }
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
    const pzPerPacco = voce.pezziPerPacco || pezziPerPaccoDefault(voce.prezzo);
    totale += (v.pacchi * pzPerPacco + v.pezzi) * voce.prezzo;
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

    const pezzi = voci[0].pezziPerPacco || pezziPerPaccoDefault(prezzo);

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

function estraiDatiCorrenti() {
  const gratta: GrattaEVinciConta[] = [];
  contaGratta.forEach((v, gioco) => {
    const voce = catalogoGratta.find(x => x.gioco === gioco);
    const prezzo = voce?.prezzo ?? 0;
    gratta.push({ gioco, prezzo, pacchi: v.pacchi, pezzi: v.pezzi });
  });

  const tabacchi: SigaretteConta[] = [];
  contaTabacchi.forEach((v, marca) => {
    tabacchi.push({ marca, stecche: v.stecche, pacchetti: v.pacchetti });
  });

  return { gratta, tabacchi };
}

/** Esegue salvataggio immediato senza ritardo */
export async function eseguiSalvataggioImmediato(): Promise<void> {
  if (salvaTimer !== null) {
    window.clearTimeout(salvaTimer);
    salvaTimer = null;
  }

  if (!dataCorrente) return;

  impostaBadgeSalvataggio('in-corso');
  const { gratta, tabacchi } = estraiDatiCorrenti();

  try {
    await salvaInventario(dataCorrente, gratta, tabacchi);
    impostaBadgeSalvataggio('salvato');

    // Se l'admin ha lo storico visibile, aggiorniamolo
    if (amministratore()) {
      void caricaERenderizzaStorico(false);
    }
  } catch (err) {
    console.error('Errore salvataggio inventario:', err);
    impostaBadgeSalvataggio('modificato');
  }
}

/** Salvataggio ritardato durante la digitazione */
function salvaConRitardo() {
  impostaBadgeSalvataggio('modificato');
  if (salvaTimer !== null) window.clearTimeout(salvaTimer);

  salvaTimer = window.setTimeout(() => {
    void eseguiSalvataggioImmediato();
  }, 500);
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
 * Prepara e invia in stampa il foglio dell'inventario.
 * Riporta esattamente cosa manca o è in più, e la relativa cifra in euro.
 */
export async function preparaStampaInventario(
  tipo: 'gratta' | 'tabacchi' | 'completo',
  dataDaStampare?: string
): Promise<void> {
  const targetDate = dataDaStampare || dataCorrente || dataOggi;

  // Se stiamo stampando una data diversa da quella attiva a video, recuperiamone i dati
  let datiStampaGratta = contaGratta;
  let datiStampaTabacchi = contaTabacchi;

  if (dataDaStampare && dataDaStampare !== dataCorrente) {
    const datiRemoti = await fetchInventario(dataDaStampare);
    datiStampaGratta = new Map();
    datiRemoti.grattaEVinci.forEach(v => {
      datiStampaGratta.set(v.gioco, { pacchi: v.pacchi, pezzi: v.pezzi });
    });
    datiStampaTabacchi = new Map();
    datiRemoti.sigarette.forEach(v => {
      datiStampaTabacchi.set(v.marca, { stecche: v.stecche, pacchetti: v.pacchetti });
    });
  }

  const titoloEl = document.getElementById('doc-inv-titolo');
  const dataEl = document.getElementById('doc-inv-data');
  const oraEl = document.getElementById('doc-inv-ora');
  const riepilogoBox = document.getElementById('doc-inv-riepilogo-box');
  const sezGratta = document.getElementById('doc-inv-sezione-gratta');
  const sezTabacchi = document.getElementById('doc-inv-sezione-tabacchi');
  const corpoGratta = document.getElementById('doc-inv-corpo-gratta');
  const piedeGratta = document.getElementById('doc-inv-piede-gratta');
  const corpoTabacchi = document.getElementById('doc-inv-corpo-tabacchi');
  const piedeTabacchi = document.getElementById('doc-inv-piede-tabacchi');
  const totaleBox = document.getElementById('doc-inv-totale-box');

  if (!corpoGratta || !corpoTabacchi) return;

  const oraStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dataStampaStr = new Date().toLocaleDateString('it-IT');

  if (titoloEl) {
    titoloEl.textContent =
      tipo === 'gratta'
        ? 'Riepilogo Inventario Gratta e Vinci'
        : tipo === 'tabacchi'
        ? 'Riepilogo Inventario Tabacchi & Sigarette'
        : 'Riepilogo Inventario Completo (Gratta e Vinci & Tabacchi)';
  }

  if (dataEl) dataEl.textContent = `Data inventario: ${formatDateItalian(targetDate)}`;
  if (oraEl) oraEl.textContent = `Stampato il: ${dataStampaStr} alle ${oraStr}`;

  const segno = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  // Calcoli Gratta e Vinci
  let totaleGrattaEuro = 0;
  let ammanchiGrattaEuro = 0;
  let eccedenzeGrattaEuro = 0;
  let pzGrattaMancanti = 0;
  let pzGrattaInPiu = 0;
  let righeGrattaCount = 0;

  const righeGrattaHtml: string[] = [];
  const tagli = Array.from(new Set(catalogoGratta.map(v => v.prezzo))).sort((a, b) => a - b);

  tagli.forEach(prezzo => {
    const voci = catalogoGratta
      .filter(v => v.prezzo === prezzo)
      .filter(v => {
        const c = datiStampaGratta.get(v.gioco);
        return c && (c.pacchi !== 0 || c.pezzi !== 0);
      })
      .sort((a, b) => a.gioco.localeCompare(b.gioco));

    if (voci.length === 0) return;

    righeGrattaHtml.push(
      `<tr class="doc-section-divider"><td colspan="6">Taglio ${prezzo} € (${voci[0].pezziPerPacco || pezziPerPaccoDefault(prezzo)} pz/pacco)</td></tr>`
    );

    voci.forEach(voce => {
      const c = datiStampaGratta.get(voce.gioco)!;
      const pzPerPacco = voce.pezziPerPacco || pezziPerPaccoDefault(voce.prezzo);
      const pezziTotali = c.pacchi * pzPerPacco + c.pezzi;
      const valoreEuro = Number((pezziTotali * voce.prezzo).toFixed(2));

      righeGrattaCount++;
      totaleGrattaEuro += valoreEuro;

      const mancante = valoreEuro < 0;
      if (mancante) {
        ammanchiGrattaEuro += Math.abs(valoreEuro);
        pzGrattaMancanti += Math.abs(pezziTotali);
      } else if (valoreEuro > 0) {
        eccedenzeGrattaEuro += valoreEuro;
        pzGrattaInPiu += pezziTotali;
      }

      const badgeStato = mancante
        ? `<span class="doc-badge-manca">MANCA</span>`
        : `<span class="doc-badge-piu">IN PIÙ</span>`;

      const classeCifra = mancante ? 'doc-cifra-negativa' : 'doc-cifra-positiva';
      const importoFormattato = (valoreEuro > 0 ? '+ ' : '') + formatCurrency(valoreEuro);

      righeGrattaHtml.push(`
        <tr>
          <td><strong>${escapeHtml(voce.gioco)}</strong></td>
          <td style="text-align: center;">${voce.prezzo} €</td>
          <td class="doc-amount">${segno(c.pacchi)}</td>
          <td class="doc-amount">${segno(c.pezzi)}</td>
          <td style="text-align: center;">${badgeStato}</td>
          <td class="doc-amount ${classeCifra}">${importoFormattato}</td>
        </tr>
      `);
    });
  });

  if (righeGrattaCount === 0) {
    corpoGratta.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 10px;">Nessuna differenza riscontrata: il conteggio torna perfettamente.</td></tr>';
    if (piedeGratta) piedeGratta.innerHTML = '';
  } else {
    corpoGratta.innerHTML = righeGrattaHtml.join('');
    if (piedeGratta) {
      piedeGratta.innerHTML = `
        <tr class="doc-subtotal-row">
          <td colspan="4">Ammanchi (Cifra mancante): <strong>-${formatCurrency(ammanchiGrattaEuro)}</strong> (${pzGrattaMancanti} pz)</td>
          <td colspan="2" style="text-align:right;">Eccedenze (Cifra in più): <strong>+${formatCurrency(eccedenzeGrattaEuro)}</strong> (${pzGrattaInPiu} pz)</td>
        </tr>
        <tr class="doc-grand-total-row">
          <td colspan="4"><span class="doc-symbol sym-equal">=</span> DIFFERENZA NETTA GRATTA E VINCI</td>
          <td colspan="2" class="doc-total-amount" style="text-align:right; font-size:1.05rem;">${formatCurrency(totaleGrattaEuro)}</td>
        </tr>
      `;
    }
  }

  // Calcoli Tabacchi
  let steccheMancanti = 0;
  let steccheInPiu = 0;
  let pacchettiMancanti = 0;
  let pacchettiInPiu = 0;
  let righeTabacchiCount = 0;
  const righeTabacchiHtml: string[] = [];

  ORDINE_CATEGORIE.forEach(categoria => {
    const voci = catalogoTabacchi
      .filter(v => v.categoria === categoria)
      .filter(v => {
        const c = datiStampaTabacchi.get(v.prodotto);
        return c && (c.stecche !== 0 || c.pacchetti !== 0);
      })
      .sort((a, b) => a.marca.localeCompare(b.marca) || a.prodotto.localeCompare(b.prodotto));

    if (voci.length === 0) return;

    righeTabacchiHtml.push(
      `<tr class="doc-section-divider"><td colspan="5">${ETICHETTE_CATEGORIA[categoria]}</td></tr>`
    );

    voci.forEach(voce => {
      const c = datiStampaTabacchi.get(voce.prodotto)!;
      righeTabacchiCount++;

      if (c.stecche < 0) steccheMancanti += Math.abs(c.stecche);
      else if (c.stecche > 0) steccheInPiu += c.stecche;

      if (c.pacchetti < 0) pacchettiMancanti += Math.abs(c.pacchetti);
      else if (c.pacchetti > 0) pacchettiInPiu += c.pacchetti;

      const eNegativo = c.stecche < 0 || (c.stecche === 0 && c.pacchetti < 0);
      const badgeStato = eNegativo
        ? `<span class="doc-badge-manca">MANCA</span>`
        : `<span class="doc-badge-piu">IN PIÙ</span>`;

      righeTabacchiHtml.push(`
        <tr>
          <td><strong>${escapeHtml(voce.prodotto)}</strong> <small style="color:#64748b;">(${escapeHtml(voce.marca)})</small></td>
          <td style="text-align: center;">${ETICHETTE_CATEGORIA[categoria]}</td>
          <td class="doc-amount">${segno(c.stecche)}</td>
          <td class="doc-amount">${segno(c.pacchetti)}</td>
          <td style="text-align: center;">${badgeStato}</td>
        </tr>
      `);
    });
  });

  if (righeTabacchiCount === 0) {
    corpoTabacchi.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 10px;">Nessuna differenza riscontrata nei tabacchi: il conteggio torna perfettamente.</td></tr>';
    if (piedeTabacchi) piedeTabacchi.innerHTML = '';
  } else {
    corpoTabacchi.innerHTML = righeTabacchiHtml.join('');
    if (piedeTabacchi) {
      piedeTabacchi.innerHTML = `
        <tr class="doc-grand-total-row">
          <td colspan="3"><span class="doc-symbol sym-equal">=</span> TOTALI DISCREPANZE TABACCHI</td>
          <td colspan="2" style="text-align:right;">
            Mancanti: <strong>-${steccheMancanti} st. / -${pacchettiMancanti} pz</strong> | In più: <strong>+${steccheInPiu} st. / +${pacchettiInPiu} pz</strong>
          </td>
        </tr>
      `;
    }
  }

  // Visibilità sezioni a seconda della scelta
  if (sezGratta) sezGratta.style.display = tipo === 'tabacchi' ? 'none' : 'block';
  if (sezTabacchi) sezTabacchi.style.display = tipo === 'gratta' ? 'none' : 'block';

  // Schede riepilogo in testa
  if (riepilogoBox) {
    const cardAmmanchi = `
      <div class="doc-inv-sum-card" style="border-left: 3px solid #b91c1c;">
        <div class="doc-inv-sum-label">Cifra Mancante (Ammanchi)</div>
        <div class="doc-inv-sum-value" style="color: #b91c1c;">-${formatCurrency(ammanchiGrattaEuro)}</div>
        <small style="color: #64748b;">${pzGrattaMancanti} biglietti mancanti</small>
      </div>
    `;
    const cardEccedenze = `
      <div class="doc-inv-sum-card" style="border-left: 3px solid #15803d;">
        <div class="doc-inv-sum-label">Cifra in Più (Eccedenze)</div>
        <div class="doc-inv-sum-value" style="color: #15803d;">+${formatCurrency(eccedenzeGrattaEuro)}</div>
        <small style="color: #64748b;">${pzGrattaInPiu} biglietti in più</small>
      </div>
    `;
    const cardNetto = `
      <div class="doc-inv-sum-card" style="border-left: 3px solid ${totaleGrattaEuro < 0 ? '#b91c1c' : '#15803d'};">
        <div class="doc-inv-sum-label">Differenza Netta Gratta e Vinci</div>
        <div class="doc-inv-sum-value" style="color: ${totaleGrattaEuro < 0 ? '#b91c1c' : '#15803d'};">${formatCurrency(totaleGrattaEuro)}</div>
        <small style="color: #64748b;">${righeGrattaCount} giochi con discrepanza</small>
      </div>
    `;
    const cardTabacchi = `
      <div class="doc-inv-sum-card" style="border-left: 3px solid #0284c7;">
        <div class="doc-inv-sum-label">Scostamenti Tabacchi</div>
        <div class="doc-inv-sum-value" style="font-size: 0.95rem; font-family: inherit;">
          -${steccheMancanti} st. / -${pacchettiMancanti} pz
        </div>
        <small style="color: #64748b;">${righeTabacchiCount} prodotti con discrepanza</small>
      </div>
    `;

    riepilogoBox.innerHTML =
      tipo === 'gratta'
        ? `${cardAmmanchi}${cardEccedenze}${cardNetto}`
        : tipo === 'tabacchi'
        ? `${cardTabacchi}`
        : `${cardAmmanchi}${cardEccedenze}${cardNetto}${cardTabacchi}`;
  }

  if (totaleBox) {
    totaleBox.innerHTML = `
      <div style="padding: 8px 12px; background: #f1f5f9; border-radius: 4px; font-size: 0.8rem; color: #475569; display: flex; justify-content: space-between;">
        <span>Documento valido ai fini dell'inventario interno di magazzino.</span>
        <span>Punto vendita: Tabaccheria / iNES caffè</span>
      </div>
    `;
  }

  // Attiva esclusivamente il foglio dell'inventario per la stampa
  document.querySelectorAll('.print-host').forEach(host => {
    host.classList.toggle('is-printing', host.id === 'print-inventario-host');
  });

  // NON inserire afterprint con ripristino immediato: causava la stampa
  // del conto giornaliero in Chromium e Safari a causa dell'esecuzione anticipata.
  window.print();
}

/**
 * Carica e renderizza la schermata dello storico per gli amministratori
 */
export async function caricaERenderizzaStorico(mostraCaricamento = true): Promise<void> {
  if (!invStoricoElenco || !amministratore()) return;

  if (mostraCaricamento) {
    invStoricoElenco.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <p class="empty-state-text">Caricamento storico inventari in corso...</p>
      </div>
    `;
  }

  try {
    const storico = await elencaStoricoInventari(catalogoGratta);

    // Aggiorna badge sul tab dello storico
    const badgeStorico = document.getElementById('badge-inv-storico');
    if (badgeStorico) {
      if (storico.length > 0) {
        badgeStorico.textContent = String(storico.length);
        badgeStorico.hidden = false;
      } else {
        badgeStorico.hidden = true;
      }
    }

    if (storico.length === 0) {
      invStoricoElenco.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <p class="empty-state-text">Nessun inventario ancora registrato nello storico.</p>
          <small style="color:var(--text-muted); margin-top: 4px;">Quando compili un inventario e lo salvi, comparirà qui con tutti i dettagli e potrai ristamparlo quando vuoi.</small>
        </div>
      `;
      return;
    }

    const cardsHtml = storico.map(voce => {
      const eOggi = voce.date === dataOggi;
      const eCorrente = voce.date === dataCorrente;
      const dataFmt = voce.dataFormattata;

      const classeTotale =
        voce.totaleGrattaEuro < 0 ? 'is-negative' : voce.totaleGrattaEuro > 0 ? 'is-positive' : '';

      const dataSalvataggioFmt = voce.updatedAt
        ? new Date(voce.updatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        : '';

      return `
        <div class="inv-storico-card ${eCorrente ? 'is-current' : ''}" data-data-card="${voce.date}">
          <div class="inv-storico-header">
            <div class="inv-storico-title-group">
              <span class="inv-storico-date">${escapeHtml(dataFmt)}</span>
              ${eOggi ? '<span class="inv-storico-badge-oggi">Oggi</span>' : ''}
              ${eCorrente ? '<span class="inv-storico-badge-oggi" style="background:#e0e7ff; color:#3730a3;">In visione</span>' : ''}
            </div>
            <span class="inv-storico-meta">
              ${dataSalvataggioFmt ? `Salvataggio ore ${dataSalvataggioFmt}` : ''}
              ${voce.salvatoDa ? ` · da ${escapeHtml(voce.salvatoDa)}` : ''}
            </span>
          </div>

          <div class="inv-storico-body">
            <div class="inv-storico-metric">
              <div class="inv-storico-metric-label">Gratta e Vinci — Scostamento</div>
              <div class="inv-storico-metric-val ${classeTotale}">${formatCurrency(voce.totaleGrattaEuro)}</div>
              <div class="inv-storico-metric-sub">
                Mancanti: -${formatCurrency(voce.ammanchiGrattaEuro)} | In più: +${formatCurrency(voce.eccedenzeGrattaEuro)}
              </div>
            </div>

            <div class="inv-storico-metric">
              <div class="inv-storico-metric-label">Tabacchi — Scostamento</div>
              <div class="inv-storico-metric-val" style="font-size:1.1rem;">
                ${voce.steccheTabacchiTotali >= 0 ? '+' : ''}${voce.steccheTabacchiTotali} st. / ${voce.pacchettiTabacchiTotali >= 0 ? '+' : ''}${voce.pacchettiTabacchiTotali} pz
              </div>
              <div class="inv-storico-metric-sub">
                ${voce.vociTabacchiConDifferenza} articoli con discrepanza
              </div>
            </div>
          </div>

          <div class="inv-storico-actions">
            <button type="button" class="btn-secondary-action is-compact" data-action="apri-storico" data-date="${voce.date}">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Apri nel conteggio</span>
            </button>
            <button type="button" class="btn-latex-export" data-action="stampa-storico" data-date="${voce.date}">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>
              <span>Stampa</span>
            </button>
            <button type="button" class="todo-icon-btn is-danger" data-action="elimina-storico" data-date="${voce.date}" aria-label="Elimina dallo storico" title="Elimina dallo storico">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    invStoricoElenco.innerHTML = cardsHtml;
  } catch (err) {
    console.error('Errore durante il caricamento dello storico inventari:', err);
    invStoricoElenco.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-text" style="color:var(--ferrari-red);">Impossibile caricare lo storico in questo momento.</p>
      </div>
    `;
  }
}

/**
 * Aggiorna i controlli e la visibilità della sezione Admin per l'inventario
 */
export function aggiornaVisibilitaAdminInventario(): void {
  const eAdmin = amministratore();

  if (tabBtnStorico) tabBtnStorico.hidden = !eAdmin;
  if (paneStorico) paneStorico.hidden = !eAdmin;
  if (invAdminDateControls) invAdminDateControls.hidden = !eAdmin;

  // Se un non-admin si trovava sulla tab dello storico, riportalo su gratta
  if (!eAdmin) {
    const tabAttiva = document.querySelector('.inv-tab.is-active')?.getAttribute('data-inv');
    if (tabAttiva === 'storico') {
      const tabGratta = document.querySelector('.inv-tab[data-inv="gratta"]') as HTMLButtonElement | null;
      tabGratta?.click();
    }
  } else {
    // Carica lo storico se siamo admin
    void caricaERenderizzaStorico(false);
  }
}

/**
 * L'inventario va fatto una volta al mese: se nel mese in corso non ne risulta
 * ancora nessuno, lo si segnala sul menu e con un avviso in cima alla scheda.
 */
async function controllaInventarioMensile(oggi: string) {
  const avviso = document.getElementById('avviso-inventario');
  const ultima = await ultimaDataInventario();

  let scaduto = false;

  if (ultima) {
    const scadenza = new Date(`${ultima}T00:00:00`);
    scadenza.setMonth(scadenza.getMonth() + 1);
    scaduto = oggi >= formatDateLocalISO(scadenza);
  }

  segnala('inventario', scaduto ? 'pallino' : 0);

  if (!avviso) return;

  avviso.classList.toggle('is-hidden', !scaduto);

  if (scaduto && ultima) {
    avviso.textContent = `È passato un mese dall'ultimo inventario, del ${formatDateItalian(ultima)}.`;
  }
}

/**
 * Carica l'inventario della giornata indicata
 */
export async function caricaInventario(dateStr: string) {
  dataCorrente = dateStr;
  dataOggi = getWorkingDateString();

  if (invDataDisplay) {
    invDataDisplay.textContent = formatDateItalian(dateStr);
  }
  if (invDatePicker) {
    invDatePicker.value = dateStr;
  }

  // Mostra banner se non stiamo guardando la giornata corrente
  if (invBannerStorico) {
    const eStorico = dateStr !== dataOggi;
    invBannerStorico.classList.toggle('is-hidden', !eStorico);
    if (invBannerDataTxt && eStorico) {
      invBannerDataTxt.textContent = formatDateItalian(dateStr);
    }
  }

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
  impostaBadgeSalvataggio('salvato');

  await controllaInventarioMensile(dateStr);

  if (amministratore()) {
    void caricaERenderizzaStorico(false);
  }
}

async function aggiungiNuovoGratta() {
  const nome = (document.getElementById('nuovo-gratta-nome') as HTMLInputElement)?.value?.trim();
  const costoPacco = parseInputValue((document.getElementById('nuovo-gratta-costo') as HTMLInputElement)?.value || '');
  const pezzi = parseIntero((document.getElementById('nuovo-gratta-pezzi') as HTMLInputElement)?.value || '');

  if (!nome || costoPacco <= 0 || pezzi <= 0) return;
  if (catalogoGratta.some(v => v.gioco.toLowerCase() === nome.toLowerCase())) return;

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
 * Carica i cataloghi e aggancia i gestori dell'inventario
 */
export async function initInventario() {
  dataOggi = getWorkingDateString();

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

      if (scelto === 'storico') {
        void caricaERenderizzaStorico();
      }
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

  // Pulsanti di stampa dell'inventario
  if (btnStampaGratta) {
    btnStampaGratta.addEventListener('click', () => {
      void preparaStampaInventario('gratta');
    });
  }

  if (btnStampaTabacchi) {
    btnStampaTabacchi.addEventListener('click', () => {
      void preparaStampaInventario('tabacchi');
    });
  }

  if (btnStampaCompleto) {
    btnStampaCompleto.addEventListener('click', () => {
      void preparaStampaInventario('completo');
    });
  }

  // Pulsante Salvataggio Manuale
  if (btnSalvaManuale) {
    btnSalvaManuale.addEventListener('click', () => {
      void eseguiSalvataggioImmediato();
    });
  }

  // Selettore Data Admin
  if (invDatePicker) {
    invDatePicker.addEventListener('change', () => {
      const nuovaData = invDatePicker.value;
      if (nuovaData) {
        void caricaInventario(nuovaData);
      }
    });
  }

  // Torna all'inventario di oggi
  if (btnInvTornaOggi) {
    btnInvTornaOggi.addEventListener('click', () => {
      dataOggi = getWorkingDateString();
      void caricaInventario(dataOggi);
    });
  }

  // Ricarica storico
  if (btnInvRicaricaStorico) {
    btnInvRicaricaStorico.addEventListener('click', () => {
      void caricaERenderizzaStorico(true);
    });
  }

  // Delegazione click all'interno dello storico (apri, stampa, elimina)
  if (invStoricoElenco) {
    invStoricoElenco.addEventListener('click', async e => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;

      const azione = btn.getAttribute('data-action');
      const dataInv = btn.getAttribute('data-date');
      if (!azione || !dataInv) return;

      if (azione === 'apri-storico') {
        // Carica la data selezionata e passa alla tab Gratta e Vinci
        await caricaInventario(dataInv);
        const tabGratta = document.querySelector('.inv-tab[data-inv="gratta"]') as HTMLButtonElement | null;
        tabGratta?.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (azione === 'stampa-storico') {
        // Stampa direttamente l'inventario di quella data
        void preparaStampaInventario('completo', dataInv);
      } else if (azione === 'elimina-storico') {
        const confermato = window.confirm(
          `Sei sicuro di voler eliminare definitivamente l'inventario del ${formatDateItalian(dataInv)} dallo storico?`
        );
        if (confermato) {
          await eliminaInventario(dataInv);
          // Se stavamo guardando proprio quella giornata, ricarica oggi
          if (dataCorrente === dataInv) {
            void caricaInventario(getWorkingDateString());
          }
          void caricaERenderizzaStorico(false);
        }
      }
    });
  }

  // Garantisce salvataggio prima di uscire o ricaricare
  window.addEventListener('beforeunload', () => {
    if (salvaTimer !== null) {
      void eseguiSalvataggioImmediato();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && salvaTimer !== null) {
      void eseguiSalvataggioImmediato();
    }
  });

  // Ascolta aggiornamento dei permessi
  window.addEventListener('permessi-aggiornati', () => {
    aggiornaVisibilitaAdminInventario();
  });

  // Controllo visibilità admin iniziale
  aggiornaVisibilitaAdminInventario();

  // Caricamento cataloghi
  try {
    [catalogoGratta, catalogoTabacchi] = (await Promise.all([
      caricaCatalogoGratta(),
      caricaCatalogoTabacchi()
    ])) as [VoceCatalogoGratta[], VoceCatalogoTabacco[]];
  } catch (err) {
    console.error('Cataloghi non caricati, uso gli elenchi locali:', err);
  }

  renderGratta();
  renderTabacchi();
}
