/**
 * Notifiche.
 *
 * Ce ne sono di due tipi e vale la pena distinguerli:
 *
 * - quella del browser arriva solo con l'app aperta, quindi da sola non basta
 *   per avvisare un collega che non la sta guardando;
 * - quella push passa da un service worker e arriva anche ad app chiusa, ma
 *   richiede il permesso dell'utente e un mittente lato server.
 *
 * Il pallino rosso sul menu resta comunque il segnale di riserva: se le
 * notifiche sono negate o non supportate, alla riapertura si vede lo stesso
 * che è successo qualcosa.
 */

const CHIAVE_PERMESSO_CHIESTO = 'tabaccheria_permesso_notifiche_chiesto';
const CHIAVE_DISPOSITIVO = 'tabaccheria_dispositivo';

/** Chiave pubblica VAPID: è pubblica per definizione, sta nel client */
const CHIAVE_VAPID = 'BALKwWFg1xhXSwu9HF8gN5caXQ8HC48sddTAzlC3C-QkyOvFtbhYRk4DjC5NGgazPEACV8eCFYIauk0CKXAQI4I';

export function notificheDisponibili(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permessoConcesso(): boolean {
  return notificheDisponibili() && Notification.permission === 'granted';
}

/** Identificativo di questo dispositivo, per non notificare chi ha scritto */
export function idDispositivo(): string {
  let id = localStorage.getItem(CHIAVE_DISPOSITIVO);

  if (!id) {
    id = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(CHIAVE_DISPOSITIVO, id);
  }

  return id;
}

/** La chiave VAPID va passata al browser come sequenza di byte */
function chiaveInByte(base64: string): Uint8Array {
  const completo = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const grezzo = atob(completo);
  const byte = new Uint8Array(grezzo.length);

  for (let i = 0; i < grezzo.length; i++) byte[i] = grezzo.charCodeAt(i);
  return byte;
}

/**
 * Registra il service worker e iscrive il dispositivo alle notifiche push.
 * Va chiamata solo a permesso concesso.
 */
async function iscriviAllePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registrazione = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const esistente = await registrazione.pushManager.getSubscription();
    const iscrizione = esistente || await registrazione.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chiaveInByte(CHIAVE_VAPID) as BufferSource
    });

    const dati = iscrizione.toJSON();
    if (!dati.endpoint || !dati.keys) return;

    const { salvaIscrizionePush } = await import('../services/push');

    await salvaIscrizionePush({
      endpoint: dati.endpoint,
      p256dh: dati.keys.p256dh,
      auth: dati.keys.auth,
      dispositivo: idDispositivo()
    });
  } catch (err) {
    console.warn('Iscrizione alle notifiche non riuscita:', err);
  }
}

/**
 * Chiede il permesso una sola volta, e solo a seguito di un gesto dell'utente:
 * i browser rifiutano la richiesta se arriva da sola al caricamento.
 */
export async function chiediPermessoUnaVolta(): Promise<void> {
  if (!notificheDisponibili()) return;

  if (Notification.permission === 'granted') {
    iscriviAllePush();
    return;
  }

  if (Notification.permission !== 'default') return;
  if (localStorage.getItem(CHIAVE_PERMESSO_CHIESTO)) return;

  localStorage.setItem(CHIAVE_PERMESSO_CHIESTO, '1');

  try {
    const esito = await Notification.requestPermission();
    if (esito === 'granted') await iscriviAllePush();
  } catch {
    // Alcuni browser rifiutano la richiesta: resta il pallino rosso sul menu
  }
}

/** Riaggancia il service worker all'avvio, se il permesso c'è già */
export function ripristinaIscrizione(): void {
  if (permessoConcesso()) iscriviAllePush();
}

export type StatoNotifiche = 'concesso' | 'da-chiedere' | 'negato' | 'non-supportate';

export function statoNotifiche(): StatoNotifiche {
  if (!notificheDisponibili()) return 'non-supportate';
  if (Notification.permission === 'granted') return 'concesso';
  if (Notification.permission === 'denied') return 'negato';
  return 'da-chiedere';
}

/**
 * Richiesta esplicita, dal pulsante.
 *
 * Diversa da chiediPermessoUnaVolta: qui l'utente sta chiedendo apposta, quindi
 * non si tiene conto del fatto che la richiesta sia già stata fatta in passato.
 * Restituisce lo stato in cui si è finiti, per poterlo dire a schermo.
 */
export async function attivaNotifiche(): Promise<StatoNotifiche> {
  if (!notificheDisponibili()) return 'non-supportate';

  // L'iscrizione al servizio push non viene attesa: se il service worker
  // tardasse a registrarsi, il pulsante resterebbe fermo su "Attiva" pur
  // avendo il permesso. Fallisce da sola in silenzio, e si riprova all'avvio.
  if (Notification.permission === 'granted') {
    iscriviAllePush();
    return 'concesso';
  }

  // Una volta negato, il browser non ripropone la richiesta: va tolto il blocco
  // dalle impostazioni del sito
  if (Notification.permission === 'denied') return 'negato';

  try {
    const esito = await Notification.requestPermission();
    localStorage.setItem(CHIAVE_PERMESSO_CHIESTO, '1');

    if (esito === 'granted') {
      iscriviAllePush();
      return 'concesso';
    }

    return esito === 'denied' ? 'negato' : 'da-chiedere';
  } catch {
    return 'negato';
  }
}

/** Notifica locale: arriva solo se l'app è aperta */
export function inviaNotifica(titolo: string, testo: string): void {
  if (!permessoConcesso()) return;

  try {
    new Notification(titolo, { body: testo, icon: '/icon-192.png', tag: 'tabaccheria' });
  } catch (err) {
    console.warn('Notifica non mostrata:', err);
  }
}

/**
 * Chiede al server di avvisare gli altri dispositivi. È l'unica strada perché
 * l'avviso arrivi a chi non ha l'app aperta.
 */
export async function avvisaGliAltri(titolo: string, testo: string): Promise<void> {
  try {
    await fetch('/api/notifica', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titolo, testo, mittente: idDispositivo() })
    });
  } catch (err) {
    // Resta comunque il pallino sul menu degli altri dispositivi
    console.warn('Avviso non inviato:', err);
  }
}
