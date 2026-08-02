/**
 * Differenza rilevata a magazzino per un Gratta e Vinci.
 * I valori possono essere negativi (mancante) o positivi (in più).
 */
export interface GrattaEVinciConta {
  gioco: string;
  prezzo: number;
  pacchi: number;
  pezzi: number;
}

/**
 * Differenza rilevata a magazzino per una marca di sigarette
 */
export interface SigaretteConta {
  marca: string;
  stecche: number;
  pacchetti: number;
}

/** L'inventario di una giornata */
export interface InventarioGiornata {
  date: string;
  grattaEVinci: GrattaEVinciConta[];
  sigarette: SigaretteConta[];
}

/** Filtro attivo nella lista delle attività */
export type TodoFilter = 'da-fare' | 'fatte';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdBy: string;
  createdAt: string;
  /**
   * Quando è stata segnata come fatta, in formato ISO.
   * Serve a farla sparire dall'elenco dopo una settimana: senza, le completate
   * si accumulerebbero per sempre.
   */
  completedAt?: string;
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
 *
 * Non tutte le voci fanno il totale: bar, logista, gratta e vinci e tabacchi
 * si registrano soltanto per guardarli nelle statistiche. Del Lotto entra il
 * giocato, perché è su quello che il negozio prende l'aggio; le vincite pagate
 * si segnano ma non si sottraggono.
 */
export interface ShiftValues {
  /** Contanti in cassa */
  contanti: number;
  sisal: number;
  mooney: number;
  lis: number;
  printer: number;
  /** Il giocato: è questa la voce che entra nel totale */
  lotto_entrate: number;
  /** Vincite pagate: si registrano, ma dal totale non si tolgono */
  lotto_uscite: number;
  fatture: number;

  // Voci da statistiche: nessuna di queste entra in un totale
  logista: number;
  gratta_e_vinci: number;
  bar: number;
  tabacchi: number;
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
  todos?: TodoItem[];
}

/**
 * Note, chat e task della giornata: vivono in una tabella a parte perché non
 * appartengono a un turno in particolare.
 */
export interface DayExtras {
  notes?: string;
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
