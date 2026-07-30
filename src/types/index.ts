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
 * - 'pranzo': chiusura di metà giornata, si compila tra le 10:00 e le 16:00
 * - 'sera': chiusura di fine giornata, si compila dalle 16:00 alle 10:00 del giorno dopo
 */
export type ShiftKey = 'pranzo' | 'sera';

/**
 * Le voci registrate in una chiusura.
 *
 * ATTENZIONE: i valori della chiusura serale sono LETTURE CUMULATIVE dell'intera
 * giornata, non del solo turno serale. Il turno 2 si ricava per differenza
 * (sera - pranzo): con pranzo 1000 e sera 2000 il secondo turno vale 1000.
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
 * Riga del database: le voci dei due turni sono appiattite in colonne separate,
 * i totali sono calcolati dal database (colonne GENERATED).
 */
export interface DailyLogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  created_at?: string;
  user_id?: string;

  pranzo_tabacchi: number;
  pranzo_sisal: number;
  pranzo_lis: number;
  pranzo_printer: number;
  pranzo_lotto_entrate: number;
  pranzo_lotto_uscite: number;
  pranzo_fatture: number;

  sera_tabacchi: number;
  sera_sisal: number;
  sera_lis: number;
  sera_printer: number;
  sera_lotto_entrate: number;
  sera_lotto_uscite: number;
  sera_fatture: number;

  // Colonne calcolate dal database
  totale_turno_pranzo: number; // Totale Turno 1
  totale_turno_sera: number;   // Totale Turno 2 (lettura serale - pranzo)
  totale_giornata: number;     // Totale della giornata (lettura serale, o pranzo se la sera non è ancora chiusa)
  lotto_aggio: number;         // 8% delle entrate Lotto della giornata
  lotto_netto: number;         // Entrate - Uscite Lotto della giornata

  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

/**
 * Dati del form, organizzati per turno invece che appiattiti
 */
export interface LogFormData {
  date: string;
  pranzo: ShiftValues;
  sera: ShiftValues;
  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

/**
 * I totali derivati dalle due chiusure
 */
export interface DayTotals {
  totaleTurnoPranzo: number;
  totaleTurnoSera: number;
  totaleGiornata: number;
  lottoAggio: number;
  lottoNetto: number;
  seraCompilata: boolean;
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
  entry: DailyLogEntry;
  storage: 'supabase' | 'local';
  error?: string;
}
