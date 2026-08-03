import { ShiftKey } from '../types';
import {
  TurnoLavoro,
  assegnaTurno,
  elencaTurni,
  inOrdine,
  personeConosciute,
  rimuoviTurno
} from '../services/turni';
import { amministratore, nomeUtente } from '../services/auth';
import {
  formatDateLocalISO,
  getInizioSettimanaString,
  getTodayDateString
} from '../utils/calculations';

/**
 * Calendario dei turni di lavoro.
 *
 * Una settimana per volta, dal lunedì alla domenica, con i due turni di ogni
 * giornata affiancati: si apre e si vede subito chi c'è. La scheda la aprono
 * tutti; i comandi per assegnare compaiono solo a chi amministra, che è anche
 * l'unico che il database lascia scrivere.
 */

const NOMI_TURNO: Record<ShiftKey, string> = {
  mattina: 'Mattina',
  pomeriggio: 'Pomeriggio'
};

const TURNI: ShiftKey[] = ['mattina', 'pomeriggio'];

/** Lunedì della settimana mostrata */
let settimana = getInizioSettimanaString();
let turni: TurnoLavoro[] = [];
let persone: string[] = [];

/** La cella che sta chiedendo un nome, se ce n'è una aperta */
let cellaAperta: { data: string; turno: ShiftKey } | null = null;

const lista = document.getElementById('turni-lista') as HTMLDivElement;
const etichettaSettimana = document.getElementById('turni-settimana') as HTMLSpanElement;
const riassuntoOggi = document.getElementById('turni-oggi') as HTMLParagraphElement;
const conteggio = document.getElementById('turni-conteggio') as HTMLSpanElement;
const avviso = document.getElementById('turni-avviso') as HTMLParagraphElement;
const elencoNomi = document.getElementById('turni-nomi') as HTMLDataListElement;
const btnIndietro = document.getElementById('btn-turni-indietro') as HTMLButtonElement;
const btnAvanti = document.getElementById('btn-turni-avanti') as HTMLButtonElement;
const btnOggi = document.getElementById('btn-turni-oggi') as HTMLButtonElement;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Data spostata di N giorni, in formato YYYY-MM-DD */
function spostaGiorni(data: string, giorni: number): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  const d = new Date(anno, mese - 1, giorno);
  d.setDate(d.getDate() + giorni);

  return formatDateLocalISO(d);
}

function comeData(iso: string): Date {
  const [anno, mese, giorno] = iso.split('-').map(Number);
  return new Date(anno, mese - 1, giorno);
}

function nomeGiorno(iso: string): string {
  const nome = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(comeData(iso));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function giornoEMese(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(comeData(iso));
}

/** Le sette giornate della settimana mostrata */
function giornateSettimana(): string[] {
  return Array.from({ length: 7 }, (_, i) => spostaGiorni(settimana, i));
}

/**
 * "3 – 9 agosto 2026", e con il mese o l'anno a cavallo si scrivono entrambi:
 * una settimana che comincia a giugno e finisce a luglio deve dirlo.
 */
function titoloSettimana(): string {
  const lunedi = comeData(settimana);
  const domenica = comeData(spostaGiorni(settimana, 6));

  const mese = (d: Date) => new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(d);

  if (lunedi.getFullYear() !== domenica.getFullYear()) {
    return `${lunedi.getDate()} ${mese(lunedi)} ${lunedi.getFullYear()} – ` +
      `${domenica.getDate()} ${mese(domenica)} ${domenica.getFullYear()}`;
  }

  if (lunedi.getMonth() !== domenica.getMonth()) {
    return `${lunedi.getDate()} ${mese(lunedi)} – ` +
      `${domenica.getDate()} ${mese(domenica)} ${domenica.getFullYear()}`;
  }

  return `${lunedi.getDate()} – ${domenica.getDate()} ${mese(domenica)} ${domenica.getFullYear()}`;
}

function assegnati(data: string, turno: ShiftKey): TurnoLavoro[] {
  return turni.filter(t => t.data === data && t.turno === turno);
}

function mostraAvviso(testo: string): void {
  if (!avviso) return;

  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
}

/** Chi c'è oggi, sopra al calendario: è la domanda che ci si fa più spesso */
function renderOggi(): void {
  if (!riassuntoOggi) return;

  const oggi = getTodayDateString();

  const parti = TURNI.map(turno => {
    const nomi = assegnati(oggi, turno).map(t => t.persona);
    return `${NOMI_TURNO[turno]}: ${nomi.length > 0 ? nomi.join(', ') : 'nessuno'}`;
  });

  // Il riquadro parla di oggi: fuori dalla settimana in corso non avrebbe
  // niente da dire, perché i turni caricati sono altri
  const dentroLaSettimana = oggi >= settimana && oggi <= spostaGiorni(settimana, 6);

  riassuntoOggi.classList.toggle('is-hidden', !dentroLaSettimana);
  riassuntoOggi.innerHTML = dentroLaSettimana
    ? `<strong>Oggi</strong> · ${escapeHtml(parti.join(' · '))}`
    : '';
}

function chipHtml(t: TurnoLavoro, admin: boolean): string {
  const rimuovi = admin
    ? `<button type="button" class="turni-chip-x" data-action="rimuovi" data-id="${escapeHtml(t.id)}"
         aria-label="Togli ${escapeHtml(t.persona)} dal turno">
         <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
       </button>`
    : '';

  const nota = t.nota
    ? `<span class="turni-chip-nota">${escapeHtml(t.nota)}</span>`
    : '';

  return `
    <span class="turni-chip${admin ? ' con-comando' : ''}">
      <span class="turni-chip-nome">${escapeHtml(t.persona)}</span>
      ${nota}
      ${rimuovi}
    </span>
  `;
}

function formHtml(): string {
  return `
    <div class="turni-form">
      <input type="text" class="todo-add-input" data-campo="persona" list="turni-nomi"
             placeholder="Nome" autocomplete="off" aria-label="Chi lavora" />
      <input type="text" class="todo-add-input" data-campo="nota"
             placeholder="Nota (facoltativa)" autocomplete="off" aria-label="Nota sul turno" />
      <button type="button" class="todo-add-btn" data-action="conferma">Assegna</button>
      <button type="button" class="turni-chiudi" data-action="chiudi">Chiudi</button>
    </div>
  `;
}

function fasciaHtml(data: string, turno: ShiftKey, admin: boolean): string {
  const voci = assegnati(data, turno);
  const aperta = cellaAperta?.data === data && cellaAperta.turno === turno;

  const contenuto = voci.length > 0
    ? voci.map(t => chipHtml(t, admin)).join('')
    : '<span class="turni-vuoto">Nessuno</span>';

  const comando = admin && !aperta
    ? `<button type="button" class="turni-assegna" data-action="apri">
         <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
         Assegna
       </button>`
    : '';

  return `
    <div class="turni-fascia" data-data="${data}" data-turno="${turno}">
      <span class="turni-fascia-nome">${NOMI_TURNO[turno]}</span>
      <div class="turni-persone">${contenuto}</div>
      ${comando}
      ${aperta ? formHtml() : ''}
    </div>
  `;
}

function giornoHtml(data: string, admin: boolean): string {
  const oggi = getTodayDateString();
  const classi = ['turni-giorno'];

  if (data === oggi) classi.push('is-oggi');
  else if (data < oggi) classi.push('is-passato');

  return `
    <div class="${classi.join(' ')}">
      <div class="turni-giorno-testa">
        <span class="turni-giorno-nome">${escapeHtml(nomeGiorno(data))}</span>
        <span class="turni-giorno-data">${escapeHtml(giornoEMese(data))}</span>
      </div>
      <div class="turni-fasce">
        ${TURNI.map(turno => fasciaHtml(data, turno, admin)).join('')}
      </div>
    </div>
  `;
}

function render(): void {
  if (!lista) return;

  const admin = amministratore();

  if (etichettaSettimana) etichettaSettimana.textContent = titoloSettimana();
  if (conteggio) conteggio.textContent = String(turni.length);

  if (btnOggi) btnOggi.disabled = settimana === getInizioSettimanaString();

  if (elencoNomi) {
    elencoNomi.innerHTML = persone
      .map(nome => `<option value="${escapeHtml(nome)}"></option>`)
      .join('');
  }

  lista.innerHTML = giornateSettimana().map(data => giornoHtml(data, admin)).join('');

  renderOggi();

  // Il nome si scrive appena la cella si apre, senza doverci tornare sopra
  if (cellaAperta) {
    const campo = lista.querySelector(
      `.turni-fascia[data-data="${cellaAperta.data}"][data-turno="${cellaAperta.turno}"] [data-campo="persona"]`
    ) as HTMLInputElement | null;

    campo?.focus();
  }
}

async function cambiaSettimana(inizio: string): Promise<void> {
  settimana = inizio;
  cellaAperta = null;
  mostraAvviso('');

  await caricaTurni();
}

/** Legge i due campi della cella aperta e assegna il turno */
async function confermaAssegnazione(fascia: HTMLElement): Promise<void> {
  const data = fascia.getAttribute('data-data') || '';
  const turno = (fascia.getAttribute('data-turno') as ShiftKey) || 'mattina';

  const campoPersona = fascia.querySelector('[data-campo="persona"]') as HTMLInputElement | null;
  const campoNota = fascia.querySelector('[data-campo="nota"]') as HTMLInputElement | null;

  const persona = campoPersona?.value?.trim() || '';
  const nota = campoNota?.value?.trim() || '';

  if (!persona) {
    mostraAvviso('Scrivi chi lavora in questo turno.');
    campoPersona?.focus();
    return;
  }

  mostraAvviso('');

  const esito = await assegnaTurno(data, turno, persona, nota, nomeUtente());

  if (esito.voce) {
    // Riassegnare qualcuno che c'era già ne aggiorna la nota: la riga è una
    // sola. Si riordina come farebbe il database, così il nome appena scritto
    // sta dove starà anche alla prossima apertura.
    turni = inOrdine([...turni.filter(t => t.id !== esito.voce!.id), esito.voce]);
  }

  if (!esito.suCloud) {
    mostraAvviso(
      'Turno salvato solo su questo dispositivo: i colleghi non lo vedono finché non torna la connessione.'
    );
  }

  if (!persone.some(n => n.localeCompare(persona, 'it', { sensitivity: 'base' }) === 0)) {
    persone.unshift(persona);
  }

  // La cella resta aperta: in un turno può esserci più di una persona e
  // riaprirla per ogni nome allungherebbe il lavoro senza motivo
  render();
}

async function togliAssegnazione(id: string): Promise<void> {
  const suCloud = await rimuoviTurno(id);

  turni = turni.filter(t => t.id !== id);

  mostraAvviso(
    suCloud
      ? ''
      : 'Turno tolto solo su questo dispositivo: i colleghi lo vedono ancora finché non torna la connessione.'
  );

  render();
}

/**
 * Ricarica la settimana mostrata. Si chiama a ogni apertura della scheda: i
 * turni li scrive qualcun altro, e una copia vecchia in memoria non serve.
 */
export async function caricaTurni(): Promise<void> {
  if (!lista) return;

  turni = await elencaTurni(settimana, spostaGiorni(settimana, 6));

  // I nomi già usati servono solo a chi assegna
  if (amministratore() && persone.length === 0) {
    persone = await personeConosciute();
  }

  render();
}

export function initTurni(): void {
  if (!lista) return;

  btnIndietro?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, -7)));
  btnAvanti?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, 7)));
  btnOggi?.addEventListener('click', () => cambiaSettimana(getInizioSettimanaString()));

  // Un solo gestore sul contenitore: le giornate si ridisegnano a ogni modifica
  lista.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const fascia = pulsante.closest('.turni-fascia') as HTMLElement | null;
    if (!fascia) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'apri') {
      cellaAperta = {
        data: fascia.getAttribute('data-data') || '',
        turno: (fascia.getAttribute('data-turno') as ShiftKey) || 'mattina'
      };
      mostraAvviso('');
      render();
    } else if (azione === 'chiudi') {
      cellaAperta = null;
      render();
    } else if (azione === 'conferma') {
      confermaAssegnazione(fascia);
    } else if (azione === 'rimuovi') {
      const id = pulsante.getAttribute('data-id');
      if (id) togliAssegnazione(id);
    }
  });

  lista.addEventListener('keydown', e => {
    const campo = (e.target as HTMLElement).closest('[data-campo]');
    if (!campo) return;

    const fascia = campo.closest('.turni-fascia') as HTMLElement | null;
    if (!fascia) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      confermaAssegnazione(fascia);
    } else if (e.key === 'Escape') {
      cellaAperta = null;
      render();
    }
  });

  render();
}
