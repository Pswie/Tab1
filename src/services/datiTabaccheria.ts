import { isSupabaseConfigured, supabase } from './supabase';

/**
 * I segreti non fanno parte di questo modello: l'elenco iniziale riceve solo
 * i dati necessari a riconoscere il servizio. La password viene richiesta
 * singolarmente, e soltanto dopo un gesto esplicito della persona.
 */
export interface CredenzialeTabaccheria {
  id: string;
  nomeServizio: string;
  username: string;
  attiva: boolean;
  ordine: number;
  aggiornatoIl: string;
}

export interface ProceduraTabaccheria {
  id: string;
  titolo: string;
  passaggi: string[];
  attiva: boolean;
  ordine: number;
  aggiornatoIl: string;
}

export type CampoCredenziale = 'username' | 'password';
export type AzioneCredenziale = 'visualizza' | 'copia';

function verificaCloud(): void {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Connessione al database non disponibile. Riprova quando torna la rete.');
  }
}

function daCredenziale(riga: Record<string, unknown>): CredenzialeTabaccheria {
  return {
    id: String(riga.id || ''),
    nomeServizio: String(riga.nome_servizio || ''),
    username: String(riga.username || ''),
    attiva: riga.attiva !== false,
    ordine: Number(riga.ordine) || 0,
    aggiornatoIl: String(riga.aggiornata_il || riga.aggiornato_il || '')
  };
}

function daProcedura(riga: Record<string, unknown>): ProceduraTabaccheria {
  const passaggi = Array.isArray(riga.passaggi)
    ? riga.passaggi.map(passaggio => String(passaggio).trim()).filter(Boolean)
    : [];

  return {
    id: String(riga.id || ''),
    titolo: String(riga.titolo || ''),
    passaggi,
    attiva: riga.attiva !== false,
    ordine: Number(riga.ordine) || 0,
    aggiornatoIl: String(riga.aggiornata_il || riga.aggiornato_il || '')
  };
}

function ordina<T extends { ordine: number }>(voci: T[]): T[] {
  return [...voci].sort((a, b) => a.ordine - b.ordine);
}

/** Elenco leggero: per progetto questa RPC non restituisce mai le password. */
export async function elencaCredenzialiTabaccheria(
  includiArchiviate = false
): Promise<CredenzialeTabaccheria[]> {
  verificaCloud();

  const { data, error } = await supabase!.rpc('elenca_credenziali_tabaccheria', {
    p_includi_archiviate: includiArchiviate
  });
  if (error) throw error;

  return ordina((Array.isArray(data) ? data : []).map(riga =>
    daCredenziale(riga as Record<string, unknown>)
  ));
}

/**
 * Recupera un solo valore per mostra o copia. Il server lega la richiesta
 * all'utente corrente e la registra nello storico degli accessi.
 */
export async function usaCredenzialeTabaccheria(
  id: string,
  campo: CampoCredenziale,
  azione: AzioneCredenziale
): Promise<string> {
  verificaCloud();

  const { data, error } = await supabase!.rpc('usa_credenziale_tabaccheria', {
    p_id: id,
    p_campo: campo,
    p_azione: azione
  });
  if (error) throw error;

  // PostgREST rappresenta una funzione scalare come stringa e una funzione
  // RETURNS TABLE come una riga: accettiamo entrambi per non trattenere dati.
  let valore: unknown = data;
  if (Array.isArray(data)) valore = data[0];
  if (valore && typeof valore === 'object') {
    const riga = valore as Record<string, unknown>;
    valore = riga.valore ?? riga.value;
  }

  if (typeof valore !== 'string') throw new Error('Il dato richiesto non è disponibile.');
  return valore;
}

/** Password vuota in modifica significa: conserva quella già presente. */
export async function salvaCredenzialeTabaccheria(
  id: string | null,
  nomeServizio: string,
  username: string,
  password: string
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!.rpc('salva_credenziale_tabaccheria', {
    p_id: id,
    p_nome_servizio: nomeServizio.trim(),
    p_username: username.trim(),
    p_password: password,
    p_ordine: null
  });
  if (error) throw error;
}

export async function impostaCredenzialeTabaccheriaAttiva(
  id: string,
  attiva: boolean
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!.rpc('imposta_credenziale_tabaccheria_attiva', {
    p_id: id,
    p_attiva: attiva
  });
  if (error) throw error;
}

export async function elencaProcedureTabaccheria(
  includiArchiviate = false
): Promise<ProceduraTabaccheria[]> {
  verificaCloud();

  const { data, error } = await supabase!.rpc('elenca_procedure_tabaccheria', {
    p_includi_archiviate: includiArchiviate
  });
  if (error) throw error;

  return ordina((Array.isArray(data) ? data : []).map(riga =>
    daProcedura(riga as Record<string, unknown>)
  ));
}

export async function salvaProceduraTabaccheria(
  id: string | null,
  titolo: string,
  passaggi: string[]
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!.rpc('salva_procedura_tabaccheria', {
    p_id: id,
    p_titolo: titolo.trim(),
    p_passaggi: passaggi.map(passaggio => passaggio.trim()).filter(Boolean),
    p_ordine: null
  });
  if (error) throw error;
}

export async function impostaProceduraTabaccheriaAttiva(
  id: string,
  attiva: boolean
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!.rpc('imposta_procedura_tabaccheria_attiva', {
    p_id: id,
    p_attiva: attiva
  });
  if (error) throw error;
}
