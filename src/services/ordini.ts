import { isSupabaseConfigured, supabase } from './supabase';

/** Giorno ISO della settimana: lunedi = 1, domenica = 7. */
export type GiornoOrdine = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OrdineSettimanale {
  id: string;
  voce: string;
  giornoSettimana: GiornoOrdine;
  attivo: boolean;
  ordine: number;
  creatoIl: string;
  aggiornatoIl: string;
}

export interface ElencoOrdini {
  voci: OrdineSettimanale[];
  origine: 'cloud' | 'cache';
}

const CHIAVE_CACHE = 'tabaccheria_ordini_settimanali_v1';

function giornoValido(valore: unknown): GiornoOrdine {
  const numero = Number(valore);
  return numero >= 1 && numero <= 7 ? numero as GiornoOrdine : 1;
}

function daRiga(riga: Record<string, unknown>): OrdineSettimanale {
  return {
    id: String(riga.id || ''),
    voce: String(riga.voce || ''),
    giornoSettimana: giornoValido(riga.giorno_settimana),
    attivo: riga.attivo !== false,
    ordine: Number(riga.ordine) || 0,
    creatoIl: String(riga.creato_il || ''),
    aggiornatoIl: String(riga.aggiornato_il || '')
  };
}

function inOrdine(voci: OrdineSettimanale[]): OrdineSettimanale[] {
  return [...voci].sort((a, b) =>
    a.giornoSettimana - b.giornoSettimana ||
    a.ordine - b.ordine ||
    a.voce.localeCompare(b.voce, 'it', { sensitivity: 'base' })
  );
}

function leggiCache(): OrdineSettimanale[] {
  try {
    const salvate = JSON.parse(localStorage.getItem(CHIAVE_CACHE) || '[]') as unknown;
    if (!Array.isArray(salvate)) return [];
    return inOrdine(salvate.map(voce => daRiga({
      ...(voce as Record<string, unknown>),
      giorno_settimana: (voce as Record<string, unknown>).giornoSettimana,
      creato_il: (voce as Record<string, unknown>).creatoIl,
      aggiornato_il: (voce as Record<string, unknown>).aggiornatoIl
    })));
  } catch {
    return [];
  }
}

function scriviCache(voci: OrdineSettimanale[]): void {
  try {
    localStorage.setItem(CHIAVE_CACHE, JSON.stringify(inOrdine(voci)));
  } catch {
    // La cache e' soltanto un aiuto senza rete: il dato autorevole resta sul cloud.
  }
}

/**
 * Elenco condiviso degli ordini. Chi amministra chiede anche le voci spente,
 * cosi' puo' riattivarle senza perdere lo storico.
 */
export async function elencaOrdini(includiDisattivati = false): Promise<ElencoOrdini> {
  if (isSupabaseConfigured() && supabase) {
    try {
      let richiesta = supabase
        .from('ordini_settimanali')
        .select('id, voce, giorno_settimana, attivo, ordine, creato_il, aggiornato_il')
        .order('giorno_settimana', { ascending: true })
        .order('ordine', { ascending: true })
        .order('voce', { ascending: true });

      if (!includiDisattivati) richiesta = richiesta.eq('attivo', true);

      const { data, error } = await richiesta;
      if (error) throw error;

      const voci = inOrdine((data || []).map(riga => daRiga(riga as Record<string, unknown>)));
      scriviCache(voci);
      return { voci, origine: 'cloud' };
    } catch (errore) {
      const cache = leggiCache();
      if (cache.length > 0) {
        return {
          voci: includiDisattivati ? cache : cache.filter(voce => voce.attivo),
          origine: 'cache'
        };
      }
      throw errore;
    }
  }

  const cache = leggiCache();
  return {
    voci: includiDisattivati ? cache : cache.filter(voce => voce.attivo),
    origine: 'cache'
  };
}

function verificaCloud(): void {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Connessione al database non disponibile. Riprova quando torna la rete.');
  }
}

/** Aggiunge una voce ricorrente; il promemoria resta sempre fissato alle 07:00. */
export async function aggiungiOrdine(
  voce: string,
  giornoSettimana: GiornoOrdine,
  posizione: number
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!
    .from('ordini_settimanali')
    .insert({
      voce: voce.trim(),
      giorno_settimana: giornoSettimana,
      ordine: posizione,
      attivo: true
    })
    .select('id')
    .single();

  if (error) throw error;
}

/** Corregge nome e giorno senza cambiare l'identita' della notifica. */
export async function modificaOrdine(
  id: string,
  voce: string,
  giornoSettimana: GiornoOrdine
): Promise<void> {
  verificaCloud();

  const { error } = await supabase!
    .from('ordini_settimanali')
    .update({
      voce: voce.trim(),
      giorno_settimana: giornoSettimana,
      aggiornato_il: new Date().toISOString()
    })
    .eq('id', id)
    .select('id')
    .single();

  if (error) throw error;
}

/**
 * Non cancella righe: spegnere e riattivare conserva lo storico delle
 * notifiche gia' inviate e impedisce cancellazioni accidentali definitive.
 */
export async function impostaOrdineAttivo(id: string, attivo: boolean): Promise<void> {
  verificaCloud();

  const { error } = await supabase!
    .from('ordini_settimanali')
    .update({ attivo, aggiornato_il: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .single();

  if (error) throw error;
}
