import '../gestione-pulizie.css';
import { amministratore } from '../services/auth';
import { assegnaResponsabiliPulizia, elencaIncongruenzePulizie, PeriodoPulizie, Pulizia } from '../services/pulizie';
import { elencaSchedeTurni } from '../services/schedeTurni';
import { getTodayDateString } from '../utils/calculations';

export interface GestionePulizie { aggiorna(voci: Pulizia[], periodo: PeriodoPulizie): void }

function escapeHtml(testo: string): string {
  return testo.replace(/[&<>"']/g, carattere => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[carattere]!));
}

export function initGestionePulizie(pannello: HTMLElement, ricarica: () => Promise<void>): GestionePulizie | null {
  if (!amministratore()) return null;
  let voci: Pulizia[] = [];
  let periodo: PeriodoPulizie;
  let richiesta = 0;
  let aperta: Pulizia | null = null;
  let occupato = false;
  let avvisi = new Map<string, string[]>();

  const riepilogo = document.createElement('div');
  riepilogo.className = 'pulizie-verifica-admin';
  riepilogo.hidden = true;
  riepilogo.innerHTML = '<p role="status" aria-live="polite"></p><button type="button" class="pulizia-gestione-btn">Verifica assegnazioni</button>';
  pannello.querySelector('.section-header')?.after(riepilogo);
  const stato = riepilogo.querySelector('p')!;

  const dialog = document.createElement('dialog');
  dialog.className = 'pulizia-assegna-dialog';
  dialog.setAttribute('aria-labelledby', 'pulizia-assegna-titolo');
  dialog.innerHTML = `<form>
    <div class="pulizia-assegna-testa"><div><h2 id="pulizia-assegna-titolo">Responsabili della pulizia</h2><p class="pulizia-assegna-contesto"></p></div><button type="button" class="pulizia-gestione-btn" data-azione="chiudi">Chiudi</button></div>
    <p class="pulizia-assegna-nota">Scegli chi se ne occupa per questa attività. L’assegnazione resta valida per questo periodo anche se cambiano i turni.</p>
    <div class="pulizia-assegna-avvisi" hidden></div>
    <fieldset><legend>Dipendenti approvati</legend><div class="pulizia-assegna-persone"></div></fieldset>
    <p class="pulizia-assegna-esito" role="status" aria-live="polite"></p>
    <div class="pulizia-assegna-azioni"><button type="button" class="pulizia-gestione-btn" data-azione="automatico">Ripristina assegnazione automatica</button><button type="submit" class="pulizia-gestione-btn primario">Salva responsabili</button></div>
  </form>`;
  document.body.append(dialog);
  const elencoPersone = dialog.querySelector<HTMLElement>('.pulizia-assegna-persone')!;
  const esito = dialog.querySelector<HTMLElement>('.pulizia-assegna-esito')!;

  function modificabile(voce: Pulizia): boolean {
    const oggi = getTodayDateString();
    return !voce.completata && !voce.nonFatta && voce.periodoInizio <= oggi && voce.periodoFine >= oggi;
  }

  function comandi(): void {
    pannello.querySelectorAll<HTMLElement>('[data-pulizia-id]').forEach(riga => {
      const voce = voci.find(elemento => elemento.id === riga.dataset.puliziaId);
      riga.querySelector('.pulizia-gestione')?.remove();
      riga.classList.remove('ha-incongruenze');
      if (!voce || !modificabile(voce)) return;
      const box = document.createElement('div');
      box.className = 'pulizia-gestione';
      const messaggi = avvisi.get(voce.id) ?? [];
      if (messaggi.length) {
        riga.classList.add('ha-incongruenze');
        const problema = document.createElement('p');
        problema.className = 'pulizia-incongruenza';
        problema.textContent = messaggi.join(' ');
        box.append(problema);
      }
      if (voce.assegnazioneManuale) {
        const nota = document.createElement('span');
        nota.className = 'pulizia-assegnazione-manuale';
        nota.textContent = 'Assegnazione personalizzata';
        box.append(nota);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pulizia-gestione-btn';
      button.dataset.modificaPulizia = voce.id;
      button.textContent = messaggi.length ? 'Correggi responsabili' : 'Modifica responsabili';
      button.setAttribute('aria-label', `${button.textContent}: ${voce.voce}`);
      box.append(button);
      riga.querySelector('.pulizia-corpo')?.append(box);
    });
  }

  async function verifica(): Promise<void> {
    if (!amministratore() || !periodo || !voci.length || !pannello.classList.contains('active')) return;
    const versione = ++richiesta;
    riepilogo.hidden = false;
    stato.textContent = 'Verifica delle assegnazioni in corso…';
    try {
      const problemi = await elencaIncongruenzePulizie(periodo);
      if (versione !== richiesta) return;
      avvisi = new Map(problemi.map(problema => [problema.id, problema.avvisi]));
      const numero = problemi.filter(problema => problema.avvisi.length && voci.some(voce => voce.id === problema.id && modificabile(voce))).length;
      stato.textContent = numero ? `${numero} attività da verificare. Trovi il motivo accanto alla pulizia.` : 'Assegnazioni verificate: nessuna incongruenza rilevata.';
      riepilogo.classList.toggle('ha-problemi', numero > 0);
      comandi();
    } catch (errore) {
      if (versione !== richiesta) return;
      stato.textContent = errore instanceof Error ? errore.message : 'Verifica non disponibile. Riprova.';
      riepilogo.classList.add('ha-problemi');
    }
  }

  function blocca(valore: boolean): void {
    occupato = valore;
    dialog.setAttribute('aria-busy', String(valore));
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = valore; });
    dialog.querySelector('fieldset')!.disabled = valore;
  }

  async function apri(voce: Pulizia): Promise<void> {
    if (occupato || !amministratore() || !modificabile(voce)) return;
    aperta = voce;
    dialog.querySelector('h2')!.textContent = `Responsabili · ${voce.voce}`;
    dialog.querySelector('.pulizia-assegna-contesto')!.textContent = voce.tipo === 'bagno'
      ? `Bagno · ${voce.previstaIl ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(new Date(`${voce.previstaIl}T12:00:00`)) : voce.voce}`
      : voce.tipo === 'settimanale' ? `Pulizie settimanali · ${voce.turno}` : 'Pulizie mensili';
    const problemi = dialog.querySelector<HTMLElement>('.pulizia-assegna-avvisi')!;
    problemi.textContent = (avvisi.get(voce.id) ?? []).join(' ');
    problemi.hidden = !problemi.textContent;
    elencoPersone.replaceChildren();
    esito.textContent = 'Caricamento dei dipendenti…';
    esito.setAttribute('role', 'status');
    dialog.showModal();
    blocca(true);
    // Durante la lettura è sempre possibile chiudere il dialogo.
    dialog.querySelector<HTMLButtonElement>('[data-azione="chiudi"]')!.disabled = false;
    try {
      const persone = await elencaSchedeTurni(getTodayDateString());
      if (!dialog.open || aperta?.id !== voce.id) return;
      elencoPersone.innerHTML = persone.map(persona => {
        const selezionata = (voce.responsabiliProfili ?? []).includes(persona.id);
        return `<label><input type="checkbox" name="responsabile" value="${escapeHtml(persona.id)}"${selezionata ? ' checked' : ''}><span>${escapeHtml(persona.nome)}</span></label>`;
      }).join('');
      esito.textContent = persone.length ? '' : 'Nessun dipendente approvato disponibile.';
    } catch (errore) {
      esito.textContent = errore instanceof Error ? errore.message : 'Impossibile caricare i dipendenti.';
      esito.setAttribute('role', 'alert');
    } finally {
      blocca(false);
      if (!elencoPersone.childElementCount) dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = true;
    }
  }

  async function salva(automatico: boolean): Promise<void> {
    if (!aperta || occupato || !amministratore()) return;
    const idSalvato = aperta.id;
    const profili = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[name="responsabile"]:checked')).map(input => input.value);
    blocca(true);
    esito.textContent = 'Salvataggio dei responsabili…';
    esito.setAttribute('role', 'status');
    try {
      await assegnaResponsabiliPulizia(aperta.id, profili, automatico);
      dialog.close();
      aperta = null;
      await ricarica();
      if (pannello.classList.contains('active')) {
        Array.from(pannello.querySelectorAll<HTMLButtonElement>('[data-modifica-pulizia]'))
          .find(button => button.dataset.modificaPulizia === idSalvato)?.focus({ preventScroll: true });
      }
    } catch (errore) {
      esito.textContent = errore instanceof Error ? errore.message : 'Responsabili non salvati. Riprova.';
      esito.setAttribute('role', 'alert');
    } finally { blocca(false); }
  }

  pannello.addEventListener('click', evento => {
    const button = (evento.target as HTMLElement).closest<HTMLElement>('[data-modifica-pulizia]');
    if (!button) return;
    const voce = voci.find(elemento => elemento.id === button.dataset.modificaPulizia);
    if (voce) void apri(voce);
  });
  riepilogo.querySelector('button')!.addEventListener('click', () => void verifica());
  dialog.querySelector('[data-azione="chiudi"]')!.addEventListener('click', () => { dialog.close(); aperta = null; });
  dialog.addEventListener('cancel', evento => { if (occupato) evento.preventDefault(); });
  dialog.querySelector('form')!.addEventListener('submit', evento => { evento.preventDefault(); void salva(false); });
  dialog.querySelector('[data-azione="automatico"]')!.addEventListener('click', () => void salva(true));

  return { aggiorna(nuove, nuovoPeriodo) {
    voci = nuove;
    periodo = nuovoPeriodo;
    if (!voci.length) { richiesta++; riepilogo.hidden = true; }
    comandi();
    void verifica();
  } };
}
