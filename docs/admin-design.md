# Area amministrativa iNES

Rifacimento limitato al profilo amministratore. La versione dipendenti resta in attesa della valutazione del titolare.

## Direzione

- Fondo nebbia `#f6f7f9`, superfici bianche `#ffffff`, inchiostro `#20242b`, testo secondario `#667085`, divisori `#e7e9ed`, rosso iNES `#cf302b`.
- Plus Jakarta Sans per titoli, comandi e importi; cifre tabulari per facilitare il confronto. Gerarchia con dimensioni e spazio, senza etichette decorative.
- Navigazione laterale raggruppata per il negozio, organizzazione, distributori e amministrazione. Contenuto allineato a sinistra; dashboard con riepilogo mensile, analisi e dettagli espandibili. Su telefono: accessi rapidi in basso e menu completo.
- Il rosso conserva l'identità iNES e segnala l'azione principale e il mese aperto. I colori dei servizi mantengono il loro significato. Nessun dato dimostrativo nell'applicazione.

La struttura precedente, con molte schede orizzontali e sezioni tutte in colonna, rendeva difficile orientarsi. La nuova disposizione privilegia i percorsi reali: controllare gli incassi, registrare la giornata, organizzare la squadra e rifornire i distributori.

## Skills scaricate da GitHub

- [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), installata in `.agents/skills/github-frontend-design`.
- [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), installata in `.agents/skills/github-web-design-guidelines`.

La UI si attiva dopo il controllo di accesso esistente. Gli elementi dei moduli, gli identificativi, i calcoli e i servizi vengono conservati. I CSS sono isolati sotto `body.admin-ui` e limitati allo schermo per preservare la stampa.

## Verifica

- `npm run build` completa il controllo TypeScript e la build Vite.
- Verificate nel browser tutte le 15 destinazioni, i filtri annuale/12 mesi, il cambio mese, ricerca e navigazione da tastiera, aggiornamento dashboard e accesso alla registrazione degli incassi.
- Controllati desktop, tablet e telefono; la pagina dipendenti produce screenshot identici alla versione precedente a 1440 e 390 pixel.
- Le anteprime in `.admin-review.local` usano dati dimostrativi in un contesto browser isolato. Nessun dato di esempio viene incluso nel codice dell'applicazione o inviato ai servizi remoti.
