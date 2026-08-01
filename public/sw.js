/**
 * Service worker: resta in ascolto anche quando l'app è chiusa.
 *
 * Senza di lui una notifica potrebbe arrivare solo con la pagina aperta, che è
 * esattamente il caso in cui non serve.
 */

self.addEventListener('install', () => {
  // Entra in servizio subito, senza aspettare la chiusura delle vecchie schede
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let dati = { titolo: 'Tabaccheria iNES', testo: 'Nuovo aggiornamento' };

  try {
    if (event.data) dati = { ...dati, ...event.data.json() };
  } catch {
    // Messaggio non in formato JSON: restano i valori predefiniti
  }

  event.waitUntil(
    self.registration.showNotification(dati.titolo, {
      body: dati.testo,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      tag: dati.tag || 'attivita',
      data: { url: dati.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const destinazione = (event.notification.data && event.notification.data.url) || '/';

  // Se l'app è già aperta si porta in primo piano invece di aprirne un'altra
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(finestre => {
      for (const finestra of finestre) {
        if ('focus' in finestra) return finestra.focus();
      }
      return self.clients.openWindow(destinazione);
    })
  );
});
