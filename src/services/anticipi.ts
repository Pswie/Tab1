import { isSupabaseConfigured, supabase } from './supabase';

/** Un nome disponibile nel registro anticipi. */
export interface BaristaAnticipo {
  id: string;
  nome: string;
  attivo: boolean;
  ordine: number;
  compensoMensile: number;
}

/** Un anticipo consegnato a una persona. */
export interface Anticipo {
  id: string;
  baristaId: string | null;
  baristaNome: string;
  data: string;
  importo: number;
  nota: string;
  creatoDa: string;
  creatoIl: string;
  /** Azzerato sparisce dall'app ma resta nella tabella come storico amministrativo. */
  azzerato: boolean;
  azzeratoIl: string | null;
}

export interface EsitoAnticipi<T> {
  valore: T;
  suCloud: boolean;
  errore?: string;
}

const CHIAVE_NOMI = 'tabaccheria_anticipi_nomi_v1';
const CHIAVE_ANTICIPI = 'tabaccheria_anticipi_v1';

const NOMI_INIZIALI: { nome: string; compensoMensile: number }[] = [
  { nome: 'Luigi', compensoMensile: 1100 },
  { nome: 'Paolo', compensoMensile: 1000 },
  { nome: 'Livio', compensoMensile: 1000 }
];

export function compensoPredefinito(nome: string): number {
  const norm = nome.trim().toLowerCase();
  if (norm === 'luigi') return 1100;
  if (norm === 'paolo') return 1000;
  if (norm === 'livio') return 1000;
  return 0;
}

function nuovoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `locale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function leggiLocale<T>(chiave: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(chiave);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function scriviLocale<T>(chiave: string, valore: T): void {
  try {
    localStorage.setItem(chiave, JSON.stringify(valore));
  } catch (err) {
    console.error('Errore salvataggio locale anticipi', err);
  }
}

function nomiLocali(): BaristaAnticipo[] {
  const salvati = leggiLocale<BaristaAnticipo[]>(CHIAVE_NOMI, []);
  if (salvati.length > 0) {
    let modificato = false;
    const aggiornati = salvati.map(b => {
      let compenso = Number(b.compensoMensile);
      if (!Number.isFinite(compenso) || compenso <= 0) {
        const predefinito = compensoPredefinito(b.nome);
        if (predefinito > 0) {
          compenso = predefinito;
          modificato = true;
        } else {
          compenso = 0;
        }
      }
      return { ...b, compensoMensile: compenso };
    });

    if (modificato) {
      scriviLocale(CHIAVE_NOMI, aggiornati);
    }
    return aggiornati;
  }

  const iniziali = NOMI_INIZIALI.map((item, ordine) => ({
    id: `iniziale-${item.nome.toLocaleLowerCase('it')}`,
    nome: item.nome,
    attivo: true,
    ordine,
    compensoMensile: item.compensoMensile
  }));
  scriviLocale(CHIAVE_NOMI, iniziali);
  return iniziali;
}

function daRigaNome(riga: Record<string, unknown>): BaristaAnticipo {
  const nome = String(riga.nome || '');
  let compenso = Number(riga.compenso_mensile);
  if (!Number.isFinite(compenso) || compenso <= 0) {
    compenso = compensoPredefinito(nome);
  }

  return {
    id: String(riga.id),
    nome,
    attivo: Boolean(riga.attivo),
    ordine: Number(riga.ordine) || 0,
    compensoMensile: compenso
  };
}

function daRigaAnticipo(riga: Record<string, unknown>): Anticipo {
  return {
    id: String(riga.id),
    baristaId: riga.barista_id ? String(riga.barista_id) : null,
    baristaNome: String(riga.barista_nome || ''),
    data: String(riga.data || '').slice(0, 10),
    importo: Number(riga.importo) || 0,
    nota: String(riga.nota || ''),
    creatoDa: String(riga.creato_da || ''),
    creatoIl: String(riga.creato_il || ''),
    azzerato: Boolean(riga.azzerato),
    azzeratoIl: riga.azzerato_il ? String(riga.azzerato_il) : null
  };
}

function ordinaNomi(nomi: BaristaAnticipo[]): BaristaAnticipo[] {
  return [...nomi].sort((a, b) =>
    a.ordine - b.ordine || a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
  );
}

function ordinaAnticipi(voci: Anticipo[]): Anticipo[] {
  return [...voci].sort((a, b) =>
    b.data.localeCompare(a.data) || b.creatoIl.localeCompare(a.creatoIl)
  );
}

/** Elenco completo: gli inattivi servono nella rotellina per poterli riattivare. */
export async function elencaBaristiAnticipi(): Promise<BaristaAnticipo[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('baristi_anticipi')
        .select('id,nome,attivo,ordine,compenso_mensile')
        .order('ordine')
        .order('nome');

      if (!error && data) {
        const nomi = ordinaNomi(data.map(daRigaNome));
        scriviLocale(CHIAVE_NOMI, nomi);
        return nomi;
      }

      // Se la colonna compenso_mensile non esiste ancora su Supabase, ripiega sulle colonne base
      if (error && (error.message.includes('compenso_mensile') || error.code === '42703')) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('baristi_anticipi')
          .select('id,nome,attivo,ordine')
          .order('ordine')
          .order('nome');

        if (!fallbackError && fallbackData) {
          const nomi = ordinaNomi(fallbackData.map(daRigaNome));
          scriviLocale(CHIAVE_NOMI, nomi);
          return nomi;
        }
      }

      console.warn('Errore lettura nomi anticipi:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura nomi anticipi:', err);
    }
  }

  return ordinaNomi(nomiLocali());
}

export async function aggiungiBaristaAnticipi(nome: string, compenso = 0): Promise<EsitoAnticipi<BaristaAnticipo>> {
  const pulito = nome.trim().replace(/\s+/g, ' ');
  const compensoValido = Math.max(0, Math.round(compenso * 100) / 100) || compensoPredefinito(pulito);
  const locali = nomiLocali();
  const esistente = locali.find(n => n.nome.localeCompare(pulito, 'it', { sensitivity: 'base' }) === 0);

  if (esistente) {
    const riattivato = { ...esistente, attivo: true, compensoMensile: compensoValido || esistente.compensoMensile };
    scriviLocale(CHIAVE_NOMI, locali.map(n => n.id === esistente.id ? riattivato : n));
    const esito = await impostaBaristaAttivo(esistente.id, true);
    if (compensoValido > 0) {
      await impostaCompensoBarista(esistente.id, compensoValido);
    }
    return { valore: riattivato, suCloud: esito.suCloud };
  }

  const ordine = Math.max(-1, ...locali.map(n => n.ordine)) + 1;

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('baristi_anticipi')
        .insert({ nome: pulito, attivo: true, ordine, compenso_mensile: compensoValido })
        .select('id,nome,attivo,ordine,compenso_mensile')
        .single();

      if (!error && data) {
        const aggiunto = daRigaNome(data);
        scriviLocale(CHIAVE_NOMI, ordinaNomi([...locali, aggiunto]));
        return { valore: aggiunto, suCloud: true };
      }

      // Se la colonna compenso_mensile non esiste ancora su Supabase, inserisci senza
      if (error && (error.message.includes('compenso_mensile') || error.code === '42703')) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('baristi_anticipi')
          .insert({ nome: pulito, attivo: true, ordine })
          .select('id,nome,attivo,ordine')
          .single();

        if (!fallbackError && fallbackData) {
          const aggiunto = daRigaNome({ ...fallbackData, compenso_mensile: compensoValido });
          scriviLocale(CHIAVE_NOMI, ordinaNomi([...locali, aggiunto]));
          return { valore: aggiunto, suCloud: true };
        }
      }

      console.warn('Nome anticipo salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione aggiunta nome anticipi:', err);
    }
  }

  const aggiunto: BaristaAnticipo = {
    id: nuovoId(),
    nome: pulito,
    attivo: true,
    ordine,
    compensoMensile: compensoValido
  };
  scriviLocale(CHIAVE_NOMI, ordinaNomi([...locali, aggiunto]));
  return { valore: aggiunto, suCloud: false };
}

export async function impostaCompensoBarista(id: string, compenso: number): Promise<EsitoAnticipi<number>> {
  const compensoValido = Math.max(0, Math.round(compenso * 100) / 100);
  const locali = nomiLocali();
  const aggiornati = locali.map(n => n.id === id ? { ...n, compensoMensile: compensoValido } : n);
  scriviLocale(CHIAVE_NOMI, aggiornati);

  if (isSupabaseConfigured() && supabase && !id.startsWith('iniziale-') && !id.startsWith('locale-')) {
    try {
      const { error } = await supabase
        .from('baristi_anticipi')
        .update({ compenso_mensile: compensoValido, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return { valore: compensoValido, suCloud: true };
      console.warn('Compenso barista aggiornato solo in locale:', error.message);
    } catch (err) {
      console.warn('Eccezione aggiornamento compenso barista:', err);
    }
  }

  return { valore: compensoValido, suCloud: false };
}

export async function impostaBaristaAttivo(id: string, attivo: boolean): Promise<EsitoAnticipi<boolean>> {
  const locali = nomiLocali();
  scriviLocale(CHIAVE_NOMI, locali.map(n => n.id === id ? { ...n, attivo } : n));

  if (isSupabaseConfigured() && supabase && !id.startsWith('iniziale-') && !id.startsWith('locale-')) {
    try {
      const { error } = await supabase
        .from('baristi_anticipi')
        .update({ attivo, aggiornato_il: new Date().toISOString() })
        .eq('id', id);

      if (!error) return { valore: true, suCloud: true };
      console.warn('Stato nome anticipo aggiornato solo in locale:', error.message);
    } catch (err) {
      console.warn('Eccezione aggiornamento nome anticipi:', err);
    }
  }

  return { valore: true, suCloud: false };
}

/** Anticipi in un intervallo di date comprese. */
export async function elencaAnticipi(dal: string, al: string): Promise<Anticipo[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('anticipi_baristi')
        .select('id,barista_id,barista_nome,data,importo,nota,creato_da,creato_il,azzerato,azzerato_il')
        .gte('data', dal)
        .lte('data', al)
        .order('data', { ascending: false })
        .order('creato_il', { ascending: false });

      if (!error && data) {
        const scaricati = ordinaAnticipi(data.map(daRigaAnticipo));
        const fuoriPeriodo = leggiLocale<Anticipo[]>(CHIAVE_ANTICIPI, [])
          .filter(a => a.data < dal || a.data > al);
        scriviLocale(CHIAVE_ANTICIPI, ordinaAnticipi([...fuoriPeriodo, ...scaricati]));
        return scaricati.filter(a => !a.azzerato);
      }

      console.warn('Errore lettura anticipi:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura anticipi:', err);
    }
  }

  return ordinaAnticipi(
    leggiLocale<Anticipo[]>(CHIAVE_ANTICIPI, [])
      .filter(a => a.data >= dal && a.data <= al && !a.azzerato)
  );
}

export async function registraAnticipo(
  barista: BaristaAnticipo,
  data: string,
  importo: number,
  nota: string,
  autore: string
): Promise<EsitoAnticipi<Anticipo>> {
  const base = {
    barista_id: barista.id.startsWith('iniziale-') || barista.id.startsWith('locale-') ? null : barista.id,
    barista_nome: barista.nome,
    data,
    importo,
    nota: nota.trim(),
    creato_da: autore
  };

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data: riga, error } = await supabase
        .from('anticipi_baristi')
        .insert(base)
        .select('id,barista_id,barista_nome,data,importo,nota,creato_da,creato_il,azzerato,azzerato_il')
        .single();

      if (!error && riga) {
        const anticipo = daRigaAnticipo(riga);
        const locali = leggiLocale<Anticipo[]>(CHIAVE_ANTICIPI, []);
        scriviLocale(CHIAVE_ANTICIPI, ordinaAnticipi([...locali.filter(a => a.id !== anticipo.id), anticipo]));
        return { valore: anticipo, suCloud: true };
      }

      console.warn('Anticipo salvato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione salvataggio anticipo:', err);
    }
  }

  const anticipo: Anticipo = {
    id: nuovoId(),
    baristaId: barista.id,
    baristaNome: barista.nome,
    data,
    importo,
    nota: nota.trim(),
    creatoDa: autore,
    creatoIl: new Date().toISOString(),
    azzerato: false,
    azzeratoIl: null
  };
  const locali = leggiLocale<Anticipo[]>(CHIAVE_ANTICIPI, []);
  scriviLocale(CHIAVE_ANTICIPI, ordinaAnticipi([...locali, anticipo]));
  return { valore: anticipo, suCloud: false };
}

/**
 * Toglie una voce dal conteggio visibile senza cancellarla: l'intera riga
 * resta nella tabella con data e ora dell'azzeramento.
 */
export async function azzeraAnticipo(id: string): Promise<boolean> {
  const locali = leggiLocale<Anticipo[]>(CHIAVE_ANTICIPI, []);
  const azzeratoIl = new Date().toISOString();
  scriviLocale(CHIAVE_ANTICIPI, locali.map(a =>
    a.id === id ? { ...a, azzerato: true, azzeratoIl } : a
  ));

  if (isSupabaseConfigured() && supabase && !id.startsWith('locale-')) {
    try {
      const { error } = await supabase
        .from('anticipi_baristi')
        .update({ azzerato: true, azzerato_il: azzeratoIl })
        .eq('id', id);
      if (!error) return true;
      console.warn('Anticipo azzerato solo in locale:', error.message);
    } catch (err) {
      console.warn('Eccezione azzeramento anticipo:', err);
    }
  }

  return false;
}
