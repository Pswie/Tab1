import { isSupabaseConfigured, supabase } from './supabase';

/** Quota di un ammanco attribuita a una persona del turno. */
export interface DebitoTurno {
  id: string;
  data: string;
  turno: 'mattina' | 'pomeriggio';
  persona: string;
  ammancoTotale: number;
  personeNelTurno: number;
  importo: number;
  assegnato: boolean;
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
    importo: Number(riga.importo) || 0,
    assegnato: Boolean(riga.assegnato)
  };
}

function leggiLocale(): DebitoTurno[] {
  try {
    const raw = localStorage.getItem(CHIAVE_LOCALE);
    return raw ? JSON.parse(raw) : [];
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

/** Quote attive comprese fra le due date. Le rettifiche restano nel database. */
export async function elencaDebitiTurno(dal: string, al: string): Promise<DebitoTurno[]> {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('debiti_turno')
        .select('id,data,turno,persona,ammanco_totale,persone_nel_turno,importo,assegnato')
        .eq('attivo', true)
        .gte('data', dal)
        .lte('data', al)
        .order('data', { ascending: false })
        .order('turno', { ascending: false })
        .order('persona');

      if (!error && data) {
        const voci = ordina(data.map(daRiga));
        const fuoriPeriodo = leggiLocale().filter(v => v.data < dal || v.data > al);
        scriviLocale(ordina([...fuoriPeriodo, ...voci]));
        return voci;
      }

      console.warn('Errore lettura debiti turno:', error?.message);
    } catch (err) {
      console.warn('Eccezione lettura debiti turno:', err);
    }
  }

  return ordina(leggiLocale().filter(v => v.data >= dal && v.data <= al));
}
