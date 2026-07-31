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
const CHIAVE_PENDENTI = 'tabaccheria_catalogo_pendenti_v1';

/**
 * Modifiche al catalogo non ancora arrivate al database.
 *
 * Se la scrittura fallisce (rete assente, tabella non ancora creata) la voce
 * aggiunta resterebbe solo in memoria e sparirebbe al primo ricaricamento.
 * Qui viene messa in coda e riprovata a ogni avvio, così quello che si
 * aggiunge resta finché non lo si toglie davvero.
 */
interface Pendenti {
  grattaAggiunti: VoceCatalogoGratta[];
  grattaRimossi: string[];
  tabacchiAggiunti: VoceCatalogoTabacco[];
  tabacchiRimossi: string[];
}

function pendentiVuoti(): Pendenti {
  return { grattaAggiunti: [], grattaRimossi: [], tabacchiAggiunti: [], tabacchiRimossi: [] };
}

function leggiPendenti(): Pendenti {
  try {
    const raw = localStorage.getItem(CHIAVE_PENDENTI);
    return raw ? { ...pendentiVuoti(), ...JSON.parse(raw) } : pendentiVuoti();
  } catch {
    return pendentiVuoti();
  }
}

function scriviPendenti(p: Pendenti): void {
  try {
    localStorage.setItem(CHIAVE_PENDENTI, JSON.stringify(p));
  } catch (err) {
    console.error('Errore salvataggio modifiche in sospeso', err);
  }
}

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
 * Riporta al database le modifiche rimaste in sospeso. Quelle che vanno a buon
 * fine escono dalla coda, le altre restano e si riprovano al prossimo avvio.
 */
async function sincronizzaPendenti(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;

  const p = leggiPendenti();
  const totale = p.grattaAggiunti.length + p.grattaRimossi.length +
    p.tabacchiAggiunti.length + p.tabacchiRimossi.length;

  if (totale === 0) return;

  const restano = pendentiVuoti();

  // Una rete che cade fa sollevare un'eccezione, non restituire un errore.
  // Senza questa protezione l'eccezione risalirebbe fino al caricamento del
  // catalogo e l'inventario resterebbe vuoto invece di ripiegare sui dati locali.
  try {
    for (const v of p.grattaAggiunti) {
      const { error } = await supabase
        .from('catalogo_gratta_e_vinci')
        .upsert({ gioco: v.gioco, prezzo: v.prezzo, pezzi_per_pacco: v.pezziPerPacco }, { onConflict: 'gioco' });
      if (error) restano.grattaAggiunti.push(v);
    }

    for (const gioco of p.grattaRimossi) {
      const { error } = await supabase.from('catalogo_gratta_e_vinci').delete().eq('gioco', gioco);
      if (error) restano.grattaRimossi.push(gioco);
    }

    for (const v of p.tabacchiAggiunti) {
      const { error } = await supabase.from('catalogo_tabacchi').upsert(v, { onConflict: 'prodotto' });
      if (error) restano.tabacchiAggiunti.push(v);
    }

    for (const prodotto of p.tabacchiRimossi) {
      const { error } = await supabase.from('catalogo_tabacchi').delete().eq('prodotto', prodotto);
      if (error) restano.tabacchiRimossi.push(prodotto);
    }

    scriviPendenti(restano);
  } catch (err) {
    // Le modifiche restano in coda e si riproveranno al prossimo avvio
    console.warn('Sincronizzazione catalogo rimandata:', err);
  }
}

/** Applica all'elenco letto dal database le modifiche non ancora sincronizzate */
function applicaPendentiGratta(voci: VoceCatalogoGratta[]): VoceCatalogoGratta[] {
  const p = leggiPendenti();
  const rimossi = new Set(p.grattaRimossi);

  const risultato = voci.filter(v => !rimossi.has(v.gioco));
  p.grattaAggiunti.forEach(v => {
    if (!risultato.some(x => x.gioco === v.gioco)) risultato.push(v);
  });

  return risultato;
}

function applicaPendentiTabacchi(voci: VoceCatalogoTabacco[]): VoceCatalogoTabacco[] {
  const p = leggiPendenti();
  const rimossi = new Set(p.tabacchiRimossi);

  const risultato = voci.filter(v => !rimossi.has(v.prodotto));
  p.tabacchiAggiunti.forEach(v => {
    if (!risultato.some(x => x.prodotto === v.prodotto)) risultato.push(v);
  });

  return risultato;
}

/**
 * Carica il catalogo dei Gratta e Vinci. La prima volta che la tabella è vuota
 * la riempie con gli articoli ricavati dagli ordini, così l'elenco è già pronto
 * senza doverlo digitare a mano.
 */
export async function caricaCatalogoGratta(): Promise<VoceCatalogoGratta[]> {
  await sincronizzaPendenti();

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('catalogo_gratta_e_vinci')
        .select('*')
        .order('prezzo')
        .order('gioco');

      if (!error && data) {
        let voci: VoceCatalogoGratta[];

        if (data.length === 0) {
          voci = semiGratta();
          await supabase.from('catalogo_gratta_e_vinci').insert(
            voci.map(v => ({ gioco: v.gioco, prezzo: v.prezzo, pezzi_per_pacco: v.pezziPerPacco }))
          );
        } else {
          voci = data.map(r => ({
            gioco: r.gioco as string,
            prezzo: Number(r.prezzo) || 0,
            pezziPerPacco: Number(r.pezzi_per_pacco) || 0
          }));
        }

        const conPendenti = applicaPendentiGratta(voci);
        scriviLocale(CHIAVE_GRATTA, conPendenti);
        return conPendenti;
      }

      console.warn('Errore lettura catalogo Gratta e Vinci:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura catalogo Gratta e Vinci:', err);
    }
  }

  return applicaPendentiGratta(leggiLocale<VoceCatalogoGratta>(CHIAVE_GRATTA) || semiGratta());
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
        let voci: VoceCatalogoTabacco[];

        if (data.length === 0) {
          voci = semiTabacchi();
          await supabase.from('catalogo_tabacchi').insert(voci);
        } else {
          voci = data.map(r => ({
            prodotto: r.prodotto as string,
            marca: r.marca as string,
            categoria: r.categoria as CategoriaTabacco
          }));
        }

        const conPendenti = applicaPendentiTabacchi(voci);
        scriviLocale(CHIAVE_TABACCHI, conPendenti);
        return conPendenti;
      }

      console.warn('Errore lettura catalogo tabacchi:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura catalogo tabacchi:', err);
    }
  }

  return applicaPendentiTabacchi(leggiLocale<VoceCatalogoTabacco>(CHIAVE_TABACCHI) || semiTabacchi());
}

export async function aggiungiGratta(voce: VoceCatalogoGratta): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_gratta_e_vinci').insert({
      gioco: voce.gioco,
      prezzo: voce.prezzo,
      pezzi_per_pacco: voce.pezziPerPacco
    });

    if (!error) return;
    console.warn('Gioco messo in coda, database non raggiungibile:', error.message);
  }

  const p = leggiPendenti();
  p.grattaAggiunti.push(voce);
  p.grattaRimossi = p.grattaRimossi.filter(g => g !== voce.gioco);
  scriviPendenti(p);
}

export async function eliminaGratta(gioco: string): Promise<void> {
  const p = leggiPendenti();
  p.grattaAggiunti = p.grattaAggiunti.filter(v => v.gioco !== gioco);

  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_gratta_e_vinci').delete().eq('gioco', gioco);

    if (!error) {
      scriviPendenti(p);
      return;
    }
  }

  if (!p.grattaRimossi.includes(gioco)) p.grattaRimossi.push(gioco);
  scriviPendenti(p);
}

export async function aggiungiTabacco(voce: VoceCatalogoTabacco): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_tabacchi').insert(voce);

    if (!error) return;
    console.warn('Prodotto messo in coda, database non raggiungibile:', error.message);
  }

  const p = leggiPendenti();
  p.tabacchiAggiunti.push(voce);
  p.tabacchiRimossi = p.tabacchiRimossi.filter(x => x !== voce.prodotto);
  scriviPendenti(p);
}

export async function eliminaTabacco(prodotto: string): Promise<void> {
  const p = leggiPendenti();
  p.tabacchiAggiunti = p.tabacchiAggiunti.filter(v => v.prodotto !== prodotto);

  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('catalogo_tabacchi').delete().eq('prodotto', prodotto);

    if (!error) {
      scriviPendenti(p);
      return;
    }
  }

  if (!p.tabacchiRimossi.includes(prodotto)) p.tabacchiRimossi.push(prodotto);
  scriviPendenti(p);
}

/** Tiene allineata la copia locale dopo una modifica */
export function salvaCopiaLocale(gratta: VoceCatalogoGratta[], tabacchi: VoceCatalogoTabacco[]): void {
  scriviLocale(CHIAVE_GRATTA, gratta);
  scriviLocale(CHIAVE_TABACCHI, tabacchi);
}
