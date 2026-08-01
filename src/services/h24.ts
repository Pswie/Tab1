import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Distributori H24.
 *
 * Le macchine lavorano anche a negozio chiuso, quindi hanno due registri
 * propri: cosa manca dentro, per sapere cosa portare al prossimo giro, e
 * quanto hanno incassato mese per mese, che è poi il totale da dichiarare.
 */

/** Le tre macchine */
export type Distributore = 'drink' | 'snack' | 'vari';

export const DISTRIBUTORI: Distributore[] = ['drink', 'snack', 'vari'];

export const NOMI_DISTRIBUTORI: Record<Distributore, string> = {
  drink: 'Drink',
  snack: 'Snack',
  vari: 'Vari'
};

export interface ProdottoH24 {
  id: string;
  nome: string;
  /** In quale delle tre macchine sta */
  distributore: Distributore;
  /** Pezzi che mancano per riempire la macchina: zero vuol dire piena */
  mancanti: number;
}

export interface IncassoH24 {
  id: string;
  /** YYYY-MM */
  mese: string;
  importo: number;
  dichiarato: boolean;
  nota: string;
}

const CHIAVE_PRODOTTI = 'tabaccheria_h24_prodotti_v1';
const CHIAVE_INCASSI = 'tabaccheria_h24_incassi_v1';

/** Nel database il mese è il suo primo giorno: qui basta "YYYY-MM" */
function meseDaData(iso: string): string {
  return String(iso).slice(0, 7);
}

function dataDaMese(mese: string): string {
  return `${mese}-01`;
}

function leggiLocale<T>(chiave: string): T[] {
  try {
    const raw = localStorage.getItem(chiave);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale<T>(chiave: string, voci: T[]): void {
  try {
    localStorage.setItem(chiave, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio dati H24', err);
  }
}

function prodottoDaRiga(r: Record<string, unknown>): ProdottoH24 {
  const macchina = String(r.distributore ?? '');

  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    // Un prodotto scritto prima che le macchine fossero tre finisce fra i vari
    distributore: DISTRIBUTORI.includes(macchina as Distributore)
      ? (macchina as Distributore)
      : 'vari',
    mancanti: Number(r.mancanti) || 0
  };
}

function incassoDaRiga(r: Record<string, unknown>): IncassoH24 {
  return {
    id: String(r.id),
    mese: meseDaData(String(r.mese ?? '')),
    importo: Number(r.importo) || 0,
    dichiarato: Boolean(r.dichiarato),
    nota: String(r.nota ?? '')
  };
}

/**
 * Prima quello che manca, poi il resto in ordine alfabetico.
 * Le macchine restano separate all'atto di mostrarle: qui conta solo che,
 * dentro a ciascuna, in cima ci sia quello da portare.
 */
function inOrdine(voci: ProdottoH24[]): ProdottoH24[] {
  return [...voci].sort((a, b) => {
    if ((a.mancanti > 0) !== (b.mancanti > 0)) return a.mancanti > 0 ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
  });
}

export async function elencaProdotti(): Promise<ProdottoH24[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_prodotti')
        .select('*')
        .order('nome', { ascending: true });

      if (!error && data) {
        const voci = inOrdine(data.map(prodottoDaRiga));
        scriviLocale(CHIAVE_PRODOTTI, voci);
        return voci;
      }

      console.warn('Errore lettura prodotti H24:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura prodotti H24:', err);
    }
  }

  return inOrdine(leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI));
}

export async function aggiungiProdotto(
  nome: string,
  distributore: Distributore,
  mancanti = 0
): Promise<ProdottoH24> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_prodotti')
        .insert({ nome, distributore, mancanti })
        .select()
        .single();

      if (!error && data) return prodottoDaRiga(data);
      console.warn('Prodotto H24 salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio prodotto H24:', err);
    }
  }

  const voce: ProdottoH24 = {
    id: `h24p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome,
    distributore,
    mancanti
  };

  const voci = leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI);
  voci.push(voce);
  scriviLocale(CHIAVE_PRODOTTI, voci);
  return voce;
}

export async function impostaMancanti(id: string, mancanti: number): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('h24_prodotti')
        .update({ mancanti, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento prodotto H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI).map(v => (v.id === id ? { ...v, mancanti } : v))
  );
}

/** Un prodotto finito nella macchina sbagliata si sposta, non si riscrive */
export async function spostaProdotto(id: string, distributore: Distributore): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('h24_prodotti')
        .update({ distributore, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione spostamento prodotto H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI).map(v => (v.id === id ? { ...v, distributore } : v))
  );
}

export async function eliminaProdotto(id: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('h24_prodotti').delete().eq('id', id);
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione eliminazione prodotto H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI).filter(v => v.id !== id)
  );
}

/**
 * Dopo il rifornimento la macchina è piena: i conti ripartono da zero.
 * Senza indicare quale, si azzerano tutte e tre.
 */
export async function azzeraMancanti(distributore?: Distributore): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const richiesta = supabase
        .from('h24_prodotti')
        .update({ mancanti: 0, aggiornato_il: new Date().toISOString() })
        .gt('mancanti', 0);

      const { error } = await (distributore
        ? richiesta.eq('distributore', distributore)
        : richiesta);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione azzeramento prodotti H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI).map(v =>
      !distributore || v.distributore === distributore ? { ...v, mancanti: 0 } : v
    )
  );
}

export async function elencaIncassi(): Promise<IncassoH24[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_incassi')
        .select('*')
        .order('mese', { ascending: false });

      if (!error && data) {
        const voci = data.map(incassoDaRiga);
        scriviLocale(CHIAVE_INCASSI, voci);
        return voci;
      }

      console.warn('Errore lettura incassi H24:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura incassi H24:', err);
    }
  }

  return leggiLocale<IncassoH24>(CHIAVE_INCASSI)
    .sort((a, b) => b.mese.localeCompare(a.mese));
}

/**
 * Scrive l'incasso di un mese, sostituendo quello che c'era.
 * Un mese ha un totale solo: se si ritorna sullo stesso mese si sta correggendo.
 */
export async function salvaIncasso(mese: string, importo: number, nota = ''): Promise<IncassoH24> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_incassi')
        .upsert(
          { mese: dataDaMese(mese), importo, nota, aggiornato_il: new Date().toISOString() },
          { onConflict: 'mese' }
        )
        .select()
        .single();

      if (!error && data) return incassoDaRiga(data);
      console.warn('Incasso H24 salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio incasso H24:', err);
    }
  }

  const voci = leggiLocale<IncassoH24>(CHIAVE_INCASSI);
  const esistente = voci.find(v => v.mese === mese);

  const voce: IncassoH24 = esistente
    ? { ...esistente, importo, nota }
    : {
        id: `h24i-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        mese,
        importo,
        dichiarato: false,
        nota
      };

  scriviLocale(CHIAVE_INCASSI, [...voci.filter(v => v.mese !== mese), voce]);
  return voce;
}

export async function impostaDichiarato(mese: string, dichiarato: boolean): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('h24_incassi')
        .update({
          dichiarato,
          dichiarato_il: dichiarato ? new Date().toISOString() : null,
          aggiornato_il: new Date().toISOString()
        })
        .eq('mese', dataDaMese(mese));

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento dichiarazione H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_INCASSI,
    leggiLocale<IncassoH24>(CHIAVE_INCASSI).map(v => (v.mese === mese ? { ...v, dichiarato } : v))
  );
}

export async function eliminaIncasso(mese: string): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('h24_incassi').delete().eq('mese', dataDaMese(mese));
      if (!error) return;
    } catch (err) {
      console.warn('Eccezione eliminazione incasso H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_INCASSI,
    leggiLocale<IncassoH24>(CHIAVE_INCASSI).filter(v => v.mese !== mese)
  );
}
