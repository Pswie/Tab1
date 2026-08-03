import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Distributori H24.
 *
 * Le macchine lavorano anche a negozio chiuso, quindi hanno due registri
 * propri: cosa manca dentro, per sapere cosa portare al prossimo giro, e
 * quanto hanno incassato mese per mese, che è poi il totale da dichiarare.
 *
 * Si conta a PACCHI, perché è così che si compra. I pezzi si ricavano dalla
 * scheda del prodotto — quanti pezzi stanno in un pacco — ed è quello che
 * dice per certo quanta roba è uscita dalle macchine.
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
  /** La scheda del prodotto: quanti pezzi contiene un pacco */
  pezziPerPacco: number;
  /** Pacchi che mancano per riempire la macchina: zero vuol dire piena */
  pacchiMancanti: number;
}

export interface IncassoH24 {
  id: string;
  /** YYYY-MM */
  mese: string;

  /** Il totale del mese: la somma delle tre macchine */
  importo: number;

  /**
   * Quanto ha incassato ogni macchina.
   *
   * Le macchine si svuotano una per una e ognuna ha il suo contatore: un
   * totale unico non direbbe quale delle tre sta lavorando e quale no.
   */
  importi: Record<Distributore, number>;

  dichiarato: boolean;
  nota: string;
}

/**
 * Un giro di rifornimento: quello che è stato rimesso dentro alle macchine.
 *
 * È l'unico modo per sapere cosa vende: nella macchina non c'è un registratore
 * di cassa per prodotto, ma quello che si rimette dentro è esattamente quello
 * che è uscito.
 */
export interface Rifornimento {
  nome: string;
  distributore: Distributore;
  pacchi: number;
  pezzi: number;
  /** YYYY-MM-DD */
  giorno: string;
}

const CHIAVE_PRODOTTI = 'tabaccheria_h24_prodotti_v2';
const CHIAVE_INCASSI = 'tabaccheria_h24_incassi_v1';
const CHIAVE_RIFORNIMENTI = 'tabaccheria_h24_rifornimenti_v2';

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

function macchinaValida(valore: unknown): Distributore {
  const macchina = String(valore ?? '');
  // Un prodotto scritto prima che le macchine fossero tre finisce fra i vari
  return DISTRIBUTORI.includes(macchina as Distributore) ? (macchina as Distributore) : 'vari';
}

function prodottoDaRiga(r: Record<string, unknown>): ProdottoH24 {
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    distributore: macchinaValida(r.distributore),
    // Una scheda senza il numero di pezzi vale come pacco da uno: meglio un
    // conto prudente che una moltiplicazione per zero
    pezziPerPacco: Math.max(Number(r.pezzi_per_pacco) || 1, 1),
    pacchiMancanti: Number(r.pacchi_mancanti) || 0
  };
}

/** Le colonne per macchina, con lo stesso nome che hanno sul database */
const COLONNA_INCASSO: Record<Distributore, string> = {
  drink: 'importo_drink',
  snack: 'importo_snack',
  vari: 'importo_vari'
};

export function totaleMacchine(importi: Record<Distributore, number>): number {
  return Number(DISTRIBUTORI.reduce((s, m) => s + (Number(importi[m]) || 0), 0).toFixed(2));
}

function incassoDaRiga(r: Record<string, unknown>): IncassoH24 {
  const importi = {
    drink: Number(r.importo_drink) || 0,
    snack: Number(r.importo_snack) || 0,
    vari: Number(r.importo_vari) || 0
  };

  const somma = totaleMacchine(importi);

  return {
    id: String(r.id),
    mese: meseDaData(String(r.mese ?? '')),
    // Prima le tre macchine si segnavano insieme: su quei mesi resta il totale
    // scritto allora, perché non c'è modo di sapere come dividerlo
    importo: somma !== 0 ? somma : Number(r.importo) || 0,
    importi,
    dichiarato: Boolean(r.dichiarato),
    nota: String(r.nota ?? '')
  };
}

/** Un mese registrato prima che le macchine si segnassero una per una */
export function senzaDettaglio(voce: IncassoH24): boolean {
  return voce.importo !== 0 && totaleMacchine(voce.importi) === 0;
}

/** I pezzi che un prodotto porta con sé quando lo si rifornisce */
export function pezziDiUnProdotto(p: ProdottoH24): number {
  return Math.max(p.pacchiMancanti, 0) * Math.max(p.pezziPerPacco, 1);
}

/**
 * Prima quello che manca, poi il resto in ordine alfabetico.
 * Le macchine restano separate all'atto di mostrarle: qui conta solo che,
 * dentro a ciascuna, in cima ci sia quello da portare.
 */
function inOrdine(voci: ProdottoH24[]): ProdottoH24[] {
  return [...voci].sort((a, b) => {
    if ((a.pacchiMancanti > 0) !== (b.pacchiMancanti > 0)) return a.pacchiMancanti > 0 ? -1 : 1;
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
  pezziPerPacco: number,
  pacchiMancanti = 0
): Promise<ProdottoH24> {
  const perPacco = Math.max(Math.round(pezziPerPacco) || 1, 1);

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_prodotti')
        .insert({
          nome,
          distributore,
          pezzi_per_pacco: perPacco,
          pacchi_mancanti: pacchiMancanti
        })
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
    pezziPerPacco: perPacco,
    pacchiMancanti
  };

  const voci = leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI);
  voci.push(voce);
  scriviLocale(CHIAVE_PRODOTTI, voci);
  return voce;
}

export async function impostaPacchiMancanti(id: string, pacchi: number): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('h24_prodotti')
        .update({ pacchi_mancanti: pacchi, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento prodotto H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI)
      .map(v => (v.id === id ? { ...v, pacchiMancanti: pacchi } : v))
  );
}

/** Correzione della scheda: nome e pezzi per pacco */
export async function modificaScheda(id: string, nome: string, pezziPerPacco: number): Promise<void> {
  const perPacco = Math.max(Math.round(pezziPerPacco) || 1, 1);

  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('h24_prodotti')
        .update({ nome, pezzi_per_pacco: perPacco, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione modifica scheda H24:', err);
    }
  }

  scriviLocale(
    CHIAVE_PRODOTTI,
    leggiLocale<ProdottoH24>(CHIAVE_PRODOTTI)
      .map(v => (v.id === id ? { ...v, nome, pezziPerPacco: perPacco } : v))
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
        .update({ pacchi_mancanti: 0, aggiornato_il: new Date().toISOString() })
        .gt('pacchi_mancanti', 0);

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
      !distributore || v.distributore === distributore ? { ...v, pacchiMancanti: 0 } : v
    )
  );
}

/**
 * Registra quello che è stato rimesso nelle macchine.
 *
 * Si scrive solo quando si dichiara di aver rifornito, non quando si corregge
 * a mano un conteggio sbagliato: un numero ritoccato è una correzione, non
 * merce uscita, e finirebbe per gonfiare le vendite.
 */
export async function registraRifornimento(voci: ProdottoH24[]): Promise<void> {
  const daScrivere = voci.filter(v => v.pacchiMancanti > 0);
  if (daScrivere.length === 0) return;

  const adesso = new Date();
  const giorno = `${adesso.getFullYear()}-${String(adesso.getMonth() + 1).padStart(2, '0')}-${String(adesso.getDate()).padStart(2, '0')}`;

  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('h24_rifornimenti').insert(
        daScrivere.map(v => ({
          prodotto_id: v.id,
          nome: v.nome,
          distributore: v.distributore,
          pacchi: v.pacchiMancanti,
          pezzi_per_pacco: v.pezziPerPacco,
          pezzi: pezziDiUnProdotto(v),
          il: adesso.toISOString()
        }))
      );

      if (!error) return;
      console.warn('Rifornimento salvato solo in locale:', error.message);
    } catch (err) {
      console.warn('Eccezione salvataggio rifornimento:', err);
    }
  }

  const storia = leggiLocale<Rifornimento>(CHIAVE_RIFORNIMENTI);

  daScrivere.forEach(v => {
    storia.push({
      nome: v.nome,
      distributore: v.distributore,
      pacchi: v.pacchiMancanti,
      pezzi: pezziDiUnProdotto(v),
      giorno
    });
  });

  scriviLocale(CHIAVE_RIFORNIMENTI, storia);
}

export async function elencaRifornimenti(): Promise<Rifornimento[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('h24_rifornimenti')
        .select('nome, distributore, pacchi, pezzi, il')
        .order('il', { ascending: false });

      if (!error && data) {
        const voci = data.map((r: Record<string, unknown>) => ({
          nome: String(r.nome ?? ''),
          distributore: macchinaValida(r.distributore),
          pacchi: Number(r.pacchi) || 0,
          pezzi: Number(r.pezzi) || 0,
          giorno: String(r.il ?? '').slice(0, 10)
        }));

        scriviLocale(CHIAVE_RIFORNIMENTI, voci);
        return voci;
      }

      console.warn('Errore lettura rifornimenti:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura rifornimenti:', err);
    }
  }

  return leggiLocale<Rifornimento>(CHIAVE_RIFORNIMENTI);
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

  // Le copie locali scritte prima della divisione per macchina non hanno il
  // dettaglio: si rimette a zero, così chi legge trova sempre le tre voci
  return leggiLocale<IncassoH24>(CHIAVE_INCASSI)
    .map(v => ({
      ...v,
      importi: {
        drink: Number(v.importi?.drink) || 0,
        snack: Number(v.importi?.snack) || 0,
        vari: Number(v.importi?.vari) || 0
      }
    }))
    .sort((a, b) => b.mese.localeCompare(a.mese));
}

/**
 * Scrive l'incasso di un mese, una cifra per macchina, sostituendo quello che
 * c'era. Un mese ha una riga sola: se si ritorna sullo stesso mese si sta
 * correggendo.
 */
export async function salvaIncasso(
  mese: string,
  importi: Record<Distributore, number>,
  nota = ''
): Promise<IncassoH24> {
  const importo = totaleMacchine(importi);

  if (isSupabaseConfigured() && supabase) {
    const riga: Record<string, unknown> = {
      mese: dataDaMese(mese),
      importo,
      nota,
      aggiornato_il: new Date().toISOString()
    };

    DISTRIBUTORI.forEach(m => {
      riga[COLONNA_INCASSO[m]] = importi[m] || 0;
    });

    // Il client va fermato in una costante: dentro alla funzione qui sotto
    // TypeScript non si fida più del controllo fatto sopra
    const db = supabase;

    try {
      const scrivi = (r: Record<string, unknown>) =>
        db.from('h24_incassi').upsert(r, { onConflict: 'mese' }).select().single();

      let { data, error } = await scrivi(riga);

      // Sul database non ancora aggiornato le colonne per macchina non
      // esistono: meglio salvare almeno il totale che perdere il mese
      if (error && /importo_(drink|snack|vari)/.test(error.message)) {
        console.warn(
          'Colonne per macchina assenti su h24_incassi: salvato il solo totale. ' +
          'Esegui supabase_schema.sql per aggiornare lo schema.'
        );

        ({ data, error } = await scrivi({
          mese: dataDaMese(mese),
          importo,
          nota,
          aggiornato_il: new Date().toISOString()
        }));

        if (!error && data) return { ...incassoDaRiga(data), importi };
      }

      if (!error && data) return incassoDaRiga(data);
      console.warn('Incasso H24 salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio incasso H24:', err);
    }
  }

  const voci = leggiLocale<IncassoH24>(CHIAVE_INCASSI);
  const esistente = voci.find(v => v.mese === mese);

  const voce: IncassoH24 = esistente
    ? { ...esistente, importo, importi, nota }
    : {
        id: `h24i-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        mese,
        importo,
        importi,
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
