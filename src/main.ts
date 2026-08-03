import './style.css';
import { SaveStatus, ShiftKey, ShiftValues, TodoFilter, TodoItem, VoceFattura } from './types';
import {
  calculateDayTotals,
  calculateLottoAggio,
  calculateLottoNet,
  calculateNetMovement,
  emptyShiftValues,
  formatCurrency,
  formatDateItalian,
  formatDateLocalISO,
  formatInputValue,
  formatSignedCurrency,
  getActiveShift,
  getMaxAllowedDateString,
  getMinAllowedDateString,
  getTomorrowDateString,
  getWorkingDateString,
  parseInputValue,
  totaleFatture,
  vociFattura
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
import { caricaTurni, initTurni } from './ui/turniUI';
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
const inputSisalEntrate = document.getElementById('input-sisal-entrate') as HTMLInputElement;
const inputSisalUscite = document.getElementById('input-sisal-uscite') as HTMLInputElement;
const inputMooney = document.getElementById('input-mooney') as HTMLInputElement;
const inputLis = document.getElementById('input-lis') as HTMLInputElement;
const inputPrinter = document.getElementById('input-printer') as HTMLInputElement;
const inputLottoEntrate = document.getElementById('input-lotto-entrate') as HTMLInputElement;
const inputLottoUscite = document.getElementById('input-lotto-uscite') as HTMLInputElement;
// Fatture: si scrivono una per una e la loro somma e' quella che fa totale
const inputFatturaNome = document.getElementById('input-fattura-nome') as HTMLInputElement;
const inputFatturaImporto = document.getElementById('input-fattura-importo') as HTMLInputElement;
const btnFatturaAggiungi = document.getElementById('btn-fattura-aggiungi') as HTMLButtonElement;
const listaFatture = document.getElementById('fatture-lista') as HTMLDivElement;
const avvisoFatture = document.getElementById('fatture-avviso') as HTMLParagraphElement;
const displayFattureTotale = document.getElementById('display-fatture-totale') as HTMLSpanElement;

// Controllo di cassa: fuori dal totale del turno, dentro al conto dello scarto
const inputEffettivo = document.getElementById('input-effettivo') as HTMLInputElement;
const inputB = document.getElementById('input-b') as HTMLInputElement;
const btnToggleMooneySign = document.getElementById('btn-toggle-mooney-sign') as HTMLButtonElement;

// Campi che possono chiudere in negativo, con il rispettivo pulsante ±
const campiConSegno: Array<[HTMLInputElement, HTMLButtonElement]> = [];

const shiftTabs = Array.from(document.querySelectorAll('.shift-tab')) as HTMLButtonElement[];

const displayLottoAggio = document.getElementById('display-lotto-aggio') as HTMLSpanElement;
const lottoAggioRow = document.getElementById('lotto-aggio-row') as HTMLDivElement;
const displayLottoNetto = document.getElementById('display-lotto-netto') as HTMLSpanElement;
const displaySisalNetto = document.getElementById('display-sisal-netto') as HTMLSpanElement;
const displayTotaleTurnoMattina = document.getElementById('display-totale-turno-mattina') as HTMLSpanElement;
const displayTotaleTurnoPomeriggio = document.getElementById('display-totale-turno-pomeriggio') as HTMLSpanElement;
const rowTurnoPomeriggio = document.getElementById('row-turno-pomeriggio') as HTMLDivElement;
const labelTurnoMattina = document.getElementById('label-turno-mattina') as HTMLSpanElement;

// Controllo di cassa dei due turni
const displayEffettivoMattina = document.getElementById('display-effettivo-mattina') as HTMLSpanElement;
const displayBMattina = document.getElementById('display-b-mattina') as HTMLSpanElement;
const displayDifferenzaMattina = document.getElementById('display-differenza-mattina') as HTMLSpanElement;
const displayEffettivoPomeriggio = document.getElementById('display-effettivo-pomeriggio') as HTMLSpanElement;
const displayBPomeriggio = document.getElementById('display-b-pomeriggio') as HTMLSpanElement;
const displayDifferenzaPomeriggio = document.getElementById('display-differenza-pomeriggio') as HTMLSpanElement;
const labelEffettivoMattina = document.getElementById('label-effettivo-mattina') as HTMLSpanElement;
const labelDifferenzaMattina = document.getElementById('label-differenza-mattina') as HTMLSpanElement;
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
 * L'ultima scheda aperta.
 *
 * Ricaricare la pagina mentre si sta guardando l'inventario o i turni non
 * deve riportare all'inizio: si riapre quella dove si era rimasti. Da telefono
 * la pagina si ricarica da sola più spesso di quanto si creda.
 */
const CHIAVE_SCHEDA = 'tabaccheria_scheda_aperta';

function ricordaScheda(id: string): void {
  try {
    localStorage.setItem(CHIAVE_SCHEDA, id);
  } catch {
    // Senza LocalStorage si riparte dalla scheda di sempre: nessun danno
  }
}

/**
 * La scheda da riaprire all'avvio, se è ancora una che si può aprire.
 *
 * Una scheda riservata non si riapre a chi nel frattempo non la vede più:
 * il permesso può essere stato tolto da quando è stata salvata.
 */
function schedaRicordata(): string | null {
  let id: string | null = null;

  try {
    id = localStorage.getItem(CHIAVE_SCHEDA);
  } catch {
    return null;
  }

  if (!id || !document.getElementById(id)) return null;

  const voce = document.querySelector<HTMLElement>(`.nav-tab-item[data-tab="${id}"]`);
  return voce && !voce.hidden ? id : null;
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
 * Le fatture del turno che si sta compilando.
 *
 * Stanno in una lista a parte e non in un campo: il totale è la loro somma, e
 * a fine mese serve sapere cosa è stato pagato, non solo quanto.
 */
let fattureDelTurno: VoceFattura[] = [];

function mostraAvvisoFatture(testo: string): void {
  if (!avvisoFatture) return;

  avvisoFatture.textContent = testo;
  avvisoFatture.classList.toggle('is-hidden', !testo);
}

function renderFatture(): void {
  if (!listaFatture) return;

  if (displayFattureTotale) {
    displayFattureTotale.textContent = formatCurrency(totaleFatture(fattureDelTurno));
  }

  listaFatture.innerHTML = fattureDelTurno.length === 0
    ? '<p class="fatture-vuoto">Nessuna fattura in questo turno.</p>'
    : fattureDelTurno.map((v, i) => `
        <div class="fatture-riga" data-indice="${i}">
          <span class="fatture-nome">${escapeHtml(v.nome)}</span>
          <span class="fatture-importo">${formatCurrency(v.importo)}</span>
          <button type="button" class="fatture-togli" data-action="togli"
                  aria-label="Togli ${escapeHtml(v.nome)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      `).join('');
}

/**
 * Aggiunge una fattura all'elenco del turno.
 *
 * Il nome è obbligatorio: una riga senza nome vale quanto l'importo unico di
 * prima, cioè non dice niente a chi la rilegge.
 */
function aggiungiFattura(): void {
  const nome = inputFatturaNome?.value?.trim() || '';
  const importo = parseInputValue(inputFatturaImporto?.value || '');

  if (!nome) {
    mostraAvvisoFatture('Scrivi cosa è stato pagato.');
    inputFatturaNome?.focus();
    return;
  }

  if (importo === 0) {
    mostraAvvisoFatture("Scrivi l'importo della fattura.");
    inputFatturaImporto?.focus();
    return;
  }

  mostraAvvisoFatture('');
  fattureDelTurno.push({ nome, importo });

  inputFatturaNome.value = '';
  inputFatturaImporto.value = '';
  inputFatturaNome.focus();

  renderFatture();
  triggerAutoSave();
}

function setupFattureDelegation(): void {
  if (!listaFatture) return;

  listaFatture.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-action="togli"]');
    if (!pulsante) return;

    const riga = pulsante.closest('.fatture-riga') as HTMLElement | null;
    const indice = Number(riga?.getAttribute('data-indice'));
    if (isNaN(indice)) return;

    fattureDelTurno.splice(indice, 1);

    renderFatture();
    triggerAutoSave();
  });
}

/**
 * Legge le voci digitate nel form: appartengono sempre al turno selezionato
 */
function getShiftValuesFromInputs(): ShiftValues {
  return {
    contanti: parseInputValue(inputContanti.value),
    sisal_entrate: parseInputValue(inputSisalEntrate.value),
    sisal_uscite: parseInputValue(inputSisalUscite.value),
    mooney: parseInputValue(inputMooney.value),
    lis: parseInputValue(inputLis.value),
    printer: parseInputValue(inputPrinter.value),
    lotto_entrate: parseInputValue(inputLottoEntrate.value),
    lotto_uscite: parseInputValue(inputLottoUscite.value),
    fatture: totaleFatture(fattureDelTurno),
    fatture_voci: fattureDelTurno.map(v => ({ ...v })),
    effettivo: parseInputValue(inputEffettivo.value),
    b: parseInputValue(inputB.value),
    logista: parseInputValue(inputLogista.value),
    gratta_e_vinci: parseInputValue(inputGrattaEVinci.value),
    bar: parseInputValue(inputBar.value)
  };
}

/**
 * Riversa nel form le voci di un turno
 */
function applyShiftValuesToInputs(values: ShiftValues) {
  inputContanti.value = formatInputValue(values.contanti);
  inputSisalEntrate.value = formatInputValue(values.sisal_entrate);
  inputSisalUscite.value = formatInputValue(values.sisal_uscite);
  inputMooney.value = formatInputValue(values.mooney);
  inputLis.value = formatInputValue(values.lis);
  inputPrinter.value = formatInputValue(values.printer);
  inputLottoEntrate.value = formatInputValue(values.lotto_entrate);
  inputLottoUscite.value = formatInputValue(values.lotto_uscite);
  fattureDelTurno = vociFattura(values).map(v => ({ ...v }));
  renderFatture();
  inputEffettivo.value = formatInputValue(values.effettivo);
  inputB.value = formatInputValue(values.b);
  inputLogista.value = formatInputValue(values.logista);
  inputGrattaEVinci.value = formatInputValue(values.gratta_e_vinci);
  inputBar.value = formatInputValue(values.bar);

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
  if (labelEffettivoMattina) {
    labelEffettivoMattina.textContent = soloMattina ? 'Effettivo Turno' : 'Effettivo Turno 1';
  }
  if (labelDifferenzaMattina) {
    labelDifferenzaMattina.textContent = soloMattina ? 'Differenza Turno' : 'Differenza Turno 1';
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
  if (displaySisalNetto) {
    displaySisalNetto.textContent = formatCurrency(
      calculateNetMovement(turnoCorrente.sisal_entrate, turnoCorrente.sisal_uscite)
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

  mostraControlloCassa(
    'mattina',
    displayEffettivoMattina,
    displayBMattina,
    displayDifferenzaMattina,
    totals.differenzaTurnoMattina,
    true
  );

  mostraControlloCassa(
    'pomeriggio',
    displayEffettivoPomeriggio,
    displayBPomeriggio,
    displayDifferenzaPomeriggio,
    totals.differenzaTurnoPomeriggio,
    totals.pomeriggioCompilato
  );
}

/**
 * Riempie le righe del controllo di cassa di un turno.
 *
 * Lo scarto porta il segno e cambia colore: dice da che parte pende, e a
 * colpo d'occhio si vede se la cassa torna.
 */
function mostraControlloCassa(
  turno: ShiftKey,
  campoEffettivo: HTMLSpanElement,
  campoB: HTMLSpanElement,
  campoDifferenza: HTMLSpanElement,
  differenza: number,
  compilato: boolean
) {
  const voci = shiftData[turno];

  if (campoEffettivo) campoEffettivo.textContent = formatCurrency(voci.effettivo);
  if (campoB) campoB.textContent = formatCurrency(voci.b);

  if (!campoDifferenza) return;

  // Senza la chiusura non c'è niente da confrontare: meglio una lineetta che
  // uno scarto pari all'intero turno
  campoDifferenza.textContent = compilato ? formatSignedCurrency(differenza) : '—';

  // Positivo vuol dire che in cassa si è trovato di più di quello che il
  // totale dice che dovrebbe esserci; negativo che si è trovato di meno
  campoDifferenza.classList.toggle('is-eccedenza', compilato && differenza > 0);
  campoDifferenza.classList.toggle('is-ammanco', compilato && differenza < 0);
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

  // Lo scarto si calcola qui, dove ci sono tutti e due i turni: per il
  // pomeriggio serve anche la mattina, perché il suo totale è una differenza
  const totali = calculateDayTotals(shiftData.mattina, shiftData.pomeriggio);
  const differenzaDaSalvare = turnoDaSalvare === 'mattina'
    ? totali.differenzaTurnoMattina
    : totali.differenzaTurnoPomeriggio;

  saveDebounceTimer = window.setTimeout(async () => {
    try {
      const result = await autoSaveDailyLog(
        dataDaSalvare,
        turnoDaSalvare,
        vociDaSalvare,
        getDayExtras(),
        differenzaDaSalvare
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
    ricordaScheda(targetTabId);

    tabButtons.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === targetTabId);
    });

    tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === targetTabId);
    });

    if (targetTabId === 'tab-todos') apriSchedaTodo();
    // I turni li scrive qualcun altro: a ogni apertura si rilegge la settimana
    if (targetTabId === 'tab-turni') caricaTurni();
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
    inputContanti, inputSisalEntrate, inputSisalUscite, inputMooney, inputLis, inputPrinter,
    inputLottoEntrate, inputLottoUscite,
    inputEffettivo, inputB,
    inputLogista, inputGrattaEVinci, inputBar
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

  // Toggle segno ± su Mooney (indispensabile da telefono: il tastierino
  // decimale di iOS e Android non ha il tasto meno). Il Sisal non ne ha più
  // bisogno: adesso ha una voce apposta per le uscite.
  campiConSegno.push([inputMooney, btnToggleMooneySign]);

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

  setupFattureDelegation();

  btnFatturaAggiungi?.addEventListener('click', aggiungiFattura);

  // Invio su uno dei due campi aggiunge: si scrive cosa, quanto, invio
  [inputFatturaNome, inputFatturaImporto].forEach(campo => {
    campo?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aggiungiFattura();
      }
    });
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
 * Riempie il riquadro delle fatture in cima al foglio di stampa.
 *
 * Senza fatture il riquadro sparisce del tutto: il foglio deve stare in una
 * pagina sola, e un riquadro vuoto ruberebbe spazio a quello che conta.
 */
function riempiFatturePerStampa(turno: ShiftKey, values: ShiftValues) {
  const riquadro = document.querySelector<HTMLElement>(`[data-doc-fatture="${turno}"]`);
  const corpo = document.querySelector<HTMLElement>(`[data-doc-fatture-righe="${turno}"]`);
  if (!riquadro || !corpo) return;

  const voci = vociFattura(values);

  riquadro.style.display = voci.length === 0 ? 'none' : '';

  // Con tante fatture si passa a tre colonne: il foglio resta uno solo
  corpo.classList.toggle('is-fitto', voci.length > 12);

  corpo.innerHTML = voci.map(v => `
    <span class="doc-fattura">
      <span class="doc-fattura-nome">${escapeHtml(v.nome)}</span>
      <span class="doc-fattura-importo">${formatCurrency(v.importo)}</span>
    </span>
  `).join('');
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

    'mattina.differenza': totals.differenzaTurnoMattina,
    'pomeriggio.differenza': totals.pomeriggioCompilato ? totals.differenzaTurnoPomeriggio : null,

    'mattina.sisal_netto': calculateNetMovement(mattina.sisal_entrate, mattina.sisal_uscite),
    'pomeriggio.sisal_netto': totals.pomeriggioCompilato
      ? calculateNetMovement(pomeriggio.sisal_entrate, pomeriggio.sisal_uscite)
      : null,

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
    // Il dettaglio delle fatture non è un importo da mettere in una cella:
    // ha un riquadro tutto suo in cima al foglio
    if (voce === 'fatture_voci') return;

    valori[`mattina.${voce}`] = mattina[voce] as number;
    valori[`pomeriggio.${voce}`] = totals.pomeriggioCompilato ? (pomeriggio[voce] as number) : null;
  });

  riempiFatturePerStampa('mattina', mattina);
  riempiFatturePerStampa('pomeriggio', pomeriggio);

  document.querySelectorAll<HTMLElement>('#document-print-sheet [data-doc]').forEach(cell => {
    const chiave = cell.getAttribute('data-doc');
    if (!chiave) return;

    const valore = valori[chiave];

    if (valore === null || valore === undefined) {
      cell.textContent = '—';
      return;
    }

    // Lo scarto si stampa con il segno: senza, sul foglio non si capisce se
    // in cassa mancava o avanzava
    cell.textContent = chiave.endsWith('.differenza')
      ? formatSignedCurrency(valore)
      : formatCurrency(valore);
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
  initTurni();

  // Scopre le voci riservate: senza admin nel profilo non c'è niente da mostrare
  initDashboard();

  // I distributori sono roba di chi amministra: a un dipendente non deve
  // nemmeno accendersi il pallino di una scheda che non può aprire
  if (amministratore()) {
    initH24();
    initDashboardH24();
  }

  // Si torna dove si era rimasti. Solo alla primissima apertura, quando non
  // c'è ancora niente da ricordare, chi amministra parte dalla propria
  // dashboard: apre l'app per guardare come va, non per inserire i turni.
  const daRiaprire = schedaRicordata() || (amministratore() ? 'tab-dashboard' : '');
  if (daRiaprire) schedaDaAprire?.(daRiaprire);

  await loadDateIntoForm(selectedDate);
  await renderHistorySidebar();
  await caricaSoggiorni();
  await caricaRubrica();
  await caricaTurni();

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

