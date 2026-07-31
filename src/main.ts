import './style.css';
import { SaveStatus, ShiftKey, ShiftValues, TodoFilter, TodoItem } from './types';
import {
  calculateDayTotals,
  calculateLottoAggio,
  calculateLottoNet,
  emptyShiftValues,
  formatCurrency,
  formatDateItalian,
  formatInputValue,
  getActiveShift,
  getMaxAllowedDateString,
  getMinAllowedDateString,
  getTomorrowDateString,
  getWorkingDateString,
  parseInputValue
} from './utils/calculations';
import { autoSaveDailyLog, fetchEmployeeLogs, fetchLogByDate } from './services/supabase';
import { caricaInventario, initInventario } from './ui/inventarioUI';

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

// Task della giornata caricata
let currentTodos: TodoItem[] = [];
let todoFilter: TodoFilter = 'tutte';

// Il solo Date.now() non basta: due attività aggiunte nello stesso millisecondo
// riceverebbero lo stesso id, e cancellandone una sparirebbero entrambe.
let todoSeq = 0;

// DOM Elements
const dateDisplay = document.getElementById('entry-date-display') as HTMLOutputElement;

const inputTabacchi = document.getElementById('input-tabacchi') as HTMLInputElement;
const inputSisal = document.getElementById('input-sisal') as HTMLInputElement;
const inputMooney = document.getElementById('input-mooney') as HTMLInputElement;
const inputLis = document.getElementById('input-lis') as HTMLInputElement;
const inputPrinter = document.getElementById('input-printer') as HTMLInputElement;
const inputLottoEntrate = document.getElementById('input-lotto-entrate') as HTMLInputElement;
const inputLottoUscite = document.getElementById('input-lotto-uscite') as HTMLInputElement;
const inputFatture = document.getElementById('input-fatture') as HTMLInputElement;
const btnToggleSisalSign = document.getElementById('btn-toggle-sisal-sign') as HTMLButtonElement;

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
    autoSaveText.textContent = 'Salvato sul cloud ✓';
  } else if (status === 'saved-local') {
    // Non spacciare per salvato sul cloud un dato rimasto solo nel browser
    autoSaveBadge.classList.add('status-local');
    autoSaveText.textContent = 'Salvato solo su questo dispositivo ⚠️';
    autoSaveBadge.title = lastSaveError || 'Supabase non raggiungibile';
  } else if (status === 'error') {
    autoSaveBadge.style.backgroundColor = '#FEE2E2';
    autoSaveBadge.style.color = '#991B1B';
    autoSaveText.textContent = 'Errore salvataggio ⚠️';
  } else {
    autoSaveBadge.classList.add('status-saved');
    autoSaveText.textContent = 'Auto-salvataggio attivo';
  }
}

/**
 * Sincronizza lo stato visivo del toggle ± con il contenuto attuale del campo Sisal
 */
function updateSisalSignState() {
  const isNegative = inputSisal.value.trim().startsWith('-');

  inputSisal.classList.toggle('is-negative', isNegative);

  if (btnToggleSisalSign) {
    btnToggleSisalSign.classList.toggle('is-negative', isNegative);
    btnToggleSisalSign.setAttribute('aria-pressed', String(isNegative));
  }
}

/**
 * Inverte il segno del campo Sisal (a volte la giornata Sisal chiude in negativo).
 * Agisce sul testo e non sul numero, così la formattazione digitata resta intatta
 * ed è possibile premere ± a campo vuoto per poi scrivere le cifre.
 */
function toggleSisalSign() {
  const raw = inputSisal.value.trim();
  inputSisal.value = raw.startsWith('-') ? raw.slice(1) : `-${raw}`;

  updateSisalSignState();
  inputSisal.focus();
  triggerAutoSave();
}

/**
 * Legge le voci digitate nel form: appartengono sempre al turno selezionato
 */
function getShiftValuesFromInputs(): ShiftValues {
  return {
    tabacchi: parseInputValue(inputTabacchi.value),
    sisal: parseInputValue(inputSisal.value),
    mooney: parseInputValue(inputMooney.value),
    lis: parseInputValue(inputLis.value),
    printer: parseInputValue(inputPrinter.value),
    lotto_entrate: parseInputValue(inputLottoEntrate.value),
    lotto_uscite: parseInputValue(inputLottoUscite.value),
    fatture: parseInputValue(inputFatture.value)
  };
}

/**
 * Riversa nel form le voci di un turno
 */
function applyShiftValuesToInputs(values: ShiftValues) {
  inputTabacchi.value = formatInputValue(values.tabacchi);
  inputSisal.value = formatInputValue(values.sisal);
  inputMooney.value = formatInputValue(values.mooney);
  inputLis.value = formatInputValue(values.lis);
  inputPrinter.value = formatInputValue(values.printer);
  inputLottoEntrate.value = formatInputValue(values.lotto_entrate);
  inputLottoUscite.value = formatInputValue(values.lotto_uscite);
  inputFatture.value = formatInputValue(values.fatture);

  updateSisalSignState();
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
    todos: currentTodos
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

  saveDebounceTimer = window.setTimeout(async () => {
    try {
      const result = await autoSaveDailyLog(
        selectedDate,
        currentShift,
        shiftData[currentShift],
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
 * Carica una giornata specifica nel form (con vincoli min/max)
 */
async function loadDateIntoForm(dateStr: string) {
  const minDate = getMinAllowedDateString();
  const maxDate = getMaxAllowedDateString();

  // Applica vincoli di navigazione
  let targetDate = dateStr;
  if (targetDate < minDate) targetDate = minDate;
  if (targetDate > maxDate) targetDate = maxDate;

  selectedDate = targetDate;
  if (dateDisplay) {
    dateDisplay.textContent = formatDateItalian(targetDate);
  }

  const log = await fetchLogByDate(targetDate);

  shiftData = {
    mattina: log ? log.mattina : emptyShiftValues(),
    pomeriggio: log ? log.pomeriggio : emptyShiftValues()
  };

  if (log) {
    currentTodos = log.todos || getDefaultTodos();
  } else {
    currentTodos = getDefaultTodos();
  }

  applyShiftValuesToInputs(shiftData[currentShift]);
  renderShiftSelector();
  updateCalculatedDisplays();
  renderTodoList();
  updateSaveStatusBadge('idle');

  await caricaInventario(targetDate);
}

/**
 * Genera i task di default per il punto vendita tabaccheria se non ancora definiti
 */
function getDefaultTodos(): TodoItem[] {
  return [
    { id: 'todo-1', text: 'Verifica giacenza rotoli di carta cassa e Sisal', completed: false, createdBy: 'Sistema', createdAt: '08:00' },
    { id: 'todo-2', text: 'Controllo cassetto valori bollati e francobolli', completed: false, createdBy: 'Sistema', createdAt: '08:00' },
    { id: 'todo-3', text: 'Chiusura contabile serale terminale Lotto e Lis', completed: false, createdBy: 'Sistema', createdAt: '19:30' }
  ];
}

/**
 * Attività visibili in base al filtro attivo
 */
function getTodosVisibili(): TodoItem[] {
  if (todoFilter === 'da-fare') return currentTodos.filter(t => !t.completed);
  if (todoFilter === 'fatte') return currentTodos.filter(t => t.completed);
  return currentTodos;
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
    const messaggio = totale === 0
      ? 'Nessuna attività per oggi. Aggiungine una qui sopra.'
      : todoFilter === 'fatte'
        ? 'Nessuna attività completata.'
        : 'Tutto fatto.';

    todoListContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">${totale > 0 && todoFilter === 'da-fare' ? '🎉' : '📝'}</span>
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
        <span class="todo-meta">${escapeHtml(todo.createdBy)} · ${escapeHtml(todo.createdAt)}</span>
      </div>

      <div class="todo-actions">
        <button type="button" class="todo-icon-btn" data-action="edit" aria-label="Modifica">✎</button>
        <button type="button" class="todo-icon-btn is-danger" data-action="delete" aria-label="Elimina">×</button>
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
      triggerAutoSave();
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
      renderTodoList();
      triggerAutoSave();
    } else if (azione === 'edit') {
      avviaModificaTodo(riga, todo);
    } else if (azione === 'delete') {
      currentTodos = currentTodos.filter(t => t.id !== id);
      renderTodoList();
      triggerAutoSave();
    }
  });
}

/**
 * Aggiunge una nuova attività
 */
function addNewTodoItem() {
  const text = todoInputText?.value?.trim();
  if (!text) return;

  const orario = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  currentTodos.push({
    id: `todo-${Date.now()}-${++todoSeq}`,
    text,
    completed: false,
    createdBy: 'Dipendente',
    createdAt: orario
  });

  todoInputText.value = '';

  // Una nuova attività è da fare: col filtro sulle completate sparirebbe subito
  if (todoFilter === 'fatte') todoFilter = 'tutte';

  renderTodoList();
  triggerAutoSave();
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
          <button type="button" class="btn-icon-gear btn-edit-gear" data-date="${log.date}" title="Modifica questa giornata (Rotella)">
            ⚙️
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
  // Hot-Dog Menu (Hamburger 🍔) DOM Elements & Toggle Functions
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

      tabButtons.forEach(b => {
        if (b.getAttribute('data-tab') === targetTabId) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      tabPanes.forEach(pane => {
        if (pane.id === targetTabId) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });

      closeHotdogMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  const allInputs = [
    inputTabacchi, inputSisal, inputLis, inputPrinter,
    inputLottoEntrate, inputLottoUscite, inputFatture
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
  if (btnToggleSisalSign) {
    btnToggleSisalSign.addEventListener('click', toggleSisalSign);
  }
  inputSisal.addEventListener('input', updateSisalSignState);

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
      todoFilter = (btn.getAttribute('data-filter') as TodoFilter) || 'tutte';
      renderTodoList();
    });
  });

  if (btnClearCompleted) {
    btnClearCompleted.addEventListener('click', () => {
      currentTodos = currentTodos.filter(t => !t.completed);
      renderTodoList();
      triggerAutoSave();
    });
  }

  // Stampa diretta del documento contabile, senza passare da un'anteprima
  if (btnPrintDocument) {
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
  initInventario();
  await loadDateIntoForm(selectedDate);
  await renderHistorySidebar();
}

// Start application
initApp();

