/**
 * Pallini e contatori sulle voci di menu.
 *
 * Servono a far vedere che c'è qualcosa di nuovo anche quando la notifica del
 * browser non può arrivare: su telefono, con l'app chiusa, la notifica non
 * parte, mentre il pallino resta lì alla riapertura.
 */
export type Sezione = 'todos' | 'inventario' | 'soggiorno';

const conteggi: Record<Sezione, number> = { todos: 0, inventario: 0, soggiorno: 0 };

/**
 * `quanti` a 0 nasconde il contatore; un numero lo mostra come +N;
 * 'pallino' segnala senza numero, per avvisi che non si contano.
 */
export function segnala(sezione: Sezione, quanti: number | 'pallino'): void {
  conteggi[sezione] = quanti === 'pallino' ? -1 : quanti;

  const testo = quanti === 'pallino' ? '' : `+${quanti}`;
  const attivo = quanti === 'pallino' || quanti > 0;

  ['nav', 'menu'].forEach(dove => {
    const el = document.getElementById(`badge-${dove}-${sezione}`);
    if (!el) return;

    el.textContent = testo;
    el.classList.toggle('is-dot', quanti === 'pallino');
    el.hidden = !attivo;
  });

  aggiornaPallinoMenu();
}

/** Il pulsante del menu su mobile si accende se una qualsiasi sezione segnala */
function aggiornaPallinoMenu(): void {
  const pallino = document.getElementById('pallino-menu');
  if (!pallino) return;

  pallino.hidden = !Object.values(conteggi).some(v => v !== 0);
}
