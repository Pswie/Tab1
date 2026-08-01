import { TodoItem } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Le attività non appartengono a una giornata: restano in elenco finché non
 * vengono svolte. Sono quindi conservate a parte rispetto ai dati del giorno.
 */

const CHIAVE_LOCALE = 'tabaccheria_attivita_v1';

function daRiga(r: Record<string, unknown>): TodoItem {
  const creata = r.creata_il ? new Date(String(r.creata_il)) : new Date();

  return {
    id: String(r.id),
    text: String(r.testo ?? ''),
    completed: Boolean(r.completata),
    createdBy: String(r.creata_da || 'Dipendente'),
    createdAt: creata.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  };
}

function leggiLocale(): TodoItem[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale(voci: TodoItem[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio attività', err);
  }
}

export async function elencaAttivita(): Promise<TodoItem[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('attivita')
        .select('*')
        .order('completata')
        .order('creata_il', { ascending: false });

      if (!error && data) {
        const voci = data.map(daRiga);
        scriviLocale(voci);
        return voci;
      }

      console.warn('Errore lettura attività:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura attività:', err);
    }
  }

  return leggiLocale();
}

export async function aggiungiAttivita(testo: string, autore = 'Dipendente'): Promise<TodoItem> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('attivita')
        .insert({ testo, creata_da: autore })
        .select()
        .single();

      if (!error && data) return daRiga(data);
      console.warn('Attività salvata solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio attività:', err);
    }
  }

  const voce: TodoItem = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: testo,
    completed: false,
    createdBy: autore,
    createdAt: new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  };

  const voci = leggiLocale();
  voci.unshift(voce);
  scriviLocale(voci);
  return voce;
}

export async function impostaCompletata(id: string, completata: boolean): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('attivita')
        .update({ completata, completata_il: completata ? new Date().toISOString() : null })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento attività:', err);
    }
  }

  scriviLocale(leggiLocale().map(v => (v.id === id ? { ...v, completed: completata } : v)));
}

export async function modificaTesto(id: string, testo: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('attivita').update({ testo }).eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione modifica attività:', err);
    }
  }

  scriviLocale(leggiLocale().map(v => (v.id === id ? { ...v, text: testo } : v)));
}

export async function eliminaAttivita(id: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('attivita').delete().eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione eliminazione attività:', err);
    }
  }

  scriviLocale(leggiLocale().filter(v => v.id !== id));
}

export async function svuotaCompletate(): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('attivita').delete().eq('completata', true);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione svuotamento attività:', err);
    }
  }

  scriviLocale(leggiLocale().filter(v => !v.completed));
}
