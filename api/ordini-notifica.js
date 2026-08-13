import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

/**
 * Promemoria automatici degli ordini settimanali.
 *
 * Un servizio esterno (cron-job.org) richiama questa funzione alle 07:00 con
 * fuso Europe/Rome. Il database controlla comunque l'ora italiana e fuori
 * dalle sette restituisce un elenco vuoto.
 */

const CHIAVE_PUBBLICA = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const CHIAVE_PRIVATA = process.env.VAPID_PRIVATE_KEY;
const CONTATTO = process.env.VAPID_SUBJECT || 'mailto:tabaccheria@example.com';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
// Le nuove Secret Key Supabase sono preferibili alla legacy service_role.
// Entrambe restano supportate per consentire una migrazione senza interruzioni.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

function richiestaDelCron(req) {
  const segreto = process.env.CRON_SECRET;

  // Fail closed: cron-job.org invia questo valore come header personalizzato.
  // Il segreto non deve mai essere inserito nell'URL, nel client o nel repo.
  return Boolean(segreto && req.headers.authorization === `Bearer ${segreto}`);
}

async function profiliDelTurnoMattina(db, dataLocale) {
  const { data: turni, error: erroreTurni } = await db
    .from('turni_lavoro')
    .select('profilo_id')
    .eq('data', dataLocale)
    .eq('turno', 'mattina')
    .eq('annullato', false)
    .not('profilo_id', 'is', null);

  if (erroreTurni) {
    throw new Error(`Turno di mattina non leggibile: ${erroreTurni.message}`);
  }

  const profiliAssegnati = [...new Set((turni || [])
    .map(turno => turno.profilo_id)
    .filter(Boolean))];

  if (profiliAssegnati.length === 0) return [];

  // Un turno storico potrebbe puntare a un account poi disattivato. Il
  // promemoria parte soltanto ai profili ancora abilitati e non amministratori.
  const { data: profili, error: erroreProfili } = await db
    .from('profili')
    .select('id')
    .in('id', profiliAssegnati)
    .eq('accesso', true)
    .eq('admin', false);

  if (erroreProfili) {
    throw new Error(`Profili del turno non leggibili: ${erroreProfili.message}`);
  }

  return (profili || []).map(profilo => profilo.id);
}

async function invia(subscription, messaggio) {
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    messaggio,
    // Un ordine della mattina non deve ricomparire giorni dopo su un telefono
    // rimasto offline. Sei ore coprono la mattinata senza creare avvisi vecchi.
    { TTL: 6 * 60 * 60, urgency: 'high' }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ errore: 'Metodo non ammesso' });
    return;
  }

  if (!richiestaDelCron(req)) {
    res.status(401).json({ errore: 'Richiesta non autorizzata' });
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

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // La RPC non riceve una data dal chiamante: usa l'orologio del database e
  // fuori dalle 07:00 italiane restituisce sempre un elenco vuoto.
  const { data: ordini, error: erroreOrdini } = await db.rpc('ordini_da_notificare_ora');

  if (erroreOrdini) {
    res.status(502).json({ errore: `Ordini non leggibili: ${erroreOrdini.message}` });
    return;
  }

  if (!ordini || ordini.length === 0) {
    res.status(200).json({ ordini: 0, destinatari: 0, dispositivi: 0, inviate: 0, rimossi: 0 });
    return;
  }

  const dataLocale = String(ordini[0].data_locale);
  let profiliMattina;

  try {
    profiliMattina = await profiliDelTurnoMattina(db, dataLocale);
  } catch (err) {
    res.status(502).json({ errore: err.message });
    return;
  }

  if (profiliMattina.length === 0) {
    res.status(200).json({
      ordini: ordini.length,
      destinatari: 0,
      dispositivi: 0,
      inviate: 0,
      fallite: 0,
      rimossi: 0
    });
    return;
  }

  const { data: iscrizioni, error: erroreIscrizioni } = await db
    .from('push_iscrizioni')
    .select('endpoint,p256dh,auth,profilo_id')
    .in('profilo_id', profiliMattina);

  if (erroreIscrizioni) {
    res.status(502).json({ errore: `Destinatari non leggibili: ${erroreIscrizioni.message}` });
    return;
  }

  webpush.setVapidDetails(CONTATTO, CHIAVE_PUBBLICA, CHIAVE_PRIVATA);

  const scaduti = new Set();
  let inviate = 0;
  let fallite = 0;

  // Una chiamata Web Push distinta per ogni coppia voce/dispositivo. Anche il
  // tag contiene l'id della voce: due cose nello stesso giorno restano quindi
  // due notifiche separate sul telefono.
  await Promise.all(ordini.flatMap(ordine => (iscrizioni || []).map(async iscrizione => {
    const messaggio = JSON.stringify({
      titolo: `Ordine: ${ordine.voce}`,
      testo: 'Promemoria delle 07:00',
      tag: `ordine:${ordine.ordine_id}:${ordine.data_locale}`,
      url: '/?tab=tab-ordini'
    });

    try {
      await invia(iscrizione, messaggio);
      inviate++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        scaduti.add(iscrizione.endpoint);
      } else {
        fallite++;
      }
    }
  })));

  if (scaduti.size > 0) {
    await db.from('push_iscrizioni').delete().in('endpoint', [...scaduti]);
  }

  res.status(fallite > 0 ? 207 : 200).json({
    ordini: ordini.length,
    destinatari: profiliMattina.length,
    dispositivi: (iscrizioni || []).length,
    inviate,
    fallite,
    rimossi: scaduti.size
  });
}
