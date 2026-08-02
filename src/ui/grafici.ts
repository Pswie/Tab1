import { formatCurrency } from '../utils/calculations';

/**
 * I pezzi con cui sono fatte le due dashboard.
 *
 * Stanno qui e non dentro a una delle due perché le marche dei grafici devono
 * essere le stesse dappertutto: barre sottili di un colore solo, dove il dato
 * è la lunghezza e non la tinta, e il rosso tenuto da parte per quello che è
 * ancora aperto o in perdita.
 */

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Importo per esteso, coi centesimi: nelle tabelle i conti si controllano */
export function euro(valore: number): string {
  return formatCurrency(valore);
}

/**
 * Importo arrotondato all'euro, per i numeri grandi in vista.
 * A quelle dimensioni i centesimi allungano soltanto la cifra.
 */
export function euroTondo(valore: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(isNaN(valore) ? 0 : valore);
}

export function numero(valore: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(valore);
}

export function percentuale(valore: number): string {
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(valore)}%`;
}

/** "2026-08" -> "Agosto 2026" */
export function nomeMese(mese: string): string {
  const [anno, numeroMese] = mese.split('-').map(Number);
  const testo = new Date(anno, numeroMese - 1, 1)
    .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

/** "2026-08" -> "ago 26", per gli assi dei grafici */
export function nomeMeseBreve(mese: string): string {
  const [anno, numeroMese] = mese.split('-').map(Number);
  const testo = new Date(anno, numeroMese - 1, 1)
    .toLocaleDateString('it-IT', { month: 'short' })
    .replace('.', '');

  return `${testo} ${String(anno).slice(2)}`;
}

/** Mese precedente a quello indicato, in formato YYYY-MM */
export function meseIndietro(mese: string, quanti = 1): string {
  const [anno, numeroMese] = mese.split('-').map(Number);
  const d = new Date(anno, numeroMese - 1 - quanti, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Variazione fra due importi.
 *
 * Il verso è scritto anche con la freccia e col segno: il colore da solo non
 * lo direbbe a chi non lo distingue.
 */
export function variazione(adesso: number, prima: number, rispettoA: string): string {
  if (prima === 0) return '';

  const scarto = ((adesso - prima) / Math.abs(prima)) * 100;
  const su = scarto >= 0;
  const freccia = su ? '&#9650;' : '&#9660;';
  const segno = su ? '+' : '&minus;';

  return `
    <span class="dash-delta ${su ? 'is-su' : 'is-giu'}">
      ${freccia} ${segno}${percentuale(Math.abs(scarto))}
      ${rispettoA ? `<span class="dash-delta-nota">${escapeHtml(rispettoA)}</span>` : ''}
    </span>
  `;
}

export interface Riquadro {
  etichetta: string;
  valore: string;
  nota?: string;
  delta?: string;
  /** Il riquadro che porta il numero principale della sezione */
  forte?: boolean;
}

export function riquadriHtml(voci: Riquadro[]): string {
  return voci.map(v => `
    <div class="dash-riquadro ${v.forte ? 'is-forte' : ''}">
      <span class="dash-riquadro-etichetta">${escapeHtml(v.etichetta)}</span>
      <span class="dash-riquadro-valore">${escapeHtml(v.valore)}</span>
      ${v.nota ? `<span class="dash-riquadro-nota">${escapeHtml(v.nota)}</span>` : ''}
      ${v.delta || ''}
    </div>
  `).join('');
}

const ICONA_ANDAMENTO = '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>';

export function vuoto(messaggio: string, icona = ICONA_ANDAMENTO): string {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${icona}
      </svg>
      <p class="empty-state-text">${escapeHtml(messaggio)}</p>
    </div>
  `;
}

/**
 * Estremo tondo per l'asse: 18.400 diventa 20.000.
 * Le tacche vanno lette a colpo d'occhio, non interpretate.
 */
export function tettoTondo(valore: number): number {
  if (valore <= 0) return 0;

  const ordine = Math.pow(10, Math.floor(Math.log10(valore)));
  const passi = [1, 1.5, 2, 2.5, 5, 10];

  for (const passo of passi) {
    if (valore <= ordine * passo) return ordine * passo;
  }

  return ordine * 10;
}

export interface Colonna {
  etichetta: string;
  valore: number;
  /** Il periodo ancora aperto: il suo totale non è confrontabile con gli altri */
  evidenzia?: boolean;
  titolo: string;
  /** Scritta sopra la barra: solo dove serve davvero, non su ogni colonna */
  valoreInVista?: boolean;
}

/**
 * Grafico a colonne con tre tacche di riferimento.
 *
 * Le colonne non portano il numero una per una: lo dicono le tacche, la
 * tabella che le accompagna e il tocco prolungato. Scriverlo dodici volte
 * non si leggerebbe.
 */
export function graficoColonne(colonne: Colonna[], messaggioVuoto = 'Nessun dato nel periodo scelto.'): string {
  if (colonne.length === 0) return vuoto(messaggioVuoto);

  const massimo = Math.max(...colonne.map(c => c.valore), 0);
  const tetto = tettoTondo(massimo);

  const tacche = [1, 0.5, 0].map(quota => `
    <span class="dash-livello" style="bottom: ${quota * 100}%">
      <i class="dash-livello-valore">${numero(tetto * quota)}</i>
    </span>
  `).join('');

  const barre = colonne.map(c => {
    // Un periodo con qualcosa dentro deve vedersi anche quando è molto sotto agli altri
    const quota = tetto === 0 ? 0 : Math.max(c.valore, 0) / tetto;
    const altezza = c.valore > 0 ? Math.max(quota * 100, 1.5) : 0;

    return `
      <div class="dash-colonna" title="${escapeHtml(c.titolo)}">
        <span class="dash-colonna-pista">
          <span class="dash-colonna-barra ${c.evidenzia ? 'is-parziale' : ''}"
                style="height: ${altezza}%">
            ${c.valoreInVista ? `<i class="dash-colonna-valore">${euroTondo(c.valore)}</i>` : ''}
          </span>
        </span>
        <span class="dash-colonna-etichetta">${escapeHtml(c.etichetta)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="dash-plot">
      <div class="dash-livelli" aria-hidden="true">${tacche}</div>
      <div class="dash-colonne">${barre}</div>
    </div>
  `;
}

export interface Barra {
  etichetta: string;
  valore: number;
  nota?: string;
  /** Come scrivere il valore in fondo alla barra: se manca, è un importo */
  testoValore?: string;
}

/**
 * Barre orizzontali con il valore in fondo.
 *
 * La lunghezza segue il valore assoluto: una voce chiusa in perdita si
 * riconosce dal colore e dal segno davanti al numero, non dal verso della barra.
 */
export function barreOrizzontali(barre: Barra[], messaggioVuoto: string): string {
  if (barre.length === 0) return vuoto(messaggioVuoto);

  const massimo = Math.max(...barre.map(b => Math.abs(b.valore)), 0);

  return barre.map(b => {
    const quota = massimo === 0 ? 0 : (Math.abs(b.valore) / massimo) * 100;
    const negativa = b.valore < 0;
    const testo = b.testoValore ?? euroTondo(b.valore);

    return `
      <div class="dash-barra" title="${escapeHtml(`${b.etichetta}: ${testo}`)}">
        <span class="dash-barra-nome">
          ${escapeHtml(b.etichetta)}
          ${b.nota ? `<small>${escapeHtml(b.nota)}</small>` : ''}
        </span>
        <span class="dash-barra-pista">
          <span class="dash-barra-riempimento ${negativa ? 'is-negativa' : ''}"
                style="width: ${b.valore === 0 ? 0 : Math.max(quota, 1)}%"></span>
        </span>
        <span class="dash-barra-valore ${negativa ? 'is-negativa' : ''}">${escapeHtml(testo)}</span>
      </div>
    `;
  }).join('');
}
