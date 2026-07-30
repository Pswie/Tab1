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

export interface DailyLogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  created_at?: string;
  user_id?: string;
  tabacchi: number;
  sisal: number;
  lis: number;
  printer: number;
  lotto_entrate: number;
  lotto_uscite: number;
  lotto_aggio: number; // Calcolato: 8% di lotto_entrate
  lotto_netto: number; // Calcolato (Lotto Entrate - Lotto Uscite)
  fatture: number;
  totale_giornata: number; // Calcolato (Tabacchi + Sisal + Lis + Printer + Lotto Netto - Fatture)
  notes?: string;
  chat_notes?: NoteItem[];
  todos?: TodoItem[];
}

export type LogFormData = Omit<DailyLogEntry, 'id' | 'created_at' | 'user_id' | 'lotto_netto' | 'totale_giornata'>;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
