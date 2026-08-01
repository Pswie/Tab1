import { leggiPrenotazioni } from '../utils/ical';
import { isSupabaseConfigured, supabase } from './supabase';

/** Tariffa a persona per notte */
export const TARIFFA_A_PERSONA = 3;

export interface Soggiorno {
  id: string;
  uid: string;
  nome: string;
  dataInizio: string;
  dataFine: string;
  notti: number;
  ospiti: number;
  tariffa: number;
  importo: number;
  pagata: boolean;
}

export interface Calendario {
  id: string;
  etichetta: string;
  url: string;
}

export interface EsitoImportazione {
  nuovi: number;
  aggiornati: number;
  errori: string[];
}

const CHIAVE_SOGGIORNI = 'tabaccheria_soggiorni_v2';
const CHIAVE_CALENDARI = 'tabaccheria_calendari_v1';

export function calcolaImporto(notti: number, ospiti: number, tariffa = TARIFFA_A_PERSONA): number {
  return Number((notti * tariffa * ospiti).toFixed(2));
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
    console.error('Errore salvataggio locale', err);
  }
}

function daRiga(r: Record<string, unknown>): Soggiorno {
  const notti = Number(r.notti) || 0;
  const ospiti = Number(r.ospiti) || 1;
  const tariffa = Number(r.tariffa) || TARIFFA_A_PERSONA;

  return {
    id: String(r.id),
    uid: String(r.uid),
    nome: String(r.nome ?? 'Ospite'),
    dataInizio: String(r.data_inizio),
    dataFine: String(r.data_fine),
    notti,
    ospiti,
    tariffa,
    importo: r.importo !== undefined && r.importo !== null
      ? Number(r.importo)
      : calcolaImporto(notti, ospiti, tariffa),
    pagata: Boolean(r.pagata)
  };
}

// ---------------------------------------------------------------- calendari

export async function elencaCalendari(): Promise<Calendario[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('calendari_ical')
        .select('*')
        .eq('attivo', true)
        .order('creato_il');

      if (!error && data) {
        const voci = data.map(r => ({
          id: String(r.id),
          etichetta: String(r.etichetta || ''),
          url: String(r.url)
        }));
        scriviLocale(CHIAVE_CALENDARI, voci);
        return voci;
      }

      console.warn('Errore lettura calendari:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura calendari:', err);
    }
  }

  return leggiLocale<Calendario>(CHIAVE_CALENDARI);
}

/** Sostituisce l'elenco dei calendari con quello indicato */
export async function salvaCalendari(voci: Array<{ etichetta: string; url: string }>): Promise<void> {
  const puliti = voci.filter(v => v.url.trim() !== '');

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.from('calendari_ical').delete().neq('url', '');

      if (puliti.length > 0) {
        await supabase.from('calendari_ical').insert(
          puliti.map(v => ({ etichetta: v.etichetta, url: v.url.trim() }))
        );
      }
    } catch (err) {
      console.warn('Eccezione salvataggio calendari:', err);
    }
  }

  scriviLocale(
    CHIAVE_CALENDARI,
    puliti.map((v, i) => ({ id: `loc-${i}`, etichetta: v.etichetta, url: v.url.trim() }))
  );
}

// -------------------------------------------------------------- importazione

/**
 * Scarica un calendario passando dalla funzione serverless: i portali non
 * inviano le intestazioni CORS, quindi il browser non può leggerli da solo.
 */
async function scaricaCalendario(url: string): Promise<string> {
  const risposta = await fetch(`/api/ical?url=${encodeURIComponent(url)}`);

  if (!risposta.ok) {
    let dettaglio = `errore ${risposta.status}`;
    try {
      const corpo = await risposta.json();
      if (corpo?.errore) dettaglio = corpo.errore;
    } catch {
      // La risposta non era JSON: resta il codice di stato
    }
    throw new Error(dettaglio);
  }

  return risposta.text();
}

/**
 * Legge i calendari e allinea l'elenco dei soggiorni.
 *
 * Le prenotazioni già presenti vengono aggiornate nelle date e negli ospiti ma
 * mai nello stato di pagamento: una tassa già incassata non deve tornare da
 * versare solo perché il calendario è stato riletto.
 */
export async function importaDaCalendari(): Promise<EsitoImportazione> {
  const calendari = await elencaCalendari();
  const esito: EsitoImportazione = { nuovi: 0, aggiornati: 0, errori: [] };

  if (calendari.length === 0) {
    esito.errori.push('Nessun calendario configurato');
    return esito;
  }

  const esistenti = await elencaSoggiorni();
  const perUid = new Map(esistenti.map(s => [s.uid, s]));

  for (const cal of calendari) {
    let prenotazioni;

    try {
      prenotazioni = leggiPrenotazioni(await scaricaCalendario(cal.url));
    } catch (err) {
      esito.errori.push(`${cal.etichetta || 'Calendario'}: ${(err as Error).message}`);
      continue;
    }

    for (const p of prenotazioni) {
      const gia = perUid.get(p.uid);

      const riga = {
        uid: p.uid,
        nome: p.nome,
        data_inizio: p.dataInizio,
        data_fine: p.dataFine,
        notti: p.notti,
        ospiti: p.ospiti,
        tariffa: TARIFFA_A_PERSONA
      };

      if (isSupabaseConfigured() && supabase) {
        try {
          if (gia) {
            await supabase.from('tassa_soggiorno').update(riga).eq('uid', p.uid);
          } else {
            await supabase.from('tassa_soggiorno').insert(riga);
          }
        } catch (err) {
          esito.errori.push(`${p.nome}: ${(err as Error).message}`);
          continue;
        }
      }

      if (gia) {
        esito.aggiornati++;
        Object.assign(gia, {
          nome: p.nome,
          dataInizio: p.dataInizio,
          dataFine: p.dataFine,
          notti: p.notti,
          ospiti: p.ospiti,
          importo: calcolaImporto(p.notti, p.ospiti)
        });
      } else {
        esito.nuovi++;
        perUid.set(p.uid, {
          id: `loc-${p.uid}`,
          uid: p.uid,
          nome: p.nome,
          dataInizio: p.dataInizio,
          dataFine: p.dataFine,
          notti: p.notti,
          ospiti: p.ospiti,
          tariffa: TARIFFA_A_PERSONA,
          importo: calcolaImporto(p.notti, p.ospiti),
          pagata: false
        });
      }
    }
  }

  scriviLocale(CHIAVE_SOGGIORNI, Array.from(perUid.values()));
  return esito;
}

// --------------------------------------------------------------- soggiorni

export async function elencaSoggiorni(): Promise<Soggiorno[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('tassa_soggiorno')
        .select('*')
        .order('data_fine', { ascending: false });

      if (!error && data) {
        const voci = data.map(daRiga);
        scriviLocale(CHIAVE_SOGGIORNI, voci);
        return voci;
      }

      console.warn('Errore lettura soggiorni:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura soggiorni:', err);
    }
  }

  return leggiLocale<Soggiorno>(CHIAVE_SOGGIORNI);
}

export async function segnaPagata(uid: string, pagata: boolean): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('tassa_soggiorno')
        .update({ pagata, pagata_il: pagata ? new Date().toISOString() : null })
        .eq('uid', uid);

      if (!error) return;
    } catch (err) {
      console.warn('Eccezione aggiornamento soggiorno:', err);
    }
  }

  scriviLocale(
    CHIAVE_SOGGIORNI,
    leggiLocale<Soggiorno>(CHIAVE_SOGGIORNI).map(v => (v.uid === uid ? { ...v, pagata } : v))
  );
}
