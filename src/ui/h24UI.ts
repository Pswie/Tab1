import {
  DISTRIBUTORI,
  Distributore,
  IncassoH24,
  NOMI_DISTRIBUTORI,
  ProdottoH24,
  aggiungiProdotto,
  azzeraMancanti,
  elencaIncassi,
  elencaProdotti,
  eliminaIncasso,
  eliminaProdotto,
  impostaDichiarato,
  impostaPacchiMancanti,
  modificaScheda,
  pezziDiUnProdotto,
  registraRifornimento,
  salvaIncasso,
  senzaDettaglio,
  spostaProdotto,
  totaleMacchine
} from '../services/h24';
import { escapeHtml, euro, meseIndietro, nomeMese, numero, variazione } from './grafici';
import { formatInputValue, getTodayDateString, parseInputValue } from '../utils/calculations';
import { inviaNotifica } from '../utils/notifiche';
import { segnala } from './segnalazioni';

/**
 * Distributori H24: cosa manca e quanto hanno incassato.
 *
 * Sono due lavori diversi e stanno in due schede diverse: il giro di
 * rifornimento si fa in piedi davanti alle macchine, la dichiarazione si fa
 * seduti a fine mese.
 *
 * Si conta a PACCHI, perché è così che si compra. I pezzi si ricavano dalla
 * scheda del prodotto e dicono quanta roba è davvero uscita.
 */

let prodotti: ProdottoH24[] = [];
let incassi: IncassoH24[] = [];

/** Quanti mesi indietro si possono scegliere nell'elenco */
const MESI_SCEGLIBILI = 24;

/** Il promemoria della dichiarazione si fa vivo una volta al mese, non a ogni apertura */
const CHIAVE_AVVISATO = 'tabaccheria_h24_dichiarazione_avvisata';

const listaProdotti = document.getElementById('h24-lista-prodotti') as HTMLDivElement;
const totaleMancanti = document.getElementById('h24-totale-mancanti') as HTMLSpanElement;
const campoNome = document.getElementById('h24-nome-prodotto') as HTMLInputElement;
const campoPerPacco = document.getElementById('h24-pezzi-per-pacco') as HTMLInputElement;
const campoPacchi = document.getElementById('h24-pacchi-mancanti') as HTMLInputElement;
const sceltaDistributore = document.getElementById('h24-distributore') as HTMLSelectElement;
const pulsanteAggiungi = document.getElementById('btn-h24-aggiungi') as HTMLButtonElement;
const pulsanteRifornito = document.getElementById('btn-h24-rifornito') as HTMLButtonElement;
const avviso = document.getElementById('h24-avviso') as HTMLParagraphElement;

const listaIncassi = document.getElementById('h24-lista-incassi') as HTMLDivElement;
const totaleAnno = document.getElementById('h24-totale-anno') as HTMLSpanElement;
const sceltaMese = document.getElementById('h24-mese') as HTMLSelectElement;
// Un campo per macchina: il totale del mese lo fa la somma
const campiImporto: Record<Distributore, HTMLInputElement> = {
  drink: document.getElementById('h24-importo-drink') as HTMLInputElement,
  snack: document.getElementById('h24-importo-snack') as HTMLInputElement,
  vari: document.getElementById('h24-importo-vari') as HTMLInputElement
};
const pulsanteSalvaIncasso = document.getElementById('btn-h24-salva-incasso') as HTMLButtonElement;
const avvisoIncasso = document.getElementById('h24-avviso-incasso') as HTMLParagraphElement;

function meseCorrente(): string {
  return getTodayDateString().slice(0, 7);
}

/** Il mese da dichiarare è quello appena concluso */
function meseDaDichiarare(): string {
  return meseIndietro(meseCorrente());
}

function mostraAvviso(dove: HTMLParagraphElement, testo: string): void {
  if (!dove) return;

  dove.textContent = testo;
  dove.classList.toggle('is-hidden', !testo);
}

function vuoto(messaggio: string, icona: string): string {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${icona}
      </svg>
      <p class="empty-state-text">${escapeHtml(messaggio)}</p>
    </div>
  `;
}

const ICONA_MACCHINA = '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 6.5h8"/><path d="M8 11h8"/><path d="M8 15.5h4"/>';
const ICONA_EURO = '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3.5 3.5 0 0 0-5.5 2.5 3.5 3.5 0 0 0 5.5 2.5"/><path d="M8 11h4"/><path d="M8 13h4"/>';

function rigaProdotto(p: ProdottoH24): string {
  const altre = DISTRIBUTORI.filter(d => d !== p.distributore);
  const pezzi = pezziDiUnProdotto(p);

  return `
    <div class="h24-riga ${p.pacchiMancanti > 0 ? 'is-da-portare' : ''}" data-id="${escapeHtml(p.id)}">
      <span class="h24-dati">
        <span class="h24-nome">${escapeHtml(p.nome)}</span>
        <span class="h24-scheda">
          ${numero(p.pezziPerPacco)} ${p.pezziPerPacco === 1 ? 'pezzo' : 'pezzi'} per pacco${
            pezzi > 0 ? ` &middot; <b>${numero(pezzi)} pezzi da rimettere</b>` : ''
          }
        </span>
      </span>

      <div class="h24-quantita" title="Pacchi da portare">
        <button type="button" class="h24-passo" data-action="meno" aria-label="Un pacco in meno di ${escapeHtml(p.nome)}">&minus;</button>
        <input type="text" class="h24-campo-mancanti" data-action="pacchi" inputmode="numeric"
               value="${p.pacchiMancanti || ''}" placeholder="0"
               aria-label="Pacchi mancanti di ${escapeHtml(p.nome)}" />
        <button type="button" class="h24-passo" data-action="piu" aria-label="Un pacco in più di ${escapeHtml(p.nome)}">+</button>
      </div>

      <div class="rub-azioni">
        <select class="h24-sposta" data-action="sposta" aria-label="Sposta ${escapeHtml(p.nome)} in un'altra macchina">
          <option value="${p.distributore}">${escapeHtml(NOMI_DISTRIBUTORI[p.distributore])}</option>
          ${altre.map(d => `<option value="${d}">&rarr; ${escapeHtml(NOMI_DISTRIBUTORI[d])}</option>`).join('')}
        </select>

        <button type="button" class="todo-icon-btn" data-action="modifica"
                aria-label="Correggi la scheda di ${escapeHtml(p.nome)}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="todo-icon-btn is-danger" data-action="elimina"
                aria-label="Togli ${escapeHtml(p.nome)} dall'elenco"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
    </div>
  `;
}

function renderProdotti(): void {
  if (!listaProdotti) return;

  const pacchi = prodotti.reduce((s, p) => s + Math.max(p.pacchiMancanti, 0), 0);
  const pezzi = prodotti.reduce((s, p) => s + pezziDiUnProdotto(p), 0);

  if (totaleMancanti) {
    totaleMancanti.textContent = pacchi === 0 ? '0' : `${numero(pacchi)}`;
    totaleMancanti.title = `${numero(pezzi)} pezzi in tutto`;
  }

  if (pulsanteRifornito) pulsanteRifornito.classList.toggle('is-hidden', pacchi === 0);

  // Il pallino sul menu dice che c'è merce da portare, anche a scheda chiusa
  segnala('h24', pacchi);

  if (prodotti.length === 0) {
    listaProdotti.innerHTML = vuoto(
      'Nessun prodotto in elenco. Carica le schede di quello che sta nelle macchine.',
      ICONA_MACCHINA
    );
    return;
  }

  // Una macchina per volta: il giro di rifornimento si fa così, non
  // scorrendo un elenco unico in cui drink e snack sono mescolati
  listaProdotti.innerHTML = DISTRIBUTORI.map(macchina => {
    const dentro = prodotti.filter(p => p.distributore === macchina);
    const daPortare = dentro.reduce((s, p) => s + Math.max(p.pacchiMancanti, 0), 0);
    const pezziMacchina = dentro.reduce((s, p) => s + pezziDiUnProdotto(p), 0);

    return `
      <section class="h24-macchina is-${macchina} ${daPortare > 0 ? 'is-da-portare' : ''}"
               data-macchina="${macchina}">
        <header class="h24-macchina-testa">
          <h3 class="h24-macchina-titolo">${escapeHtml(NOMI_DISTRIBUTORI[macchina])}</h3>
          <span class="h24-macchina-meta">
            ${daPortare > 0
              ? `${numero(daPortare)} ${daPortare === 1 ? 'pacco' : 'pacchi'} &middot; ${numero(pezziMacchina)} pezzi`
              : dentro.length === 0 ? 'Nessun prodotto' : 'Piena'}
          </span>
          ${daPortare > 0
            ? `<button type="button" class="h24-macchina-btn" data-action="rifornita">Rifornita</button>`
            : ''}
        </header>

        ${dentro.length === 0
          ? `<p class="h24-macchina-vuota">Nessun prodotto in questa macchina.</p>`
          : dentro.map(rigaProdotto).join('')}
      </section>
    `;
  }).join('');
}

function renderIncassi(): void {
  if (!listaIncassi) return;

  const anno = getTodayDateString().slice(0, 4);
  const totale = incassi
    .filter(i => i.mese.startsWith(anno))
    .reduce((s, i) => s + i.importo, 0);

  if (totaleAnno) totaleAnno.textContent = euro(totale);

  if (incassi.length === 0) {
    listaIncassi.innerHTML = vuoto(
      'Nessun incasso registrato. Segna quanto hanno fatto le macchine, mese per mese.',
      ICONA_EURO
    );
    return;
  }

  listaIncassi.innerHTML = incassi.map(i => {
    const prima = incassi.find(x => x.mese === meseIndietro(i.mese));

    return `
      <div class="h24-riga h24-riga-incasso ${i.dichiarato ? 'is-dichiarato' : ''}"
           data-mese="${escapeHtml(i.mese)}">
        <label class="sog-check h24-dichiarato" title="Segna quando la dichiarazione è stata fatta">
          <input type="checkbox" data-action="dichiarato" ${i.dichiarato ? 'checked' : ''}
                 aria-label="Dichiarazione di ${escapeHtml(nomeMese(i.mese))} fatta" />
          <span class="sog-check-box" aria-hidden="true"></span>
        </label>

        <div class="h24-dati">
          <span class="h24-nome">${escapeHtml(nomeMese(i.mese))}</span>
          <span class="h24-stato">
            ${i.dichiarato ? 'Dichiarato' : 'Da dichiarare'}
            ${prima ? variazione(i.importo, prima.importo, 'sul mese prima') : ''}
          </span>

          <!-- Le tre macchine sotto al mese: il totale da solo non dice quale
               sta lavorando e quale invece è ferma -->
          ${senzaDettaglio(i)
            ? '<span class="h24-macchine-nota">Totale segnato prima della divisione per macchina</span>'
            : `<span class="h24-macchine">
                 ${DISTRIBUTORI.map(m => `
                   <span class="h24-macchina-voce">
                     <span class="h24-macchina-nome">${NOMI_DISTRIBUTORI[m]}</span>
                     <span class="h24-macchina-importo">${euro(i.importi[m])}</span>
                   </span>
                 `).join('')}
               </span>`}
        </div>

        <span class="h24-importo">${euro(i.importo)}</span>

        <div class="rub-azioni">
          <button type="button" class="todo-icon-btn" data-action="modifica"
                  aria-label="Correggi ${escapeHtml(nomeMese(i.mese))}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button type="button" class="todo-icon-btn is-danger" data-action="elimina"
                  aria-label="Elimina ${escapeHtml(nomeMese(i.mese))}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Il promemoria della dichiarazione.
 *
 * Dal primo del mese il mese prima è concluso e va dichiarato: il riquadro
 * resta lì finché non lo si segna fatto, così non dipende dall'aver visto
 * passare una notifica.
 */
function renderPromemoria(): void {
  const riquadri = Array.from(document.querySelectorAll('.h24-promemoria')) as HTMLElement[];
  if (riquadri.length === 0) return;

  const mese = meseDaDichiarare();
  const registrato = incassi.find(i => i.mese === mese);
  const serve = !registrato || !registrato.dichiarato;

  const nota = registrato
    ? `${nomeMese(mese)} è chiuso con ${euro(registrato.importo)}: resta da dichiarare.`
    : `${nomeMese(mese)} è concluso e non ha ancora un incasso registrato.`;

  riquadri.forEach(r => {
    r.classList.toggle('is-hidden', !serve);

    // Il testo si svuota quando non serve più: se un domani il riquadro
    // tornasse visibile per un altro motivo, non deve mostrare il mese vecchio
    const dove = r.querySelector('.h24-promemoria-nota');
    if (dove) dove.textContent = serve ? nota : '';
  });
}

/** Notifica una volta sola per mese: riaprire l'app non la fa ripartire */
function avvisaDichiarazione(): void {
  const mese = meseDaDichiarare();
  const registrato = incassi.find(i => i.mese === mese);

  if (registrato && registrato.dichiarato) return;

  try {
    if (localStorage.getItem(CHIAVE_AVVISATO) === mese) return;
    localStorage.setItem(CHIAVE_AVVISATO, mese);
  } catch {
    // Senza LocalStorage l'avviso si ripete a ogni apertura: meglio che mai
  }

  inviaNotifica('Dichiarazione distributori', `Va dichiarato l'incasso di ${nomeMese(mese)}.`);
}

/** L'elenco dei mesi fra cui scegliere, dal più recente indietro */
function riempiElencoMesi(): void {
  if (!sceltaMese) return;

  const corrente = meseCorrente();

  sceltaMese.innerHTML = Array.from({ length: MESI_SCEGLIBILI }, (_, i) => {
    const mese = meseIndietro(corrente, i);
    return `<option value="${mese}">${escapeHtml(nomeMese(mese))}</option>`;
  }).join('');

  // Si apre sul mese da dichiarare: è quello che si viene a scrivere
  sceltaMese.value = meseDaDichiarare();
}

function macchinaScelta(): Distributore {
  const scelta = sceltaDistributore?.value as Distributore | undefined;
  return scelta && DISTRIBUTORI.includes(scelta) ? scelta : 'vari';
}

/** Prima quello che manca: è la lista della spesa per il prossimo giro */
function ordinaProdotti(): void {
  prodotti.sort((a, b) => {
    if ((a.pacchiMancanti > 0) !== (b.pacchiMancanti > 0)) return a.pacchiMancanti > 0 ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
  });
}

async function aggiungi(): Promise<void> {
  const nome = campoNome?.value?.trim() || '';
  const macchina = macchinaScelta();

  if (!nome) {
    mostraAvviso(avviso, 'Scrivi il nome del prodotto.');
    return;
  }

  // Lo stesso nome in due macchine diverse è legittimo: si controlla dentro
  // alla macchina scelta
  const gia = prodotti.some(
    p => p.distributore === macchina && p.nome.toLowerCase() === nome.toLowerCase()
  );

  if (gia) {
    mostraAvviso(avviso, `${nome} è già fra i prodotti ${NOMI_DISTRIBUTORI[macchina]}.`);
    return;
  }

  const perPacco = parseInt(campoPerPacco?.value?.trim() || '', 10);

  if (!perPacco || perPacco < 1) {
    mostraAvviso(avviso, 'Scrivi quanti pezzi ci sono in un pacco: serve a sapere quanto esce.');
    return;
  }

  const pacchi = Math.max(parseInt(campoPacchi?.value?.trim() || '0', 10) || 0, 0);

  mostraAvviso(avviso, '');
  campoNome.value = '';
  if (campoPerPacco) campoPerPacco.value = '';
  if (campoPacchi) campoPacchi.value = '';

  const voce = await aggiungiProdotto(nome, macchina, perPacco, pacchi);

  prodotti.push(voce);
  ordinaProdotti();
  renderProdotti();
  campoNome.focus();
}

/**
 * Cambia i pacchi mancanti di un prodotto.
 * L'elenco non si riordina qui: mentre si scrive, la riga schizzerebbe via.
 */
function cambiaPacchi(prodotto: ProdottoH24, valore: number, riga: HTMLElement): void {
  const pacchi = Math.max(valore, 0);

  prodotto.pacchiMancanti = pacchi;
  riga.classList.toggle('is-da-portare', pacchi > 0);

  const pezzi = pezziDiUnProdotto(prodotto);
  const scheda = riga.querySelector('.h24-scheda');
  if (scheda) {
    scheda.innerHTML = `${numero(prodotto.pezziPerPacco)} ${prodotto.pezziPerPacco === 1 ? 'pezzo' : 'pezzi'} per pacco` +
      (pezzi > 0 ? ` &middot; <b>${numero(pezzi)} pezzi da rimettere</b>` : '');
  }

  const totalePacchi = prodotti.reduce((s, p) => s + Math.max(p.pacchiMancanti, 0), 0);
  const totalePezzi = prodotti.reduce((s, p) => s + pezziDiUnProdotto(p), 0);

  if (totaleMancanti) {
    totaleMancanti.textContent = numero(totalePacchi);
    totaleMancanti.title = `${numero(totalePezzi)} pezzi in tutto`;
  }
  if (pulsanteRifornito) pulsanteRifornito.classList.toggle('is-hidden', totalePacchi === 0);
  segnala('h24', totalePacchi);

  impostaPacchiMancanti(prodotto.id, pacchi);
}

/** Correzione della scheda: nome e pezzi per pacco, al posto della riga */
function avviaModificaScheda(riga: HTMLElement, prodotto: ProdottoH24): void {
  riga.innerHTML = `
    <div class="h24-modifica">
      <input type="text" class="todo-add-input" data-campo="nome" value="${escapeHtml(prodotto.nome)}" aria-label="Nome del prodotto" />
      <input type="text" class="todo-add-input h24-campo-quantita" data-campo="perpacco" inputmode="numeric"
             value="${prodotto.pezziPerPacco}" aria-label="Pezzi per pacco" />
      <button type="button" class="rub-btn-testo" data-action="salva-scheda">Salva</button>
    </div>
  `;

  const inputNome = riga.querySelector('[data-campo="nome"]') as HTMLInputElement;
  const inputPerPacco = riga.querySelector('[data-campo="perpacco"]') as HTMLInputElement;

  inputNome.focus();
  inputNome.setSelectionRange(inputNome.value.length, inputNome.value.length);

  let concluso = false;

  const conferma = (salva: boolean) => {
    if (concluso) return;
    concluso = true;

    const nome = inputNome.value.trim();
    const perPacco = parseInt(inputPerPacco.value.trim(), 10);

    if (salva && nome && perPacco > 0 && (nome !== prodotto.nome || perPacco !== prodotto.pezziPerPacco)) {
      prodotto.nome = nome;
      prodotto.pezziPerPacco = perPacco;
      ordinaProdotti();
      modificaScheda(prodotto.id, nome, perPacco);
    }

    renderProdotti();
  };

  riga.querySelector('[data-action="salva-scheda"]')?.addEventListener('mousedown', e => {
    // Il click arriverebbe dopo il blur, che ha già chiuso la modifica
    e.preventDefault();
    conferma(true);
  });

  [inputNome, inputPerPacco].forEach(campo => {
    campo.addEventListener('keydown', e => {
      if (e.key === 'Enter') conferma(true);
      if (e.key === 'Escape') conferma(false);
    });
  });

  riga.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!riga.contains(document.activeElement)) conferma(true);
    }, 0);
  });
}

async function salvaIncassoDelMese(): Promise<void> {
  const mese = sceltaMese?.value || '';

  const importi = {
    drink: parseInputValue(campiImporto.drink?.value || ''),
    snack: parseInputValue(campiImporto.snack?.value || ''),
    vari: parseInputValue(campiImporto.vari?.value || '')
  };

  if (!mese) {
    mostraAvviso(avvisoIncasso, 'Scegli il mese.');
    return;
  }

  // Basta una macchina compilata: capita che una resti ferma tutto il mese
  if (totaleMacchine(importi) <= 0) {
    mostraAvviso(avvisoIncasso, "Scrivi quanto ha fatto almeno una delle macchine.");
    return;
  }

  mostraAvviso(avvisoIncasso, '');
  DISTRIBUTORI.forEach(m => {
    if (campiImporto[m]) campiImporto[m].value = '';
  });

  const voce = await salvaIncasso(mese, importi);

  incassi = [...incassi.filter(i => i.mese !== mese), voce]
    .sort((a, b) => b.mese.localeCompare(a.mese));

  renderIncassi();
  renderPromemoria();
}

export async function caricaProdottiH24(): Promise<void> {
  if (!listaProdotti) return;

  prodotti = await elencaProdotti();
  renderProdotti();
}

export async function caricaIncassiH24(): Promise<void> {
  if (!listaIncassi) return;

  incassi = await elencaIncassi();
  renderIncassi();
  renderPromemoria();
}

/**
 * Controlla se c'è una dichiarazione da fare, senza aprire la scheda.
 * Va chiamata all'avvio: è il modo per accorgersene il primo del mese.
 */
export async function controllaDichiarazioneH24(): Promise<void> {
  if (!listaIncassi) return;

  try {
    incassi = await elencaIncassi();
    renderIncassi();
    renderPromemoria();
    avvisaDichiarazione();
  } catch (err) {
    console.warn('Controllo dichiarazione rimandato:', err);
  }
}

/** Il pallino sul menu si accende anche senza aprire la scheda dei prodotti */
export async function controllaScorteH24(): Promise<void> {
  if (!listaProdotti) return;

  try {
    prodotti = await elencaProdotti();
    renderProdotti();
  } catch (err) {
    console.warn('Controllo scorte rimandato:', err);
  }
}

export function initH24(): void {
  if (!listaProdotti) return;

  riempiElencoMesi();

  pulsanteAggiungi?.addEventListener('click', aggiungi);

  [campoNome, campoPerPacco, campoPacchi].forEach(campo => {
    campo?.addEventListener('keydown', e => {
      if (e.key === 'Enter') aggiungi();
    });
  });

  pulsanteSalvaIncasso?.addEventListener('click', salvaIncassoDelMese);

  DISTRIBUTORI.forEach(m => {
    campiImporto[m]?.addEventListener('keydown', e => {
      if (e.key === 'Enter') salvaIncassoDelMese();
    });
  });

  pulsanteRifornito?.addEventListener('click', async () => {
    // Quello che si rimette dentro è quello che è uscito: si scrive prima di
    // azzerare, altrimenti il conto delle vendite andrebbe perso
    const rimessi = prodotti.filter(p => p.pacchiMancanti > 0);

    prodotti = prodotti.map(p => ({ ...p, pacchiMancanti: 0 }));
    renderProdotti();

    await registraRifornimento(rimessi);
    await azzeraMancanti();
  });

  document.querySelectorAll('.btn-h24-vai-incassi').forEach(btn => {
    btn.addEventListener('click', () => {
      const voce = document.querySelector('[data-tab="tab-h24-incassi"]') as HTMLButtonElement | null;
      voce?.click();
    });
  });

  // Un solo gestore per elenco: le righe si ridisegnano di continuo
  listaProdotti.addEventListener('click', async e => {
    const pulsante = (e.target as HTMLElement).closest('button[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const azione = pulsante.getAttribute('data-action');

    // Rifornita una macchina sola: le altre due restano come stanno
    if (azione === 'rifornita') {
      const macchina = pulsante.closest('.h24-macchina')?.getAttribute('data-macchina') as Distributore | null;
      if (!macchina) return;

      const rimessi = prodotti.filter(p => p.distributore === macchina && p.pacchiMancanti > 0);

      prodotti = prodotti.map(p => (p.distributore === macchina ? { ...p, pacchiMancanti: 0 } : p));
      renderProdotti();

      await registraRifornimento(rimessi);
      await azzeraMancanti(macchina);
      return;
    }

    const riga = pulsante.closest('.h24-riga') as HTMLElement | null;
    const prodotto = prodotti.find(p => p.id === riga?.getAttribute('data-id'));
    if (!riga || !prodotto) return;

    if (azione === 'elimina') {
      prodotti = prodotti.filter(p => p.id !== prodotto.id);
      renderProdotti();
      eliminaProdotto(prodotto.id);
      return;
    }

    if (azione === 'modifica') {
      avviaModificaScheda(riga, prodotto);
      return;
    }

    const passo = azione === 'piu' ? 1 : -1;
    cambiaPacchi(prodotto, prodotto.pacchiMancanti + passo, riga);

    const campo = riga.querySelector('.h24-campo-mancanti') as HTMLInputElement | null;
    if (campo) campo.value = prodotto.pacchiMancanti > 0 ? String(prodotto.pacchiMancanti) : '';
  });

  listaProdotti.addEventListener('input', e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'pacchi') return;

    const riga = campo.closest('.h24-riga') as HTMLElement | null;
    const prodotto = prodotti.find(p => p.id === riga?.getAttribute('data-id'));
    if (!riga || !prodotto) return;

    const scritti = parseInt(campo.value.trim(), 10);
    cambiaPacchi(prodotto, isNaN(scritti) ? 0 : scritti, riga);
  });

  listaProdotti.addEventListener('change', e => {
    const scelta = e.target as HTMLSelectElement;
    if (scelta.getAttribute('data-action') !== 'sposta') return;

    const riga = scelta.closest('.h24-riga') as HTMLElement | null;
    const prodotto = prodotti.find(p => p.id === riga?.getAttribute('data-id'));
    const macchina = scelta.value as Distributore;
    if (!prodotto || !DISTRIBUTORI.includes(macchina) || macchina === prodotto.distributore) return;

    prodotto.distributore = macchina;
    renderProdotti();
    spostaProdotto(prodotto.id, macchina);
  });

  listaIncassi?.addEventListener('change', e => {
    const campo = e.target as HTMLInputElement;
    if (campo.getAttribute('data-action') !== 'dichiarato') return;

    const riga = campo.closest('.h24-riga') as HTMLElement | null;
    const mese = riga?.getAttribute('data-mese');
    const voce = incassi.find(i => i.mese === mese);
    if (!mese || !voce) return;

    voce.dichiarato = campo.checked;

    renderIncassi();
    renderPromemoria();
    impostaDichiarato(mese, campo.checked);
  });

  listaIncassi?.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('button[data-action]') as HTMLElement | null;
    if (!pulsante) return;

    const riga = pulsante.closest('.h24-riga') as HTMLElement | null;
    const mese = riga?.getAttribute('data-mese');
    const voce = incassi.find(i => i.mese === mese);
    if (!mese || !voce) return;

    if (pulsante.getAttribute('data-action') === 'modifica') {
      // Si riporta il mese nel modulo in alto: correggere è riscrivere
      if (sceltaMese) sceltaMese.value = mese;

      DISTRIBUTORI.forEach(m => {
        if (campiImporto[m]) campiImporto[m].value = formatInputValue(voce.importi[m]);
      });

      campiImporto.drink?.focus();
      campiImporto.drink?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    incassi = incassi.filter(i => i.mese !== mese);
    renderIncassi();
    renderPromemoria();
    eliminaIncasso(mese);
  });

  renderProdotti();
  renderIncassi();
  renderPromemoria();
}
