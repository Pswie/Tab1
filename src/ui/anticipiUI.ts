import { amministratore, nomeUtente } from '../services/auth';
import {
  Anticipo,
  BaristaAnticipo,
  aggiungiBaristaAnticipi,
  azzeraAnticipo,
  elencaAnticipi,
  elencaBaristiAnticipi,
  impostaBaristaAttivo,
  registraAnticipo
} from '../services/anticipi';
import { DebitoTurno, elencaDebitiTurno } from '../services/debiti';

const pannello = document.getElementById('tab-anticipi') as HTMLDivElement | null;
const selettore = document.getElementById('anticipi-persone') as HTMLDivElement | null;
const inputData = document.getElementById('anticipi-data') as HTMLInputElement | null;
const inputImporto = document.getElementById('anticipi-importo') as HTMLInputElement | null;
const inputNota = document.getElementById('anticipi-nota') as HTMLInputElement | null;
const btnRegistra = document.getElementById('btn-anticipi-registra') as HTMLButtonElement | null;
const btnRotella = document.getElementById('btn-anticipi-rotella') as HTMLButtonElement | null;
const gestione = document.getElementById('anticipi-gestione') as HTMLDivElement | null;
const inputNome = document.getElementById('anticipi-nuovo-nome') as HTMLInputElement | null;
const btnAggiungiNome = document.getElementById('btn-anticipi-aggiungi-nome') as HTMLButtonElement | null;
const listaNomi = document.getElementById('anticipi-lista-nomi') as HTMLDivElement | null;
const lista = document.getElementById('anticipi-lista') as HTMLDivElement | null;
const avviso = document.getElementById('anticipi-avviso') as HTMLParagraphElement | null;
const totaleMese = document.getElementById('anticipi-totale-mese') as HTMLSpanElement | null;
const riepilogo = document.getElementById('anticipi-riepilogo') as HTMLDivElement | null;
const meseNome = document.getElementById('anticipi-mese-nome') as HTMLSpanElement | null;
const btnMeseIndietro = document.getElementById('btn-anticipi-mese-indietro') as HTMLButtonElement | null;
const btnMeseAvanti = document.getElementById('btn-anticipi-mese-avanti') as HTMLButtonElement | null;
const debitiTotaleMese = document.getElementById('debiti-totale-mese') as HTMLSpanElement | null;
const debitiRiepilogo = document.getElementById('debiti-riepilogo') as HTMLDivElement | null;
const debitiLista = document.getElementById('debiti-lista') as HTMLDivElement | null;

let nomi: BaristaAnticipo[] = [];
let anticipi: Anticipo[] = [];
let debiti: DebitoTurno[] = [];
let baristaIdSelezionato = '';
let mese = meseCorrente();
let inizializzato = false;
let versioneCaricamento = 0;

function oggi(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function meseCorrente(): string {
  return oggi().slice(0, 7);
}

function spostaMese(valore: string, delta: number): string {
  const [anno, numero] = valore.split('-').map(Number);
  const d = new Date(anno, numero - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function estremiMese(valore: string): [string, string] {
  const [anno, numero] = valore.split('-').map(Number);
  const ultimo = new Date(anno, numero, 0).getDate();
  return [`${valore}-01`, `${valore}-${String(ultimo).padStart(2, '0')}`];
}

function nomeMese(valore: string): string {
  const [anno, numero] = valore.split('-').map(Number);
  const testo = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
    .format(new Date(anno, numero - 1, 1));
  return testo.charAt(0).toLocaleUpperCase('it') + testo.slice(1);
}

function dataItaliana(valore: string): string {
  const [anno, meseNumero, giorno] = valore.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(anno, meseNumero - 1, giorno));
}

function euro(valore: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(valore);
}

function escapeHtml(testo: string): string {
  const el = document.createElement('span');
  el.textContent = testo;
  return el.innerHTML;
}

function mostraAvviso(testo: string, errore = false): void {
  if (!avviso) return;
  avviso.textContent = testo;
  avviso.classList.toggle('is-hidden', !testo);
  avviso.classList.toggle('is-error', errore);
}

function attivi(): BaristaAnticipo[] {
  return nomi.filter(n => n.attivo);
}

function renderPersone(): void {
  if (!selettore) return;

  const disponibili = attivi();
  if (!disponibili.some(n => n.id === baristaIdSelezionato)) {
    baristaIdSelezionato = disponibili[0]?.id || '';
  }

  selettore.innerHTML = disponibili.map(n => `
    <button type="button" class="anticipi-persona${n.id === baristaIdSelezionato ? ' is-active' : ''}"
            data-barista-id="${escapeHtml(n.id)}" aria-pressed="${n.id === baristaIdSelezionato}">
      <span class="anticipi-persona-avatar">${escapeHtml(n.nome.charAt(0).toLocaleUpperCase('it'))}</span>
      <span>${escapeHtml(n.nome)}</span>
    </button>
  `).join('');

  if (disponibili.length === 0) {
    selettore.innerHTML = '<p class="anticipi-vuoto-inline">Aggiungi almeno un nome dalla rotellina.</p>';
  }

  if (btnRegistra) btnRegistra.disabled = disponibili.length === 0;
}

function renderGestione(): void {
  if (!listaNomi) return;

  listaNomi.innerHTML = nomi.map(n => `
    <div class="anticipi-nome-riga${n.attivo ? '' : ' is-inactive'}">
      <span>${escapeHtml(n.nome)}</span>
      <button type="button" class="anticipi-nome-stato" data-nome-id="${escapeHtml(n.id)}"
              data-attivo="${n.attivo ? 'false' : 'true'}">
        ${n.attivo ? 'Nascondi' : 'Riattiva'}
      </button>
    </div>
  `).join('');
}

function renderRegistro(): void {
  if (meseNome) meseNome.textContent = nomeMese(mese);
  if (btnMeseAvanti) btnMeseAvanti.disabled = mese >= meseCorrente();

  const totale = anticipi.reduce((somma, a) => somma + a.importo, 0);
  if (totaleMese) totaleMese.textContent = euro(totale);

  const perPersona = new Map<string, number>();
  anticipi.forEach(a => perPersona.set(a.baristaNome, (perPersona.get(a.baristaNome) || 0) + a.importo));

  if (riepilogo) {
    riepilogo.innerHTML = [...perPersona.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([nome, importo]) => `
        <div class="anticipi-riepilogo-voce">
          <span>${escapeHtml(nome)}</span>
          <strong>${euro(importo)}</strong>
        </div>
      `).join('');
    riepilogo.classList.toggle('is-hidden', perPersona.size === 0);
  }

  if (!lista) return;

  if (anticipi.length === 0) {
    lista.innerHTML = `
      <div class="anticipi-vuoto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 7h16"/><path d="M7 3v4M17 3v4"/><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 12h8M8 16h5"/></svg>
        <strong>Nessun anticipo in questo mese</strong>
        <span>Quando ne registri uno comparirà qui.</span>
      </div>`;
    return;
  }

  lista.innerHTML = anticipi.map(a => `
    <article class="anticipi-riga">
      <div class="anticipi-riga-data">
        <span>${dataItaliana(a.data)}</span>
      </div>
      <div class="anticipi-riga-persona">
        <strong>${escapeHtml(a.baristaNome)}</strong>
        ${a.nota ? `<span>${escapeHtml(a.nota)}</span>` : '<span>Senza nota</span>'}
      </div>
      <strong class="anticipi-riga-importo">${euro(a.importo)}</strong>
      <button type="button" class="anticipi-azzera" data-anticipo-id="${escapeHtml(a.id)}"
              aria-label="Azzera anticipo di ${escapeHtml(a.baristaNome)}" title="Azzera senza cancellare">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M8 12h8"/></svg>
        <span>Azzera</span>
      </button>
    </article>
  `).join('');
}

function renderDebiti(): void {
  const totale = debiti.reduce((somma, d) => somma + d.importo, 0);
  if (debitiTotaleMese) debitiTotaleMese.textContent = euro(totale);

  const perPersona = new Map<string, number>();
  debiti.filter(d => d.assegnato).forEach(d => {
    perPersona.set(d.persona, (perPersona.get(d.persona) || 0) + d.importo);
  });

  if (debitiRiepilogo) {
    debitiRiepilogo.innerHTML = [...perPersona.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([persona, importo]) => `
        <div class="anticipi-riepilogo-voce debiti-riepilogo-voce">
          <span>${escapeHtml(persona)}</span>
          <strong>${euro(importo)}</strong>
        </div>
      `).join('');
    debitiRiepilogo.classList.toggle('is-hidden', perPersona.size === 0);
  }

  if (!debitiLista) return;

  if (debiti.length === 0) {
    debitiLista.innerHTML = `
      <div class="anticipi-vuoto debiti-vuoto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 3v18M17 7.5c0-1.7-2-3-5-3s-5 1.3-5 3 1.4 2.6 5 3.5 5 1.8 5 3.5-2 3-5 3-5-1.3-5-3"/></svg>
        <strong>Nessun ammanco nel mese</strong>
        <span>I debiti compaiono automaticamente quando una cassa chiude in negativo.</span>
      </div>`;
    return;
  }

  debitiLista.innerHTML = debiti.map(d => {
    const turno = d.turno === 'mattina' ? 'Turno 1' : 'Turno 2';
    const dettaglio = d.assegnato
      ? `Ammanco di ${euro(d.ammancoTotale)} diviso tra ${d.personeNelTurno} ${d.personeNelTurno === 1 ? 'persona' : 'persone'}`
      : 'Nessun nome assegnato a questo turno';

    return `
      <article class="anticipi-riga debiti-riga${d.assegnato ? '' : ' is-da-assegnare'}">
        <div class="anticipi-riga-data">
          <span>${dataItaliana(d.data)}</span>
          <small>${turno}</small>
        </div>
        <div class="anticipi-riga-persona">
          <strong>${escapeHtml(d.persona)}</strong>
          <span>${dettaglio}</span>
        </div>
        <strong class="anticipi-riga-importo debiti-riga-importo">${euro(d.importo)}</strong>
      </article>`;
  }).join('');
}

async function caricaRegistro(): Promise<void> {
  if (!pannello || !amministratore()) return;
  const versione = ++versioneCaricamento;
  pannello.classList.add('is-caricamento');

  const [dal, al] = estremiMese(mese);
  const [nomiLetti, anticipiLetti, debitiLetti] = await Promise.all([
    elencaBaristiAnticipi(),
    elencaAnticipi(dal, al),
    elencaDebitiTurno(dal, al)
  ]);

  if (versione !== versioneCaricamento) return;
  nomi = nomiLetti;
  anticipi = anticipiLetti;
  debiti = debitiLetti;
  renderPersone();
  renderGestione();
  renderRegistro();
  renderDebiti();
  pannello.classList.remove('is-caricamento');
}

async function salvaAnticipo(): Promise<void> {
  const barista = nomi.find(n => n.id === baristaIdSelezionato && n.attivo);
  const data = inputData?.value || '';
  const importo = Number((inputImporto?.value || '').replace(',', '.'));

  if (!barista) {
    mostraAvviso('Scegli un barista.', true);
    return;
  }
  if (!data) {
    mostraAvviso('Scegli la data dell’anticipo.', true);
    inputData?.focus();
    return;
  }
  if (!Number.isFinite(importo) || importo <= 0) {
    mostraAvviso('Scrivi un importo maggiore di zero.', true);
    inputImporto?.focus();
    return;
  }

  btnRegistra!.disabled = true;
  mostraAvviso('');
  const esito = await registraAnticipo(barista, data, Math.round(importo * 100) / 100, inputNota?.value || '', nomeUtente());
  btnRegistra!.disabled = false;

  if (inputImporto) inputImporto.value = '';
  if (inputNota) inputNota.value = '';

  mese = data.slice(0, 7);
  await caricaRegistro();
  mostraAvviso(esito.suCloud ? 'Anticipo registrato.' : 'Anticipo salvato solo su questo dispositivo: controlla la connessione.');
  inputImporto?.focus();
}

async function aggiungiNome(): Promise<void> {
  const nome = inputNome?.value.trim() || '';
  if (!nome) {
    mostraAvviso('Scrivi il nome da aggiungere.', true);
    inputNome?.focus();
    return;
  }

  const esito = await aggiungiBaristaAnticipi(nome);
  if (inputNome) inputNome.value = '';
  nomi = await elencaBaristiAnticipi();
  baristaIdSelezionato = esito.valore.id;
  renderPersone();
  renderGestione();
  mostraAvviso(esito.suCloud ? `${esito.valore.nome} aggiunto all’elenco.` : `${esito.valore.nome} aggiunto solo su questo dispositivo.`);
}

/** Rilegge i dati quando si apre la scheda. */
export async function caricaAnticipi(): Promise<void> {
  await caricaRegistro();
}

export function initAnticipi(): void {
  if (!pannello || !amministratore() || inizializzato) return;
  inizializzato = true;

  if (inputData) {
    inputData.value = oggi();
    inputData.max = oggi();
  }

  selettore?.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-barista-id]') as HTMLButtonElement | null;
    if (!pulsante) return;
    baristaIdSelezionato = pulsante.dataset.baristaId || '';
    renderPersone();
  });

  btnRegistra?.addEventListener('click', salvaAnticipo);
  [inputImporto, inputNota].forEach(campo => campo?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      salvaAnticipo();
    }
  }));

  btnRotella?.addEventListener('click', () => {
    const aperta = gestione?.classList.toggle('is-open') || false;
    btnRotella.setAttribute('aria-expanded', String(aperta));
    btnRotella.classList.toggle('is-active', aperta);
    if (aperta) inputNome?.focus();
  });

  btnAggiungiNome?.addEventListener('click', aggiungiNome);
  inputNome?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      aggiungiNome();
    }
  });

  listaNomi?.addEventListener('click', async e => {
    const pulsante = (e.target as HTMLElement).closest('[data-nome-id]') as HTMLButtonElement | null;
    if (!pulsante) return;
    await impostaBaristaAttivo(pulsante.dataset.nomeId || '', pulsante.dataset.attivo === 'true');
    nomi = await elencaBaristiAnticipi();
    renderPersone();
    renderGestione();
  });

  lista?.addEventListener('click', async e => {
    const pulsante = (e.target as HTMLElement).closest('[data-anticipo-id]') as HTMLButtonElement | null;
    if (!pulsante) return;
    const voce = anticipi.find(a => a.id === pulsante.dataset.anticipoId);
    if (!voce || !window.confirm(`Azzerare l’anticipo di ${euro(voce.importo)} per ${voce.baristaNome}? Il dato resterà salvato nello storico amministrativo.`)) return;
    const suCloud = await azzeraAnticipo(voce.id);
    anticipi = anticipi.filter(a => a.id !== voce.id);
    renderRegistro();
    mostraAvviso(suCloud ? 'Anticipo azzerato. Il dato resta salvato in tabella.' : 'Azzerato solo su questo dispositivo: controlla la connessione.');
  });

  btnMeseIndietro?.addEventListener('click', async () => {
    mese = spostaMese(mese, -1);
    mostraAvviso('');
    await caricaRegistro();
  });

  btnMeseAvanti?.addEventListener('click', async () => {
    if (mese >= meseCorrente()) return;
    mese = spostaMese(mese, 1);
    mostraAvviso('');
    await caricaRegistro();
  });

  renderRegistro();
  renderDebiti();
}
