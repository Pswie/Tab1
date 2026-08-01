import {
  IncassoH24,
  ProdottoH24,
  aggiungiProdotto,
  azzeraMancanti,
  elencaIncassi,
  elencaProdotti,
  eliminaIncasso,
  eliminaProdotto,
  impostaDichiarato,
  impostaMancanti,
  salvaIncasso
} from '../services/h24';
import { formatCurrency, formatInputValue, getTodayDateString, parseInputValue } from '../utils/calculations';
import { inviaNotifica } from '../utils/notifiche';
import { segnala } from './segnalazioni';

/**
 * Distributori H24.
 *
 * Due registri distinti perché sono due lavori distinti: cosa manca dentro
 * alle macchine, che serve al giro di rifornimento, e quanto hanno incassato
 * ogni mese, che serve alla dichiarazione.
 */

let prodotti: ProdottoH24[] = [];
let incassi: IncassoH24[] = [];

/** Quanti mesi indietro si possono scegliere nell'elenco */
const MESI_SCEGLIBILI = 24;

/** Il promemoria della dichiarazione si fa vivo una volta al mese, non a ogni apertura */
const CHIAVE_AVVISATO = 'tabaccheria_h24_dichiarazione_avvisata';

const listaProdotti = document.getElementById('h24-lista-prodotti') as HTMLDivElement;
const totaleMancanti = document.getElementById('h24-totale-mancanti') as HTMLSpanElement;
const campoNome = document.getElementById('h24-nome-prodotto') as HTMLInputElement;
const campoMancanti = document.getElementById('h24-mancanti-prodotto') as HTMLInputElement;
const pulsanteAggiungi = document.getElementById('btn-h24-aggiungi') as HTMLButtonElement;
const pulsanteRifornito = document.getElementById('btn-h24-rifornito') as HTMLButtonElement;
const avviso = document.getElementById('h24-avviso') as HTMLParagraphElement;

const listaIncassi = document.getElementById('h24-lista-incassi') as HTMLDivElement;
const totaleAnno = document.getElementById('h24-totale-anno') as HTMLSpanElement;
const sceltaMese = document.getElementById('h24-mese') as HTMLSelectElement;
const campoImporto = document.getElementById('h24-importo') as HTMLInputElement;
const pulsanteSalvaIncasso = document.getElementById('btn-h24-salva-incasso') as HTMLButtonElement;
const avvisoIncasso = document.getElementById('h24-avviso-incasso') as HTMLParagraphElement;

const promemoria = document.getElementById('h24-promemoria') as HTMLDivElement;
const notaPromemoria = document.getElementById('h24-promemoria-nota') as HTMLSpanElement;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "2026-08" -> "Agosto 2026" */
function nomeMese(mese: string): string {
  const [anno, numero] = mese.split('-').map(Number);
  const testo = new Date(anno, numero - 1, 1)
    .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

/** Mese spostato indietro di N, in formato YYYY-MM */
function meseIndietro(mese: string, quanti: number): string {
  const [anno, numero] = mese.split('-').map(Number);
  const d = new Date(anno, numero - 1 - quanti, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function meseCorrente(): string {
  return getTodayDateString().slice(0, 7);
}

/** Il mese da dichiarare è quello appena concluso */
function meseDaDichiarare(): string {
  return meseIndietro(meseCorrente(), 1);
}

function mostraAvviso(dove: HTMLParagraphElement, testo: string): void {
  if (!dove) return;

  dove.textContent = testo;
  dove.classList.toggle('is-hidden', !testo);
}

function vuoto(messaggio: string, icona: string): string {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${icona}
      </svg>
      <p class="empty-state-text">${escapeHtml(messaggio)}</p>
    </div>
  `;
}

const ICONA_MACCHINA = '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 6.5h8"/><path d="M8 11h8"/><path d="M8 15.5h4"/>';
const ICONA_EURO = '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3.5 3.5 0 0 0-5.5 2.5 3.5 3.5 0 0 0 5.5 2.5"/><path d="M8 11h4"/><path d="M8 13h4"/>';

function renderProdotti(): void {
  if (!listaProdotti) return;

  const mancanti = prodotti.reduce((s, p) => s + Math.max(p.mancanti, 0), 0);

  if (totaleMancanti) totaleMancanti.textContent = String(mancanti);
  if (pulsanteRifornito) pulsanteRifornito.classList.toggle('is-hidden', mancanti === 0);

  // Il pallino sul menu dice che c'è merce da portare, anche a scheda chiusa
  segnala('h24', mancanti);

  if (prodotti.length === 0) {
    listaProdotti.innerHTML = vuoto(
      'Nessun prodotto in elenco. Aggiungi quelli che stanno nelle macchine.',
      ICONA_MACCHINA
    );
    return;
  }

  listaProdotti.innerHTML = prodotti.map(p => `
    <div class="h24-riga ${p.mancanti > 0 ? 'is-da-portare' : ''}" data-id="${escapeHtml(p.id)}">
      <span class="h24-nome">${escapeHtml(p.nome)}</span>

      <div class="h24-quantita">
        <button type="button" class="h24-passo" data-action="meno" aria-label="Uno in meno">&minus;</button>
        <input type="text" class="h24-campo-mancanti" data-action="mancanti" inputmode="numeric"
               value="${p.mancanti || ''}" placeholder="0"
               aria-label="Pezzi mancanti di ${escapeHtml(p.nome)}" />
        <button type="button" class="h24-passo" data-action="piu" aria-label="Uno in più">+</button>
      </div>

      <button type="button" class="todo-icon-btn is-danger" data-action="elimina"
              aria-label="Togli ${escapeHtml(p.nome)} dall'elenco"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    </div>
  `).join('');
}

function renderIncassi(): void {
  if (!listaIncassi) return;

  const anno = getTodayDateString().slice(0, 4);
  const totale = incassi
    .filter(i => i.mese.startsWith(anno))
    .reduce((s, i) => s + i.importo, 0);

  if (totaleAnno) totaleAnno.textContent = formatCurrency(totale);

  if (incassi.length === 0) {
    listaIncassi.innerHTML = vuoto(
      'Nessun incasso registrato. Segna quanto hanno fatto le macchine, mese per mese.',
      ICONA_EURO
    );
    return;
  }

  listaIncassi.innerHTML = incassi.map(i => `
    <div class="h24-riga h24-riga-incasso ${i.dichiarato ? 'is-dichiarato' : ''}"
         data-mese="${escapeHtml(i.mese)}">
      <label class="h24-dichiarato" title="Segna quando la dichiarazione è stata fatta">
        <input type="checkbox" data-action="dichiarato" ${i.dichiarato ? 'checked' : ''}
               aria-label="Dichiarazione di ${escapeHtml(nomeMese(i.mese))} fatta" />
        <span class="sog-check-box" aria-hidden="true"></span>
      </label>

      <div class="h24-dati">
        <span class="h24-nome">${escapeHtml(nomeMese(i.mese))}</span>
        <span class="h24-stato">${i.dichiarato ? 'Dichiarato' : 'Da dichiarare'}</span>
      </div>

      <span class="h24-importo">${formatCurrency(i.importo)}</span>

      <div class="rub-azioni">
        <button type="button" class="todo-icon-btn" data-action="modifica"
                aria-label="Correggi ${escapeHtml(nomeMese(i.mese))}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="todo-icon-btn is-danger" data-action="elimina"
                aria-label="Elimina ${escapeHtml(nomeMese(i.mese))}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
    </div>
  `).join('');
}

/**
 * Il promemoria della dichiarazione.
 *
 * Dal primo del mese il mese prima è concluso e va dichiarato: il riquadro
 * resta lì finché non lo si segna fatto, così non dipende dall'aver visto
 * passare una notifica.
 */
function renderPromemoria(): void {
  if (!promemoria) return;

  const mese = meseDaDichiarare();
  const registrato = incassi.find(i => i.mese === mese);
  const serve = !registrato || !registrato.dichiarato;

  promemoria.classList.toggle('is-hidden', !serve);

  if (!serve || !notaPromemoria) return;

  notaPromemoria.textContent = registrato
    ? `${nomeMese(mese)} è chiuso con ${formatCurrency(registrato.importo)}: resta da dichiarare.`
    : `${nomeMese(mese)} è concluso e non ha ancora un incasso registrato.`;
}

/** Notifica una volta sola per mese: riaprire l'app non la fa ripartire */
function avvisaDichiarazione(): void {
  const mese = meseDaDichiarare();
  const registrato = incassi.find(i => i.mese === mese);

  if (registrato && registrato.dichiarato) return;

  try {
    if (localStorage.getItem(CHIAVE_AVVISATO) === mese) return;
    localStorage.setItem(CHIAVE_AVVISATO, mese);
  } catch {
    // Senza LocalStorage l'avviso si ripete a ogni apertura: meglio che mai
  }

  inviaNotifica('Dichiarazione distributori', `Va dichiarato l'incasso di ${nomeMese(mese)}.`);
}

/** L'elenco dei mesi fra cui scegliere, dal più recente indietro */
function riempiElencoMesi(): void {
  if (!sceltaMese) return;

  const corrente = meseCorrente();

  sceltaMese.innerHTML = Array.from({ length: MESI_SCEGLIBILI }, (_, i) => {
    const mese = meseIndietro(corrente, i);
    return `<option value="${mese}">${escapeHtml(nomeMese(mese))}</option>`;
  }).join('');

  // Si apre sul mese da dichiarare: è quello che si viene a scrivere
  sceltaMese.value = meseDaDichiarare();
}

async function aggiungi(): Promise<void> {
  const nome = campoNome?.value?.trim() || '';

  if (!nome) {
    mostraAvviso(avviso, 'Scrivi il nome del prodotto.');
    return;
  }

  if (prodotti.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
    mostraAvviso(avviso, 'Questo prodotto è già in elenco.');
    return;
  }

  const mancanti = Math.max(parseInt(campoMancanti?.value?.trim() || '0', 10) || 0, 0);

  mostraAvviso(avviso, '');
  campoNome.value = '';
  if (campoMancanti) campoMancanti.value = '';

  const voce = await aggiungiProdotto(nome, mancanti);

  prodotti.push(voce);
  ordinaProdotti();
  renderProdotti();
  campoNome.focus();
}

/** Prima quello che manca: è la lista della spesa per il prossimo giro */
function ordinaProdotti(): void {
  prodotti.sort((a, b) => {
    if ((a.mancanti > 0) !== (b.mancanti > 0)) return a.mancanti > 0 ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
  });
}

/**
 * Cambia i pezzi mancanti di un prodotto.
 * L'elenco non si riordina qui: mentre si scrive, la riga schizzerebbe via.
 */
function cambiaMancanti(prodotto: ProdottoH24, valore: number, riga: HTMLElement): void {
  const mancanti = Math.max(valore, 0);

  prodotto.mancanti = mancanti;
  riga.classList.toggle('is-da-portare', mancanti > 0);

  const totale = prodotti.reduce((s, p) => s + Math.max(p.mancanti, 0), 0);
  if (totaleMancanti) totaleMancanti.textContent = String(totale);
  if (pulsanteRifornito) pulsanteRifornito.classList.toggle('is-hidden', totale === 0);
  segnala('h24', totale);

  impostaMancanti(prodotto.id, mancanti);
}

async function salvaIncassoDelMese(): Promise<void> {
  const mese = sceltaMese?.value || '';
  const importo = parseInputValue(campoImporto?.value || '');

  if (!mese) {
    mostraAvviso(avvisoIncasso, 'Scegli il mese.');
    return;
  }

  if (importo <= 0) {
    mostraAvviso(avvisoIncasso, "Scrivi l'incasso del mese.");
    return;
  }

  mostraAvviso(avvisoIncasso, '');
  if (campoImporto) campoImporto.value = '';

  const voce = await salvaIncasso(mese, importo);

  incassi = [...incassi.filter(i => i.mese !== mese), voce]
    .sort((a, b) => b.mese.localeCompare(a.mese));

  renderIncassi();
  renderPromemoria();
}

export async function caricaH24(): Promise<void> {
  if (!listaProdotti) return;

  [prodotti, incassi] = await Promise.all([elencaProdotti(), elencaIncassi()]);

  renderProdotti();
  renderIncassi();
  renderPromemoria();
}

/**
 * Controlla se c'è una dichiarazione da fare, senza aprire la scheda.
 * Va chiamata all'avvio: è il modo per accorgersene il primo del mese.
 */
export async function controllaDichiarazioneH24(): Promise<void> {
  if (!listaProdotti) return;

  try {
    incassi = await elencaIncassi();
    renderIncassi();
    renderPromemoria();
    avvisaDichiarazione();
  } catch (err) {
    console.warn('Controllo dichiarazione rimandato:', err);
  }
}

export function initH24(): void {
  if (!listaProdotti) return;

  riempiElencoMesi();

  pulsanteAggiungi?.addEventListener('click', aggiungi);

  [campoNome, campoMancanti].forEach(campo => {
    campo?.addEventListener('keydown', e => {
      if (e.key === 'Enter') aggiungi();
    });
  });

  pulsanteSalvaIncasso?.addEventListener('click', salvaIncassoDelMese);

  campoImporto?.addEventListener('keydown', e => {
    if (e.key === 'Enter') salvaIncassoDelMese();
  });

  pulsanteRifornito?.addEventListener('click', async () => {
    prodotti = prodotti.map(p => ({ ...p, mancanti: 0 }));
    renderProdotti();
    await azzeraMancanti();
  });

  document.getElementById('btn-h24-vai-incassi')?.addEventListener('click', () => {
    listaIncassi?.closest('.card-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    campoImporto?.focus();
  });

  // Un solo gestore per elenco: le righe si ridisegnano di continuo
  listaProdotti.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('button[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.h24-riga') as HTMLElement | null;
    const prodotto = prodotti.find(p => p.id === riga?.getAttribute('data-id'));
    if (!riga || !prodotto) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'elimina') {
      prodotti = prodotti.filter(p => p.id !== prodotto.id);
      renderProdotti();
      eliminaProdotto(prodotto.id);
      return;
    }

    const passo = azione === 'piu' ? 1 : -1;
    cambiaMancanti(prodotto, prodotto.mancanti + passo, riga);

    const campo = riga.querySelector('.h24-campo-mancanti') as HTMLInputElement | null;
    if (campo) campo.value = prodotto.mancanti > 0 ? String(prodotto.mancanti) : '';
  });

  listaProdotti.addEventListener('input', e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'mancanti') return;

    const riga = campo.closest('.h24-riga') as HTMLElement | null;
    const prodotto = prodotti.find(p => p.id === riga?.getAttribute('data-id'));
    if (!riga || !prodotto) return;

    const scritti = parseInt(campo.value.trim(), 10);
    cambiaMancanti(prodotto, isNaN(scritti) ? 0 : scritti, riga);
  });

  listaIncassi?.addEventListener('change', e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'dichiarato') return;

    const riga = campo.closest('.h24-riga') as HTMLElement | null;
    const mese = riga?.getAttribute('data-mese');
    const voce = incassi.find(i => i.mese === mese);
    if (!mese || !voce) return;

    voce.dichiarato = campo.checked;

    renderIncassi();
    renderPromemoria();
    impostaDichiarato(mese, campo.checked);
  });

  listaIncassi?.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('button[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.h24-riga') as HTMLElement | null;
    const mese = riga?.getAttribute('data-mese');
    const voce = incassi.find(i => i.mese === mese);
    if (!mese || !voce) return;

    if (pulsante.getAttribute('data-action') === 'modifica') {
      // Si riporta il mese nel modulo in alto: correggere è riscrivere
      if (sceltaMese) sceltaMese.value = mese;
      if (campoImporto) {
        campoImporto.value = formatInputValue(voce.importo);
        campoImporto.focus();
        campoImporto.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    incassi = incassi.filter(i => i.mese !== mese);
    renderIncassi();
    renderPromemoria();
    eliminaIncasso(mese);
  });

  renderProdotti();
  renderIncassi();
  renderPromemoria();
}
