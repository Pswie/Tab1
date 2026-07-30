import { createClient } from '@supabase/supabase-js';
import { DayExtras, DayRecord, SaveResult, ShiftKey, ShiftRow, ShiftValues } from '../types';
import { emptyShiftValues, getEmployeeAllowedDateRange } from '../utils/calculations';

// Configurazione variabili d'ambiente Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL');
};

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const LOCAL_STORAGE_KEY = 'tabaccheria_daily_logs_v3';

/**
 * Estrae le sole voci di importo da una riga del database
 */
function toShiftValues(row: Partial<ShiftRow> | null | undefined): ShiftValues {
  if (!row) return emptyShiftValues();

  return {
    tabacchi: Number(row.tabacchi) || 0,
    sisal: Number(row.sisal) || 0,
    lis: Number(row.lis) || 0,
    printer: Number(row.printer) || 0,
    lotto_entrate: Number(row.lotto_entrate) || 0,
    lotto_uscite: Number(row.lotto_uscite) || 0,
    fatture: Number(row.fatture) || 0
  };
}

/**
 * Raggruppa le righe per turno nella giornata corrispondente
 */
function toDayRecord(date: string, rows: ShiftRow[], extras?: DayExtras): DayRecord {
  return {
    date,
    mattina: toShiftValues(rows.find(r => r.turno === 'mattina')),
    pomeriggio: toShiftValues(rows.find(r => r.turno === 'pomeriggio')),
    notes: extras?.notes || '',
    chat_notes: extras?.chat_notes || [],
    todos: extras?.todos || []
  };
}

/**
 * Ottiene i dati salvati in LocalStorage (fallback offline)
 */
function getLocalLogs(): Record<string, DayRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Errore lettura LocalStorage', err);
    return {};
  }
}

function saveLocalLogs(logs: Record<string, DayRecord>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logs));
  } catch (err) {
    console.error('Errore salvataggio LocalStorage', err);
  }
}

/**
 * Recupera lo storico consentito per i dipendenti (massimo 2 giorni indietro + oggi)
 */
export async function fetchEmployeeLogs(): Promise<DayRecord[]> {
  const allowedDates = getEmployeeAllowedDateRange();

  if (isSupabaseConfigured() && supabase) {
    try {
      const [logsRes, noteRes] = await Promise.all([
        supabase.from('daily_logs').select('*').in('date', allowedDates),
        supabase.from('daily_notes').select('*').in('date', allowedDates)
      ]);

      if (logsRes.error) {
        console.warn('Errore lettura Supabase, uso fallback LocalStorage:', logsRes.error.message);
      } else if (logsRes.data) {
        const righe = logsRes.data as ShiftRow[];
        const note = (noteRes.data || []) as Array<DayExtras & { date: string }>;

        const date = Array.from(new Set(righe.map(r => r.date)));

        return date
          .map(d => toDayRecord(d, righe.filter(r => r.date === d), note.find(n => n.date === d)))
          .sort((a, b) => b.date.localeCompare(a.date));
      }
    } catch (err) {
      console.warn('Eccezione connessione Supabase, impiego fallback:', err);
    }
  }

  // Fallback LocalStorage
  const localLogsMap = getLocalLogs();

  return allowedDates
    .filter(d => localLogsMap[d])
    .map(d => localLogsMap[d])
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Recupera una giornata completa (entrambi i turni)
 */
export async function fetchLogByDate(dateStr: string): Promise<DayRecord | null> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const [logsRes, noteRes] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('date', dateStr),
        supabase.from('daily_notes').select('*').eq('date', dateStr).maybeSingle()
      ]);

      if (!logsRes.error && logsRes.data) {
        if (logsRes.data.length === 0 && !noteRes.data) return null;
        return toDayRecord(dateStr, logsRes.data as ShiftRow[], noteRes.data as DayExtras);
      }
    } catch (err) {
      console.warn('Errore lettura singola da Supabase:', err);
    }
  }

  const localMap = getLocalLogs();
  return localMap[dateStr] || null;
}

/**
 * Salva la chiusura del turno indicato, più le note della giornata.
 *
 * Scrive solo la riga del turno che si sta compilando: le due chiusure sono
 * righe distinte e indipendenti, così modificarne una non tocca mai l'altra.
 */
export async function autoSaveDailyLog(
  dateStr: string,
  turno: ShiftKey,
  values: ShiftValues,
  extras: DayExtras = {}
): Promise<SaveResult> {
  // Copia locale aggiornata, usata come fallback e come valore di ritorno
  const localMap = getLocalLogs();
  const precedente = localMap[dateStr];

  const record: DayRecord = {
    date: dateStr,
    mattina: turno === 'mattina' ? values : (precedente?.mattina || emptyShiftValues()),
    pomeriggio: turno === 'pomeriggio' ? values : (precedente?.pomeriggio || emptyShiftValues()),
    notes: extras.notes ?? precedente?.notes ?? '',
    chat_notes: extras.chat_notes ?? precedente?.chat_notes ?? [],
    todos: extras.todos ?? precedente?.todos ?? []
  };

  let motivoFallback = isSupabaseConfigured()
    ? undefined
    : 'Supabase non configurato: mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY';

  if (isSupabaseConfigured() && supabase) {
    try {
      const { error: erroreTurno } = await supabase
        .from('daily_logs')
        .upsert({ date: dateStr, turno, ...values }, { onConflict: 'date,turno' });

      const { error: erroreNote } = await supabase
        .from('daily_notes')
        .upsert({
          date: dateStr,
          updated_at: new Date().toISOString(),
          notes: record.notes,
          chat_notes: record.chat_notes,
          todos: record.todos
        }, { onConflict: 'date' });

      const errore = erroreTurno || erroreNote;

      if (!errore) {
        localMap[dateStr] = record;
        saveLocalLogs(localMap);
        return { record, storage: 'supabase' };
      }

      motivoFallback = errore.message;
      console.error('Errore upsert Supabase:', errore.message);
    } catch (err) {
      motivoFallback = err instanceof Error ? err.message : String(err);
      console.error('Eccezione salvataggio Supabase:', err);
    }
  }

  // Fallback LocalStorage
  localMap[dateStr] = record;
  saveLocalLogs(localMap);
  return { record, storage: 'local', error: motivoFallback };
}
