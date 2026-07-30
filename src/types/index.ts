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
 * Riga del database: le voci dei due turni sono appiattite in colonne separate,
 * i totali sono calcolati dal database (colonne GENERATED).
 */
export interface DailyLogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  created_at?: string;
  updated_at?: string;
  user_id?: string;

  mattina_tabacchi: number;
  mattina_sisal: number;
  mattina_lis: number;
  mattina_printer: number;
  mattina_lotto_entrate: number;
  mattina_lotto_uscite: number;
  mattina_fatture: number;

  pomeriggio_tabacchi: number;
  pomeriggio_sisal: number;
  pomeriggio_lis: number;
  pomeriggio_printer: number;
  pomeriggio_lotto_entrate: number;
  pomeriggio_lotto_uscite: number;
  pomeriggio_fatture: number;

  // Colonne calcolate dal database
  totale_turno_mattina: number;    // Totale Turno 1
  totale_turno_pomeriggio: number; // Totale Turno 2 (lettura pomeridiana - mattina)
  totale_giornata: number;         // Totale della giornata
  lotto_aggio: number;             // 8% delle entrate Lotto della giornata
  lotto_netto: number;             // Entrate - Uscite Lotto della giornata

  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

/**
 * Dati del form, organizzati per turno invece che appiattiti
 */
export interface LogFormData {
  date: string;
  mattina: ShiftValues;
  pomeriggio: ShiftValues;
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
  entry: DailyLogEntry;
  storage: 'supabase' | 'local';
  error?: string;
}
