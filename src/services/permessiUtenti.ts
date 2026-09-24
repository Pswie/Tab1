import { amministratore } from './auth';
import { isSupabaseConfigured, supabase } from './supabase';

export interface PermessiUtente {
  id: string;
  nome: string;
  email: string;
  gestioneTurni: boolean;
  gestionePulizie: boolean;
}

export type AmbitoModifica = 'turni' | 'pulizie' | 'permessi';
export interface ModificaGestione {
  id: string;
  autoreId: string | null;
  autoreNome: string;
  creataIl: string;
  ambito: AmbitoModifica;
  azione: string;
  oggetto: string;
  prima: unknown;
  dopo: unknown;
}
export interface FiltriModifiche {
  autore: string;
  ambito: string;
  dal: string;
  al: string;
}

export interface AutoreModifiche { id: string; nome: string }

function clientAdmin() {
  if (!amministratore()) throw new Error('Solo l’amministratore può consultare permessi e attività.');
  if (!isSupabaseConfigured() || !supabase) throw new Error('Collegati al servizio per consultare permessi e attività.');
  return supabase;
}

function erroreServizio(errore: { code?: string; message: string }, salvataggio = false): Error {
  if (errore.code === '42501') return new Error('Non hai il permesso di accedere a questa funzione.');
  if (errore.code === '22023') return new Error(errore.message);
  return new Error(salvataggio
    ? 'Permessi non salvati. Controlla la connessione e riprova.'
    : 'Impossibile aggiornare i dati. Controlla la connessione e riprova.');
}

function leggiUtente(valore: unknown): PermessiUtente {
  if (!valore || typeof valore !== 'object') throw new Error('Dati utente non disponibili. Riprova.');
  const riga = valore as Record<string, unknown>;
  if (!riga.id || !riga.nome || !riga.accesso || riga.admin) throw new Error('Il dipendente non è più disponibile per la gestione dei permessi. Aggiorna l’elenco.');
  return {
    id: String(riga.id), nome: String(riga.nome), email: String(riga.email ?? ''),
    gestioneTurni: riga.gestione_turni === true, gestionePulizie: riga.gestione_pulizie === true
  };
}

/** Dati amministrativi solo in memoria, senza copie nel dispositivo. */
export async function elencaPermessiUtenti(): Promise<PermessiUtente[]> {
  const { data, error } = await clientAdmin().rpc('elenca_permessi_utenti');
  if (error) throw erroreServizio(error);
  if (!Array.isArray(data)) throw new Error('Elenco utenti non disponibile. Riprova.');
  return data.filter(riga => riga && riga.accesso === true && riga.admin !== true)
    .map(leggiUtente).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

export async function salvaPermessiUtente(id: string, gestioneTurni: boolean, gestionePulizie: boolean): Promise<PermessiUtente> {
  const { data, error } = await clientAdmin().rpc('salva_permessi_utente', {
    p_profilo_id: id, p_gestione_turni: gestioneTurni, p_gestione_pulizie: gestionePulizie
  });
  if (error) throw erroreServizio(error, true);
  const salvata = leggiUtente(Array.isArray(data) ? data[0] : data);
  if (salvata.id !== id) throw new Error('Salvataggio non confermato. Aggiorna l’elenco prima di riprovare.');
  return salvata;
}

export async function elencaModificheGestione(filtri: FiltriModifiche, primaId: string | null = null): Promise<ModificaGestione[]> {
  const { data, error } = await clientAdmin().rpc('elenca_modifiche_gestione', {
    p_autore: filtri.autore || null, p_ambito: filtri.ambito || null,
    p_dal: filtri.dal || null, p_al: filtri.al || null, p_prima_id: primaId, p_limite: 50
  });
  if (error) throw erroreServizio(error);
  if (!Array.isArray(data)) throw new Error('Registro delle modifiche non disponibile. Riprova.');
  return data.map(riga => ({
    id: String(riga.id), autoreId: riga.autore_id ? String(riga.autore_id) : null,
    autoreNome: String(riga.autore_nome || 'Utente non disponibile'), creataIl: String(riga.creata_il),
    ambito: riga.ambito as AmbitoModifica, azione: String(riga.azione), oggetto: String(riga.oggetto || ''),
    prima: riga.prima, dopo: riga.dopo
  }));
}

/** Include anche gli autori storici che non compaiono più fra i dipendenti approvati. */
export async function elencaAutoriModificheGestione(): Promise<AutoreModifiche[]> {
  const { data, error } = await clientAdmin().rpc('elenca_autori_modifiche_gestione');
  if (error) throw new Error(error.code === '42501'
    ? 'Non hai il permesso di consultare gli autori delle modifiche.'
    : 'Elenco completo degli autori non disponibile. Riprova il caricamento.');
  if (!Array.isArray(data)) throw new Error('Elenco completo degli autori non disponibile. Riprova il caricamento.');
  return data.map(riga => ({ id: String(riga.id), nome: String(riga.nome || 'Utente non disponibile') }));
}
