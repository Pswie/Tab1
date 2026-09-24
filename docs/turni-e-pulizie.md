# Schede turni e assegnazioni delle pulizie

Le schede abituali sono riservate agli amministratori. Il calendario continua a
essere condiviso con tutti i dipendenti approvati; la gestione delegata puo'
modificare le singole giornate e spostare una festa nella stessa settimana.

## Applicazione del database

Applicare in un'unica transazione, nell'ordine:

1. `sql/turni_schede_admin.sql`
2. `sql/pulizie_assegnazioni_admin.sql`
3. `sql/pulizie_collegate_turni.sql`

Gli stessi blocchi sono inclusi in `supabase_schema.sql`, prima della prima
generazione del calendario. Le patch incrementali non avviano una rigenerazione
all'applicazione e non cambiano le assegnazioni esistenti. La preparazione delle
pulizie o la successiva modifica dei turni riallinea le sole voci automatiche
ancora aperte. I tre file possono essere riapplicati.

## Ricorrenze

`turni_schede` conserva una revisione per ogni salvataggio. Per una data si usa
la decorrenza piu' recente gia' iniziata e, a parita' di decorrenza, l'ultima
revisione. Le schede programmate per date successive restano valide. Prima della
prima scheda si usano squadre, feste e rotazione delle coperture preesistenti.

- Turno 1 e Turno 2 sono le due squadre alternate, non fasce fisse.
- La festa mattina/pomeriggio segue la fascia abituale della squadra, prima delle
  coperture. Un valore nullo indica nessuna festa per quella fascia.
- `squadra = null` sospende la generazione automatica della persona; non cancella
  eccezioni manuali, ferie o annullamenti espliciti.
- La decorrenza di una nuova scheda non puo' precedere oggi in Europe/Rome.
- I salvataggi rigenerano soltanto i mesi gia' preparati e quello della decorrenza.
- I nomi e gli identificativi dei dipendenti sono ricavati dai profili approvati,
  escludendo gli amministratori. Nuovi dipendenti compaiono senza modificare SQL.

`sposta_festa_turni` modifica due giornate in una transazione: ripristina il lavoro
nel giorno originale e registra la festa nella destinazione. Richiede due date
distinte della stessa settimana lunedi'-domenica, una festa ancora attiva in
partenza e nessuna festa o ferie in destinazione. Le due righe sono manuali;
scheda abituale e coperture degli altri dipendenti restano invariate.

## Pulizie

Le settimanali seguono la fascia in cui la persona lavora piu' giorni; in parita'
conta il lunedi'. Le mensili seguono la squadra effettiva di oggi, mantenendo la
rotazione delle attivita' tra i gruppi. La responsabilita' abituale del bagno
resta quella preesistente: eventuali assenze vengono segnalate all'amministratore.

L'amministratore puo' assegnare manualmente una voce aperta del periodo corrente
oppure ripristinare il calcolo automatico. Una scelta manuale non viene sovrascritta
da cambio turno, generazione o apertura della checklist. I responsabili delle
pulizie completate e dei periodi conclusi restano invariati.

Gli avvisi segnalano assenza di responsabili, profili non approvati, bagno
assegnato a chi non lavora quel giorno e differenze rispetto al gruppo previsto.
Sono segnalazioni: una scelta manuale resta consentita per gestire una sostituzione.

## Verifica

Le verifiche SQL isolate coprono: equivalenza del calendario precedente,
idempotenza, permessi di admin/delegata/dipendente, feste alternate, date di
decorrenza, configurazioni future, protezione dello storico e delle eccezioni,
spostamenti atomici con rollback della prima scrittura se la seconda fallisce,
assegnazioni manuali delle pulizie e immutabilita' di completate/scadute.

Il database non concede scritture dirette sulle tabelle ai client. Tutte le RPC
controllano l'utente autenticato sul server, con permessi espliciti e search path
vuoto. Generazione, modifiche calendario e assegnazione pulizie condividono lo
stesso lock transazionale; il ricalcolo avviene alla fine delle operazioni, senza
un trigger per ogni riga generata.

## Stato verificato il 24 settembre 2026

La migrazione `schede_turni_feste_e_assegnazioni_pulizie` e' stata applicata al
database del progetto in un'unica transazione. Il confronto delle impronte dei
dati prima e dopo conferma l'invarianza dei 544 turni e delle 119 voci pulizie
esistenti, escludendo dal confronto solo le quattro nuove colonne.

Le verifiche in sola lettura sul database confermano l'elenco completo dei
dipendenti approvati per l'admin, il rifiuto delle cinque nuove RPC per un
dipendente ordinario e l'assenza di accesso diretto alla tabella delle schede.
Nessuna nuova funzione e' eseguibile dal ruolo anonimo. Gli avvisi dell'advisor
sulle RPC SECURITY DEFINER autenticate sono attesi: ciascuna verifica i permessi
nel database. La tabella delle schede ha RLS senza policy client, essendo
accessibile soltanto tramite queste RPC.

Validazione locale: 345 turni equivalenti al generatore precedente, 10 scenari
turni, 6 scenari pulizie, 66 verifiche browser e build di produzione completata.
I controlli browser usano dati di prova isolati; le nuove funzioni di modifica
non sono state provate scrivendo assegnazioni reali. Il frontend e' pronto nel
progetto; questa attivita' non comprende una pubblicazione dell'interfaccia.
