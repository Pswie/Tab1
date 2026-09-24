import '../schede-turni.css';
import { amministratore } from '../services/auth';
import { SchedaTurni, elencaSchedeTurni, salvaSchedaTurni } from '../services/schedeTurni';
import { getTodayDateString } from '../utils/calculations';

const giorni = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

function escapeHtml(testo: string): string {
  return testo.replace(/[&<>"']/g, carattere => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[carattere]!));
}

function dataLeggibile(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${iso}T12:00:00`));
}

function opzioniFesta(scelta: number | null): string {
  return `<option value=""${scelta === null ? ' selected' : ''}>Nessun giorno fisso</option>` +
    giorni.map((nome, indice) => `<option value="${indice + 1}"${scelta === indice + 1 ? ' selected' : ''}>${nome}</option>`).join('');
}

function schedaHtml(scheda: SchedaTurni): string {
  const id = escapeHtml(scheda.id);
  const nome = escapeHtml(scheda.nome);
  const iniziali = escapeHtml(scheda.nome.trim().split(/\s+/).slice(0, 2).map(parola => parola[0]).join(''));
  return `<form class="scheda-turni" data-profilo-id="${id}" aria-labelledby="scheda-nome-${id}">
    <div class="scheda-turni-testa">
      <span class="scheda-turni-avatar" aria-hidden="true">${iniziali}</span>
      <h3 id="scheda-nome-${id}">${nome}</h3>
      <span class="scheda-turni-stato${scheda.squadra === null ? ' da-assegnare' : ''}">${scheda.squadra === null ? 'Da assegnare' : `Turno ${scheda.squadra}`}</span>
    </div>
    <fieldset class="scheda-turni-campi">
      <label class="scheda-turni-squadra" for="scheda-squadra-${id}">Turno abituale
        <select id="scheda-squadra-${id}" name="squadra" aria-describedby="schede-turni-alternanza">
          <option value=""${scheda.squadra === null ? ' selected' : ''}>Da assegnare</option>
          <option value="1"${scheda.squadra === 1 ? ' selected' : ''}>Turno 1</option>
          <option value="2"${scheda.squadra === 2 ? ' selected' : ''}>Turno 2</option>
        </select>
      </label>
      <label for="scheda-festa-mattina-${id}">Festa quando lavora al mattino
        <select id="scheda-festa-mattina-${id}" name="festaMattina">${opzioniFesta(scheda.festaMattina)}</select>
      </label>
      <label for="scheda-festa-pomeriggio-${id}">Festa quando lavora al pomeriggio
        <select id="scheda-festa-pomeriggio-${id}" name="festaPomeriggio">${opzioniFesta(scheda.festaPomeriggio)}</select>
      </label>
    </fieldset>
    ${scheda.prossimaValidaDal ? `<p class="scheda-turni-programmata">È previsto un cambio dal ${escapeHtml(dataLeggibile(scheda.prossimaValidaDal))}. Puoi consultarlo scegliendo quella data qui sopra.</p>` : ''}
    <p class="scheda-turni-feedback" role="status" aria-live="polite"></p>
    <div class="scheda-turni-azioni">
      <button type="reset" class="schede-turni-btn scheda-turni-annulla" hidden>Annulla modifiche</button>
      <button type="submit" class="schede-turni-btn primario" disabled>Salva scheda</button>
    </div>
  </form>`;
}

/** Schede di ricorrenza riservate all’admin; il calendario resta condiviso. */
export function initSchedeTurni(dopoSalvataggio: () => Promise<void>): void {
  if (!amministratore() || document.getElementById('btn-schede-turni')) return;
  const titolo = document.querySelector('#tab-turni .turni-titolo-riga');
  const intestazione = document.querySelector('#tab-turni .turni-testa');
  if (!titolo || !intestazione) return;

  const apri = document.createElement('button');
  apri.id = 'btn-schede-turni';
  apri.type = 'button';
  apri.className = 'schede-turni-btn schede-turni-apri';
  apri.setAttribute('aria-expanded', 'false');
  apri.setAttribute('aria-controls', 'schede-turni-panel');
  apri.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v3"/></svg>Schede dipendenti';
  titolo.append(apri);

  const panel = document.createElement('section');
  panel.id = 'schede-turni-panel';
  panel.className = 'schede-turni-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'schede-turni-titolo');
  panel.innerHTML = `<div class="schede-turni-intestazione">
      <div><h2 id="schede-turni-titolo" tabindex="-1">I turni della squadra</h2>
        <p>Turno abituale e giorni di festa dei dipendenti approvati.</p></div>
      <button type="button" class="schede-turni-btn schede-turni-chiudi" data-azione="chiudi" aria-label="Chiudi schede" title="Chiudi schede"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </div>
    <p id="schede-turni-alternanza" class="schede-turni-spiegazione">I due turni si alternano ogni settimana. Scegli il giorno di festa per la mattina e per il pomeriggio.</p>
    <div class="schede-turni-controlli">
      <label for="schede-turni-dal">Applica dal <input type="date" id="schede-turni-dal" name="schede-turni-dal" required></label>
      <button type="button" class="schede-turni-btn" data-azione="aggiorna" aria-label="Aggiorna elenco" title="Aggiorna elenco"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></svg><span>Aggiorna elenco</span></button>
    </div>
    <p class="schede-turni-eccezioni">Le variazioni del calendario restano valide per il singolo giorno.</p>
    <p id="schede-turni-messaggio" role="status" aria-live="polite"></p>
    <div class="schede-turni-elenco"></div>`;
  intestazione.after(panel);

  const data = panel.querySelector<HTMLInputElement>('#schede-turni-dal')!;
  const elenco = panel.querySelector<HTMLElement>('.schede-turni-elenco')!;
  const messaggio = panel.querySelector<HTMLElement>('#schede-turni-messaggio')!;
  let dataCaricata = getTodayDateString();
  let schede: SchedaTurni[] = [];
  let occupato = false;
  let caricato = false;
  data.value = dataCaricata;
  data.min = dataCaricata;

  function avvisa(testo: string, errore = false): void {
    messaggio.textContent = testo;
    messaggio.classList.toggle('is-errore', errore);
    messaggio.setAttribute('role', errore ? 'alert' : 'status');
  }

  function haModifiche(): boolean { return Boolean(elenco.querySelector('form[data-modificata="true"]')); }

  function impostazioni(form: HTMLFormElement) {
    const valori = new FormData(form);
    const squadra = String(valori.get('squadra') ?? '');
    return {
      squadra: squadra === '1' ? 1 as const : squadra === '2' ? 2 as const : null,
      festaMattina: valori.get('festaMattina') ? Number(valori.get('festaMattina')) : null,
      festaPomeriggio: valori.get('festaPomeriggio') ? Number(valori.get('festaPomeriggio')) : null
    };
  }

  function aggiornaModificata(form: HTMLFormElement): void {
    const salvata = schede.find(scheda => scheda.id === form.dataset.profiloId);
    if (!salvata) return;
    const valori = impostazioni(form);
    const modificata = valori.squadra !== salvata.squadra || valori.festaMattina !== salvata.festaMattina || valori.festaPomeriggio !== salvata.festaPomeriggio;
    form.dataset.modificata = String(modificata);
    form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = occupato || !modificata;
    form.querySelector<HTMLButtonElement>('[type="reset"]')!.hidden = !modificata;
    form.querySelector<HTMLElement>('.scheda-turni-feedback')!.textContent = modificata ? 'Modifiche da salvare' : '';
    form.classList.remove('is-errore');
  }

  function blocca(valore: boolean): void {
    occupato = valore;
    panel.setAttribute('aria-busy', String(valore));
    data.disabled = valore;
    panel.querySelectorAll<HTMLButtonElement>('[data-azione]').forEach(button => { button.disabled = valore; });
    elenco.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(fieldset => { fieldset.disabled = valore; });
    elenco.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.disabled = valore || (button.type === 'submit' && button.closest('form')?.dataset.modificata !== 'true');
    });
  }

  async function carica(): Promise<void> {
    if (occupato || !amministratore()) return;
    if (haModifiche()) { avvisa('Salva o annulla le modifiche prima di aggiornare l’elenco.', true); return; }
    if (!data.checkValidity()) { data.reportValidity(); return; }
    blocca(true);
    avvisa('Caricamento dei dipendenti approvati…');
    try {
      schede = await elencaSchedeTurni(data.value);
      dataCaricata = data.value;
      elenco.innerHTML = schede.map(schedaHtml).join('');
      caricato = true;
      avvisa(schede.length ? `${schede.length} dipendenti · Impostazioni dal ${dataLeggibile(dataCaricata)}` : 'Nessun dipendente approvato. Approva l’accesso della persona, poi aggiorna questo elenco.');
    } catch (errore) {
      data.value = dataCaricata;
      avvisa(errore instanceof Error ? errore.message : 'Impossibile caricare i dipendenti. Riprova.', true);
    } finally { blocca(false); }
  }

  function chiudi(): void {
    if (occupato) return;
    panel.hidden = true;
    apri.setAttribute('aria-expanded', 'false');
    apri.focus();
  }

  apri.addEventListener('click', () => {
    if (!amministratore() || occupato) return;
    if (!panel.hidden) { chiudi(); return; }
    panel.hidden = false;
    apri.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true });
    if (!caricato || !haModifiche()) void carica();
  });
  panel.querySelector('[data-azione="chiudi"]')!.addEventListener('click', chiudi);
  panel.querySelector('[data-azione="aggiorna"]')!.addEventListener('click', () => void carica());
  data.addEventListener('change', () => {
    if (haModifiche()) {
      data.value = dataCaricata;
      avvisa('Salva o annulla le modifiche prima di scegliere una nuova data.', true);
      return;
    }
    void carica();
  });
  elenco.addEventListener('change', evento => {
    const form = (evento.target as HTMLElement).closest<HTMLFormElement>('form');
    if (form) aggiornaModificata(form);
  });
  elenco.addEventListener('reset', evento => {
    const form = evento.target as HTMLFormElement;
    queueMicrotask(() => aggiornaModificata(form));
  });
  elenco.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (occupato || !amministratore()) return;
    const form = evento.target as HTMLFormElement;
    const id = form.dataset.profiloId;
    if (!id || form.dataset.modificata !== 'true') return;
    if (!data.checkValidity()) { data.reportValidity(); return; }
    const valori = impostazioni(form);
    const feedback = form.querySelector<HTMLElement>('.scheda-turni-feedback')!;
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    blocca(true);
    button.textContent = 'Salvataggio…';
    feedback.textContent = 'Aggiornamento del calendario…';
    try {
      const salvata = await salvaSchedaTurni({ profiloId: id, validaDal: dataCaricata, ...valori });
      schede = schede.map(scheda => scheda.id === id ? salvata : scheda);
      form.outerHTML = schedaHtml(salvata);
      const nuova = Array.from(elenco.querySelectorAll<HTMLFormElement>('form')).find(elemento => elemento.dataset.profiloId === id)!;
      nuova.querySelector<HTMLElement>('.scheda-turni-feedback')!.textContent = 'Scheda salvata. Calendario aggiornato.';
      nuova.querySelector<HTMLElement>('h3')!.setAttribute('tabindex', '-1');
      nuova.querySelector<HTMLElement>('h3')!.focus({ preventScroll: true });
      avvisa(`${salvata.nome}: programma salvato dal ${dataLeggibile(dataCaricata)}. Le eccezioni nel calendario sono conservate.`);
      try { await dopoSalvataggio(); }
      catch { avvisa('Scheda salvata. Riapri il calendario per visualizzare l’aggiornamento.', true); }
    } catch (errore) {
      form.classList.add('is-errore');
      feedback.textContent = errore instanceof Error ? errore.message : 'Modifiche non salvate. Riprova.';
      feedback.setAttribute('role', 'alert');
      button.textContent = 'Riprova salvataggio';
    } finally { blocca(false); }
  });
}
