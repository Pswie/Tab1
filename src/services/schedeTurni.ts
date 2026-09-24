import { amministratore } from './auth';
import { isSupabaseConfigured, supabase } from './supabase';
import { SquadraTurni } from './turni';

export interface SchedaTurni {
  id: string;
  nome: string;
  squadra: SquadraTurni | null;
  festaMattina: number | null;
  festaPomeriggio: number | null;
  validaDal: string | null;
  configurata: boolean;
  prossimaValidaDal: string | null;
}

export interface ImpostazioniSchedaTurni {
  profiloId: string;
  validaDal: string;
  squadra: SquadraTurni | null;
  festaMattina: number | null;
  festaPomeriggio: number | null;
}

function clientAdmin() {
  if (!amministratore()) throw new Error('Solo l’amministratore può gestire le schede dei dipendenti.');
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Collegati al servizio per leggere e salvare i turni condivisi.');
  }
  return supabase;
}

function giorno(valore: unknown): number | null {
  if (valore === null || valore === undefined) return null;
  const numero = Number(valore);
  if (!Number.isInteger(numero) || numero < 1 || numero > 7) throw new Error('Giorno di festa non valido.');
  return numero;
}

function leggiScheda(valore: unknown): SchedaTurni {
  if (!valore || typeof valore !== 'object') throw new Error('Scheda dipendente non disponibile.');
  const riga = valore as Record<string, unknown>;
  if (!riga.id || !riga.nome) throw new Error('Scheda dipendente incompleta.');
  return {
    id: String(riga.id),
    nome: String(riga.nome),
    squadra: riga.squadra === null ? null : Number(riga.squadra) === 1 ? 1 : Number(riga.squadra) === 2 ? 2 : null,
    festaMattina: giorno(riga.festa_mattina),
    festaPomeriggio: giorno(riga.festa_pomeriggio),
    validaDal: riga.valida_dal ? String(riga.valida_dal).slice(0, 10) : null,
    configurata: Boolean(riga.configurata),
    prossimaValidaDal: riga.prossima_valida_dal ? String(riga.prossima_valida_dal).slice(0, 10) : null
  };
}

function erroreServizio(errore: { code?: string; message: string }): Error {
  console.warn('Gestione schede turni:', errore.code, errore.message);
  if (errore.code === '42501') return new Error('Non hai il permesso di gestire le schede dei dipendenti.');
  if (errore.code === '22023') return new Error(errore.message);
  return new Error('Impossibile contattare il servizio dei turni. Le modifiche non sono state salvate: riprova.');
}

/** Nessuna cache locale: queste impostazioni appartengono soltanto all’admin. */
export async function elencaSchedeTurni(data: string): Promise<SchedaTurni[]> {
  const { data: righe, error } = await clientAdmin().rpc('elenca_schede_turni', { p_data: data });
  if (error) throw erroreServizio(error);
  if (!Array.isArray(righe)) throw new Error('Elenco dipendenti non disponibile. Riprova.');
  return righe.map(leggiScheda).sort((a, b) =>
    Number(b.squadra === null) - Number(a.squadra === null) || a.nome.localeCompare(b.nome, 'it')
  );
}

/** La risposta arriva soltanto dopo il salvataggio e l’aggiornamento del calendario. */
export async function salvaSchedaTurni(impostazioni: ImpostazioniSchedaTurni): Promise<SchedaTurni> {
  const { data, error } = await clientAdmin().rpc('salva_scheda_turni', {
    p_profilo_id: impostazioni.profiloId,
    p_valida_dal: impostazioni.validaDal,
    p_squadra: impostazioni.squadra,
    p_festa_mode: 'personalizzato',
    p_festa_mattina: impostazioni.festaMattina,
    p_festa_pomeriggio: impostazioni.festaPomeriggio
  });
  if (error) throw erroreServizio(error);
  return leggiScheda(Array.isArray(data) ? data[0] : data);
}
