import { isSupabaseConfigured, supabase } from './supabase';

/** Quota di un ammanco attribuita a una persona del turno. */
export interface DebitoTurno {
  id: string;
  data: string;
  turno: 'mattina' | 'pomeriggio';
  persona: string;
  ammancoTotale: number;
  personeNelTurno: number;
  importoCalcolato: number;
  importo: number;
  assegnato: boolean;
  modificatoManualmente: boolean;
  notaModifica: string;
}

export interface EsitoDebito {
  valore: DebitoTurno | null;
  suCloud: boolean;
}

const CHIAVE_LOCALE = 'tabaccheria_debiti_turno_v1';

function daRiga(riga: Record<string, unknown>): DebitoTurno {
  return {
    id: String(riga.id),
    data: String(riga.data || '').slice(0, 10),
    turno: riga.turno === 'pomeriggio' ? 'pomeriggio' : 'mattina',
    persona: String(riga.persona || ''),
    ammancoTotale: Number(riga.ammanco_totale) || 0,
    personeNelTurno: Number(riga.persone_nel_turno) || 0,
    importoCalcolato: Number(riga.importo_calcolato) || Number(riga.importo) || 0,
    importo: Number(riga.importo) || 0,
    assegnato: Boolean(riga.assegnato),
    modificatoManualmente: Boolean(riga.modificato_manualmente),
    notaModifica: String(riga.nota_modifica || '')
  };
}

function leggiLocale(): DebitoTurno[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    if (!raw) return [];

    return (JSON.parse(raw) as DebitoTurno[]).map(v => ({
      ...v,
      importoCalcolato: Number(v.importoCalcolato ?? v.importo) || 0,
      modificatoManualmente: Boolean(v.modificatoManualmente),
      notaModifica: String(v.notaModifica || '')
    }));
  } catch {
    return [];
  }
}

function scriviLocale(voci: DebitoTurno[]): void {
  try {
    localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(voci));
  } catch (err) {
    console.error('Errore salvataggio locale debiti turno', err);
  }
}

function ordina(voci: DebitoTurno[]): DebitoTurno[] {
  return [...voci].sort((a, b) =>
    b.data.localeCompare(a.data)
      || b.turno.localeCompare(a.turno)
      || a.persona.localeCompare(b.persona, 'it', { sensitivity: 'base' })
  );
}

/**
 * Tutte le quote ancora aperte, senza limiti di mese o anno.
 * Le righe azzerate restano nel database ma hanno attivo=false e non compaiono.
 */
export async function elencaDebitiTurno(): Promise<DebitoTurno[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('debiti_turno')
        .select('id,data,turno,persona,ammanco_totale,persone_nel_turno,importo_calcolato,importo,assegnato,modificato_manualmente,nota_modifica')
        .eq('attivo', true)
        .order('data', { ascending: false })
        .order('turno', { ascending: false })
        .order('persona');

      if (!error && data) {
        const voci = ordina(data.map(daRiga));
        scriviLocale(voci);
        return voci;
      }

      console.warn('Errore lettura debiti turno:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura debiti turno:', err);
    }
  }

  return ordina(leggiLocale());
}

/** Corregge il residuo lasciando intatto l'importo calcolato dal turno. */
export async function modificaDebitoTurno(
  id: string,
  importo: number,
  nota: string,
  autore: string
): Promise<EsitoDebito> {
  const ora = new Date().toISOString();

  if (isSupabaseConfigured() && supabase) {
    try {
      const azzerato = importo === 0;
      const { data, error } = await supabase
        .from('debiti_turno')
        .update({
          importo,
          modificato_manualmente: true,
          nota_modifica: nota.trim(),
          modificato_da: autore,
          modificato_il: ora,
          azzerato,
          azzerato_il: azzerato ? ora : null,
          attivo: !azzerato,
          aggiornato_il: ora
        })
        .eq('id', id)
        .select('id,data,turno,persona,ammanco_totale,persone_nel_turno,importo_calcolato,importo,assegnato,modificato_manualmente,nota_modifica')
        .maybeSingle();

      if (!error && data) {
        const aggiornato = daRiga(data);
        const locali = leggiLocale().filter(v => v.id !== id);
        if (!azzerato) locali.push(aggiornato);
        scriviLocale(ordina(locali));
        return { valore: azzerato ? null : aggiornato, suCloud: true };
      }

      console.warn('Debito modificato solo in locale:', error?.message);
    } catch (err) {
      console.warn('Eccezione modifica debito turno:', err);
    }
  }

  const corrente = leggiLocale().find(v => v.id === id);
  if (!corrente || importo === 0) {
    scriviLocale(leggiLocale().filter(v => v.id !== id));
    return { valore: null, suCloud: false };
  }

  const aggiornato: DebitoTurno = {
    ...corrente,
    importo,
    modificatoManualmente: true,
    notaModifica: nota.trim()
  };
  scriviLocale(ordina([...leggiLocale().filter(v => v.id !== id), aggiornato]));
  return { valore: aggiornato, suCloud: false };
}

/** Azzera una sola persona senza cancellarne la riga dal database. */
export async function azzeraDebitoTurno(id: string, autore: string): Promise<boolean> {
  const esito = await modificaDebitoTurno(id, 0, 'Debito azzerato', autore);
  return esito.suCloud;
}
