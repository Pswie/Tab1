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
 * Non tutte le voci fanno il totale: bar, logista e gratta e vinci si
 * registrano soltanto per guardarli nelle statistiche. Del Lotto entra il
 * netto, perché le vincite pagate escono davvero dalla cassa; il giocato è la
 * cifra su cui si prende l'aggio e si guarda nella dashboard.
 */
export interface ShiftValues {
  /** Contanti in cassa */
  contanti: number;

  /**
   * Sisal a entrate e uscite, come il Lotto: nel totale entra il netto.
   * Prima era una voce sola, e un'uscita si registrava col meno davanti.
   */
  sisal_entrate: number;
  sisal_uscite: number;

  mooney: number;
  lis: number;
  printer: number;
  /** Il giocato: è la cifra che si guarda nella dashboard */
  lotto_entrate: number;
  /** Vincite pagate: escono dalla cassa, quindi si tolgono dal totale */
  lotto_uscite: number;
  fatture: number;

  /**
   * Quanto si è contato davvero alla chiusura del turno.
   *
   * Non entra nel totale del turno: serve a confrontarlo con quello che il
   * totale dice che dovrebbe esserci, ed è da lui che parte la differenza.
   */
  effettivo: number;

  /** Voce B: si toglie nel conto della differenza */
  b: number;

  // Voci da statistiche: nessuna di queste entra in un totale
  logista: number;
  gratta_e_vinci: number;
  bar: number;
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

  /**
   * Lo scarto del turno: Effettivo contato - Totale del turno - B.
   *
   * Lo scrive l'app e non il database: per il turno pomeriggio il totale è la
   * differenza rispetto alla mattina, e una colonna calcolata, che vede solo
   * la propria riga, arriverebbe a un altro numero.
   */
  differenza_turno?: number;
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

  /**
   * Lo scarto di ogni turno: Effettivo contato - Totale del turno - B.
   * Resta fuori dal totale della giornata, che continua a essere la somma
   * delle due chiusure.
   */
  differenzaTurnoMattina: number;
  differenzaTurnoPomeriggio: number;
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
