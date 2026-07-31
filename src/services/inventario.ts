import { GrattaEVinciConta, InventarioGiornata, SigaretteConta } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

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
