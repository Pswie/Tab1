import { CATALOGO_GRATTA_E_VINCI } from '../data/grattaEVinci';
import { CATALOGO_TABACCHI, GruppoTabacchi } from '../data/tabacchi';
import { isSupabaseConfigured, supabase } from './supabase';

export type CategoriaTabacco = GruppoTabacchi['categoria'];

export interface VoceCatalogoGratta {
  gioco: string;
  prezzo: number;
  pezziPerPacco: number;
}

export interface VoceCatalogoTabacco {
  prodotto: string;
  marca: string;
  categoria: CategoriaTabacco;
}

const CHIAVE_GRATTA = 'tabaccheria_catalogo_gratta_v1';
const CHIAVE_TABACCHI = 'tabaccheria_catalogo_tabacchi_v1';

/** Elenco iniziale dei Gratta e Vinci, ricavato dagli ordini */
function semiGratta(): VoceCatalogoGratta[] {
  const voci: VoceCatalogoGratta[] = [];

  CATALOGO_GRATTA_E_VINCI.forEach(gruppo => {
    gruppo.giochi.forEach(gioco => {
      voci.push({ gioco, prezzo: gruppo.prezzo, pezziPerPacco: gruppo.pezziPerPacco });
    });
  });

  return voci;
}

/** Elenco iniziale dei tabacchi, ricavato dalle fatture */
function semiTabacchi(): VoceCatalogoTabacco[] {
  const voci: VoceCatalogoTabacco[] = [];

  CATALOGO_TABACCHI.forEach(gruppo => {
    gruppo.prodotti.forEach(prodotto => {
      voci.push({ prodotto, marca: gruppo.marca, categoria: gruppo.categoria });
    });
  });

  return voci;
}

function leggiLocale<T>(chiave: string): T[] | null {
  try {
    const raw = localStorage.getItem(chiave);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}

function scriviLocale<T>(chiave: string, voci: T[]): void {
  try {
    localStorage.setItem(chiave, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio catalogo in LocalStorage', err);
  }
}

/**
 * Carica il catalogo dei Gratta e Vinci. La prima volta che la tabella è vuota
 * la riempie con gli articoli ricavati dagli ordini, così l'elenco è già
 * pronto senza doverlo digitare a mano.
 */
export async function caricaCatalogoGratta(): Promise<VoceCatalogoGratta[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('catalogo_gratta_e_vinci')
        .select('*')
        .order('prezzo')
        .order('gioco');

      if (!error && data) {
        if (data.length === 0) {
          const semi = semiGratta();
          await supabase.from('catalogo_gratta_e_vinci').insert(
            semi.map(v => ({ gioco: v.gioco, prezzo: v.prezzo, pezzi_per_pacco: v.pezziPerPacco }))
          );
          scriviLocale(CHIAVE_GRATTA, semi);
          return semi;
        }

        const voci = data.map(r => ({
          gioco: r.gioco as string,
          prezzo: Number(r.prezzo) || 0,
          pezziPerPacco: Number(r.pezzi_per_pacco) || 0
        }));

        scriviLocale(CHIAVE_GRATTA, voci);
        return voci;
      }

      console.warn('Errore lettura catalogo Gratta e Vinci:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura catalogo Gratta e Vinci:', err);
    }
  }

  return leggiLocale<VoceCatalogoGratta>(CHIAVE_GRATTA) || semiGratta();
}

/**
 * Carica il catalogo dei tabacchi, seminandolo se la tabella è vuota
 */
export async function caricaCatalogoTabacchi(): Promise<VoceCatalogoTabacco[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('catalogo_tabacchi')
        .select('*')
        .order('categoria')
        .order('marca')
        .order('prodotto');

      if (!error && data) {
        if (data.length === 0) {
          const semi = semiTabacchi();
          await supabase.from('catalogo_tabacchi').insert(semi);
          scriviLocale(CHIAVE_TABACCHI, semi);
          return semi;
        }

        const voci = data.map(r => ({
          prodotto: r.prodotto as string,
          marca: r.marca as string,
          categoria: r.categoria as CategoriaTabacco
        }));

        scriviLocale(CHIAVE_TABACCHI, voci);
        return voci;
      }

      console.warn('Errore lettura catalogo tabacchi:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura catalogo tabacchi:', err);
    }
  }

  return leggiLocale<VoceCatalogoTabacco>(CHIAVE_TABACCHI) || semiTabacchi();
}

export async function aggiungiGratta(voce: VoceCatalogoGratta): Promise<boolean> {
  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_gratta_e_vinci').insert({
      gioco: voce.gioco,
      prezzo: voce.prezzo,
      pezzi_per_pacco: voce.pezziPerPacco
    });

    if (error) {
      console.error('Errore inserimento gioco:', error.message);
      return false;
    }
  }

  return true;
}

export async function eliminaGratta(gioco: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    await supabase.from('catalogo_gratta_e_vinci').delete().eq('gioco', gioco);
  }
}

export async function aggiungiTabacco(voce: VoceCatalogoTabacco): Promise<boolean> {
  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_tabacchi').insert(voce);

    if (error) {
      console.error('Errore inserimento prodotto:', error.message);
      return false;
    }
  }

  return true;
}

export async function eliminaTabacco(prodotto: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    await supabase.from('catalogo_tabacchi').delete().eq('prodotto', prodotto);
  }
}

/** Tiene allineata la copia locale dopo una modifica */
export function salvaCopiaLocale(gratta: VoceCatalogoGratta[], tabacchi: VoceCatalogoTabacco[]): void {
  scriviLocale(CHIAVE_GRATTA, gratta);
  scriviLocale(CHIAVE_TABACCHI, tabacchi);
}
