import { CATALOGO_GRATTA_E_VINCI } from '../data/grattaEVinci';
import { fetchInventario, salvaInventario } from '../services/inventario';
import { GrattaEVinciConta, SigaretteConta } from '../types';
import { formatCurrency } from '../utils/calculations';

/** Chiave gioco -> differenza contata */
let contaGratta = new Map<string, { prezzo: number; pacchi: number; pezzi: number }>();
let contaSigarette: SigaretteConta[] = [];

let dataCorrente = '';
let salvaTimer: number | null = null;
let seqMarca = 0;

const invTabs = Array.from(document.querySelectorAll('.inv-tab')) as HTMLButtonElement[];
const invPanes = Array.from(document.querySelectorAll('.inv-pane')) as HTMLElement[];
const listaGratta = document.getElementById('inv-gratta-lista') as HTMLDivElement;
const listaSigarette = document.getElementById('inv-sigarette-lista') as HTMLDivElement;
const totaleGratta = document.getElementById('inv-gratta-totale') as HTMLSpanElement;
const inputMarca = document.getElementById('inv-sigarette-marca') as HTMLInputElement;
const btnAddMarca = document.getElementById('btn-add-marca') as HTMLButtonElement;

/**
 * Legge un intero con segno da un campo di testo. Mentre si digita il solo "-"
 * il valore vale 0, senza rompere il totale.
 */
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

/**
 * Valore in euro della differenza contata: un pacco vale il suo numero di
 * pezzi, e ogni pezzo vale il taglio del gioco.
 */
function calcolaTotaleGratta(): number {
  let totale = 0;

  CATALOGO_GRATTA_E_VINCI.forEach(gruppo => {
    gruppo.giochi.forEach(gioco => {
      const v = contaGratta.get(gioco);
      if (!v) return;
      totale += (v.pacchi * gruppo.pezziPerPacco + v.pezzi) * gruppo.prezzo;
    });
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

function renderGratta() {
  if (!listaGratta) return;

  listaGratta.innerHTML = CATALOGO_GRATTA_E_VINCI.map(gruppo => `
    <div class="inv-group">
      <div class="inv-group-header">
        <span class="inv-group-price">${gruppo.prezzo} €</span>
        <span class="inv-group-meta">${gruppo.pezziPerPacco} pezzi per pacco</span>
      </div>

      ${gruppo.giochi.map(gioco => {
        const v = contaGratta.get(gioco) || { prezzo: gruppo.prezzo, pacchi: 0, pezzi: 0 };
        return `
          <div class="inv-row" data-gioco="${escapeHtml(gioco)}">
            <span class="inv-name">${escapeHtml(gioco)}</span>
            <div class="inv-fields">
              ${campoHtml('Pacchi', 'pacchi', v.pacchi)}
              ${campoHtml('Pezzi', 'pezzi', v.pezzi)}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');

  aggiornaTotaleGratta();
}

function aggiornaTotaleGratta() {
  if (!totaleGratta) return;

  const totale = calcolaTotaleGratta();
  totaleGratta.textContent = formatCurrency(totale);
  totaleGratta.classList.toggle('is-negative', totale < 0);
}

function renderSigarette() {
  if (!listaSigarette) return;

  if (contaSigarette.length === 0) {
    listaSigarette.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">🚬</span>
        <p class="empty-state-text">Nessuna marca in elenco. Aggiungine una qui sopra.</p>
      </div>
    `;
    return;
  }

  listaSigarette.innerHTML = contaSigarette.map((voce, indice) => `
    <div class="inv-row" data-indice="${indice}">
      <span class="inv-name">${escapeHtml(voce.marca)}</span>
      <div class="inv-fields">
        ${campoHtml('Stecche', 'stecche', voce.stecche)}
        ${campoHtml('Pacchetti', 'pacchetti', voce.pacchetti)}
        <button type="button" class="todo-icon-btn is-danger" data-action="elimina" aria-label="Rimuovi marca">×</button>
      </div>
    </div>
  `).join('');
}

/** Salvataggio ritardato, come per gli incassi */
function salvaConRitardo() {
  if (salvaTimer !== null) window.clearTimeout(salvaTimer);

  salvaTimer = window.setTimeout(() => {
    const gratta: GrattaEVinciConta[] = [];
    contaGratta.forEach((v, gioco) => {
      gratta.push({ gioco, prezzo: v.prezzo, pacchi: v.pacchi, pezzi: v.pezzi });
    });

    salvaInventario(dataCorrente, gratta, contaSigarette).catch(err => {
      console.error('Errore salvataggio inventario:', err);
    });
  }, 600);
}

/**
 * Aggiorna il valore in memoria a partire dal campo modificato
 */
function aggiornaValore(riga: HTMLElement, campo: string, valore: number) {
  const gioco = riga.getAttribute('data-gioco');

  if (gioco) {
    const gruppo = CATALOGO_GRATTA_E_VINCI.find(g => g.giochi.includes(gioco));
    const attuale = contaGratta.get(gioco) || { prezzo: gruppo?.prezzo ?? 0, pacchi: 0, pezzi: 0 };

    if (campo === 'pacchi') attuale.pacchi = valore;
    if (campo === 'pezzi') attuale.pezzi = valore;

    contaGratta.set(gioco, attuale);
    aggiornaTotaleGratta();
    return;
  }

  const indice = Number(riga.getAttribute('data-indice'));
  const voce = contaSigarette[indice];
  if (!voce) return;

  if (campo === 'stecche') voce.stecche = valore;
  if (campo === 'pacchetti') voce.pacchetti = valore;
}

/**
 * Un solo gestore per lista: le righe sono molte e riagganciare un listener
 * per ogni campo a ogni render sarebbe superfluo.
 */
function collegaLista(lista: HTMLElement) {
  lista.addEventListener('input', e => {
    const campo = e.target as HTMLInputElement;
    if (!campo.classList.contains('inv-input')) return;

    const riga = campo.closest('.inv-row') as HTMLElement | null;
    const nome = campo.getAttribute('data-campo');
    if (!riga || !nome) return;

    const valore = parseIntero(campo.value);
    campo.classList.toggle('is-negative', valore < 0);

    const pulsante = riga.querySelector(`[data-action="segno"][data-campo="${nome}"]`);
    pulsante?.classList.toggle('is-negative', valore < 0);

    aggiornaValore(riga, nome, valore);
    salvaConRitardo();
  });

  lista.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.inv-row') as HTMLElement | null;
    if (!riga) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'segno') {
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
      aggiornaValore(riga, nome, valore);
      salvaConRitardo();
    } else if (azione === 'elimina') {
      const indice = Number(riga.getAttribute('data-indice'));
      contaSigarette.splice(indice, 1);
      renderSigarette();
      salvaConRitardo();
    }
  });
}

function aggiungiMarca() {
  const marca = inputMarca?.value?.trim();
  if (!marca) return;

  const giaPresente = contaSigarette.some(v => v.marca.toLowerCase() === marca.toLowerCase());
  if (giaPresente) {
    inputMarca.value = '';
    return;
  }

  contaSigarette.push({ marca, stecche: 0, pacchetti: 0 });
  seqMarca++;
  inputMarca.value = '';

  renderSigarette();
}

/**
 * Carica l'inventario della giornata indicata
 */
export async function caricaInventario(dateStr: string) {
  dataCorrente = dateStr;

  const dati = await fetchInventario(dateStr);

  contaGratta = new Map();
  dati.grattaEVinci.forEach(v => {
    contaGratta.set(v.gioco, { prezzo: v.prezzo, pacchi: v.pacchi, pezzi: v.pezzi });
  });

  contaSigarette = dati.sigarette.map(v => ({ ...v }));

  renderGratta();
  renderSigarette();
}

/**
 * Aggancia i gestori dell'inventario
 */
export function initInventario() {
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

  if (listaGratta) collegaLista(listaGratta);
  if (listaSigarette) collegaLista(listaSigarette);

  if (btnAddMarca) btnAddMarca.addEventListener('click', aggiungiMarca);
  if (inputMarca) {
    inputMarca.addEventListener('keydown', e => {
      if (e.key === 'Enter') aggiungiMarca();
    });
  }

  renderGratta();
  renderSigarette();
}
