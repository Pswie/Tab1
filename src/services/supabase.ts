import { createClient } from '@supabase/supabase-js';
import { DailyLogEntry, LogFormData, SaveResult, ShiftKey, ShiftValues } from '../types';
import { calculateDayTotals, emptyShiftValues, getEmployeeAllowedDateRange } from '../utils/calculations';

// Configurazione variabili d'ambiente Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL');
};

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const LOCAL_STORAGE_KEY = 'tabaccheria_daily_logs_v2';

/**
 * Estrae le voci di un turno dalle colonne appiattite della riga
 */
export function readShiftValues(entry: DailyLogEntry | null, shift: ShiftKey): ShiftValues {
  if (!entry) return emptyShiftValues();

  return {
    tabacchi: entry[`${shift}_tabacchi`] || 0,
    sisal: entry[`${shift}_sisal`] || 0,
    lis: entry[`${shift}_lis`] || 0,
    printer: entry[`${shift}_printer`] || 0,
    lotto_entrate: entry[`${shift}_lotto_entrate`] || 0,
    lotto_uscite: entry[`${shift}_lotto_uscite`] || 0,
    fatture: entry[`${shift}_fatture`] || 0
  };
}

/**
 * Ottiene i dati salvati in LocalStorage (Modalità Demo)
 */
function getLocalLogs(): Record<string, DailyLogEntry> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Errore lettura LocalStorage', err);
    return {};
  }
}

/**
 * Salva i dati in LocalStorage
 */
function saveLocalLogs(logs: Record<string, DailyLogEntry>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logs));
  } catch (err) {
    console.error('Errore salvataggio LocalStorage', err);
  }
}

/**
 * Recupera lo storico consentito per i dipendenti (massimo 2 giorni indietro + oggi)
 */
export async function fetchEmployeeLogs(): Promise<DailyLogEntry[]> {
  const allowedDates = getEmployeeAllowedDateRange();

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('daily_logs')
        .select('*')
        .in('date', allowedDates)
        .order('date', { ascending: false });

      if (error) {
        console.warn('Errore lettura Supabase, uso fallback LocalStorage:', error.message);
      } else if (data) {
        return data as DailyLogEntry[];
      }
    } catch (err) {
      console.warn('Eccezione connessione Supabase, impiego fallback:', err);
    }
  }

  // Fallback LocalStorage per Demo / Sviluppo
  const localLogsMap = getLocalLogs();
  const results: DailyLogEntry[] = [];

  allowedDates.forEach(dateStr => {
    if (localLogsMap[dateStr]) {
      results.push(localLogsMap[dateStr]);
    }
  });

  return results.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Recupera un singolo registro per data
 */
export async function fetchLogByDate(dateStr: string): Promise<DailyLogEntry | null> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('date', dateStr)
        .maybeSingle();

      if (!error && data) {
        return data as DailyLogEntry;
      }
    } catch (err) {
      console.warn('Errore lettura singola da Supabase:', err);
    }
  }

  const localMap = getLocalLogs();
  return localMap[dateStr] || null;
}

/**
 * Salva o aggiorna automaticamente la giornata per la data specificata (Upsert)
 */
export async function autoSaveDailyLog(dateStr: string, formData: LogFormData): Promise<SaveResult> {
  // Colonne effettivamente scrivibili: id, created_at e tutti i totali sono
  // generati dal database e vanno esclusi dal payload.
  const writableColumns = {
    date: dateStr,

    mattina_tabacchi: formData.mattina.tabacchi,
    mattina_sisal: formData.mattina.sisal,
    mattina_lis: formData.mattina.lis,
    mattina_printer: formData.mattina.printer,
    mattina_lotto_entrate: formData.mattina.lotto_entrate,
    mattina_lotto_uscite: formData.mattina.lotto_uscite,
    mattina_fatture: formData.mattina.fatture,

    pomeriggio_tabacchi: formData.pomeriggio.tabacchi,
    pomeriggio_sisal: formData.pomeriggio.sisal,
    pomeriggio_lis: formData.pomeriggio.lis,
    pomeriggio_printer: formData.pomeriggio.printer,
    pomeriggio_lotto_entrate: formData.pomeriggio.lotto_entrate,
    pomeriggio_lotto_uscite: formData.pomeriggio.lotto_uscite,
    pomeriggio_fatture: formData.pomeriggio.fatture,

    notes: formData.notes || '',
    chat_notes: formData.chat_notes || [],
    todos: formData.todos || []
  };

  // Copia locale con i totali calcolati, usata come fallback e valore di ritorno
  const totals = calculateDayTotals(formData.mattina, formData.pomeriggio);

  const entry: DailyLogEntry = {
    ...writableColumns,
    id: `log-${dateStr}`,
    created_at: new Date().toISOString(),
    totale_turno_mattina: totals.totaleTurnoMattina,
    totale_turno_pomeriggio: totals.totaleTurnoPomeriggio,
    totale_giornata: totals.totaleGiornata,
    lotto_aggio: totals.lottoAggio,
    lotto_netto: totals.lottoNetto
  };

  let motivoFallback = isSupabaseConfigured()
    ? undefined
    : 'Supabase non configurato: mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY';

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('daily_logs')
        .upsert(writableColumns, { onConflict: 'date' })
        .select()
        .single();

      if (!error && data) {
        // Aggiorna anche LocalStorage per coerenza
        const localMap = getLocalLogs();
        localMap[dateStr] = data as DailyLogEntry;
        saveLocalLogs(localMap);
        return { entry: data as DailyLogEntry, storage: 'supabase' };
      } else if (error) {
        motivoFallback = error.message;
        console.error('Errore upsert Supabase:', error.message);
      }
    } catch (err) {
      motivoFallback = err instanceof Error ? err.message : String(err);
      console.error('Eccezione salvataggio Supabase:', err);
    }
  }

  // Fallback LocalStorage
  const localMap = getLocalLogs();
  localMap[dateStr] = entry;
  saveLocalLogs(localMap);
  return { entry, storage: 'local', error: motivoFallback };
}
