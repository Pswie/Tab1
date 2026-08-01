import { accedi, esci, registrati, statoAccesso } from '../services/auth';

/**
 * Schermata di accesso.
 *
 * Copre l'app finché non si sa chi la sta usando: le pagine non devono
 * comparire nemmeno per un istante a chi non è ammesso.
 */

type Modo = 'accedi' | 'registrati';

let modo: Modo = 'accedi';

const schermo = document.getElementById('accesso-schermo') as HTMLDivElement;
const bloccoCaricamento = document.getElementById('accesso-caricamento') as HTMLDivElement;
const bloccoModulo = document.getElementById('accesso-modulo') as HTMLDivElement;
const bloccoNegato = document.getElementById('accesso-negato') as HTMLDivElement;

const schede = Array.from(document.querySelectorAll('.accesso-scheda')) as HTMLButtonElement[];
const form = document.getElementById('accesso-form') as HTMLFormElement;
const campoNome = document.getElementById('campo-nome') as HTMLLabelElement;
const inputNome = document.getElementById('accesso-nome') as HTMLInputElement;
const inputEmail = document.getElementById('accesso-email') as HTMLInputElement;
const inputPassword = document.getElementById('accesso-password') as HTMLInputElement;
const messaggioErrore = document.getElementById('accesso-errore') as HTMLParagraphElement;
const pulsanteInvio = document.getElementById('accesso-invio') as HTMLButtonElement;
const notaNegato = document.getElementById('accesso-negato-nota') as HTMLParagraphElement;

const saluto = document.getElementById('header-saluto') as HTMLSpanElement;
const bloccoUtente = document.getElementById('menu-utente') as HTMLDivElement;
const inizialiUtente = document.getElementById('menu-utente-iniziali') as HTMLSpanElement;
const salutoUtente = document.getElementById('menu-utente-saluto') as HTMLElement;
const mailUtente = document.getElementById('menu-utente-mail') as HTMLElement;

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
  if (inizialiUtente) inizialiUtente.textContent = iniziali(nome) || (primo[0] || '').toUpperCase();
  if (salutoUtente) salutoUtente.textContent = primo ? `Ciao ${primo}` : '';
  if (mailUtente) mailUtente.textContent = email;
}

function mostraBlocco(quale: 'caricamento' | 'modulo' | 'negato'): void {
  bloccoCaricamento?.classList.toggle('is-hidden', quale !== 'caricamento');
  bloccoModulo?.classList.toggle('is-hidden', quale !== 'modulo');
  bloccoNegato?.classList.toggle('is-hidden', quale !== 'negato');
}

function mostraErrore(testo: string | null): void {
  if (!messaggioErrore) return;

  messaggioErrore.textContent = testo || '';
  messaggioErrore.classList.toggle('is-hidden', !testo);
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

  // La password nuova non va cercata fra quelle salvate
  if (inputPassword) {
    inputPassword.autocomplete = nuovo === 'registrati' ? 'new-password' : 'current-password';
  }

  if (pulsanteInvio) pulsanteInvio.textContent = nuovo === 'registrati' ? 'Registrati' : 'Entra';
}

/**
 * Decide cosa mostrare in base allo stato dell'accesso.
 * Restituisce true se si può usare l'app.
 */
export async function verificaAccesso(): Promise<boolean> {
  if (!schermo) return true;

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

  schede.forEach(s => {
    s.addEventListener('click', () => cambiaModo(s.getAttribute('data-modo') as Modo));
  });

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
