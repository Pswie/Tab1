import '../permessi-utenti.css';
import { amministratore } from '../services/auth';
import {
  elencaAutoriModificheGestione, elencaModificheGestione, elencaPermessiUtenti, salvaPermessiUtente,
  FiltriModifiche, ModificaGestione, PermessiUtente
} from '../services/permessiUtenti';

const ambiti: Record<string, string> = { turni: 'Turni', pulizie: 'Pulizie', permessi: 'Permessi' };
const azioni: Record<string, string> = {
  turno_modificato: 'Turno modificato', turno_annullato: 'Turno rimosso', festa_spostata: 'Festa spostata',
  scheda_turni_modificata: 'Programma abituale modificato', pulizia_assegnata: 'Responsabili modificati',
  pulizia_riprogrammata: 'Programma della pulizia modificato', pulizia_ripristinata: 'Programma automatico ripristinato',
  pulizia_completata: 'Pulizia completata', pulizia_riaperta: 'Pulizia riaperta',
  permessi_modificati: 'Permessi modificati'
};
const campi: Record<string, string> = {
  nome: 'Dipendente', dipendente: 'Dipendente', persona: 'Persona', data: 'Giorno', turno: 'Turno', nota: 'Nota',
  squadra: 'Turno abituale', festa_mode: 'Programma delle feste', festa_mattina: 'Festa al mattino',
  festa_pomeriggio: 'Festa al pomeriggio', valida_dal: 'Valido dal', tipo: 'Tipo di pulizia', voce: 'Attività',
  periodo_inizio: 'Inizio periodo', periodo_fine: 'Fine periodo', prevista_il: 'Giorno previsto', gruppo: 'Gruppo',
  responsabili: 'Responsabili', origine: 'Assegnazione', origine_assegnazione: 'Assegnazione',
  programma_manuale: 'Giorno personalizzato', gestione_turni: 'Modificare il calendario turni',
  gestione_pulizie: 'Gestire giorni e responsabili delle pulizie', dal: 'Festa precedente', al: 'Nuova festa',
  annullato: 'Assegnazione annullata', completata: 'Completata', completata_il: 'Completata il', completata_da_nome: 'Segnata da'
};
const giorni = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

function escapeHtml(testo: string): string {
  return testo.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function dataLeggibile(iso: string, ora = false): string {
  const data = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(data.getTime())) return 'Data non disponibile';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric',
    ...(ora ? { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' } as const : {}) }).format(data);
}

function valoreLeggibile(chiave: string, valore: unknown): string {
  if (chiave === 'festa_mattina' || chiave === 'festa_pomeriggio') return giorni[Number(valore) - 1] || 'Nessun giorno fisso';
  if (chiave === 'squadra') return valore === 1 || valore === 2 ? `Turno ${valore}` : 'Da assegnare';
  if (chiave === 'completata_il') return valore ? dataLeggibile(String(valore), true) : 'Non completata';
  if (typeof valore === 'boolean') return valore ? 'Sì' : 'No';
  if (valore === null || valore === undefined || valore === '') return 'Non impostato';
  if (Array.isArray(valore)) return valore.length ? valore.map(String).join(', ') : 'Nessuno';
  const testo = String(valore);
  if (/^\d{4}-\d{2}-\d{2}$/.test(testo)) return dataLeggibile(testo);
  const nomi: Record<string, string> = { mattina: 'Mattina', pomeriggio: 'Pomeriggio', intermedio: 'Intermedio',
    festa: 'Festa', ferie: 'Ferie', automatico: 'Automatica', manuale: 'Personalizzata', personalizzato: 'Personalizzato',
    bagno: 'Bagno', settimanale: 'Settimanale', mensile: 'Mensile', 'gruppo-1': 'Gruppo 1', 'gruppo-2': 'Gruppo 2' };
  return nomi[testo] || testo;
}

/** Only human-facing fields enter the comparison; identifiers and raw JSON stay out. */
function fotografiaHtml(valore: unknown): string {
  if (valore === null || valore === undefined) return '<p class="permessi-vuoto-dettaglio">Nessuna assegnazione</p>';
  if (typeof valore !== 'object' || Array.isArray(valore)) return '<p class="permessi-vuoto-dettaglio">Nessun dettaglio disponibile.</p>';
  const riga = valore as Record<string, unknown>;
  const dettagli = Object.entries(riga).filter(([chiave, valore]) => campi[chiave] && !(valore === '' && ['nota', 'turno', 'gruppo'].includes(chiave)))
    .map(([chiave, valore]) => `<div><dt>${campi[chiave]}</dt><dd>${escapeHtml(valoreLeggibile(chiave, valore))}</dd></div>`).join('');
  const turni = Array.isArray(riga.turni) ? `<ul class="permessi-turni-dettaglio">${riga.turni.map(turno => {
    if (!turno || typeof turno !== 'object') return '';
    const voce = turno as Record<string, unknown>;
    return `<li><strong>${escapeHtml(dataLeggibile(String(voce.data)))}</strong><span>${escapeHtml(String(voce.persona || riga.dipendente || ''))} · ${escapeHtml(valoreLeggibile('turno', voce.turno))}</span>${voce.nota ? `<span>${escapeHtml(String(voce.nota))}</span>` : ''}</li>`;
  }).join('')}</ul>` : '';
  return `${dettagli ? `<dl class="permessi-confronto-campi">${dettagli}</dl>` : ''}${turni}` || '<p class="permessi-vuoto-dettaglio">Nessun dettaglio disponibile.</p>';
}

function utenteHtml(utente: PermessiUtente): string {
  const id = escapeHtml(utente.id);
  return `<form class="permessi-utente" data-utente-id="${id}" data-modificata="false" aria-labelledby="permessi-nome-${id}">
    <div class="permessi-persona"><h3 id="permessi-nome-${id}">${escapeHtml(utente.nome)}</h3><p>${escapeHtml(utente.email)}</p></div>
    <fieldset><legend class="permessi-sr">Permessi di ${escapeHtml(utente.nome)}</legend>
      <label><input type="checkbox" name="gestioneTurni"${utente.gestioneTurni ? ' checked' : ''}><span>Modificare il calendario turni</span></label>
      <label><input type="checkbox" name="gestionePulizie"${utente.gestionePulizie ? ' checked' : ''}><span>Gestire giorni e responsabili delle pulizie</span></label>
    </fieldset>
    <div class="permessi-utente-azioni"><button type="submit" class="permessi-btn primario" disabled>Salva</button><button type="reset" class="permessi-btn" hidden>Annulla</button></div>
    <p class="permessi-feedback" role="status" aria-live="polite"></p>
  </form>`;
}

function modificaHtml(voce: ModificaGestione): string {
  return `<li class="permessi-modifica" data-modifica-id="${escapeHtml(voce.id)}"><article>
    <div class="permessi-modifica-meta"><span class="permessi-ambito">${ambiti[voce.ambito] || 'Gestione'}</span><time datetime="${escapeHtml(voce.creataIl)}">${escapeHtml(dataLeggibile(voce.creataIl, true))}</time></div>
    <h3>${azioni[voce.azione] || 'Modifica registrata'}</h3>
    ${voce.oggetto ? `<p class="permessi-oggetto">${escapeHtml(voce.oggetto)}</p>` : ''}
    <p class="permessi-autore">Di ${escapeHtml(voce.autoreNome)}</p>
    <details><summary>Vedi cosa è cambiato</summary><div class="permessi-confronto"><section><h4>Prima</h4>${fotografiaHtml(voce.prima)}</section><section><h4>Dopo</h4>${fotografiaHtml(voce.dopo)}</section></div></details>
  </article></li>`;
}

export function initPermessiUtenti(): void {
  if (!amministratore() || document.getElementById('btn-permessi-utenti')) return;
  const intestazione = document.querySelector('#tab-turni .turni-titolo-riga');
  if (!intestazione) return;
  const apri = document.createElement('button');
  apri.id = 'btn-permessi-utenti';
  apri.type = 'button';
  apri.className = 'permessi-btn permessi-apri';
  apri.textContent = 'Permessi e attività';
  apri.setAttribute('aria-haspopup', 'dialog');
  apri.setAttribute('aria-controls', 'permessi-utenti-dialog');
  intestazione.append(apri);

  const dialog = document.createElement('dialog');
  dialog.id = 'permessi-utenti-dialog';
  dialog.className = 'permessi-dialog';
  dialog.setAttribute('aria-labelledby', 'permessi-titolo');
  dialog.innerHTML = `<header class="permessi-testa"><div><h2 id="permessi-titolo">Permessi e attività</h2><p>Gestisci le deleghe e consulta le modifiche registrate.</p></div><button type="button" class="permessi-btn permessi-chiudi" data-azione="chiudi" aria-label="Chiudi permessi e attività"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <div class="permessi-tabs" role="tablist" aria-label="Permessi e attività">
      <button type="button" role="tab" id="permessi-tab-utenti" aria-controls="permessi-pane-utenti" aria-selected="true" data-tab-permessi="utenti">Utenti</button>
      <button type="button" role="tab" id="permessi-tab-registro" aria-controls="permessi-pane-registro" aria-selected="false" tabindex="-1" data-tab-permessi="registro">Registro modifiche</button>
    </div>
    <div class="permessi-corpo">
      <section id="permessi-pane-utenti" role="tabpanel" aria-labelledby="permessi-tab-utenti">
        <div class="permessi-toolbar"><p>Le schede dei turni abituali restano riservate all’amministratore.</p><button type="button" class="permessi-btn" data-azione="aggiorna-utenti">Aggiorna</button></div>
        <p id="permessi-utenti-stato" class="permessi-stato" role="status" aria-live="polite"></p><div class="permessi-utenti-elenco"></div>
      </section>
      <section id="permessi-pane-registro" role="tabpanel" aria-labelledby="permessi-tab-registro" hidden>
        <p class="permessi-registro-nota">Registro delle operazioni sui turni, sulle pulizie e sui permessi, visibile solo all’amministratore.</p>
        <details class="permessi-filtri-gruppo" open><summary>Filtra le modifiche</summary><form class="permessi-filtri">
          <label>Autore<select name="autore"><option value="">Tutti gli autori</option></select></label>
          <label>Ambito<select name="ambito"><option value="">Tutti gli ambiti</option><option value="turni">Turni</option><option value="pulizie">Pulizie</option><option value="permessi">Permessi</option></select></label>
          <label>Dal<input type="date" name="dal"></label><label>Al<input type="date" name="al"></label>
          <div class="permessi-filtri-azioni"><button type="reset" class="permessi-btn">Azzera filtri</button><button type="submit" class="permessi-btn primario">Applica filtri</button></div>
        </form></details>
        <p id="permessi-registro-stato" class="permessi-stato" role="status" aria-live="polite"></p>
        <button type="button" class="permessi-btn" data-azione="riprova-registro" hidden>Riprova caricamento</button>
        <p class="permessi-conteggio" role="status" aria-live="polite"></p><ol class="permessi-registro-elenco"></ol>
        <button type="button" class="permessi-btn permessi-altro" data-azione="carica-altro" hidden>Carica altre modifiche</button>
      </section>
    </div>`;
  document.body.append(dialog);

  const elenco = dialog.querySelector<HTMLElement>('.permessi-utenti-elenco')!;
  const statoUtenti = dialog.querySelector<HTMLElement>('#permessi-utenti-stato')!;
  const registro = dialog.querySelector<HTMLOListElement>('.permessi-registro-elenco')!;
  const statoRegistro = dialog.querySelector<HTMLElement>('#permessi-registro-stato')!;
  const filtri = dialog.querySelector<HTMLFormElement>('.permessi-filtri')!;
  const gruppoFiltri = dialog.querySelector<HTMLDetailsElement>('.permessi-filtri-gruppo')!;
  if (window.matchMedia('(max-width: 700px)').matches) gruppoFiltri.open = false;
  const autore = filtri.querySelector<HTMLSelectElement>('[name="autore"]')!;
  const altro = dialog.querySelector<HTMLButtonElement>('[data-azione="carica-altro"]')!;
  const riprovaRegistro = dialog.querySelector<HTMLButtonElement>('[data-azione="riprova-registro"]')!;
  const aggiornaUtenti = dialog.querySelector<HTMLButtonElement>('[data-azione="aggiorna-utenti"]')!;
  const chiudi = dialog.querySelector<HTMLButtonElement>('[data-azione="chiudi"]')!;
  let utenti: PermessiUtente[] = [];
  let modifiche: ModificaGestione[] = [];
  let utentiCaricati = false;
  let letturaUtenti = false;
  let salvataggio = false;
  let letturaRegistro = false;
  let registroCaricato = false;
  let altreDisponibili = false;
  let autoriCaricati = false;
  let versionePermessi = 0;
  let applicati: FiltriModifiche = { autore: '', ambito: '', dal: '', al: '' };
  const autori = new Map<string, string>();

  function avvisa(elemento: HTMLElement, testo: string, errore = false): void {
    elemento.textContent = testo;
    elemento.classList.toggle('is-errore', errore);
    elemento.setAttribute('role', errore ? 'alert' : 'status');
  }
  function haBozze(): boolean { return Boolean(elenco.querySelector('[data-modificata="true"]')); }
  function aggiornaAutori(): void {
    const valore = autore.value;
    autore.innerHTML = '<option value="">Tutti gli autori</option>' + [...autori].sort((a, b) => a[1].localeCompare(b[1], 'it'))
      .map(([id, nome]) => `<option value="${escapeHtml(id)}">${escapeHtml(nome)}</option>`).join('');
    autore.value = valore;
  }
  function valoriUtente(form: HTMLFormElement) {
    return { gestioneTurni: form.querySelector<HTMLInputElement>('[name="gestioneTurni"]')!.checked,
      gestionePulizie: form.querySelector<HTMLInputElement>('[name="gestionePulizie"]')!.checked };
  }
  function aggiornaBozza(form: HTMLFormElement): void {
    const salvato = utenti.find(utente => utente.id === form.dataset.utenteId);
    if (!salvato) return;
    const valori = valoriUtente(form);
    const diversa = valori.gestioneTurni !== salvato.gestioneTurni || valori.gestionePulizie !== salvato.gestionePulizie;
    form.dataset.modificata = String(diversa);
    form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = salvataggio || !diversa;
    form.querySelector<HTMLButtonElement>('[type="reset"]')!.hidden = !diversa;
    avvisa(form.querySelector('.permessi-feedback')!, diversa ? 'Modifiche da salvare' : '');
  }
  function bloccaUtenti(): void {
    aggiornaUtenti.disabled = salvataggio || letturaUtenti;
    chiudi.disabled = salvataggio;
    elenco.setAttribute('aria-busy', String(salvataggio || letturaUtenti));
    elenco.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(campo => { campo.disabled = salvataggio || letturaUtenti; });
    elenco.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.disabled = salvataggio || letturaUtenti || (button.type === 'submit' && button.closest('form')?.dataset.modificata !== 'true');
    });
  }
  async function caricaUtenti(): Promise<void> {
    if (letturaUtenti || salvataggio || !amministratore()) return;
    if (haBozze()) { avvisa(statoUtenti, 'Salva o annulla le modifiche prima di aggiornare l’elenco.', true); return; }
    letturaUtenti = true;
    bloccaUtenti();
    avvisa(statoUtenti, 'Caricamento dei dipendenti approvati…');
    const versione = versionePermessi;
    try {
      const nuove = await elencaPermessiUtenti();
      if (!amministratore() || versione !== versionePermessi) return;
      utenti = nuove;
      utentiCaricati = true;
      elenco.innerHTML = utenti.map(utenteHtml).join('');
      avvisa(statoUtenti, utenti.length ? `${utenti.length} dipendenti approvati` : 'Nessun dipendente approvato. Approva l’accesso della persona, poi aggiorna l’elenco.');
    } catch (errore) { avvisa(statoUtenti, errore instanceof Error ? errore.message : 'Elenco non aggiornato. Riprova.', true); }
    finally { letturaUtenti = false; bloccaUtenti(); }
  }
  function valoriFiltri(): FiltriModifiche {
    const valore = (nome: string) => filtri.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${nome}"]`)!.value;
    return { autore: valore('autore'), ambito: valore('ambito'), dal: valore('dal'), al: valore('al') };
  }
  function filtriDiversi(): boolean { return JSON.stringify(valoriFiltri()) !== JSON.stringify(applicati); }
  function bloccaRegistro(): void {
    filtri.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach(campo => { campo.disabled = letturaRegistro; });
    autore.disabled = letturaRegistro || !autoriCaricati;
    registro.setAttribute('aria-busy', String(letturaRegistro));
    altro.disabled = letturaRegistro || filtriDiversi() || !autoriCaricati;
    altro.hidden = !altreDisponibili;
  }
  async function caricaRegistro(aggiungi = false): Promise<void> {
    if (letturaRegistro || !amministratore()) return;
    const richiesti = aggiungi ? applicati : valoriFiltri();
    if (richiesti.dal && richiesti.al && richiesti.dal > richiesti.al) {
      avvisa(statoRegistro, 'La data iniziale viene dopo quella finale. Correggi il periodo.', true);
      filtri.querySelector<HTMLInputElement>('[name="al"]')!.focus();
      return;
    }
    letturaRegistro = true;
    riprovaRegistro.hidden = true;
    bloccaRegistro();
    avvisa(statoRegistro, 'Caricamento delle modifiche…');
    const versione = versionePermessi;
    try {
      const [esitoModifiche, esitoAutori] = await Promise.allSettled([
        elencaModificheGestione(richiesti, aggiungi ? modifiche.at(-1)?.id ?? null : null),
        aggiungi && autoriCaricati ? Promise.resolve(null) : elencaAutoriModificheGestione()
      ]);
      if (!amministratore() || versione !== versionePermessi) return;
      if (esitoAutori.status === 'rejected') {
        autoriCaricati = false;
        if (autore.options.length === 1) autore.options[0].textContent = 'Autori non disponibili';
        throw esitoAutori.reason;
      }
      if (esitoAutori.value) {
        autori.clear();
        esitoAutori.value.forEach(voce => autori.set(voce.id, voce.nome));
        autoriCaricati = true;
        aggiornaAutori();
      }
      if (esitoModifiche.status === 'rejected') throw esitoModifiche.reason;
      const nuove = esitoModifiche.value;
      applicati = { ...richiesti };
      const numeroFiltri = Object.values(applicati).filter(Boolean).length;
      gruppoFiltri.querySelector('summary')!.textContent = numeroFiltri ? `Filtri (${numeroFiltri} attivi)` : 'Filtra le modifiche';
      modifiche = aggiungi ? [...modifiche, ...nuove.filter(voce => !modifiche.some(esistente => esistente.id === voce.id))] : nuove;
      altreDisponibili = nuove.length === 50;
      registroCaricato = true;
      if (aggiungi) registro.insertAdjacentHTML('beforeend', nuove.filter(voce => !registro.querySelector(`[data-modifica-id="${CSS.escape(voce.id)}"]`)).map(modificaHtml).join(''));
      else registro.innerHTML = modifiche.map(modificaHtml).join('');
      dialog.querySelector('.permessi-conteggio')!.textContent = `${modifiche.length} modifiche visualizzate`;
      avvisa(statoRegistro, modifiche.length ? '' : 'Nessuna modifica nel periodo e negli ambiti selezionati.');
      altro.textContent = 'Carica altre modifiche';
    } catch (errore) {
      if (!amministratore() || versione !== versionePermessi) return;
      const messaggio = errore instanceof Error ? errore.message : 'Registro non aggiornato. Riprova.';
      avvisa(statoRegistro, `${messaggio}${modifiche.length ? ' Le modifiche già visualizzate restano disponibili.' : ''}`, true);
      if (aggiungi) altro.textContent = 'Riprova caricamento';
      else riprovaRegistro.hidden = false;
    } finally { letturaRegistro = false; bloccaRegistro(); }
  }
  function selezionaTab(nome: string): void {
    dialog.querySelectorAll<HTMLButtonElement>('[data-tab-permessi]').forEach(tab => {
      const attivo = tab.dataset.tabPermessi === nome;
      tab.setAttribute('aria-selected', String(attivo));
      tab.tabIndex = attivo ? 0 : -1;
      dialog.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!.hidden = !attivo;
    });
    if (nome === 'registro' && !registroCaricato) void caricaRegistro();
    if (nome === 'utenti' && !utentiCaricati) void caricaUtenti();
  }
  apri.addEventListener('click', () => {
    if (!amministratore()) return;
    dialog.showModal();
    if (!utentiCaricati) void caricaUtenti();
    else if (haBozze()) avvisa(statoUtenti, 'Le modifiche non ancora salvate sono conservate in questa finestra.');
  });
  chiudi.addEventListener('click', () => { if (!salvataggio) dialog.close(); });
  dialog.addEventListener('cancel', evento => { if (salvataggio) evento.preventDefault(); });
  dialog.addEventListener('close', () => apri.focus());
  aggiornaUtenti.addEventListener('click', () => void caricaUtenti());
  dialog.querySelectorAll<HTMLButtonElement>('[data-tab-permessi]').forEach(tab => {
    tab.addEventListener('click', () => selezionaTab(tab.dataset.tabPermessi!));
    tab.addEventListener('keydown', evento => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
      evento.preventDefault();
      const nome = evento.key === 'Home' ? 'utenti' : evento.key === 'End' ? 'registro' : tab.dataset.tabPermessi === 'utenti' ? 'registro' : 'utenti';
      selezionaTab(nome);
      dialog.querySelector<HTMLButtonElement>(`[data-tab-permessi="${nome}"]`)!.focus();
    });
  });
  elenco.addEventListener('change', evento => {
    const form = (evento.target as HTMLElement).closest<HTMLFormElement>('form');
    if (form) aggiornaBozza(form);
  });
  elenco.addEventListener('reset', evento => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    const salvata = utenti.find(utente => utente.id === form.dataset.utenteId);
    if (!salvata || salvataggio) return;
    form.querySelector<HTMLInputElement>('[name="gestioneTurni"]')!.checked = salvata.gestioneTurni;
    form.querySelector<HTMLInputElement>('[name="gestionePulizie"]')!.checked = salvata.gestionePulizie;
    aggiornaBozza(form);
  });
  elenco.addEventListener('submit', async evento => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    if (salvataggio || letturaUtenti || !amministratore() || form.dataset.modificata !== 'true') return;
    const id = form.dataset.utenteId!;
    const valori = valoriUtente(form);
    salvataggio = true;
    bloccaUtenti();
    const feedback = form.querySelector<HTMLElement>('.permessi-feedback')!;
    avvisa(feedback, 'Salvataggio dei permessi…');
    const versione = versionePermessi;
    try {
      const salvata = await salvaPermessiUtente(id, valori.gestioneTurni, valori.gestionePulizie);
      if (!amministratore() || versione !== versionePermessi) return;
      utenti = utenti.map(utente => utente.id === id ? salvata : utente);
      form.outerHTML = utenteHtml(salvata);
      const nuova = [...elenco.querySelectorAll<HTMLFormElement>('form')].find(elemento => elemento.dataset.utenteId === id)!;
      avvisa(nuova.querySelector('.permessi-feedback')!, 'Permessi salvati.');
      const nome = nuova.querySelector<HTMLElement>('h3')!;
      nome.tabIndex = -1;
      nome.focus({ preventScroll: true });
      registroCaricato = false;
      avvisa(statoUtenti, 'Permessi aggiornati. La modifica è registrata nell’attività.');
    } catch (errore) {
      avvisa(feedback, errore instanceof Error ? errore.message : 'Permessi non salvati. Riprova.', true);
      form.querySelector('button[type="submit"]')!.textContent = 'Riprova';
    } finally { salvataggio = false; bloccaUtenti(); }
  });
  filtri.addEventListener('submit', evento => { evento.preventDefault(); void caricaRegistro(); });
  filtri.addEventListener('reset', evento => {
    evento.preventDefault();
    filtri.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(campo => { campo.value = ''; });
    void caricaRegistro();
  });
  filtri.addEventListener('change', () => {
    altro.disabled = filtriDiversi() || !autoriCaricati;
    if (filtriDiversi()) avvisa(statoRegistro, 'Applica i filtri per aggiornare le modifiche visualizzate.');
  });
  altro.addEventListener('click', () => void caricaRegistro(true));
  riprovaRegistro.addEventListener('click', () => void caricaRegistro());
  window.addEventListener('permessi-aggiornati', () => {
    apri.hidden = !amministratore();
    if (amministratore()) return;
    versionePermessi++;
    dialog.close();
    utenti = [];
    modifiche = [];
    autori.clear();
    utentiCaricati = false;
    registroCaricato = false;
    altreDisponibili = false;
    autoriCaricati = false;
    applicati = { autore: '', ambito: '', dal: '', al: '' };
    elenco.replaceChildren();
    registro.replaceChildren();
    autore.innerHTML = '<option value="">Tutti gli autori</option>';
    gruppoFiltri.querySelector('summary')!.textContent = 'Filtra le modifiche';
    filtri.reset();
    statoUtenti.textContent = '';
    statoRegistro.textContent = '';
    dialog.querySelector('.permessi-conteggio')!.textContent = '';
    altro.hidden = true;
    riprovaRegistro.hidden = true;
  });
}
