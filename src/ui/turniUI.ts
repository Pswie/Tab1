import {
  FASCE_GIORNATA,
  FasciaTurno,
  NOMI_FASCIA,
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
 * Ricalca il foglio appeso in negozio: una settimana per volta, le fasce in
 * riga e le sette giornate in colonna. Da telefono la tabella si srotola in
 * una giornata dopo l'altra, perché sette colonne su uno schermo stretto non
 * si leggono.
 *
 * Chi sta usando l'app si riconosce dai propri turni, scritti in grassetto:
 * la domanda vera che si fa aprendo questa scheda è "quando lavoro io".
 */

/** Lunedì della settimana mostrata */
let settimana = getInizioSettimanaString();
let turni: TurnoLavoro[] = [];
let persone: string[] = [];

/** La cella che sta chiedendo un nome, se ce n'è una aperta */
let cellaAperta: { data: string; fascia: FasciaTurno } | null = null;

/** Il riquadro delle ferie è aperto */
let ferieAperte = false;

const griglia = document.getElementById('turni-griglia') as HTMLDivElement;
const etichettaSettimana = document.getElementById('turni-settimana') as HTMLSpanElement;
const fasciaFerie = document.getElementById('turni-ferie') as HTMLDivElement;
const riassuntoOggi = document.getElementById('turni-oggi') as HTMLParagraphElement;
const avviso = document.getElementById('turni-avviso') as HTMLParagraphElement;
const elencoNomi = document.getElementById('turni-nomi') as HTMLDataListElement;
const btnIndietro = document.getElementById('btn-turni-indietro') as HTMLButtonElement;
const btnAvanti = document.getElementById('btn-turni-avanti') as HTMLButtonElement;
const btnOggi = document.getElementById('btn-turni-oggi') as HTMLButtonElement;
const btnFerie = document.getElementById('btn-turni-ferie') as HTMLButtonElement;

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

/** "lun", "mar", ... senza il punto che l'italiano ci metterebbe */
function siglaGiorno(iso: string): string {
  const nome = new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(comeData(iso));
  return (nome.replace('.', '').charAt(0).toUpperCase() + nome.replace('.', '').slice(1));
}

function nomeGiorno(iso: string): string {
  const nome = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(comeData(iso));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function mese(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(d);
}

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

function assegnati(data: string, fascia: FasciaTurno): TurnoLavoro[] {
  return turni.filter(t => t.data === data && t.fascia === fascia);
}

/**
 * Se un nome è di chi sta usando l'app.
 *
 * Sul foglio i turni si firmano col solo nome o col solo cognome, mentre il
 * profilo ha nome e cognome: basta una parola in comune per riconoscersi.
 */
function eIlMio(persona: string): boolean {
  const io = nomeUtente().trim().toLowerCase();
  const chi = persona.trim().toLowerCase();
  if (!io || !chi) return false;

  if (io === chi) return true;

  const mie = io.split(/\s+/).filter(Boolean);
  const sue = chi.split(/\s+/).filter(Boolean);

  return sue.some(p => mie.includes(p));
}

function mostraAvviso(testo: string): void {
  if (!avviso) return;

  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
}

function chipHtml(t: TurnoLavoro, admin: boolean): string {
  const mio = eIlMio(t.persona);

  const rimuovi = admin
    ? `<button type="button" class="turni-chip-x" data-action="rimuovi" data-id="${escapeHtml(t.id)}"
         aria-label="Togli ${escapeHtml(t.persona)}">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
       </button>`
    : '';

  const nota = t.nota ? `<span class="turni-chip-nota">${escapeHtml(t.nota)}</span>` : '';

  return `
    <span class="turni-chip${mio ? ' is-mio' : ''}${admin ? ' con-comando' : ''}">
      <span class="turni-chip-nome">${escapeHtml(t.persona)}</span>
      ${nota}
      ${rimuovi}
    </span>
  `;
}

function formHtml(): string {
  return `
    <div class="turni-form">
      <input type="text" class="turni-campo" data-campo="persona" list="turni-nomi"
             placeholder="Nome" autocomplete="off" aria-label="Chi lavora" />
      <input type="text" class="turni-campo" data-campo="nota"
             placeholder="Nota" autocomplete="off" aria-label="Nota sul turno" />
      <div class="turni-form-azioni">
        <button type="button" class="turni-btn-primario" data-action="conferma">Assegna</button>
        <button type="button" class="turni-btn" data-action="chiudi">Chiudi</button>
      </div>
    </div>
  `;
}

/**
 * Una cella della griglia: la fascia di una giornata.
 *
 * La posizione la decide il CSS Grid e non l'ordine nel documento: così la
 * stessa marcatura, in colonna per giornata, da telefono si legge come un
 * elenco e da schermo largo come la tabella del foglio.
 */
function cellaHtml(data: string, fascia: FasciaTurno, riga: number, colonna: number, admin: boolean): string {
  const voci = assegnati(data, fascia);
  const aperta = cellaAperta?.data === data && cellaAperta.fascia === fascia;
  const oggi = data === getTodayDateString();

  const classi = ['turni-cella', `is-${fascia}`];
  if (aperta) classi.push('is-aperta');
  if (voci.length === 0 && !aperta) classi.push('is-vuota');
  if (oggi) classi.push('is-oggi');
  if (voci.some(t => eIlMio(t.persona))) classi.push('ha-me');

  const comando = admin && !aperta
    ? `<button type="button" class="turni-piu" data-action="apri"
         aria-label="Assegna ${NOMI_FASCIA[fascia]} di ${nomeGiorno(data)} ${comeData(data).getDate()}">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
       </button>`
    : '';

  return `
    <div class="${classi.join(' ')}" data-data="${data}" data-fascia="${fascia}"
         style="grid-row:${riga};grid-column:${colonna}">
      <span class="turni-cella-etichetta">${NOMI_FASCIA[fascia]}</span>
      <div class="turni-persone">
        ${voci.map(t => chipHtml(t, admin)).join('')}
        ${voci.length === 0 && !aperta ? '<span class="turni-nessuno">—</span>' : ''}
      </div>
      ${comando}
      ${aperta ? formHtml() : ''}
    </div>
  `;
}

/** Le ferie della settimana, una riga per persona con il periodo accorpato */
function renderFerie(admin: boolean): void {
  if (!fasciaFerie) return;

  const voci = turni.filter(t => t.fascia === 'ferie');

  const perPersona = new Map<string, TurnoLavoro[]>();
  voci.forEach(v => {
    const elenco = perPersona.get(v.persona) || [];
    elenco.push(v);
    perPersona.set(v.persona, elenco);
  });

  const moduloFerie = admin && ferieAperte
    ? `<div class="turni-form turni-form-ferie">
         <input type="text" class="turni-campo" data-campo="persona" list="turni-nomi"
                placeholder="Nome" autocomplete="off" aria-label="Chi è in ferie" />
         <input type="date" class="turni-campo" data-campo="dal" value="${settimana}"
                aria-label="Dal giorno" />
         <input type="date" class="turni-campo" data-campo="al" value="${spostaGiorni(settimana, 6)}"
                aria-label="Al giorno" />
         <div class="turni-form-azioni">
           <button type="button" class="turni-btn-primario" data-action="conferma-ferie">Segna ferie</button>
           <button type="button" class="turni-btn" data-action="chiudi-ferie">Chiudi</button>
         </div>
       </div>`
    : '';

  if (perPersona.size === 0 && !moduloFerie) {
    fasciaFerie.classList.add('is-hidden');
    fasciaFerie.innerHTML = '';
    return;
  }

  fasciaFerie.classList.remove('is-hidden');

  const righe = Array.from(perPersona.entries()).map(([persona, elenco]) => {
    const ordinate = elenco.map(e => e.data).sort();
    const dal = comeData(ordinate[0]);
    const al = comeData(ordinate[ordinate.length - 1]);

    const periodo = dal.getMonth() === al.getMonth()
      ? `${dal.getDate()}–${al.getDate()} ${mese(al)}`
      : `${dal.getDate()} ${mese(dal)} – ${al.getDate()} ${mese(al)}`;

    const togli = admin
      ? `<button type="button" class="turni-chip-x" data-action="rimuovi-ferie"
           data-persona="${escapeHtml(persona)}" aria-label="Togli le ferie di ${escapeHtml(persona)}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
         </button>`
      : '';

    return `
      <span class="turni-chip is-ferie${eIlMio(persona) ? ' is-mio' : ''}${admin ? ' con-comando' : ''}">
        <span class="turni-chip-nome">${escapeHtml(persona)}</span>
        <span class="turni-chip-nota">${escapeHtml(periodo)}</span>
        ${togli}
      </span>
    `;
  }).join('');

  fasciaFerie.innerHTML = `
    <span class="turni-ferie-titolo">Ferie</span>
    <div class="turni-persone">
      ${righe || '<span class="turni-nessuno">Nessuno in ferie</span>'}
    </div>
    ${moduloFerie}
  `;
}

/** Chi c'è oggi: è la domanda che ci si fa più spesso */
function renderOggi(): void {
  if (!riassuntoOggi) return;

  const oggi = getTodayDateString();
  const dentroLaSettimana = oggi >= settimana && oggi <= spostaGiorni(settimana, 6);

  riassuntoOggi.classList.toggle('is-hidden', !dentroLaSettimana);
  if (!dentroLaSettimana) {
    riassuntoOggi.innerHTML = '';
    return;
  }

  const parti = FASCE_GIORNATA
    .filter(f => f !== 'festa')
    .map(fascia => {
      const nomi = assegnati(oggi, fascia).map(t => t.persona);
      if (nomi.length === 0) return '';

      const scritti = nomi
        .map(n => (eIlMio(n) ? `<strong>${escapeHtml(n)}</strong>` : escapeHtml(n)))
        .join(', ');

      return `<span class="turni-oggi-voce"><span class="turni-oggi-fascia">${NOMI_FASCIA[fascia]}</span> ${scritti}</span>`;
    })
    .filter(Boolean);

  riassuntoOggi.innerHTML = parti.length > 0
    ? `<span class="turni-oggi-titolo">Oggi</span>${parti.join('')}`
    : '<span class="turni-oggi-titolo">Oggi</span><span class="turni-nessuno">Nessun turno assegnato</span>';
}

function render(): void {
  if (!griglia) return;

  const admin = amministratore();

  if (etichettaSettimana) etichettaSettimana.textContent = titoloSettimana();
  if (btnOggi) btnOggi.disabled = settimana === getInizioSettimanaString();
  if (btnFerie) btnFerie.hidden = !admin;

  if (elencoNomi) {
    elencoNomi.innerHTML = persone.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  griglia.classList.toggle('is-admin', admin);

  const giorni = giornateSettimana();
  const oggi = getTodayDateString();

  // Colonna delle etichette: si vede solo quando c'è spazio per la tabella
  const etichette = FASCE_GIORNATA.map((fascia, i) => `
    <span class="turni-fascia-testa" style="grid-row:${i + 2};grid-column:1">${NOMI_FASCIA[fascia]}</span>
  `).join('');

  // Una giornata dopo l'altra: è l'ordine con cui si legge da telefono
  const colonne = giorni.map((data, g) => {
    const d = comeData(data);
    const testa = `
      <div class="turni-giorno-testa${data === oggi ? ' is-oggi' : ''}"
           style="grid-row:1;grid-column:${g + 2}">
        <span class="turni-giorno-sigla">${escapeHtml(siglaGiorno(data))}</span>
        <span class="turni-giorno-numero">${d.getDate()}</span>
      </div>
    `;

    const celle = FASCE_GIORNATA
      .map((fascia, f) => cellaHtml(data, fascia, f + 2, g + 2, admin))
      .join('');

    return testa + celle;
  }).join('');

  griglia.innerHTML = etichette + colonne;

  renderFerie(admin);
  renderOggi();

  // Il nome si scrive appena la cella si apre, senza doverci tornare sopra
  const daMettereAFuoco = cellaAperta
    ? griglia.querySelector<HTMLInputElement>(
        `.turni-cella[data-data="${cellaAperta.data}"][data-fascia="${cellaAperta.fascia}"] [data-campo="persona"]`
      )
    : ferieAperte
      ? fasciaFerie?.querySelector<HTMLInputElement>('[data-campo="persona"]') ?? null
      : null;

  daMettereAFuoco?.focus();
}

async function cambiaSettimana(inizio: string): Promise<void> {
  settimana = inizio;
  cellaAperta = null;
  ferieAperte = false;
  mostraAvviso('');

  await caricaTurni();
}

function ricorda(voci: TurnoLavoro[]): void {
  const ids = new Set(voci.map(v => v.id));
  turni = inOrdine([...turni.filter(t => !ids.has(t.id)), ...voci]);

  voci.forEach(v => {
    if (!persone.some(n => n.localeCompare(v.persona, 'it', { sensitivity: 'base' }) === 0)) {
      persone.unshift(v.persona);
    }
  });
}

/** Legge i campi della cella aperta e assegna la fascia */
async function confermaAssegnazione(cella: HTMLElement): Promise<void> {
  const data = cella.getAttribute('data-data') || '';
  const fascia = (cella.getAttribute('data-fascia') as FasciaTurno) || 'mattina';

  const campoPersona = cella.querySelector('[data-campo="persona"]') as HTMLInputElement | null;
  const campoNota = cella.querySelector('[data-campo="nota"]') as HTMLInputElement | null;

  const persona = campoPersona?.value?.trim() || '';
  const nota = campoNota?.value?.trim() || '';

  if (!persona) {
    mostraAvviso('Scrivi chi lavora in questa fascia.');
    campoPersona?.focus();
    return;
  }

  mostraAvviso('');

  const esito = await assegnaTurno(data, data, fascia, persona, nota, nomeUtente());
  ricorda(esito.voci);

  if (!esito.suCloud) {
    mostraAvviso(
      'Turno salvato solo su questo dispositivo: i colleghi non lo vedono finché non torna la connessione.'
    );
  }

  // La cella resta aperta: in una fascia può esserci più di una persona
  render();
}

async function confermaFerie(): Promise<void> {
  const campoPersona = fasciaFerie?.querySelector('[data-campo="persona"]') as HTMLInputElement | null;
  const campoDal = fasciaFerie?.querySelector('[data-campo="dal"]') as HTMLInputElement | null;
  const campoAl = fasciaFerie?.querySelector('[data-campo="al"]') as HTMLInputElement | null;

  const persona = campoPersona?.value?.trim() || '';
  const dal = campoDal?.value || settimana;
  const al = campoAl?.value || dal;

  if (!persona) {
    mostraAvviso('Scrivi chi va in ferie.');
    campoPersona?.focus();
    return;
  }

  if (al < dal) {
    mostraAvviso('Il giorno di fine ferie viene prima di quello di inizio.');
    return;
  }

  mostraAvviso('');

  const esito = await assegnaTurno(dal, al, 'ferie', persona, '', nomeUtente());
  ricorda(esito.voci);

  if (!esito.suCloud) {
    mostraAvviso(
      'Ferie salvate solo su questo dispositivo: i colleghi non le vedono finché non torna la connessione.'
    );
  }

  ferieAperte = false;

  // Le ferie possono uscire dalla settimana aperta: si rilegge quello che c'è
  await caricaTurni();
}

async function togliAssegnazione(id: string): Promise<void> {
  const suCloud = await rimuoviTurno(id);

  turni = turni.filter(t => t.id !== id);
  mostraAvviso(suCloud ? '' : 'Turno tolto solo su questo dispositivo: i colleghi lo vedono ancora.');

  render();
}

/** Le ferie si tolgono per persona: sono più giorni di fila, non una riga sola */
async function togliFerie(persona: string): Promise<void> {
  const suoi = turni.filter(t => t.fascia === 'ferie' && t.persona === persona);

  let tutteSuCloud = true;
  for (const voce of suoi) {
    const suCloud = await rimuoviTurno(voce.id);
    if (!suCloud) tutteSuCloud = false;
  }

  turni = turni.filter(t => !suoi.some(s => s.id === t.id));
  mostraAvviso(tutteSuCloud ? '' : 'Ferie tolte solo su questo dispositivo.');

  render();
}

/**
 * Ricarica la settimana mostrata. Si chiama a ogni apertura della scheda: i
 * turni li scrive qualcun altro, e una copia vecchia in memoria non serve.
 */
export async function caricaTurni(): Promise<void> {
  if (!griglia) return;

  turni = await elencaTurni(settimana, spostaGiorni(settimana, 6));

  // I nomi già usati servono solo a chi assegna
  if (amministratore() && persone.length === 0) {
    persone = await personeConosciute();
  }

  render();
}

export function initTurni(): void {
  if (!griglia) return;

  btnIndietro?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, -7)));
  btnAvanti?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, 7)));
  btnOggi?.addEventListener('click', () => cambiaSettimana(getInizioSettimanaString()));

  btnFerie?.addEventListener('click', () => {
    ferieAperte = !ferieAperte;
    cellaAperta = null;
    mostraAvviso('');
    render();
  });

  // Un solo gestore sul contenitore: le giornate si ridisegnano a ogni modifica
  griglia.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const cella = pulsante.closest('.turni-cella') as HTMLElement | null;
    if (!cella) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'apri') {
      cellaAperta = {
        data: cella.getAttribute('data-data') || '',
        fascia: (cella.getAttribute('data-fascia') as FasciaTurno) || 'mattina'
      };
      ferieAperte = false;
      mostraAvviso('');
      render();
    } else if (azione === 'chiudi') {
      cellaAperta = null;
      render();
    } else if (azione === 'conferma') {
      confermaAssegnazione(cella);
    } else if (azione === 'rimuovi') {
      const id = pulsante.getAttribute('data-id');
      if (id) togliAssegnazione(id);
    }
  });

  griglia.addEventListener('keydown', e => {
    const campo = (e.target as HTMLElement).closest('[data-campo]');
    const cella = campo?.closest('.turni-cella') as HTMLElement | null;
    if (!cella) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      confermaAssegnazione(cella);
    } else if (e.key === 'Escape') {
      cellaAperta = null;
      render();
    }
  });

  fasciaFerie?.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'conferma-ferie') {
      confermaFerie();
    } else if (azione === 'chiudi-ferie') {
      ferieAperte = false;
      render();
    } else if (azione === 'rimuovi-ferie') {
      const persona = pulsante.getAttribute('data-persona');
      if (persona) togliFerie(persona);
    }
  });

  fasciaFerie?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target as HTMLElement).closest('[data-campo]')) {
      e.preventDefault();
      confermaFerie();
    }
  });

  render();
}
