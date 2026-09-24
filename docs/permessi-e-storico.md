# Permessi e registro delle modifiche

L’amministratore apre **Turni → Permessi e attività**. Nella scheda **Utenti**
può concedere e revocare due autorizzazioni indipendenti a ogni dipendente con
accesso approvato:

- **Modificare il calendario turni**: assegnazioni giornaliere, ferie,
  annullamenti e spostamenti delle feste. Le schede dei turni abituali rimangono
  riservate all’amministratore.
- **Gestire giorni e responsabili delle pulizie**: programma delle attività
  ancora aperte nel periodo corrente o futuro, avvisi sulle incongruenze e ripristino del
  programma automatico. Il giorno scelto deve rientrare nella settimana o nel
  mese dell’attività. Per il bagno è obbligatorio; per le altre pulizie è
  facoltativo.

I permessi non concedono il ruolo di amministratore. I profili esistenti
mantengono la delega ai turni già assegnata; il nuovo permesso pulizie parte
disattivato. I nuovi account non ricevono deleghe automaticamente.

## Registro privato

La scheda **Registro modifiche**, disponibile soltanto all’amministratore,
mostra autore, data e ora, attività e confronto prima/dopo. I filtri permettono
di scegliere autore, ambito e periodo; il registro si carica a pagine. Il numero
mostrato indica le modifiche visualizzate, non un giudizio automatico sull’uso.

Il registro conserva gli interventi sui turni e sulle feste, le modifiche delle
schede abituali, i cambi di giorno/responsabile delle pulizie, i ripristini,
le spunte messe o tolte e le concessioni/revoche dei permessi. I ricalcoli
automatici non vengono attribuiti come interventi dell’utente. La registrazione
parte dall’applicazione della nuova migrazione: non ricostruisce gli interventi
precedenti.

Il database ricava l’autore dalla sessione autenticata e salva la modifica e il
relativo registro nella stessa transazione. Il client non può scegliere l’autore,
scrivere, cancellare o leggere direttamente il registro. Le copie prima/dopo e
il nome dell’autore restano disponibili anche se il profilo cambia in seguito.
Il browser dell’amministratore conserva il registro soltanto in memoria.

Ogni scrittura controlla i permessi correnti nel database. La revoca blocca le
nuove richieste anche se un telefono mostra ancora i vecchi comandi. Il browser
aggiorna i comandi al ritorno nell’app, all’apertura delle viste e periodicamente
mentre è visibile. Un errore di rete o autorizzazione non produce una finta
modifica locale del calendario.

## Presentazione

Il dialogo riprende il carattere già usato dall’admin e allinea etichette e
contenuti a sinistra. La palette usa bianco `#ffffff`, fondo `#f5f6f8`, testo
`#202730`, testo secondario `#606b78`, bordi `#e3e7ec` e azioni `#c52f2b`.
Utenti e registro sono due viste dello stesso pannello; i dettagli prima/dopo
si espandono solo quando servono. Su telefono campi e confronti si dispongono
in una colonna. I dipendenti caricano soltanto i comandi che sono autorizzati a
usare; gli asset del registro amministrativo non vengono caricati.

## Database

La patch incrementale è `sql/permessi_registro_gestione.sql`, successiva alle
tre patch descritte in [Turni e pulizie](turni-e-pulizie.md). Non concede nuove
deleghe e non cambia le assegnazioni esistenti durante l’applicazione.
La successiva `sql/autori_registro_gestione.sql` completa l’elenco degli autori
storici, indipendentemente dalla prima pagina caricata e dallo stato dei profili.
La patch `sql/pulizie_programmazione_futura.sql`, da applicare dopo quella dei
permessi, estende la gestione alle settimane e ai mesi futuri e aggiunge il bagno
del sabato dalla settimana del 21 settembre 2026. Non modifica le deleghe e non
riscrive le checklist esistenti durante l'applicazione.

Le due migrazioni sono state applicate al database il 24 settembre 2026:
`permessi_delegati_e_registro_modifiche` e `autori_storici_registro_gestione`.
Le impronte dei dati prima e dopo la migrazione principale coincidono per 582
turni, 119 voci pulizie, 7 profili e 5 schede ricorrenti, escludendo solo i nuovi
campi con valori predefiniti. Non sono state assegnate deleghe per conto dell’admin.

Sono passati 12 scenari SQL isolati, il controllo completo dei privilegi e 9
scenari sui servizi del client. La verifica degli autori storici usa 75 eventi
di prova e include autori disattivati e senza più un profilo. Anche le verifiche
in sola lettura sul database reale, con ruolo `authenticated`, confermano che
solo l’admin legge permessi e registro e che i client non possono concedersi
permessi o accedere direttamente alle tabelle protette.

L’interfaccia è verificata con dati di prova isolati su desktop e telefoni da
320 e 390 pixel. Il frontend è pronto nel progetto; non è stato pubblicato da
questa attività.
