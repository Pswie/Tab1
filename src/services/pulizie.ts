import { amministratore, nomeUtente } from './auth';
import { isSupabaseConfigured, supabase } from './supabase';

export type TipoPulizia = 'bagno' | 'settimanale' | 'mensile';
export type TurnoPulizia = 'mattina' | 'pomeriggio';
export type GruppoPulizia = 'gruppo-1' | 'gruppo-2';

export interface Pulizia {
  id: string;
  tipo: TipoPulizia;
  voce: string;
  periodoInizio: string;
  periodoFine: string;
  previstaIl?: string;
  turno: TurnoPulizia | '';
  gruppo: GruppoPulizia | '';
  responsabili: string[];
  responsabiliProfili: string[];
  assegnazioneManuale: boolean;
  completata: boolean;
  completataIl?: string;
  completataDa: string;
  nonFatta: boolean;
}

export interface PuliziaNonFatta {
  id: string;
  tipo: TipoPulizia;
  voce: string;
  scadenza: string;
  responsabili: string[];
}

export interface PeriodoPulizie {
  settimana: string;
  mese: string;
}

const CHIAVE_LOCALE = 'tabaccheria_pulizie_v1';

/** Le checklist vengono create dal database insieme alla fotografia dei responsabili */
function daRiga(r: Record<string, unknown>): Pulizia {
  return {
    id: String(r.id),
    tipo: String(r.tipo) as TipoPulizia,
    voce: String(r.voce ?? ''),
    periodoInizio: String(r.periodo_inizio ?? '').slice(0, 10),
    periodoFine: String(r.periodo_fine ?? '').slice(0, 10),
    previstaIl: r.prevista_il ? String(r.prevista_il).slice(0, 10) : undefined,
    turno: (r.turno ? String(r.turno) : '') as TurnoPulizia | '',
    gruppo: (r.gruppo ? String(r.gruppo) : '') as GruppoPulizia | '',
    responsabili: Array.isArray(r.responsabili) ? r.responsabili.map(String) : [],
    responsabiliProfili: Array.isArray(r.responsabili_profili) ? r.responsabili_profili.map(String) : [],
    assegnazioneManuale: r.origine_assegnazione === 'manuale',
    completata: Boolean(r.completata_il),
    completataIl: r.completata_il ? String(r.completata_il) : undefined,
    completataDa: String(r.completata_da_nome ?? ''),
    nonFatta: Boolean(r.non_fatta_il)
  };
}

function leggiLocale(): Pulizia[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function scriviLocale(voci: Pulizia[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio locale pulizie', err);
  }
}

function aggiornaLocale(nuove: Pulizia[]): void {
  const ids = new Set(nuove.map(v => v.id));
  scriviLocale([...leggiLocale().filter(v => !ids.has(v.id)), ...nuove]);
}

function stessoPeriodo(v: Pulizia, periodo: PeriodoPulizie): boolean {
  return v.tipo === 'mensile'
    ? v.periodoInizio === `${periodo.mese}-01`
    : v.periodoInizio === periodo.settimana;
}

/**
 * Carica le tre checklist. La funzione SQL le prepara in modo idempotente:
 * aprire due telefoni nello stesso momento non duplica né resetta niente.
 */
export async function elencaPulizie(periodo: PeriodoPulizie): Promise<Pulizia[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error: errorePreparazione } = await supabase.rpc('prepara_pulizie', {
        p_settimana: periodo.settimana,
        p_mese: `${periodo.mese}-01`
      });

      if (errorePreparazione) throw errorePreparazione;

      const { data, error } = await supabase
        .from('pulizie_registro')
        .select('*')
        .in('periodo_inizio', [periodo.settimana, `${periodo.mese}-01`])
        .order('tipo')
        .order('ordine');

      if (error) throw error;

      // Quando il primo del mese cade di lunedì, settimana e mese condividono
      // la stessa data di inizio: il tipo decide a quale vista appartiene la riga.
      const voci = (data ?? []).map(daRiga).filter(v => stessoPeriodo(v, periodo));
      aggiornaLocale(voci);
      return voci;
    } catch (err) {
      console.warn('Eccezione lettura pulizie:', err);
    }
  }

  return leggiLocale().filter(v => stessoPeriodo(v, periodo));
}

/** Mette o toglie la X, firmandola con il profilo che ha premuto */
export async function impostaPulizia(id: string, completata: boolean): Promise<Pulizia | null> {
  const completataIl = completata ? new Date().toISOString() : null;
  const completataDaNome = completata ? (nomeUtente() || 'Dipendente') : '';

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .rpc('imposta_pulizia_completata', {
          p_id: id,
          p_completata: completata
        });

      const riga = Array.isArray(data) ? data[0] : data;
      if (!error && riga) {
        const voce = daRiga(riga as Record<string, unknown>);
        aggiornaLocale([voce]);
        return voce;
      }

      console.warn('Errore aggiornamento pulizia:', error?.message);
      return null;
    } catch (err) {
      console.warn('Eccezione aggiornamento pulizia:', err);
      return null;
    }
  }

  // Senza database non esiste un audit condiviso affidabile: la checklist si
  // può consultare dalla cache, ma una X non deve fingersi salvata solo qui.
  if (!isSupabaseConfigured()) return null;

  const aggiornata = leggiLocale().find(v => v.id === id);
  if (!aggiornata) return null;

  const voce: Pulizia = {
    ...aggiornata,
    completata,
    completataIl: completataIl || undefined,
    completataDa: completataDaNome
  };
  aggiornaLocale([voce]);
  return voce;
}

/** Dati operativi della dashboard: soltanto checklist scadute e mai completate */
export async function elencaPulizieNonFatte(): Promise<PuliziaNonFatta[]> {
  if (!isSupabaseConfigured() || !supabase) return [];

  const { error: erroreAggiornamento } = await supabase.rpc('aggiorna_pulizie_non_fatte');
  if (erroreAggiornamento) throw erroreAggiornamento;

  // Supabase limita normalmente una risposta a 1000 righe. Lo storico non
  // si tronca: viene letto a pagine, così anche "Tutto" resta davvero tutto.
  const righe: Record<string, unknown>[] = [];
  const perPagina = 1000;

  for (let da = 0; ; da += perPagina) {
    const { data, error } = await supabase
      .from('pulizie_non_fatte')
      .select('*')
      .order('scadenza', { ascending: false })
      .order('id', { ascending: true })
      .range(da, da + perPagina - 1);

    if (error) throw error;

    const pagina = (data ?? []) as Record<string, unknown>[];
    righe.push(...pagina);
    if (pagina.length < perPagina) break;
  }

  return righe.map(r => ({
    id: String(r.id),
    tipo: String(r.tipo) as TipoPulizia,
    voce: String(r.voce ?? ''),
    scadenza: String(r.scadenza ?? '').slice(0, 10),
    responsabili: Array.isArray(r.responsabili) ? r.responsabili.map(String) : []
  }));
}

export interface IncongruenzaPulizia { id: string; avvisi: string[] }

function clientAdminPulizie() {
  if (!amministratore()) throw new Error('Solo l’amministratore può modificare i responsabili delle pulizie.');
  if (!isSupabaseConfigured() || !supabase) throw new Error('Collegati al servizio per gestire le pulizie condivise.');
  return supabase;
}

export async function elencaIncongruenzePulizie(periodo: PeriodoPulizie): Promise<IncongruenzaPulizia[]> {
  const { data, error } = await clientAdminPulizie().rpc('elenca_incongruenze_pulizie', {
    p_settimana: periodo.settimana, p_mese: `${periodo.mese}-01`
  });
  if (error) throw new Error('Non è stato possibile verificare le assegnazioni delle pulizie. Riprova.');
  return (Array.isArray(data) ? data : []).map(riga => ({
    id: String(riga.id), avvisi: Array.isArray(riga.avvisi) ? riga.avvisi.map(String) : []
  }));
}

export async function assegnaResponsabiliPulizia(id: string, profili: string[], automatico = false): Promise<Pulizia> {
  const { data, error } = await clientAdminPulizie().rpc('assegna_responsabili_pulizia', {
    p_id: id, p_profili: [...new Set(profili)], p_automatico: automatico
  });
  if (error) {
    console.warn('Assegnazione pulizia non salvata:', error.message);
    throw new Error(error.code === '22023' ? error.message : 'Assegnazione non salvata. Controlla la connessione e riprova.');
  }
  const riga = Array.isArray(data) ? data[0] : data;
  if (!riga) throw new Error('Assegnazione non confermata. Aggiorna l’elenco prima di riprovare.');
  const voce = daRiga(riga);
  aggiornaLocale([voce]);
  return voce;
}
