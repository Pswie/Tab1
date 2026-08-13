import { amministratore } from '../services/auth';
import { elencaStatoNotificheDipendenti } from '../services/push';
import {
  GiornoOrdine,
  OrdineSettimanale,
  aggiungiOrdine,
  elencaOrdini,
  impostaOrdineAttivo,
  modificaOrdine
} from '../services/ordini';

const GIORNI: GiornoOrdine[] = [1, 2, 3, 4, 5, 6, 7];
const NOMI_GIORNI: Record<GiornoOrdine, string> = {
  1: 'Lunedì',
  2: 'Martedì',
  3: 'Mercoledì',
  4: 'Giovedì',
  5: 'Venerdì',
  6: 'Sabato',
  7: 'Domenica'
};

let ordini: OrdineSettimanale[] = [];
let modalitaGestione = false;
let idInModifica: string | null = null;
let salvataggio = false;
let inizializzato = false;
let versioneCaricamento = 0;
let timerAvviso: number | null = null;
let statoNotificheHtml = '';

const pannello = document.getElementById('tab-ordini') as HTMLDivElement | null;
const lista = document.getElementById('ordini-lista') as HTMLDivElement | null;
const avviso = document.getElementById('ordini-avviso') as HTMLParagraphElement | null;
const btnGestione = document.getElementById('btn-ordini-gestione') as HTMLButtonElement | null;
const gestione = document.getElementById('ordini-gestione') as HTMLFormElement | null;
const campoVoce = document.getElementById('ordini-voce') as HTMLInputElement | null;
const campoGiorno = document.getElementById('ordini-giorno') as HTMLDivElement | null;
const btnSalva = document.getElementById('btn-ordini-salva') as HTMLButtonElement | null;
const btnAnnulla = document.getElementById('btn-ordini-annulla') as HTMLButtonElement | null;

function escapeHtml(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Giorno corrente nel fuso del negozio, anche se il telefono ha un altro fuso. */
function giornoCorrente(): GiornoOrdine {
  const sigla = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Rome'
  }).format(new Date());

  const giorni: Record<string, GiornoOrdine> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  };

  return giorni[sigla] || 1;
}

function erroreLeggibile(errore: unknown): string {
  if (errore && typeof errore === 'object' && 'message' in errore) {
    const messaggio = String((errore as { message: unknown }).message || '');
    if (messaggio) return messaggio;
  }
  return 'Operazione non riuscita. Controlla la connessione e riprova.';
}

function pulsantiGiorno(): HTMLButtonElement[] {
  return campoGiorno
    ? Array.from(campoGiorno.querySelectorAll<HTMLButtonElement>('[data-giorno]'))
    : [];
}

function giornoSelezionato(): GiornoOrdine {
  const selezionato = campoGiorno?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
  const numero = Number(selezionato?.dataset.giorno);
  return numero >= 1 && numero <= 7 ? numero as GiornoOrdine : 1;
}

function impostaGiorno(giorno: GiornoOrdine, portaFuoco = false): void {
  pulsantiGiorno().forEach(pulsante => {
    const selezionato = Number(pulsante.dataset.giorno) === giorno;
    pulsante.classList.toggle('is-selected', selezionato);
    pulsante.setAttribute('aria-checked', String(selezionato));
    pulsante.tabIndex = selezionato ? 0 : -1;
    if (selezionato && portaFuoco) pulsante.focus();
  });
}

function mostraAvviso(testo: string, tipo: 'errore' | 'successo' | 'nota' = 'errore'): void {
  if (!avviso) return;

  if (timerAvviso !== null) {
    window.clearTimeout(timerAvviso);
    timerAvviso = null;
  }

  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
  avviso.classList.toggle('is-successo', tipo === 'successo');
  avviso.classList.toggle('is-nota', tipo === 'nota');

  if (testo && tipo === 'successo') {
    timerAvviso = window.setTimeout(() => mostraAvviso(''), 4200);
  }
}

function iconaCampanella(): string {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
      <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
    </svg>
  `;
}

function azioniHtml(voce: OrdineSettimanale): string {
  if (!modalitaGestione || !amministratore()) return '';

  return `
    <div class="ordine-azioni">
      <button type="button" class="todo-icon-btn" data-action="modifica-ordine"
              aria-label="Modifica ${escapeHtml(voce.voce)}"${salvataggio ? ' disabled' : ''}>
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
        </svg>
      </button>
      <button type="button" class="todo-icon-btn is-danger" data-action="disattiva-ordine"
              aria-label="Disattiva ${escapeHtml(voce.voce)}"${salvataggio ? ' disabled' : ''}>
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function rigaHtml(voce: OrdineSettimanale): string {
  return `
    <div class="ordine-riga" data-ordine-id="${escapeHtml(voce.id)}">
      <span class="ordine-segno" aria-hidden="true"></span>
      <span class="ordine-nome">${escapeHtml(voce.voce)}</span>
      ${azioniHtml(voce)}
    </div>
  `;
}

function gruppoGiornoHtml(giorno: GiornoOrdine, voci: OrdineSettimanale[]): string {
  const oggi = giorno === giornoCorrente();
  const etichetta = NOMI_GIORNI[giorno];

  return `
    <section class="ordini-giorno${oggi ? ' is-oggi' : ''}" aria-label="Ordini di ${escapeHtml(etichetta)}">
      <header class="ordini-giorno-testa">
        <span class="ordini-giorno-titolo">
          <strong>${escapeHtml(etichetta)}</strong>
          <small>${oggi ? 'Oggi' : `Ogni ${etichetta.toLocaleLowerCase('it-IT')}`}</small>
        </span>
        <span class="ordini-orario" title="Orario della notifica">
          ${iconaCampanella()}
          <time datetime="07:00">07:00</time>
        </span>
      </header>
      <div class="ordini-righe">${voci.map(rigaHtml).join('')}</div>
    </section>
  `;
}

function disattivatiHtml(): string {
  if (!modalitaGestione || !amministratore()) return '';

  const disattivati = ordini.filter(voce => !voce.attivo);
  if (disattivati.length === 0) return '';

  return `
    <section class="ordini-disattivati" aria-labelledby="ordini-disattivati-titolo">
      <h3 id="ordini-disattivati-titolo">Ordini disattivati</h3>
      <p>Non generano notifiche. Puoi rimetterli nel loro giorno senza ricrearli.</p>
      <div class="ordini-disattivati-lista">
        ${disattivati.map(voce => `
          <div class="ordine-disattivato" data-ordine-id="${escapeHtml(voce.id)}">
            <span>
              <strong>${escapeHtml(voce.voce)}</strong>
              <small>${escapeHtml(NOMI_GIORNI[voce.giornoSettimana])} · 07:00</small>
            </span>
            <button type="button" class="rub-btn-testo" data-action="riattiva-ordine"
                    ${salvataggio ? 'disabled' : ''}>Riattiva</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function pannelloNotificheHtml(): string {
  if (!modalitaGestione || !amministratore()) return '';
  return statoNotificheHtml;
}

function render(): void {
  if (!lista) return;

  const attivi = ordini.filter(voce => voce.attivo);
  const gruppi = GIORNI
    .map(giorno => [giorno, attivi.filter(voce => voce.giornoSettimana === giorno)] as const)
    .filter(([, voci]) => voci.length > 0)
    .map(([giorno, voci]) => gruppoGiornoHtml(giorno, voci))
    .join('');

  lista.innerHTML = gruppi || `
    <div class="ordini-vuoto">
      ${iconaCampanella()}
      <p>Nessun ordine settimanale attivo.</p>
      ${modalitaGestione ? '<small>Usa il modulo qui sopra per aggiungere il primo.</small>' : ''}
    </div>
  `;

  lista.insertAdjacentHTML('beforeend', pannelloNotificheHtml());
  lista.insertAdjacentHTML('beforeend', disattivatiHtml());
  lista.setAttribute('aria-busy', String(salvataggio));
  pannello?.classList.toggle('is-salvataggio', salvataggio);

  if (btnGestione) {
    const puoGestire = amministratore();
    btnGestione.hidden = !puoGestire;
    btnGestione.classList.toggle('is-active', modalitaGestione);
    btnGestione.setAttribute('aria-pressed', String(modalitaGestione));
    btnGestione.title = modalitaGestione ? 'Chiudi gestione ordini' : 'Gestisci gli ordini';
    btnGestione.setAttribute(
      'aria-label',
      modalitaGestione ? 'Chiudi i comandi di gestione ordini' : 'Apri i comandi di gestione ordini'
    );
  }

  if (gestione) gestione.hidden = !modalitaGestione;
}

function azzeraModulo(): void {
  idInModifica = null;
  if (campoVoce) campoVoce.value = '';
  impostaGiorno(1);
  if (btnSalva) btnSalva.textContent = 'Aggiungi ordine';
  if (btnAnnulla) btnAnnulla.hidden = true;
}

function impostaSalvataggio(attivo: boolean): void {
  salvataggio = attivo;
  [campoVoce, btnSalva, btnAnnulla].forEach(controllo => {
    if (controllo) controllo.disabled = attivo;
  });
  pulsantiGiorno().forEach(pulsante => { pulsante.disabled = attivo; });
  render();
}

function prossimaPosizione(giorno: GiornoOrdine): number {
  const posizioni = ordini
    .filter(voce => voce.giornoSettimana === giorno)
    .map(voce => voce.ordine);
  return Math.min(32000, Math.max(0, ...posizioni) + 10);
}

async function salva(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  if (!amministratore() || salvataggio) return;

  const voce = campoVoce?.value.trim() || '';
  const numeroGiorno = giornoSelezionato();
  if (!voce) {
    mostraAvviso('Scrivi cosa bisogna ordinare.');
    campoVoce?.focus();
    return;
  }
  if (numeroGiorno < 1 || numeroGiorno > 7) {
    mostraAvviso('Scegli un giorno della settimana.');
    impostaGiorno(1, true);
    return;
  }

  const giorno = numeroGiorno as GiornoOrdine;
  impostaSalvataggio(true);

  try {
    if (idInModifica) {
      await modificaOrdine(idInModifica, voce, giorno);
      mostraAvviso('Ordine aggiornato. La prossima notifica seguirà il nuovo giorno.', 'successo');
    } else {
      await aggiungiOrdine(voce, giorno, prossimaPosizione(giorno));
      mostraAvviso('Ordine aggiunto. Il promemoria arriverà alle 07:00.', 'successo');
    }

    azzeraModulo();
    await caricaOrdini();
  } catch (errore) {
    mostraAvviso(erroreLeggibile(errore));
  } finally {
    impostaSalvataggio(false);
  }
}

function avviaModifica(voce: OrdineSettimanale): void {
  if (!amministratore() || salvataggio) return;

  idInModifica = voce.id;
  if (campoVoce) campoVoce.value = voce.voce;
  impostaGiorno(voce.giornoSettimana);
  if (btnSalva) btnSalva.textContent = 'Salva modifica';
  if (btnAnnulla) btnAnnulla.hidden = false;
  mostraAvviso('');
  campoVoce?.focus();
  campoVoce?.setSelectionRange(campoVoce.value.length, campoVoce.value.length);
}

async function cambiaStato(voce: OrdineSettimanale, attivo: boolean): Promise<void> {
  if (!amministratore() || salvataggio) return;

  if (!attivo && !window.confirm(
    `Disattivare “${voce.voce}”? Non partiranno più notifiche finché non lo riattivi.`
  )) return;

  impostaSalvataggio(true);
  try {
    await impostaOrdineAttivo(voce.id, attivo);
    if (idInModifica === voce.id) azzeraModulo();
    await caricaOrdini();
    mostraAvviso(
      attivo ? 'Ordine riattivato.' : 'Ordine disattivato. Lo trovi in fondo alla gestione.',
      'successo'
    );
  } catch (errore) {
    mostraAvviso(erroreLeggibile(errore));
  } finally {
    impostaSalvataggio(false);
  }
}

/** Rilegge il piano condiviso ogni volta che si apre la scheda. */
export async function caricaOrdini(): Promise<void> {
  if (!lista) return;

  const versione = ++versioneCaricamento;
  pannello?.classList.add('is-caricamento');
  if (ordini.length === 0) {
    lista.innerHTML = '<p class="ordini-caricamento">Caricamento ordini…</p>';
  }

  try {
    const [esito, statoNotifiche] = await Promise.all([
      elencaOrdini(amministratore()),
      amministratore()
        ? elencaStatoNotificheDipendenti().catch(() => null)
        : Promise.resolve(null)
    ]);
    if (versione !== versioneCaricamento) return;

    ordini = esito.voci;
    statoNotificheHtml = statoNotifiche ? `
      <section class="ordini-stato-notifiche" aria-labelledby="ordini-stato-notifiche-titolo">
        <div class="ordini-stato-notifiche-testa">
          <div>
            <h3 id="ordini-stato-notifiche-titolo">Notifiche delle ragazze</h3>
            <p>Risultano attive dopo che il telefono ha collegato almeno un dispositivo.</p>
          </div>
          <span>${statoNotifiche.filter(voce => voce.attive).length}/${statoNotifiche.length} attive</span>
        </div>
        <div class="ordini-stato-notifiche-lista">
          ${statoNotifiche.map(voce => `
            <div class="ordini-stato-notifica${voce.attive ? ' is-attiva' : ' is-mancante'}">
              <span class="ordini-stato-punto" aria-hidden="true"></span>
              <strong>${escapeHtml(voce.nome)}</strong>
              <small>${voce.attive
                ? `${voce.dispositivi} ${voce.dispositivi === 1 ? 'dispositivo' : 'dispositivi'}`
                : 'Da attivare'}</small>
            </div>
          `).join('') || '<p class="ordini-stato-vuoto">Nessun profilo dipendente approvato.</p>'}
        </div>
      </section>
    ` : `
      <section class="ordini-stato-notifiche is-non-disponibile">
        <h3>Notifiche delle ragazze</h3>
        <p>Stato momentaneamente non disponibile.</p>
      </section>
    `;
    render();
    if (esito.origine === 'cache') {
      mostraAvviso('Stai vedendo l’ultima copia disponibile: la connessione al cloud non è attiva.', 'nota');
    }
  } catch (errore) {
    if (versione !== versioneCaricamento) return;
    render();
    mostraAvviso(`Non è stato possibile caricare gli ordini. ${erroreLeggibile(errore)}`);
  } finally {
    if (versione === versioneCaricamento) pannello?.classList.remove('is-caricamento');
  }
}

export function initOrdini(): void {
  if (!pannello || !lista || inizializzato) return;
  inizializzato = true;

  if (btnGestione) btnGestione.hidden = !amministratore();
  azzeraModulo();
  render();

  btnGestione?.addEventListener('click', () => {
    if (!amministratore()) return;
    modalitaGestione = !modalitaGestione;
    azzeraModulo();
    mostraAvviso('');
    render();
    if (modalitaGestione) campoVoce?.focus();
  });

  gestione?.addEventListener('submit', salva);
  campoGiorno?.addEventListener('click', evento => {
    const pulsante = (evento.target as HTMLElement).closest<HTMLButtonElement>('[data-giorno]');
    if (!pulsante || salvataggio) return;
    const giorno = Number(pulsante.dataset.giorno);
    if (giorno >= 1 && giorno <= 7) impostaGiorno(giorno as GiornoOrdine);
  });
  campoGiorno?.addEventListener('keydown', evento => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(evento.key)) return;
    evento.preventDefault();

    const corrente = giornoSelezionato();
    const indice = GIORNI.indexOf(corrente);
    const nuovoIndice = evento.key === 'Home'
      ? 0
      : evento.key === 'End'
        ? GIORNI.length - 1
        : (indice + (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp' ? -1 : 1) + GIORNI.length) % GIORNI.length;
    impostaGiorno(GIORNI[nuovoIndice], true);
  });
  btnAnnulla?.addEventListener('click', () => {
    azzeraModulo();
    mostraAvviso('');
    campoVoce?.focus();
  });

  lista.addEventListener('click', evento => {
    const pulsante = (evento.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!pulsante || !modalitaGestione || !amministratore()) return;

    const riga = pulsante.closest<HTMLElement>('[data-ordine-id]');
    const voce = ordini.find(candidata => candidata.id === riga?.dataset.ordineId);
    if (!voce) return;

    const azione = pulsante.dataset.action;
    if (azione === 'modifica-ordine') avviaModifica(voce);
    if (azione === 'disattiva-ordine') void cambiaStato(voce, false);
    if (azione === 'riattiva-ordine') void cambiaStato(voce, true);
  });
}
