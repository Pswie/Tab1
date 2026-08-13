import { amministratore } from '../services/auth';
import {
  CredenzialeTabaccheria,
  ProceduraTabaccheria,
  elencaCredenzialiTabaccheria,
  elencaProcedureTabaccheria,
  impostaCredenzialeTabaccheriaAttiva,
  impostaProceduraTabaccheriaAttiva,
  salvaCredenzialeTabaccheria,
  salvaProceduraTabaccheria,
  usaCredenzialeTabaccheria
} from '../services/datiTabaccheria';

let credenziali: CredenzialeTabaccheria[] = [];
let procedure: ProceduraTabaccheria[] = [];
let modalitaGestione = false;
let credenzialeInModifica: string | null = null;
let proceduraInModifica: string | null = null;
let salvataggio = false;
let inizializzato = false;
let versioneCaricamento = 0;
let timerAvviso: number | null = null;

/** Segreti solo in memoria, eliminati dopo 30 secondi o appena si cambia scheda. */
const passwordVisibili = new Map<string, string>();
const timerPassword = new Map<string, number>();
const azioniInCorso = new Set<string>();

const pannello = document.getElementById('tab-dati-tabaccheria') as HTMLDivElement | null;
const listaCredenziali = document.getElementById('dati-credenziali-lista') as HTMLDivElement | null;
const listaProcedure = document.getElementById('dati-procedure-lista') as HTMLDivElement | null;
const contenitoreArchivio = document.getElementById('dati-archivio') as HTMLDivElement | null;
const avviso = document.getElementById('dati-avviso') as HTMLParagraphElement | null;
const btnGestione = document.getElementById('btn-dati-gestione') as HTMLButtonElement | null;

const formCredenziale = document.getElementById('dati-credenziale-form') as HTMLFormElement | null;
const campoServizio = document.getElementById('dati-credenziale-servizio') as HTMLInputElement | null;
const campoUsername = document.getElementById('dati-credenziale-username') as HTMLInputElement | null;
const campoPassword = document.getElementById('dati-credenziale-password') as HTMLInputElement | null;
const hintPassword = document.getElementById('dati-credenziale-password-hint') as HTMLParagraphElement | null;
const btnSalvaCredenziale = document.getElementById('btn-dati-credenziale-salva') as HTMLButtonElement | null;
const btnAnnullaCredenziale = document.getElementById('btn-dati-credenziale-annulla') as HTMLButtonElement | null;

const formProcedura = document.getElementById('dati-procedura-form') as HTMLFormElement | null;
const campoTitoloProcedura = document.getElementById('dati-procedura-titolo') as HTMLInputElement | null;
const campoPassaggi = document.getElementById('dati-procedura-passaggi') as HTMLTextAreaElement | null;
const btnSalvaProcedura = document.getElementById('btn-dati-procedura-salva') as HTMLButtonElement | null;
const btnAnnullaProcedura = document.getElementById('btn-dati-procedura-annulla') as HTMLButtonElement | null;

function escapeHtml(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function erroreLeggibile(errore: unknown): string {
  if (errore && typeof errore === 'object' && 'message' in errore) {
    const messaggio = String((errore as { message: unknown }).message || '');
    if (messaggio) return messaggio;
  }
  return 'Operazione non riuscita. Controlla la connessione e riprova.';
}

function mostraAvviso(
  testo: string,
  tipo: 'errore' | 'successo' | 'nota' = 'errore',
  durata = 0
): void {
  if (!avviso) return;

  if (timerAvviso !== null) {
    window.clearTimeout(timerAvviso);
    timerAvviso = null;
  }

  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
  avviso.classList.toggle('is-successo', tipo === 'successo');
  avviso.classList.toggle('is-nota', tipo === 'nota');

  if (testo && durata > 0) {
    timerAvviso = window.setTimeout(() => mostraAvviso(''), durata);
  }
}

function iconaCopia(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
  </svg>`;
}

function iconaOcchio(aperto: boolean): string {
  return aperto
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9 8 9 8a16.5 16.5 0 0 1-2 3.1"/><path d="M6.6 6.6C4.3 8.2 3 12 3 12s3.5 8 9 8a8.7 8.7 0 0 0 3-.5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
}

function azioniGestione(tipo: 'credenziale' | 'procedura', nome: string): string {
  if (!modalitaGestione || !amministratore()) return '';

  return `<div class="dati-riga-azioni">
    <button type="button" class="todo-icon-btn" data-action="modifica-${tipo}"
            aria-label="Modifica ${escapeHtml(nome)}"${salvataggio ? ' disabled' : ''}>
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>
    <button type="button" class="todo-icon-btn is-danger" data-action="archivia-${tipo}"
            aria-label="Archivia ${escapeHtml(nome)}"${salvataggio ? ' disabled' : ''}>
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M6 7v13h12V7"/><path d="M9 4h6l1 3H8l1-3Z"/><path d="M10 11h4"/></svg>
    </button>
  </div>`;
}

function credenzialeHtml(voce: CredenzialeTabaccheria): string {
  const password = passwordVisibili.get(voce.id);
  const visibile = typeof password === 'string';
  const attesaMostra = azioniInCorso.has(`${voce.id}:visualizza`);
  const attesaUsername = azioniInCorso.has(`${voce.id}:username`);
  const attesaPassword = azioniInCorso.has(`${voce.id}:password`);

  return `<article class="dati-credenziale" data-credenziale-id="${escapeHtml(voce.id)}">
    <header class="dati-credenziale-testa">
      <span class="dati-cassetto-segno" aria-hidden="true"></span>
      <h3>${escapeHtml(voce.nomeServizio)}</h3>
      ${azioniGestione('credenziale', voce.nomeServizio)}
    </header>
    <dl class="dati-accesso-ledger">
      <div class="dati-accesso-riga">
        <dt>Username</dt>
        <dd><code>${escapeHtml(voce.username)}</code></dd>
        <button type="button" class="dati-azione-valore" data-action="copia-username"
                aria-label="Copia username di ${escapeHtml(voce.nomeServizio)}"${attesaUsername ? ' disabled' : ''}>
          ${iconaCopia()}<span>${attesaUsername ? 'Attendi' : 'Copia'}</span>
        </button>
      </div>
      <div class="dati-accesso-riga is-password${visibile ? ' is-rivelata' : ''}">
        <dt>Password</dt>
        <dd aria-live="polite"><code data-password>${visibile ? escapeHtml(password) : '••••••••'}</code></dd>
        <div class="dati-password-azioni">
          <button type="button" class="dati-azione-valore" data-action="mostra-password"
                  aria-label="${visibile ? 'Nascondi' : 'Mostra'} password di ${escapeHtml(voce.nomeServizio)}"
                  aria-pressed="${visibile}"${attesaMostra ? ' disabled' : ''}>
            ${iconaOcchio(visibile)}<span>${attesaMostra ? 'Attendi' : visibile ? 'Nascondi' : 'Mostra'}</span>
          </button>
          <button type="button" class="dati-azione-valore" data-action="copia-password"
                  aria-label="Copia password di ${escapeHtml(voce.nomeServizio)}"${attesaPassword ? ' disabled' : ''}>
            ${iconaCopia()}<span>${attesaPassword ? 'Attendi' : 'Copia'}</span>
          </button>
        </div>
      </div>
    </dl>
  </article>`;
}

function proceduraHtml(voce: ProceduraTabaccheria): string {
  return `<article class="dati-procedura" data-procedura-id="${escapeHtml(voce.id)}">
    <header class="dati-procedura-testa">
      <h3>${escapeHtml(voce.titolo)}</h3>
      ${azioniGestione('procedura', voce.titolo)}
    </header>
    <ol class="dati-passaggi">
      ${voce.passaggi.map(passaggio => `<li><span>${escapeHtml(passaggio)}</span></li>`).join('')}
    </ol>
  </article>`;
}

function archiviateHtml(): string {
  if (!modalitaGestione || !amministratore()) return '';

  const credenzialiArchiviate = credenziali.filter(voce => !voce.attiva);
  const procedureArchiviate = procedure.filter(voce => !voce.attiva);
  if (credenzialiArchiviate.length + procedureArchiviate.length === 0) return '';

  return `<section class="dati-archivio" aria-labelledby="dati-archivio-titolo">
    <h3 id="dati-archivio-titolo">Archivio</h3>
    <p>Queste voci non sono visibili alle dipendenti. Puoi ripristinarle senza riscriverle.</p>
    <div class="dati-archivio-lista">
      ${credenzialiArchiviate.map(voce => `<div class="dati-archivio-riga" data-credenziale-id="${escapeHtml(voce.id)}">
        <span><small>Accesso</small><strong>${escapeHtml(voce.nomeServizio)}</strong></span>
        <button type="button" class="rub-btn-testo" data-action="ripristina-credenziale"${salvataggio ? ' disabled' : ''}>Ripristina</button>
      </div>`).join('')}
      ${procedureArchiviate.map(voce => `<div class="dati-archivio-riga" data-procedura-id="${escapeHtml(voce.id)}">
        <span><small>Procedura</small><strong>${escapeHtml(voce.titolo)}</strong></span>
        <button type="button" class="rub-btn-testo" data-action="ripristina-procedura"${salvataggio ? ' disabled' : ''}>Ripristina</button>
      </div>`).join('')}
    </div>
  </section>`;
}

function render(): void {
  if (!listaCredenziali || !listaProcedure) return;

  const attive = credenziali.filter(voce => voce.attiva);
  const procedureAttive = procedure.filter(voce => voce.attiva);

  listaCredenziali.innerHTML = attive.length > 0
    ? attive.map(credenzialeHtml).join('')
    : `<div class="dati-vuoto"><p>Nessun accesso registrato.</p>${modalitaGestione ? '<small>Compila il modulo per aggiungere il primo servizio.</small>' : ''}</div>`;

  listaProcedure.innerHTML = procedureAttive.length > 0
    ? procedureAttive.map(proceduraHtml).join('')
    : `<div class="dati-vuoto"><p>Nessuna procedura registrata.</p>${modalitaGestione ? '<small>Scrivi un passaggio per riga nel modulo qui sopra.</small>' : ''}</div>`;

  if (contenitoreArchivio) contenitoreArchivio.innerHTML = archiviateHtml();
  [listaCredenziali, listaProcedure].forEach(elenco => elenco.setAttribute('aria-busy', String(salvataggio)));
  pannello?.classList.toggle('is-salvataggio', salvataggio);

  if (btnGestione) {
    const puoGestire = amministratore();
    btnGestione.hidden = !puoGestire;
    btnGestione.classList.toggle('is-active', modalitaGestione);
    btnGestione.setAttribute('aria-pressed', String(modalitaGestione));
    btnGestione.title = modalitaGestione ? 'Chiudi gestione dati' : 'Gestisci dati e procedure';
    btnGestione.setAttribute('aria-label', modalitaGestione ? 'Chiudi gestione Dati Tabaccheria' : 'Apri gestione Dati Tabaccheria');
  }

  if (formCredenziale) formCredenziale.hidden = !modalitaGestione;
  if (formProcedura) formProcedura.hidden = !modalitaGestione;
}

function azzeraCredenziale(): void {
  credenzialeInModifica = null;
  if (campoServizio) campoServizio.value = '';
  if (campoUsername) campoUsername.value = '';
  if (campoPassword) campoPassword.value = '';
  if (hintPassword) hintPassword.textContent = 'La password viene salvata in modo protetto e non rimane nel browser.';
  if (btnSalvaCredenziale) btnSalvaCredenziale.textContent = 'Aggiungi accesso';
  if (btnAnnullaCredenziale) btnAnnullaCredenziale.hidden = true;
}

function azzeraProcedura(): void {
  proceduraInModifica = null;
  if (campoTitoloProcedura) campoTitoloProcedura.value = '';
  if (campoPassaggi) campoPassaggi.value = '';
  if (btnSalvaProcedura) btnSalvaProcedura.textContent = 'Aggiungi procedura';
  if (btnAnnullaProcedura) btnAnnullaProcedura.hidden = true;
}

function impostaSalvataggio(attivo: boolean): void {
  salvataggio = attivo;
  [campoServizio, campoUsername, campoPassword, btnSalvaCredenziale, btnAnnullaCredenziale,
    campoTitoloProcedura, campoPassaggi, btnSalvaProcedura, btnAnnullaProcedura]
    .forEach(controllo => { if (controllo) controllo.disabled = attivo; });
  render();
}

function nascondiPassword(id: string): void {
  const timer = timerPassword.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timerPassword.delete(id);
  const cambiata = passwordVisibili.delete(id);
  if (cambiata) render();
}

export function nascondiSegretiDatiTabaccheria(): void {
  timerPassword.forEach(timer => window.clearTimeout(timer));
  timerPassword.clear();
  const presenti = passwordVisibili.size > 0;
  passwordVisibili.clear();
  if (presenti) render();
}

function programmaMascheramento(id: string): void {
  const precedente = timerPassword.get(id);
  if (precedente !== undefined) window.clearTimeout(precedente);
  timerPassword.set(id, window.setTimeout(() => nascondiPassword(id), 30_000));
}

async function mostraPassword(voce: CredenzialeTabaccheria): Promise<void> {
  if (passwordVisibili.has(voce.id)) {
    nascondiPassword(voce.id);
    return;
  }

  const chiave = `${voce.id}:visualizza`;
  if (azioniInCorso.has(chiave)) return;
  azioniInCorso.add(chiave);
  render();
  try {
    const password = await usaCredenzialeTabaccheria(voce.id, 'password', 'visualizza');
    passwordVisibili.set(voce.id, password);
    programmaMascheramento(voce.id);
  } catch (errore) {
    mostraAvviso(`Non è stato possibile mostrare la password. ${erroreLeggibile(errore)}`);
  } finally {
    azioniInCorso.delete(chiave);
    render();
  }
}

async function scriviClipboard(testo: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(testo);
    return;
  }

  const campo = document.createElement('textarea');
  campo.value = testo;
  campo.readOnly = true;
  campo.setAttribute('aria-hidden', 'true');
  campo.style.position = 'fixed';
  campo.style.opacity = '0';
  document.body.appendChild(campo);
  campo.select();
  const riuscito = document.execCommand('copy');
  campo.remove();
  if (!riuscito) throw new Error('Copia non supportata da questo dispositivo.');
}

async function copiaCampo(
  voce: CredenzialeTabaccheria,
  campo: 'username' | 'password',
  pulsante: HTMLButtonElement
): Promise<void> {
  const chiave = `${voce.id}:${campo}`;
  if (azioniInCorso.has(chiave)) return;
  azioniInCorso.add(chiave);
  pulsante.disabled = true;

  try {
    const valore = await usaCredenzialeTabaccheria(voce.id, campo, 'copia');
    await scriviClipboard(valore);
    pulsante.classList.add('is-copiato');
    const testo = pulsante.querySelector('span');
    if (testo) testo.textContent = 'Copiato';
    mostraAvviso(`${campo === 'username' ? 'Username' : 'Password'} copiato.`, 'successo', 2200);
    window.setTimeout(() => {
      pulsante.classList.remove('is-copiato');
      if (testo) testo.textContent = 'Copia';
      pulsante.disabled = false;
    }, 1600);
  } catch (errore) {
    pulsante.disabled = false;
    mostraAvviso(`Copia non riuscita. ${erroreLeggibile(errore)}`);
  } finally {
    azioniInCorso.delete(chiave);
  }
}

async function salvaCredenziale(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  if (!amministratore() || salvataggio) return;

  const servizio = campoServizio?.value.trim() || '';
  const username = campoUsername?.value.trim() || '';
  const password = campoPassword?.value || '';
  if (!servizio || !username) {
    mostraAvviso('Scrivi il nome del servizio e lo username.');
    (!servizio ? campoServizio : campoUsername)?.focus();
    return;
  }
  if (!credenzialeInModifica && !password) {
    mostraAvviso('Scrivi la password del nuovo servizio.');
    campoPassword?.focus();
    return;
  }

  impostaSalvataggio(true);
  try {
    await salvaCredenzialeTabaccheria(credenzialeInModifica, servizio, username, password);
    azzeraCredenziale();
    await caricaDatiTabaccheria();
    mostraAvviso('Accesso salvato.', 'successo', 3200);
  } catch (errore) {
    mostraAvviso(`Accesso non salvato. ${erroreLeggibile(errore)}`);
  } finally {
    impostaSalvataggio(false);
  }
}

function leggiPassaggi(): string[] {
  return (campoPassaggi?.value || '')
    .split(/\r?\n/)
    .map(passaggio => passaggio.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

async function salvaProcedura(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  if (!amministratore() || salvataggio) return;

  const titolo = campoTitoloProcedura?.value.trim() || '';
  const passaggi = leggiPassaggi();
  if (!titolo || passaggi.length === 0) {
    mostraAvviso('Scrivi il titolo e almeno un passaggio della procedura.');
    (!titolo ? campoTitoloProcedura : campoPassaggi)?.focus();
    return;
  }

  impostaSalvataggio(true);
  try {
    await salvaProceduraTabaccheria(proceduraInModifica, titolo, passaggi);
    azzeraProcedura();
    await caricaDatiTabaccheria();
    mostraAvviso('Procedura salvata.', 'successo', 3200);
  } catch (errore) {
    mostraAvviso(`Procedura non salvata. ${erroreLeggibile(errore)}`);
  } finally {
    impostaSalvataggio(false);
  }
}

function modificaCredenziale(voce: CredenzialeTabaccheria): void {
  credenzialeInModifica = voce.id;
  if (campoServizio) campoServizio.value = voce.nomeServizio;
  if (campoUsername) campoUsername.value = voce.username;
  if (campoPassword) campoPassword.value = '';
  if (hintPassword) hintPassword.textContent = 'Lascia la password vuota per mantenere quella attuale.';
  if (btnSalvaCredenziale) btnSalvaCredenziale.textContent = 'Salva modifiche';
  if (btnAnnullaCredenziale) btnAnnullaCredenziale.hidden = false;
  mostraAvviso('');
  campoServizio?.focus();
}

function modificaProcedura(voce: ProceduraTabaccheria): void {
  proceduraInModifica = voce.id;
  if (campoTitoloProcedura) campoTitoloProcedura.value = voce.titolo;
  if (campoPassaggi) campoPassaggi.value = voce.passaggi.join('\n');
  if (btnSalvaProcedura) btnSalvaProcedura.textContent = 'Salva modifiche';
  if (btnAnnullaProcedura) btnAnnullaProcedura.hidden = false;
  mostraAvviso('');
  campoTitoloProcedura?.focus();
}

async function cambiaStato(
  tipo: 'credenziale' | 'procedura',
  voce: CredenzialeTabaccheria | ProceduraTabaccheria,
  attiva: boolean
): Promise<void> {
  if (!amministratore() || salvataggio) return;

  const nome = 'nomeServizio' in voce ? voce.nomeServizio : voce.titolo;
  if (!attiva && !window.confirm(`Archiviare “${nome}”? Non sarà più visibile alle dipendenti.`)) return;

  impostaSalvataggio(true);
  try {
    if (tipo === 'credenziale') await impostaCredenzialeTabaccheriaAttiva(voce.id, attiva);
    else await impostaProceduraTabaccheriaAttiva(voce.id, attiva);
    if (tipo === 'credenziale' && credenzialeInModifica === voce.id) azzeraCredenziale();
    if (tipo === 'procedura' && proceduraInModifica === voce.id) azzeraProcedura();
    nascondiPassword(voce.id);
    await caricaDatiTabaccheria();
    mostraAvviso(attiva ? 'Voce ripristinata.' : 'Voce spostata in archivio.', 'successo', 3000);
  } catch (errore) {
    mostraAvviso(`Modifica non riuscita. ${erroreLeggibile(errore)}`);
  } finally {
    impostaSalvataggio(false);
  }
}

/** Caricamento intenzionalmente senza cache: i dati arrivano solo aprendo la scheda. */
export async function caricaDatiTabaccheria(): Promise<void> {
  if (!pannello || !listaCredenziali || !listaProcedure) return;

  nascondiSegretiDatiTabaccheria();
  const versione = ++versioneCaricamento;
  pannello.classList.add('is-caricamento');
  if (credenziali.length === 0) listaCredenziali.innerHTML = '<p class="dati-caricamento">Caricamento accessi…</p>';
  if (procedure.length === 0) listaProcedure.innerHTML = '<p class="dati-caricamento">Caricamento procedure…</p>';
  mostraAvviso('');

  try {
    const includiArchiviate = amministratore();
    const [nuoveCredenziali, nuoveProcedure] = await Promise.all([
      elencaCredenzialiTabaccheria(includiArchiviate),
      elencaProcedureTabaccheria(includiArchiviate)
    ]);
    if (versione !== versioneCaricamento) return;
    credenziali = nuoveCredenziali;
    procedure = nuoveProcedure;
    render();
  } catch (errore) {
    if (versione !== versioneCaricamento) return;
    credenziali = [];
    procedure = [];
    render();
    mostraAvviso(`Non è stato possibile caricare Dati Tabaccheria. ${erroreLeggibile(errore)}`);
  } finally {
    if (versione === versioneCaricamento) pannello.classList.remove('is-caricamento');
  }
}

export function initDatiTabaccheria(): void {
  if (!pannello || !listaCredenziali || !listaProcedure || inizializzato) return;
  inizializzato = true;

  azzeraCredenziale();
  azzeraProcedura();
  render();

  btnGestione?.addEventListener('click', () => {
    if (!amministratore()) return;
    modalitaGestione = !modalitaGestione;
    nascondiSegretiDatiTabaccheria();
    azzeraCredenziale();
    azzeraProcedura();
    mostraAvviso('');
    render();
    if (modalitaGestione) campoServizio?.focus();
  });

  formCredenziale?.addEventListener('submit', salvaCredenziale);
  formProcedura?.addEventListener('submit', salvaProcedura);
  btnAnnullaCredenziale?.addEventListener('click', () => {
    azzeraCredenziale();
    campoServizio?.focus();
  });
  btnAnnullaProcedura?.addEventListener('click', () => {
    azzeraProcedura();
    campoTitoloProcedura?.focus();
  });

  pannello.addEventListener('click', evento => {
    const pulsante = (evento.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!pulsante) return;

    const rigaCredenziale = pulsante.closest<HTMLElement>('[data-credenziale-id]');
    const rigaProcedura = pulsante.closest<HTMLElement>('[data-procedura-id]');
    const credenziale = credenziali.find(voce => voce.id === rigaCredenziale?.dataset.credenzialeId);
    const procedura = procedure.find(voce => voce.id === rigaProcedura?.dataset.proceduraId);

    switch (pulsante.dataset.action) {
      case 'mostra-password':
        if (credenziale) void mostraPassword(credenziale);
        break;
      case 'copia-username':
        if (credenziale) void copiaCampo(credenziale, 'username', pulsante);
        break;
      case 'copia-password':
        if (credenziale) void copiaCampo(credenziale, 'password', pulsante);
        break;
      case 'modifica-credenziale':
        if (credenziale && modalitaGestione && amministratore()) modificaCredenziale(credenziale);
        break;
      case 'archivia-credenziale':
        if (credenziale && modalitaGestione) void cambiaStato('credenziale', credenziale, false);
        break;
      case 'ripristina-credenziale':
        if (credenziale && modalitaGestione) void cambiaStato('credenziale', credenziale, true);
        break;
      case 'modifica-procedura':
        if (procedura && modalitaGestione && amministratore()) modificaProcedura(procedura);
        break;
      case 'archivia-procedura':
        if (procedura && modalitaGestione) void cambiaStato('procedura', procedura, false);
        break;
      case 'ripristina-procedura':
        if (procedura && modalitaGestione) void cambiaStato('procedura', procedura, true);
        break;
    }
  });

  // Cambiare scheda rimuove subito ogni password dal DOM e dalla memoria.
  new MutationObserver(() => {
    if (!pannello.classList.contains('active')) nascondiSegretiDatiTabaccheria();
  }).observe(pannello, { attributes: true, attributeFilter: ['class'] });
}
