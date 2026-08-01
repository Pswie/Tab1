import { isSupabaseConfigured, supabase } from './supabase';

export interface IscrizionePush {
  endpoint: string;
  p256dh: string;
  auth: string;
  dispositivo: string;
}

/**
 * Registra il recapito di questo dispositivo.
 *
 * Il server ha bisogno dell'elenco dei destinatari per poter inviare una
 * notifica: senza, non saprebbe a chi scrivere quando l'app è chiusa.
 */
export async function salvaIscrizionePush(iscrizione: IscrizionePush): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;

  try {
    const { error } = await supabase
      .from('push_iscrizioni')
      .upsert(iscrizione, { onConflict: 'endpoint' });

    if (error) console.warn('Iscrizione push non salvata:', error.message);
  } catch (err) {
    console.warn('Eccezione salvataggio iscrizione push:', err);
  }
}
