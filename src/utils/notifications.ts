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
      // `renotify` non è ancora presente nei tipi DOM standard, ma è supportato dai browser
      const options: NotificationOptions & { renotify?: boolean } = {
        body: body,
        icon: '/favicon.ico', // o icona brand tabaccheria
        tag: 'tabaccheria-note',
        renotify: true
      };

      const notification = new Notification(title, options);

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.warn('Errore invio notifica browser:', err);
    }
  }
}
