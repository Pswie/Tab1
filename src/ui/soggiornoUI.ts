import {
  elencaSoggiorni,
  importaDaCalendari,
  segnaPagata,
  Soggiorno,
  TARIFFA_A_PERSONA
} from '../services/soggiorno';
import { formatCurrency, getTodayDateString } from '../utils/calculations';
import { segnala } from './segnalazioni';

type Vista = 'presenti' | 'arretrate' | 'pagate';

let soggiorni: Soggiorno[] = [];
let vista: Vista = 'presenti';

const lista = document.getElementById('soggiorno-lista') as HTMLDivElement;
const totaleDaPagare = document.getElementById('soggiorno-da-pagare') as HTMLSpanElement;
const btnAggiorna = document.getElementById('btn-aggiorna-soggiorni') as HTMLButtonElement;
const statoImport = document.getElementById('soggiorno-stato') as HTMLParagraphElement;
const pulsantiVista = Array.from(document.querySelectorAll('.sog-vista')) as HTMLButtonElement[];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 2026-08-01 -> 1 ago */
function dataBreve(iso: string): string {
  const [a, m, g] = iso.split('-').map(Number);
  return new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/** Giorni da `da` a `a`: positivo se `a` viene dopo */
function giorniTra(da: string, a: string): number {
  const x = new Date(`${da}T00:00:00Z`).getTime();
  const y = new Date(`${a}T00:00:00Z`).getTime();
  return Math.round((y - x) / 86400000);
}

/**
 * "Arrivato oggi", "parte tra 2 giorni": al banco serve sapere a colpo d'occhio
 * chi è appena entrato e a chi resta poco, più della data sul calendario.
 */
function frasiSoggiorno(s: Soggiorno): string {
  const oggi = getTodayDateString();
  const daArrivo = giorniTra(s.dataInizio, oggi);
  const aPartenza = giorniTra(oggi, s.dataFine);

  const arrivo =
    daArrivo <= 0 ? 'Arrivato oggi' :
    daArrivo === 1 ? 'Arrivato ieri' :
    `Arrivato ${daArrivo} giorni fa`;

  const partenza =
    aPartenza > 1 ? `parte tra ${aPartenza} giorni` :
    aPartenza === 1 ? 'parte domani' :
    aPartenza === 0 ? 'parte oggi' :
    aPartenza === -1 ? 'partito ieri' :
    `partito ${-aPartenza} giorni fa`;

  return `${arrivo} &middot; ${partenza}`;
}

/**
 * Chi parte oggi: è ancora in casa per la colazione, quindi è l'ultima
 * occasione per riscuotere. Tenuto separato da chi resta ancora qualche notte.
 */
function inPartenza(): Soggiorno[] {
  const oggi = getTodayDateString();
  return soggiorni.filter(s => s.dataInizio <= oggi && s.dataFine === oggi);
}

/** Ospiti che restano ancora almeno una notte */
function inCasa(): Soggiorno[] {
  const oggi = getTodayDateString();
  return soggiorni.filter(s => s.dataInizio <= oggi && s.dataFine > oggi);
}

function presenti(): Soggiorno[] {
  return [...inPartenza(), ...inCasa()];
}

/** Ospiti già ripartiti senza aver versato: la tassa resta da recuperare */
function arretrate(): Soggiorno[] {
  const oggi = getTodayDateString();
  return soggiorni.filter(s => s.dataFine < oggi && !s.pagata);
}

/** Tasse già riscosse, tenute per riscontro */
function pagate(): Soggiorno[] {
  const oggi = getTodayDateString();
  return soggiorni.filter(s => s.dataInizio <= oggi && s.pagata);
}

/** Le viste diverse da "presenti" sono un elenco unico */
function elencoSemplice(): Soggiorno[] {
  if (vista === 'arretrate') return arretrate().sort((a, b) => a.dataFine.localeCompare(b.dataFine));
  return pagate().sort((a, b) => b.dataInizio.localeCompare(a.dataInizio));
}

function messaggioVuoto(): string {
  if (vista === 'arretrate') return 'Nessuna tassa arretrata: tutti gli ospiti ripartiti hanno versato.';
  if (vista === 'pagate') return 'Nessuna tassa ancora registrata come versata.';

  if (soggiorni.length === 0) {
    return 'Nessun soggiorno importato. Premi Aggiorna per leggere i calendari.';
  }

  return 'Nessun ospite presente oggi.';
}

function render() {
  if (!lista) return;

  const inArretrato = arretrate();
  const nonPagatePresenti = presenti().filter(s => !s.pagata);

  // Da versare: chi è in casa e non ha ancora pagato, più chi è andato via senza pagare
  const daVersare = [...nonPagatePresenti, ...inArretrato];

  if (totaleDaPagare) {
    const totale = daVersare.reduce((somma, s) => somma + s.importo, 0);
    totaleDaPagare.textContent = formatCurrency(totale);
    totaleDaPagare.classList.toggle('is-negative', totale > 0);
  }

  segnala('soggiorno', daVersare.length);

  // Il conteggio accanto a ogni vista dice dove guardare
  const conteggi: Record<Vista, number> = {
    presenti: presenti().length,
    arretrate: inArretrato.length,
    pagate: pagate().length
  };

  pulsantiVista.forEach(btn => {
    const chiave = btn.getAttribute('data-vista') as Vista;
    const attivo = chiave === vista;

    btn.classList.toggle('is-active', attivo);
    btn.setAttribute('aria-selected', String(attivo));
    btn.classList.toggle('ha-arretrate', chiave === 'arretrate' && conteggi.arretrate > 0);

    const etichetta = btn.getAttribute('data-etichetta') || btn.textContent!.split(' (')[0].trim();
    btn.setAttribute('data-etichetta', etichetta);
    btn.textContent = conteggi[chiave] > 0 ? `${etichetta} (${conteggi[chiave]})` : etichetta;
  });

  lista.innerHTML = vista === 'presenti' ? contenutoPresenti() : contenutoSemplice();
}

function vuoto(messaggio: string): string {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>
      </svg>
      <p class="empty-state-text">${messaggio}</p>
    </div>
  `;
}

/**
 * Chi parte oggi e chi resta stanno in due riquadri distinti: sono due momenti
 * diversi del lavoro, e per chi parte è l'ultima occasione per riscuotere.
 */
function contenutoPresenti(): string {
  const partenze = inPartenza().sort((a, b) => a.nome.localeCompare(b.nome));
  const restano = inCasa().sort((a, b) => a.dataFine.localeCompare(b.dataFine));

  if (partenze.length === 0 && restano.length === 0) return vuoto(messaggioVuoto());

  const blocchi: string[] = [];

  if (partenze.length > 0) {
    blocchi.push(`
      <section class="sog-gruppo is-partenza">
        <header class="sog-gruppo-testa">
          <h3 class="sog-gruppo-titolo">In partenza oggi</h3>
          <span class="sog-gruppo-meta">Ultimo giorno &middot; ${partenze.length}</span>
        </header>
        ${partenze.map(rigaHtml).join('')}
      </section>
    `);
  }

  if (restano.length > 0) {
    blocchi.push(`
      <section class="sog-gruppo">
        <header class="sog-gruppo-testa">
          <h3 class="sog-gruppo-titolo">In casa</h3>
          <span class="sog-gruppo-meta">${restano.length}</span>
        </header>
        ${restano.map(rigaHtml).join('')}
      </section>
    `);
  }

  return blocchi.join('');
}

function contenutoSemplice(): string {
  const voci = elencoSemplice();
  return voci.length === 0 ? vuoto(messaggioVuoto()) : voci.map(rigaHtml).join('');
}

function rigaHtml(s: Soggiorno): string {
  const oggi = getTodayDateString();
  const arretrata = !s.pagata && s.dataFine < oggi;

  return `
    <div class="sog-row ${s.pagata ? 'is-pagata' : ''} ${arretrata ? 'is-arretrata' : ''}"
         data-uid="${escapeHtml(s.uid)}">
      <label class="sog-check">
        <input type="checkbox" ${s.pagata ? 'checked' : ''} data-action="pagata"
               aria-label="Segna come versata" />
        <span class="sog-check-box" aria-hidden="true"></span>
      </label>

      <div class="sog-dati">
        <span class="sog-nome">${escapeHtml(s.nome)}</span>
        <span class="sog-quando">${frasiSoggiorno(s)}</span>
        <span class="sog-calcolo">
          ${dataBreve(s.dataInizio)} &rarr; ${dataBreve(s.dataFine)} &middot;
          ${s.notti} ${s.notti === 1 ? 'notte' : 'notti'} &middot;
          ${s.ospiti} ${s.ospiti === 1 ? 'ospite' : 'ospiti'} &middot;
          ${formatCurrency(s.tariffa)} a testa
        </span>
      </div>

      <span class="sog-importo">${formatCurrency(s.importo)}</span>
    </div>
  `;
}

/** `automatico` distingue la rilettura giornaliera dal click sul pulsante */
async function aggiorna(automatico = false) {
  if (btnAggiorna) btnAggiorna.disabled = true;

  if (statoImport && !automatico) {
    statoImport.textContent = 'Lettura dei calendari in corso...';
  }

  const esito = await importaDaCalendari();
  soggiorni = await elencaSoggiorni();

  if (esito.errori.length === 0) segnaImportato();

  if (statoImport) {
    const parti: string[] = [];
    if (esito.nuovi > 0) parti.push(`${esito.nuovi} nuovi soggiorni`);
    if (esito.aggiornati > 0) parti.push(`${esito.aggiornati} aggiornati`);

    if (esito.errori.length > 0) {
      statoImport.textContent = `Calendari non letti: ${esito.errori.join('; ')}`;
    } else if (parti.length > 0) {
      statoImport.textContent = `${automatico ? 'Aggiornamento automatico: ' : ''}${parti.join(', ')}`;
    } else if (!automatico) {
      statoImport.textContent = 'Nessuna novità';
    } else {
      statoImport.textContent = '';
    }

    statoImport.classList.toggle('is-errore', esito.errori.length > 0);
  }

  if (btnAggiorna) btnAggiorna.disabled = false;
  render();
}

/**
 * I calendari si rileggono da soli una volta al giorno: le prenotazioni
 * cambiano di continuo e nessuno deve ricordarsi di premere Aggiorna.
 */
const CHIAVE_ULTIMO_IMPORT = 'tabaccheria_soggiorni_ultimo_import';

function importatoOggi(): boolean {
  try {
    return localStorage.getItem(CHIAVE_ULTIMO_IMPORT) === getTodayDateString();
  } catch {
    return false;
  }
}

function segnaImportato(): void {
  try {
    localStorage.setItem(CHIAVE_ULTIMO_IMPORT, getTodayDateString());
  } catch {
    // Senza LocalStorage si rileggerà a ogni apertura: nessun danno
  }
}

export async function caricaSoggiorni() {
  soggiorni = await elencaSoggiorni();
  render();

  if (!importatoOggi()) {
    await aggiorna(true);
  }
}

export function initSoggiorno() {
  if (!lista) return;

  btnAggiorna?.addEventListener('click', () => aggiorna());

  pulsantiVista.forEach(btn => {
    btn.addEventListener('click', () => {
      vista = (btn.getAttribute('data-vista') as Vista) || 'presenti';
      render();
    });
  });

  lista.addEventListener('change', async e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'pagata') return;

    const riga = campo.closest('.sog-row') as HTMLElement | null;
    const uid = riga?.getAttribute('data-uid');
    if (!uid) return;

    const voce = soggiorni.find(s => s.uid === uid);
    if (voce) voce.pagata = campo.checked;

    await segnaPagata(uid, campo.checked);
    render();
  });

  render();
}

export { TARIFFA_A_PERSONA };
