import { createClient } from '@supabase/supabase-js';
import { DailyLogEntry, LogFormData } from '../types';
import { calculateLottoAggio, calculateLottoNet, calculateTotaleGiornata, getEmployeeAllowedDateRange } from '../utils/calculations';

// Configurazione variabili d'ambiente Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL');
};

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const LOCAL_STORAGE_KEY = 'tabaccheria_daily_logs_v1';

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
 * Recupera lo storico consentito per i dipendenti (massimo 2 giorni indietro + oggi + domani)
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
export async function autoSaveDailyLog(dateStr: string, formData: LogFormData): Promise<DailyLogEntry> {
  const lottoAggio = calculateLottoAggio(formData.lotto_entrate);
  const lottoNetto = calculateLottoNet(formData.lotto_entrate, formData.lotto_uscite);
  const totaleGiornata = calculateTotaleGiornata(formData);

  const entry: DailyLogEntry = {
    id: `log-${dateStr}`,
    date: dateStr,
    created_at: new Date().toISOString(),
    tabacchi: formData.tabacchi,
    sisal: formData.sisal,
    lis: formData.lis,
    printer: formData.printer,
    lotto_entrate: formData.lotto_entrate,
    lotto_uscite: formData.lotto_uscite,
    lotto_aggio: lottoAggio,
    lotto_netto: lottoNetto,
    fatture: formData.fatture,
    totale_giornata: totaleGiornata,
    notes: formData.notes || '',
    chat_notes: (formData as any).chat_notes || [],
    todos: (formData as any).todos || []
  };

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('daily_logs')
        .upsert(entry, { onConflict: 'date' })
        .select()
        .single();

      if (!error && data) {
        // Aggiorna anche LocalStorage per coerenza
        const localMap = getLocalLogs();
        localMap[dateStr] = data as DailyLogEntry;
        saveLocalLogs(localMap);
        return data as DailyLogEntry;
      } else if (error) {
        console.error('Errore upsert Supabase:', error.message);
      }
    } catch (err) {
      console.error('Eccezione salvataggio Supabase:', err);
    }
  }

  // Fallback LocalStorage
  const localMap = getLocalLogs();
  localMap[dateStr] = entry;
  saveLocalLogs(localMap);
  return entry;
}
