import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Registro numeri: la rubrica del negozio.
 *
 * Un nome e un numero, niente altro. Sta sul database e non sul telefono di
 * chi l'ha scritto, così quando serve richiamare qualcuno il numero c'è per
 * tutti, anche da un altro dispositivo.
 */

export interface Contatto {
  id: string;
  nome: string;
  telefono: string;
  /** Chi l'ha messo in elenco: se il numero non torna si sa a chi chiedere */
  scrittoDa: string;
}

const CHIAVE_LOCALE = 'tabaccheria_rubrica_v1';

function daRiga(r: Record<string, unknown>): Contatto {
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    telefono: String(r.telefono ?? ''),
    scrittoDa: String(r.creato_da || '')
  };
}

function leggiLocale(): Contatto[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale(voci: Contatto[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio rubrica', err);
  }
}

/** In ordine alfabetico, come si cerca un nome in un elenco */
function inOrdine(voci: Contatto[]): Contatto[] {
  return [...voci].sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
}

export async function elencaContatti(): Promise<Contatto[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('rubrica')
        .select('*')
        .order('nome', { ascending: true });

      if (!error && data) {
        const voci = inOrdine(data.map(daRiga));
        scriviLocale(voci);
        return voci;
      }

      console.warn('Errore lettura rubrica:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura rubrica:', err);
    }
  }

  return inOrdine(leggiLocale());
}

export async function aggiungiContatto(nome: string, telefono: string, autore = ''): Promise<Contatto> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('rubrica')
        .insert({ nome, telefono, creato_da: autore })
        .select()
        .single();

      if (!error && data) return daRiga(data);
      console.warn('Contatto salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio contatto:', err);
    }
  }

  const voce: Contatto = {
    id: `rub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome,
    telefono,
    scrittoDa: autore
  };

  const voci = leggiLocale();
  voci.push(voce);
  scriviLocale(voci);
  return voce;
}

export async function modificaContatto(id: string, nome: string, telefono: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('rubrica')
        .update({ nome, telefono, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione modifica contatto:', err);
    }
  }

  scriviLocale(leggiLocale().map(v => (v.id === id ? { ...v, nome, telefono } : v)));
}

export async function eliminaContatto(id: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('rubrica').delete().eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione eliminazione contatto:', err);
    }
  }

  scriviLocale(leggiLocale().filter(v => v.id !== id));
}
