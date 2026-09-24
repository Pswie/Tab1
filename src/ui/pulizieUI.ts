import {
  GruppoPulizia,
  PeriodoPulizie,
  Pulizia,
  TipoPulizia,
  elencaPulizie,
  impostaPulizia
} from '../services/pulizie';
import {
  formatDateLocalISO,
  getInizioSettimanaString,
  getTodayDateString
} from '../utils/calculations';
import { isSupabaseConfigured } from '../services/supabase';
import { amministratore } from '../services/auth';
import type { GestionePulizie } from './gestionePulizieUI';

type VistaPulizie = 'bagno' | 'settimanali' | 'mensili';

let vista: VistaPulizie = 'bagno';
let settimana = getInizioSettimanaString();
let mese = getTodayDateString().slice(0, 7);
let pulizie: Pulizia[] = [];
let idInSalvataggio = '';
let recuperoStoricoFatto = false;
let gestionePulizie: GestionePulizie | null = null;

const PRIMA_SETTIMANA_PULIZIE = '2026-08-10';
const PRIMO_MESE_PULIZIE = '2026-08';

const pannello = document.getElementById('tab-pulizie') as HTMLDivElement;
const listaBagno = document.getElementById('pulizie-bagno-lista') as HTMLDivElement;
const listaMattina = document.getElementById('pulizie-settimanali-mattina') as HTMLDivElement;
const listaPomeriggio = document.getElementById('pulizie-settimanali-pomeriggio') as HTMLDivElement;
const gruppiMensili = document.getElementById('pulizie-mensili-gruppi') as HTMLDivElement;
const periodoLabel = document.getElementById('pulizie-periodo') as HTMLSpanElement;
const avviso = document.getElementById('pulizie-avviso') as HTMLParagraphElement;
const btnIndietro = document.getElementById('btn-pulizie-indietro') as HTMLButtonElement;
const btnAvanti = document.getElementById('btn-pulizie-avanti') as HTMLButtonElement;
const btnCorrente = document.getElementById('btn-pulizie-corrente') as HTMLButtonElement;

const pulsantiVista = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#tab-pulizie [data-vista]')
);
const pannelliVista = Array.from(
  document.querySelectorAll<HTMLElement>('#tab-pulizie [data-pulizie-pane]')
);

function escapeHtml(testo: string): string {
  return testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dataLocale(iso: string): Date {
  const [anno, numeroMese, giorno] = iso.split('-').map(Number);
  return new Date(anno, numeroMese - 1, giorno);
}

function spostaGiorni(iso: string, giorni: number): string {
  const d = dataLocale(iso);
  d.setDate(d.getDate() + giorni);
  return formatDateLocalISO(d);
}

function spostaMesi(annoMese: string, quanti: number): string {
  const [anno, numeroMese] = annoMese.split('-').map(Number);
  const d = new Date(anno, numeroMese - 1 + quanti, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nomeMese(annoMese: string): string {
  const [anno, numeroMese] = annoMese.split('-').map(Number);
  const testo = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
    .format(new Date(anno, numeroMese - 1, 1));
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

function titoloSettimana(): string {
  const inizio = dataLocale(settimana);
  const fine = dataLocale(spostaGiorni(settimana, 6));
  const meseInizio = new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(inizio).replace('.', '');
  const meseFine = new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(fine).replace('.', '');

  return inizio.getMonth() === fine.getMonth()
    ? `${inizio.getDate()}–${fine.getDate()} ${meseFine} ${fine.getFullYear()}`
    : `${inizio.getDate()} ${meseInizio}–${fine.getDate()} ${meseFine} ${fine.getFullYear()}`;
}

function periodo(): PeriodoPulizie {
  return { settimana, mese };
}

/**
 * Ricostruisce eventuali periodi in cui nessun dispositivo ha aperto l'app.
 * Le chiamate sono idempotenti e il database accetta soltanto date comprese
 * fra l'attivazione del registro e il periodo corrente.
 */
async function recuperaPeriodiMancanti(): Promise<void> {
  if (recuperoStoricoFatto) return;
  if (!isSupabaseConfigured()) {
    recuperoStoricoFatto = true;
    return;
  }

  const settimanaCorrente = getInizioSettimanaString();
  const meseCorrente = getTodayDateString().slice(0, 7);
  let settimanaDaRecuperare = PRIMA_SETTIMANA_PULIZIE;
  let meseDaRecuperare = PRIMO_MESE_PULIZIE;

  while (settimanaDaRecuperare <= settimanaCorrente || meseDaRecuperare <= meseCorrente) {
    await elencaPulizie({
      settimana: settimanaDaRecuperare <= settimanaCorrente
        ? settimanaDaRecuperare
        : settimanaCorrente,
      mese: meseDaRecuperare <= meseCorrente ? meseDaRecuperare : meseCorrente
    });

    if (settimanaDaRecuperare <= settimanaCorrente) {
      settimanaDaRecuperare = spostaGiorni(settimanaDaRecuperare, 7);
    }
    if (meseDaRecuperare <= meseCorrente) meseDaRecuperare = spostaMesi(meseDaRecuperare, 1);
  }

  recuperoStoricoFatto = true;
}

function mostraAvviso(testo: string): void {
  if (!avviso) return;
  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
}

function voci(tipo: TipoPulizia): Pulizia[] {
  return pulizie.filter(v => v.tipo === tipo);
}

function dataOra(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome'
  }).format(d).replace('.', '');
}

function rigaHtml(voce: Pulizia): string {
  const oggi = getTodayDateString();
  const scaduta = voce.nonFatta;
  const fuoriPeriodo = oggi < voce.periodoInizio || oggi > voce.periodoFine;
  const salvando = idInSalvataggio === voce.id;
  const classi = [
    'pulizia-riga',
    voce.completata ? 'is-done' : 'is-pending',
    scaduta ? 'is-missed' : '',
    fuoriPeriodo ? 'is-locked' : '',
    salvando ? 'is-saving' : '',
    voce.tipo === 'bagno' && voce.previstaIl === oggi ? 'is-oggi' : ''
  ].filter(Boolean).join(' ');

  const stato = voce.completata
    ? 'Fatta'
    : (scaduta ? 'Non fatta' : (oggi < voce.periodoInizio ? 'Non iniziata' : 'Da fare'));
  const responsabili = voce.responsabili.join(', ');
  const responsabiliHtml = responsabili
    ? `<p class="pulizia-responsabili">${escapeHtml(responsabili)}</p>`
    : '';
  const blocco = fuoriPeriodo
    ? (oggi > voce.periodoFine ? 'Periodo concluso' : 'Periodo non ancora iniziato')
    : '';

  return `
    <article class="${classi}" data-pulizia-id="${escapeHtml(voce.id)}">
      <button type="button" class="pulizia-check" data-action="completa-pulizia"
              data-id="${escapeHtml(voce.id)}" aria-pressed="${String(voce.completata)}"
              aria-label="${escapeHtml(voce.voce)}: ${blocco || (voce.completata ? 'togli la X' : 'metti la X')}"
              ${salvando || fuoriPeriodo ? `disabled${salvando ? ' aria-busy="true"' : ''}` : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
      </button>
      <div class="pulizia-corpo">
        <div class="pulizia-riga-testa">
          <span class="pulizia-nome">${escapeHtml(voce.voce)}</span>
          <span class="pulizia-stato">${stato}</span>
        </div>
        ${responsabiliHtml}
        ${voce.completata && voce.completataIl
          ? `<p class="pulizia-firma">Segnata da ${escapeHtml(voce.completataDa || 'Dipendente')} · ${escapeHtml(dataOra(voce.completataIl))}</p>`
          : ''}
      </div>
    </article>
  `;
}

function listaHtml(elenco: Pulizia[]): string {
  return elenco.length > 0
    ? elenco.map(rigaHtml).join('')
    : '<p class="pulizie-vuoto">Checklist non ancora disponibile.</p>';
}

function aggiornaConteggi(): void {
  const conteggi: Array<[VistaPulizie, Pulizia[]]> = [
    ['bagno', voci('bagno')],
    ['settimanali', voci('settimanale')],
    ['mensili', voci('mensile')]
  ];

  conteggi.forEach(([chiave, elenco]) => {
    const nodo = document.querySelector<HTMLElement>(`#tab-pulizie [data-conteggio="${chiave}"]`);
    if (nodo) nodo.textContent = `${elenco.filter(v => v.completata).length} / ${elenco.length}`;
  });
}

function gruppoHtml(gruppo: GruppoPulizia): string {
  const elenco = voci('mensile').filter(v => v.gruppo === gruppo);
  const daAssegnare = elenco.filter(voce => !voce.completata);
  const nomi = [...new Set((daAssegnare.length ? daAssegnare : elenco).flatMap(voce => voce.responsabili))].join(', ')
    || (gruppo === 'gruppo-1' ? 'Gruppo 1 · Responsabili da assegnare' : 'Gruppo 2 · Responsabili da assegnare');

  return `
    <section class="pulizie-blocco is-${gruppo}">
      <header class="pulizie-blocco-testa">
        <span>${escapeHtml(nomi)}</span>
      </header>
      <div class="pulizie-lista">${listaHtml(elenco)}</div>
    </section>
  `;
}

function render(): void {
  if (!pannello) return;

  pulsantiVista.forEach(btn => {
    const attivo = btn.dataset.vista === vista;
    btn.classList.toggle('is-active', attivo);
    btn.setAttribute('aria-selected', String(attivo));
    btn.tabIndex = attivo ? 0 : -1;
  });

  pannelliVista.forEach(pane => {
    pane.hidden = pane.dataset.puliziePane !== vista;
  });

  if (periodoLabel) periodoLabel.textContent = vista === 'mensili' ? nomeMese(mese) : titoloSettimana();
  if (btnCorrente) {
    btnCorrente.textContent = vista === 'mensili' ? 'Questo mese' : 'Questa settimana';
    btnCorrente.disabled = vista === 'mensili'
      ? mese === getTodayDateString().slice(0, 7)
      : settimana === getInizioSettimanaString();
  }
  if (btnAvanti) {
    btnAvanti.disabled = vista === 'mensili'
      ? mese >= getTodayDateString().slice(0, 7)
      : settimana >= getInizioSettimanaString();
  }
  if (btnIndietro) {
    btnIndietro.disabled = vista === 'mensili'
      ? mese <= PRIMO_MESE_PULIZIE
      : settimana <= PRIMA_SETTIMANA_PULIZIE;
  }

  if (listaBagno) listaBagno.innerHTML = listaHtml(voci('bagno'));
  if (listaMattina) listaMattina.innerHTML = listaHtml(voci('settimanale').filter(v => v.turno === 'mattina'));
  if (listaPomeriggio) listaPomeriggio.innerHTML = listaHtml(voci('settimanale').filter(v => v.turno === 'pomeriggio'));
  if (gruppiMensili) gruppiMensili.innerHTML = gruppoHtml('gruppo-1') + gruppoHtml('gruppo-2');

  aggiornaConteggi();
  gestionePulizie?.aggiorna(pulizie, periodo());
}

export async function caricaPulizie(): Promise<void> {
  if (!pannello) return;

  pannello.classList.add('is-caricamento');
  mostraAvviso('');
  await recuperaPeriodiMancanti();
  pulizie = await elencaPulizie(periodo());

  if (pulizie.length === 0) {
    mostraAvviso('Le checklist non sono ancora sincronizzate. Controlla la connessione e riprova.');
  }

  pannello.classList.remove('is-caricamento');
  render();
}

async function cambiaPeriodo(direzione: number): Promise<void> {
  const prossimoMese = spostaMesi(mese, direzione);
  const prossimaSettimana = spostaGiorni(settimana, direzione * 7);

  if (direzione > 0) {
    const oltreCorrente = vista === 'mensili'
      ? prossimoMese > getTodayDateString().slice(0, 7)
      : prossimaSettimana > getInizioSettimanaString();
    if (oltreCorrente) return;
  }

  if (direzione < 0) {
    const primaDelRegistro = vista === 'mensili'
      ? prossimoMese < PRIMO_MESE_PULIZIE
      : prossimaSettimana < PRIMA_SETTIMANA_PULIZIE;
    if (primaDelRegistro) return;
  }

  if (vista === 'mensili') mese = prossimoMese;
  else settimana = prossimaSettimana;
  render();
  await caricaPulizie();
}

export function initPulizie(): void {
  if (!pannello) return;

  if (amministratore()) {
    void import('./gestionePulizieUI').then(({ initGestionePulizie }) => {
      gestionePulizie = initGestionePulizie(pannello, caricaPulizie);
      gestionePulizie?.aggiorna(pulizie, periodo());
    });
  }

  pulsantiVista.forEach(btn => {
    btn.addEventListener('click', () => {
      vista = (btn.dataset.vista as VistaPulizie) || 'bagno';
      render();
    });
  });

  pulsantiVista.forEach((btn, indice) => {
    btn.addEventListener('keydown', evento => {
      let prossimo = indice;

      if (evento.key === 'ArrowRight' || evento.key === 'ArrowDown') {
        prossimo = (indice + 1) % pulsantiVista.length;
      } else if (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp') {
        prossimo = (indice - 1 + pulsantiVista.length) % pulsantiVista.length;
      } else if (evento.key === 'Home') {
        prossimo = 0;
      } else if (evento.key === 'End') {
        prossimo = pulsantiVista.length - 1;
      } else {
        return;
      }

      evento.preventDefault();
      const destinazione = pulsantiVista[prossimo];
      vista = (destinazione.dataset.vista as VistaPulizie) || 'bagno';
      render();
      destinazione.focus();
    });
  });

  btnIndietro?.addEventListener('click', () => cambiaPeriodo(-1));
  btnAvanti?.addEventListener('click', () => cambiaPeriodo(1));
  btnCorrente?.addEventListener('click', () => {
    settimana = getInizioSettimanaString();
    mese = getTodayDateString().slice(0, 7);
    caricaPulizie();
  });

  pannello.addEventListener('click', async e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="completa-pulizia"]');
    if (!btn || idInSalvataggio) return;

    const id = btn.dataset.id || '';
    const esistente = pulizie.find(v => v.id === id);
    if (!esistente) return;

    idInSalvataggio = id;
    mostraAvviso('');
    render();

    const aggiornata = await impostaPulizia(id, !esistente.completata);
    idInSalvataggio = '';

    if (!aggiornata) {
      mostraAvviso('La X non è stata salvata sul database. Riprova quando c’è connessione.');
      render();
      return;
    }

    pulizie = pulizie.map(v => (v.id === id ? aggiornata : v));
    render();
    pannello.querySelectorAll<HTMLButtonElement>('[data-action="completa-pulizia"]')
      .forEach(pulsante => {
        if (pulsante.dataset.id === id) pulsante.focus();
      });
  });

  render();
}
