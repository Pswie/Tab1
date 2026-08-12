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

const confrontoNomi = new Intl.Collator('it', {
  usage: 'sort',
  sensitivity: 'base',
  ignorePunctuation: true,
  numeric: true
});

const confrontoDettagli = new Intl.Collator('it', {
  usage: 'sort',
  sensitivity: 'variant',
  numeric: true
});

function nomeNormalizzato(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ');
}

/**
 * Ordine alfabetico italiano, naturale e deterministico.
 *
 * Accenti, maiuscole e punteggiatura non separano contatti che una persona
 * cercherebbe insieme; numero e id rendono stabile anche l'ordine degli
 * omonimi, indipendentemente da come il database restituisce le righe.
 */
export function ordinaContatti(voci: readonly Contatto[]): Contatto[] {
  return [...voci].sort((a, b) => {
    const nomeA = nomeNormalizzato(a.nome);
    const nomeB = nomeNormalizzato(b.nome);

    return confrontoNomi.compare(nomeA, nomeB)
      || confrontoDettagli.compare(nomeA, nomeB)
      || confrontoDettagli.compare(a.telefono, b.telefono)
      || confrontoDettagli.compare(a.id, b.id);
  });
}

export async function elencaContatti(): Promise<Contatto[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('rubrica')
        .select('*')
        .order('nome', { ascending: true });

      if (!error && data) {
        const voci = ordinaContatti(data.map(daRiga));
        scriviLocale(voci);
        return voci;
      }

      console.warn('Errore lettura rubrica:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura rubrica:', err);
    }
  }

  return ordinaContatti(leggiLocale());
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
