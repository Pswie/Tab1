import {
  DipendenteTurni,
  FASCE_GIORNATA,
  FasciaTurno,
  NOMI_FASCIA,
  TurnoLavoro,
  annullaTurno,
  elencaDipendentiTurni,
  elencaTurni,
  impostaPeriodoDipendente,
  impostaTurnoDipendente,
  preparaTurniAutomatici
} from '../services/turni';
import { idUtente, nomeUtente, puoGestireTurni } from '../services/auth';
import {
  formatDateLocalISO,
  getInizioSettimanaString,
  getTodayDateString
} from '../utils/calculations';

interface CellaAperta {
  data: string;
  fascia: FasciaTurno;
  profiloId: string | null;
  nota: string;
  chiediSquadra: boolean;
}

/** Lunedì della settimana mostrata. */
let settimana = getInizioSettimanaString();
let turni: TurnoLavoro[] = [];
let dipendenti: DipendenteTurni[] = [];
let dipendentiInCaricamento = false;

/**
 * Il permesso abilita la rotellina, non mette subito il calendario in modifica.
 * Anche l'amministratore e Marianna entrano quindi dalla propria vista normale.
 */
let modalitaGestione = false;
let cellaAperta: CellaAperta | null = null;

let ferieAperte = false;
let profiloFerieId: string | null = null;
let ferieDal = settimana;
let ferieAl = '';

const griglia = document.getElementById('turni-griglia') as HTMLDivElement | null;
const etichettaSettimana = document.getElementById('turni-settimana') as HTMLSpanElement | null;
const fasciaFerie = document.getElementById('turni-ferie') as HTMLDivElement | null;
const riassuntoOggi = document.getElementById('turni-oggi') as HTMLParagraphElement | null;
const avviso = document.getElementById('turni-avviso') as HTMLParagraphElement | null;
const btnIndietro = document.getElementById('btn-turni-indietro') as HTMLButtonElement | null;
const btnAvanti = document.getElementById('btn-turni-avanti') as HTMLButtonElement | null;
const btnOggi = document.getElementById('btn-turni-oggi') as HTMLButtonElement | null;
const btnFerie = document.getElementById('btn-turni-ferie') as HTMLButtonElement | null;
const btnGestione = document.getElementById('btn-turni-gestione') as HTMLButtonElement | null;

function escapeHtml(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Data spostata di N giorni, in formato YYYY-MM-DD. */
function spostaGiorni(data: string, giorni: number): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  const nuova = new Date(anno, mese - 1, giorno);
  nuova.setDate(nuova.getDate() + giorni);
  return formatDateLocalISO(nuova);
}

function comeData(iso: string): Date {
  const [anno, mese, giorno] = iso.split('-').map(Number);
  return new Date(anno, mese - 1, giorno);
}

function siglaGiorno(iso: string): string {
  const nome = new Intl.DateTimeFormat('it-IT', { weekday: 'short' })
    .format(comeData(iso))
    .replace('.', '');
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function nomeGiorno(iso: string): string {
  const nome = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(comeData(iso));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function nomeMese(data: Date): string {
  return new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(data);
}

function giornateSettimana(): string[] {
  return Array.from({ length: 7 }, (_, indice) => spostaGiorni(settimana, indice));
}

function titoloSettimana(): string {
  const lunedi = comeData(settimana);
  const domenica = comeData(spostaGiorni(settimana, 6));

  if (lunedi.getFullYear() !== domenica.getFullYear()) {
    return `${lunedi.getDate()} ${nomeMese(lunedi)} ${lunedi.getFullYear()} – ` +
      `${domenica.getDate()} ${nomeMese(domenica)} ${domenica.getFullYear()}`;
  }

  if (lunedi.getMonth() !== domenica.getMonth()) {
    return `${lunedi.getDate()} ${nomeMese(lunedi)} – ` +
      `${domenica.getDate()} ${nomeMese(domenica)} ${domenica.getFullYear()}`;
  }

  return `${lunedi.getDate()} – ${domenica.getDate()} ${nomeMese(domenica)} ${domenica.getFullYear()}`;
}

function assegnati(data: string, fascia: FasciaTurno): TurnoLavoro[] {
  return turni.filter(turno => turno.data === data && turno.fascia === fascia);
}

function dipendentePerId(id: string | null): DipendenteTurni | null {
  if (!id) return null;
  return dipendenti.find(dipendente => dipendente.id === id) ?? null;
}

function eIlMio(persona: string, profiloId: string | null = null): boolean {
  const mioId = idUtente();
  if (mioId && profiloId) return mioId === profiloId;

  const io = nomeUtente().trim().toLowerCase();
  const chi = persona.trim().toLowerCase();
  if (!io || !chi) return false;
  if (io === chi) return true;

  const mieParole = io.split(/\s+/).filter(Boolean);
  const sueParole = chi.split(/\s+/).filter(Boolean);
  return sueParole.some(parola => mieParole.includes(parola));
}

function mostraAvviso(testo: string): void {
  if (!avviso) return;
  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
}

function gestioneAttiva(): boolean {
  return modalitaGestione && puoGestireTurni();
}

function chipHtml(turno: TurnoLavoro, puoModificare: boolean): string {
  const mio = eIlMio(turno.persona, turno.profiloId);
  const rimuovi = puoModificare
    ? `<button type="button" class="turni-chip-x" data-action="rimuovi" data-id="${escapeHtml(turno.id)}"
         aria-label="Togli ${escapeHtml(turno.persona)}">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
       </button>`
    : '';
  const nota = turno.nota
    ? `<span class="turni-chip-nota">${escapeHtml(turno.nota)}</span>`
    : '';

  return `
    <span class="turni-chip${mio ? ' is-mio' : ''}${puoModificare ? ' con-comando' : ''}">
      <span class="turni-chip-nome">${escapeHtml(turno.persona)}</span>
      ${nota}
      ${rimuovi}
    </span>
  `;
}

function pickerDipendentiHtml(
  azione: 'scegli-persona' | 'scegli-persona-ferie',
  selezionatoId: string | null,
  giaAssegnati: Set<string>,
  etichetta: string
): string {
  if (dipendentiInCaricamento) {
    return '<span class="turni-nessuno">Caricamento dipendenti…</span>';
  }

  if (dipendenti.length === 0) {
    return '<span class="turni-nessuno">Nessun dipendente registrato disponibile.</span>';
  }

  const pulsanti = dipendenti.map(dipendente => {
    const selezionato = dipendente.id === selezionatoId;
    const giaPresente = giaAssegnati.has(dipendente.id);

    return `
      <button type="button"
              class="turni-dipendente${selezionato ? ' is-selected' : ''}"
              data-action="${azione}" data-profilo-id="${escapeHtml(dipendente.id)}"
              aria-pressed="${selezionato}"${giaPresente ? ' disabled' : ''}>
        ${escapeHtml(dipendente.nome)}
      </button>
    `;
  }).join('');

  return `<div class="turni-dipendenti" role="group" aria-label="${escapeHtml(etichetta)}">${pulsanti}</div>`;
}

function formHtml(data: string, fascia: FasciaTurno): string {
  const stato = cellaAperta?.data === data && cellaAperta.fascia === fascia
    ? cellaAperta
    : null;
  const selezionato = dipendentePerId(stato?.profiloId ?? null);
  const giaAssegnati = new Set(
    assegnati(data, fascia)
      .map(turno => turno.profiloId)
      .filter((id): id is string => Boolean(id))
  );

  const sceltaSquadra = stato?.chiediSquadra && selezionato
    ? `
      <div class="turni-scelta-stabile" role="group" aria-label="Come aggiungere ${escapeHtml(selezionato.nome)}">
        <p>
          <strong>${escapeHtml(selezionato.nome)}</strong> non ha ancora una squadra.
          Se la aggiungi alla squadra seguirà tutto il gruppo quando mattina e pomeriggio
          si alternano ogni settimana.
        </p>
        <div class="turni-form-azioni">
          <button type="button" class="turni-btn" data-action="conferma-solo-giorno">
            Solo questo giorno
          </button>
          <button type="button" class="turni-btn-primario" data-action="conferma-squadra">
            Aggiungi alla squadra
          </button>
          <button type="button" class="turni-btn" data-action="annulla-scelta-squadra">Indietro</button>
        </div>
      </div>
    `
    : `
      ${pickerDipendentiHtml('scegli-persona', stato?.profiloId ?? null, giaAssegnati, 'Scegli chi lavora')}
      <input type="text" class="turni-campo" data-campo="nota"
             value="${escapeHtml(stato?.nota ?? '')}" placeholder="Nota (facoltativa)"
             autocomplete="off" aria-label="Nota sul turno" />
      <div class="turni-form-azioni">
        <button type="button" class="turni-btn-primario" data-action="conferma"
                ${selezionato ? '' : 'disabled'}>Assegna</button>
        <button type="button" class="turni-btn" data-action="chiudi">Chiudi</button>
      </div>
    `;

  return `<div class="turni-form">${sceltaSquadra}</div>`;
}

function cellaHtml(
  data: string,
  fascia: FasciaTurno,
  riga: number,
  colonna: number,
  puoModificare: boolean
): string {
  const voci = assegnati(data, fascia);
  const aperta = cellaAperta?.data === data && cellaAperta.fascia === fascia;
  const oggi = data === getTodayDateString();

  const classi = ['turni-cella', `is-${fascia}`];
  if (aperta) classi.push('is-aperta');
  if (voci.length === 0 && !aperta) classi.push('is-vuota');
  if (oggi) classi.push('is-oggi');
  if (voci.some(turno => eIlMio(turno.persona, turno.profiloId))) classi.push('ha-me');

  const comando = puoModificare && !aperta
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
        ${voci.map(turno => chipHtml(turno, puoModificare)).join('')}
        ${voci.length === 0 && !aperta ? '<span class="turni-nessuno">—</span>' : ''}
      </div>
      ${comando}
      ${aperta ? formHtml(data, fascia) : ''}
    </div>
  `;
}

function renderFerie(puoModificare: boolean): void {
  if (!fasciaFerie) return;

  const gruppi = new Map<string, { persona: string; profiloId: string | null; voci: TurnoLavoro[] }>();
  turni.filter(turno => turno.fascia === 'ferie').forEach(turno => {
    const chiave = turno.profiloId || `nome:${turno.persona.toLocaleLowerCase('it')}`;
    const gruppo = gruppi.get(chiave) ?? {
      persona: turno.persona,
      profiloId: turno.profiloId,
      voci: []
    };
    gruppo.voci.push(turno);
    gruppi.set(chiave, gruppo);
  });

  const moduloFerie = puoModificare && ferieAperte
    ? `<div class="turni-form turni-form-ferie">
         ${pickerDipendentiHtml('scegli-persona-ferie', profiloFerieId, new Set<string>(), 'Scegli chi è in ferie')}
         <input type="date" class="turni-campo" data-campo="dal" value="${ferieDal}"
                aria-label="Dal giorno" />
         <input type="date" class="turni-campo" data-campo="al" value="${ferieAl}"
                aria-label="Al giorno" />
         <div class="turni-form-azioni">
           <button type="button" class="turni-btn-primario" data-action="conferma-ferie"
                   ${profiloFerieId ? '' : 'disabled'}>Segna ferie</button>
           <button type="button" class="turni-btn" data-action="chiudi-ferie">Chiudi</button>
         </div>
       </div>`
    : '';

  if (gruppi.size === 0 && !moduloFerie) {
    fasciaFerie.classList.add('is-hidden');
    fasciaFerie.innerHTML = '';
    return;
  }

  fasciaFerie.classList.remove('is-hidden');

  const righe = Array.from(gruppi.values()).map(gruppo => {
    const ordinate = gruppo.voci.map(voce => voce.data).sort();
    const dal = comeData(ordinate[0]);
    const al = comeData(ordinate[ordinate.length - 1]);
    const periodo = dal.getMonth() === al.getMonth()
      ? `${dal.getDate()}–${al.getDate()} ${nomeMese(al)}`
      : `${dal.getDate()} ${nomeMese(dal)} – ${al.getDate()} ${nomeMese(al)}`;
    const togli = puoModificare
      ? `<button type="button" class="turni-chip-x" data-action="rimuovi-ferie"
           data-profilo-id="${escapeHtml(gruppo.profiloId ?? '')}"
           data-persona="${escapeHtml(gruppo.persona)}"
           aria-label="Togli le ferie di ${escapeHtml(gruppo.persona)}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
         </button>`
      : '';

    return `
      <span class="turni-chip is-ferie${eIlMio(gruppo.persona, gruppo.profiloId) ? ' is-mio' : ''}${puoModificare ? ' con-comando' : ''}">
        <span class="turni-chip-nome">${escapeHtml(gruppo.persona)}</span>
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
    .filter(fascia => fascia !== 'festa')
    .map(fascia => {
      const voci = assegnati(oggi, fascia);
      if (voci.length === 0) return '';

      const scritti = voci
        .map(turno => (eIlMio(turno.persona, turno.profiloId)
          ? `<strong>${escapeHtml(turno.persona)}</strong>`
          : escapeHtml(turno.persona)))
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

  const autorizzato = puoGestireTurni();
  if (!autorizzato) modalitaGestione = false;
  const puoModificare = autorizzato && modalitaGestione;

  if (etichettaSettimana) etichettaSettimana.textContent = titoloSettimana();
  if (btnOggi) btnOggi.disabled = settimana === getInizioSettimanaString();
  if (btnFerie) btnFerie.hidden = !puoModificare;

  if (btnGestione) {
    btnGestione.hidden = !autorizzato;
    btnGestione.setAttribute('aria-pressed', String(puoModificare));
    btnGestione.classList.toggle('is-active', puoModificare);
    btnGestione.title = puoModificare ? 'Chiudi gestione turni' : 'Gestisci i turni';
    btnGestione.setAttribute(
      'aria-label',
      puoModificare ? 'Chiudi i comandi di gestione turni' : 'Mostra i comandi di gestione turni'
    );
  }

  griglia.classList.toggle('is-admin', puoModificare);
  griglia.classList.toggle('is-gestione', puoModificare);

  const giorni = giornateSettimana();
  const oggi = getTodayDateString();
  const etichette = FASCE_GIORNATA.map((fascia, indice) => `
    <span class="turni-fascia-testa" style="grid-row:${indice + 2};grid-column:1">${NOMI_FASCIA[fascia]}</span>
  `).join('');

  const colonne = giorni.map((data, indiceGiorno) => {
    const giorno = comeData(data);
    const testa = `
      <div class="turni-giorno-testa${data === oggi ? ' is-oggi' : ''}"
           style="grid-row:1;grid-column:${indiceGiorno + 2}">
        <span class="turni-giorno-sigla">${escapeHtml(siglaGiorno(data))}</span>
        <span class="turni-giorno-numero">${giorno.getDate()}</span>
      </div>
    `;
    const celle = FASCE_GIORNATA
      .map((fascia, indiceFascia) => cellaHtml(
        data,
        fascia,
        indiceFascia + 2,
        indiceGiorno + 2,
        puoModificare
      ))
      .join('');

    return testa + celle;
  }).join('');

  griglia.innerHTML = etichette + colonne;
  renderFerie(puoModificare);
  renderOggi();

  if (cellaAperta) {
    const cella = griglia.querySelector<HTMLElement>(
      `.turni-cella[data-data="${cellaAperta.data}"][data-fascia="${cellaAperta.fascia}"]`
    );
    const daMettereAFuoco = cellaAperta.chiediSquadra
      ? cella?.querySelector<HTMLButtonElement>('[data-action="conferma-solo-giorno"]')
      : cellaAperta.profiloId
        ? cella?.querySelector<HTMLInputElement>('[data-campo="nota"]')
        : cella?.querySelector<HTMLButtonElement>('[data-action="scegli-persona"]:not(:disabled)');
    daMettereAFuoco?.focus();
  } else if (ferieAperte && fasciaFerie) {
    const daMettereAFuoco = profiloFerieId
      ? fasciaFerie.querySelector<HTMLInputElement>('[data-campo="dal"]')
      : fasciaFerie.querySelector<HTMLButtonElement>('[data-action="scegli-persona-ferie"]');
    daMettereAFuoco?.focus();
  }
}

async function caricaDipendenti(): Promise<void> {
  dipendentiInCaricamento = true;
  render();
  dipendenti = await elencaDipendentiTurni();
  dipendentiInCaricamento = false;
  render();
}

async function cambiaSettimana(inizio: string): Promise<void> {
  settimana = inizio;
  cellaAperta = null;
  ferieAperte = false;
  profiloFerieId = null;
  ferieDal = settimana;
  ferieAl = spostaGiorni(settimana, 6);
  mostraAvviso('');
  await caricaTurni();
}

function sincronizzaNota(cella: HTMLElement): void {
  if (!cellaAperta) return;
  const campoNota = cella.querySelector<HTMLInputElement>('[data-campo="nota"]');
  if (campoNota) cellaAperta.nota = campoNota.value.trim();
}

async function salvaAssegnazione(cella: HTMLElement, rendiStabile: boolean): Promise<void> {
  if (!gestioneAttiva() || !cellaAperta) return;

  sincronizzaNota(cella);
  const dipendente = dipendentePerId(cellaAperta.profiloId);
  if (!dipendente) {
    mostraAvviso('Scegli una persona dall’elenco dei dipendenti registrati.');
    return;
  }

  const { data, fascia, nota } = cellaAperta;
  mostraAvviso('');
  const esito = await impostaTurnoDipendente(
    data,
    fascia,
    dipendente,
    nota,
    rendiStabile,
    nomeUtente()
  );

  cellaAperta = {
    data,
    fascia,
    profiloId: null,
    nota: '',
    chiediSquadra: false
  };

  if (rendiStabile) {
    dipendenti = await elencaDipendentiTurni();
  }

  await caricaTurni();

  if (!esito.suCloud) {
    mostraAvviso(
      'Turno salvato solo su questo dispositivo: i colleghi non lo vedono finché non torna la connessione.'
    );
  }
}

async function confermaAssegnazione(cella: HTMLElement): Promise<void> {
  if (!gestioneAttiva() || !cellaAperta) return;

  sincronizzaNota(cella);
  const dipendente = dipendentePerId(cellaAperta.profiloId);
  if (!dipendente) {
    mostraAvviso('Scegli una persona dall’elenco dei dipendenti registrati.');
    return;
  }

  const fasciaConSquadra = cellaAperta.fascia === 'mattina' || cellaAperta.fascia === 'pomeriggio';
  if (fasciaConSquadra && dipendente.squadra === null) {
    cellaAperta.chiediSquadra = true;
    mostraAvviso('');
    render();
    return;
  }

  await salvaAssegnazione(cella, false);
}

async function confermaFerie(): Promise<void> {
  if (!gestioneAttiva()) return;

  const dipendente = dipendentePerId(profiloFerieId);
  if (!dipendente) {
    mostraAvviso('Scegli chi va in ferie dall’elenco dei dipendenti registrati.');
    return;
  }

  if (ferieAl < ferieDal) {
    mostraAvviso('Il giorno di fine ferie viene prima di quello di inizio.');
    return;
  }

  mostraAvviso('');
  const esito = await impostaPeriodoDipendente(
    ferieDal,
    ferieAl,
    'ferie',
    dipendente,
    '',
    nomeUtente()
  );

  ferieAperte = false;
  profiloFerieId = null;
  await caricaTurni();

  if (!esito.suCloud) {
    mostraAvviso(
      'Ferie salvate solo su questo dispositivo: i colleghi non le vedono finché non torna la connessione.'
    );
  }
}

async function togliAssegnazione(id: string): Promise<void> {
  if (!gestioneAttiva()) return;

  const suCloud = await annullaTurno(id);
  await caricaTurni();
  mostraAvviso(suCloud ? '' : 'Turno tolto solo su questo dispositivo: i colleghi lo vedono ancora.');
}

async function togliFerie(profiloId: string, persona: string): Promise<void> {
  if (!gestioneAttiva()) return;

  const sue = turni.filter(turno => {
    if (turno.fascia !== 'ferie') return false;
    return profiloId ? turno.profiloId === profiloId : turno.persona === persona;
  });

  let tutteSuCloud = true;
  for (const voce of sue) {
    const suCloud = await annullaTurno(voce.id);
    if (!suCloud) tutteSuCloud = false;
  }

  await caricaTurni();
  mostraAvviso(tutteSuCloud ? '' : 'Ferie tolte solo su questo dispositivo.');
}

/** Ricarica la settimana mostrata senza cambiare la modalità scelta. */
export async function caricaTurni(): Promise<void> {
  if (!griglia) return;
  if (puoGestireTurni()) await preparaTurniAutomatici();
  turni = await elencaTurni(settimana, spostaGiorni(settimana, 6));
  render();
}

export function initTurni(): void {
  if (!griglia) return;

  ferieAl = spostaGiorni(settimana, 6);

  btnIndietro?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, -7)));
  btnAvanti?.addEventListener('click', () => cambiaSettimana(spostaGiorni(settimana, 7)));
  btnOggi?.addEventListener('click', () => cambiaSettimana(getInizioSettimanaString()));

  btnGestione?.addEventListener('click', async () => {
    if (!puoGestireTurni()) return;

    modalitaGestione = !modalitaGestione;
    cellaAperta = null;
    ferieAperte = false;
    profiloFerieId = null;
    mostraAvviso('');
    render();

    if (modalitaGestione) await caricaDipendenti();
  });

  btnFerie?.addEventListener('click', () => {
    if (!gestioneAttiva()) return;

    ferieAperte = !ferieAperte;
    cellaAperta = null;
    profiloFerieId = null;
    ferieDal = settimana;
    ferieAl = spostaGiorni(settimana, 6);
    mostraAvviso('');
    render();
  });

  griglia.addEventListener('click', evento => {
    const pulsante = (evento.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!pulsante) return;

    const cella = pulsante.closest<HTMLElement>('.turni-cella');
    if (!cella) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'apri' && gestioneAttiva()) {
      cellaAperta = {
        data: cella.getAttribute('data-data') || '',
        fascia: (cella.getAttribute('data-fascia') as FasciaTurno) || 'mattina',
        profiloId: null,
        nota: '',
        chiediSquadra: false
      };
      ferieAperte = false;
      mostraAvviso('');
      render();
    } else if (azione === 'scegli-persona' && cellaAperta && gestioneAttiva()) {
      cellaAperta.profiloId = pulsante.getAttribute('data-profilo-id');
      cellaAperta.chiediSquadra = false;
      render();
    } else if (azione === 'chiudi') {
      cellaAperta = null;
      render();
    } else if (azione === 'conferma') {
      void confermaAssegnazione(cella);
    } else if (azione === 'conferma-solo-giorno') {
      void salvaAssegnazione(cella, false);
    } else if (azione === 'conferma-squadra') {
      void salvaAssegnazione(cella, true);
    } else if (azione === 'annulla-scelta-squadra' && cellaAperta) {
      cellaAperta.chiediSquadra = false;
      render();
    } else if (azione === 'rimuovi') {
      const id = pulsante.getAttribute('data-id');
      if (id) void togliAssegnazione(id);
    }
  });

  griglia.addEventListener('input', evento => {
    const campo = (evento.target as HTMLElement).closest<HTMLInputElement>('[data-campo="nota"]');
    if (campo && cellaAperta) cellaAperta.nota = campo.value;
  });

  griglia.addEventListener('keydown', evento => {
    const cella = (evento.target as HTMLElement).closest<HTMLElement>('.turni-cella');
    if (!cella) return;

    if (evento.key === 'Enter' && (evento.target as HTMLElement).matches('[data-campo="nota"]')) {
      evento.preventDefault();
      void confermaAssegnazione(cella);
    } else if (evento.key === 'Escape') {
      cellaAperta = null;
      render();
    }
  });

  fasciaFerie?.addEventListener('click', evento => {
    const pulsante = (evento.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!pulsante) return;

    const azione = pulsante.getAttribute('data-action');
    if (azione === 'scegli-persona-ferie' && gestioneAttiva()) {
      profiloFerieId = pulsante.getAttribute('data-profilo-id');
      render();
    } else if (azione === 'conferma-ferie') {
      void confermaFerie();
    } else if (azione === 'chiudi-ferie') {
      ferieAperte = false;
      profiloFerieId = null;
      render();
    } else if (azione === 'rimuovi-ferie') {
      const profiloId = pulsante.getAttribute('data-profilo-id') || '';
      const persona = pulsante.getAttribute('data-persona') || '';
      void togliFerie(profiloId, persona);
    }
  });

  fasciaFerie?.addEventListener('input', evento => {
    const campo = (evento.target as HTMLElement).closest<HTMLInputElement>('[data-campo]');
    if (!campo) return;
    if (campo.getAttribute('data-campo') === 'dal') ferieDal = campo.value;
    if (campo.getAttribute('data-campo') === 'al') ferieAl = campo.value;
  });

  fasciaFerie?.addEventListener('keydown', evento => {
    if (evento.key === 'Enter' && (evento.target as HTMLElement).closest('[data-campo]')) {
      evento.preventDefault();
      void confermaFerie();
    }
  });

  render();
}
