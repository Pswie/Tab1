/**
 * Notifiche del browser.
 *
 * Non sono vere notifiche push: senza un server che le invii, arrivano solo
 * mentre l'app è aperta in una scheda. Per questo il pallino rosso sul menu
 * resta il segnale principale, e la notifica è un di più quando il permesso
 * è già stato concesso.
 */

const CHIAVE_PERMESSO_CHIESTO = 'tabaccheria_permesso_notifiche_chiesto';

export function notificheDisponibili(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permessoConcesso(): boolean {
  return notificheDisponibili() && Notification.permission === 'granted';
}

/**
 * Chiede il permesso una sola volta, e solo a seguito di un gesto dell'utente:
 * i browser rifiutano la richiesta se arriva da sola al caricamento.
 */
export async function chiediPermessoUnaVolta(): Promise<void> {
  if (!notificheDisponibili()) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem(CHIAVE_PERMESSO_CHIESTO)) return;

  localStorage.setItem(CHIAVE_PERMESSO_CHIESTO, '1');

  try {
    await Notification.requestPermission();
  } catch {
    // Alcuni browser rifiutano la richiesta: resta il pallino rosso sul menu
  }
}

export function inviaNotifica(titolo: string, testo: string): void {
  if (!permessoConcesso()) return;

  try {
    new Notification(titolo, { body: testo, icon: '/icon-192.png', tag: 'tabaccheria' });
  } catch (err) {
    console.warn('Notifica non mostrata:', err);
  }
}
