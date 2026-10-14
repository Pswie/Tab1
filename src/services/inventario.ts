import { GrattaEVinciConta, InventarioGiornata, SigaretteConta } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';
import { formatDateItalian } from '../utils/calculations';
import { nomeUtente } from './auth';

const LOCAL_STORAGE_KEY = 'tabaccheria_inventario_v1';

export interface InventarioStoricoVoce {
  date: string;
  dataFormattata: string;
  updatedAt?: string;
  salvatoDa?: string;
  grattaEVinci: GrattaEVinciConta[];
  sigarette: SigaretteConta[];
  totaleGrattaEuro: number;
  ammanchiGrattaEuro: number;
  eccedenzeGrattaEuro: number;
  pacchiGrattaTotali: number;
  pezziGrattaTotali: number;
  vociGrattaConDifferenza: number;
  steccheTabacchiTotali: number;
  pacchettiTabacchiTotali: number;
  vociTabacchiConDifferenza: number;
}

export function pezziPerPaccoDefault(prezzo: number): number {
  if (prezzo === 1) return 150;
  if (prezzo === 2) return 75;
  if (prezzo === 3) return 50;
  if (prezzo === 5) return 60;
  if (prezzo === 10) return 30;
  if (prezzo === 20) return 15;
  if (prezzo === 25) return 10;
  return prezzo <= 3 ? Math.round(150 / (prezzo || 1)) : Math.round(300 / (prezzo || 1));
}

function getLocale(): Record<string, InventarioGiornata> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Errore lettura inventario da LocalStorage', err);
    return {};
  }
}

function salvaLocale(mappa: Record<string, InventarioGiornata>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mappa));
  } catch (err) {
    console.error('Errore salvataggio inventario in LocalStorage', err);
  }
}

export function calcolaRiepilogoInventario(
  record: InventarioGiornata,
  catalogoGratta?: Array<{ gioco: string; prezzo: number; pezziPerPacco: number }>
): InventarioStoricoVoce {
  let totaleGrattaEuro = 0;
  let ammanchiGrattaEuro = 0;
  let eccedenzeGrattaEuro = 0;
  let pacchiGrattaTotali = 0;
  let pezziGrattaTotali = 0;
  let vociGrattaConDifferenza = 0;

  record.grattaEVinci.forEach(v => {
    if (v.pacchi === 0 && v.pezzi === 0) return;
    vociGrattaConDifferenza++;
    pacchiGrattaTotali += v.pacchi;
    pezziGrattaTotali += v.pezzi;

    const cat = catalogoGratta?.find(c => c.gioco.toLowerCase() === v.gioco.toLowerCase());
    const prezzo = v.prezzo || cat?.prezzo || 0;
    const pzPerPacco = cat?.pezziPerPacco || pezziPerPaccoDefault(prezzo);
    const pzTot = v.pacchi * pzPerPacco + v.pezzi;
    const val = Number((pzTot * prezzo).toFixed(2));

    totaleGrattaEuro += val;
    if (val < 0) {
      ammanchiGrattaEuro += Math.abs(val);
    } else if (val > 0) {
      eccedenzeGrattaEuro += val;
    }
  });

  let steccheTabacchiTotali = 0;
  let pacchettiTabacchiTotali = 0;
  let vociTabacchiConDifferenza = 0;

  record.sigarette.forEach(v => {
    if (v.stecche === 0 && v.pacchetti === 0) return;
    vociTabacchiConDifferenza++;
    steccheTabacchiTotali += v.stecche;
    pacchettiTabacchiTotali += v.pacchetti;
  });

  return {
    date: record.date,
    dataFormattata: formatDateItalian(record.date),
    updatedAt: record.updatedAt,
    salvatoDa: record.salvatoDa,
    grattaEVinci: record.grattaEVinci,
    sigarette: record.sigarette,
    totaleGrattaEuro: Number(totaleGrattaEuro.toFixed(2)),
    ammanchiGrattaEuro: Number(ammanchiGrattaEuro.toFixed(2)),
    eccedenzeGrattaEuro: Number(eccedenzeGrattaEuro.toFixed(2)),
    pacchiGrattaTotali,
    pezziGrattaTotali,
    vociGrattaConDifferenza,
    steccheTabacchiTotali,
    pacchettiTabacchiTotali,
    vociTabacchiConDifferenza
  };
}

/**
 * Carica l'inventario di una giornata. Restituisce solo le voci diverse da
 * zero: le altre non vengono nemmeno salvate, sarebbero righe vuote.
 */
export async function fetchInventario(dateStr: string): Promise<InventarioGiornata> {
  const vuoto: InventarioGiornata = { date: dateStr, grattaEVinci: [], sigarette: [] };
  const locale = getLocale()[dateStr];

  if (isSupabaseConfigured() && supabase) {
    try {
      const [gev, sig] = await Promise.all([
        supabase.from('inventario_gratta_e_vinci').select('*').eq('date', dateStr),
        supabase.from('inventario_sigarette').select('*').eq('date', dateStr)
      ]);

      if (!gev.error && !sig.error) {
        const gevRows = gev.data || [];
        const sigRows = sig.data || [];

        // Trova il timestamp di aggiornamento più recente tra le righe
        const maxUpdated = [...gevRows, ...sigRows]
          .map((r: { updated_at?: string }) => r.updated_at)
          .filter(Boolean)
          .sort()
          .reverse()[0];

        const record: InventarioGiornata = {
          date: dateStr,
          grattaEVinci: gevRows.map((r: { gioco: string; prezzo: number; pacchi: number; pezzi: number }) => ({
            gioco: r.gioco,
            prezzo: Number(r.prezzo) || 0,
            pacchi: Number(r.pacchi) || 0,
            pezzi: Number(r.pezzi) || 0
          })),
          sigarette: sigRows.map((r: { marca: string; stecche: number; pacchetti: number }) => ({
            marca: r.marca,
            stecche: Number(r.stecche) || 0,
            pacchetti: Number(r.pacchetti) || 0
          })),
          updatedAt: maxUpdated || locale?.updatedAt,
          salvatoDa: locale?.salvatoDa
        };

        // Cache locale aggiornata
        if (record.grattaEVinci.length > 0 || record.sigarette.length > 0) {
          const mappa = getLocale();
          mappa[dateStr] = record;
          salvaLocale(mappa);
        }

        return record;
      }

      console.warn('Errore lettura inventario:', gev.error?.message || sig.error?.message);
    } catch (err) {
      console.warn('Eccezione lettura inventario:', err);
    }
  }

  return locale || vuoto;
}

/**
 * Data dell'ultimo inventario registrato, o null se non ne esiste nessuno.
 */
export async function ultimaDataInventario(): Promise<string | null> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const [gev, sig] = await Promise.all([
        supabase.from('inventario_gratta_e_vinci').select('date').order('date', { ascending: false }).limit(1),
        supabase.from('inventario_sigarette').select('date').order('date', { ascending: false }).limit(1)
      ]);

      const date = [gev.data?.[0]?.date, sig.data?.[0]?.date].filter(Boolean) as string[];
      if (date.length > 0) return date.sort().reverse()[0];
      if (!gev.error && !sig.error) return null;
    } catch (err) {
      console.warn('Data ultimo inventario non leggibile:', err);
    }
  }

  const locali = Object.values(getLocale())
    .filter(v => v.grattaEVinci.length > 0 || v.sigarette.length > 0)
    .map(v => v.date)
    .sort();

  return locali.length > 0 ? locali[locali.length - 1] : null;
}

/**
 * Elenca tutti gli inventari salvati nello storico (Supabase + LocalStorage),
 * raggruppati per data e ordinati dalla data più recente.
 */
export async function elencaStoricoInventari(
  catalogoGratta?: Array<{ gioco: string; prezzo: number; pezziPerPacco: number }>
): Promise<InventarioStoricoVoce[]> {
  const mappa = getLocale();

  if (isSupabaseConfigured() && supabase) {
    try {
      const [gevRes, sigRes] = await Promise.all([
        supabase.from('inventario_gratta_e_vinci').select('*').order('date', { ascending: false }),
        supabase.from('inventario_sigarette').select('*').order('date', { ascending: false })
      ]);

      if (!gevRes.error && !sigRes.error && (gevRes.data || sigRes.data)) {
        const gevData = gevRes.data || [];
        const sigData = sigRes.data || [];

        const dates = new Set<string>();
        gevData.forEach((r: { date: string }) => dates.add(r.date));
        sigData.forEach((r: { date: string }) => dates.add(r.date));

        dates.forEach(dateStr => {
          const gev = gevData
            .filter((r: { date: string }) => r.date === dateStr)
            .map((r: { gioco: string; prezzo: number; pacchi: number; pezzi: number }) => ({
              gioco: r.gioco,
              prezzo: Number(r.prezzo) || 0,
              pacchi: Number(r.pacchi) || 0,
              pezzi: Number(r.pezzi) || 0
            }));

          const sig = sigData
            .filter((r: { date: string }) => r.date === dateStr)
            .map((r: { marca: string; stecche: number; pacchetti: number }) => ({
              marca: r.marca,
              stecche: Number(r.stecche) || 0,
              pacchetti: Number(r.pacchetti) || 0
            }));

          const maxUpdated = [...gevData, ...sigData]
            .filter((r: { date: string; updated_at?: string }) => r.date === dateStr && r.updated_at)
            .map((r: { updated_at?: string }) => r.updated_at!)
            .sort()
            .reverse()[0];

          mappa[dateStr] = {
            date: dateStr,
            grattaEVinci: gev,
            sigarette: sig,
            updatedAt: maxUpdated || mappa[dateStr]?.updatedAt,
            salvatoDa: mappa[dateStr]?.salvatoDa
          };
        });

        salvaLocale(mappa);
      }
    } catch (err) {
      console.warn('Errore recupero storico da Supabase:', err);
    }
  }

  return Object.values(mappa)
    .filter(rec => rec.grattaEVinci.length > 0 || rec.sigarette.length > 0)
    .map(rec => calcolaRiepilogoInventario(rec, catalogoGratta))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Elimina definitivamente un inventario dallo storico (da Supabase e LocalStorage).
 */
export async function eliminaInventario(dateStr: string): Promise<boolean> {
  const mappa = getLocale();
  delete mappa[dateStr];
  salvaLocale(mappa);

  if (isSupabaseConfigured() && supabase) {
    try {
      await Promise.all([
        supabase.from('inventario_gratta_e_vinci').delete().eq('date', dateStr),
        supabase.from('inventario_sigarette').delete().eq('date', dateStr)
      ]);
      return true;
    } catch (err) {
      console.error('Errore eliminazione inventario da Supabase:', err);
      return false;
    }
  }

  return true;
}

/**
 * Salva l'inventario della giornata.
 */
export async function salvaInventario(
  dateStr: string,
  grattaEVinci: GrattaEVinciConta[],
  sigarette: SigaretteConta[],
  operatore?: string
): Promise<'supabase' | 'local'> {
  const daSalvareGev = grattaEVinci.filter(v => v.pacchi !== 0 || v.pezzi !== 0);
  const daSalvareSig = sigarette.filter(v => v.marca.trim() !== '' && (v.stecche !== 0 || v.pacchetti !== 0));
  const chi = operatore || nomeUtente() || 'Admin';
  const adessoIso = new Date().toISOString();

  const record: InventarioGiornata = {
    date: dateStr,
    grattaEVinci: daSalvareGev,
    sigarette: daSalvareSig,
    updatedAt: adessoIso,
    salvatoDa: chi
  };

  const mappa = getLocale();
  mappa[dateStr] = record;
  salvaLocale(mappa);

  if (isSupabaseConfigured() && supabase) {
    try {
      await Promise.all([
        supabase.from('inventario_gratta_e_vinci').delete().eq('date', dateStr),
        supabase.from('inventario_sigarette').delete().eq('date', dateStr)
      ]);

      const scritture = [];

      if (daSalvareGev.length > 0) {
        scritture.push(
          supabase.from('inventario_gratta_e_vinci').insert(
            daSalvareGev.map(v => ({
              date: dateStr,
              gioco: v.gioco,
              prezzo: v.prezzo,
              pacchi: v.pacchi,
              pezzi: v.pezzi,
              updated_at: adessoIso
            }))
          )
        );
      }

      if (daSalvareSig.length > 0) {
        scritture.push(
          supabase.from('inventario_sigarette').insert(
            daSalvareSig.map(v => ({
              date: dateStr,
              marca: v.marca.trim(),
              stecche: v.stecche,
              pacchetti: v.pacchetti,
              updated_at: adessoIso
            }))
          )
        );
      }

      const esiti = await Promise.all(scritture);
      const errore = esiti.find(e => e.error);

      if (!errore) return 'supabase';
      console.error('Errore salvataggio inventario su Supabase:', errore.error?.message);
    } catch (err) {
      console.error('Eccezione salvataggio inventario:', err);
    }
  }

  return 'local';
}
