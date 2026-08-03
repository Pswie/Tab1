import { isSupabaseConfigured, supabase } from './supabase';
import { ShiftRow, ShiftValues } from '../types';
import {
  calculateDayTotals,
  calculateLottoAggio,
  calculateNetMovement,
  emptyShiftValues,
  getTodayDateString,
  isShiftFilled
} from '../utils/calculations';

/**
 * I numeri della dashboard del titolare.
 *
 * Ogni giornata ha due chiusure e quelle del pomeriggio sono LETTURE CUMULATIVE
 * dell'intera giornata: qui le due righe vengono rimesse insieme una volta
 * sola, così le statistiche lavorano su giornate già ricomposte e nessun conto
 * rischia di sommare due volte lo stesso incasso.
 */

/** Una giornata di lavoro ricomposta dalle sue due chiusure */
export interface GiornataIncasso {
  data: string;
  /** Incasso dell'intera giornata */
  totale: number;
  totaleTurno1: number;
  /** null finché la chiusura del pomeriggio non è stata inserita */
  totaleTurno2: number | null;
  /** Letture dell'intera giornata, voce per voce */
  voci: ShiftValues;
  aggioLotto: number;
}

/** Le giornate di un mese messe insieme */
export interface MeseIncasso {
  /** YYYY-MM */
  mese: string;
  /** "Agosto 2026" */
  etichetta: string;
  /** "ago 26", per gli assi dei grafici */
  etichettaBreve: string;
  totale: number;
  /** Giornate davvero registrate: i giorni di chiusura non abbassano le medie */
  giornate: number;
  mediaGiornaliera: number;
  /** Il mese che si sta ancora facendo: il suo totale è per forza parziale */
  inCorso: boolean;
  voci: ShiftValues;
  aggioLotto: number;
}

/** Media di un giorno della settimana, dal lunedì alla domenica */
export interface MediaSettimanale {
  giorno: string;
  media: number;
  giornate: number;
}

/** Quanto ha portato ogni voce nel periodo osservato */
export interface VoceRipartizione {
  etichetta: string;
  valore: number;
  /** Quota sul totale del periodo, in percentuale */
  quota: number;
}

const RIGHE_PER_PAGINA = 1000;

/**
 * Scarica tutte le chiusure registrate.
 *
 * PostgREST ne restituisce al massimo mille per volta e con due chiusure al
 * giorno il limite arriva dopo poco più di un anno: senza scorrere a pagine la
 * dashboard comincerebbe a perdere i mesi più vecchi senza dirlo.
 */
async function leggiChiusure(): Promise<ShiftRow[]> {
  if (!isSupabaseConfigured() || !supabase) return [];

  const righe: ShiftRow[] = [];

  for (let pagina = 0; ; pagina++) {
    const da = pagina * RIGHE_PER_PAGINA;

    const { data, error } = await supabase
      .from('daily_logs')
      // Solo le colonne che servono: su migliaia di righe il resto è peso inutile
      // Tutte le colonne invece dell'elenco: chiedere per nome una colonna che
      // sul database non c'è ancora fa fallire l'intera lettura, e la dashboard
      // resterebbe vuota fino a quando lo schema non viene aggiornato
      .select('*')
      // L'ordinamento comprende il turno: due righe con la stessa data
      // potrebbero altrimenti cambiare posto fra una pagina e l'altra, e una
      // chiusura finirebbe letta due volte o mai
      .order('date', { ascending: true })
      .order('turno', { ascending: true })
      .range(da, da + RIGHE_PER_PAGINA - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    righe.push(...(data as ShiftRow[]));
    if (data.length < RIGHE_PER_PAGINA) break;
  }

  return righe;
}

/** Estrae le sole voci di importo da una riga del database */
function vociDaRiga(riga: ShiftRow | undefined): ShiftValues {
  if (!riga) return emptyShiftValues();

  return {
    contanti: Number(riga.contanti) || 0,
    sisal_entrate: Number(riga.sisal_entrate) || 0,
    sisal_uscite: Number(riga.sisal_uscite) || 0,
    mooney: Number(riga.mooney) || 0,
    lis: Number(riga.lis) || 0,
    printer: Number(riga.printer) || 0,
    lotto_entrate: Number(riga.lotto_entrate) || 0,
    lotto_uscite: Number(riga.lotto_uscite) || 0,
    fatture: Number(riga.fatture) || 0,
    fatture_voci: [],
    effettivo: Number(riga.effettivo) || 0,
    b: Number(riga.b) || 0,
    logista: Number(riga.logista) || 0,
    gratta_e_vinci: Number(riga.gratta_e_vinci) || 0,
    bar: Number(riga.bar) || 0
  };
}

function sommaVoci(elenco: ShiftValues[]): ShiftValues {
  return elenco.reduce<ShiftValues>((somma, v) => ({
    contanti: somma.contanti + v.contanti,
    sisal_entrate: somma.sisal_entrate + v.sisal_entrate,
    sisal_uscite: somma.sisal_uscite + v.sisal_uscite,
    mooney: somma.mooney + v.mooney,
    lis: somma.lis + v.lis,
    printer: somma.printer + v.printer,
    lotto_entrate: somma.lotto_entrate + v.lotto_entrate,
    lotto_uscite: somma.lotto_uscite + v.lotto_uscite,
    fatture: somma.fatture + v.fatture,
    // Le statistiche guardano i totali: il dettaglio delle fatture non si somma
    fatture_voci: [],
    effettivo: somma.effettivo + v.effettivo,
    b: somma.b + v.b,
    logista: somma.logista + v.logista,
    gratta_e_vinci: somma.gratta_e_vinci + v.gratta_e_vinci,
    bar: somma.bar + v.bar
  }), emptyShiftValues());
}

/**
 * Tutte le giornate registrate, dalla più vecchia alla più recente.
 *
 * Le giornate senza nemmeno una chiusura compilata restano fuori: non sono un
 * incasso pari a zero ma un buco, e contarle abbasserebbe ogni media.
 */
export async function caricaGiornate(): Promise<GiornataIncasso[]> {
  const righe = await leggiChiusure();

  const perData = new Map<string, ShiftRow[]>();

  righe.forEach(riga => {
    const gruppo = perData.get(riga.date);
    if (gruppo) gruppo.push(riga);
    else perData.set(riga.date, [riga]);
  });

  const giornate: GiornataIncasso[] = [];

  perData.forEach((gruppo, data) => {
    const mattina = vociDaRiga(gruppo.find(r => r.turno === 'mattina'));
    const pomeriggio = vociDaRiga(gruppo.find(r => r.turno === 'pomeriggio'));
    const totali = calculateDayTotals(mattina, pomeriggio);

    if (!isShiftFilled(mattina) && !totali.pomeriggioCompilato) return;

    // Le voci del pomeriggio sono cumulative: se c'è quella, è la giornata intera
    const voci = totali.pomeriggioCompilato ? pomeriggio : mattina;

    giornate.push({
      data,
      totale: totali.totaleGiornata,
      totaleTurno1: totali.totaleTurnoMattina,
      totaleTurno2: totali.pomeriggioCompilato ? totali.totaleTurnoPomeriggio : null,
      voci,
      aggioLotto: calculateLottoAggio(voci.lotto_entrate)
    });
  });

  return giornate.sort((a, b) => a.data.localeCompare(b.data));
}

/** "2026-08" -> "Agosto 2026" */
function etichettaMese(mese: string): string {
  const [anno, numero] = mese.split('-').map(Number);
  const testo = new Date(anno, numero - 1, 1)
    .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

/** "2026-08" -> "ago 26" */
function etichettaMeseBreve(mese: string): string {
  const [anno, numero] = mese.split('-').map(Number);
  const testo = new Date(anno, numero - 1, 1)
    .toLocaleDateString('it-IT', { month: 'short' })
    .replace('.', '');

  return `${testo} ${String(anno).slice(2)}`;
}

/** Mese in corso secondo il calendario italiano, in formato YYYY-MM */
export function meseCorrente(): string {
  return getTodayDateString().slice(0, 7);
}

/**
 * Le giornate raggruppate per mese, dal più vecchio al più recente.
 * I mesi senza nessuna giornata registrata non compaiono affatto.
 */
export function raggruppaPerMese(giornate: GiornataIncasso[]): MeseIncasso[] {
  const corrente = meseCorrente();
  const perMese = new Map<string, GiornataIncasso[]>();

  giornate.forEach(g => {
    const mese = g.data.slice(0, 7);
    const gruppo = perMese.get(mese);
    if (gruppo) gruppo.push(g);
    else perMese.set(mese, [g]);
  });

  return Array.from(perMese.entries())
    .map(([mese, elenco]) => {
      const totale = elenco.reduce((s, g) => s + g.totale, 0);
      const voci = sommaVoci(elenco.map(g => g.voci));

      return {
        mese,
        etichetta: etichettaMese(mese),
        etichettaBreve: etichettaMeseBreve(mese),
        totale,
        giornate: elenco.length,
        mediaGiornaliera: elenco.length === 0 ? 0 : totale / elenco.length,
        inCorso: mese === corrente,
        voci,
        aggioLotto: elenco.reduce((s, g) => s + g.aggioLotto, 0)
      };
    })
    .sort((a, b) => a.mese.localeCompare(b.mese));
}

/**
 * Media degli incassi mensili sui soli mesi conclusi.
 *
 * Il mese in corso resta fuori: è fermo a metà strada e tirato dentro
 * farebbe sembrare che si stia incassando meno di prima.
 */
export function mediaMensileConclusi(mesi: MeseIncasso[]): number {
  const conclusi = mesi.filter(m => !m.inCorso);
  if (conclusi.length === 0) return 0;

  return conclusi.reduce((s, m) => s + m.totale, 0) / conclusi.length;
}

/** Media degli incassi mensili contando anche il mese in corso, ancora parziale */
export function mediaMensileConParziale(mesi: MeseIncasso[]): number {
  if (mesi.length === 0) return 0;
  return mesi.reduce((s, m) => s + m.totale, 0) / mesi.length;
}

/**
 * Dove andrebbe a finire il mese in corso tenendo il passo attuale.
 *
 * È una proporzione sui giorni di calendario trascorsi, non una previsione:
 * un mese con le feste dentro può chiudere lontano da questo numero.
 */
export function proiezioneMese(mese: MeseIncasso | undefined, oggi = getTodayDateString()): number | null {
  if (!mese || !mese.inCorso || mese.totale === 0) return null;

  const [anno, numero, giorno] = oggi.split('-').map(Number);
  const giorniDelMese = new Date(anno, numero, 0).getDate();

  if (giorno >= giorniDelMese) return mese.totale;

  return (mese.totale / giorno) * giorniDelMese;
}

/**
 * Incasso del mese indicato fino allo stesso giorno del mese.
 *
 * Serve a confrontare il mese in corso con quello prima senza mettere dieci
 * giorni contro trenta.
 */
export function totaleFinoAlGiorno(giornate: GiornataIncasso[], mese: string, giorno: number): number {
  return giornate
    .filter(g => g.data.slice(0, 7) === mese && Number(g.data.slice(8, 10)) <= giorno)
    .reduce((s, g) => s + g.totale, 0);
}

/** Mese precedente a quello indicato, in formato YYYY-MM */
export function mesePrecedente(mese: string): string {
  const [anno, numero] = mese.split('-').map(Number);
  const d = new Date(anno, numero - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const GIORNI_SETTIMANA = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

/**
 * Quanto rende in media ogni giorno della settimana: dice quali sono le
 * giornate di lavoro vero e quali si potrebbero coprire con meno gente.
 */
export function mediePerGiornoSettimana(giornate: GiornataIncasso[]): MediaSettimanale[] {
  const somme = GIORNI_SETTIMANA.map(giorno => ({ giorno, totale: 0, giornate: 0 }));

  giornate.forEach(g => {
    const [anno, mese, giorno] = g.data.split('-').map(Number);

    // getDay() dà 0 per domenica: in Italia la settimana comincia di lunedì
    const indiceJs = new Date(anno, mese - 1, giorno).getDay();
    const indice = indiceJs === 0 ? 6 : indiceJs - 1;

    somme[indice].totale += g.totale;
    somme[indice].giornate += 1;
  });

  return somme.map(s => ({
    giorno: s.giorno,
    giornate: s.giornate,
    media: s.giornate === 0 ? 0 : s.totale / s.giornate
  }));
}

/**
 * Quanto ha portato ogni servizio nel periodo.
 *
 * Del Lotto si guarda il GIOCATO, che è la cifra su cui il negozio prende
 * l'aggio: nel totale della giornata entra invece il netto, ma qui interessa
 * quanto movimenta il Lotto, non quanto resta in cassa. Restano fuori le voci
 * da statistiche, che hanno un riquadro loro, le fatture, che si sottraggono,
 * e l'aggio, che è un compenso e non un incasso di cassa.
 */
export function ripartizionePerVoce(giornate: GiornataIncasso[]): VoceRipartizione[] {
  const voci = sommaVoci(giornate.map(g => g.voci));

  const righe = [
    // Del Sisal conta il netto, come per il Lotto conta il giocato
    { etichetta: 'Sisal', valore: calculateNetMovement(voci.sisal_entrate, voci.sisal_uscite) },
    { etichetta: 'Mooney', valore: voci.mooney },
    { etichetta: 'Lis', valore: voci.lis },
    { etichetta: 'Printer', valore: voci.printer },
    { etichetta: 'Lotto giocato', valore: voci.lotto_entrate }
  ];

  // La quota si misura sulla somma di quello che entra: le voci in perdita
  // non devono gonfiare il denominatore e portare le quote oltre il cento
  const positivo = righe.reduce((s, r) => s + Math.max(r.valore, 0), 0);

  return righe
    .map(r => ({ ...r, quota: positivo === 0 ? 0 : (r.valore / positivo) * 100 }))
    .sort((a, b) => b.valore - a.valore);
}

/** Le altre voci della giornata, quelle che nel totale non entrano */
export function vociFuoriTotale(giornate: GiornataIncasso[]): {
  bar: number;
  grattaEVinci: number;
  logista: number;
  fatture: number;
  aggioLotto: number;
  lottoEntrate: number;
  lottoUscite: number;
} {
  const voci = sommaVoci(giornate.map(g => g.voci));

  return {
    bar: voci.bar,
    grattaEVinci: voci.gratta_e_vinci,
    logista: voci.logista,
    fatture: voci.fatture,
    aggioLotto: giornate.reduce((s, g) => s + g.aggioLotto, 0),
    lottoEntrate: voci.lotto_entrate,
    lottoUscite: voci.lotto_uscite
  };
}

/** La giornata che ha reso di più e quella che ha reso di meno */
export function estremi(giornate: GiornataIncasso[]): {
  migliore: GiornataIncasso | null;
  peggiore: GiornataIncasso | null;
} {
  if (giornate.length === 0) return { migliore: null, peggiore: null };

  let migliore = giornate[0];
  let peggiore = giornate[0];

  giornate.forEach(g => {
    if (g.totale > migliore.totale) migliore = g;
    if (g.totale < peggiore.totale) peggiore = g;
  });

  return { migliore, peggiore };
}

/**
 * Quanto pesa il turno del mattino rispetto a quello del pomeriggio.
 * Contano solo le giornate chiuse davvero: in quelle a metà il secondo turno
 * non esiste ancora e conteggiarlo come zero falserebbe il confronto.
 */
export function pesoDeiTurni(giornate: GiornataIncasso[]): {
  mattina: number;
  pomeriggio: number;
  giornate: number;
} {
  const complete = giornate.filter(g => g.totaleTurno2 !== null);

  return {
    mattina: complete.reduce((s, g) => s + g.totaleTurno1, 0),
    pomeriggio: complete.reduce((s, g) => s + (g.totaleTurno2 || 0), 0),
    giornate: complete.length
  };
}
