import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

/**
 * Invia una notifica push a tutti i dispositivi registrati.
 *
 * Serve perché una notifica generata dal browser arriva solo con l'app aperta:
 * per avvisare un collega che non la sta guardando ci vuole un mittente lato
 * server.
 */

const CHIAVE_PUBBLICA = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const CHIAVE_PRIVATA = process.env.VAPID_PRIVATE_KEY;
const CONTATTO = process.env.VAPID_SUBJECT || 'mailto:tabaccheria@example.com';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ errore: 'Metodo non ammesso' });
    return;
  }

  if (!CHIAVE_PUBBLICA || !CHIAVE_PRIVATA) {
    res.status(503).json({ errore: 'Chiavi VAPID non configurate sul server' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(503).json({ errore: 'Supabase non configurato sul server' });
    return;
  }

  const { titolo, testo, mittente } = req.body || {};

  if (!testo) {
    res.status(400).json({ errore: 'Manca il testo della notifica' });
    return;
  }

  webpush.setVapidDetails(CONTATTO, CHIAVE_PUBBLICA, CHIAVE_PRIVATA);

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await db.from('push_iscrizioni').select('*');

  if (error) {
    res.status(502).json({ errore: `Elenco destinatari non leggibile: ${error.message}` });
    return;
  }

  // Chi ha scritto la nota non deve ricevere l'avviso di se stesso
  const destinatari = (data || []).filter(r => r.dispositivo !== mittente);

  const messaggio = JSON.stringify({
    titolo: titolo || 'Nuova attività',
    testo,
    tag: 'attivita'
  });

  const scaduti = [];
  let inviate = 0;

  await Promise.all(destinatari.map(async r => {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        messaggio
      );
      inviate++;
    } catch (err) {
      // 404 e 410 significano che quel dispositivo non esiste più
      if (err.statusCode === 404 || err.statusCode === 410) scaduti.push(r.endpoint);
    }
  }));

  // Le iscrizioni morte si accumulerebbero e farebbero fallire ogni invio
  if (scaduti.length > 0) {
    await db.from('push_iscrizioni').delete().in('endpoint', scaduti);
  }

  res.status(200).json({ inviate, rimossi: scaduti.length });
}
