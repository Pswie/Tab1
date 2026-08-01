/**
 * Pallini di segnalazione sulle voci di menu.
 *
 * Servono a far vedere che c'è qualcosa da guardare anche quando la notifica
 * del browser non può arrivare: su telefono, con l'app chiusa, la notifica non
 * parte, mentre il pallino resta lì alla riapertura.
 *
 * Non portano numeri: il conteggio preciso sta dentro la sezione, qui basta
 * sapere se c'è o non c'è qualcosa.
 */
export type Sezione = 'todos' | 'inventario' | 'soggiorno' | 'h24';

const attive: Record<Sezione, boolean> = {
  todos: false,
  inventario: false,
  soggiorno: false,
  h24: false
};

/**
 * `quanti` a 0 spegne il pallino; qualsiasi valore positivo, o 'pallino',
 * lo accende.
 */
export function segnala(sezione: Sezione, quanti: number | 'pallino'): void {
  const attivo = quanti === 'pallino' || quanti > 0;
  attive[sezione] = attivo;

  ['nav', 'menu'].forEach(dove => {
    const el = document.getElementById(`badge-${dove}-${sezione}`);
    if (!el) return;

    el.textContent = '';
    el.hidden = !attivo;
  });

  aggiornaPallinoMenu();
}

/** Il pulsante del menu su mobile si accende se una qualsiasi sezione segnala */
function aggiornaPallinoMenu(): void {
  const pallino = document.getElementById('pallino-menu');
  if (!pallino) return;

  pallino.hidden = !Object.values(attive).some(Boolean);
}
