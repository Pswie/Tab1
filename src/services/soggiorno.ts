import { isSupabaseConfigured, supabase } from './supabase';

/** Tariffa a persona per notte, come da regolamento comunale */
export const TARIFFA_A_PERSONA = 3;

export interface Soggiorno {
  id: string;
  nome: string;
  cognome: string;
  persone: number;
  giorni: number;
  tariffa: number;
  importo: number;
  pagata: boolean;
  data_arrivo?: string;
}

const CHIAVE_LOCALE = 'tabaccheria_soggiorni_v1';

/** Giorni x tariffa x persone: una coppia per 5 notti a 3 € fa 30 € */
export function calcolaImporto(giorni: number, persone: number, tariffa = TARIFFA_A_PERSONA): number {
  return Number((giorni * tariffa * persone).toFixed(2));
}

function leggiLocale(): Soggiorno[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale(voci: Soggiorno[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio soggiorni', err);
  }
}

function daRiga(r: Record<string, unknown>): Soggiorno {
  const giorni = Number(r.giorni) || 0;
  const persone = Number(r.persone) || 0;
  const tariffa = Number(r.tariffa) || TARIFFA_A_PERSONA;

  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    cognome: String(r.cognome ?? ''),
    persone,
    giorni,
    tariffa,
    // Se l'importo arriva dal database è già calcolato; altrimenti lo si rifà
    importo: r.importo !== undefined && r.importo !== null
      ? Number(r.importo)
      : calcolaImporto(giorni, persone, tariffa),
    pagata: Boolean(r.pagata),
    data_arrivo: r.data_arrivo ? String(r.data_arrivo) : undefined
  };
}

export async function elencaSoggiorni(): Promise<Soggiorno[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('tassa_soggiorno')
        .select('*')
        .order('pagata')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const voci = data.map(daRiga);
        scriviLocale(voci);
        return voci;
      }

      console.warn('Errore lettura soggiorni:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura soggiorni:', err);
    }
  }

  return leggiLocale();
}

export async function aggiungiSoggiorno(
  voce: Omit<Soggiorno, 'id' | 'importo'>
): Promise<Soggiorno> {
  const importo = calcolaImporto(voce.giorni, voce.persone, voce.tariffa);

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('tassa_soggiorno')
        .insert({
          nome: voce.nome,
          cognome: voce.cognome,
          persone: voce.persone,
          giorni: voce.giorni,
          tariffa: voce.tariffa,
          pagata: voce.pagata,
          data_arrivo: voce.data_arrivo || null
        })
        .select()
        .single();

      if (!error && data) return daRiga(data);
      console.warn('Soggiorno salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio soggiorno:', err);
    }
  }

  const locale: Soggiorno = { ...voce, id: `loc-${Date.now()}`, importo };
  const voci = leggiLocale();
  voci.unshift(locale);
  scriviLocale(voci);
  return locale;
}

export async function segnaPagata(id: string, pagata: boolean): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('tassa_soggiorno').update({ pagata }).eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento soggiorno:', err);
    }
  }

  const voci = leggiLocale().map(v => (v.id === id ? { ...v, pagata } : v));
  scriviLocale(voci);
}

export async function eliminaSoggiorno(id: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('tassa_soggiorno').delete().eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione eliminazione soggiorno:', err);
    }
  }

  scriviLocale(leggiLocale().filter(v => v.id !== id));
}
