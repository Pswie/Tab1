import './style.css';
import { NoteItem, SaveStatus, ShiftKey, ShiftValues, TodoItem } from './types';
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
import { requestNotificationPermission, sendWebNotification } from './utils/notifications';

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

// In-memory Chat Notes & To-Do State per date
let currentChatNotes: NoteItem[] = [];
let currentTodos: TodoItem[] = [];

// DOM Elements
const dateInput = document.getElementById('entry-date-input') as HTMLInputElement;
const btnPrevDay = document.getElementById('btn-prev-day') as HTMLButtonElement;
const btnNextDay = document.getElementById('btn-next-day') as HTMLButtonElement;

const inputTabacchi = document.getElementById('input-tabacchi') as HTMLInputElement;
const inputSisal = document.getElementById('input-sisal') as HTMLInputElement;
const inputLis = document.getElementById('input-lis') as HTMLInputElement;
const inputPrinter = document.getElementById('input-printer') as HTMLInputElement;
const inputLottoEntrate = document.getElementById('input-lotto-entrate') as HTMLInputElement;
const inputLottoUscite = document.getElementById('input-lotto-uscite') as HTMLInputElement;
const inputFatture = document.getElementById('input-fatture') as HTMLInputElement;
const btnToggleSisalSign = document.getElementById('btn-toggle-sisal-sign') as HTMLButtonElement;

const shiftTabs = Array.from(document.querySelectorAll('.shift-tab')) as HTMLButtonElement[];

const displayLottoAggio = document.getElementById('display-lotto-aggio') as HTMLSpanElement;
const displayLottoNetto = document.getElementById('display-lotto-netto') as HTMLSpanElement;
const displayTotaleTurnoMattina = document.getElementById('display-totale-turno-mattina') as HTMLSpanElement;
const displayTotaleTurnoPomeriggio = document.getElementById('display-totale-turno-pomeriggio') as HTMLSpanElement;
const rowTurnoPomeriggio = document.getElementById('row-turno-pomeriggio') as HTMLDivElement;
const labelTurnoMattina = document.getElementById('label-turno-mattina') as HTMLSpanElement;
const displayTotaleGiornata = document.getElementById('display-totale-giornata') as HTMLSpanElement;

const autoSaveBadge = document.getElementById('auto-save-badge') as HTMLDivElement;
const autoSaveText = document.getElementById('auto-save-text') as HTMLSpanElement;
const historyListContainer = document.getElementById('history-list-container') as HTMLDivElement;

// WhatsApp Chat DOM Elements
const waAuthorInput = document.getElementById('wa-author-input') as HTMLInputElement;
const waChatMessages = document.getElementById('wa-chat-messages') as HTMLDivElement;
const waChatInput = document.getElementById('wa-chat-input') as HTMLInputElement;
const waBtnSend = document.getElementById('wa-btn-send') as HTMLButtonElement;
const btnRequestNotifications = document.getElementById('btn-request-notifications') as HTMLButtonElement;

// To-Do DOM Elements
const todoInputText = document.getElementById('todo-input-text') as HTMLInputElement;
const btnAddTodo = document.getElementById('btn-add-todo') as HTMLButtonElement;
const todoListContainer = document.getElementById('todo-list-container') as HTMLDivElement;
const todoProgressBadge = document.getElementById('todo-progress-badge') as HTMLSpanElement;

// Stampa Documento
const btnPrintDocument = document.getElementById('btn-print-document') as HTMLButtonElement;

/**
 * Aggiorna i limiti min/max e lo stato attivo/disattivato delle frecce ◄ e ►
 */
function updateDateNavBounds() {
  const minDate = getMinAllowedDateString(); // Max 2 giorni indietro
  const maxDate = getMaxAllowedDateString(); // Non oltre oggi

  if (dateInput) {
    dateInput.min = minDate;
    dateInput.max = maxDate;
  }

  if (btnPrevDay) {
    btnPrevDay.disabled = selectedDate <= minDate;
  }

  if (btnNextDay) {
    btnNextDay.disabled = selectedDate >= maxDate;
  }
}

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
    chat_notes: currentChatNotes,
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

  // Nel turno mattina il secondo turno non esiste ancora: si mostra un solo
  // totale, e senza numero non c'è un "Turno 1" che rimandi a un turno assente.
  const soloMattina = currentShift === 'mattina';

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

  if (displayLottoAggio) {
    displayLottoAggio.textContent = formatCurrency(totals.lottoAggio);
  }
  if (displayLottoNetto) {
    displayLottoNetto.textContent = formatCurrency(totals.lottoNetto);
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
  dateInput.value = targetDate;
  updateDateNavBounds();

  const log = await fetchLogByDate(targetDate);

  shiftData = {
    mattina: log ? log.mattina : emptyShiftValues(),
    pomeriggio: log ? log.pomeriggio : emptyShiftValues()
  };

  if (log) {
    currentChatNotes = log.chat_notes || [];
    currentTodos = log.todos || getDefaultTodos();
  } else {
    currentChatNotes = [];
    currentTodos = getDefaultTodos();
  }

  applyShiftValuesToInputs(shiftData[currentShift]);
  renderShiftSelector();
  updateCalculatedDisplays();
  renderWhatsAppChatNotes();
  renderTodoList();
  updateSaveStatusBadge('idle');
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
 * Renderizza le note di servizio in stile chat WhatsApp
 */
function renderWhatsAppChatNotes() {
  if (!waChatMessages) return;

  if (currentChatNotes.length === 0) {
    waChatMessages.innerHTML = `
      <div style="text-align: center; color: #667781; font-size: 0.82rem; margin: auto;">
        Nessuna nota ancora pubblicata per questa giornata.<br/>Scrivi un messaggio qui sotto per lasciare un appunto ai colleghi!
      </div>
    `;
    return;
  }

  const currentUser = waAuthorInput?.value?.trim() || 'Dipendente';

  waChatMessages.innerHTML = currentChatNotes.map(note => {
    const isMine = note.author.toLowerCase() === currentUser.toLowerCase() || note.isMine;
    return `
      <div class="wa-bubble ${isMine ? 'bubble-mine' : 'bubble-other'}">
        <div class="wa-bubble-author">
          <span>${note.author}</span>
          <span class="wa-bubble-time">${note.timestamp}</span>
        </div>
        <div>${escapeHtml(note.text)}</div>
      </div>
    `;
  }).join('');

  // Scroll automatico in fondo alla chat
  waChatMessages.scrollTop = waChatMessages.scrollHeight;
}

/**
 * Invia una nuova nota in stile WhatsApp con Notifica Push
 */
function sendNewChatNote() {
  const text = waChatInput?.value?.trim();
  const author = waAuthorInput?.value?.trim() || 'Dipendente';

  if (!text) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  const newNote: NoteItem = {
    id: `note-${Date.now()}`,
    author: author,
    text: text,
    timestamp: timeStr,
    date: selectedDate,
    isMine: true
  };

  currentChatNotes.push(newNote);
  waChatInput.value = '';
  renderWhatsAppChatNotes();

  // Invia Notifica Web del Browser
  sendWebNotification('💬 Nuova Nota Tabaccheria', `${author}: ${text}`);

  triggerAutoSave();
}

/**
 * Renderizza la lista di attività Task To-Do
 */
function renderTodoList() {
  if (!todoListContainer) return;

  const completedCount = currentTodos.filter(t => t.completed).length;
  if (todoProgressBadge) {
    todoProgressBadge.textContent = `${completedCount} di ${currentTodos.length} completati`;
    todoProgressBadge.className = completedCount === currentTodos.length && currentTodos.length > 0
      ? 'badge-tag tag-tomorrow'
      : 'badge-tag tag-past';
  }

  if (currentTodos.length === 0) {
    todoListContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-secondary); font-size: 0.85rem; padding: 1rem;">
        Nessuna attività presente. Aggiungine una dal campo in alto!
      </div>
    `;
    return;
  }

  todoListContainer.innerHTML = currentTodos.map(todo => `
    <div class="todo-item-card ${todo.completed ? 'completed' : ''}">
      <label class="todo-checkbox-label">
        <input type="checkbox" class="todo-checkbox" data-id="${todo.id}" ${todo.completed ? 'checked' : ''} />
        <span class="todo-text">${escapeHtml(todo.text)}</span>
      </label>
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <span class="todo-meta-tag">${todo.createdBy} • ${todo.createdAt}</span>
        <button type="button" class="btn-todo-delete" data-id="${todo.id}" title="Elimina Task">&times;</button>
      </div>
    </div>
  `).join('');

  // Listener per toggle completato
  todoListContainer.querySelectorAll('.todo-checkbox').forEach(input => {
    input.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const id = target.getAttribute('data-id');
      const item = currentTodos.find(t => t.id === id);
      if (item) {
        item.completed = target.checked;
        renderTodoList();
        triggerAutoSave();
      }
    });
  });

  // Listener per eliminazione task
  todoListContainer.querySelectorAll('.btn-todo-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const id = target.getAttribute('data-id');
      currentTodos = currentTodos.filter(t => t.id !== id);
      renderTodoList();
      triggerAutoSave();
    });
  });
}

/**
 * Aggiunge un nuovo task To-Do
 */
function addNewTodoItem() {
  const text = todoInputText?.value?.trim();
  const author = waAuthorInput?.value?.trim() || 'Dipendente';

  if (!text) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  const newTodo: TodoItem = {
    id: `todo-${Date.now()}`,
    text: text,
    completed: false,
    createdBy: author,
    createdAt: timeStr
  };

  currentTodos.push(newTodo);
  todoInputText.value = '';
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

  dateInput.addEventListener('change', () => {
    if (dateInput.value) {
      loadDateIntoForm(dateInput.value);
    }
  });

  // Navigazione Data con Frecce ◄ e ► (Max 2 Giorni Indietro, Max Giorno Corrente)
  if (btnPrevDay) {
    btnPrevDay.addEventListener('click', () => {
      const current = new Date(selectedDate);
      current.setDate(current.getDate() - 1);
      const newDateStr = formatDateLocalISO(current);
      loadDateIntoForm(newDateStr);
    });
  }

  if (btnNextDay) {
    btnNextDay.addEventListener('click', () => {
      const current = new Date(selectedDate);
      current.setDate(current.getDate() + 1);
      const newDateStr = formatDateLocalISO(current);
      loadDateIntoForm(newDateStr);
    });
  }

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

  // Eventi Chat WhatsApp Note
  waBtnSend.addEventListener('click', sendNewChatNote);
  waChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendNewChatNote();
    }
  });

  // Notifiche Web Permessi
  btnRequestNotifications.addEventListener('click', async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      btnRequestNotifications.textContent = '✓ Notifiche Attive';
      btnRequestNotifications.style.borderColor = '#10B981';
      btnRequestNotifications.style.color = '#047857';
    } else {
      alert('Notifiche non consentite o disabilitate dal browser.');
    }
  });

  // Eventi To-Do Task
  btnAddTodo.addEventListener('click', addNewTodoItem);
  todoInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addNewTodoItem();
    }
  });

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

  // Si stampa solo il turno aperto: il pulsante segue il turno selezionato
  document.querySelectorAll<HTMLElement>('#document-print-sheet .doc-shift-block').forEach(blocco => {
    blocco.classList.toggle('is-hidden', blocco.getAttribute('data-shift') !== currentShift);
  });

  const valori: Record<string, number | null> = {
    'totale.turno1': totals.totaleTurnoMattina,
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
  dateInput.value = selectedDate;
  setupEventListeners();
  await loadDateIntoForm(selectedDate);
  await renderHistorySidebar();
}

// Start application
initApp();

