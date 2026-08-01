/**
 * Lettura dei calendari iCal delle prenotazioni.
 *
 * Il formato prodotto da bed-and-breakfast.it porta, oltre alle date, anche il
 * numero di ospiti e le notti dentro la DESCRIPTION:
 *
 *   SUMMARY:Rossi Mario (Booking.com: 6461785778)
 *   DTSTART;VALUE=DATE:20260801
 *   DTEND;VALUE=DATE:20260804
 *   DESCRIPTION:CHECKIN: 01 ago 2026\nCHECKOUT: 04 ago 2026\nNOTTI: 3\n
 *               CAMERA: Deluxe Double Room\nOSPITI: 3\nPREZZO: 205,20
 *
 * Da lì si ricava tutto quello che serve alla tassa di soggiorno.
 */

export interface PrenotazioneICal {
  uid: string;
  nome: string;
  dataInizio: string; // YYYY-MM-DD
  dataFine: string;   // YYYY-MM-DD
  notti: number;
  ospiti: number;
}

/**
 * Rimette insieme le righe spezzate: nel formato iCal una riga che comincia con
 * uno spazio è la continuazione di quella precedente.
 */
function unisciRighe(testo: string): string[] {
  const righe = testo.replace(/\r\n/g, '\n').split('\n');
  const unite: string[] = [];

  for (const riga of righe) {
    if ((riga.startsWith(' ') || riga.startsWith('\t')) && unite.length > 0) {
      unite[unite.length - 1] += riga.slice(1);
    } else {
      unite.push(riga);
    }
  }

  return unite;
}

/** Scioglie le sequenze di escape del formato iCal */
function decodificaValore(valore: string): string {
  return valore
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** I nomi arrivano con le entità HTML: D&#39;ambrosio */
function decodificaEntita(testo: string): string {
  return testo
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** 20260801 oppure 20260801T120000Z -> 2026-08-01 */
function dataIso(valore: string): string | null {
  const soloData = valore.trim().slice(0, 8);
  if (!/^\d{8}$/.test(soloData)) return null;
  return `${soloData.slice(0, 4)}-${soloData.slice(4, 6)}-${soloData.slice(6, 8)}`;
}

function differenzaGiorni(inizio: string, fine: string): number {
  const a = new Date(`${inizio}T00:00:00Z`).getTime();
  const b = new Date(`${fine}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Toglie dal titolo il riferimento al portale:
 * "Rossi Mario (Booking.com: 6461785778)" -> "Rossi Mario"
 */
function nomeDaSummary(summary: string): string {
  return decodificaEntita(summary.replace(/\s*\([^)]*\)\s*$/, '').trim());
}

/** Legge una voce dalla descrizione, es. "OSPITI: 3" */
function campoDescrizione(descrizione: string, etichetta: string): string | null {
  const trovato = descrizione.match(new RegExp(`${etichetta}\\s*:\\s*([^\\n]+)`, 'i'));
  return trovato ? trovato[1].trim() : null;
}

/**
 * Estrae le prenotazioni da un calendario iCal.
 * Le voci senza date utilizzabili vengono scartate.
 */
export function leggiPrenotazioni(testoIcal: string): PrenotazioneICal[] {
  const prenotazioni: PrenotazioneICal[] = [];
  let dentroEvento = false;
  let campi: Record<string, string> = {};

  for (const riga of unisciRighe(testoIcal)) {
    if (riga.startsWith('BEGIN:VEVENT')) {
      dentroEvento = true;
      campi = {};
      continue;
    }

    if (riga.startsWith('END:VEVENT')) {
      dentroEvento = false;

      const dataInizio = dataIso(campi['DTSTART'] || '');
      const dataFine = dataIso(campi['DTEND'] || '');
      if (!dataInizio || !dataFine) continue;

      const descrizione = decodificaValore(campi['DESCRIPTION'] || '');

      // DTEND è il giorno di partenza, quindi la differenza è già il numero di notti
      const nottiDaDate = differenzaGiorni(dataInizio, dataFine);
      const nottiDichiarate = Number(campoDescrizione(descrizione, 'NOTTI'));
      const ospiti = Number(campoDescrizione(descrizione, 'OSPITI'));

      prenotazioni.push({
        uid: campi['UID'] || `${dataInizio}-${dataFine}-${campi['SUMMARY'] || ''}`,
        nome: nomeDaSummary(decodificaValore(campi['SUMMARY'] || '')) || 'Ospite',
        dataInizio,
        dataFine,
        notti: nottiDaDate > 0 ? nottiDaDate : (nottiDichiarate || 0),
        ospiti: ospiti > 0 ? ospiti : 1
      });

      continue;
    }

    if (!dentroEvento) continue;

    const duePunti = riga.indexOf(':');
    if (duePunti < 0) continue;

    // Il nome della proprietà può portare parametri: DTSTART;VALUE=DATE
    const nomeCampo = riga.slice(0, duePunti).split(';')[0].toUpperCase();
    campi[nomeCampo] = riga.slice(duePunti + 1);
  }

  return prenotazioni;
}
