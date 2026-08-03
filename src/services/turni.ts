import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Turni di lavoro: chi c'è in negozio, in che giornata e in quale fascia.
 *
 * Ricalca il foglio appeso in negozio: per ogni giornata mattina, intermedio,
 * pomeriggio e chi è di festa, più le ferie che valgono per più giorni di fila.
 * L'intermedio non c'è tutti i giorni, ed è normale che una fascia resti vuota.
 *
 * Non ha niente a che vedere con le chiusure di cassa, che pure si chiamano
 * turni: qui non ci sono importi, solo nomi.
 *
 * Lo leggono tutti, lo scrive soltanto chi amministra. Il divieto non sta solo
 * nell'interfaccia: le policy su Supabase rifiutano la scrittura a chi non ha
 * admin nel profilo.
 */

/** Le fasce di una giornata, nell'ordine in cui si leggono sul foglio */
export type FasciaTurno = 'mattina' | 'intermedio' | 'pomeriggio' | 'festa' | 'ferie';

/** Quelle che compaiono nel riquadro della giornata: le ferie stanno a parte */
export const FASCE_GIORNATA: FasciaTurno[] = ['mattina', 'intermedio', 'pomeriggio', 'festa'];

export const NOMI_FASCIA: Record<FasciaTurno, string> = {
  mattina: 'Mattina',
  intermedio: 'Intermedio',
  pomeriggio: 'Pomeriggio',
  festa: 'Festa',
  ferie: 'Ferie'
};

const ORDINE_FASCIA: FasciaTurno[] = ['mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie'];

export interface TurnoLavoro {
  id: string;
  /** YYYY-MM-DD */
  data: string;
  fascia: FasciaTurno;
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
  voci: TurnoLavoro[];
  /** false = salvato solo in locale, i colleghi non lo vedono */
  suCloud: boolean;
}

const CHIAVE_LOCALE = 'tabaccheria_turni_v2';

function fasciaValida(valore: unknown): FasciaTurno {
  const f = String(valore ?? '') as FasciaTurno;
  return ORDINE_FASCIA.includes(f) ? f : 'mattina';
}

function daRiga(r: Record<string, unknown>): TurnoLavoro {
  return {
    id: String(r.id),
    data: String(r.data ?? '').slice(0, 10),
    // Sul database la colonna si chiama ancora turno: è la stessa cosa
    fascia: fasciaValida(r.turno),
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

/** Prima le giornate in ordine, dentro la giornata le fasce, poi i nomi */
export function inOrdine(voci: TurnoLavoro[]): TurnoLavoro[] {
  return [...voci].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;

    const fa = ORDINE_FASCIA.indexOf(a.fascia);
    const fb = ORDINE_FASCIA.indexOf(b.fascia);
    if (fa !== fb) return fa - fb;

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

/** Le giornate da una data all'altra, comprese */
function giornate(dal: string, al: string): string[] {
  const elenco: string[] = [];
  const [a, m, g] = dal.split('-').map(Number);
  const d = new Date(a, m - 1, g);

  // Un intervallo al contrario non è un intervallo: meglio niente che un ciclo
  // che non finisce
  for (let i = 0; i < 366 && dal <= al; i++) {
    const iso = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');

    if (iso > al) break;

    elenco.push(iso);
    d.setDate(d.getDate() + 1);
  }

  return elenco;
}

/**
 * Assegna una persona a una fascia, per una giornata sola o per un periodo.
 *
 * Riassegnare qualcuno che c'è già aggiorna la sua nota invece di sdoppiare
 * la riga: il vincolo di unicità sul database dice che una persona sta in una
 * fascia una volta sola.
 */
export async function assegnaTurno(
  dal: string,
  al: string,
  fascia: FasciaTurno,
  persona: string,
  nota = '',
  autore = ''
): Promise<EsitoTurno> {
  const giorni = giornate(dal, al);
  if (giorni.length === 0) return { voci: [], suCloud: false };

  const righe = giorni.map(data => ({
    data,
    turno: fascia,
    persona,
    nota,
    creato_da: autore,
    aggiornato_il: new Date().toISOString()
  }));

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('turni_lavoro')
        .upsert(righe, { onConflict: 'data,turno,persona' })
        .select();

      if (!error && data) {
        const voci = data.map(daRiga);
        const ids = new Set(voci.map(v => v.id));
        scriviLocale(inOrdine([...leggiLocale().filter(v => !ids.has(v.id)), ...voci]));

        return { voci, suCloud: true };
      }

      console.warn('Turno salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio turno:', err);
    }
  }

  const voci: TurnoLavoro[] = giorni.map(data => ({
    id: `loc-${data}-${fascia}-${persona}`,
    data,
    fascia,
    persona,
    nota,
    scrittoDa: autore
  }));

  const restanti = leggiLocale().filter(
    v => !voci.some(n => n.data === v.data && n.fascia === v.fascia && n.persona === v.persona)
  );
  scriviLocale(inOrdine([...restanti, ...voci]));

  return { voci, suCloud: false };
}

/**
 * Toglie una persona da una fascia. Restituisce false se la cancellazione è
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
