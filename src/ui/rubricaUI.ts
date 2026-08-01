import { Contatto, aggiungiContatto, elencaContatti, eliminaContatto, modificaContatto } from '../services/rubrica';
import { nomeUtente } from '../services/auth';

/**
 * Registro numeri.
 *
 * Un elenco di nomi e numeri, in ordine alfabetico e con la ricerca sopra:
 * quando serve chiamare qualcuno non si deve scorrere tutto. Da telefono il
 * numero è un collegamento e la chiamata parte con un tocco.
 */

let contatti: Contatto[] = [];
let cerca = '';

/** Id del contatto che sta chiedendo conferma prima di sparire */
let daEliminare: string | null = null;

const lista = document.getElementById('rubrica-lista') as HTMLDivElement;
const conteggio = document.getElementById('rubrica-conteggio') as HTMLSpanElement;
const campoNome = document.getElementById('rubrica-nome') as HTMLInputElement;
const campoTelefono = document.getElementById('rubrica-telefono') as HTMLInputElement;
const campoCerca = document.getElementById('rubrica-cerca') as HTMLInputElement;
const pulsanteAggiungi = document.getElementById('btn-rubrica-aggiungi') as HTMLButtonElement;
const avviso = document.getElementById('rubrica-avviso') as HTMLParagraphElement;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Iniziali per il tondino, come nel menu di chi sta usando l'app */
function iniziali(nome: string): string {
  const parole = nome.trim().split(/\s+/).filter(Boolean);
  if (parole.length === 0) return '?';

  return parole.slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

/**
 * Il numero da mettere dentro `tel:`: spazi, punti e trattini servono a chi
 * legge, non a chi compone.
 */
function numeroDaChiamare(telefono: string): string {
  return telefono.replace(/[^\d+]/g, '');
}

/** Cerca senza badare a maiuscole, spazi o trattini nel numero */
function corrisponde(c: Contatto, testo: string): boolean {
  if (!testo) return true;

  const cercato = testo.trim().toLowerCase();
  const soloCifre = cercato.replace(/[^\d+]/g, '');

  if (c.nome.toLowerCase().includes(cercato)) return true;
  if (c.telefono.toLowerCase().includes(cercato)) return true;

  return soloCifre.length > 0 && numeroDaChiamare(c.telefono).includes(soloCifre);
}

function mostraAvviso(testo: string): void {
  if (!avviso) return;

  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
}

function vuoto(): string {
  const messaggio = contatti.length === 0
    ? 'Nessun numero in elenco. Aggiungi il primo qui sopra.'
    : 'Nessun nome o numero corrisponde alla ricerca.';

  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7Z"/><circle cx="13.5" cy="10" r="2.4"/>
        <path d="M10 17a3.5 3.5 0 0 1 7 0"/><path d="M7 7H4"/><path d="M7 12H4"/><path d="M7 17H4"/>
      </svg>
      <p class="empty-state-text">${messaggio}</p>
    </div>
  `;
}

function rigaHtml(c: Contatto): string {
  if (c.id === daEliminare) {
    return `
      <div class="rub-riga is-conferma" data-id="${escapeHtml(c.id)}">
        <span class="rub-conferma-testo">Eliminare <strong>${escapeHtml(c.nome)}</strong> dal registro?</span>
        <div class="rub-azioni">
          <button type="button" class="rub-btn-testo is-danger" data-action="conferma-elimina">Elimina</button>
          <button type="button" class="rub-btn-testo" data-action="annulla-elimina">Annulla</button>
        </div>
      </div>
    `;
  }

  const firma = c.scrittoDa ? `Scritto da ${escapeHtml(c.scrittoDa)}` : '';

  return `
    <div class="rub-riga" data-id="${escapeHtml(c.id)}">
      <span class="rub-iniziali" aria-hidden="true">${escapeHtml(iniziali(c.nome))}</span>

      <div class="rub-dati">
        <span class="rub-nome">${escapeHtml(c.nome)}</span>
        <a class="rub-numero" href="tel:${escapeHtml(numeroDaChiamare(c.telefono))}">${escapeHtml(c.telefono)}</a>
        ${firma ? `<span class="rub-firma">${firma}</span>` : ''}
      </div>

      <div class="rub-azioni">
        <button type="button" class="todo-icon-btn" data-action="modifica" aria-label="Modifica ${escapeHtml(c.nome)}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="todo-icon-btn is-danger" data-action="elimina" aria-label="Elimina ${escapeHtml(c.nome)}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
    </div>
  `;
}

function render(): void {
  if (!lista) return;

  if (conteggio) conteggio.textContent = String(contatti.length);

  const visibili = contatti.filter(c => corrisponde(c, cerca));
  lista.innerHTML = visibili.length === 0 ? vuoto() : visibili.map(rigaHtml).join('');
}

/**
 * Sostituisce la riga con due campi per correggere nome e numero al volo,
 * come si fa con le attività.
 */
function avviaModifica(riga: HTMLElement, contatto: Contatto): void {
  riga.innerHTML = `
    <div class="rub-modifica">
      <input type="text" class="todo-add-input" data-campo="nome" value="${escapeHtml(contatto.nome)}" aria-label="Nome" />
      <input type="tel" class="todo-add-input" data-campo="telefono" inputmode="tel"
             value="${escapeHtml(contatto.telefono)}" aria-label="Numero di telefono" />
      <button type="button" class="rub-btn-testo" data-action="salva-modifica">Salva</button>
    </div>
  `;

  const inputNome = riga.querySelector('[data-campo="nome"]') as HTMLInputElement;
  const inputTelefono = riga.querySelector('[data-campo="telefono"]') as HTMLInputElement;

  inputNome.focus();
  inputNome.setSelectionRange(inputNome.value.length, inputNome.value.length);

  let concluso = false;

  const conferma = (salva: boolean) => {
    if (concluso) return;
    concluso = true;

    const nome = inputNome.value.trim();
    const telefono = inputTelefono.value.trim();

    if (salva && nome && telefono && (nome !== contatto.nome || telefono !== contatto.telefono)) {
      contatto.nome = nome;
      contatto.telefono = telefono;
      contatti.sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
      modificaContatto(contatto.id, nome, telefono);
    }

    render();
  };

  riga.querySelector('[data-action="salva-modifica"]')
    ?.addEventListener('mousedown', e => {
      // Il click arriverebbe dopo il blur, che ha già chiuso la modifica
      e.preventDefault();
      conferma(true);
    });

  [inputNome, inputTelefono].forEach(campo => {
    campo.addEventListener('keydown', e => {
      if (e.key === 'Enter') conferma(true);
      if (e.key === 'Escape') conferma(false);
    });
  });

  // Si esce dalla modifica solo quando il fuoco lascia tutti e due i campi
  riga.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!riga.contains(document.activeElement)) conferma(true);
    }, 0);
  });
}

async function aggiungi(): Promise<void> {
  const nome = campoNome?.value?.trim() || '';
  const telefono = campoTelefono?.value?.trim() || '';

  if (!nome || !telefono) {
    mostraAvviso('Servono sia il nome sia il numero.');
    return;
  }

  if (numeroDaChiamare(telefono).length < 6) {
    mostraAvviso('Il numero sembra incompleto.');
    return;
  }

  mostraAvviso('');
  campoNome.value = '';
  campoTelefono.value = '';

  const voce = await aggiungiContatto(nome, telefono, nomeUtente());

  contatti.push(voce);
  contatti.sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));

  // Un nome appena scritto deve vedersi, anche se la ricerca lo escluderebbe
  if (cerca && !corrisponde(voce, cerca)) {
    cerca = '';
    if (campoCerca) campoCerca.value = '';
  }

  render();
  campoNome.focus();
}

export async function caricaRubrica(): Promise<void> {
  if (!lista) return;

  contatti = await elencaContatti();
  render();
}

export function initRubrica(): void {
  if (!lista) return;

  pulsanteAggiungi?.addEventListener('click', aggiungi);

  [campoNome, campoTelefono].forEach(campo => {
    campo?.addEventListener('keydown', e => {
      if (e.key === 'Enter') aggiungi();
    });
  });

  campoCerca?.addEventListener('input', () => {
    cerca = campoCerca.value;
    render();
  });

  // Un solo gestore sul contenitore: le righe si ridisegnano di continuo
  lista.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.rub-riga') as HTMLElement | null;
    const id = riga?.getAttribute('data-id');
    const contatto = contatti.find(c => c.id === id);
    if (!riga || !contatto) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'modifica') {
      avviaModifica(riga, contatto);
    } else if (azione === 'elimina') {
      // Un numero cancellato per sbaglio non si recupera: prima si chiede
      daEliminare = contatto.id;
      render();
    } else if (azione === 'annulla-elimina') {
      daEliminare = null;
      render();
    } else if (azione === 'conferma-elimina') {
      daEliminare = null;
      contatti = contatti.filter(c => c.id !== contatto.id);
      render();
      eliminaContatto(contatto.id);
    }
  });

  render();
}
