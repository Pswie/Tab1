# Area amministrativa iNES

Rifacimento limitato al profilo amministratore. La versione dipendenti resta in attesa della valutazione del titolare.

## Direzione

- Fondo nebbia `#f5f6f8`, superfici bianche `#ffffff`, inchiostro `#202730`, testo secondario `#606b78`, divisori `#e3e7ec`, rosso iNES `#c52f2b`.
- Manrope variabile ospitato localmente, esclusivo dell'admin: testi correnti 13–14 px, metadati da 12 px, cifre tabulari. Titoli con spaziatura naturale e importi che mantengono leggibilità anche su telefono. Il font dipendenti resta quello originale.
- Navigazione laterale raggruppata per il negozio, organizzazione, distributori e amministrazione. Contenuto allineato a sinistra; dashboard con riepilogo mensile, analisi e dettagli espandibili. Su telefono: accessi rapidi in basso e menu completo.
- Il rosso conserva l'identità iNES e segnala l'azione principale e il mese aperto. I colori dei servizi mantengono il loro significato. Nessun dato dimostrativo nell'applicazione.

La struttura precedente, con molte schede orizzontali e sezioni tutte in colonna, rendeva difficile orientarsi. La nuova disposizione privilegia i percorsi reali: controllare gli incassi, registrare la giornata, organizzare la squadra e rifornire i distributori.

## Revisione del 14 settembre

La prima proposta aveva testi troppo minuti, un riepilogo mobile alto circa 470 px e grafici con molto spazio inutilizzato. La seconda revisione aumenta la leggibilità e porta il riepilogo a circa 280 px su un telefono da 390 px. Le barre sono consultabili con tastiera e tocco, con importi esatti e una scala che comprende lo zero. Gli approfondimenti si aprono quando servono. La navigazione laterale si può ridurre e ricorda la preferenza; il riepilogo di cassa resta vicino ai campi. Gli interventi restano confinati al ruolo amministratore.

## Skills scaricate da GitHub

- [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), installata in `.agents/skills/github-frontend-design`.
- [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), installata in `.agents/skills/github-web-design-guidelines`.

La UI si attiva dopo il controllo di accesso esistente. Il modulo di presentazione e i suoi CSS vengono importati solo se `amministratore()` restituisce vero; anche il font locale viene richiesto soltanto in quel caso. Gli elementi dei moduli, gli identificativi, i calcoli e i servizi vengono conservati. I CSS sono isolati sotto `body.admin-ui` e limitati allo schermo per preservare la stampa. Manrope è distribuito con la licenza OFL inclusa in `public/fonts`.

## Verifica

- `npm run build` completa il controllo TypeScript e la build Vite.
- Verificate nel browser tutte le 15 destinazioni, i filtri annuale/12 mesi, il cambio mese, ricerca e navigazione da tastiera, aggiornamento dashboard e accesso alla registrazione degli incassi.
- Controllati desktop, tablet e telefono; la pagina dipendenti produce screenshot identici alla versione precedente a 1440 e 390 pixel.
- Le anteprime in `.admin-review.local` usano dati dimostrativi in un contesto browser isolato. Nessun dato di esempio viene incluso nel codice dell'applicazione o inviato ai servizi remoti.
