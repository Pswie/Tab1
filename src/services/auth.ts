import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Accesso all'app.
 *
 * Chiunque può registrarsi, ma nessuno entra finché il titolare non mette a
 * true la colonna `accesso` nella tabella `profili` su Supabase.
 *
 * La sessione non scade: il client Supabase la conserva nel dispositivo e
 * rinnova da solo il token prima della scadenza, quindi chi è entrato una
 * volta resta dentro anche a distanza di mesi.
 */

export type EsitoAccesso =
  | { stato: 'dentro'; nome: string; email: string; admin: boolean }
  | { stato: 'in-attesa'; email: string }
  | { stato: 'fuori' }
  | { stato: 'non-configurato' };

export interface Profilo {
  id: string;
  email: string;
  nome: string;
  accesso: boolean;

  /** Chi amministra vede in più la dashboard di incassi e statistiche */
  admin: boolean;

  /** Può aggiungere, aggiornare e togliere i turni di lavoro */
  gestioneTurni: boolean;

  /** Può modificare giorni e responsabili delle pulizie aperte */
  gestionePulizie: boolean;

  /** Corregge il formato abituale "1,500,45" negli importi della chiusura */
  correzioneImportiVirgole: boolean;
}

/** Copia locale del profilo: se la rete manca non si resta chiusi fuori */
const CHIAVE_PROFILO = 'tabaccheria_profilo';

function ricordaProfilo(p: Profilo | null): void {
  const precedente = profiloRicordato();
  try {
    if (p) localStorage.setItem(CHIAVE_PROFILO, JSON.stringify(p));
    else localStorage.removeItem(CHIAVE_PROFILO);
  } catch {
    // Senza LocalStorage il profilo si rilegge a ogni avvio: nessun danno
  }
  const permessi = (profilo: Profilo | null) => JSON.stringify([
    profilo?.id, Boolean(profilo?.accesso), Boolean(profilo?.admin),
    Boolean(profilo?.gestioneTurni), Boolean(profilo?.gestionePulizie)
  ]);
  if (permessi(precedente) !== permessi(p)) window.dispatchEvent(new Event('permessi-aggiornati'));
}

function profiloRicordato(): Profilo | null {
  try {
    const raw = localStorage.getItem(CHIAVE_PROFILO);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function leggiProfilo(id: string): Promise<Profilo | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('profili')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    const profilo: Profilo = {
      id: String(data.id),
      email: String(data.email || ''),
      nome: String(data.nome || ''),
      accesso: Boolean(data.accesso),
      admin: Boolean(data.admin),
      gestioneTurni: Boolean(data.gestione_turni),
      gestionePulizie: Boolean(data.gestione_pulizie),
      correzioneImportiVirgole: Boolean(data.correzione_importi_virgole)
    };

    ricordaProfilo(profilo);
    return profilo;
  } catch {
    return null;
  }
}

/**
 * Stato dell'accesso all'avvio.
 *
 * Se il profilo non si riesce a leggere ma la sessione è valida e l'ultima
 * volta l'accesso c'era, si entra lo stesso: un momento di rete assente non
 * deve chiudere fuori chi era già stato ammesso.
 */
export async function statoAccesso(): Promise<EsitoAccesso> {
  if (!isSupabaseConfigured() || !supabase) return { stato: 'non-configurato' };

  const { data } = await supabase.auth.getSession();
  const utente = data.session?.user;

  if (!utente) return { stato: 'fuori' };

  const profilo = await leggiProfilo(utente.id);

  if (!profilo) {
    const ricordato = profiloRicordato();
    if (ricordato && ricordato.id === utente.id && ricordato.accesso) {
      return {
        stato: 'dentro',
        nome: ricordato.nome || ricordato.email,
        email: ricordato.email,
        admin: Boolean(ricordato.admin)
      };
    }
    return { stato: 'in-attesa', email: utente.email || '' };
  }

  return profilo.accesso
    ? {
        stato: 'dentro',
        nome: profilo.nome || profilo.email,
        email: profilo.email,
        admin: profilo.admin
      }
    : { stato: 'in-attesa', email: profilo.email };
}

/**
 * Nome di chi sta usando l'app, per firmare quello che scrive.
 * Vuoto se non si è passati dall'accesso (installazione senza Supabase).
 */
export function nomeUtente(): string {
  const p = profiloRicordato();
  if (!p || !p.accesso) return '';

  return p.nome || p.email || '';
}

/** Identità stabile del profilo, utile quando lo storico usa un soprannome. */
export function idUtente(): string {
  const p = profiloRicordato();
  return p && p.accesso ? p.id : '';
}

/**
 * Se chi sta usando l'app amministra, e quindi vede anche la dashboard.
 *
 * Decide solo cosa mostrare: i registri restano leggibili da chiunque abbia
 * l'accesso, quindi nascondere la dashboard è una comodità e non una barriera.
 */
export function amministratore(): boolean {
  const p = profiloRicordato();
  return Boolean(p && p.accesso && p.admin);
}

/**
 * Il calendario dei turni ha un permesso proprio: chi lo riceve non diventa
 * amministratore e non vede dashboard, H24 o giornate storiche della cassa.
 */
export function puoGestireTurni(): boolean {
  const p = profiloRicordato();
  return Boolean(p && p.accesso && (p.admin || p.gestioneTurni));
}

export function puoGestirePulizie(): boolean {
  const p = profiloRicordato();
  return Boolean(p && p.accesso && (p.admin || p.gestionePulizie));
}

let aggiornamentoPermessi: Promise<void> | null = null;
let ultimoAggiornamentoPermessi = 0;
let aggiornamentoPermessiAvviato = false;

/** Aggiorna solo la visibilità dei comandi: ogni scrittura ricontrolla i permessi sul server. */
export async function aggiornaPermessi(): Promise<void> {
  if (!supabase || !isSupabaseConfigured()) return;
  if (aggiornamentoPermessi) return aggiornamentoPermessi;
  if (Date.now() - ultimoAggiornamentoPermessi < 10000) return;
  ultimoAggiornamentoPermessi = Date.now();
  aggiornamentoPermessi = (async () => {
    try {
      const { data, error } = await supabase!.auth.getSession();
      if (error) return;
      if (data.session?.user) await leggiProfilo(data.session.user.id);
      else ricordaProfilo(null);
    } catch {
      // La consultazione offline resta disponibile; le scritture richiedono il server.
    }
  })().finally(() => { aggiornamentoPermessi = null; });
  return aggiornamentoPermessi;
}

export function initAggiornamentoPermessi(): void {
  if (aggiornamentoPermessiAvviato) return;
  aggiornamentoPermessiAvviato = true;
  window.addEventListener('focus', () => { void aggiornaPermessi(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void aggiornaPermessi();
  });
  window.setInterval(() => { if (!document.hidden) void aggiornaPermessi(); }, 60000);
}

/** Attiva la correzione del formato importi soltanto sul profilo previsto */
export function correggiImportiConVirgole(): boolean {
  const p = profiloRicordato();
  return Boolean(p && p.accesso && p.correzioneImportiVirgole);
}

export async function registrati(email: string, password: string, nome: string): Promise<string | null> {
  if (!supabase) return 'Accesso non configurato';

  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { nome: nome.trim() } }
  });

  if (!error) return null;

  if (error.message.toLowerCase().includes('already registered')) {
    return 'Questa email è già registrata: usa Accedi.';
  }

  return error.message;
}

export async function accedi(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Accesso non configurato';

  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (!error) return null;

  if (error.message.toLowerCase().includes('invalid login')) {
    return 'Email o password non corretti.';
  }

  if (error.message.toLowerCase().includes('not confirmed')) {
    return 'Email non ancora confermata.';
  }

  return error.message;
}

export async function esci(): Promise<void> {
  ricordaProfilo(null);
  if (supabase) await supabase.auth.signOut();
}
