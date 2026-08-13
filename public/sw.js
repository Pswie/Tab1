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

/**
 * Conserva sul dispositivo le notifiche d'ordine già mostrate.
 *
 * I servizi di pianificazione possono ripetere una chiamata; senza questa
 * piccola memoria un promemoria già chiuso potrebbe ricomparire. La chiave
 * contiene voce e data, quindi non unisce mai due ordini diversi.
 */
function prenotaNotificaOrdine(tag) {
  if (!tag.startsWith('ordine:') || !('indexedDB' in self)) return Promise.resolve(true);

  return new Promise(resolve => {
    const apertura = indexedDB.open('tabaccheria-notifiche', 1);

    apertura.onupgradeneeded = () => {
      if (!apertura.result.objectStoreNames.contains('mostrate')) {
        apertura.result.createObjectStore('mostrate', { keyPath: 'tag' });
      }
    };

    apertura.onerror = () => resolve(true);
    apertura.onsuccess = () => {
      const db = apertura.result;
      const transazione = db.transaction('mostrate', 'readwrite');
      const archivio = transazione.objectStore('mostrate');
      const lettura = archivio.get(tag);
      let nuova = false;

      lettura.onsuccess = () => {
        if (!lettura.result) {
          nuova = true;
          archivio.put({ tag, mostrataIl: Date.now() });
        }
      };

      lettura.onerror = () => {
        nuova = true;
      };

      transazione.oncomplete = () => {
        db.close();
        resolve(nuova);
      };
      transazione.onerror = () => {
        db.close();
        resolve(true);
      };
    };
  });
}

self.addEventListener('push', event => {
  let dati = { titolo: 'Tabaccheria iNES', testo: 'Nuovo aggiornamento' };

  try {
    if (event.data) dati = { ...dati, ...event.data.json() };
  } catch {
    // Messaggio non in formato JSON: restano i valori predefiniti
  }

  event.waitUntil((async () => {
    const tag = dati.tag || 'attivita';
    const daMostrare = await prenotaNotificaOrdine(tag);
    if (!daMostrare) return;

    await self.registration.showNotification(dati.titolo, {
      body: dati.testo,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      tag,
      data: { url: dati.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const destinazione = (event.notification.data && event.notification.data.url) || '/';

  // Se l'app è già aperta si porta in primo piano invece di aprirne un'altra
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(finestre => {
      for (const finestra of finestre) {
        if ('focus' in finestra) {
          // La finestra già aperta riceve comunque la destinazione: il solo
          // focus lascerebbe la persona nella scheda che stava guardando.
          finestra.postMessage({ tipo: 'apri-notifica', url: destinazione });
          return finestra.focus();
        }
      }
      return self.clients.openWindow(destinazione);
    })
  );
});
