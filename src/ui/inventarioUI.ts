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
  eliminaInventario,
  fetchInventario,
  fetchStoricoInventari,
  salvaInventario,
  ultimaDataInventario
} from '../services/inventario';
import { amministratore } from '../services/auth';
import { segnala } from './segnalazioni';
import { GrattaEVinciConta, InventarioSintesi, SigaretteConta } from '../types';
import { formatCurrency, formatDateItalian, formatDateLocalISO, parseInputValue } from '../utils/calculations';

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
let filtroStorico = '';
let categoriaAttiva: CategoriaTabacco = 'sigarette';
let modificaGratta = false;
let modificaTabacchi = false;
let activeInvTab: 'gratta' | 'sigarette' | 'storico' = 'gratta';
let elencoStorico: InventarioSintesi[] = [];

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

// Nuovi elementi sessione attiva e storico
const btnSalvaSubito = document.getElementById('btn-salva-inventario-subito') as HTMLButtonElement;
const btnStampaCompleto = document.getElementById('btn-stampa-inventario-completo') as HTMLButtonElement;
const activeDateText = document.getElementById('inv-active-date-text') as HTMLSpanElement;
const saveBadge = document.getElementById('inv-save-badge') as HTMLSpanElement;
const listaStorico = document.getElementById('inv-storico-lista') as HTMLDivElement;
const cercaStorico = document.getElementById('inv-storico-cerca') as HTMLInputElement;
const btnNuovoInventario = document.getElementById('btn-nuovo-inventario') as HTMLButtonElement;
const btnRicaricaStorico = document.getElementById('btn-ricarica-storico-inv') as HTMLButtonElement;

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

function aggiornaBadgeSalvataggio(stato: 'saved' | 'saving') {
  if (!saveBadge) return;
  if (stato === 'saving') {
    saveBadge.textContent = 'Salvataggio...';
    saveBadge.className = 'inv-save-badge is-saving';
  } else {
    saveBadge.textContent = 'Salvato';
    saveBadge.className = 'inv-save-badge is-saved';
  }
}

function aggiornaBarraData(dateStr: string) {
  if (activeDateText) {
    activeDateText.textContent = formatDateItalian(dateStr);
  }
}

async function salvaDati(immediato = false): Promise<void> {
  if (!dataCorrente) return;
  aggiornaBadgeSalvataggio('saving');

  const gratta: GrattaEVinciConta[] = [];
  contaGratta.forEach((v, gioco) => {
    const voce = catalogoGratta.find(x => x.gioco === gioco);
    gratta.push({ gioco, prezzo: voce?.prezzo ?? 0, pacchi: v.pacchi, pezzi: v.pezzi });
  });

  const tabacchi: SigaretteConta[] = [];
  contaTabacchi.forEach((v, marca) => {
    tabacchi.push({ marca, stecche: v.stecche, pacchetti: v.pacchetti });
  });

  try {
    await salvaInventario(dataCorrente, gratta, tabacchi);
    aggiornaBadgeSalvataggio('saved');
    if (immediato && activeInvTab === 'storico') {
      caricaERenderStorico();
    }
  } catch (err) {
    console.error('Errore salvataggio inventario:', err);
    aggiornaBadgeSalvataggio('saved');
  }
}

/** Salvataggio ritardato, come per gli incassi */
function salvaConRitardo() {
  aggiornaBadgeSalvataggio('saving');
  if (salvaTimer !== null) window.clearTimeout(salvaTimer);

  salvaTimer = window.setTimeout(() => {
    salvaDati(false);
  }, 600);
}

export async function salvaSubito(): Promise<void> {
  if (salvaTimer !== null) {
    window.clearTimeout(salvaTimer);
    salvaTimer = null;
  }
  await salvaDati(true);
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
 * Prepara e manda in stampa il foglio dell'inventario con:
 * - Dettaglio chiaro di COSA MANCA e COSA È IN PIÙ
 * - Calcolo esatto della CIFRA (€) in più o che manca per ogni articolo e complessiva
 * - Nessun rischio di stampare il conto contabile giornaliero al posto dell'inventario
 */
export async function stampaInventario(tipo: 'gratta' | 'tabacchi' | 'tutto' = 'tutto', dataTarget?: string) {
  // Lo storico degli inventari passati può essere visualizzato e stampato SOLO dall'amministratore
  if (dataTarget && dataTarget !== dataCorrente && !amministratore()) {
    console.warn('Accesso negato: solo l\'amministratore può stampare inventari storici passati.');
    return;
  }

  const dataStampa = dataTarget || dataCorrente;
  const titolo = document.getElementById('doc-inv-titolo');
  const data = document.getElementById('doc-inv-data');
  const sommario = document.getElementById('doc-inv-sommario');
  const col1 = document.getElementById('doc-inv-col1');
  const colStato = document.getElementById('doc-inv-col-stato');
  const col2 = document.getElementById('doc-inv-col2');
  const corpo = document.getElementById('doc-inv-corpo');
  const piede = document.getElementById('doc-inv-piede');
  const timestamp = document.getElementById('doc-inv-timestamp');

  if (!corpo || !piede) return;

  // Se stampiamo una data diversa da quella attualmente attiva nei form:
  let grattaDati = contaGratta;
  let tabacchiDati = contaTabacchi;

  if (dataTarget && dataTarget !== dataCorrente) {
    const d = await fetchInventario(dataTarget);
    grattaDati = new Map();
    d.grattaEVinci.forEach(v => grattaDati.set(v.gioco, { pacchi: v.pacchi, pezzi: v.pezzi }));
    tabacchiDati = new Map();
    d.sigarette.forEach(v => tabacchiDati.set(v.marca, { stecche: v.stecche, pacchetti: v.pacchetti }));
  }

  if (titolo) {
    titolo.textContent =
      tipo === 'gratta'
        ? 'Inventario Gratta e Vinci - Prospetto Differenze'
        : tipo === 'tabacchi'
        ? 'Inventario Tabacchi - Prospetto Differenze'
        : 'Inventario Magazzino Completo - Prospetto Differenze';
  }

  if (data) data.textContent = `Data inventario: ${formatDateItalian(dataStampa)}`;
  if (timestamp) timestamp.textContent = new Date().toLocaleString('it-IT');
  if (col1) col1.textContent = 'Differenza Rilevata';
  if (colStato) colStato.textContent = 'Stato';
  if (col2) col2.textContent = 'Valore Economico (€)';

  let grattaMancantiEuro = 0;
  let grattaInPiuEuro = 0;
  let grattaTotaleEuro = 0;
  let grattaMancantiCount = 0;
  let grattaInPiuCount = 0;

  let tabacchiMancantiStecche = 0;
  let tabacchiMancantiPacchetti = 0;
  let tabacchiInPiuStecche = 0;
  let tabacchiInPiuPacchetti = 0;
  let tabacchiMancantiCount = 0;
  let tabacchiInPiuCount = 0;

  const righe: string[] = [];

  // 1. SEZIONE GRATTA E VINCI
  if (tipo === 'gratta' || tipo === 'tutto') {
    const tagli = Array.from(new Set(catalogoGratta.map(v => v.prezzo))).sort((a, b) => a - b);
    let vociGrattaTrovate = false;

    tagli.forEach(prezzo => {
      const voci = catalogoGratta
        .filter(v => v.prezzo === prezzo)
        .filter(v => {
          const c = grattaDati.get(v.gioco);
          return c && (c.pacchi !== 0 || c.pezzi !== 0);
        });

      if (voci.length === 0) return;
      vociGrattaTrovate = true;

      righe.push(
        `<tr class="doc-section-divider"><td colspan="4">GRATTA E VINCI — Taglio ${prezzo} € (${voci[0].pezziPerPacco} pezzi per pacco)</td></tr>`
      );

      voci.forEach(voce => {
        const c = grattaDati.get(voce.gioco)!;
        const totPezzi = c.pacchi * voce.pezziPerPacco + c.pezzi;
        const valore = Number((totPezzi * voce.prezzo).toFixed(2));
        grattaTotaleEuro += valore;

        const isManca = totPezzi < 0;
        if (isManca) {
          grattaMancantiEuro += Math.abs(valore);
          grattaMancantiCount++;
        } else if (totPezzi > 0) {
          grattaInPiuEuro += valore;
          grattaInPiuCount++;
        }

        const qtyDesc = [
          c.pacchi !== 0 ? `${c.pacchi > 0 ? '+' : ''}${c.pacchi} pacchi` : '',
          c.pezzi !== 0 ? `${c.pezzi > 0 ? '+' : ''}${c.pezzi} pz` : ''
        ].filter(Boolean).join(', ');

        const statoHtml = isManca
          ? '<span class="doc-badge-manca">MANCA</span>'
          : '<span class="doc-badge-in-piu">IN PIÙ</span>';

        const valoreHtml = isManca
          ? `<span class="doc-cifra-manca">${formatCurrency(valore)}</span>`
          : `<span class="doc-cifra-in-piu">+${formatCurrency(valore)}</span>`;

        righe.push(`
          <tr>
            <td><strong>${escapeHtml(voce.gioco)}</strong> <span style="font-size: 0.75rem; color: #6B7280;">(${voce.prezzo} €)</span></td>
            <td class="doc-amount">${qtyDesc} <span style="font-size: 0.72rem; color: #6B7280;">(tot ${totPezzi > 0 ? '+' : ''}${totPezzi} pz)</span></td>
            <td style="text-align: center;">${statoHtml}</td>
            <td class="doc-amount">${valoreHtml}</td>
          </tr>
        `);
      });
    });

    if (!vociGrattaTrovate && tipo === 'gratta') {
      righe.push('<tr><td colspan="4" style="text-align: center; padding: 1.25rem;">Nessuna differenza rilevata sui Gratta e Vinci: il conto magazzino torna perfettamente.</td></tr>');
    }
  }

  // 2. SEZIONE TABACCHI
  if (tipo === 'tabacchi' || tipo === 'tutto') {
    let vociTabacchiTrovate = false;

    ORDINE_CATEGORIE.forEach(categoria => {
      const voci = catalogoTabacchi
        .filter(v => v.categoria === categoria)
        .filter(v => {
          const c = tabacchiDati.get(v.prodotto);
          return c && (c.stecche !== 0 || c.pacchetti !== 0);
        })
        .sort((a, b) => a.marca.localeCompare(b.marca) || a.prodotto.localeCompare(b.prodotto));

      if (voci.length === 0) return;
      vociTabacchiTrovate = true;

      righe.push(
        `<tr class="doc-section-divider"><td colspan="4">TABACCHI — ${ETICHETTE_CATEGORIA[categoria].toUpperCase()}</td></tr>`
      );

      voci.forEach(voce => {
        const c = tabacchiDati.get(voce.prodotto)!;
        const isManca = c.stecche < 0 || c.pacchetti < 0;

        if (c.stecche < 0) tabacchiMancantiStecche += Math.abs(c.stecche);
        if (c.stecche > 0) tabacchiInPiuStecche += c.stecche;
        if (c.pacchetti < 0) tabacchiMancantiPacchetti += Math.abs(c.pacchetti);
        if (c.pacchetti > 0) tabacchiInPiuPacchetti += c.pacchetti;

        if (isManca) tabacchiMancantiCount++;
        else tabacchiInPiuCount++;

        const qtyDesc = [
          c.stecche !== 0 ? `${c.stecche > 0 ? '+' : ''}${c.stecche} stec.` : '',
          c.pacchetti !== 0 ? `${c.pacchetti > 0 ? '+' : ''}${c.pacchetti} pacc.` : ''
        ].filter(Boolean).join(', ');

        const statoHtml = isManca
          ? '<span class="doc-badge-manca">MANCA</span>'
          : '<span class="doc-badge-in-piu">IN PIÙ</span>';

        righe.push(`
          <tr>
            <td><strong>${escapeHtml(voce.prodotto)}</strong> <span style="font-size: 0.75rem; color: #6B7280;">(${escapeHtml(voce.marca)})</span></td>
            <td class="doc-amount">${qtyDesc}</td>
            <td style="text-align: center;">${statoHtml}</td>
            <td class="doc-amount" style="font-size: 0.8rem; font-weight: 700; color: ${isManca ? '#DC2626' : '#059669'};">${qtyDesc}</td>
          </tr>
        `);
      });
    });

    if (!vociTabacchiTrovate && tipo === 'tabacchi') {
      righe.push('<tr><td colspan="4" style="text-align: center; padding: 1.25rem;">Nessuna differenza rilevata sui Tabacchi: il conto magazzino torna perfettamente.</td></tr>');
    }
  }

  // Riassunto box in cima (#doc-inv-sommario)
  if (sommario) {
    const subManca = [
      grattaMancantiCount > 0 ? `${grattaMancantiCount} G&V (-${formatCurrency(grattaMancantiEuro)})` : '',
      tabacchiMancantiCount > 0 ? `${tabacchiMancantiCount} tabacchi (-${tabacchiMancantiStecche} stec., -${tabacchiMancantiPacchetti} pacc.)` : ''
    ].filter(Boolean).join(' · ') || 'Nessun ammanco';

    const subInPiu = [
      grattaInPiuCount > 0 ? `${grattaInPiuCount} G&V (+${formatCurrency(grattaInPiuEuro)})` : '',
      tabacchiInPiuCount > 0 ? `${tabacchiInPiuCount} tabacchi (+${tabacchiInPiuStecche} stec., +${tabacchiInPiuPacchetti} pacc.)` : ''
    ].filter(Boolean).join(' · ') || 'Nessuna eccedenza';

    sommario.innerHTML = `
      <div class="doc-inv-card is-manca">
        <div class="doc-inv-card-label">Cosa Manca (Ammanchi)</div>
        <div class="doc-inv-card-valore">-${formatCurrency(grattaMancantiEuro)}</div>
        <div class="doc-inv-card-sub">${subManca}</div>
      </div>
      <div class="doc-inv-card is-in-piu">
        <div class="doc-inv-card-label">Cosa è in Più (Eccedenze)</div>
        <div class="doc-inv-card-valore">+${formatCurrency(grattaInPiuEuro)}</div>
        <div class="doc-inv-card-sub">${subInPiu}</div>
      </div>
      <div class="doc-inv-card">
        <div class="doc-inv-card-label">Differenza Netta (€)</div>
        <div class="doc-inv-card-valore ${grattaTotaleEuro < 0 ? 'doc-cifra-manca' : grattaTotaleEuro > 0 ? 'doc-cifra-in-piu' : ''}">
          ${grattaTotaleEuro > 0 ? '+' : ''}${formatCurrency(grattaTotaleEuro)}
        </div>
        <div class="doc-inv-card-sub">Valore economico netto Gratta e Vinci</div>
      </div>
    `;
  }

  // Tabella piede
  piede.innerHTML = `
    <tr class="doc-subtotal-row">
      <td colspan="3"><span class="doc-symbol sym-minus">-</span> TOTALE COSA MANCA (AMMANCHI G&V)</td>
      <td class="doc-amount doc-cifra-manca">-${formatCurrency(grattaMancantiEuro)}</td>
    </tr>
    <tr class="doc-subtotal-row">
      <td colspan="3"><span class="doc-symbol sym-plus">+</span> TOTALE COSA IN PIÙ (ECCEDENZE G&V)</td>
      <td class="doc-amount doc-cifra-in-piu">+${formatCurrency(grattaInPiuEuro)}</td>
    </tr>
    <tr class="doc-grand-total-row">
      <td colspan="3"><span class="doc-symbol sym-equal">=</span> DIFFERENZA NETTA TOTALE (G&V)</td>
      <td class="doc-total-amount">${grattaTotaleEuro > 0 ? '+' : ''}${formatCurrency(grattaTotaleEuro)}</td>
    </tr>
  `;

  corpo.innerHTML = righe.length > 0
    ? righe.join('')
    : '<tr><td colspan="4" style="text-align: center; padding: 1.5rem;">Nessuna differenza registrata in questa sessione.</td></tr>';

  // 1. Imposta in modo univoco il target su body per le regole CSS di stampa
  document.body.setAttribute('data-print-target', 'inventario');

  // 2. Regola le classi print-host
  document.querySelectorAll('.print-host').forEach(host => {
    host.classList.toggle('is-printing', host.id === 'print-inventario-host');
  });

  // 3. Stampa
  window.print();

  // 4. Ripristino differito sicuro (evita race condition su mobile o browser desktop)
  const ripristina = () => {
    setTimeout(() => {
      const tabAttivo = document.querySelector('.tab-pane.is-active')?.id;
      if (tabAttivo !== 'tab-inventario') {
        document.body.removeAttribute('data-print-target');
        document.querySelectorAll('.print-host').forEach(host => {
          host.classList.toggle('is-printing', host.id === 'print-document-host');
        });
      }
    }, 1500);
  };

  window.addEventListener('afterprint', ripristina, { once: true });
}

/**
 * Gestione dello Storico Inventari (Riservato Admin)
 */
export async function caricaERenderStorico() {
  if (!listaStorico) return;
  if (!amministratore()) {
    listaStorico.innerHTML = '<p class="empty-state-text" style="padding: 1.5rem 0;">Accesso riservato all\'amministratore.</p>';
    return;
  }

  listaStorico.innerHTML = '<p class="empty-state-text" style="padding: 1.5rem 0;">Caricamento dello storico inventari in corso...</p>';
  try {
    elencoStorico = await fetchStoricoInventari();
    renderStorico();
  } catch (err) {
    console.error('Errore caricamento storico inventari:', err);
    listaStorico.innerHTML = '<p class="empty-state-text" style="padding: 1.5rem 0; color: #DC2626;">Errore durante il caricamento dello storico inventari.</p>';
  }
}

function renderStorico() {
  if (!listaStorico) return;
  if (!amministratore()) {
    listaStorico.innerHTML = '<p class="empty-state-text" style="padding: 1.5rem 0;">Accesso riservato all\'amministratore.</p>';
    return;
  }

  const cercato = filtroStorico.trim().toLowerCase();
  const filtrati = elencoStorico.filter(item => {
    if (!cercato) return true;
    return item.date.toLowerCase().includes(cercato) || item.dataFormattata.toLowerCase().includes(cercato);
  });

  if (filtrati.length === 0) {
    listaStorico.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1rem;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p class="empty-state-text">${cercato ? 'Nessun inventario corrisponde al filtro cercato.' : 'Nessun inventario registrato nello storico.'}</p>
      </div>
    `;
    return;
  }

  const html = filtrati.map((item, index) => {
    const isAttivo = item.date === dataCorrente;
    const isRecente = index === 0;

    return `
      <article class="inv-storico-card" data-date="${item.date}">
        <header class="inv-storico-card-header">
          <div class="inv-storico-card-date">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>${item.dataFormattata}</span>
            ${isAttivo ? '<span class="inv-save-badge is-saved" style="margin-left: 6px;">In modifica</span>' : ''}
            ${isRecente && !isAttivo ? '<span class="inv-storico-badge-recent">Ultimo</span>' : ''}
          </div>
          <div class="inv-storico-card-actions">
            <button type="button" class="btn-primary-action is-compact" data-action="apri" data-date="${item.date}">
              Apri / Modifica
            </button>
            <button type="button" class="btn-latex-export is-compact" data-action="stampa" data-date="${item.date}">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>
              Stampa
            </button>
            <button type="button" class="todo-icon-btn is-danger" data-action="elimina" data-date="${item.date}" aria-label="Elimina inventario" title="Elimina inventario">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </header>

        <div class="inv-storico-grid">
          <div class="inv-storico-section-box">
            <div class="inv-storico-section-title">
              <span>Gratta e Vinci</span>
              <span style="font-weight: 600; font-size: 0.7rem;">${item.grattaVociDiff} voci con diff.</span>
            </div>
            <div class="inv-kpi-row">
              <span class="inv-kpi-label">Cosa manca:</span>
              <span class="inv-kpi-valore is-negative">-${formatCurrency(item.grattaMancantiEuro)}</span>
            </div>
            <div class="inv-kpi-row">
              <span class="inv-kpi-label">Cosa in più:</span>
              <span class="inv-kpi-valore is-positive">+${formatCurrency(item.grattaInPiuEuro)}</span>
            </div>
            <div class="inv-kpi-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border-light, #E2E8F0);">
              <span class="inv-kpi-label" style="font-weight: 700;">Differenza Netta:</span>
              <span class="inv-kpi-valore ${item.grattaTotaleEuro < 0 ? 'is-negative' : item.grattaTotaleEuro > 0 ? 'is-positive' : ''}">
                ${item.grattaTotaleEuro > 0 ? '+' : ''}${formatCurrency(item.grattaTotaleEuro)}
              </span>
            </div>
          </div>

          <div class="inv-storico-section-box">
            <div class="inv-storico-section-title">
              <span>Tabacchi</span>
              <span style="font-weight: 600; font-size: 0.7rem;">${item.sigaretteVociDiff} referenze</span>
            </div>
            <div class="inv-kpi-row">
              <span class="inv-kpi-label">Cosa manca:</span>
              <span class="inv-kpi-valore is-negative">
                ${item.sigaretteMancantiStecche > 0 ? '-' + item.sigaretteMancantiStecche + ' stec. ' : ''}${item.sigaretteMancantiPacchetti > 0 ? '-' + item.sigaretteMancantiPacchetti + ' pacc.' : item.sigaretteMancantiStecche === 0 ? '0' : ''}
              </span>
            </div>
            <div class="inv-kpi-row">
              <span class="inv-kpi-label">Cosa in più:</span>
              <span class="inv-kpi-valore is-positive">
                ${item.sigaretteInPiuStecche > 0 ? '+' + item.sigaretteInPiuStecche + ' stec. ' : ''}${item.sigaretteInPiuPacchetti > 0 ? '+' + item.sigaretteInPiuPacchetti + ' pacc.' : item.sigaretteInPiuStecche === 0 ? '0' : ''}
              </span>
            </div>
            <div class="inv-kpi-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border-light, #E2E8F0);">
              <span class="inv-kpi-label" style="font-weight: 700;">Esito:</span>
              <span class="inv-kpi-valore">${item.sigaretteVociDiff === 0 ? 'Conto esatto' : item.sigaretteVociDiff + ' articoli'}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  listaStorico.innerHTML = html;
}

export function impostaTabAttivo(nome: 'gratta' | 'sigarette' | 'storico') {
  if (nome === 'storico' && !amministratore()) {
    nome = 'gratta';
  }
  activeInvTab = nome;

  invTabs.forEach(t => {
    const attivo = t.getAttribute('data-inv') === nome;
    t.classList.toggle('is-active', attivo);
    t.setAttribute('aria-selected', String(attivo));
  });

  invPanes.forEach(p => {
    p.classList.toggle('is-active', p.id === `inv-pane-${nome}`);
  });

  if (nome === 'storico') {
    caricaERenderStorico();
  }
}

async function avviaNuovoInventario() {
  if (!amministratore()) return;
  const oggi = formatDateLocalISO(new Date());
  const inserita = window.prompt(
    'Inserisci la data per il nuovo inventario (formato AAAA-MM-GG):',
    oggi
  );
  if (!inserita) return;
  const dataPulita = inserita.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPulita)) {
    window.alert('Formato data non valido. Inserisci la data nel formato AAAA-MM-GG (es. ' + oggi + ').');
    return;
  }

  await caricaInventario(dataPulita);
  impostaTabAttivo('gratta');
}

export function aggiornaPermessiInventario() {
  const isAdmin = amministratore();
  const tabStorico = document.querySelector('.inv-tab[data-inv="storico"]') as HTMLElement | null;
  const paneStorico = document.getElementById('inv-pane-storico');

  if (tabStorico) {
    tabStorico.hidden = !isAdmin;
    tabStorico.style.display = isAdmin ? '' : 'none';
  }
  if (paneStorico) {
    paneStorico.hidden = !isAdmin;
    if (!isAdmin) {
      paneStorico.style.display = 'none';
      if (activeInvTab === 'storico' || paneStorico.classList.contains('is-active')) {
        impostaTabAttivo('gratta');
      }
    } else {
      paneStorico.style.display = '';
    }
  }
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
 * L'inventario va fatto una volta al mese: se nel mese in corso non ne risulta
 * ancora nessuno, lo si segnala sul menu e con un avviso in cima alla scheda.
 */
async function controllaInventarioMensile(oggi: string) {
  const avviso = document.getElementById('avviso-inventario');
  const ultima = await ultimaDataInventario();

  // Si avvisa solo quando dall'ultimo inventario è passato un mese intero.
  // Segnalare subito, il giorno dopo averlo fatto, sarebbe solo rumore.
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
  aggiornaBarraData(dateStr);
  aggiornaBadgeSalvataggio('saved');

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

  await controllaInventarioMensile(dateStr);
}

/**
 * Carica i cataloghi e aggancia i gestori dell'inventario
 */
export async function initInventario() {
  aggiornaPermessiInventario();

  invTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const scelto = tab.getAttribute('data-inv') as 'gratta' | 'sigarette' | 'storico';

      if (scelto === 'storico' && !amministratore()) return;
      activeInvTab = scelto;

      invTabs.forEach(t => {
        const attivo = t === tab;
        t.classList.toggle('is-active', attivo);
        t.setAttribute('aria-selected', String(attivo));
      });

      invPanes.forEach(p => {
        p.classList.toggle('is-active', p.id === `inv-pane-${scelto}`);
      });

      if (scelto === 'storico') {
        caricaERenderStorico();
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

  if (cercaStorico) {
    cercaStorico.addEventListener('input', () => {
      filtroStorico = cercaStorico.value.trim();
      renderStorico();
    });
  }

  btnModificaGratta?.addEventListener('click', () => alternaModifica('gratta'));
  btnModificaTabacchi?.addEventListener('click', () => alternaModifica('tabacchi'));

  document.getElementById('btn-add-gratta')?.addEventListener('click', aggiungiNuovoGratta);
  document.getElementById('btn-add-tabacco')?.addEventListener('click', aggiungiNuovoTabacco);

  // Azioni sessione attiva e salvataggio
  btnSalvaSubito?.addEventListener('click', () => salvaSubito());
  btnStampaCompleto?.addEventListener('click', () => stampaInventario('tutto'));

  // Gestione storico
  btnNuovoInventario?.addEventListener('click', avviaNuovoInventario);
  btnRicaricaStorico?.addEventListener('click', caricaERenderStorico);

  listaStorico?.addEventListener('click', async e => {
    if (!amministratore()) return;
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const date = btn.getAttribute('data-date');
    if (!date) return;

    if (action === 'apri') {
      await caricaInventario(date);
      impostaTabAttivo('gratta');
    } else if (action === 'stampa') {
      await stampaInventario('tutto', date);
    } else if (action === 'elimina') {
      if (window.confirm(`Sei sicuro di voler eliminare l'inventario del ${formatDateItalian(date)}?`)) {
        await eliminaInventario(date);
        await caricaERenderStorico();
        if (dataCorrente === date) {
          await caricaInventario(formatDateLocalISO(new Date()));
        }
      }
    }
  });

  if (btnStampaGratta) btnStampaGratta.addEventListener('click', () => stampaInventario('gratta'));
  if (btnStampaTabacchi) btnStampaTabacchi.addEventListener('click', () => stampaInventario('tabacchi'));

  // Se il caricamento dei cataloghi fallisce l'inventario resterebbe vuoto:
  // meglio partire dagli elenchi di riserva e aggiornarli se la rete risponde.
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
