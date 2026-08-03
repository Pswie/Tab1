import { DayTotals, ShiftKey, ShiftValues, VoceFattura } from '../types';

/** Ora in cui si passa dal turno pomeriggio del giorno prima a quello mattina */
const ORA_INIZIO_MATTINA = 10;

/** Ora in cui si passa dal turno mattina a quello pomeriggio */
const ORA_INIZIO_POMERIGGIO = 16;

/**
 * Gli orari dei turni e le date sono sempre quelli italiani: il fuso del
 * dispositivo viene ignorato, così un telefono impostato male o in viaggio
 * non fa aprire il turno sbagliato.
 */
const FUSO_ITALIA = 'Europe/Rome';

interface RomeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/**
 * Scompone un istante nei suoi valori di calendario italiani
 */
function getRomeParts(instant: Date): RomeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO_ITALIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour')
  };
}

/**
 * Ora italiana corrente (0-23)
 */
export function getItalianHour(instant: Date = new Date()): number {
  return getRomeParts(instant).hour;
}

/**
 * Data di calendario italiana come oggetto Date a mezzanotte locale, così le
 * somme e sottrazioni di giorni restano semplici e senza sfasamenti.
 */
function getItalianCalendarDate(instant: Date = new Date()): Date {
  const { year, month, day } = getRomeParts(instant);
  return new Date(year, month - 1, day);
}

/**
 * Data italiana odierna spostata di N giorni, in formato YYYY-MM-DD
 */
function italianDateShifted(days: number, instant: Date = new Date()): string {
  const d = getItalianCalendarDate(instant);
  d.setDate(d.getDate() + days);
  return formatDateLocalISO(d);
}

/**
 * Restituisce una chiusura vuota
 */
export function emptyShiftValues(): ShiftValues {
  return {
    contanti: 0,
    sisal_entrate: 0,
    sisal_uscite: 0,
    mooney: 0,
    lis: 0,
    printer: 0,
    lotto_entrate: 0,
    lotto_uscite: 0,
    fatture: 0,
    fatture_voci: [],
    effettivo: 0,
    b: 0,
    logista: 0,
    gratta_e_vinci: 0,
    bar: 0
  };
}

/**
 * Indica se una chiusura è stata compilata. Serve a distinguere "serale a zero
 * perché non ancora inserita" da "serale davvero pari a zero": finché la sera è
 * vuota il totale della giornata resta quello del pranzo.
 *
 * Le voci da statistiche restano fuori: da sole non chiudono un turno, e un
 * incasso del bar segnato per primo farebbe passare per fatta una chiusura
 * che nessuno ha ancora compilato.
 *
 * Fuori anche l'effettivo contato e la voce B: sono un controllo su un totale
 * che deve già esistere, e da soli non fanno una chiusura.
 */
export function isShiftFilled(values: ShiftValues): boolean {
  return (
    values.contanti !== 0 ||
    values.sisal_entrate !== 0 ||
    values.sisal_uscite !== 0 ||
    values.mooney !== 0 ||
    values.lis !== 0 ||
    values.printer !== 0 ||
    values.lotto_entrate !== 0 ||
    values.lotto_uscite !== 0 ||
    values.fatture !== 0
  );
}

/**
 * Calcola l'Aggio del Lotto: 8% delle entrate
 */
export function calculateLottoAggio(entrate: number): number {
  const e = isNaN(entrate) ? 0 : entrate;
  return Number((e * 0.08).toFixed(2));
}

/**
 * Il totale delle fatture: la somma di quelle scritte una per una.
 */
export function totaleFatture(voci: VoceFattura[]): number {
  const somma = (voci || []).reduce((s, v) => s + (isNaN(v.importo) ? 0 : v.importo), 0);
  return Number(somma.toFixed(2));
}

/**
 * Le fatture da mostrare per una chiusura.
 *
 * Le chiusure scritte prima del dettaglio hanno solo l'importo: si presentano
 * come un'unica voce, così il totale non cambia e da lì si può correggere.
 */
export function vociFattura(values: ShiftValues): VoceFattura[] {
  if (values.fatture_voci && values.fatture_voci.length > 0) return values.fatture_voci;
  if (!values.fatture) return [];

  return [{ nome: 'Fatture', importo: values.fatture }];
}

/**
 * Netto di un blocco entrate/uscite: Entrate - Uscite.
 *
 * Vale per il Lotto e per il Sisal allo stesso modo: quello che si è incassato
 * meno quello che è stato pagato allo sportello, cioè quanto resta davvero.
 */
export function calculateNetMovement(entrate: number, uscite: number): number {
  const e = isNaN(entrate) ? 0 : entrate;
  const u = isNaN(uscite) ? 0 : uscite;
  return Number((e - u).toFixed(2));
}

/**
 * Calcola il valore netto del Lotto: Entrate - Uscite
 */
export function calculateLottoNet(entrate: number, uscite: number): number {
  return calculateNetMovement(entrate, uscite);
}

/**
 * Totale di una singola lettura:
 * Contanti + Sisal Netto + Mooney + Lis + Printer + Lotto Netto - Fatture
 *
 * Sisal e Lotto entrano tutti e due col netto: le uscite sono soldi usciti
 * davvero dalla cassa.
 *
 * Del Lotto entra il netto: le vincite pagate allo sportello escono davvero
 * dalla cassa, quindi vanno tolte. Il giocato, che è la cifra su cui si prende
 * l'aggio, si guarda nella dashboard e non qui.
 *
 * Bar, logista e gratta e vinci non compaiono: si registrano per le
 * statistiche e basta.
 */
export function calculateShiftReading(values: ShiftValues): number {
  const safe = (n: number) => (isNaN(n) ? 0 : n);

  const totale =
    safe(values.contanti) +
    (safe(values.sisal_entrate) - safe(values.sisal_uscite)) +
    safe(values.mooney) +
    safe(values.lis) +
    safe(values.printer) +
    (safe(values.lotto_entrate) - safe(values.lotto_uscite)) -
    safe(values.fatture);

  return Number(totale.toFixed(2));
}

/**
 * Lo scarto di un turno: Effettivo contato - Totale del turno - B.
 *
 * Dice se quello che si è contato davvero sta con quello che il totale dice
 * che dovrebbe esserci, e lo dice dal punto di vista della cassa: positivo
 * vuol dire che si è trovato di più, negativo che si è trovato di meno.
 *
 * Il totale del turno arriva da fuori perché per il pomeriggio non è la
 * lettura della riga ma la differenza rispetto alla mattina.
 */
export function calculateShiftDifference(totaleTurno: number, values: ShiftValues): number {
  const safe = (n: number) => (isNaN(n) ? 0 : n);

  return Number((safe(values.effettivo) - totaleTurno - safe(values.b)).toFixed(2));
}

/**
 * Calcola i totali della giornata a partire dalle due chiusure.
 *
 * La lettura serale è cumulativa sull'intera giornata, quindi il secondo turno
 * è la differenza rispetto al pranzo e il totale del giorno coincide con la
 * lettura serale. Se la sera non è ancora stata compilata, il totale della
 * giornata è quello del solo turno di pranzo.
 */
export function calculateDayTotals(mattina: ShiftValues, pomeriggio: ShiftValues): DayTotals {
  const pomeriggioCompilato = isShiftFilled(pomeriggio);

  const totaleTurnoMattina = calculateShiftReading(mattina);
  const letturaPomeriggio = calculateShiftReading(pomeriggio);

  const totaleTurnoPomeriggio = pomeriggioCompilato
    ? Number((letturaPomeriggio - totaleTurnoMattina).toFixed(2))
    : 0;

  const totaleGiornata = pomeriggioCompilato ? letturaPomeriggio : totaleTurnoMattina;

  // Anche le voci Lotto sono letture cumulative: quelle del giorno sono le pomeridiane
  const lottoDelGiorno = pomeriggioCompilato ? pomeriggio : mattina;

  return {
    totaleTurnoMattina,
    totaleTurnoPomeriggio,
    totaleGiornata,
    lottoAggio: calculateLottoAggio(lottoDelGiorno.lotto_entrate),
    lottoNetto: calculateLottoNet(lottoDelGiorno.lotto_entrate, lottoDelGiorno.lotto_uscite),
    pomeriggioCompilato,

    differenzaTurnoMattina: calculateShiftDifference(totaleTurnoMattina, mattina),
    // Senza la chiusura del pomeriggio non c'è un secondo turno da confrontare
    differenzaTurnoPomeriggio: pomeriggioCompilato
      ? calculateShiftDifference(totaleTurnoPomeriggio, pomeriggio)
      : 0
  };
}

/**
 * Turno attivo in base all'orario:
 * - dalle 10:00 alle 16:00 si compila la chiusura di pranzo
 * - dalle 16:00 alle 10:00 del giorno dopo si compila quella serale
 */
export function getActiveShift(now: Date = new Date()): ShiftKey {
  const hour = getItalianHour(now);
  return hour >= ORA_INIZIO_MATTINA && hour < ORA_INIZIO_POMERIGGIO ? 'mattina' : 'pomeriggio';
}

/**
 * Giornata su cui si sta lavorando in base all'orario italiano. Prima delle
 * 10:00 si sta ancora chiudendo il pomeriggio precedente, quindi la data è ieri.
 */
export function getWorkingDateString(now: Date = new Date()): string {
  return getItalianHour(now) < ORA_INIZIO_MATTINA
    ? italianDateShifted(-1, now)
    : italianDateShifted(0, now);
}

/**
 * Etichetta leggibile del turno
 */
export function getShiftLabel(shift: ShiftKey): string {
  return shift === 'mattina' ? 'Turno Mattina' : 'Turno Pomeriggio';
}

/**
 * Formatta un valore numerico in valuta Euro (es: 1.234,56 €)
 */
export function formatCurrency(amount: number): string {
  const val = isNaN(amount) ? 0 : amount;
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
}

/**
 * Converte stringhe input dell'utente (supporta sia punto che virgola) in float valido
 */
/**
 * Come formatCurrency, ma con il segno sempre davanti.
 *
 * Uno scarto va letto per quello che è: senza il + davanti un numero positivo
 * si confonde con un importo qualsiasi, e la differenza serve proprio a dire
 * da che parte pende.
 */
export function formatSignedCurrency(amount: number): string {
  const val = isNaN(amount) ? 0 : amount;
  const testo = formatCurrency(Math.abs(val));

  if (val > 0) return `+${testo}`;
  if (val < 0) return `-${testo}`;

  return testo;
}

export function parseInputValue(val: string): number {
  if (!val || val.trim() === '') return 0;
  const sanitized = val.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(sanitized);
  return isNaN(num) ? 0 : num;
}

/**
 * Converte un valore numerico nel testo da mostrare nei campi input, usando la
 * virgola decimale italiana. Lo zero diventa stringa vuota per lasciare il placeholder.
 */
export function formatInputValue(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val) || val === 0) return '';
  return val.toFixed(2).replace('.', ',');
}

/**
 * Formatta una data ISO (YYYY-MM-DD) in formato italiano europeo (es: Venerdì 31 Luglio 2026)
 */
export function formatDateItalian(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const dateObj = new Date(year, month, day);

  const formatted = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(dateObj);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Formatta un oggetto Date nel formato ISO YYYY-MM-DD locale (senza sfasamenti di fuso UTC)
 */
export function formatDateLocalISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Data italiana di domani, in formato YYYY-MM-DD
 */
export function getTomorrowDateString(): string {
  return italianDateShifted(1);
}

/**
 * Data italiana di oggi, in formato YYYY-MM-DD
 */
export function getTodayDateString(): string {
  return italianDateShifted(0);
}

/**
 * Data minima consentita: solo il giorno prima, il tempo di chiudere il
 * pomeriggio precedente. Più indietro di così non si torna.
 */
/**
 * Lunedì della settimana in corso, in formato YYYY-MM-DD.
 * Serve a ripulire ogni settimana gli elenchi che altrimenti si allungherebbero
 * all'infinito, senza toccare i dati conservati nel database.
 */
export function getInizioSettimanaString(instant: Date = new Date()): string {
  const d = getItalianCalendarDate(instant);

  // getDay() dà 0 per domenica: in Italia la settimana comincia di lunedì
  const giorno = d.getDay();
  d.setDate(d.getDate() - (giorno === 0 ? 6 : giorno - 1));

  return formatDateLocalISO(d);
}

export function getMinAllowedDateString(): string {
  return italianDateShifted(-1);
}

/**
 * Data massima consentita (non oltre la giornata italiana corrente)
 */
export function getMaxAllowedDateString(): string {
  return italianDateShifted(0);
}

/**
 * Elenco delle date consentite per i dipendenti: oggi e ieri
 */
export function getEmployeeAllowedDateRange(): string[] {
  return [italianDateShifted(0), italianDateShifted(-1)];
}
