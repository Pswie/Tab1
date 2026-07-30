import { LogFormData } from '../types';

/**
 * Calcola l'Aggio del Lotto: 8% di Lotto Entrate
 */
export function calculateLottoAggio(entrate: number): number {
  const e = isNaN(entrate) ? 0 : entrate;
  return Number((e * 0.08).toFixed(2));
}

/**
 * Calcola il valore netto del Lotto: Lotto Entrate - Lotto Uscite
 */
export function calculateLottoNet(entrate: number, uscite: number): number {
  const e = isNaN(entrate) ? 0 : entrate;
  const u = isNaN(uscite) ? 0 : uscite;
  return Number((e - u).toFixed(2));
}

/**
 * Calcola il Totale Finale della Giornata:
 * Tabacchi + Sisal + Lis + Printer + Lotto Netto - Fatture
 */
export function calculateTotaleGiornata(data: LogFormData): number {
  const tabacchi = isNaN(data.tabacchi) ? 0 : data.tabacchi;
  const sisal = isNaN(data.sisal) ? 0 : data.sisal;
  const lis = isNaN(data.lis) ? 0 : data.lis;
  const printer = isNaN(data.printer) ? 0 : data.printer;
  const fatture = isNaN(data.fatture) ? 0 : data.fatture;
  
  const lottoNetto = calculateLottoNet(data.lotto_entrate, data.lotto_uscite);

  const totale = (tabacchi + sisal + lis + printer + lottoNetto) - fatture;
  return Number(totale.toFixed(2));
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
 * Ottiene la data di domani nel formato YYYY-MM-DD locale per il giorno seguente
 */
export function getTomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDateLocalISO(d);
}

/**
 * Ottiene la data di oggi nel formato YYYY-MM-DD locale
 */
export function getTodayDateString(): string {
  return formatDateLocalISO(new Date());
}

/**
 * Ottiene la data minima consentita (max 2 giorni indietro)
 */
export function getMinAllowedDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return formatDateLocalISO(d);
}

/**
 * Ottiene la data massima consentita (non oltre il giorno corrente)
 */
export function getMaxAllowedDateString(): string {
  return formatDateLocalISO(new Date());
}

/**
 * Restituisce l'elenco delle date consentite per i dipendenti (oggi e max 2 giorni fa)
 */
export function getEmployeeAllowedDateRange(): string[] {
  const dates: string[] = [];
  const today = new Date();

  // Oggi (0)
  dates.push(formatDateLocalISO(today));

  // 1 giorno fa (-1)
  const minus1 = new Date(today);
  minus1.setDate(today.getDate() - 1);
  dates.push(formatDateLocalISO(minus1));

  // 2 giorni fa (-2)
  const minus2 = new Date(today);
  minus2.setDate(today.getDate() - 2);
  dates.push(formatDateLocalISO(minus2));

  return dates;
}
