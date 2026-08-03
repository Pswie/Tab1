import { ShiftKey } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Turni di lavoro: chi c'è in negozio, in quale giornata e in quale dei due
 * turni.
 *
 * Non ha niente a che vedere con le chiusure di cassa, che pure si chiamano
 * turni: qui non ci sono importi, solo nomi. Serve a sapere in anticipo quando
 * si lavora senza dover chiedere.
 *
 * Lo leggono tutti, lo scrive soltanto chi amministra. Il divieto non sta solo
 * nell'interfaccia: le policy su Supabase rifiutano la scrittura a chi non ha
 * admin nel profilo, quindi nascondere i comandi è una comodità e non l'unica
 * barriera.
 */

export interface TurnoLavoro {
  id: string;
  /** YYYY-MM-DD */
  data: string;
  turno: ShiftKey;
  persona: string;
  /** Una precisazione breve accanto al nome: "entra alle 7", "fino alle 12" */
  nota: string;
  /** Chi ha assegnato il turno */
  scrittoDa: string;
}

/**
 * Esito di una scrittura: dice anche DOVE è finita.
 *
 * Un turno rimasto su questo dispositivo non lo vede nessun collega, ed è
 * esattamente il contrario di quello che serve a un calendario condiviso:
 * l'interfaccia deve poterlo dire invece di far credere che sia a posto.
 */
export interface EsitoTurno {
  voce: TurnoLavoro | null;
  /** false = salvato solo in locale, i colleghi non lo vedono */
  suCloud: boolean;
}

const CHIAVE_LOCALE = 'tabaccheria_turni_v1';

function turnoValido(valore: unknown): ShiftKey {
  return String(valore ?? '') === 'mattina' ? 'mattina' : 'pomeriggio';
}

function daRiga(r: Record<string, unknown>): TurnoLavoro {
  return {
    id: String(r.id),
    data: String(r.data ?? '').slice(0, 10),
    turno: turnoValido(r.turno),
    persona: String(r.persona ?? ''),
    nota: String(r.nota ?? ''),
    scrittoDa: String(r.creato_da || '')
  };
}

function leggiLocale(): TurnoLavoro[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale(voci: TurnoLavoro[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio turni', err);
  }
}

/** Prima le giornate in ordine, dentro la giornata la mattina, poi i nomi */
export function inOrdine(voci: TurnoLavoro[]): TurnoLavoro[] {
  return [...voci].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.turno !== b.turno) return a.turno === 'mattina' ? -1 : 1;

    return a.persona.localeCompare(b.persona, 'it', { sensitivity: 'base' });
  });
}

function nelPeriodo(v: TurnoLavoro, dal: string, al: string): boolean {
  return v.data >= dal && v.data <= al;
}

/**
 * Rimpiazza nella copia locale la sola finestra appena letta: le altre
 * settimane già scaricate restano disponibili anche senza rete.
 */
function aggiornaLocale(dal: string, al: string, voci: TurnoLavoro[]): void {
  const fuori = leggiLocale().filter(v => !nelPeriodo(v, dal, al));
  scriviLocale(inOrdine([...fuori, ...voci]));
}

/**
 * I turni assegnati fra due date comprese, in formato YYYY-MM-DD
 */
export async function elencaTurni(dal: string, al: string): Promise<TurnoLavoro[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('turni_lavoro')
        .select('*')
        .gte('data', dal)
        .lte('data', al);

      if (!error && data) {
        const voci = inOrdine(data.map(daRiga));
        aggiornaLocale(dal, al, voci);
        return voci;
      }

      console.warn('Errore lettura turni:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura turni:', err);
    }
  }

  return inOrdine(leggiLocale().filter(v => nelPeriodo(v, dal, al)));
}

/**
 * Assegna una persona a un turno.
 *
 * Riassegnare qualcuno che c'è già aggiorna la sua nota invece di sdoppiare
 * la riga: il vincolo di unicità sul database dice che una persona sta in un
 * turno una volta sola.
 */
export async function assegnaTurno(
  data: string,
  turno: ShiftKey,
  persona: string,
  nota = '',
  autore = ''
): Promise<EsitoTurno> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data: righe, error } = await supabase
        .from('turni_lavoro')
        .upsert(
          { data, turno, persona, nota, creato_da: autore, aggiornato_il: new Date().toISOString() },
          { onConflict: 'data,turno,persona' }
        )
        .select()
        .single();

      if (!error && righe) {
        const voce = daRiga(righe);
        scriviLocale(inOrdine([...leggiLocale().filter(v => v.id !== voce.id), voce]));

        return { voce, suCloud: true };
      }

      console.warn('Turno salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio turno:', err);
    }
  }

  const voce: TurnoLavoro = {
    id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    data,
    turno,
    persona,
    nota,
    scrittoDa: autore
  };

  const voci = leggiLocale().filter(
    v => !(v.data === data && v.turno === turno && v.persona === persona)
  );
  voci.push(voce);
  scriviLocale(inOrdine(voci));

  return { voce, suCloud: false };
}

/**
 * Toglie una persona da un turno. Restituisce false se la cancellazione è
 * rimasta su questo dispositivo.
 */
export async function rimuoviTurno(id: string): Promise<boolean> {
  const scriviSenza = () => scriviLocale(leggiLocale().filter(v => v.id !== id));

  // Una riga nata offline non è mai arrivata sul database: sparisce e basta
  if (id.startsWith('loc-')) {
    scriviSenza();
    return false;
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.from('turni_lavoro').delete().eq('id', id);

      if (!error) {
        scriviSenza();
        return true;
      }

      console.warn('Errore eliminazione turno:', error.message);
    } catch (err) {
      console.warn('Eccezione eliminazione turno:', err);
    }
  }

  scriviSenza();
  return false;
}

/**
 * I nomi già usati, dal più recente.
 *
 * Servono a proporre chi lavora di solito invece di farlo riscrivere ogni
 * volta: sono le stesse persone tutte le settimane, e un nome digitato a mano
 * si scrive prima o poi in due modi diversi.
 */
export async function personeConosciute(): Promise<string[]> {
  const nomi: string[] = [];

  const raccogli = (voci: Array<{ persona: string }>) => {
    voci.forEach(v => {
      const nome = (v.persona || '').trim();
      if (nome && !nomi.some(n => n.localeCompare(nome, 'it', { sensitivity: 'base' }) === 0)) {
        nomi.push(nome);
      }
    });
  };

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('turni_lavoro')
        .select('persona')
        .order('creato_il', { ascending: false })
        .limit(400);

      if (!error && data) {
        raccogli(data.map(r => ({ persona: String(r.persona ?? '') })));
        return nomi;
      }
    } catch (err) {
      console.warn('Eccezione lettura nomi turni:', err);
    }
  }

  raccogli([...leggiLocale()].reverse());
  return nomi;
}
