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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

function tokenAutenticazione(req) {
  const intestazione = String(req.headers.authorization || '');
  return intestazione.startsWith('Bearer ') ? intestazione.slice(7).trim() : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ errore: 'Metodo non ammesso' });
    return;
  }

  if (!CHIAVE_PUBBLICA || !CHIAVE_PRIVATA) {
    res.status(503).json({ errore: 'Chiavi VAPID non configurate sul server' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(503).json({ errore: 'Supabase non configurato sul server' });
    return;
  }

  const token = tokenAutenticazione(req);
  if (!token) {
    res.status(401).json({ errore: 'Accesso richiesto' });
    return;
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: identita, error: erroreIdentita } = await db.auth.getUser(token);
  if (erroreIdentita || !identita.user) {
    res.status(401).json({ errore: 'Sessione non valida' });
    return;
  }

  const { data: profilo, error: erroreProfilo } = await db
    .from('profili')
    .select('id')
    .eq('id', identita.user.id)
    .eq('accesso', true)
    .maybeSingle();
  if (erroreProfilo || !profilo) {
    res.status(403).json({ errore: 'Profilo non autorizzato' });
    return;
  }

  const titolo = typeof req.body?.titolo === 'string' ? req.body.titolo.trim() : '';
  const testo = typeof req.body?.testo === 'string' ? req.body.testo.trim() : '';
  const mittente = typeof req.body?.mittente === 'string' ? req.body.mittente.slice(0, 200) : '';

  if (!testo || testo.length > 500 || titolo.length > 100) {
    res.status(400).json({ errore: 'Testo della notifica non valido' });
    return;
  }

  webpush.setVapidDetails(CONTATTO, CHIAVE_PUBBLICA, CHIAVE_PRIVATA);

  const { data, error } = await db
    .from('push_iscrizioni')
    .select('endpoint,p256dh,auth,dispositivo');

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
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        scaduti.push(r.endpoint);
      }
    }
  }));

  // Le iscrizioni morte si accumulerebbero e farebbero fallire ogni invio
  if (scaduti.length > 0) {
    await db.from('push_iscrizioni').delete().in('endpoint', scaduti);
  }

  res.status(200).json({ inviate, rimossi: scaduti.length });
}
