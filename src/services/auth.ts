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
  | { stato: 'dentro'; nome: string }
  | { stato: 'in-attesa'; email: string }
  | { stato: 'fuori' }
  | { stato: 'non-configurato' };

export interface Profilo {
  id: string;
  email: string;
  nome: string;
  accesso: boolean;
}

/** Copia locale del profilo: se la rete manca non si resta chiusi fuori */
const CHIAVE_PROFILO = 'tabaccheria_profilo';

function ricordaProfilo(p: Profilo | null): void {
  try {
    if (p) localStorage.setItem(CHIAVE_PROFILO, JSON.stringify(p));
    else localStorage.removeItem(CHIAVE_PROFILO);
  } catch {
    // Senza LocalStorage il profilo si rilegge a ogni avvio: nessun danno
  }
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
      accesso: Boolean(data.accesso)
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
      return { stato: 'dentro', nome: ricordato.nome || ricordato.email };
    }
    return { stato: 'in-attesa', email: utente.email || '' };
  }

  return profilo.accesso
    ? { stato: 'dentro', nome: profilo.nome || profilo.email }
    : { stato: 'in-attesa', email: profilo.email };
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
