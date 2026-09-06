import { amministratore, nomeUtente } from '../services/auth';
import {
  Anticipo,
  BaristaAnticipo,
  aggiungiBaristaAnticipi,
  azzeraAnticipo,
  elencaAnticipi,
  elencaBaristiAnticipi,
  impostaBaristaAttivo,
  impostaCompensoBarista,
  registraAnticipo
} from '../services/anticipi';
import {
  DebitoTurno,
  azzeraDebitoTurno,
  elencaDebitiTurno,
  modificaDebitoTurno
} from '../services/debiti';

const pannello = document.getElementById('tab-anticipi') as HTMLDivElement | null;
const pannelloAmmanchi = document.getElementById('tab-ammanchi') as HTMLDivElement | null;
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
const debitiTotaleAperto = document.getElementById('debiti-totale-aperto') as HTMLSpanElement | null;
const debitiRiepilogo = document.getElementById('debiti-riepilogo') as HTMLDivElement | null;
const debitiLista = document.getElementById('debiti-lista') as HTMLDivElement | null;
const debitiAvviso = document.getElementById('debiti-avviso') as HTMLParagraphElement | null;

let nomi: BaristaAnticipo[] = [];
let anticipi: Anticipo[] = [];
let debiti: DebitoTurno[] = [];
let debitoInModifica = '';
let baristaIdSelezionato = '';
let mese = meseCorrente();
let inizializzato = false;
let versioneCaricamento = 0;
let versioneCaricamentoAmmanchi = 0;

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

function mostraAvvisoDebiti(testo: string, errore = false): void {
  if (!debitiAvviso) return;
  debitiAvviso.textContent = testo;
  debitiAvviso.classList.toggle('is-hidden', !testo);
  debitiAvviso.classList.toggle('is-error', errore);
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
      <span class="anticipi-persona-info">
        <span class="anticipi-persona-nome">${escapeHtml(n.nome)}</span>
        <span class="anticipi-persona-compenso">${n.compensoMensile > 0 ? euro(n.compensoMensile) : '0,00 €'}/mese</span>
      </span>
    </button>
  `).join('');

  if (disponibili.length === 0) {
    selettore.innerHTML = '<p class="anticipi-vuoto-inline">Aggiungi almeno un barista dalla rotellina.</p>';
  }

  if (btnRegistra) btnRegistra.disabled = disponibili.length === 0;
}

function renderGestione(): void {
  if (!listaNomi) return;

  listaNomi.innerHTML = nomi.map(n => `
    <div class="anticipi-nome-riga${n.attivo ? '' : ' is-inactive'}" data-nome-row="${escapeHtml(n.id)}">
      <div class="anticipi-nome-sinistra">
        <span class="anticipi-nome-label">${escapeHtml(n.nome)}</span>
        <button type="button" class="anticipi-nome-stato" data-nome-id="${escapeHtml(n.id)}"
                data-attivo="${n.attivo ? 'false' : 'true'}">
          ${n.attivo ? 'Nascondi' : 'Riattiva'}
        </button>
      </div>
      <div class="anticipi-nome-destra">
        <label class="anticipi-compenso-label" title="Compenso mensile di riferimento">
          <span>Quota/mese:</span>
          <span class="anticipi-input-euro sm">
            <input type="text" class="todo-add-input anticipi-input-compenso" data-compenso-id="${escapeHtml(n.id)}"
                   inputmode="decimal" value="${n.compensoMensile > 0 ? n.compensoMensile : ''}" placeholder="0,00" autocomplete="off" />
            <span>&euro;</span>
          </span>
        </label>
        <button type="button" class="btn-secondary-action btn-salva-compenso" data-salva-compenso="${escapeHtml(n.id)}"
                title="Salva la quota base mensile">
          Salva
        </button>
      </div>
    </div>
  `).join('');
}

function renderRegistro(): void {
  if (meseNome) meseNome.textContent = nomeMese(mese);
  if (btnMeseAvanti) btnMeseAvanti.disabled = mese >= meseCorrente();

  const totaleAnticipiMese = anticipi.reduce((somma, a) => somma + a.importo, 0);
  if (totaleMese) totaleMese.textContent = euro(totaleAnticipiMese);

  const personeAttive = attivi();

  if (riepilogo) {
    if (personeAttive.length === 0) {
      riepilogo.innerHTML = '';
      riepilogo.classList.add('is-hidden');
    } else {
      riepilogo.innerHTML = personeAttive.map(b => {
        const anticipiPersona = anticipi.filter(a =>
          (a.baristaId && a.baristaId === b.id) ||
          a.baristaNome.localeCompare(b.nome, 'it', { sensitivity: 'base' }) === 0
        );
        const totaleAnticipato = anticipiPersona.reduce((s, a) => s + a.importo, 0);
        const compenso = b.compensoMensile;
        const differenza = compenso - totaleAnticipato;

        let badgeClasse = '';
        let badgeEtichetta = '';
        let badgeValore = '';

        if (totaleAnticipato === 0) {
          badgeClasse = 'badge-da-saldare';
          badgeEtichetta = 'Da corrispondere:';
          badgeValore = euro(compenso);
        } else if (differenza > 0) {
          badgeClasse = 'badge-residuo';
          badgeEtichetta = 'Rimanente a saldo:';
          badgeValore = euro(differenza);
        } else if (differenza === 0) {
          badgeClasse = 'badge-saldato';
          badgeEtichetta = 'Saldo:';
          badgeValore = 'Interamente saldato (0,00 €)';
        } else {
          badgeClasse = 'badge-supero';
          badgeEtichetta = 'Anticipato in più:';
          badgeValore = `+${euro(Math.abs(differenza))}`;
        }

        return `
          <div class="anticipi-riepilogo-card">
            <div class="anticipi-card-header">
              <div class="anticipi-card-persona">
                <span class="anticipi-persona-avatar sm">${escapeHtml(b.nome.charAt(0).toLocaleUpperCase('it'))}</span>
                <strong>${escapeHtml(b.nome)}</strong>
              </div>
              <div class="anticipi-card-quota">
                <span class="anticipi-card-sublabel">Quota base:</span>
                <strong>${euro(compenso)}</strong>
              </div>
            </div>
            <div class="anticipi-card-corpo">
              <div class="anticipi-card-riga">
                <span>Anticipi erogati nel mese:</span>
                <span class="anticipi-card-valore">${euro(totaleAnticipato)}</span>
              </div>
              <div class="anticipi-card-riga anticipi-card-saldo ${badgeClasse}">
                <span>${badgeEtichetta}</span>
                <strong>${badgeValore}</strong>
              </div>
            </div>
          </div>
        `;
      }).join('');
      riepilogo.classList.remove('is-hidden');
    }
  }

  if (!lista) return;

  if (anticipi.length === 0) {
    lista.innerHTML = `
      <div class="anticipi-vuoto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 7h16"/><path d="M7 3v4M17 3v4"/><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 12h8M8 16h5"/></svg>
        <strong>Nessun anticipo in questo mese</strong>
        <span>Quando ne registri uno comparirà qui. Le quote base mensili restano conservate.</span>
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
  if (debitiTotaleAperto) debitiTotaleAperto.textContent = euro(totale);

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
        <strong>Nessun ammanco aperto</strong>
        <span>I debiti compaiono automaticamente quando una cassa chiude in negativo e spariscono solo a saldo zero.</span>
      </div>`;
    return;
  }

  debitiLista.innerHTML = debiti.map(d => {
    const turno = d.turno === 'mattina' ? 'Turno 1' : 'Turno 2';
    const dettaglioCalcolato = d.assegnato
      ? `Ammanco di ${euro(d.ammancoTotale)} diviso tra ${d.personeNelTurno} ${d.personeNelTurno === 1 ? 'persona' : 'persone'}`
      : 'Nessun nome assegnato a questo turno';
    const dettaglio = d.modificatoManualmente
      ? `Corretto da ${euro(d.importoCalcolato)}${d.notaModifica ? ` · ${escapeHtml(d.notaModifica)}` : ''}`
      : dettaglioCalcolato;

    if (debitoInModifica === d.id) {
      return `
        <article class="debiti-modifica" data-debito-riga="${escapeHtml(d.id)}">
          <div class="debiti-modifica-testa">
            <strong>${escapeHtml(d.persona)}</strong>
            <span>${dataItaliana(d.data)} · ${turno} · calcolato ${euro(d.importoCalcolato)}</span>
          </div>
          <label class="anticipi-campo">
            <span>Debito residuo</span>
            <span class="anticipi-input-euro">
              <input type="text" class="todo-add-input" data-debito-campo="importo"
                     inputmode="decimal" value="${String(d.importo).replace('.', ',')}" autocomplete="off" />
              <span>&euro;</span>
            </span>
          </label>
          <label class="anticipi-campo debiti-modifica-nota">
            <span>Motivo della modifica</span>
            <input type="text" class="todo-add-input" data-debito-campo="nota"
                   value="${escapeHtml(d.notaModifica)}" placeholder="Es. restituiti 3 €" autocomplete="off" />
          </label>
          <div class="debiti-modifica-azioni">
            <button type="button" class="btn-secondary-action" data-debito-action="annulla">Annulla</button>
            <button type="button" class="todo-add-btn" data-debito-action="salva">Salva modifica</button>
          </div>
        </article>`;
    }

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
        ${d.assegnato ? `
          <div class="debiti-riga-azioni">
            <button type="button" class="btn-secondary-action debiti-btn" data-debito-action="modifica"
                    data-debito-id="${escapeHtml(d.id)}">Modifica</button>
            <button type="button" class="anticipi-azzera" data-debito-action="azzera"
                    data-debito-id="${escapeHtml(d.id)}">Azzera</button>
          </div>` : ''}
      </article>`;
  }).join('');
}

async function salvaModificaDebito(riga: HTMLElement): Promise<void> {
  const debito = debiti.find(d => d.id === debitoInModifica);
  if (!debito) return;

  const campoImporto = riga.querySelector('[data-debito-campo="importo"]') as HTMLInputElement | null;
  const campoNota = riga.querySelector('[data-debito-campo="nota"]') as HTMLInputElement | null;
  const importo = Number((campoImporto?.value || '').replace(',', '.'));

  if (!Number.isFinite(importo) || importo < 0) {
    mostraAvvisoDebiti('Scrivi un debito uguale o maggiore di zero.', true);
    campoImporto?.focus();
    return;
  }

  const esito = await modificaDebitoTurno(
    debito.id,
    Math.round(importo * 100) / 100,
    campoNota?.value || '',
    nomeUtente()
  );

  debitoInModifica = '';
  const valoreAggiornato = esito.valore;
  debiti = valoreAggiornato
    ? debiti.map(d => d.id === debito.id ? valoreAggiornato : d)
    : debiti.filter(d => d.id !== debito.id);
  renderDebiti();
  mostraAvvisoDebiti(
    esito.suCloud
      ? (importo === 0 ? 'Debito azzerato e conservato nello storico.' : 'Debito aggiornato.')
      : 'Modifica salvata solo su questo dispositivo: controlla la connessione.'
  );
}

async function azzeraDebito(id: string): Promise<void> {
  const debito = debiti.find(d => d.id === id);
  if (!debito) return;

  if (!window.confirm(`Azzerare il debito di ${euro(debito.importo)} per ${debito.persona}? La riga resterà salvata nello storico amministrativo.`)) {
    return;
  }

  const suCloud = await azzeraDebitoTurno(id, nomeUtente());
  debiti = debiti.filter(d => d.id !== id);
  renderDebiti();
  mostraAvvisoDebiti(
    suCloud
      ? 'Debito azzerato. Il dato resta salvato in tabella.'
      : 'Debito azzerato solo su questo dispositivo: controlla la connessione.'
  );
}

async function caricaRegistro(): Promise<void> {
  if (!pannello || !amministratore()) return;
  const versione = ++versioneCaricamento;
  pannello.classList.add('is-caricamento');

  const [dal, al] = estremiMese(mese);
  const [nomiLetti, anticipiLetti] = await Promise.all([
    elencaBaristiAnticipi(),
    elencaAnticipi(dal, al)
  ]);

  if (versione !== versioneCaricamento) return;
  nomi = nomiLetti;
  anticipi = anticipiLetti;
  renderPersone();
  renderGestione();
  renderRegistro();
  pannello.classList.remove('is-caricamento');
}

async function caricaRegistroAmmanchi(): Promise<void> {
  if (!pannelloAmmanchi || !amministratore()) return;
  const versione = ++versioneCaricamentoAmmanchi;
  pannelloAmmanchi.classList.add('is-caricamento');

  const letti = await elencaDebitiTurno();
  if (versione !== versioneCaricamentoAmmanchi) return;

  debiti = letti;
  renderDebiti();
  pannelloAmmanchi.classList.remove('is-caricamento');
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

/** Gli ammanchi sono cumulativi: rilegge tutte le posizioni ancora aperte. */
export async function caricaAmmanchi(): Promise<void> {
  await caricaRegistroAmmanchi();
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
    const btnStato = (e.target as HTMLElement).closest('[data-nome-id]') as HTMLButtonElement | null;
    if (btnStato) {
      await impostaBaristaAttivo(btnStato.dataset.nomeId || '', btnStato.dataset.attivo === 'true');
      nomi = await elencaBaristiAnticipi();
      renderPersone();
      renderGestione();
      renderRegistro();
      return;
    }

    const btnSalva = (e.target as HTMLElement).closest('[data-salva-compenso]') as HTMLButtonElement | null;
    if (btnSalva) {
      const id = btnSalva.dataset.salvaCompenso || '';
      const riga = btnSalva.closest('[data-nome-row]');
      const input = riga?.querySelector<HTMLInputElement>('.anticipi-input-compenso');
      const importo = Number((input?.value || '').replace(',', '.'));

      if (Number.isFinite(importo) && importo >= 0) {
        btnSalva.disabled = true;
        const esito = await impostaCompensoBarista(id, importo);
        btnSalva.disabled = false;
        nomi = await elencaBaristiAnticipi();
        renderPersone();
        renderGestione();
        renderRegistro();
        mostraAvviso(esito.suCloud ? 'Quota mensile base aggiornata con successo.' : 'Quota salvata solo su questo dispositivo.');
      } else {
        mostraAvviso('Inserisci una cifra valida per la quota mensile (0 o più).', true);
        input?.focus();
      }
    }
  });

  listaNomi?.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLInputElement;
      if (target && target.classList.contains('anticipi-input-compenso')) {
        e.preventDefault();
        const id = target.dataset.compensoId || '';
        const importo = Number((target.value || '').replace(',', '.'));
        if (Number.isFinite(importo) && importo >= 0) {
          const esito = await impostaCompensoBarista(id, importo);
          nomi = await elencaBaristiAnticipi();
          renderPersone();
          renderGestione();
          renderRegistro();
          mostraAvviso(esito.suCloud ? 'Quota mensile base aggiornata con successo.' : 'Quota salvata solo su questo dispositivo.');
        } else {
          mostraAvviso('Inserisci una cifra valida per la quota mensile (0 o più).', true);
        }
      }
    }
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

  debitiLista?.addEventListener('click', e => {
    const pulsante = (e.target as HTMLElement).closest('[data-debito-action]') as HTMLButtonElement | null;
    if (!pulsante) return;

    const azione = pulsante.dataset.debitoAction;
    const id = pulsante.dataset.debitoId || pulsante.closest<HTMLElement>('[data-debito-riga]')?.dataset.debitoRiga || '';

    if (azione === 'modifica') {
      debitoInModifica = id;
      mostraAvvisoDebiti('');
      renderDebiti();
      debitiLista.querySelector<HTMLInputElement>('[data-debito-campo="importo"]')?.focus();
    } else if (azione === 'annulla') {
      debitoInModifica = '';
      renderDebiti();
    } else if (azione === 'salva') {
      const riga = pulsante.closest('[data-debito-riga]') as HTMLElement | null;
      if (riga) salvaModificaDebito(riga);
    } else if (azione === 'azzera') {
      azzeraDebito(id);
    }
  });

  debitiLista?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const riga = (e.target as HTMLElement).closest('[data-debito-riga]') as HTMLElement | null;
    if (!riga) return;
    e.preventDefault();
    salvaModificaDebito(riga);
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
