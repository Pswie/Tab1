import './style.css';
import { SaveStatus, ShiftKey, ShiftValues, TodoFilter, TodoItem } from './types';
import {
  calculateDayTotals,
  calculateLottoAggio,
  calculateLottoNet,
  emptyShiftValues,
  formatCurrency,
  formatDateItalian,
  formatDateLocalISO,
  formatInputValue,
  getActiveShift,
  getMaxAllowedDateString,
  getMinAllowedDateString,
  getTomorrowDateString,
  getWorkingDateString,
  parseInputValue
} from './utils/calculations';
import { autoSaveDailyLog, fetchEmployeeLogs, fetchLogByDate } from './services/supabase';
import {
  aggiungiAttivita,
  elencaAttivita,
  eliminaAttivita,
  impostaCompletata,
  modificaTesto,
  svuotaCompletate
} from './services/attivita';
import { caricaInventario, initInventario } from './ui/inventarioUI';
import { caricaSoggiorni, initSoggiorno } from './ui/soggiornoUI';
import { caricaDashboard, initDashboard } from './ui/dashboardUI';
import { caricaRubrica, initRubrica } from './ui/rubricaUI';
import {
  caricaIncassiH24,
  caricaProdottiH24,
  controllaDichiarazioneH24,
  controllaScorteH24,
  initH24
} from './ui/h24UI';
import { caricaDashboardH24, initDashboardH24 } from './ui/h24DashboardUI';
import { segnala } from './ui/segnalazioni';
import { initAccesso } from './ui/accessoUI';
import { amministratore, nomeUtente } from './services/auth';
import {
  attivaNotifiche,
  avvisaGliAltri,
  chiediPermessoUnaVolta,
  inviaNotifica,
  ripristinaIscrizione,
  statoNotifiche
} from './utils/notifiche';

// State Management
// La giornata e il turno di partenza dipendono dall'ora italiana: prima delle
// 10:00 si sta ancora chiudendo il pomeriggio del giorno precedente.
let selectedDate: string = getWorkingDateString();
let currentShift: ShiftKey = getActiveShift();
let saveDebounceTimer: number | null = null;
let lastSaveError: string | undefined;

// Voci dei due turni della giornata caricata
let shiftData: Record<ShiftKey, ShiftValues> = {
  mattina: emptyShiftValues(),
  pomeriggio: emptyShiftValues()
};

// Attività in elenco: restano finché non vengono svolte, non ripartono ogni giorno.
// Le completate escono dall'elenco dopo una settimana (vedi services/attivita)
let currentTodos: TodoItem[] = [];
let todoFilter: TodoFilter = 'da-fare';


// Attività già viste su questo dispositivo, per riconoscere quelle nuove
// aggiunte da qualcun altro
const CHIAVE_TODO_VISTI = 'tabaccheria_attivita_viste';
let controlloTodoTimer: number | null = null;

const ICONA_ELENCO = `<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`;
const ICONA_TUTTO_FATTO = `<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>`;

// DOM Elements
const dateDisplay = document.getElementById('entry-date-display') as HTMLOutputElement;

// Navigazione fra le giornate: la vede solo chi amministra
const inputDataAdmin = document.getElementById('input-data-admin') as HTMLInputElement;
const btnDataIndietro = document.getElementById('btn-data-indietro') as HTMLButtonElement;
const btnDataAvanti = document.getElementById('btn-data-avanti') as HTMLButtonElement;
const btnDataOggi = document.getElementById('btn-data-oggi') as HTMLButtonElement;

const inputContanti = document.getElementById('input-contanti') as HTMLInputElement;

// Voci registrate per le sole statistiche, fuori da ogni totale
const inputLogista = document.getElementById('input-logista') as HTMLInputElement;
const inputGrattaEVinci = document.getElementById('input-gratta-e-vinci') as HTMLInputElement;
const inputBar = document.getElementById('input-bar') as HTMLInputElement;
const inputTabacchi = document.getElementById('input-tabacchi') as HTMLInputElement;
const inputSisal = document.getElementById('input-sisal') as HTMLInputElement;
const inputMooney = document.getElementById('input-mooney') as HTMLInputElement;
const inputLis = document.getElementById('input-lis') as HTMLInputElement;
const inputPrinter = document.getElementById('input-printer') as HTMLInputElement;
const inputLottoEntrate = document.getElementById('input-lotto-entrate') as HTMLInputElement;
const inputLottoUscite = document.getElementById('input-lotto-uscite') as HTMLInputElement;
const inputFatture = document.getElementById('input-fatture') as HTMLInputElement;
const btnToggleSisalSign = document.getElementById('btn-toggle-sisal-sign') as HTMLButtonElement;
const btnToggleMooneySign = document.getElementById('btn-toggle-mooney-sign') as HTMLButtonElement;

// Campi che possono chiudere in negativo, con il rispettivo pulsante ±
const campiConSegno: Array<[HTMLInputElement, HTMLButtonElement]> = [];

const shiftTabs = Array.from(document.querySelectorAll('.shift-tab')) as HTMLButtonElement[];

const displayLottoAggio = document.getElementById('display-lotto-aggio') as HTMLSpanElement;
const lottoAggioRow = document.getElementById('lotto-aggio-row') as HTMLDivElement;
const displayLottoNetto = document.getElementById('display-lotto-netto') as HTMLSpanElement;
const displayTotaleTurnoMattina = document.getElementById('display-totale-turno-mattina') as HTMLSpanElement;
const displayTotaleTurnoPomeriggio = document.getElementById('display-totale-turno-pomeriggio') as HTMLSpanElement;
const rowTurnoPomeriggio = document.getElementById('row-turno-pomeriggio') as HTMLDivElement;
const labelTurnoMattina = document.getElementById('label-turno-mattina') as HTMLSpanElement;
const displayTotaleGiornata = document.getElementById('display-totale-giornata') as HTMLSpanElement;

const autoSaveBadge = document.getElementById('auto-save-badge') as HTMLDivElement;
const autoSaveText = document.getElementById('auto-save-text') as HTMLSpanElement;
const historyListContainer = document.getElementById('history-list-container') as HTMLDivElement;


// To-Do DOM Elements
const todoInputText = document.getElementById('todo-input-text') as HTMLInputElement;
const btnAddTodo = document.getElementById('btn-add-todo') as HTMLButtonElement;
const todoListContainer = document.getElementById('todo-list-container') as HTMLDivElement;
const todoProgressBadge = document.getElementById('todo-progress-badge') as HTMLSpanElement;
const todoProgressFill = document.getElementById('todo-progress-fill') as HTMLDivElement;
const btnClearCompleted = document.getElementById('btn-clear-completed') as HTMLButtonElement;
const todoFilterButtons = Array.from(document.querySelectorAll('.todo-filter')) as HTMLButtonElement[];

// Stampa Documento
const btnPrintDocument = document.getElementById('btn-print-document') as HTMLButtonElement;

// Notifiche
const btnNotifiche = document.getElementById('btn-notifiche') as HTMLButtonElement;
const notaNotifiche = document.getElementById('notifiche-nota') as HTMLParagraphElement;

/**
 * Apre una scheda dall'esterno del gestore dei menu.
 * Serve a far partire chi amministra dalla propria dashboard invece che
 * dalla pagina di inserimento, che a lui non serve per prima.
 */
let schedaDaAprire: ((tabId: string) => void) | null = null;

/**
 * Aggiorna il badge di stato dell'auto-salvataggio
 */
function updateSaveStatusBadge(status: SaveStatus) {
  if (!autoSaveBadge || !autoSaveText) return;

  autoSaveBadge.className = 'auto-save-badge';

  if (status === 'saving') {
    autoSaveBadge.classList.add('status-saving');
    autoSaveText.textContent = 'Salvataggio in corso...';
  } else if (status === 'saved') {
    autoSaveBadge.classList.add('status-saved');
    autoSaveText.textContent = 'Salvato sul cloud';
  } else if (status === 'saved-local') {
    // Non spacciare per salvato sul cloud un dato rimasto solo nel browser
    autoSaveBadge.classList.add('status-local');
    autoSaveText.textContent = 'Salvato solo su questo dispositivo';
    autoSaveBadge.title = lastSaveError || 'Supabase non raggiungibile';
  } else if (status === 'error') {
    autoSaveBadge.style.backgroundColor = '#FEE2E2';
    autoSaveBadge.style.color = '#991B1B';
    autoSaveText.textContent = 'Errore di salvataggio';
  } else {
    autoSaveBadge.classList.add('status-saved');
    autoSaveText.textContent = 'Auto-salvataggio attivo';
  }
}

/**
 * Sincronizza lo stato visivo dei pulsanti ± con il contenuto dei campi
 */
function updateSignStates() {
  campiConSegno.forEach(([campo, pulsante]) => {
    const negativo = campo.value.trim().startsWith('-');

    campo.classList.toggle('is-negative', negativo);

    if (pulsante) {
      pulsante.classList.toggle('is-negative', negativo);
      pulsante.setAttribute('aria-pressed', String(negativo));
    }
  });
}

/**
 * Inverte il segno di un campo importo (Sisal e Mooney possono chiudere in
 * negativo). Agisce sul testo e non sul numero, così la formattazione digitata
 * resta intatta ed è possibile premere ± a campo vuoto per poi scrivere le cifre.
 */
function toggleSign(campo: HTMLInputElement) {
  const raw = campo.value.trim();
  campo.value = raw.startsWith('-') ? raw.slice(1) : `-${raw}`;

  updateSignStates();
  campo.focus();
  triggerAutoSave();
}

/**
 * Legge le voci digitate nel form: appartengono sempre al turno selezionato
 */
function getShiftValuesFromInputs(): ShiftValues {
  return {
    contanti: parseInputValue(inputContanti.value),
    sisal: parseInputValue(inputSisal.value),
    mooney: parseInputValue(inputMooney.value),
    lis: parseInputValue(inputLis.value),
    printer: parseInputValue(inputPrinter.value),
    lotto_entrate: parseInputValue(inputLottoEntrate.value),
    lotto_uscite: parseInputValue(inputLottoUscite.value),
    fatture: parseInputValue(inputFatture.value),
    logista: parseInputValue(inputLogista.value),
    gratta_e_vinci: parseInputValue(inputGrattaEVinci.value),
    bar: parseInputValue(inputBar.value),
    tabacchi: parseInputValue(inputTabacchi.value)
  };
}

/**
 * Riversa nel form le voci di un turno
 */
function applyShiftValuesToInputs(values: ShiftValues) {
  inputContanti.value = formatInputValue(values.contanti);
  inputSisal.value = formatInputValue(values.sisal);
  inputMooney.value = formatInputValue(values.mooney);
  inputLis.value = formatInputValue(values.lis);
  inputPrinter.value = formatInputValue(values.printer);
  inputLottoEntrate.value = formatInputValue(values.lotto_entrate);
  inputLottoUscite.value = formatInputValue(values.lotto_uscite);
  inputFatture.value = formatInputValue(values.fatture);
  inputLogista.value = formatInputValue(values.logista);
  inputGrattaEVinci.value = formatInputValue(values.gratta_e_vinci);
  inputBar.value = formatInputValue(values.bar);
  inputTabacchi.value = formatInputValue(values.tabacchi);

  updateSignStates();
}

/**
 * Allinea lo stato in memoria a quanto digitato nel turno corrente
 */
function syncCurrentShiftFromInputs() {
  shiftData[currentShift] = getShiftValuesFromInputs();
}

/**
 * Costruisce i dati completi della giornata (entrambi i turni)
 */
function getDayExtras() {
  return {
  };
}

/**
 * Aggiorna il selettore turno e il testo di spiegazione
 */
function renderShiftSelector() {
  shiftTabs.forEach(tab => {
    const isActive = tab.getAttribute('data-shift') === currentShift;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  // Il foglio di stampa segue sempre il turno selezionato, non il click sul
  // pulsante: così anche una stampa da Ctrl+P esce con il solo turno aperto.
  document.querySelectorAll<HTMLElement>('#document-print-sheet .doc-shift-block').forEach(blocco => {
    blocco.classList.toggle('is-hidden', blocco.getAttribute('data-shift') !== currentShift);
  });

  // Nel turno mattina il secondo turno non esiste ancora: si mostra un solo
  // totale, e senza numero non c'è un "Turno 1" che rimandi a un turno assente.
  const soloMattina = currentShift === 'mattina';

  // L'aggio è un dato della giornata, calcolato sulla lettura cumulativa:
  // nel turno mattina non avrebbe significato, quindi non si mostra.
  if (lottoAggioRow) {
    lottoAggioRow.classList.toggle('is-hidden', soloMattina);
  }

  if (rowTurnoPomeriggio) {
    rowTurnoPomeriggio.classList.toggle('is-hidden', soloMattina);
  }
  if (labelTurnoMattina) {
    labelTurnoMattina.textContent = soloMattina ? 'Totale Turno' : 'Totale Turno 1';
  }
}

/**
 * Aggiorna i calcoli visivi a schermo (Lotto Netto, Aggio 8%, totali dei due turni)
 */
function updateCalculatedDisplays() {
  syncCurrentShiftFromInputs();
  const totals = calculateDayTotals(shiftData.mattina, shiftData.pomeriggio);
  const turnoCorrente = shiftData[currentShift];

  // Lotto Netto è il parziale del turno che si sta compilando, non della giornata:
  // a fine mattina deve mostrare le entrate meno le uscite di quel turno.
  if (displayLottoNetto) {
    displayLottoNetto.textContent = formatCurrency(
      calculateLottoNet(turnoCorrente.lotto_entrate, turnoCorrente.lotto_uscite)
    );
  }
  if (displayLottoAggio) {
    displayLottoAggio.textContent = formatCurrency(
      calculateLottoAggio(turnoCorrente.lotto_entrate)
    );
  }
  if (displayTotaleTurnoMattina) {
    displayTotaleTurnoMattina.textContent = formatCurrency(totals.totaleTurnoMattina);
  }
  if (displayTotaleTurnoPomeriggio) {
    displayTotaleTurnoPomeriggio.textContent = totals.pomeriggioCompilato
      ? formatCurrency(totals.totaleTurnoPomeriggio)
      : '—';
  }
  if (displayTotaleGiornata) {
    displayTotaleGiornata.textContent = formatCurrency(totals.totaleGiornata);
  }
}

/**
 * Cambia turno conservando quanto digitato in quello che si sta lasciando
 */
function switchShift(shift: ShiftKey) {
  if (shift === currentShift) return;

  syncCurrentShiftFromInputs();
  currentShift = shift;

  applyShiftValuesToInputs(shiftData[currentShift]);
  renderShiftSelector();
  updateCalculatedDisplays();
}

/**
 * Avvia l'auto-salvataggio con Debounce
 */
function triggerAutoSave() {
  updateCalculatedDisplays();
  updateSaveStatusBadge('saving');

  if (saveDebounceTimer !== null) {
    window.clearTimeout(saveDebounceTimer);
  }

  // Giornata, turno e valori si fissano adesso: se nel frattempo si cambia
  // data o turno, quanto è stato digitato deve finire dov'è stato scritto
  const dataDaSalvare = selectedDate;
  const turnoDaSalvare = currentShift;
  const vociDaSalvare = shiftData[currentShift];

  saveDebounceTimer = window.setTimeout(async () => {
    try {
      const result = await autoSaveDailyLog(
        dataDaSalvare,
        turnoDaSalvare,
        vociDaSalvare,
        getDayExtras()
      );
      lastSaveError = result.error;
      updateSaveStatusBadge(result.storage === 'supabase' ? 'saved' : 'saved-local');
      await renderHistorySidebar();
    } catch (err) {
      console.error('Errore durante l\'auto-salvataggio:', err);
      updateSaveStatusBadge('error');
    }
  }, 450);
}

/**
 * Prima giornata raggiungibile.
 *
 * Ai dipendenti resta ieri, il tempo di chiudere il pomeriggio precedente.
 * Chi amministra torna indietro quanto vuole: gli serve rivedere le chiusure
 * di mesi fa senza passare dal database.
 */
const PRIMA_GIORNATA = '2020-01-01';

function dataMinimaConsentita(): string {
  return amministratore() ? PRIMA_GIORNATA : getMinAllowedDateString();
}

/** Allinea i comandi di navigazione alla giornata aperta */
function aggiornaNavigazioneData(data: string) {
  if (!inputDataAdmin) return;

  const minima = dataMinimaConsentita();
  const massima = getMaxAllowedDateString();

  inputDataAdmin.min = minima;
  inputDataAdmin.max = massima;
  inputDataAdmin.value = data;

  if (btnDataIndietro) btnDataIndietro.disabled = data <= minima;
  if (btnDataAvanti) btnDataAvanti.disabled = data >= massima;
  if (btnDataOggi) btnDataOggi.disabled = data === getWorkingDateString();
}

/** Giornata spostata di N giorni, in formato YYYY-MM-DD */
function spostaGiornata(data: string, giorni: number): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  const d = new Date(anno, mese - 1, giorno);
  d.setDate(d.getDate() + giorni);

  return formatDateLocalISO(d);
}

/**
 * Carica una giornata specifica nel form (con vincoli min/max)
 */
async function loadDateIntoForm(dateStr: string) {
  const minDate = dataMinimaConsentita();
  const maxDate = getMaxAllowedDateString();

  // Applica vincoli di navigazione
  let targetDate = dateStr;
  if (targetDate < minDate) targetDate = minDate;
  if (targetDate > maxDate) targetDate = maxDate;

  selectedDate = targetDate;
  if (dateDisplay) {
    dateDisplay.textContent = formatDateItalian(targetDate);
  }

  aggiornaNavigazioneData(targetDate);

  const log = await fetchLogByDate(targetDate);

  shiftData = {
    mattina: log ? log.mattina : emptyShiftValues(),
    pomeriggio: log ? log.pomeriggio : emptyShiftValues()
  };

  if (log) {
  } else {
  }

  applyShiftValuesToInputs(shiftData[currentShift]);
  renderShiftSelector();
  updateCalculatedDisplays();
  renderTodoList();
  updateSaveStatusBadge('idle');

  await caricaInventario(targetDate);
}

/**
 * Attività visibili in base al filtro attivo
 */
function getTodosVisibili(): TodoItem[] {
  if (todoFilter === 'fatte') return currentTodos.filter(t => t.completed);
  return currentTodos.filter(t => !t.completed);
}

/**
 * Riga di firma di un'attività.
 *
 * Le attività scritte prima dell'accesso non hanno un autore vero ma la
 * dicitura generica: in quel caso resta la sola data.
 */
function firmaTodo(todo: TodoItem): string {
  const autore = (todo.createdBy || '').trim();
  const anonima = !autore || autore === 'Dipendente';

  return anonima
    ? escapeHtml(todo.createdAt)
    : `Scritta da ${escapeHtml(autore)} · ${escapeHtml(todo.createdAt)}`;
}

/**
 * Renderizza la lista delle attività, l'avanzamento e lo stato dei filtri
 */
function renderTodoList() {
  if (!todoListContainer) return;

  const totale = currentTodos.length;
  const fatte = currentTodos.filter(t => t.completed).length;

  if (todoProgressBadge) {
    todoProgressBadge.textContent = `${fatte} / ${totale}`;
  }
  if (todoProgressFill) {
    todoProgressFill.style.width = totale === 0 ? '0%' : `${Math.round((fatte / totale) * 100)}%`;
    todoProgressFill.classList.toggle('is-complete', totale > 0 && fatte === totale);
  }

  todoFilterButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter') === todoFilter);
  });

  if (btnClearCompleted) {
    btnClearCompleted.classList.toggle('is-hidden', fatte === 0);
  }

  const visibili = getTodosVisibili();

  if (visibili.length === 0) {
    const messaggio = todoFilter === 'fatte'
      ? "Nessuna attività completata nell'ultima settimana."
      : totale === 0
        ? 'Nessuna attività per oggi. Aggiungine una qui sopra.'
        : 'Tutto fatto.';

    todoListContainer.innerHTML = `
      <div class="empty-state">
        ${totale > 0 && todoFilter === 'da-fare' ? ICONA_TUTTO_FATTO : ICONA_ELENCO}
        <p class="empty-state-text">${messaggio}</p>
      </div>
    `;
    return;
  }

  todoListContainer.innerHTML = visibili.map(todo => `
    <div class="todo-item ${todo.completed ? 'is-done' : ''}" data-id="${todo.id}">
      <button
        type="button"
        class="todo-check"
        data-action="toggle"
        aria-pressed="${todo.completed}"
        aria-label="${todo.completed ? 'Segna da fare' : 'Segna completata'}"
      ></button>

      <div class="todo-body">
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <span class="todo-meta">${firmaTodo(todo)}</span>
      </div>

      <div class="todo-actions">
        <button type="button" class="todo-icon-btn" data-action="edit" aria-label="Modifica"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="todo-icon-btn is-danger" data-action="delete" aria-label="Elimina"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
    </div>
  `).join('');
}

/**
 * Sostituisce il testo di un'attività con un campo per modificarla al volo
 */
function avviaModificaTodo(riga: HTMLElement, todo: TodoItem) {
  const corpo = riga.querySelector('.todo-body');
  if (!corpo) return;

  corpo.innerHTML = '';

  const campo = document.createElement('input');
  campo.type = 'text';
  campo.className = 'todo-edit-input';
  campo.value = todo.text;
  corpo.appendChild(campo);
  campo.focus();
  campo.setSelectionRange(campo.value.length, campo.value.length);

  let concluso = false;

  const conferma = (salva: boolean) => {
    if (concluso) return;
    concluso = true;

    const testo = campo.value.trim();
    if (salva && testo && testo !== todo.text) {
      todo.text = testo;
      renderTodoList();
      modificaTesto(todo.id, testo);
    } else {
      renderTodoList();
    }
  };

  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter') conferma(true);
    if (e.key === 'Escape') conferma(false);
  });
  campo.addEventListener('blur', () => conferma(true));
}

/**
 * Un solo listener sul contenitore: le righe vengono ridisegnate spesso e
 * riagganciare un gestore per ogni pulsante a ogni render è superfluo.
 */
function setupTodoListDelegation() {
  if (!todoListContainer) return;

  todoListContainer.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.todo-item') as HTMLElement | null;
    const id = riga?.getAttribute('data-id');
    const todo = currentTodos.find(t => t.id === id);
    if (!riga || !todo) return;

    const azione = pulsante.getAttribute('data-action');

    if (azione === 'toggle') {
      todo.completed = !todo.completed;
      todo.completedAt = todo.completed ? new Date().toISOString() : undefined;
      renderTodoList();
      impostaCompletata(todo.id, todo.completed);
    } else if (azione === 'edit') {
      avviaModificaTodo(riga, todo);
    } else if (azione === 'delete') {
      currentTodos = currentTodos.filter(t => t.id !== id);
      renderTodoList();
      eliminaAttivita(todo.id);
    }
  });
}

/**
 * Aggiunge una nuova attività
 */
/**
 * Identificativi delle attività già viste su questo dispositivo, per giornata
 */
function todoVisti(): Set<string> {
  try {
    const raw = localStorage.getItem(CHIAVE_TODO_VISTI);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

function segnaTodoVisti(ids: string[]): void {
  try {
    localStorage.setItem(CHIAVE_TODO_VISTI, JSON.stringify(ids));
  } catch (err) {
    console.error('Errore salvataggio attività viste', err);
  }
}

function schedaAttiva(id: string): boolean {
  return document.getElementById(id)?.classList.contains('active') ?? false;
}

/**
 * Conta le attività comparse dopo l'ultima apertura della scheda e le segnala
 * sul menu. Senza un server che invii notifiche vere, questo è il modo per
 * accorgersi di quello che aggiunge un collega da un altro dispositivo.
 */
async function controllaNovitaTodo(avvisa = true) {
  try {
    const todos = await elencaAttivita();
    const visti = todoVisti();
    const nuovi = todos.filter(t => !visti.has(t.id));

    segnala('todos', nuovi.length);

    if (avvisa && nuovi.length > 0 && !schedaAttiva('tab-todos')) {
      const ultimo = nuovi[nuovi.length - 1];
      inviaNotifica(
        nuovi.length === 1 ? 'Nuova attività' : `${nuovi.length} nuove attività`,
        ultimo.text
      );
    }
  } catch (err) {
    console.warn('Controllo attività rimandato:', err);
  }
}

/**
 * Aprendo la scheda si riallinea l'elenco a quello salvato e si azzera il contatore
 */
async function apriSchedaTodo() {
  currentTodos = await elencaAttivita();

  segnaTodoVisti(currentTodos.map(t => t.id));
  segnala('todos', 0);
  renderTodoList();
}

/**
 * Mostra a che punto sono le notifiche e come attivarle.
 *
 * Serve un comando visibile: il permesso chiesto di nascosto alla prima
 * attività passa inosservato, e chi lo nega non ha più modo di tornare indietro.
 */
function aggiornaPulsanteNotifiche() {
  if (!btnNotifiche) return;

  const stato = statoNotifiche();

  btnNotifiche.hidden = stato === 'non-supportate';
  if (notaNotifiche) notaNotifiche.classList.add('is-hidden');

  if (stato === 'concesso') {
    btnNotifiche.textContent = 'Notifiche attive';
    btnNotifiche.classList.add('is-active');
    btnNotifiche.disabled = true;
    return;
  }

  btnNotifiche.classList.remove('is-active');
  btnNotifiche.disabled = false;
  btnNotifiche.textContent = 'Attiva notifiche';

  if (stato === 'negato' && notaNotifiche) {
    notaNotifiche.classList.remove('is-hidden');
    notaNotifiche.textContent =
      'Le notifiche risultano bloccate per questo sito. Vanno riattivate dalle ' +
      'impostazioni del browser: tocca il lucchetto accanto all\'indirizzo, ' +
      'poi Notifiche, e scegli Consenti.';
  }
}

async function premiAttivaNotifiche() {
  const stato = await attivaNotifiche();
  aggiornaPulsanteNotifiche();

  if (stato === 'concesso') {
    inviaNotifica('Notifiche attive', 'Da ora arrivano gli avvisi delle nuove attività.');
  }
}

async function addNewTodoItem() {
  const text = todoInputText?.value?.trim();
  if (!text) return;

  todoInputText.value = '';

  // Il permesso per le notifiche si può chiedere solo durante un gesto dell'utente
  chiediPermessoUnaVolta();

  // Chi ha fatto l'accesso firma quello che scrive: i colleghi devono
  // sapere da chi arriva l'attività
  const autore = nomeUtente();

  const voce = await aggiungiAttivita(text, autore || 'Dipendente');
  currentTodos.unshift(voce);

  // Il pallino si vede solo riaprendo l'app: la notifica raggiunge anche chi
  // non la sta guardando
  avvisaGliAltri(autore ? `Nuova attività da ${autore}` : 'Nuova attività', text);
  segnaTodoVisti(currentTodos.map(t => t.id));

  // Una nuova attività è da fare: col filtro sulle completate sparirebbe subito
  if (todoFilter === 'fatte') todoFilter = 'da-fare';

  renderTodoList();
}

/**
 * Helper per prevenire HTML Injection nei messaggi
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renderizza lo storico limitato a 2 giorni
 */
async function renderHistorySidebar() {
  if (!historyListContainer) return;

  const logs = await fetchEmployeeLogs();
  const tomorrowStr = getTomorrowDateString();

  if (logs.length === 0) {
    historyListContainer.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; color: var(--text-secondary); font-size: 0.85rem;">
        Nessun registro trovato negli ultimi 2 giorni.
      </div>
    `;
    return;
  }

  historyListContainer.innerHTML = logs.map(log => {
    const isTomorrow = log.date === tomorrowStr;
    const formatted = formatDateItalian(log.date);

    // I totali arrivano già calcolati dal database, ma in fallback LocalStorage
    // conviene ricalcolarli per non mostrare celle vuote
    const totals = calculateDayTotals(log.mattina, log.pomeriggio);

    return `
      <div class="history-card-item">
        <div class="history-card-header">
          <span class="history-date-tag">${formatted}</span>
          <span class="badge-tag ${isTomorrow ? 'tag-tomorrow' : 'tag-past'}">
            ${isTomorrow ? 'Giorno Seguente' : log.date}
          </span>
        </div>
        <div class="history-metrics-summary">
          <div class="metric-item">
            Turno 1 (Mattina)
            <span>${formatCurrency(totals.totaleTurnoMattina)}</span>
          </div>
          <div class="metric-item">
            Turno 2 (Pomeriggio)
            <span>${totals.pomeriggioCompilato ? formatCurrency(totals.totaleTurnoPomeriggio) : '—'}</span>
          </div>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          Totale Giornata: <strong style="color: var(--ferrari-red); font-family: var(--font-mono);">${formatCurrency(totals.totaleGiornata)}</strong>
        </div>
        <div class="history-card-actions">
          <button type="button" class="btn-icon-gear btn-edit-gear" data-date="${log.date}" title="Apri questa giornata">
            
          </button>
          <button type="button" class="btn-secondary-action btn-select-date" data-date="${log.date}">
            Carica Dati
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.btn-edit-gear, .btn-select-date').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const dateVal = target.getAttribute('data-date');
      if (dateVal) {
        loadDateIntoForm(dateVal);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

/**
 * Inizializza i gestori degli eventi
 */
function setupEventListeners() {
  // Menu di navigazione per schermi stretti
  const btnHamburgerMenu = document.getElementById('btn-hamburger-menu') as HTMLButtonElement;
  const hotdogMenuDrawer = document.getElementById('hotdog-menu-drawer') as HTMLDivElement;
  const hotdogBackdrop = document.getElementById('hotdog-backdrop') as HTMLDivElement;
  const btnCloseHotdog = document.getElementById('btn-close-hotdog') as HTMLButtonElement;

  function closeHotdogMenu() {
    if (hotdogMenuDrawer) hotdogMenuDrawer.classList.remove('is-open');
    if (hotdogBackdrop) hotdogBackdrop.classList.remove('is-open');
    if (btnHamburgerMenu) btnHamburgerMenu.classList.remove('is-active');
  }

  function toggleHotdogMenu() {
    if (!hotdogMenuDrawer) return;
    const isOpen = hotdogMenuDrawer.classList.toggle('is-open');
    if (hotdogBackdrop) hotdogBackdrop.classList.toggle('is-open', isOpen);
    if (btnHamburgerMenu) btnHamburgerMenu.classList.toggle('is-active', isOpen);
  }

  if (btnHamburgerMenu) btnHamburgerMenu.addEventListener('click', toggleHotdogMenu);
  if (btnCloseHotdog) btnCloseHotdog.addEventListener('click', closeHotdogMenu);
  if (hotdogBackdrop) hotdogBackdrop.addEventListener('click', closeHotdogMenu);

  // Gestore Cambio Navigation Tabs (Desktop & Hot-Dog Menu Items)
  const tabButtons = document.querySelectorAll('.nav-tab-item, .hotdog-menu-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const targetTabId = target.getAttribute('data-tab');
      if (!targetTabId) return;

      apriScheda(targetTabId);
      closeHotdogMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  function apriScheda(targetTabId: string) {
    tabButtons.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === targetTabId);
    });

    tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === targetTabId);
    });

    if (targetTabId === 'tab-todos') apriSchedaTodo();
    if (targetTabId === 'tab-soggiorno') caricaSoggiorni();
    if (targetTabId === 'tab-rubrica') caricaRubrica();
    if (targetTabId === 'tab-dashboard') caricaDashboard();
    if (targetTabId === 'tab-h24-dashboard') caricaDashboardH24();
    if (targetTabId === 'tab-h24-prodotti') caricaProdottiH24();
    if (targetTabId === 'tab-h24-incassi') caricaIncassiH24();
  }

  schedaDaAprire = apriScheda;

  // Navigazione fra le giornate, riservata a chi amministra
  btnDataIndietro?.addEventListener('click', () => {
    loadDateIntoForm(spostaGiornata(selectedDate, -1));
  });

  btnDataAvanti?.addEventListener('click', () => {
    loadDateIntoForm(spostaGiornata(selectedDate, 1));
  });

  btnDataOggi?.addEventListener('click', () => {
    loadDateIntoForm(getWorkingDateString());
  });

  inputDataAdmin?.addEventListener('change', () => {
    // Un campo data svuotato non è una richiesta di andare da nessuna parte
    if (inputDataAdmin.value) loadDateIntoForm(inputDataAdmin.value);
    else aggiornaNavigazioneData(selectedDate);
  });

  const allInputs = [
    inputContanti, inputSisal, inputMooney, inputLis, inputPrinter,
    inputLottoEntrate, inputLottoUscite, inputFatture,
    inputLogista, inputGrattaEVinci, inputBar, inputTabacchi
  ];

  allInputs.forEach(input => {
    if (input) {
      input.addEventListener('input', triggerAutoSave);
    }
  });

  // Cambio turno manuale (mattina / pomeriggio)
  shiftTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const shift = tab.getAttribute('data-shift') as ShiftKey | null;
      if (shift === 'mattina' || shift === 'pomeriggio') {
        switchShift(shift);
      }
    });
  });

  // Toggle segno ± sul campo Sisal (indispensabile da telefono: il tastierino
  // decimale di iOS e Android non ha il tasto meno)
  campiConSegno.push([inputSisal, btnToggleSisalSign], [inputMooney, btnToggleMooneySign]);

  campiConSegno.forEach(([campo, pulsante]) => {
    pulsante?.addEventListener('click', () => toggleSign(campo));
    campo.addEventListener('input', updateSignStates);
  });

  // Eventi To-Do Task
  btnAddTodo.addEventListener('click', addNewTodoItem);
  todoInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addNewTodoItem();
    }
  });

  setupTodoListDelegation();

  todoFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      todoFilter = (btn.getAttribute('data-filter') as TodoFilter) || 'da-fare';
      renderTodoList();
    });
  });

  if (btnClearCompleted) {
    btnClearCompleted.addEventListener('click', () => {
      currentTodos = currentTodos.filter(t => !t.completed);
      svuotaCompletate();
      renderTodoList();
      triggerAutoSave();
    });
  }

  // Stampa diretta del documento contabile, senza passare da un'anteprima
  if (btnPrintDocument) {
    btnNotifiche?.addEventListener('click', premiAttivaNotifiche);

  btnPrintDocument.addEventListener('click', () => {
      fillPrintDocument();
      window.print();
    });
  }
}

/**
 * Compila il foglio contabile con i valori correnti del form.
 * Il foglio resta nascosto a schermo e viene reso visibile solo da @media print.
 */
function fillPrintDocument() {
  syncCurrentShiftFromInputs();

  const { mattina, pomeriggio } = shiftData;
  const totals = calculateDayTotals(mattina, pomeriggio);

  const docDateDisplay = document.getElementById('doc-date-display');
  if (docDateDisplay) {
    docDateDisplay.textContent = `Data: ${formatDateItalian(selectedDate)}`;
  }

  const valori: Record<string, number | null> = {
    'totale.turno1': totals.totaleTurnoMattina,
    // Il turno 2 è una differenza: ha senso solo dopo la chiusura del pomeriggio
    'totale.turno2': totals.pomeriggioCompilato ? totals.totaleTurnoPomeriggio : null,
    'totale.giornata': totals.totaleGiornata,

    'mattina.lotto_netto': calculateLottoNet(mattina.lotto_entrate, mattina.lotto_uscite),
    'mattina.lotto_aggio': calculateLottoAggio(mattina.lotto_entrate),
    'pomeriggio.lotto_netto': totals.pomeriggioCompilato
      ? calculateLottoNet(pomeriggio.lotto_entrate, pomeriggio.lotto_uscite)
      : null,
    'pomeriggio.lotto_aggio': totals.pomeriggioCompilato
      ? calculateLottoAggio(pomeriggio.lotto_entrate)
      : null
  };

  (Object.keys(mattina) as Array<keyof ShiftValues>).forEach(voce => {
    valori[`mattina.${voce}`] = mattina[voce];
    valori[`pomeriggio.${voce}`] = totals.pomeriggioCompilato ? pomeriggio[voce] : null;
  });

  document.querySelectorAll<HTMLElement>('#document-print-sheet [data-doc]').forEach(cell => {
    const chiave = cell.getAttribute('data-doc');
    if (!chiave) return;

    const valore = valori[chiave];
    cell.textContent = valore === null || valore === undefined ? '—' : formatCurrency(valore);
  });
}

/**
 * Inizializzazione dell'Applicazione Web
 */
async function initApp() {
  setupEventListeners();
  ripristinaIscrizione();
  aggiornaPulsanteNotifiche();
  initInventario();
  initSoggiorno();
  initRubrica();

  // Scopre le voci riservate: senza admin nel profilo non c'è niente da mostrare
  initDashboard();

  // I distributori sono roba di chi amministra: a un dipendente non deve
  // nemmeno accendersi il pallino di una scheda che non può aprire
  if (amministratore()) {
    initH24();
    initDashboardH24();

    // Chi amministra apre l'app per guardare come va, non per inserire i turni
    schedaDaAprire?.('tab-dashboard');
  }

  await loadDateIntoForm(selectedDate);
  await renderHistorySidebar();
  await caricaSoggiorni();
  await caricaRubrica();

  // Promemoria della dichiarazione e pallino delle scorte si fanno vivi qui:
  // è il modo per accorgersene senza dover aprire le schede
  if (amministratore()) {
    await controllaDichiarazioneH24();
    await controllaScorteH24();
  }
  currentTodos = await elencaAttivita();
  segnaTodoVisti(currentTodos.map(t => t.id));
  renderTodoList();
  await controllaNovitaTodo(false);

  // Un collega può aggiungere un'attività mentre l'app è già aperta
  if (controlloTodoTimer !== null) window.clearInterval(controlloTodoTimer);
  controlloTodoTimer = window.setInterval(() => controllaNovitaTodo(), 60000);
}

// Start application
// L'app parte solo a accesso concesso: prima di allora la schermata di
// accesso copre tutto e nessuna pagina viene popolata.
initAccesso(() => { initApp(); });

