export interface NoteItem {
  id: string;
  author: string; // Nome dipendente
  text: string;
  timestamp: string; // HH:mm
  date: string; // YYYY-MM-DD
  isMine?: boolean;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdBy: string;
  createdAt: string;
}

/**
 * I due turni della giornata.
 * - 'mattina': chiusura di metà giornata, si compila tra le 10:00 e le 16:00
 * - 'pomeriggio': chiusura di fine giornata, dalle 16:00 alle 10:00 del giorno dopo
 */
export type ShiftKey = 'mattina' | 'pomeriggio';

/**
 * Le voci registrate in una chiusura.
 *
 * ATTENZIONE: i valori del turno pomeriggio sono LETTURE CUMULATIVE dell'intera
 * giornata, non del solo pomeriggio. Il secondo turno si ricava per differenza:
 * con mattina 1000 e pomeriggio 2000 il secondo turno vale 1000.
 */
export interface ShiftValues {
  tabacchi: number;
  sisal: number;
  lis: number;
  printer: number;
  lotto_entrate: number;
  lotto_uscite: number;
  fatture: number;
}

/**
 * Riga del database: una per giornata E turno. I totali sono calcolati dal
 * database (colonne GENERATED).
 */
export interface ShiftRow extends ShiftValues {
  id?: string;
  date: string; // YYYY-MM-DD
  turno: ShiftKey;
  created_at?: string;
  updated_at?: string;

  totale_turno?: number;
  lotto_netto?: number;
  lotto_aggio?: number;
  compilato?: boolean;
}

/**
 * Le due righe di una giornata rimesse insieme, più le note che sono
 * della giornata e non del singolo turno.
 */
export interface DayRecord {
  date: string;
  mattina: ShiftValues;
  pomeriggio: ShiftValues;
  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

/**
 * Note, chat e task della giornata: vivono in una tabella a parte perché non
 * appartengono a un turno in particolare.
 */
export interface DayExtras {
  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

/**
 * I totali derivati dalle due chiusure
 */
export interface DayTotals {
  totaleTurnoMattina: number;
  totaleTurnoPomeriggio: number;
  totaleGiornata: number;
  lottoAggio: number;
  lottoNetto: number;
  pomeriggioCompilato: boolean;
}

/**
 * 'saved' = scritto su Supabase, 'saved-local' = solo su questo dispositivo
 * perché Supabase non è raggiungibile o non è configurato
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'saved-local' | 'error';

/**
 * Esito di un salvataggio: dice anche DOVE è finito il dato, così l'interfaccia
 * non può far credere che sia sul cloud quando è rimasto solo nel browser.
 */
export interface SaveResult {
  record: DayRecord;
  storage: 'supabase' | 'local';
  error?: string;
}
