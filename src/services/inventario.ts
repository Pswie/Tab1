import { GrattaEVinciConta, InventarioGiornata, InventarioSintesi, SigaretteConta } from '../types';
import { CATALOGO_GRATTA_E_VINCI } from '../data/grattaEVinci';
import { formatDateItalian } from '../utils/calculations';
import { isSupabaseConfigured, supabase } from './supabase';
import { amministratore } from './auth';

const LOCAL_STORAGE_KEY = 'tabaccheria_inventario_v1';

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

/**
 * Carica l'inventario di una giornata. Restituisce solo le voci diverse da
 * zero: le altre non vengono nemmeno salvate, sarebbero righe vuote.
 */
export async function fetchInventario(dateStr: string): Promise<InventarioGiornata> {
  const vuoto: InventarioGiornata = { date: dateStr, grattaEVinci: [], sigarette: [] };

  if (isSupabaseConfigured() && supabase) {
    try {
      const [gev, sig] = await Promise.all([
        supabase.from('inventario_gratta_e_vinci').select('*').eq('date', dateStr),
        supabase.from('inventario_sigarette').select('*').eq('date', dateStr)
      ]);

      if (!gev.error && !sig.error) {
        return {
          date: dateStr,
          grattaEVinci: (gev.data || []).map(r => ({
            gioco: r.gioco,
            prezzo: Number(r.prezzo) || 0,
            pacchi: Number(r.pacchi) || 0,
            pezzi: Number(r.pezzi) || 0
          })),
          sigarette: (sig.data || []).map(r => ({
            marca: r.marca,
            stecche: Number(r.stecche) || 0,
            pacchetti: Number(r.pacchetti) || 0
          }))
        };
      }

      console.warn('Errore lettura inventario:', gev.error?.message || sig.error?.message);
    } catch (err) {
      console.warn('Eccezione lettura inventario:', err);
    }
  }

  return getLocale()[dateStr] || vuoto;
}

/**
 * Data dell'ultimo inventario registrato, o null se non ne esiste nessuno.
 * Serve a ricordare la conta mensile.
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
 * Salva l'inventario della giornata.
 *
 * Le voci tornate a zero vengono cancellate invece che scritte: l'inventario
 * registra le differenze, e una differenza nulla non è un dato da conservare.
 */
export async function salvaInventario(
  dateStr: string,
  grattaEVinci: GrattaEVinciConta[],
  sigarette: SigaretteConta[]
): Promise<'supabase' | 'local'> {
  const daSalvareGev = grattaEVinci.filter(v => v.pacchi !== 0 || v.pezzi !== 0);
  const daSalvareSig = sigarette.filter(v => v.marca.trim() !== '' && (v.stecche !== 0 || v.pacchetti !== 0));

  const record: InventarioGiornata = {
    date: dateStr,
    grattaEVinci: daSalvareGev,
    sigarette: daSalvareSig
  };

  const mappa = getLocale();
  mappa[dateStr] = record;
  salvaLocale(mappa);

  if (isSupabaseConfigured() && supabase) {
    try {
      // Prima si ripulisce la giornata, così le voci riportate a zero spariscono
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
              pezzi: v.pezzi
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
              pacchetti: v.pacchetti
            }))
          )
        );
      }

      const esiti = await Promise.all(scritture);
      const errore = esiti.find(e => e.error);

      if (!errore) return 'supabase';
      console.error('Errore salvataggio inventario:', errore.error?.message);
    } catch (err) {
      console.error('Eccezione salvataggio inventario:', err);
    }
  }

  return 'local';
}

function pezziPerPaccoPredefiniti(prezzo: number, gioco: string): number {
  const perGioco = CATALOGO_GRATTA_E_VINCI.find(g => g.giochi.includes(gioco));
  if (perGioco) return perGioco.pezziPerPacco;
  const perPrezzo = CATALOGO_GRATTA_E_VINCI.find(g => g.prezzo === prezzo);
  if (perPrezzo) return perPrezzo.pezziPerPacco;
  return prezzo <= 1 ? 150 : prezzo === 2 ? 75 : prezzo === 3 ? 50 : prezzo === 5 ? 60 : prezzo === 10 ? 30 : prezzo === 20 ? 15 : prezzo === 25 ? 12 : 10;
}

/**
 * Recupera l'elenco completo di tutti gli inventari registrati (da Supabase e LocalStorage),
 * con calcolo sintetico delle discrepanze (mancanti vs in più, sia in euro che in pezzi).
 */
export async function fetchStoricoInventari(): Promise<InventarioSintesi[]> {
  // Lo storico degli inventari è riservato esclusivamente all'amministratore
  if (!amministratore()) {
    console.warn('Accesso negato: solo l\'amministratore può consultare lo storico inventari.');
    return [];
  }

  const mappaLocale = getLocale();
  const dateMap = new Map<
    string,
    {
      grattaEVinci: GrattaEVinciConta[];
      sigarette: SigaretteConta[];
      updatedAt?: string;
    }
  >();

  // 1. Dati in LocalStorage
  Object.entries(mappaLocale).forEach(([d, inv]) => {
    if (inv && (inv.grattaEVinci?.length > 0 || inv.sigarette?.length > 0)) {
      dateMap.set(d, {
        grattaEVinci: [...(inv.grattaEVinci || [])],
        sigarette: [...(inv.sigarette || [])],
        updatedAt: undefined
      });
    }
  });

  // 2. Dati da Supabase (se configurato)
  if (isSupabaseConfigured() && supabase) {
    try {
      const [gevRes, sigRes] = await Promise.all([
        supabase.from('inventario_gratta_e_vinci').select('*').order('date', { ascending: false }),
        supabase.from('inventario_sigarette').select('*').order('date', { ascending: false })
      ]);

      if (!gevRes.error && gevRes.data) {
        gevRes.data.forEach((r: any) => {
          const d = r.date;
          if (!d) return;
          if (!dateMap.has(d)) {
            dateMap.set(d, { grattaEVinci: [], sigarette: [], updatedAt: r.updated_at });
          }
          const entry = dateMap.get(d)!;
          const idx = entry.grattaEVinci.findIndex(x => x.gioco === r.gioco);
          const voce: GrattaEVinciConta = {
            gioco: r.gioco,
            prezzo: Number(r.prezzo) || 0,
            pacchi: Number(r.pacchi) || 0,
            pezzi: Number(r.pezzi) || 0
          };
          if (idx >= 0) entry.grattaEVinci[idx] = voce;
          else entry.grattaEVinci.push(voce);

          if (r.updated_at && (!entry.updatedAt || r.updated_at > entry.updatedAt)) {
            entry.updatedAt = r.updated_at;
          }
        });
      }

      if (!sigRes.error && sigRes.data) {
        sigRes.data.forEach((r: any) => {
          const d = r.date;
          if (!d) return;
          if (!dateMap.has(d)) {
            dateMap.set(d, { grattaEVinci: [], sigarette: [], updatedAt: r.updated_at });
          }
          const entry = dateMap.get(d)!;
          const idx = entry.sigarette.findIndex(x => x.marca === r.marca);
          const voce: SigaretteConta = {
            marca: r.marca,
            stecche: Number(r.stecche) || 0,
            pacchetti: Number(r.pacchetti) || 0
          };
          if (idx >= 0) entry.sigarette[idx] = voce;
          else entry.sigarette.push(voce);

          if (r.updated_at && (!entry.updatedAt || r.updated_at > entry.updatedAt)) {
            entry.updatedAt = r.updated_at;
          }
        });
      }
    } catch (err) {
      console.warn('Errore lettura storico inventari da Supabase:', err);
    }
  }

  // Costruisci le sintesi per ciascuna data registrata
  const dateSorted = Array.from(dateMap.keys()).sort().reverse();
  const sintesi: InventarioSintesi[] = [];

  for (const d of dateSorted) {
    const entry = dateMap.get(d)!;

    let grattaTotaleEuro = 0;
    let grattaMancantiEuro = 0;
    let grattaInPiuEuro = 0;
    let grattaVociDiff = 0;

    entry.grattaEVinci.forEach(g => {
      if (g.pacchi !== 0 || g.pezzi !== 0) {
        grattaVociDiff++;
        const ppp = pezziPerPaccoPredefiniti(g.prezzo, g.gioco);
        const pezziTotali = g.pacchi * ppp + g.pezzi;
        const valoreEuro = Number((pezziTotali * g.prezzo).toFixed(2));
        grattaTotaleEuro += valoreEuro;
        if (valoreEuro < 0) grattaMancantiEuro += valoreEuro;
        else if (valoreEuro > 0) grattaInPiuEuro += valoreEuro;
      }
    });

    let sigaretteMancantiStecche = 0;
    let sigaretteMancantiPacchetti = 0;
    let sigaretteInPiuStecche = 0;
    let sigaretteInPiuPacchetti = 0;
    let sigaretteVociDiff = 0;

    entry.sigarette.forEach(s => {
      if (s.stecche !== 0 || s.pacchetti !== 0) {
        sigaretteVociDiff++;
        if (s.stecche < 0) sigaretteMancantiStecche += Math.abs(s.stecche);
        if (s.stecche > 0) sigaretteInPiuStecche += s.stecche;
        if (s.pacchetti < 0) sigaretteMancantiPacchetti += Math.abs(s.pacchetti);
        if (s.pacchetti > 0) sigaretteInPiuPacchetti += s.pacchetti;
      }
    });

    sintesi.push({
      date: d,
      dataFormattata: formatDateItalian(d),
      grattaEVinci: entry.grattaEVinci,
      sigarette: entry.sigarette,
      grattaTotaleEuro: Number(grattaTotaleEuro.toFixed(2)),
      grattaMancantiEuro: Number(grattaMancantiEuro.toFixed(2)),
      grattaInPiuEuro: Number(grattaInPiuEuro.toFixed(2)),
      grattaVociDiff,
      sigaretteMancantiStecche,
      sigaretteMancantiPacchetti,
      sigaretteInPiuStecche,
      sigaretteInPiuPacchetti,
      sigaretteVociDiff,
      conteggioTotaleVoci: grattaVociDiff + sigaretteVociDiff,
      updatedAt: entry.updatedAt
    });
  }

  return sintesi;
}

/**
 * Elimina completamente un inventario (da LocalStorage e Supabase)
 */
export async function eliminaInventario(dateStr: string): Promise<boolean> {
  // L'eliminazione degli inventari è riservata esclusivamente all'amministratore
  if (!amministratore()) {
    console.warn('Accesso negato: solo l\'amministratore può eliminare inventari.');
    return false;
  }

  const mappa = getLocale();
  delete mappa[dateStr];
  salvaLocale(mappa);

  if (isSupabaseConfigured() && supabase) {
    try {
      await Promise.all([
        supabase.from('inventario_gratta_e_vinci').delete().eq('date', dateStr),
        supabase.from('inventario_sigarette').delete().eq('date', dateStr)
      ]);
    } catch (err) {
      console.error('Errore eliminazione inventario da Supabase:', err);
      return false;
    }
  }

  return true;
}
