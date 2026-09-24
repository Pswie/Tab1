import { isSupabaseConfigured, supabase } from './supabase';
import { puoGestireTurni } from './auth';

/** Le fasce di una giornata, nell'ordine in cui si leggono sul foglio. */
export type FasciaTurno = 'mattina' | 'intermedio' | 'pomeriggio' | 'festa' | 'ferie';

/** Quelle che compaiono nel riquadro della giornata: le ferie stanno a parte. */
export const FASCE_GIORNATA: FasciaTurno[] = ['mattina', 'intermedio', 'pomeriggio', 'festa'];

export const NOMI_FASCIA: Record<FasciaTurno, string> = {
  mattina: 'Mattina',
  intermedio: 'Intermedio',
  pomeriggio: 'Pomeriggio',
  festa: 'Festa',
  ferie: 'Ferie'
};

const ORDINE_FASCIA: FasciaTurno[] = ['mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie'];

export type SquadraTurni = 1 | 2;

/** Dipendente approvato che può essere scelto nel calendario. */
export interface DipendenteTurni {
  id: string;
  nome: string;
  /** null finché non è stato inserito in una delle due squadre alternate. */
  squadra: SquadraTurni | null;
}

export interface TurnoLavoro {
  id: string;
  /** YYYY-MM-DD */
  data: string;
  fascia: FasciaTurno;
  /** Identità stabile del profilo; può mancare soltanto nelle vecchie righe. */
  profiloId: string | null;
  /** Copia leggibile del nome al momento dell'assegnazione. */
  persona: string;
  /** Una precisazione breve accanto al nome: "entra alle 7", "fino alle 12". */
  nota: string;
  /** manuale, automatica/squadra o altro valore conservato dal database. */
  origine: string;
  /** Gli annullamenti restano tracciati nel database ma non nel calendario. */
  annullato: boolean;
  /** Chi ha assegnato il turno. */
  scrittoDa: string;
}

export interface EsitoTurno {
  voci: TurnoLavoro[];
  /** false = salvato solo in locale, i colleghi non lo vedono. */
  suCloud: boolean;
}

const CHIAVE_LOCALE = 'tabaccheria_turni_v2';
const CHIAVE_DIPENDENTI = 'tabaccheria_dipendenti_turni_v1';
let ultimoControlloGenerazione = '';

function eRiga(valore: unknown): valore is Record<string, unknown> {
  return Boolean(valore && typeof valore === 'object' && !Array.isArray(valore));
}

function fasciaValida(valore: unknown): FasciaTurno {
  const fascia = String(valore ?? '') as FasciaTurno;
  return ORDINE_FASCIA.includes(fascia) ? fascia : 'mattina';
}

function squadraValida(valore: unknown): SquadraTurni | null {
  const squadra = Number(valore);
  return squadra === 1 || squadra === 2 ? squadra : null;
}

function daRiga(riga: Record<string, unknown>): TurnoLavoro {
  const profiloId = String(riga.profilo_id ?? riga.profiloId ?? '').trim();

  return {
    id: String(riga.id ?? ''),
    data: String(riga.data ?? '').slice(0, 10),
    fascia: fasciaValida(riga.turno ?? riga.fascia),
    profiloId: profiloId || null,
    persona: String(riga.persona ?? riga.nome ?? '').trim(),
    nota: String(riga.nota ?? ''),
    origine: String(riga.origine ?? 'legacy'),
    annullato: Boolean(riga.annullato),
    scrittoDa: String(riga.creato_da ?? riga.scrittoDa ?? '')
  };
}

function daDipendente(riga: Record<string, unknown>): DipendenteTurni | null {
  const id = String(riga.profilo_id ?? riga.id ?? '').trim();
  const nome = String(riga.nome ?? riga.persona ?? '').trim();
  if (!id || !nome) return null;

  return {
    id,
    nome,
    squadra: squadraValida(riga.squadra)
  };
}

function righeDaRisposta(risposta: unknown): Record<string, unknown>[] {
  if (Array.isArray(risposta)) return risposta.filter(eRiga);
  if (!eRiga(risposta)) return [];

  const annidate = risposta.voci;
  if (Array.isArray(annidate)) return annidate.filter(eRiga);

  return 'id' in risposta ? [risposta] : [];
}

function leggiLocale(): TurnoLavoro[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(eRiga)
      .map(daRiga)
      .filter(voce => voce.id && voce.data && voce.persona);
  } catch {
    return [];
  }
}

function scriviLocale(voci: TurnoLavoro[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (errore) {
    console.error('Errore salvataggio turni', errore);
  }
}

function leggiDipendentiLocali(): DipendenteTurni[] {
  try {
    const raw = localStorage.getItem(CHIAVE_DIPENDENTI);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(eRiga)
      .map(daDipendente)
      .filter((dipendente): dipendente is DipendenteTurni => dipendente !== null);
  } catch {
    return [];
  }
}

function scriviDipendentiLocali(dipendenti: DipendenteTurni[]): void {
  try {
    localStorage.setItem(CHIAVE_DIPENDENTI, JSON.stringify(dipendenti));
  } catch (errore) {
    console.error('Errore salvataggio dipendenti turni', errore);
  }
}

/** Prima le giornate, dentro la giornata le fasce, poi i nomi. */
export function inOrdine(voci: TurnoLavoro[]): TurnoLavoro[] {
  return [...voci].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;

    const fasciaA = ORDINE_FASCIA.indexOf(a.fascia);
    const fasciaB = ORDINE_FASCIA.indexOf(b.fascia);
    if (fasciaA !== fasciaB) return fasciaA - fasciaB;

    return a.persona.localeCompare(b.persona, 'it', { sensitivity: 'base' });
  });
}

function nelPeriodo(voce: TurnoLavoro, dal: string, al: string): boolean {
  return voce.data >= dal && voce.data <= al;
}

function stessaAssegnazione(a: TurnoLavoro, b: TurnoLavoro): boolean {
  if (a.id && a.id === b.id) return true;
  if (a.data !== b.data || a.fascia !== b.fascia) return false;

  if (a.profiloId && b.profiloId) return a.profiloId === b.profiloId;
  return a.persona.localeCompare(b.persona, 'it', { sensitivity: 'base' }) === 0;
}

function unisciLocale(voci: TurnoLavoro[]): void {
  const restanti = leggiLocale().filter(vecchia => !voci.some(nuova => stessaAssegnazione(vecchia, nuova)));
  scriviLocale(inOrdine([...restanti, ...voci]));
}

/** Rimpiazza nella cache la sola finestra appena letta. */
function aggiornaLocale(dal: string, al: string, voci: TurnoLavoro[]): void {
  const fuori = leggiLocale().filter(voce => !nelPeriodo(voce, dal, al));
  scriviLocale(inOrdine([...fuori, ...voci]));
}

/** I turni assegnati fra due date comprese. */
export async function elencaTurni(dal: string, al: string): Promise<TurnoLavoro[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('turni_lavoro')
        .select('*')
        .gte('data', dal)
        .lte('data', al);

      if (!error && data) {
        const voci = inOrdine(data.filter(eRiga).map(daRiga).filter(voce => !voce.annullato));
        aggiornaLocale(dal, al, voci);
        return voci;
      }

      console.warn('Errore lettura turni:', error?.message);
    } catch (errore) {
      console.warn('Eccezione lettura turni:', errore);
    }
  }

  return inOrdine(leggiLocale().filter(voce => nelPeriodo(voce, dal, al)));
}

/**
 * Elenco esatto dei dipendenti approvati e non amministratori.
 *
 * La RPC restituisce soltanto id, nome e squadra: non si allarga la lettura
 * della tabella profili e non si ricavano nomi casuali dai vecchi turni.
 */
export async function elencaDipendentiTurni(): Promise<DipendenteTurni[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase.rpc('elenca_dipendenti_turni');

      if (!error) {
        const dipendenti = righeDaRisposta(data)
          .map(daDipendente)
          .filter((dipendente): dipendente is DipendenteTurni => dipendente !== null)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));

        scriviDipendentiLocali(dipendenti);
        return dipendenti;
      }

      console.warn('Errore lettura dipendenti turni:', error.message);
    } catch (errore) {
      console.warn('Eccezione lettura dipendenti turni:', errore);
    }
  }

  return leggiDipendentiLocali()
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
}

/**
 * Fallback del job automatico: una chiamata al giorno da un account abilitato
 * recupera un eventuale mese non preparato dal Cron.
 */
export async function preparaTurniAutomatici(): Promise<void> {
  const oggi = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  if (ultimoControlloGenerazione === oggi || !isSupabaseConfigured() || !supabase) return;

  try {
    const { error } = await supabase.rpc('genera_turni_automatici');
    if (error) {
      console.warn('Generazione automatica turni non disponibile:', error.message);
      return;
    }

    ultimoControlloGenerazione = oggi;
  } catch (errore) {
    console.warn('Eccezione generazione automatica turni:', errore);
  }
}

/** Le giornate da una data all'altra, comprese. */
function giornate(dal: string, al: string): string[] {
  if (!dal || !al || al < dal) return [];

  const elenco: string[] = [];
  const [anno, mese, giorno] = dal.split('-').map(Number);
  const data = new Date(anno, mese - 1, giorno);

  for (let indice = 0; indice < 366; indice++) {
    const iso = [
      data.getFullYear(),
      String(data.getMonth() + 1).padStart(2, '0'),
      String(data.getDate()).padStart(2, '0')
    ].join('-');

    if (iso > al) break;
    elenco.push(iso);
    data.setDate(data.getDate() + 1);
  }

  return elenco;
}

async function rileggiAssegnazione(
  dataTurno: string,
  fascia: FasciaTurno,
  profiloId: string
): Promise<TurnoLavoro[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('turni_lavoro')
    .select('*')
    .eq('data', dataTurno)
    .eq('turno', fascia)
    .eq('profilo_id', profiloId);

  return !error && data
    ? data.filter(eRiga).map(daRiga).filter(voce => !voce.annullato)
    : [];
}

/**
 * Assegna un dipendente registrato a una giornata.
 *
 * `rendiStabile` non significa "sempre mattina": inserisce la persona nella
 * squadra che in questa settimana copre quella fascia. Da lì seguirà tutta la
 * squadra quando mattina e pomeriggio si scambiano la settimana successiva.
 */
export async function impostaTurnoDipendente(
  dataTurno: string,
  fascia: FasciaTurno,
  dipendente: DipendenteTurni,
  nota = '',
  rendiStabile = false,
  autore = ''
): Promise<EsitoTurno> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase.rpc('imposta_turno_dipendente', {
        p_data: dataTurno,
        p_turno: fascia,
        p_profilo_id: dipendente.id,
        p_nota: nota,
        p_rendi_stabile: rendiStabile
      });

      if (!error) {
        let voci = righeDaRisposta(data).map(daRiga).filter(voce => !voce.annullato);

        // Alcune versioni della funzione possono restituire void: in quel
        // caso si rilegge la riga firmata dal database invece di inventarne una.
        if (voci.length === 0) {
          voci = await rileggiAssegnazione(dataTurno, fascia, dipendente.id);
        }

        if (voci.length > 0) unisciLocale(voci);
        return { voci: inOrdine(voci), suCloud: true };
      }

      console.warn('Turno salvato solo in locale:', error.message);
    } catch (errore) {
      console.warn('Eccezione salvataggio turno:', errore);
    }
  }

  const voce: TurnoLavoro = {
    id: `loc-${dataTurno}-${fascia}-${dipendente.id}`,
    data: dataTurno,
    fascia,
    profiloId: dipendente.id,
    persona: dipendente.nome,
    nota,
    // Senza server non si può davvero modificare la squadra ricorrente: resta
    // un'eccezione manuale locale e l'avviso in UI lo rende esplicito.
    origine: 'manuale',
    annullato: false,
    scrittoDa: autore
  };

  unisciLocale([voce]);
  return { voci: [voce], suCloud: false };
}

/** Assegna lo stesso dipendente per più giorni, usato per le ferie. */
export async function impostaPeriodoDipendente(
  dal: string,
  al: string,
  fascia: FasciaTurno,
  dipendente: DipendenteTurni,
  nota = '',
  autore = ''
): Promise<EsitoTurno> {
  const date = giornate(dal, al);
  if (date.length === 0) return { voci: [], suCloud: false };

  const voci: TurnoLavoro[] = [];
  let tutteSuCloud = true;

  // In sequenza per non far gareggiare gli aggiornamenti della cache locale.
  for (const dataTurno of date) {
    const esito = await impostaTurnoDipendente(
      dataTurno,
      fascia,
      dipendente,
      nota,
      false,
      autore
    );
    voci.push(...esito.voci);
    if (!esito.suCloud) tutteSuCloud = false;
  }

  return { voci: inOrdine(voci), suCloud: tutteSuCloud };
}

/** Annulla una singola assegnazione tramite la funzione protetta sul server. */
export async function annullaTurno(id: string): Promise<boolean> {
  const scriviSenza = () => scriviLocale(leggiLocale().filter(voce => voce.id !== id));

  if (id.startsWith('loc-')) {
    scriviSenza();
    return false;
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase.rpc('annulla_turno_lavoro', { p_id: id });

      if (!error) {
        scriviSenza();
        return true;
      }

      console.warn('Errore annullamento turno:', error.message);
    } catch (errore) {
      console.warn('Eccezione annullamento turno:', errore);
    }
  }

  scriviSenza();
  return false;
}

/** Sposta una festa nella stessa settimana: le due eccezioni si salvano insieme. */
export async function spostaFestaDipendente(
  profiloId: string,
  dal: string,
  al: string,
  nota = ''
): Promise<EsitoTurno> {
  if (!puoGestireTurni()) throw new Error('Non hai il permesso di modificare i turni.');
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Serve una connessione al servizio per spostare la festa nel calendario condiviso.');
  }
  const { data, error } = await supabase.rpc('sposta_festa_turni', {
    p_profilo_id: profiloId, p_dal: dal, p_al: al, p_nota: nota
  });
  if (error) {
    console.warn('Spostamento festa non salvato:', error.message);
    throw new Error(error.code === '22023' ? error.message : 'Festa non spostata. Controlla la connessione e riprova.');
  }
  const voci = righeDaRisposta(data).map(daRiga).filter(voce => !voce.annullato);
  // Una persona ha una sola assegnazione al giorno, anche se cambia fascia.
  const restanti = leggiLocale().filter(vecchia =>
    !(vecchia.profiloId === profiloId && (vecchia.data === dal || vecchia.data === al))
  );
  scriviLocale(inOrdine([...restanti, ...voci]));
  return { voci: inOrdine(voci), suCloud: true };
}
