import {
  Calendario,
  elencaCalendari,
  elencaSoggiorni,
  importaDaCalendari,
  salvaCalendari,
  segnaPagata,
  Soggiorno,
  TARIFFA_A_PERSONA
} from '../services/soggiorno';
import { formatCurrency, getTodayDateString } from '../utils/calculations';
import { segnala } from './segnalazioni';

let soggiorni: Soggiorno[] = [];
let calendari: Calendario[] = [];
let mostraPagate = false;

const lista = document.getElementById('soggiorno-lista') as HTMLDivElement;
const totaleDaPagare = document.getElementById('soggiorno-da-pagare') as HTMLSpanElement;
const btnAggiorna = document.getElementById('btn-aggiorna-soggiorni') as HTMLButtonElement;
const btnCalendari = document.getElementById('btn-calendari') as HTMLButtonElement;
const btnMostraPagate = document.getElementById('btn-mostra-pagate') as HTMLButtonElement;
const pannelloCal = document.getElementById('pannello-calendari') as HTMLDivElement;
const statoImport = document.getElementById('soggiorno-stato') as HTMLParagraphElement;
const btnSalvaCal = document.getElementById('btn-salva-calendari') as HTMLButtonElement;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 2026-08-01 -> 1 ago */
function dataBreve(iso: string): string {
  const [a, m, g] = iso.split('-').map(Number);
  return new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/**
 * Si mostrano solo i soggiorni conclusi: la tassa si riscuote alla partenza,
 * quindi chi deve ancora andare via non è ancora dovuto.
 */
function daMostrare(): Soggiorno[] {
  const oggi = getTodayDateString();
  return soggiorni
    .filter(s => s.dataFine <= oggi)
    .filter(s => mostraPagate || !s.pagata)
    .sort((a, b) => b.dataFine.localeCompare(a.dataFine));
}

function render() {
  if (!lista) return;

  const oggi = getTodayDateString();
  const conclusi = soggiorni.filter(s => s.dataFine <= oggi);
  const daPagare = conclusi.filter(s => !s.pagata);

  if (totaleDaPagare) {
    const totale = daPagare.reduce((somma, s) => somma + s.importo, 0);
    totaleDaPagare.textContent = formatCurrency(totale);
    totaleDaPagare.classList.toggle('is-negative', totale > 0);
  }

  segnala('soggiorno', daPagare.length);

  if (btnMostraPagate) {
    btnMostraPagate.textContent = mostraPagate ? 'Nascondi pagate' : 'Mostra pagate';
    btnMostraPagate.classList.toggle('is-active', mostraPagate);
  }

  const voci = daMostrare();

  if (voci.length === 0) {
    const inArrivo = soggiorni.length - conclusi.length;

    lista.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>
        </svg>
        <p class="empty-state-text">
          ${conclusi.length === 0
            ? (soggiorni.length === 0
                ? 'Nessun soggiorno importato. Configura i calendari e premi Aggiorna.'
                : `Nessun soggiorno ancora concluso. ${inArrivo} in corso o in arrivo.`)
            : 'Tutte le tasse dei soggiorni conclusi risultano versate.'}
        </p>
      </div>
    `;
    return;
  }

  lista.innerHTML = voci.map(s => `
    <div class="sog-row ${s.pagata ? 'is-pagata' : ''}" data-uid="${escapeHtml(s.uid)}">
      <label class="sog-check">
        <input type="checkbox" ${s.pagata ? 'checked' : ''} data-action="pagata"
               aria-label="Segna come versata" />
        <span class="sog-check-box" aria-hidden="true"></span>
      </label>

      <div class="sog-dati">
        <span class="sog-nome">${escapeHtml(s.nome)}</span>
        <span class="sog-calcolo">
          ${dataBreve(s.dataInizio)} &rarr; ${dataBreve(s.dataFine)} ·
          ${s.notti} ${s.notti === 1 ? 'notte' : 'notti'} ·
          ${s.ospiti} ${s.ospiti === 1 ? 'ospite' : 'ospiti'} ·
          ${formatCurrency(s.tariffa)} a testa
        </span>
      </div>

      <span class="sog-importo">${formatCurrency(s.importo)}</span>
    </div>
  `).join('');
}

function renderCalendari() {
  if (!pannelloCal) return;

  const campi = pannelloCal.querySelectorAll<HTMLInputElement>('.cal-url');
  campi.forEach((campo, i) => {
    campo.value = calendari[i]?.url || '';
  });
}

async function aggiorna() {
  if (!btnAggiorna) return;

  btnAggiorna.disabled = true;
  if (statoImport) statoImport.textContent = 'Lettura dei calendari in corso...';

  const esito = await importaDaCalendari();
  soggiorni = await elencaSoggiorni();

  if (statoImport) {
    const parti: string[] = [];
    if (esito.nuovi > 0) parti.push(`${esito.nuovi} nuovi soggiorni`);
    if (esito.aggiornati > 0) parti.push(`${esito.aggiornati} aggiornati`);
    if (parti.length === 0 && esito.errori.length === 0) parti.push('nessuna novità');

    statoImport.textContent = parti.join(', ') +
      (esito.errori.length > 0 ? ` — problemi: ${esito.errori.join('; ')}` : '');
    statoImport.classList.toggle('is-errore', esito.errori.length > 0);
  }

  btnAggiorna.disabled = false;
  render();
}

export async function caricaSoggiorni() {
  [soggiorni, calendari] = await Promise.all([elencaSoggiorni(), elencaCalendari()]);
  renderCalendari();
  render();
}

export function initSoggiorno() {
  if (!lista) return;

  btnAggiorna?.addEventListener('click', aggiorna);

  btnCalendari?.addEventListener('click', () => {
    pannelloCal?.classList.toggle('is-hidden');
    btnCalendari.classList.toggle('is-active', !pannelloCal?.classList.contains('is-hidden'));
  });

  btnMostraPagate?.addEventListener('click', () => {
    mostraPagate = !mostraPagate;
    render();
  });

  btnSalvaCal?.addEventListener('click', async () => {
    const campi = Array.from(pannelloCal.querySelectorAll<HTMLInputElement>('.cal-url'));

    await salvaCalendari(
      campi.map((c, i) => ({ etichetta: `Camera ${i + 1}`, url: c.value.trim() }))
    );

    calendari = await elencaCalendari();
    if (statoImport) statoImport.textContent = `${calendari.length} calendari salvati.`;

    pannelloCal.classList.add('is-hidden');
    btnCalendari?.classList.remove('is-active');

    aggiorna();
  });

  lista.addEventListener('change', async e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'pagata') return;

    const riga = campo.closest('.sog-row') as HTMLElement | null;
    const uid = riga?.getAttribute('data-uid');
    if (!uid) return;

    const voce = soggiorni.find(s => s.uid === uid);
    if (voce) voce.pagata = campo.checked;

    await segnaPagata(uid, campo.checked);
    render();
  });

  render();
}

export { TARIFFA_A_PERSONA };
