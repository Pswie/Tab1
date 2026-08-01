/**
 * Ponte per la lettura dei calendari iCal.
 *
 * I portali (Airbnb, Booking, VRBO...) non inviano le intestazioni CORS, quindi
 * il browser non può scaricare il calendario da solo. Questa funzione lo scarica
 * lato server e lo restituisce all'app.
 */

/**
 * Domini ammessi. Senza questo elenco la funzione sarebbe un proxy aperto:
 * chiunque conoscesse l'indirizzo potrebbe usarla per scaricare qualsiasi cosa
 * facendola risultare partita dal nostro server.
 */
const DOMINI_AMMESSI = [
  'bed-and-breakfast.it',
  'airbnb.com',
  'airbnb.it',
  'booking.com',
  'admin.booking.com',
  'vrbo.com',
  'homeaway.com',
  'expedia.com',
  'calendar.google.com',
  'ical.marriott.com'
];

function dominioAmmesso(hostname) {
  const host = hostname.toLowerCase();
  return DOMINI_AMMESSI.some(d => host === d || host.endsWith('.' + d));
}

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ errore: 'Manca il parametro url' });
    return;
  }

  let indirizzo;
  try {
    indirizzo = new URL(url);
  } catch {
    res.status(400).json({ errore: 'Indirizzo non valido' });
    return;
  }

  if (indirizzo.protocol !== 'https:') {
    res.status(400).json({ errore: 'Sono ammessi solo indirizzi https' });
    return;
  }

  if (!dominioAmmesso(indirizzo.hostname)) {
    res.status(403).json({
      errore: `Dominio non ammesso: ${indirizzo.hostname}`,
      ammessi: DOMINI_AMMESSI
    });
    return;
  }

  try {
    const risposta = await fetch(indirizzo.toString(), {
      headers: { 'User-Agent': 'TabaccheriaINES/1.0 (calendario soggiorni)' },
      redirect: 'follow'
    });

    if (!risposta.ok) {
      res.status(502).json({ errore: `Il calendario ha risposto ${risposta.status}` });
      return;
    }

    const testo = await risposta.text();

    if (!testo.includes('BEGIN:VCALENDAR')) {
      res.status(502).json({ errore: 'La risposta non è un calendario iCal' });
      return;
    }

    // Mezz'ora di cache: i portali aggiornano i calendari con lentezza simile
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).send(testo);
  } catch (err) {
    res.status(502).json({ errore: 'Calendario non raggiungibile', dettaglio: String(err) });
  }
}
