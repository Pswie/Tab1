import {
  DISTRIBUTORI,
  Distributore,
  IncassoH24,
  NOMI_DISTRIBUTORI,
  Rifornimento,
  elencaIncassi,
  elencaRifornimenti
} from '../services/h24';
import {
  barreOrizzontali,
  euro,
  euroTondo,
  graficoColonne,
  meseIndietro,
  nomeMese,
  nomeMeseBreve,
  numero,
  percentuale,
  riquadriHtml,
  variazione,
  vuoto
} from './grafici';
import { getTodayDateString } from '../utils/calculations';
import { amministratore } from '../services/auth';

/**
 * Dashboard dei distributori.
 *
 * I distributori hanno conti propri e si guardano da soli: quanto hanno
 * incassato mese per mese e cosa vendono davvero. Le vendite si ricavano dai
 * rifornimenti, perché nelle macchine non c'è uno scontrino per prodotto ma
 * quello che si rimette dentro è esattamente quello che è uscito.
 */

type Periodo = '12' | 'anno' | 'tutto';

let incassi: IncassoH24[] = [];
let rifornimenti: Rifornimento[] = [];
let periodo: Periodo = '12';

let versioneCaricamento = 0;

const pannello = document.getElementById('tab-h24-dashboard') as HTMLDivElement;

const totaleAnno = document.getElementById('h24d-totale-anno') as HTMLSpanElement;
const notaAnno = document.getElementById('h24d-nota-anno') as HTMLSpanElement;
const riquadri = document.getElementById('h24d-riquadri') as HTMLDivElement;
const grafico = document.getElementById('h24d-grafico-mesi') as HTMLDivElement;
const tabella = document.getElementById('h24d-tabella-mesi') as HTMLTableSectionElement;
const venduti = document.getElementById('h24d-venduti') as HTMLDivElement;
const perMacchina = document.getElementById('h24d-macchine') as HTMLDivElement;
const notaVendite = document.getElementById('h24d-nota-vendite') as HTMLParagraphElement;

const pulsantiPeriodo = Array.from(
  document.querySelectorAll('#tab-h24-dashboard .dash-periodo')
) as HTMLButtonElement[];

function meseCorrente(): string {
  return getTodayDateString().slice(0, 7);
}

/** I mesi che rientrano nel periodo scelto, dal più vecchio al più recente */
function mesiDelPeriodo(): IncassoH24[] {
  const ordinati = [...incassi].sort((a, b) => a.mese.localeCompare(b.mese));

  if (periodo === 'tutto') return ordinati;

  if (periodo === 'anno') {
    const anno = getTodayDateString().slice(0, 4);
    return ordinati.filter(i => i.mese.startsWith(anno));
  }

  return ordinati.slice(-12);
}

/** I rifornimenti che cadono nel periodo scelto */
function rifornimentiDelPeriodo(mesi: IncassoH24[]): Rifornimento[] {
  if (periodo === 'tutto') return rifornimenti;

  if (periodo === 'anno') {
    const anno = getTodayDateString().slice(0, 4);
    return rifornimenti.filter(r => r.giorno.startsWith(anno));
  }

  // Con i soli incassi il periodo resterebbe vuoto finché non se ne scrive uno:
  // i dodici mesi si contano dal calendario, non da quello che è stato inserito
  const primo = mesi.length > 0 ? mesi[0].mese : meseIndietro(meseCorrente(), 11);
  const taglio = periodo === '12' ? meseIndietro(meseCorrente(), 11) : primo;

  return rifornimenti.filter(r => r.giorno.slice(0, 7) >= taglio);
}

function renderRiepilogo(mesi: IncassoH24[]): void {
  const anno = getTodayDateString().slice(0, 4);
  const diQuestAnno = incassi.filter(i => i.mese.startsWith(anno));
  const totaleQuestAnno = diQuestAnno.reduce((s, i) => s + i.importo, 0);

  if (totaleAnno) totaleAnno.textContent = euroTondo(totaleQuestAnno);
  if (notaAnno) {
    notaAnno.textContent = diQuestAnno.length === 0
      ? 'Nessun mese registrato quest\'anno'
      : `${numero(diQuestAnno.length)} ${diQuestAnno.length === 1 ? 'mese registrato' : 'mesi registrati'} nel ${anno}`;
  }

  const totale = mesi.reduce((s, i) => s + i.importo, 0);
  const ultimo = mesi[mesi.length - 1];
  const penultimo = mesi[mesi.length - 2];
  const migliore = mesi.reduce<IncassoH24 | null>((top, m) => (!top || m.importo > top.importo ? m : top), null);
  const daDichiarare = incassi.filter(i => !i.dichiarato).length;

  if (riquadri) {
    riquadri.innerHTML = riquadriHtml([
      {
        etichetta: 'Ultimo mese registrato',
        valore: ultimo ? euroTondo(ultimo.importo) : '—',
        nota: ultimo ? nomeMese(ultimo.mese) : 'Nessun incasso registrato',
        delta: ultimo && penultimo ? variazione(ultimo.importo, penultimo.importo, 'sul mese prima') : ''
      },
      {
        etichetta: 'Media mensile',
        valore: euroTondo(mesi.length === 0 ? 0 : totale / mesi.length),
        nota: `Sui ${numero(mesi.length)} mesi registrati nel periodo`
      },
      {
        etichetta: 'Mese migliore',
        valore: migliore ? euroTondo(migliore.importo) : '—',
        nota: migliore ? nomeMese(migliore.mese) : 'Nessun incasso registrato'
      },
      {
        etichetta: 'Da dichiarare',
        valore: numero(daDichiarare),
        nota: daDichiarare === 0
          ? 'Nessuna dichiarazione in sospeso'
          : `${daDichiarare === 1 ? 'Un mese' : 'Mesi'} ancora da dichiarare`
      }
    ]);
  }
}

function renderMesi(mesi: IncassoH24[]): void {
  const corrente = meseCorrente();

  const piuAlto = mesi.reduce<IncassoH24 | null>(
    (top, m) => (!top || m.importo > top.importo ? m : top),
    null
  );

  if (grafico) {
    grafico.innerHTML = graficoColonne(
      mesi.map(m => ({
        etichetta: nomeMeseBreve(m.mese),
        valore: m.importo,
        evidenzia: m.mese === corrente,
        valoreInVista: m === piuAlto,
        titolo: `${nomeMese(m.mese)}: ${euro(m.importo)}${m.dichiarato ? ' (dichiarato)' : ' (da dichiarare)'}`
      })),
      'Nessun incasso registrato nel periodo scelto.'
    );
  }

  if (!tabella) return;

  if (mesi.length === 0) {
    tabella.innerHTML = `
      <tr><td colspan="4" class="dash-tabella-vuota">Nessun incasso registrato nel periodo scelto.</td></tr>
    `;
    return;
  }

  // Dal più recente: è quello che si guarda per primo
  tabella.innerHTML = [...mesi].reverse().map(m => {
    const prima = incassi.find(x => x.mese === meseIndietro(m.mese));

    return `
      <tr class="${m.dichiarato ? '' : 'is-parziale'}">
        <th scope="row">${nomeMese(m.mese)}</th>
        <td class="dash-num">${euro(m.importo)}</td>
        <td class="dash-num">${prima ? variazione(m.importo, prima.importo, '') : '—'}</td>
        <td>${m.dichiarato
          ? '<span class="dash-tag is-fatto">dichiarato</span>'
          : '<span class="dash-tag">da dichiarare</span>'}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Cosa vende di più.
 *
 * Il conto sono i pezzi rimessi dentro alle macchine: finché non si segna un
 * rifornimento non c'è niente da mostrare, perché è quello il momento in cui
 * si sa quanto è uscito.
 */
function renderVendite(elenco: Rifornimento[]): void {
  const perProdotto = new Map<string, { nome: string; distributore: Distributore; pezzi: number }>();

  elenco.forEach(r => {
    const chiave = `${r.distributore}|${r.nome.toLowerCase()}`;
    const voce = perProdotto.get(chiave);

    if (voce) voce.pezzi += r.pezzi;
    else perProdotto.set(chiave, { nome: r.nome, distributore: r.distributore, pezzi: r.pezzi });
  });

  const classifica = Array.from(perProdotto.values())
    .sort((a, b) => b.pezzi - a.pezzi)
    .slice(0, 10);

  const totalePezzi = elenco.reduce((s, r) => s + r.pezzi, 0);

  if (notaVendite) {
    notaVendite.textContent = elenco.length === 0
      ? 'Il conto si riempie da solo: ogni volta che si segna una macchina come rifornita, i pezzi rimessi dentro finiscono qui.'
      : `${numero(totalePezzi)} pezzi rimessi nelle macchine nel periodo scelto.`;
  }

  if (venduti) {
    venduti.innerHTML = barreOrizzontali(
      classifica.map(p => ({
        etichetta: p.nome,
        valore: p.pezzi,
        nota: NOMI_DISTRIBUTORI[p.distributore],
        testoValore: `${numero(p.pezzi)} pz`
      })),
      'Nessun rifornimento ancora segnato.'
    );
  }

  if (!perMacchina) return;

  const totaliMacchina = DISTRIBUTORI.map(macchina => ({
    macchina,
    pezzi: elenco.filter(r => r.distributore === macchina).reduce((s, r) => s + r.pezzi, 0)
  }));

  perMacchina.innerHTML = totalePezzi === 0
    ? vuoto('Nessun rifornimento ancora segnato.', '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 6.5h8"/><path d="M8 11h8"/><path d="M8 15.5h4"/>')
    : riquadriHtml(totaliMacchina.map(t => ({
        etichetta: NOMI_DISTRIBUTORI[t.macchina],
        valore: `${numero(t.pezzi)} pz`,
        nota: `${percentuale(totalePezzi === 0 ? 0 : (t.pezzi / totalePezzi) * 100)} dei pezzi rimessi`
      })));
}

function render(): void {
  pulsantiPeriodo.forEach(btn => {
    const attivo = btn.getAttribute('data-periodo') === periodo;
    btn.classList.toggle('is-active', attivo);
    btn.setAttribute('aria-selected', String(attivo));
  });

  const mesi = mesiDelPeriodo();

  renderRiepilogo(mesi);
  renderMesi(mesi);
  renderVendite(rifornimentiDelPeriodo(mesi));
}

export async function caricaDashboardH24(): Promise<void> {
  if (!pannello || !amministratore()) return;

  const versione = ++versioneCaricamento;
  pannello.classList.add('is-caricamento');

  try {
    const [letti, storia] = await Promise.all([elencaIncassi(), elencaRifornimenti()]);

    if (versione !== versioneCaricamento) return;

    incassi = letti;
    rifornimenti = storia;
    render();
  } catch (err) {
    console.error('Errore lettura dati distributori:', err);
  } finally {
    if (versione === versioneCaricamento) pannello.classList.remove('is-caricamento');
  }
}

export function initDashboardH24(): void {
  if (!pannello || !amministratore()) return;

  pulsantiPeriodo.forEach(btn => {
    btn.addEventListener('click', () => {
      periodo = (btn.getAttribute('data-periodo') as Periodo) || '12';
      render();
    });
  });
}
