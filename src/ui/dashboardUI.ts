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
  speseFatture,
  totaleFinoAlGiorno,
  vociFuoriTotale
} from '../services/statistiche';
import { IncassoH24, elencaIncassi } from '../services/h24';
import {
  barreOrizzontali,
  escapeHtml,
  euro,
  euroTondo,
  graficoColonne,
  meseIndietro,
  nomeMese,
  numero,
  percentuale,
  riquadriHtml,
  variazione
} from './grafici';
import { formatDateItalian, getTodayDateString } from '../utils/calculations';
import { amministratore } from '../services/auth';

/**
 * Dashboard della tabaccheria.
 *
 * Non si scrive niente da qui: si legge soltanto quello che le chiusure hanno
 * già registrato. La scheda compare solo a chi ha admin a true nel profilo.
 */

type Periodo = '12' | 'anno' | 'tutto';

let giornate: GiornataIncasso[] = [];
let mesi: MeseIncasso[] = [];
let incassiH24: IncassoH24[] = [];
let periodo: Periodo = '12';

/** Il mese aperto nella scheda in alto: si parte da quello in corso */
let meseAperto = meseCorrente();

/** Un caricamento più lento di un altro non deve riscrivere sopra il più recente */
let versioneCaricamento = 0;

const pannello = document.getElementById('tab-dashboard') as HTMLDivElement;
const stato = document.getElementById('dash-stato') as HTMLParagraphElement;

const nomeMeseCorrente = document.getElementById('dash-mese-nome') as HTMLSpanElement;
const titoloMese = document.getElementById('dash-mese-titolo') as HTMLSpanElement;
const etichettaHero = document.getElementById('dash-hero-etichetta') as HTMLSpanElement;
const totaleMese = document.getElementById('dash-mese-totale') as HTMLSpanElement;
const notaMese = document.getElementById('dash-mese-nota') as HTMLSpanElement;
const riquadriMese = document.getElementById('dash-riquadri-mese') as HTMLDivElement;
const btnMeseIndietro = document.getElementById('btn-mese-indietro') as HTMLButtonElement;
const btnMeseAvanti = document.getElementById('btn-mese-avanti') as HTMLButtonElement;

const totalePeriodo = document.getElementById('dash-periodo-totale') as HTMLSpanElement;
const riquadriMedie = document.getElementById('dash-riquadri-medie') as HTMLDivElement;
const graficoMesi = document.getElementById('dash-grafico-mesi') as HTMLDivElement;
const tabellaMesi = document.getElementById('dash-tabella-mesi') as HTMLTableSectionElement;

const riquadriStatistiche = document.getElementById('dash-riquadri-statistiche') as HTMLDivElement;
const ripartizione = document.getElementById('dash-ripartizione') as HTMLDivElement;
const spesePerFattura = document.getElementById('dash-fatture') as HTMLDivElement;
const settimana = document.getElementById('dash-settimana') as HTMLDivElement;
const riquadriExtra = document.getElementById('dash-riquadri-extra') as HTMLDivElement;
const riquadriInsieme = document.getElementById('dash-riquadri-insieme') as HTMLDivElement;

const pulsantiPeriodo = Array.from(
  document.querySelectorAll('#tab-dashboard .dash-periodo')
) as HTMLButtonElement[];

/**
 * Il colore di ogni servizio, fissato una volta per tutte.
 *
 * Le barre si riordinano per importo a ogni cambio di periodo: legando il
 * colore al nome, il Lotto resta del suo colore anche quando scavalca il
 * Printer. Legarlo alla posizione vorrebbe dire ridipingere tutto a ogni
 * filtro, e chi aveva imparato "Tabacchi è blu" leggerebbe il grafico storto.
 */
const SERIE_DELLE_VOCI: Record<string, number> = {
  Sisal: 2,
  Mooney: 3,
  Lis: 4,
  Printer: 5,
  'Lotto giocato': 6
};

/** "2026-08-02" -> "2 agosto" */
function dataBreve(iso: string): string {
  const [a, m, g] = iso.split('-').map(Number);
  return new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
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
 * La scheda del mese aperto.
 *
 * Di solito è quello in corso, ma con le frecce si torna indietro: per un mese
 * già chiuso la proiezione non ha senso e lascia il posto al confronto con il
 * mese prima, che invece si può fare per intero.
 */
function renderMeseAperto(): void {
  const oggi = getTodayDateString();
  const corrente = meseCorrente();
  const inCorso = meseAperto === corrente;
  const mese = mesi.find(m => m.mese === meseAperto);

  if (nomeMeseCorrente) nomeMeseCorrente.textContent = nomeMese(meseAperto);
  if (titoloMese) titoloMese.textContent = inCorso ? 'Mese in corso' : 'Mese concluso';
  if (etichettaHero) {
    etichettaHero.textContent = inCorso ? 'Incasso del mese finora' : 'Incasso del mese';
  }

  // Indietro fino al primo mese registrato, avanti non oltre quello in corso
  const primo = mesi.length > 0 ? mesi[0].mese : corrente;
  if (btnMeseIndietro) btnMeseIndietro.disabled = meseAperto <= primo;
  if (btnMeseAvanti) btnMeseAvanti.disabled = inCorso;

  if (!mese) {
    if (totaleMese) totaleMese.textContent = euroTondo(0);
    if (notaMese) {
      notaMese.textContent = inCorso
        ? 'Nessuna chiusura registrata questo mese.'
        : `Nessuna chiusura registrata in ${nomeMese(meseAperto)}.`;
    }
    if (riquadriMese) riquadriMese.innerHTML = '';
    return;
  }

  if (totaleMese) totaleMese.textContent = euroTondo(mese.totale);

  const delMese = giornate.filter(g => g.data.slice(0, 7) === meseAperto);
  const ultima = delMese[delMese.length - 1];

  if (notaMese) {
    notaMese.textContent = inCorso && ultima
      ? `Aggiornato all'ultima chiusura registrata: ${dataBreve(ultima.data)}`
      : `${numero(mese.giornate)} ${mese.giornate === 1 ? 'giornata registrata' : 'giornate registrate'}`;
  }

  const scorso = mesePrecedente(meseAperto);
  const meseScorso = mesi.find(m => m.mese === scorso);

  if (!riquadriMese) return;

  if (inCorso) {
    const giorno = Number(oggi.slice(8, 10));
    const scorsoStessoPeriodo = totaleFinoAlGiorno(giornate, scorso, giorno);
    const proiezione = proiezioneMese(mese, oggi);

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
    return;
  }

  // Mese chiuso: si può confrontare per intero, e la giornata migliore è certa
  const { migliore } = estremi(delMese);

  riquadriMese.innerHTML = riquadriHtml([
    {
      etichetta: 'Media al giorno',
      valore: euroTondo(mese.mediaGiornaliera),
      nota: `Su ${numero(mese.giornate)} ${mese.giornate === 1 ? 'giornata registrata' : 'giornate registrate'}`
    },
    {
      etichetta: 'Mese prima',
      valore: meseScorso ? euroTondo(meseScorso.totale) : '—',
      nota: meseScorso ? meseScorso.etichetta : 'Nessun dato sul mese prima',
      delta: meseScorso ? variazione(mese.totale, meseScorso.totale, 'sul mese prima') : ''
    },
    {
      etichetta: 'Giornata migliore',
      valore: migliore ? euroTondo(migliore.totale) : '—',
      nota: migliore ? formatDateItalian(migliore.data) : 'Nessuna giornata registrata'
    },
    {
      etichetta: 'Distributori H24',
      valore: euroTondo(incassiH24.find(i => i.mese === meseAperto)?.importo ?? 0),
      nota: incassiH24.some(i => i.mese === meseAperto)
        ? 'Incasso delle macchine in questo mese'
        : 'Nessun incasso registrato per questo mese'
    }
  ]);
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

  if (!tabellaMesi) return;

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

/**
 * Negozio e distributori messi uno accanto all'altro.
 *
 * I due totali restano distinti: le chiusure si registrano giorno per giorno,
 * i distributori un mese alla volta, e sommarli dentro allo stesso conto
 * confonderebbe due cose che si dichiarano separatamente.
 */
function renderInsieme(elenco: MeseIncasso[]): void {
  if (!riquadriInsieme) return;

  const dentro = new Set(elenco.map(m => m.mese));
  const negozio = elenco.reduce((s, m) => s + m.totale, 0);
  const distributori = incassiH24
    .filter(i => dentro.has(i.mese))
    .reduce((s, i) => s + i.importo, 0);

  const insieme = negozio + distributori;

  riquadriInsieme.innerHTML = riquadriHtml([
    {
      etichetta: 'Negozio',
      valore: euroTondo(negozio),
      nota: `${percentuale(insieme === 0 ? 0 : (negozio / insieme) * 100)} del totale`
    },
    {
      etichetta: 'Distributori H24',
      valore: euroTondo(distributori),
      nota: distributori === 0
        ? 'Nessun incasso registrato per questi mesi'
        : `${percentuale(insieme === 0 ? 0 : (distributori / insieme) * 100)} del totale`
    },
    {
      etichetta: 'Tutto insieme',
      valore: euroTondo(insieme),
      nota: 'Negozio e distributori sommati',
      forte: true
    }
  ]);
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
        nota: percentuale(v.quota),
        serie: SERIE_DELLE_VOCI[v.etichetta]
      })),
      'Nessun incasso nel periodo scelto.'
    );
  }

  if (spesePerFattura) {
    const spese = speseFatture(elencoGiornate);

    spesePerFattura.innerHTML = barreOrizzontali(
      // Le prime dodici: sotto ci finisce la spesa da pochi euro fatta una
      // volta sola, che allunga l'elenco senza dire niente
      spese.slice(0, 12).map(v => ({
        etichetta: v.nome,
        valore: v.totale,
        nota: v.quante === 1 ? 'una volta' : `${numero(v.quante)} volte`
      })),
      'Nessuna fattura registrata nel periodo scelto.'
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
        etichetta: 'Vincite Lotto pagate',
        valore: euroTondo(fuori.lottoUscite),
        nota: 'Escono dalla cassa: già tolte dal totale delle giornate'
      },
      {
        etichetta: 'Incasso bar',
        valore: euroTondo(fuori.bar),
        nota: 'Registrato a parte, fuori dal totale'
      },
      {
        etichetta: 'Gratta e Vinci',
        valore: euroTondo(fuori.grattaEVinci),
        nota: 'Registrato a parte, fuori dal totale'
      },
      {
        etichetta: 'Logista',
        valore: euroTondo(fuori.logista),
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

  renderMeseAperto();

  const elencoMesi = mesiDelPeriodo();
  renderIncassiMensili(elencoMesi);
  renderInsieme(elencoMesi);
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
    // I distributori si leggono insieme al resto: nella dashboard entrano
    // come dato, accanto a quello che fa il negozio
    const [lette, h24] = await Promise.all([caricaGiornate(), elencaIncassi()]);

    if (versione !== versioneCaricamento) return;

    giornate = lette;
    mesi = raggruppaPerMese(lette);
    incassiH24 = h24;

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
 * Mostra le schede riservate e aggancia il filtro del periodo.
 * Per tutti gli altri non c'è niente da agganciare: le voci restano nascoste.
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

  btnMeseIndietro?.addEventListener('click', () => {
    meseAperto = meseIndietro(meseAperto);
    renderMeseAperto();
  });

  btnMeseAvanti?.addEventListener('click', () => {
    // Avanti non si va oltre il mese in corso: dopo non c'è niente da vedere
    if (meseAperto >= meseCorrente()) return;

    meseAperto = meseIndietro(meseAperto, -1);
    renderMeseAperto();
  });
}
