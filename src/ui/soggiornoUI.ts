import {
  aggiungiSoggiorno,
  calcolaImporto,
  elencaSoggiorni,
  eliminaSoggiorno,
  segnaPagata,
  Soggiorno,
  TARIFFA_A_PERSONA
} from '../services/soggiorno';
import { formatCurrency } from '../utils/calculations';
import { segnala } from './segnalazioni';

let soggiorni: Soggiorno[] = [];

const lista = document.getElementById('soggiorno-lista') as HTMLDivElement;
const totaleDaPagare = document.getElementById('soggiorno-da-pagare') as HTMLSpanElement;
const anteprima = document.getElementById('soggiorno-anteprima') as HTMLParagraphElement;
const btnAggiungi = document.getElementById('btn-add-soggiorno') as HTMLButtonElement;

const campoNome = document.getElementById('soggiorno-nome') as HTMLInputElement;
const campoCognome = document.getElementById('soggiorno-cognome') as HTMLInputElement;
const campoPersone = document.getElementById('soggiorno-persone') as HTMLInputElement;
const campoGiorni = document.getElementById('soggiorno-giorni') as HTMLInputElement;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function intero(campo: HTMLInputElement | null): number {
  const n = parseInt((campo?.value || '').trim(), 10);
  return isNaN(n) || n < 1 ? 0 : n;
}

/** Mostra il conto mentre si digita, così il totale non è una sorpresa */
function aggiornaAnteprima() {
  if (!anteprima) return;

  const persone = intero(campoPersone);
  const giorni = intero(campoGiorni);

  if (persone === 0 || giorni === 0) {
    anteprima.textContent = `Tariffa ${formatCurrency(TARIFFA_A_PERSONA)} a persona per notte.`;
    return;
  }

  const importo = calcolaImporto(giorni, persone);
  anteprima.textContent =
    `${giorni} notti x ${formatCurrency(TARIFFA_A_PERSONA)} x ${persone} ` +
    `${persone === 1 ? 'persona' : 'persone'} = ${formatCurrency(importo)}`;
}

function render() {
  if (!lista) return;

  const daPagare = soggiorni.filter(s => !s.pagata);

  if (totaleDaPagare) {
    const totale = daPagare.reduce((somma, s) => somma + s.importo, 0);
    totaleDaPagare.textContent = formatCurrency(totale);
    totaleDaPagare.classList.toggle('is-negative', totale > 0);
  }

  // Il pallino sul menu segnala quante tasse restano da versare
  segnala('soggiorno', daPagare.length);

  if (soggiorni.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>
        </svg>
        <p class="empty-state-text">Nessun soggiorno registrato.</p>
      </div>
    `;
    return;
  }

  lista.innerHTML = soggiorni.map(s => `
    <div class="sog-row ${s.pagata ? 'is-pagata' : ''}" data-id="${escapeHtml(s.id)}">
      <label class="sog-check">
        <input type="checkbox" ${s.pagata ? 'checked' : ''} data-action="pagata" />
        <span class="sog-check-box" aria-hidden="true"></span>
      </label>

      <div class="sog-dati">
        <span class="sog-nome">${escapeHtml(s.cognome)} ${escapeHtml(s.nome)}</span>
        <span class="sog-calcolo">
          ${s.giorni} ${s.giorni === 1 ? 'notte' : 'notti'} ·
          ${s.persone} ${s.persone === 1 ? 'persona' : 'persone'} ·
          ${formatCurrency(s.tariffa)} a testa
        </span>
      </div>

      <span class="sog-importo">${formatCurrency(s.importo)}</span>

      <button type="button" class="todo-icon-btn is-danger" data-action="elimina" aria-label="Elimina">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    </div>
  `).join('');
}

async function aggiungi() {
  const nome = campoNome?.value?.trim();
  const cognome = campoCognome?.value?.trim();
  const persone = intero(campoPersone);
  const giorni = intero(campoGiorni);

  if (!nome || !cognome || persone === 0 || giorni === 0) return;

  const voce = await aggiungiSoggiorno({
    nome,
    cognome,
    persone,
    giorni,
    tariffa: TARIFFA_A_PERSONA,
    pagata: false
  });

  soggiorni.unshift(voce);

  campoNome.value = '';
  campoCognome.value = '';
  campoPersone.value = '';
  campoGiorni.value = '';

  aggiornaAnteprima();
  render();
  campoNome.focus();
}

export async function caricaSoggiorni() {
  soggiorni = await elencaSoggiorni();
  render();
}

export function initSoggiorno() {
  if (!lista) return;

  btnAggiungi?.addEventListener('click', aggiungi);

  [campoNome, campoCognome, campoPersone, campoGiorni].forEach(campo => {
    campo?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') aggiungi();
    });
  });

  campoPersone?.addEventListener('input', aggiornaAnteprima);
  campoGiorni?.addEventListener('input', aggiornaAnteprima);

  lista.addEventListener('click', async e => {
    const bersaglio = e.target as HTMLElement;
    const riga = bersaglio.closest('.sog-row') as HTMLElement | null;
    const id = riga?.getAttribute('data-id');
    if (!riga || !id) return;

    if (bersaglio.closest('[data-action="elimina"]')) {
      soggiorni = soggiorni.filter(s => s.id !== id);
      await eliminaSoggiorno(id);
      render();
    }
  });

  lista.addEventListener('change', async e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'pagata') return;

    const riga = campo.closest('.sog-row') as HTMLElement | null;
    const id = riga?.getAttribute('data-id');
    if (!id) return;

    const voce = soggiorni.find(s => s.id === id);
    if (voce) voce.pagata = campo.checked;

    await segnaPagata(id, campo.checked);
    render();
  });

  aggiornaAnteprima();
  render();
}
