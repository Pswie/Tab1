import { accedi, esci, registrati, statoAccesso } from '../services/auth';
import { accedi, esci, impostaNuovaPassword, inviaRecuperoPassword, registrati, statoAccesso } from '../services/auth';
import { supabase } from '../services/supabase';

/**
 * Schermata di accesso.
 * Schermata di accesso e gestione credenziali.
 *
 * Copre l'app finché non si sa chi la sta usando: le pagine non devono
 * comparire nemmeno per un istante a chi non è ammesso.
 * Supporta inoltre il recupero password via email per i dipendenti
 * e il cambio password sia al rientro dal link che dall'interno del menu.
 */

type Modo = 'accedi' | 'registrati';
type BloccoAccesso = 'caricamento' | 'modulo' | 'negato' | 'recupero' | 'nuova-password';

let modo: Modo = 'accedi';
let inRecuperoPassword = false;

function controllaUrlRecupero(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return hash.includes('type=recovery') || search.includes('type=recovery');
}

if (controllaUrlRecupero()) {
  inRecuperoPassword = true;
}

const schermo = document.getElementById('accesso-schermo') as HTMLDivElement;
const bloccoCaricamento = document.getElementById('accesso-caricamento') as HTMLDivElement;
const bloccoModulo = document.getElementById('accesso-modulo') as HTMLDivElement;
const bloccoNegato = document.getElementById('accesso-negato') as HTMLDivElement;
const bloccoRecupero = document.getElementById('accesso-recupero') as HTMLDivElement;
const bloccoNuovaPassword = document.getElementById('accesso-nuova-password') as HTMLDivElement;

const schede = Array.from(document.querySelectorAll('.accesso-scheda')) as HTMLButtonElement[];
const form = document.getElementById('accesso-form') as HTMLFormElement;
const campoNome = document.getElementById('campo-nome') as HTMLLabelElement;
const inputNome = document.getElementById('accesso-nome') as HTMLInputElement;
const inputEmail = document.getElementById('accesso-email') as HTMLInputElement;
const inputPassword = document.getElementById('accesso-password') as HTMLInputElement;
const messaggioErrore = document.getElementById('accesso-errore') as HTMLParagraphElement;
const pulsanteInvio = document.getElementById('accesso-invio') as HTMLButtonElement;
const bloccoLinkRecupero = document.getElementById('blocco-link-recupero') as HTMLDivElement;
const btnApriRecupero = document.getElementById('btn-apri-recupero') as HTMLButtonElement;
const notaNegato = document.getElementById('accesso-negato-nota') as HTMLParagraphElement;

// Modulo recupero password
const formRecupero = document.getElementById('recupero-form') as HTMLFormElement;
const inputRecuperoEmail = document.getElementById('recupero-email') as HTMLInputElement;
const erroreRecupero = document.getElementById('recupero-errore') as HTMLParagraphElement;
const successoRecupero = document.getElementById('recupero-successo') as HTMLParagraphElement;
const invioRecupero = document.getElementById('recupero-invio') as HTMLButtonElement;
const btnAnnullaRecupero = document.getElementById('btn-annulla-recupero') as HTMLButtonElement;

// Modulo nuova password da link
const formNuovaPassword = document.getElementById('nuova-password-form') as HTMLFormElement;
const inputNuovaPasswordValore = document.getElementById('nuova-password-valore') as HTMLInputElement;
const inputNuovaPasswordConferma = document.getElementById('nuova-password-conferma') as HTMLInputElement;
const erroreNuovaPassword = document.getElementById('nuova-password-errore') as HTMLParagraphElement;
const successoNuovaPassword = document.getElementById('nuova-password-successo') as HTMLParagraphElement;
const invioNuovaPassword = document.getElementById('nuova-password-invio') as HTMLButtonElement;
const btnAnnullaNuovaPassword = document.getElementById('btn-annulla-nuova-password') as HTMLButtonElement;

// Header e Drawer utente
const saluto = document.getElementById('header-saluto') as HTMLSpanElement;
const bloccoUtente = document.getElementById('menu-utente') as HTMLDivElement;
const azioniUtente = document.getElementById('menu-utente-azioni') as HTMLDivElement;
const inizialiUtente = document.getElementById('menu-utente-iniziali') as HTMLSpanElement;
const salutoUtente = document.getElementById('menu-utente-saluto') as HTMLElement;
const mailUtente = document.getElementById('menu-utente-mail') as HTMLElement;
const btnMenuCambiaPassword = document.getElementById('btn-menu-cambia-password') as HTMLButtonElement;
const btnMenuEsci = document.getElementById('btn-menu-esci') as HTMLButtonElement;

// Dialog cambio password da connessi
const dialogCambioPassword = document.getElementById('cambio-password-dialog') as HTMLDivElement;
const btnChiudiDialogPassword = document.getElementById('btn-chiudi-cambio-password') as HTMLButtonElement;
const btnAnnullaDialogPassword = document.getElementById('btn-annulla-dialog-password') as HTMLButtonElement;
const formDialogPassword = document.getElementById('form-dialog-cambio-password') as HTMLFormElement;
const inputDialogNuovaPassword = document.getElementById('dialog-nuova-password') as HTMLInputElement;
const inputDialogConfermaPassword = document.getElementById('dialog-conferma-password') as HTMLInputElement;
const erroreDialogPassword = document.getElementById('dialog-password-errore') as HTMLParagraphElement;
const successoDialogPassword = document.getElementById('dialog-password-successo') as HTMLParagraphElement;
const btnInviaDialogPassword = document.getElementById('btn-invia-dialog-password') as HTMLButtonElement;

/** Nome senza cognome, per il saluto: se manca si ripiega sull'email */
function soloNome(completo: string): string {
  const pulito = completo.trim();
  if (!pulito) return '';

  const base = pulito.includes('@') ? pulito.split('@')[0] : pulito;
  return base.split(/\s+/)[0];
}

/** Iniziali di nome e cognome per il tondino nel menu */
function iniziali(completo: string): string {
  const parole = completo.trim().split(/\s+/).filter(Boolean);
  if (parole.length === 0) return '';

  const prime = parole.slice(0, 2).map(p => p[0].toUpperCase());
  return prime.join('');
}

function mostraSaluto(nome: string, email = ''): void {
  const primo = soloNome(nome);

  if (saluto) {
    saluto.textContent = primo ? `Ciao ${primo}` : '';
    saluto.hidden = !primo;
  }

  // Su mobile la testata è stretta: chi sta usando l'app si legge nel menu
  if (bloccoUtente) bloccoUtente.hidden = !primo;
  if (azioniUtente) azioniUtente.hidden = !primo;
  if (inizialiUtente) inizialiUtente.textContent = iniziali(nome) || (primo[0] || '').toUpperCase();
  if (salutoUtente) salutoUtente.textContent = primo ? `Ciao ${primo}` : '';
  if (mailUtente) mailUtente.textContent = email;
}

function mostraBlocco(quale: 'caricamento' | 'modulo' | 'negato'): void {
function mostraBlocco(quale: BloccoAccesso): void {
  bloccoCaricamento?.classList.toggle('is-hidden', quale !== 'caricamento');
  bloccoModulo?.classList.toggle('is-hidden', quale !== 'modulo');
  bloccoNegato?.classList.toggle('is-hidden', quale !== 'negato');
  bloccoRecupero?.classList.toggle('is-hidden', quale !== 'recupero');
  bloccoNuovaPassword?.classList.toggle('is-hidden', quale !== 'nuova-password');
}

function mostraErrore(testo: string | null): void {
  if (!messaggioErrore) return;

  messaggioErrore.textContent = testo || '';
  messaggioErrore.classList.toggle('is-hidden', !testo);
}

function mostraErroreRecupero(testo: string | null): void {
  if (!erroreRecupero) return;
  erroreRecupero.textContent = testo || '';
  erroreRecupero.classList.toggle('is-hidden', !testo);
}

function mostraSuccessoRecupero(testo: string | null): void {
  if (!successoRecupero) return;
  successoRecupero.textContent = testo || '';
  successoRecupero.classList.toggle('is-hidden', !testo);
}

function mostraErroreNuovaPassword(testo: string | null): void {
  if (!erroreNuovaPassword) return;
  erroreNuovaPassword.textContent = testo || '';
  erroreNuovaPassword.classList.toggle('is-hidden', !testo);
}

function mostraSuccessoNuovaPassword(testo: string | null): void {
  if (!successoNuovaPassword) return;
  successoNuovaPassword.textContent = testo || '';
  successoNuovaPassword.classList.toggle('is-hidden', !testo);
}

function mostraErroreDialogPassword(testo: string | null): void {
  if (!erroreDialogPassword) return;
  erroreDialogPassword.textContent = testo || '';
  erroreDialogPassword.classList.toggle('is-hidden', !testo);
}

function mostraSuccessoDialogPassword(testo: string | null): void {
  if (!successoDialogPassword) return;
  successoDialogPassword.textContent = testo || '';
  successoDialogPassword.classList.toggle('is-hidden', !testo);
}

function cambiaModo(nuovo: Modo): void {
  modo = nuovo;
  mostraErrore(null);

  schede.forEach(s => {
    const attiva = s.getAttribute('data-modo') === nuovo;
    s.classList.toggle('is-active', attiva);
    s.setAttribute('aria-selected', String(attiva));
  });

  campoNome?.classList.toggle('is-hidden', nuovo !== 'registrati');
  if (inputNome) inputNome.required = nuovo === 'registrati';

  bloccoLinkRecupero?.classList.toggle('is-hidden', nuovo !== 'accedi');

  // La password nuova non va cercata fra quelle salvate
  if (inputPassword) {
    inputPassword.autocomplete = nuovo === 'registrati' ? 'new-password' : 'current-password';
  }

  if (pulsanteInvio) pulsanteInvio.textContent = nuovo === 'registrati' ? 'Registrati' : 'Entra';
}

function apriDialogPassword(): void {
  const drawer = document.getElementById('hotdog-menu-drawer');
  const backdrop = document.getElementById('hotdog-backdrop');
  drawer?.classList.remove('is-open');
  backdrop?.classList.remove('is-active');
  document.body.classList.remove('admin-menu-open');

  if (dialogCambioPassword) {
    dialogCambioPassword.classList.add('is-active');
    dialogCambioPassword.removeAttribute('aria-hidden');
    dialogCambioPassword.removeAttribute('inert');
    if (inputDialogNuovaPassword) inputDialogNuovaPassword.value = '';
    if (inputDialogConfermaPassword) inputDialogConfermaPassword.value = '';
    mostraErroreDialogPassword(null);
    mostraSuccessoDialogPassword(null);
  }
}

function chiudiDialogPassword(): void {
  if (dialogCambioPassword) {
    dialogCambioPassword.classList.remove('is-active');
    dialogCambioPassword.setAttribute('aria-hidden', 'true');
    dialogCambioPassword.setAttribute('inert', '');
  }
}

/**
 * Decide cosa mostrare in base allo stato dell'accesso.
 * Restituisce true se si può usare l'app.
 */
export async function verificaAccesso(): Promise<boolean> {
  if (!schermo) return true;

  if (inRecuperoPassword) {
    schermo.classList.remove('is-chiuso');
    mostraBlocco('nuova-password');
    return false;
  }

  mostraBlocco('caricamento');

  const esito = await statoAccesso();

  // Senza Supabase configurato l'app resta comunque utilizzabile in locale
  if (esito.stato === 'non-configurato' || esito.stato === 'dentro') {
    if (esito.stato === 'dentro') mostraSaluto(esito.nome, esito.email);
    schermo.classList.add('is-chiuso');
    return true;
  }

  mostraSaluto('');
  schermo.classList.remove('is-chiuso');

  if (esito.stato === 'in-attesa') {
    mostraBlocco('negato');
    if (notaNegato) {
      notaNegato.textContent =
        `L'account ${esito.email} è registrato ma non è ancora stato abilitato. ` +
        'Chiedi al titolare di concedere l\'accesso, poi tocca il pulsante qui sotto.';
    }
    return false;
  }

  mostraBlocco('modulo');
  return false;
}

/**
 * Aggancia i comandi della schermata. `quandoDentro` viene chiamata una sola
 * volta, appena l'accesso risulta concesso.
 */
export function initAccesso(quandoDentro: () => void): void {
  if (!schermo) return;

  let giaEntrato = false;

  const entra = () => {
    if (giaEntrato) return;
    giaEntrato = true;
    quandoDentro();
  };

  // Rilevamento evento di recupero password da Supabase Auth
  if (supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        inRecuperoPassword = true;
        schermo.classList.remove('is-chiuso');
        mostraBlocco('nuova-password');
      }
    });
  }

  schede.forEach(s => {
    s.addEventListener('click', () => cambiaModo(s.getAttribute('data-modo') as Modo));
  });

  // Login e Registrazione standard
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    mostraErrore(null);

    const email = inputEmail.value.trim();
    const password = inputPassword.value;
    const nome = inputNome?.value?.trim() || '';

    if (!email || password.length < 6) {
      mostraErrore('Serve una email valida e una password di almeno 6 caratteri.');
      return;
    }

    // In registrazione servono nome e cognome: il titolare deve riconoscere
    // chi sta chiedendo l'accesso dalla tabella su Supabase.
    if (modo === 'registrati' && nome.split(/\s+/).filter(Boolean).length < 2) {
      mostraErrore('Scrivi nome e cognome.');
      return;
    }

    pulsanteInvio.disabled = true;
    pulsanteInvio.textContent = modo === 'registrati' ? 'Registrazione...' : 'Accesso...';

    const errore = modo === 'registrati'
      ? await registrati(email, password, nome)
      : await accedi(email, password);

    pulsanteInvio.disabled = false;
    pulsanteInvio.textContent = modo === 'registrati' ? 'Registrati' : 'Entra';

    if (errore) {
      mostraErrore(errore);
      return;
    }

    inputPassword.value = '';

    if (await verificaAccesso()) entra();
  });

  // Apertura blocco recupero password
  btnApriRecupero?.addEventListener('click', () => {
    if (inputEmail && inputRecuperoEmail && !inputRecuperoEmail.value) {
      inputRecuperoEmail.value = inputEmail.value.trim();
    }
    mostraErroreRecupero(null);
    mostraSuccessoRecupero(null);
    mostraBlocco('recupero');
  });

  // Annulla recupero password e torna a login
  btnAnnullaRecupero?.addEventListener('click', () => {
    mostraBlocco('modulo');
  });

  // Invio email di recupero password
  formRecupero?.addEventListener('submit', async e => {
    e.preventDefault();
    mostraErroreRecupero(null);
    mostraSuccessoRecupero(null);

    const email = inputRecuperoEmail?.value?.trim() || '';
    if (!email) {
      mostraErroreRecupero('Inserisci un indirizzo email valido.');
      return;
    }

    invioRecupero.disabled = true;
    invioRecupero.textContent = 'Invio in corso...';

    const errore = await inviaRecuperoPassword(email);

    invioRecupero.disabled = false;
    invioRecupero.textContent = 'Invia link di recupero';

    if (errore) {
      mostraErroreRecupero(errore);
      return;
    }

    mostraSuccessoRecupero('Ti abbiamo inviato un link per reimpostare la password. Controlla la tua posta elettronica (e la cartella Spam).');
  });

  // Annulla impostazione nuova password
  btnAnnullaNuovaPassword?.addEventListener('click', () => {
    inRecuperoPassword = false;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    cambiaModo('accedi');
    mostraBlocco('modulo');
  });

  // Salvataggio nuova password (da link di recupero)
  formNuovaPassword?.addEventListener('submit', async e => {
    e.preventDefault();
    mostraErroreNuovaPassword(null);
    mostraSuccessoNuovaPassword(null);

    const p1 = inputNuovaPasswordValore?.value || '';
    const p2 = inputNuovaPasswordConferma?.value || '';

    if (p1.length < 6) {
      mostraErroreNuovaPassword('La password deve avere almeno 6 caratteri.');
      return;
    }
    if (p1 !== p2) {
      mostraErroreNuovaPassword('Le password inserite non coincidono.');
      return;
    }

    invioNuovaPassword.disabled = true;
    invioNuovaPassword.textContent = 'Salvataggio...';

    const errore = await impostaNuovaPassword(p1);

    invioNuovaPassword.disabled = false;
    invioNuovaPassword.textContent = 'Salva nuova password';

    if (errore) {
      mostraErroreNuovaPassword(errore);
      return;
    }

    mostraSuccessoNuovaPassword('Password aggiornata con successo! Accesso in corso...');
    inputNuovaPasswordValore.value = '';
    inputNuovaPasswordConferma.value = '';
    inRecuperoPassword = false;

    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    setTimeout(async () => {
      if (await verificaAccesso()) entra();
    }, 1200);
  });

  // Dialog cambio password dal menu utente collegato
  btnMenuCambiaPassword?.addEventListener('click', () => {
    apriDialogPassword();
  });

  btnChiudiDialogPassword?.addEventListener('click', () => {
    chiudiDialogPassword();
  });

  btnAnnullaDialogPassword?.addEventListener('click', () => {
    chiudiDialogPassword();
  });

  dialogCambioPassword?.addEventListener('click', (e) => {
    if (e.target === dialogCambioPassword) {
      chiudiDialogPassword();
    }
  });

  formDialogPassword?.addEventListener('submit', async (e) => {
    e.preventDefault();
    mostraErroreDialogPassword(null);
    mostraSuccessoDialogPassword(null);

    const p1 = inputDialogNuovaPassword?.value || '';
    const p2 = inputDialogConfermaPassword?.value || '';

    if (p1.length < 6) {
      mostraErroreDialogPassword('La password deve avere almeno 6 caratteri.');
      return;
    }
    if (p1 !== p2) {
      mostraErroreDialogPassword('Le due password non coincidono.');
      return;
    }

    btnInviaDialogPassword.disabled = true;
    btnInviaDialogPassword.textContent = 'Salvataggio...';

    const errore = await impostaNuovaPassword(p1);

    btnInviaDialogPassword.disabled = false;
    btnInviaDialogPassword.textContent = 'Aggiorna password';

    if (errore) {
      mostraErroreDialogPassword(errore);
      return;
    }

    mostraSuccessoDialogPassword('Password aggiornata con successo!');
    inputDialogNuovaPassword.value = '';
    inputDialogConfermaPassword.value = '';

    setTimeout(() => {
      chiudiDialogPassword();
    }, 1200);
  });

  // Logout dal menu utente
  btnMenuEsci?.addEventListener('click', async () => {
    const drawer = document.getElementById('hotdog-menu-drawer');
    const backdrop = document.getElementById('hotdog-backdrop');
    drawer?.classList.remove('is-open');
    backdrop?.classList.remove('is-active');
    document.body.classList.remove('admin-menu-open');

    await esci();
    cambiaModo('accedi');
    await verificaAccesso();
  });

  document.getElementById('accesso-riprova')?.addEventListener('click', async () => {
    if (await verificaAccesso()) entra();
  });

  document.getElementById('accesso-esci')?.addEventListener('click', async () => {
    await esci();
    cambiaModo('accedi');
    await verificaAccesso();
  });

  // Prima verifica all'avvio
  verificaAccesso().then(dentro => {
    if (dentro) entra();
  });
}
