import {
  GiornataIncasso,
  MeseIncasso,
  caricaGiornate,
  estremi,
  mediaMensileConParziale,
  mediaMensileConclusi,
  mediePerGiornoSettimana,
  mesePrecedente,
  meseCorrente,
  pesoDeiTurni,
  proiezioneMese,
  raggruppaPerMese,
  ripartizionePerVoce,
  totaleFinoAlGiorno,
  vociFuoriTotale
} from '../services/statistiche';
import { formatCurrency, formatDateItalian, getTodayDateString } from '../utils/calculations';
import { amministratore } from '../services/auth';

/**
 * Dashboard del titolare.
 *
 * Non si scrive niente da qui: si legge soltanto quello che le chiusure hanno
 * già registrato. La scheda compare solo a chi ha admin a true nel profilo.
 */

type Periodo = '12' | 'anno' | 'tutto';

let giornate: GiornataIncasso[] = [];
let mesi: MeseIncasso[] = [];
let periodo: Periodo = '12';

/** Un caricamento più lento di un altro non deve riscrivere sopra il più recente */
let versioneCaricamento = 0;

const pannello = document.getElementById('tab-dashboard') as HTMLDivElement;
const stato = document.getElementById('dash-stato') as HTMLParagraphElement;

const nomeMese = document.getElementById('dash-mese-nome') as HTMLSpanElement;
const totaleMese = document.getElementById('dash-mese-totale') as HTMLSpanElement;
const notaMese = document.getElementById('dash-mese-nota') as HTMLSpanElement;
const riquadriMese = document.getElementById('dash-riquadri-mese') as HTMLDivElement;

const totalePeriodo = document.getElementById('dash-periodo-totale') as HTMLSpanElement;
const riquadriMedie = document.getElementById('dash-riquadri-medie') as HTMLDivElement;
const graficoMesi = document.getElementById('dash-grafico-mesi') as HTMLDivElement;
const tabellaMesi = document.getElementById('dash-tabella-mesi') as HTMLTableSectionElement;

const riquadriStatistiche = document.getElementById('dash-riquadri-statistiche') as HTMLDivElement;
const ripartizione = document.getElementById('dash-ripartizione') as HTMLDivElement;
const settimana = document.getElementById('dash-settimana') as HTMLDivElement;
const riquadriExtra = document.getElementById('dash-riquadri-extra') as HTMLDivElement;

const pulsantiPeriodo = Array.from(document.querySelectorAll('.dash-periodo')) as HTMLButtonElement[];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Importo per esteso, con i centesimi: nelle tabelle i conti si controllano */
function euro(valore: number): string {
  return formatCurrency(valore);
}

/**
 * Importo arrotondato all'euro, per i numeri grandi in vista.
 * A quelle dimensioni i centesimi allungano soltanto la cifra.
 */
function euroTondo(valore: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(isNaN(valore) ? 0 : valore);
}

function numero(valore: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(valore);
}

function percentuale(valore: number): string {
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(valore)}%`;
}

/** "2026-08-02" -> "2 agosto" */
function dataBreve(iso: string): string {
  const [a, m, g] = iso.split('-').map(Number);
  return new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
}

/**
 * Variazione fra due importi.
 *
 * Il verso è scritto anche con la freccia e col segno: il colore da solo non
 * basta a chi non lo distingue.
 */
function variazione(adesso: number, prima: number, rispettoA: string): string {
  if (prima === 0) return '';

  const scarto = ((adesso - prima) / Math.abs(prima)) * 100;
  const su = scarto >= 0;
  const freccia = su ? '&#9650;' : '&#9660;';
  const segno = su ? '+' : '&minus;';

  return `
    <span class="dash-delta ${su ? 'is-su' : 'is-giu'}">
      ${freccia} ${segno}${percentuale(Math.abs(scarto))}
      <span class="dash-delta-nota">${escapeHtml(rispettoA)}</span>
    </span>
  `;
}

interface Riquadro {
  etichetta: string;
  valore: string;
  nota?: string;
  delta?: string;
}

function riquadriHtml(voci: Riquadro[]): string {
  return voci.map(v => `
    <div class="dash-riquadro">
      <span class="dash-riquadro-etichetta">${escapeHtml(v.etichetta)}</span>
      <span class="dash-riquadro-valore">${escapeHtml(v.valore)}</span>
      ${v.nota ? `<span class="dash-riquadro-nota">${escapeHtml(v.nota)}</span>` : ''}
      ${v.delta || ''}
    </div>
  `).join('');
}

function vuoto(messaggio: string): string {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>
      </svg>
      <p class="empty-state-text">${escapeHtml(messaggio)}</p>
    </div>
  `;
}

/**
 * Estremo tondo per l'asse: 18.400 diventa 20.000.
 * Le tacche vanno lette a colpo d'occhio, non interpretate.
 */
function tettoTondo(valore: number): number {
  if (valore <= 0) return 0;

  const ordine = Math.pow(10, Math.floor(Math.log10(valore)));
  const passi = [1, 1.5, 2, 2.5, 5, 10];

  for (const passo of passi) {
    if (valore <= ordine * passo) return ordine * passo;
  }

  return ordine * 10;
}

interface Colonna {
  etichetta: string;
  valore: number;
  /** Il mese ancora in corso: il suo totale non è confrontabile con gli altri */
  evidenzia?: boolean;
  titolo: string;
  /** Scritta sopra la barra: solo dove serve davvero, non su ogni colonna */
  valoreInVista?: boolean;
}

/**
 * Grafico a colonne con tre tacche di riferimento.
 *
 * Le colonne non portano il numero una per una: lo dicono le tacche, la tabella
 * qui sotto e il tocco prolungato. Scriverlo dodici volte non si leggerebbe.
 */
function graficoColonne(colonne: Colonna[]): string {
  if (colonne.length === 0) return vuoto('Nessun dato nel periodo scelto.');

  const massimo = Math.max(...colonne.map(c => c.valore), 0);
  const tetto = tettoTondo(massimo);

  const tacche = [1, 0.5, 0].map(quota => `
    <span class="dash-livello" style="bottom: ${quota * 100}%">
      <i class="dash-livello-valore">${numero(tetto * quota)}</i>
    </span>
  `).join('');

  const barre = colonne.map(c => {
    // Un mese con qualcosa dentro deve vedersi anche quando è molto sotto agli altri
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

interface Barra {
  etichetta: string;
  valore: number;
  nota?: string;
}

/**
 * Barre orizzontali con l'importo in fondo.
 *
 * La lunghezza segue il valore assoluto: una voce chiusa in perdita si riconosce
 * dal colore e dal segno davanti all'importo, non dal verso della barra.
 */
function barreOrizzontali(barre: Barra[], messaggioVuoto: string): string {
  if (barre.length === 0) return vuoto(messaggioVuoto);

  const massimo = Math.max(...barre.map(b => Math.abs(b.valore)), 0);

  return barre.map(b => {
    const quota = massimo === 0 ? 0 : (Math.abs(b.valore) / massimo) * 100;
    const negativa = b.valore < 0;

    return `
      <div class="dash-barra" title="${escapeHtml(`${b.etichetta}: ${euro(b.valore)}`)}">
        <span class="dash-barra-nome">
          ${escapeHtml(b.etichetta)}
          ${b.nota ? `<small>${escapeHtml(b.nota)}</small>` : ''}
        </span>
        <span class="dash-barra-pista">
          <span class="dash-barra-riempimento ${negativa ? 'is-negativa' : ''}"
                style="width: ${b.valore === 0 ? 0 : Math.max(quota, 1)}%"></span>
        </span>
        <span class="dash-barra-valore ${negativa ? 'is-negativa' : ''}">${euroTondo(b.valore)}</span>
      </div>
    `;
  }).join('');
}

/** I mesi che rientrano nel periodo scelto in alto */
function mesiDelPeriodo(): MeseIncasso[] {
  if (periodo === 'tutto') return mesi;

  if (periodo === 'anno') {
    const anno = getTodayDateString().slice(0, 4);
    return mesi.filter(m => m.mese.startsWith(anno));
  }

  return mesi.slice(-12);
}

function giornateDelPeriodo(elenco: MeseIncasso[]): GiornataIncasso[] {
  const dentro = new Set(elenco.map(m => m.mese));
  return giornate.filter(g => dentro.has(g.data.slice(0, 7)));
}

/**
 * Il mese che si sta facendo: quanto è entrato finora, come sta andando e
 * dove arriverebbe di questo passo.
 */
function renderMeseInCorso(): void {
  const oggi = getTodayDateString();
  const corrente = meseCorrente();
  const mese = mesi.find(m => m.mese === corrente);

  if (nomeMese) {
    const [anno, numeroMese] = corrente.split('-').map(Number);
    const testo = new Date(anno, numeroMese - 1, 1)
      .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    nomeMese.textContent = testo.charAt(0).toUpperCase() + testo.slice(1);
  }

  if (!mese) {
    if (totaleMese) totaleMese.textContent = euroTondo(0);
    if (notaMese) notaMese.textContent = 'Nessuna chiusura registrata questo mese.';
    if (riquadriMese) riquadriMese.innerHTML = '';
    return;
  }

  if (totaleMese) totaleMese.textContent = euroTondo(mese.totale);

  const ultima = giornate.filter(g => g.data.slice(0, 7) === corrente).slice(-1)[0];
  if (notaMese) {
    notaMese.textContent = ultima
      ? `Aggiornato all'ultima chiusura registrata: ${dataBreve(ultima.data)}`
      : '';
  }

  const giorno = Number(oggi.slice(8, 10));
  const scorso = mesePrecedente(corrente);
  const scorsoStessoPeriodo = totaleFinoAlGiorno(giornate, scorso, giorno);
  const proiezione = proiezioneMese(mese, oggi);

  if (riquadriMese) {
    riquadriMese.innerHTML = riquadriHtml([
      {
        etichetta: 'Media al giorno',
        valore: euroTondo(mese.mediaGiornaliera),
        nota: `Su ${numero(mese.giornate)} ${mese.giornate === 1 ? 'giornata registrata' : 'giornate registrate'}`
      },
      {
        etichetta: 'Proiezione a fine mese',
        valore: proiezione === null ? '—' : euroTondo(proiezione),
        nota: 'Se il passo resta questo'
      },
      {
        etichetta: 'Stesso periodo del mese prima',
        valore: euroTondo(scorsoStessoPeriodo),
        nota: `Fino al ${numero(giorno)} del mese`,
        delta: variazione(mese.totale, scorsoStessoPeriodo, 'sul mese prima')
      },
      {
        etichetta: 'Giornate registrate',
        valore: numero(mese.giornate),
        nota: `Su ${numero(giorno)} ${giorno === 1 ? 'giorno trascorso' : 'giorni trascorsi'}`
      }
    ]);
  }
}

/** Le medie mensili, il grafico dei mesi e la tabella con gli stessi numeri */
function renderIncassiMensili(elenco: MeseIncasso[]): void {
  const totale = elenco.reduce((s, m) => s + m.totale, 0);
  const conclusi = elenco.filter(m => !m.inCorso);
  const giorniTotali = elenco.reduce((s, m) => s + m.giornate, 0);

  if (totalePeriodo) totalePeriodo.textContent = euroTondo(totale);

  const migliore = conclusi.reduce<MeseIncasso | null>(
    (top, m) => (!top || m.totale > top.totale ? m : top),
    null
  );

  const inCorso = elenco.find(m => m.inCorso);

  if (riquadriMedie) {
    riquadriMedie.innerHTML = riquadriHtml([
      {
        etichetta: 'Media mensile',
        valore: euroTondo(mediaMensileConclusi(elenco)),
        nota: conclusi.length === 0
          ? 'Nessun mese ancora concluso'
          : `Sui ${numero(conclusi.length)} mesi conclusi del periodo`
      },
      {
        etichetta: 'Media mensile col mese in corso',
        valore: euroTondo(mediaMensileConParziale(elenco)),
        nota: inCorso
          ? `Comprende ${inCorso.etichetta}, ancora parziale`
          : 'Nessun mese in corso nel periodo'
      },
      {
        etichetta: 'Mese migliore',
        valore: migliore ? euroTondo(migliore.totale) : '—',
        nota: migliore ? migliore.etichetta : 'Nessun mese concluso'
      },
      {
        etichetta: 'Media al giorno',
        valore: euroTondo(giorniTotali === 0 ? 0 : totale / giorniTotali),
        nota: `Su ${numero(giorniTotali)} giornate registrate`
      }
    ]);
  }

  // Il mese più alto e quello in corso portano la scritta: gli altri si
  // leggono sulle tacche e nella tabella
  const piuAlto = elenco.reduce<MeseIncasso | null>(
    (top, m) => (!top || m.totale > top.totale ? m : top),
    null
  );

  if (graficoMesi) {
    graficoMesi.innerHTML = graficoColonne(elenco.map(m => ({
      etichetta: m.etichettaBreve,
      valore: m.totale,
      evidenzia: m.inCorso,
      valoreInVista: m === piuAlto || m.inCorso,
      titolo: `${m.etichetta}: ${euro(m.totale)} su ${m.giornate} giornate${m.inCorso ? ' (mese ancora in corso)' : ''}`
    })));
  }

  if (tabellaMesi) {
    if (elenco.length === 0) {
      tabellaMesi.innerHTML = `
        <tr><td colspan="5" class="dash-tabella-vuota">Nessun mese nel periodo scelto.</td></tr>
      `;
      return;
    }

    // Dal più recente: è quello che si guarda per primo
    tabellaMesi.innerHTML = [...elenco].reverse().map(m => {
      const prima = mesi.find(x => x.mese === mesePrecedente(m.mese));

      return `
        <tr class="${m.inCorso ? 'is-parziale' : ''}">
          <th scope="row">
            ${escapeHtml(m.etichetta)}
            ${m.inCorso ? '<span class="dash-tag">parziale</span>' : ''}
          </th>
          <td class="dash-num">${numero(m.giornate)}</td>
          <td class="dash-num">${euro(m.totale)}</td>
          <td class="dash-num">${euro(m.mediaGiornaliera)}</td>
          <td class="dash-num">${prima && !m.inCorso ? variazione(m.totale, prima.totale, '') : '—'}</td>
        </tr>
      `;
    }).join('');
  }
}

/** Da dove arriva l'incasso, quando rende di più e cosa resta fuori dal totale */
function renderStatistiche(elencoGiornate: GiornataIncasso[]): void {
  const { migliore, peggiore } = estremi(elencoGiornate);
  const totale = elencoGiornate.reduce((s, g) => s + g.totale, 0);

  if (riquadriStatistiche) {
    riquadriStatistiche.innerHTML = riquadriHtml([
      {
        etichetta: 'Giornate registrate',
        valore: numero(elencoGiornate.length),
        nota: 'Nel periodo scelto'
      },
      {
        etichetta: 'Media a giornata',
        valore: euroTondo(elencoGiornate.length === 0 ? 0 : totale / elencoGiornate.length),
        nota: 'Sulle giornate registrate'
      },
      {
        etichetta: 'Giornata migliore',
        valore: migliore ? euroTondo(migliore.totale) : '—',
        nota: migliore ? formatDateItalian(migliore.data) : 'Nessuna giornata registrata'
      },
      {
        etichetta: 'Giornata più bassa',
        valore: peggiore ? euroTondo(peggiore.totale) : '—',
        nota: peggiore ? formatDateItalian(peggiore.data) : 'Nessuna giornata registrata'
      }
    ]);
  }

  if (ripartizione) {
    ripartizione.innerHTML = barreOrizzontali(
      ripartizionePerVoce(elencoGiornate).map(v => ({
        etichetta: v.etichetta,
        valore: v.valore,
        nota: percentuale(v.quota)
      })),
      'Nessun incasso nel periodo scelto.'
    );
  }

  if (settimana) {
    settimana.innerHTML = barreOrizzontali(
      mediePerGiornoSettimana(elencoGiornate)
        .filter(g => g.giornate > 0)
        .map(g => ({
          etichetta: g.giorno,
          valore: g.media,
          nota: `${numero(g.giornate)} ${g.giornate === 1 ? 'giornata' : 'giornate'}`
        })),
      'Nessuna giornata registrata nel periodo scelto.'
    );
  }

  const fuori = vociFuoriTotale(elencoGiornate);
  const turni = pesoDeiTurni(elencoGiornate);
  const totaleTurni = turni.mattina + turni.pomeriggio;

  if (riquadriExtra) {
    riquadriExtra.innerHTML = riquadriHtml([
      {
        etichetta: 'Turno mattina',
        valore: totaleTurni === 0 ? '—' : percentuale((turni.mattina / totaleTurni) * 100),
        nota: `${euroTondo(turni.mattina)} su ${numero(turni.giornate)} giornate chiuse`
      },
      {
        etichetta: 'Turno pomeriggio',
        valore: totaleTurni === 0 ? '—' : percentuale((turni.pomeriggio / totaleTurni) * 100),
        nota: `${euroTondo(turni.pomeriggio)} su ${numero(turni.giornate)} giornate chiuse`
      },
      {
        etichetta: 'Aggio Lotto',
        valore: euroTondo(fuori.aggioLotto),
        nota: `L'8% di ${euroTondo(fuori.lottoEntrate)} giocati: è un compenso, non entra nel totale`
      },
      {
        etichetta: 'Incasso bar',
        valore: euroTondo(fuori.bar),
        nota: 'Registrato a parte, fuori dal totale'
      },
      {
        etichetta: 'Fatture pagate',
        valore: euroTondo(fuori.fatture),
        nota: 'Già sottratte dagli incassi'
      }
    ]);
  }
}

function render(): void {
  pulsantiPeriodo.forEach(btn => {
    const attivo = btn.getAttribute('data-periodo') === periodo;
    btn.classList.toggle('is-active', attivo);
    btn.setAttribute('aria-selected', String(attivo));
  });

  renderMeseInCorso();

  const elencoMesi = mesiDelPeriodo();
  renderIncassiMensili(elencoMesi);
  renderStatistiche(giornateDelPeriodo(elencoMesi));
}

function mostraStato(messaggio: string, errore = false): void {
  if (!stato) return;

  stato.textContent = messaggio;
  stato.classList.toggle('is-hidden', !messaggio);
  stato.classList.toggle('is-errore', errore);
}

/**
 * Rilegge tutte le chiusure e ridisegna.
 *
 * Durante la lettura resta in vista quello che c'era prima, solo smorzato:
 * svuotare tutto a ogni apertura farebbe ballare la pagina.
 */
export async function caricaDashboard(): Promise<void> {
  if (!pannello || !amministratore()) return;

  const versione = ++versioneCaricamento;
  pannello.classList.add('is-caricamento');

  try {
    const lette = await caricaGiornate();

    if (versione !== versioneCaricamento) return;

    giornate = lette;
    mesi = raggruppaPerMese(lette);

    mostraStato(giornate.length === 0
      ? 'Nessuna chiusura registrata: la dashboard si riempie da sola man mano che si compilano i turni.'
      : '');

    render();
  } catch (err) {
    if (versione !== versioneCaricamento) return;

    console.error('Errore lettura dati dashboard:', err);
    mostraStato('Non è stato possibile leggere i registri. Controlla la connessione e riprova.', true);
  } finally {
    if (versione === versioneCaricamento) pannello.classList.remove('is-caricamento');
  }
}

/**
 * Mostra la scheda a chi amministra e aggancia il filtro del periodo.
 * Per tutti gli altri non c'è niente da agganciare: la voce resta nascosta.
 */
export function initDashboard(): void {
  if (!pannello || !amministratore()) return;

  document.querySelectorAll<HTMLElement>('.solo-admin').forEach(voce => {
    voce.hidden = false;
  });

  pulsantiPeriodo.forEach(btn => {
    btn.addEventListener('click', () => {
      periodo = (btn.getAttribute('data-periodo') as Periodo) || '12';
      render();
    });
  });
}
