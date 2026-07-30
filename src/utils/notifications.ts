/**
 * Verifica se le notifiche Web sono supportate nel browser
 */
export function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

/**
 * Richiede il permesso all'utente per le notifiche desktop/mobile
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  
  if (Notification.permission === 'granted') {
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  
  return false;
}

/**
 * Invia una notifica push del browser quando viene pubblicata una nuova nota
 */
export function sendWebNotification(title: string, body: string): void {
  if (!isNotificationSupported()) return;

  if (Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, {
        body: body,
        icon: '/favicon.ico', // o icona brand tabaccheria
        tag: 'tabaccheria-note',
        renotify: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.warn('Errore invio notifica browser:', err);
    }
  }
}
