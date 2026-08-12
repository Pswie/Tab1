import { isSupabaseConfigured, supabase } from './supabase';

export interface IscrizionePush {
  endpoint: string;
  p256dh: string;
  auth: string;
  dispositivo: string;
  profilo_id?: string | null;
}

/**
 * Registra il recapito di questo dispositivo.
 *
 * Il server ha bisogno dell'elenco dei destinatari per poter inviare una
 * notifica: senza, non saprebbe a chi scrivere quando l'app è chiusa.
 */
export async function salvaIscrizionePush(iscrizione: IscrizionePush): Promise<boolean> {
  if (!isSupabaseConfigured() || !supabase) return false;

  try {
    const { error } = await supabase.rpc('registra_iscrizione_push', {
      p_endpoint: iscrizione.endpoint,
      p_p256dh: iscrizione.p256dh,
      p_auth: iscrizione.auth,
      p_dispositivo: iscrizione.dispositivo
    });

    if (error) {
      console.warn('Iscrizione push non salvata:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Eccezione salvataggio iscrizione push:', err);
    return false;
  }
}

export interface StatoNotificheDipendente {
  profiloId: string;
  nome: string;
  attive: boolean;
  dispositivi: number;
  aggiornataIl: string | null;
}

/** Elenco amministrativo: mostra chi non ha ancora collegato alcun dispositivo. */
export async function elencaStatoNotificheDipendenti(): Promise<StatoNotificheDipendente[]> {
  if (!isSupabaseConfigured() || !supabase) return [];

  const { data, error } = await supabase.rpc('stato_notifiche_dipendenti');
  if (error) throw error;

  return (data || []).map((riga: Record<string, unknown>) => ({
    profiloId: String(riga.profilo_id || ''),
    nome: String(riga.nome || 'Senza nome'),
    attive: Boolean(riga.attive),
    dispositivi: Number(riga.numero_dispositivi) || 0,
    aggiornataIl: riga.ultimo_aggiornamento ? String(riga.ultimo_aggiornamento) : null
  }));
}
