-- =========================================================================
-- SCHEMA SUPABASE: TABACCHERIA iNES
--
-- QUESTO FILE SI PUÒ RIESEGUIRE QUANDE VOLTE SERVE SENZA PERDERE NIENTE.
--
-- Non contiene nessun DROP TABLE: le tabelle si creano solo se mancano e le
-- colonne nuove si aggiungono a quelle esistenti. Le uniche cose ricreate ogni
-- volta sono viste, funzioni, trigger, policy e colonne calcolate, che non
-- contengono dati propri ma si ricavano dagli altri.
--
-- Ogni giornata ha DUE righe in daily_logs, una per turno:
--   turno = 'mattina'      chiusura di metà giornata (tra le 10:00 e le 16:00)
--   turno = 'pomeriggio'   chiusura di fine giornata (dalle 16:00 alle 10:00)
--
-- I valori del pomeriggio sono LETTURE CUMULATIVE dell'intera giornata: con
-- mattina 1000 e pomeriggio 2000 il secondo turno vale 1000 e il totale della
-- giornata vale 2000.
-- =========================================================================

-- La vista va tolta per prima: dipende da colonne calcolate che vengono
-- rigenerate più avanti, e finché esiste ne impedisce la sostituzione.
DROP VIEW IF EXISTS public.riepilogo_giornaliero;
DROP VIEW IF EXISTS public.fatture_per_voce;
DROP VIEW IF EXISTS public.fatture_registrate;


-- =========================================================================
-- 1. REGISTRO INCASSI: una riga per giornata e turno
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    turno TEXT NOT NULL CHECK (turno IN ('mattina', 'pomeriggio')),

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    user_id UUID,

    tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    UNIQUE (date, turno)
);

-- Voci aggiunte dopo la prima versione
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS mooney NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Contanti in cassa: entra nel totale del turno al posto dei tabacchi
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS contanti NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Voci da statistiche: si registrano soltanto, non entrano in nessun totale.
-- Ci sono finiti anche i tabacchi, che prima facevano parte del totale.
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS bar NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS logista NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS gratta_e_vinci NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Sisal a entrate e uscite, come il Lotto: nel totale entra il netto. Prima
-- era una voce sola, e un'uscita si registrava scrivendoci il meno davanti.
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS sisal_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS sisal_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Le chiusure già registrate portano l'importo nella voce giusta: positivo
-- fra le entrate, negativo fra le uscite. Il netto resta identico, quindi
-- nessun totale del passato cambia.
--
-- La vecchia colonna 'sisal' non viene toccata né cancellata: resta com'era,
-- come copia di quello che era stato scritto, ma non fa più totale. La
-- condizione sulle due colonne nuove fa sì che rieseguire questo file non
-- ricopi niente una seconda volta.
UPDATE public.daily_logs
SET sisal_entrate = GREATEST(sisal, 0),
    sisal_uscite = GREATEST(-sisal, 0)
WHERE sisal <> 0
  AND sisal_entrate = 0
  AND sisal_uscite = 0;

-- Le fatture una per una, col nome di cosa e' stato pagato. La colonna
-- 'fatture' resta e continua a portare il totale: e' quella che entra nel
-- totale del turno, ed e' l'unico dato che hanno le chiusure scritte prima.
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS fatture_voci JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Controllo di cassa: quanto si è contato davvero alla chiusura del turno e la
-- voce B. Nessuna delle due entra nel totale del turno.
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS effettivo NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS b NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Lo scarto del turno: Effettivo contato - Totale del turno - B.
--
-- Non è una colonna calcolata e lo scrive l'app: per il turno pomeriggio il
-- totale è la differenza rispetto alla mattina, e una formula che vede solo la
-- propria riga arriverebbe a un altro numero.
ALTER TABLE public.daily_logs
    ADD COLUMN IF NOT EXISTS differenza_turno NUMERIC(12,2) NOT NULL DEFAULT 0.00;

-- Le colonne calcolate si rifanno ogni volta: non contengono dati propri,
-- quindi rigenerarle è l'unico modo per aggiornarne la formula senza rischi.
ALTER TABLE public.daily_logs DROP COLUMN IF EXISTS totale_turno;
ALTER TABLE public.daily_logs DROP COLUMN IF EXISTS lotto_netto;
ALTER TABLE public.daily_logs DROP COLUMN IF EXISTS lotto_aggio;
ALTER TABLE public.daily_logs DROP COLUMN IF EXISTS compilato;

-- Del Lotto entra il netto: le vincite pagate escono davvero dalla cassa e
-- vanno tolte. Il giocato, la cifra su cui si prende l'aggio, si guarda nella
-- dashboard e non nel totale del turno.
ALTER TABLE public.daily_logs
    ADD COLUMN totale_turno NUMERIC(12,2) GENERATED ALWAYS AS (
        (contanti + (sisal_entrate - sisal_uscite) + mooney + lis + printer
            + (lotto_entrate - lotto_uscite)) - fatture
    ) STORED;

ALTER TABLE public.daily_logs
    ADD COLUMN lotto_netto NUMERIC(12,2) GENERATED ALWAYS AS (
        lotto_entrate - lotto_uscite
    ) STORED;

ALTER TABLE public.daily_logs
    ADD COLUMN lotto_aggio NUMERIC(12,2) GENERATED ALWAYS AS (
        lotto_entrate * 0.08
    ) STORED;

-- Distingue "turno a zero perché non ancora inserito" da "turno davvero a zero".
-- Le voci da statistiche restano fuori: da sole non fanno considerare chiuso
-- un turno che nessuno ha ancora compilato.
ALTER TABLE public.daily_logs
    ADD COLUMN compilato BOOLEAN GENERATED ALWAYS AS (
        contanti <> 0 OR sisal_entrate <> 0 OR sisal_uscite <> 0 OR mooney <> 0
        OR lis <> 0 OR printer <> 0
        OR lotto_entrate <> 0 OR lotto_uscite <> 0 OR fatture <> 0
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON public.daily_logs(date DESC, turno);


-- =========================================================================
-- 2. NOTE DELLA GIORNATA
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.daily_notes (
    date DATE PRIMARY KEY,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    notes TEXT DEFAULT '',
    todos JSONB DEFAULT '[]'::jsonb
);


-- =========================================================================
-- 3. STORICO: copie di sicurezza delle chiusure sovrascritte
--
-- La riga viva in daily_logs è sempre la più recente; ogni copia archiviata
-- prende il numero successivo per quel giorno e quel turno, partendo da 2.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.daily_logs_storico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    turno TEXT NOT NULL,
    versione INTEGER NOT NULL,

    archiviato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    -- Da quando era ferma la versione archiviata (il suo updated_at)
    ferma_dal TIMESTAMP WITH TIME ZONE,

    tabacchi NUMERIC(10,2),
    sisal NUMERIC(10,2),
    lis NUMERIC(10,2),
    printer NUMERIC(10,2),
    lotto_entrate NUMERIC(10,2),
    lotto_uscite NUMERIC(10,2),
    fatture NUMERIC(10,2),
    totale_turno NUMERIC(12,2),

    UNIQUE (date, turno, versione)
);

ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS mooney NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS bar NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS contanti NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS logista NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS gratta_e_vinci NUMERIC(10,2);

-- Le voci aggiunte dopo devono finire nello storico come tutte le altre:
-- una copia di sicurezza che ne salta qualcuna non è una copia
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS sisal_entrate NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS sisal_uscite NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS effettivo NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS b NUMERIC(10,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS differenza_turno NUMERIC(12,2);
ALTER TABLE public.daily_logs_storico
    ADD COLUMN IF NOT EXISTS fatture_voci JSONB;

CREATE INDEX IF NOT EXISTS idx_storico_date
    ON public.daily_logs_storico(date DESC, turno, versione DESC);


-- =========================================================================
-- 4. TRIGGER DI ARCHIVIAZIONE
--
-- L'app salva in automatico mentre si digita, quindi archiviare a ogni
-- scrittura riempirebbe lo storico di righe inutili. Si archivia solo quando
-- si modifica una chiusura RIMASTA FERMA DA ALMENO 2 ORE: è il segnale che
-- non si sta più compilando, ma si sta cambiando un dato già consolidato.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.archivia_versione_precedente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    prossima_versione INTEGER;
BEGIN
    IF (OLD.contanti, OLD.tabacchi, OLD.bar, OLD.logista, OLD.gratta_e_vinci,
        OLD.sisal_entrate, OLD.sisal_uscite, OLD.mooney, OLD.lis, OLD.printer,
        OLD.lotto_entrate, OLD.lotto_uscite, OLD.fatture, OLD.fatture_voci,
        OLD.effettivo, OLD.b)
       IS DISTINCT FROM
       (NEW.contanti, NEW.tabacchi, NEW.bar, NEW.logista, NEW.gratta_e_vinci,
        NEW.sisal_entrate, NEW.sisal_uscite, NEW.mooney, NEW.lis, NEW.printer,
        NEW.lotto_entrate, NEW.lotto_uscite, NEW.fatture, NEW.fatture_voci,
        NEW.effettivo, NEW.b)
    THEN
        IF OLD.updated_at < now() - INTERVAL '2 hours' THEN
            SELECT COALESCE(MAX(versione), 1) + 1
              INTO prossima_versione
              FROM public.daily_logs_storico
             WHERE date = OLD.date AND turno = OLD.turno;

            INSERT INTO public.daily_logs_storico (
                date, turno, versione, ferma_dal,
                contanti, tabacchi, bar, logista, gratta_e_vinci,
                sisal, sisal_entrate, sisal_uscite, mooney, lis, printer,
                lotto_entrate, lotto_uscite, fatture, fatture_voci,
                effettivo, b, differenza_turno, totale_turno
            ) VALUES (
                OLD.date, OLD.turno, prossima_versione, OLD.updated_at,
                OLD.contanti, OLD.tabacchi, OLD.bar, OLD.logista, OLD.gratta_e_vinci,
                OLD.sisal, OLD.sisal_entrate, OLD.sisal_uscite, OLD.mooney, OLD.lis, OLD.printer,
                OLD.lotto_entrate, OLD.lotto_uscite, OLD.fatture, OLD.fatture_voci,
                OLD.effettivo, OLD.b, OLD.differenza_turno, OLD.totale_turno
            );
        END IF;

        -- Il conto delle 2 ore riparte dall'ultima modifica vera di un importo
        NEW.updated_at := now();
    END IF;

    RETURN NEW;
END;
$$;

-- Un trigger non si sostituisce: va tolto e rimesso, ma non contiene dati
DROP TRIGGER IF EXISTS trg_archivia_versione ON public.daily_logs;
CREATE TRIGGER trg_archivia_versione
    BEFORE UPDATE ON public.daily_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.archivia_versione_precedente();


-- =========================================================================
-- 5. INVENTARIO
--
-- Si registrano le DIFFERENZE rilevate contando il magazzino, non le giacenze
-- totali: un valore negativo indica merce mancante, uno positivo merce trovata
-- in più. Zero significa che il conto torna.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.inventario_gratta_e_vinci (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    gioco TEXT NOT NULL,
    prezzo NUMERIC(10,2) NOT NULL,

    pacchi INTEGER NOT NULL DEFAULT 0,
    pezzi INTEGER NOT NULL DEFAULT 0,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    UNIQUE (date, gioco)
);

CREATE INDEX IF NOT EXISTS idx_inv_gev_date
    ON public.inventario_gratta_e_vinci(date DESC);

CREATE TABLE IF NOT EXISTS public.inventario_sigarette (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    marca TEXT NOT NULL,

    stecche INTEGER NOT NULL DEFAULT 0,
    pacchetti INTEGER NOT NULL DEFAULT 0,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    UNIQUE (date, marca)
);

CREATE INDEX IF NOT EXISTS idx_inv_sig_date
    ON public.inventario_sigarette(date DESC);


-- =========================================================================
-- 6. CATALOGHI
--
-- L'elenco degli articoli è modificabile dall'app, quindi vive nel database e
-- non nel codice. Al primo avvio, se le tabelle sono vuote, l'app le riempie
-- con gli articoli ricavati dagli ordini e dalle fatture.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.catalogo_gratta_e_vinci (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gioco TEXT NOT NULL UNIQUE,
    prezzo NUMERIC(10,2) NOT NULL,
    pezzi_per_pacco INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalogo_tabacchi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prodotto TEXT NOT NULL UNIQUE,
    marca TEXT NOT NULL,
    categoria TEXT NOT NULL
        CHECK (categoria IN ('sigarette', 'elettronico', 'sigari', 'busta_scatola')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_tab_categoria
    ON public.catalogo_tabacchi(categoria, marca);


-- =========================================================================
-- 7. ATTIVITÀ
--
-- Non appartengono a una giornata: restano in elenco finché non vengono
-- svolte. Per questo stanno in una tabella propria e non dentro daily_notes.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.attivita (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    testo TEXT NOT NULL,
    completata BOOLEAN NOT NULL DEFAULT false,

    creata_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    completata_il TIMESTAMP WITH TIME ZONE,
    creata_da TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_attivita_stato
    ON public.attivita(completata, creata_il DESC);


-- =========================================================================
-- 8. TASSA DI SOGGIORNO
--
-- I soggiorni non si inseriscono a mano: arrivano dai calendari iCal delle
-- camere, da cui si ricavano nome, date, notti e numero di ospiti.
-- =========================================================================

-- Indirizzi dei calendari, uno per camera. Contengono un token personale,
-- quindi si inseriscono dall'app e non stanno nel codice del progetto.
CREATE TABLE IF NOT EXISTS public.calendari_ical (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etichetta TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL UNIQUE,
    attivo BOOLEAN NOT NULL DEFAULT true,
    aggiornato_il TIMESTAMP WITH TIME ZONE,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tassa_soggiorno (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificativo dell'evento nel calendario: evita che un nuovo scarico
    -- duplichi soggiorni già registrati e già incassati
    uid TEXT NOT NULL UNIQUE,

    nome TEXT NOT NULL DEFAULT 'Ospite',
    data_inizio DATE NOT NULL,
    data_fine DATE NOT NULL,

    notti INTEGER NOT NULL DEFAULT 0,

    -- Ospiti come li conta il calendario: comprende anche i bambini
    ospiti INTEGER NOT NULL DEFAULT 1,

    tariffa NUMERIC(10,2) NOT NULL DEFAULT 3.00,

    pagata BOOLEAN NOT NULL DEFAULT false,
    pagata_il TIMESTAMP WITH TIME ZONE,

    importato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- I bambini non pagano l'imposta, ma il calendario non li distingue:
-- il numero si indica a mano e l'importazione non lo tocca più
ALTER TABLE public.tassa_soggiorno
    ADD COLUMN IF NOT EXISTS bambini INTEGER NOT NULL DEFAULT 0;

-- Notti x tariffa x paganti, dove i paganti sono gli ospiti meno i bambini
ALTER TABLE public.tassa_soggiorno DROP COLUMN IF EXISTS importo;
ALTER TABLE public.tassa_soggiorno
    ADD COLUMN importo NUMERIC(12,2) GENERATED ALWAYS AS (
        notti * tariffa * GREATEST(ospiti - bambini, 0)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_soggiorno_fine
    ON public.tassa_soggiorno(data_fine DESC, pagata);


-- =========================================================================
-- 9. NOTIFICHE PUSH
--
-- Ogni dispositivo che concede il permesso registra qui il proprio recapito.
-- Serve a far arrivare l'avviso di una nuova attività anche ad app chiusa:
-- senza un elenco di destinatari il server non saprebbe a chi scrivere.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.push_iscrizioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Recapito del browser: cambia se l'utente reinstalla l'app
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,

    -- Identifica il dispositivo che ha scritto, per non notificare se stesso
    dispositivo TEXT NOT NULL DEFAULT '',

    creata_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);


-- =========================================================================
-- 10. VISTA DI RIEPILOGO
--
-- Rimette insieme le due righe della giornata e fa il conto del secondo turno,
-- così i dati si leggono dal database senza doverli sottrarre a mano.
--
-- security_invoker = on: senza questa opzione la vista girerebbe con i permessi
-- del proprietario e scavalcherebbe le policy RLS delle tabelle sottostanti.
-- =========================================================================
CREATE VIEW public.riepilogo_giornaliero
WITH (security_invoker = on) AS
SELECT
    date,
    COALESCE(MAX(totale_turno) FILTER (WHERE turno = 'mattina' AND compilato), 0)
        AS totale_turno_1,

    MAX(totale_turno) FILTER (WHERE turno = 'pomeriggio' AND compilato)
        AS lettura_pomeriggio,

    -- Turno 2 = lettura cumulativa del pomeriggio meno la chiusura della mattina
    MAX(totale_turno) FILTER (WHERE turno = 'pomeriggio' AND compilato)
        - COALESCE(MAX(totale_turno) FILTER (WHERE turno = 'mattina' AND compilato), 0)
        AS totale_turno_2,

    -- Finché il pomeriggio non è compilato, la giornata vale la sola mattina
    COALESCE(
        MAX(totale_turno) FILTER (WHERE turno = 'pomeriggio' AND compilato),
        MAX(totale_turno) FILTER (WHERE turno = 'mattina' AND compilato),
        0
    ) AS totale_giornata
FROM public.daily_logs
GROUP BY date;


-- =========================================================================
-- 10bis. FATTURE, UNA RIGA PER VOCE
--
-- Le fatture si scrivono nella chiusura del turno, dentro a fatture_voci.
-- Li' dentro sono comode da salvare ma non da interrogare: queste due viste
-- le srotolano in righe vere, cosi' si puo' chiedere al database dove se ne
-- vanno i soldi senza aprire l'app.
--
-- Sono viste e non tabelle: si ricavano da quello che c'e' gia', quindi non
-- possono raccontare qualcosa di diverso dalla chiusura da cui vengono.
--
-- ATTENZIONE alla giornata: la chiusura del pomeriggio e' cumulativa e si
-- porta dentro anche le fatture della mattina. Per non contarle due volte si
-- prende il pomeriggio quando c'e', e la mattina soltanto altrimenti.
-- =========================================================================
CREATE VIEW public.fatture_registrate
WITH (security_invoker = on) AS
WITH turno_buono AS (
    SELECT DISTINCT ON (date)
           date, turno, fatture_voci
      FROM public.daily_logs
     WHERE jsonb_array_length(fatture_voci) > 0
     ORDER BY date, (turno = 'pomeriggio') DESC
)
SELECT
    t.date,
    t.turno,
    TRIM(voce->>'nome') AS nome,
    COALESCE((voce->>'importo')::NUMERIC, 0) AS importo
FROM turno_buono t,
     LATERAL jsonb_array_elements(t.fatture_voci) AS voce
WHERE TRIM(COALESCE(voce->>'nome', '')) <> '';

-- Quanto se n'e' andato per ogni voce, dalla piu' cara. I nomi si accorpano
-- senza badare a maiuscole: "cartine" e "Cartine" sono la stessa spesa.
CREATE VIEW public.fatture_per_voce
WITH (security_invoker = on) AS
SELECT
    LOWER(nome) AS voce,
    MIN(nome) AS nome,
    COUNT(*) AS quante,
    SUM(importo) AS totale,
    MIN(date) AS dalla,
    MAX(date) AS fino_a
FROM public.fatture_registrate
GROUP BY LOWER(nome)
ORDER BY SUM(importo) DESC;


-- =========================================================================
-- 11. ROW LEVEL SECURITY
--
-- Le policy si rifanno ogni volta: sono regole, non dati.
-- =========================================================================
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs_storico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_gratta_e_vinci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_sigarette ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_gratta_e_vinci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_tabacchi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attivita ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendari_ical ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tassa_soggiorno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_iscrizioni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lettura registri" ON public.daily_logs;
CREATE POLICY "Lettura registri" ON public.daily_logs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura registri" ON public.daily_logs;
CREATE POLICY "Scrittura registri" ON public.daily_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura note" ON public.daily_notes;
CREATE POLICY "Lettura note" ON public.daily_notes FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura note" ON public.daily_notes;
CREATE POLICY "Scrittura note" ON public.daily_notes FOR ALL USING (true) WITH CHECK (true);

-- Lo storico è di sola lettura per l'app: lo scrive unicamente il trigger,
-- che gira come proprietario e non passa da queste policy. Così una copia di
-- sicurezza non può essere sovrascritta o cancellata.
DROP POLICY IF EXISTS "Lettura storico" ON public.daily_logs_storico;
CREATE POLICY "Lettura storico" ON public.daily_logs_storico FOR SELECT USING (true);

DROP POLICY IF EXISTS "Lettura inventario gratta e vinci" ON public.inventario_gratta_e_vinci;
CREATE POLICY "Lettura inventario gratta e vinci" ON public.inventario_gratta_e_vinci
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura inventario gratta e vinci" ON public.inventario_gratta_e_vinci;
CREATE POLICY "Scrittura inventario gratta e vinci" ON public.inventario_gratta_e_vinci
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura inventario sigarette" ON public.inventario_sigarette;
CREATE POLICY "Lettura inventario sigarette" ON public.inventario_sigarette
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura inventario sigarette" ON public.inventario_sigarette;
CREATE POLICY "Scrittura inventario sigarette" ON public.inventario_sigarette
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci;
CREATE POLICY "Lettura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci;
CREATE POLICY "Scrittura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura catalogo tabacchi" ON public.catalogo_tabacchi;
CREATE POLICY "Lettura catalogo tabacchi" ON public.catalogo_tabacchi
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura catalogo tabacchi" ON public.catalogo_tabacchi;
CREATE POLICY "Scrittura catalogo tabacchi" ON public.catalogo_tabacchi
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura attivita" ON public.attivita;
CREATE POLICY "Lettura attivita" ON public.attivita FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura attivita" ON public.attivita;
CREATE POLICY "Scrittura attivita" ON public.attivita FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura calendari" ON public.calendari_ical;
CREATE POLICY "Lettura calendari" ON public.calendari_ical FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura calendari" ON public.calendari_ical;
CREATE POLICY "Scrittura calendari" ON public.calendari_ical FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura tassa soggiorno" ON public.tassa_soggiorno;
CREATE POLICY "Lettura tassa soggiorno" ON public.tassa_soggiorno FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura tassa soggiorno" ON public.tassa_soggiorno;
CREATE POLICY "Scrittura tassa soggiorno" ON public.tassa_soggiorno
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura iscrizioni push" ON public.push_iscrizioni;
CREATE POLICY "Lettura iscrizioni push" ON public.push_iscrizioni FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura iscrizioni push" ON public.push_iscrizioni;
CREATE POLICY "Scrittura iscrizioni push" ON public.push_iscrizioni
    FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 12. ACCESSO
--
-- Chiunque può iscriversi, ma nessuno entra finché non gli viene concesso
-- l'accesso: la colonna 'accesso' parte da false e si mette a true a mano
-- dalla tabella su Supabase.
--
-- Il profilo viene creato da solo alla registrazione, così l'elenco delle
-- persone da approvare si riempie senza doverci pensare.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profili (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    nome TEXT NOT NULL DEFAULT '',

    -- Da mettere a true per far entrare la persona
    accesso BOOLEAN NOT NULL DEFAULT false,

    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Chi amministra fa tutto quello che fa un dipendente e in più vede la
-- dashboard con incassi e statistiche. Parte da false e si mette a true a mano
-- dalla tabella su Supabase, come l'accesso: nessuna policy consente di
-- scrivere su profili, quindi dall'app non ci si può promuovere da soli.
ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.crea_profilo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profili (id, email, nome)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', ''))
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crea_profilo ON auth.users;
CREATE TRIGGER trg_crea_profilo
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.crea_profilo();

ALTER TABLE public.profili ENABLE ROW LEVEL SECURITY;

-- Ognuno vede soltanto il proprio profilo: serve a sapere se può entrare,
-- non a farsi l'elenco dei colleghi.
DROP POLICY IF EXISTS "Lettura del proprio profilo" ON public.profili;
CREATE POLICY "Lettura del proprio profilo" ON public.profili
    FOR SELECT USING (auth.uid() = id);


-- =========================================================================
-- 13. REGISTRO NUMERI
--
-- La rubrica del negozio: fornitori, tecnici, clienti da richiamare. Sta qui
-- e non sul telefono di chi l'ha scritta, così la trovano tutti.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.rubrica (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    nome TEXT NOT NULL,
    telefono TEXT NOT NULL,

    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- Chi l'ha messo in elenco, per sapere a chi chiedere se il numero non torna
    creato_da TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_rubrica_nome ON public.rubrica(nome);

ALTER TABLE public.rubrica ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lettura rubrica" ON public.rubrica;
CREATE POLICY "Lettura rubrica" ON public.rubrica FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura rubrica" ON public.rubrica;
CREATE POLICY "Scrittura rubrica" ON public.rubrica FOR ALL USING (true) WITH CHECK (true);


-- =========================================================================
-- 14. DISTRIBUTORI H24
--
-- Le macchine lavorano anche a negozio chiuso. Si segna cosa manca dentro,
-- per sapere cosa portare al prossimo giro, e mese per mese quanto hanno
-- incassato: quel totale è quello che poi si dichiara.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.h24_prodotti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    nome TEXT NOT NULL,

    -- In quale delle tre macchine sta il prodotto
    distributore TEXT NOT NULL DEFAULT 'vari'
        CHECK (distributore IN ('drink', 'snack', 'vari')),

    -- La scheda del prodotto: quanti pezzi ci sono dentro a un pacco. È quello
    -- che permette di sapere per certo quanti pezzi sono usciti, visto che si
    -- compra a pacchi e non a pezzi.
    pezzi_per_pacco INTEGER NOT NULL DEFAULT 1 CHECK (pezzi_per_pacco > 0),

    -- Quanti pacchi mancano per riempire la macchina: zero vuol dire piena
    pacchi_mancanti INTEGER NOT NULL DEFAULT 0,

    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Su una tabella creata da una versione precedente le colonne vanno aggiunte
ALTER TABLE public.h24_prodotti
    ADD COLUMN IF NOT EXISTS distributore TEXT NOT NULL DEFAULT 'vari';

ALTER TABLE public.h24_prodotti
    ADD COLUMN IF NOT EXISTS pezzi_per_pacco INTEGER NOT NULL DEFAULT 1;

-- Il conteggio è passato dai pezzi ai pacchi: si rinomina la colonna invece di
-- affiancarne una nuova, così quello che era già stato segnato non si perde.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'h24_prodotti'
           AND column_name = 'mancanti'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'h24_prodotti'
           AND column_name = 'pacchi_mancanti'
    ) THEN
        ALTER TABLE public.h24_prodotti RENAME COLUMN mancanti TO pacchi_mancanti;
    END IF;
END $$;

ALTER TABLE public.h24_prodotti
    ADD COLUMN IF NOT EXISTS pacchi_mancanti INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.h24_prodotti DROP CONSTRAINT IF EXISTS h24_prodotti_distributore_check;
ALTER TABLE public.h24_prodotti
    ADD CONSTRAINT h24_prodotti_distributore_check
    CHECK (distributore IN ('drink', 'snack', 'vari'));

CREATE INDEX IF NOT EXISTS idx_h24_prodotti_macchina
    ON public.h24_prodotti(distributore, nome);

-- Un incasso per mese. Il mese si conserva come primo giorno del mese, così
-- resta una data vera e si ordina da sola.
CREATE TABLE IF NOT EXISTS public.h24_incassi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    mese DATE NOT NULL UNIQUE,
    importo NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    -- La dichiarazione dei distributori si fa a mese concluso: finché questa
    -- resta false, l'app continua a ricordarlo
    dichiarato BOOLEAN NOT NULL DEFAULT false,
    dichiarato_il TIMESTAMP WITH TIME ZONE,

    nota TEXT NOT NULL DEFAULT '',
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ogni macchina ha il suo contatore e si svuota per conto suo: il totale del
-- mese e' la somma delle tre, ma serve sapere quale sta lavorando.
ALTER TABLE public.h24_incassi
    ADD COLUMN IF NOT EXISTS importo_drink NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.h24_incassi
    ADD COLUMN IF NOT EXISTS importo_snack NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.h24_incassi
    ADD COLUMN IF NOT EXISTS importo_vari NUMERIC(12,2) NOT NULL DEFAULT 0.00;

-- La colonna 'importo' resta e continua a portare il totale del mese: sui mesi
-- segnati prima e' l'unico dato che c'e', e non si sa come dividerlo fra le
-- tre macchine. Da adesso la scrive l'app come somma delle tre.

CREATE INDEX IF NOT EXISTS idx_h24_incassi_mese ON public.h24_incassi(mese DESC);

-- Ogni giro di rifornimento lascia qui quello che è stato rimesso dentro.
--
-- È l'unico modo per sapere cosa vende: nella macchina non c'è un registratore
-- di cassa per prodotto, ma quello che si rimette dentro è esattamente quello
-- che è uscito. Il nome si copia nella riga e non si lascia solo il
-- collegamento: un prodotto tolto dall'elenco non deve cancellare la storia
-- di quanto ha venduto.
CREATE TABLE IF NOT EXISTS public.h24_rifornimenti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prodotto_id UUID REFERENCES public.h24_prodotti(id) ON DELETE SET NULL,
    nome TEXT NOT NULL,
    distributore TEXT NOT NULL DEFAULT 'vari',

    -- Si compra a pacchi; i pezzi sono quelli davvero usciti dalla macchina,
    -- cioè i pacchi moltiplicati per quanti ne conteneva ciascuno. Il numero
    -- si copia qui e non si ricava ogni volta dalla scheda: se domani cambia
    -- la confezione, i conti di ieri devono restare quelli di ieri.
    pacchi INTEGER NOT NULL DEFAULT 0,
    pezzi_per_pacco INTEGER NOT NULL DEFAULT 1,
    pezzi INTEGER NOT NULL DEFAULT 0,

    il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.h24_rifornimenti
    ADD COLUMN IF NOT EXISTS pacchi INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.h24_rifornimenti
    ADD COLUMN IF NOT EXISTS pezzi_per_pacco INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_h24_rifornimenti_quando
    ON public.h24_rifornimenti(il DESC);

ALTER TABLE public.h24_prodotti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h24_incassi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h24_rifornimenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lettura rifornimenti h24" ON public.h24_rifornimenti;
CREATE POLICY "Lettura rifornimenti h24" ON public.h24_rifornimenti FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura rifornimenti h24" ON public.h24_rifornimenti;
CREATE POLICY "Scrittura rifornimenti h24" ON public.h24_rifornimenti
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura prodotti h24" ON public.h24_prodotti;
CREATE POLICY "Lettura prodotti h24" ON public.h24_prodotti FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura prodotti h24" ON public.h24_prodotti;
CREATE POLICY "Scrittura prodotti h24" ON public.h24_prodotti
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Lettura incassi h24" ON public.h24_incassi;
CREATE POLICY "Lettura incassi h24" ON public.h24_incassi FOR SELECT USING (true);
DROP POLICY IF EXISTS "Scrittura incassi h24" ON public.h24_incassi;
CREATE POLICY "Scrittura incassi h24" ON public.h24_incassi
    FOR ALL USING (true) WITH CHECK (true);


-- =========================================================================
-- 15. TURNI DI LAVORO
--
-- Chi lavora, in che giornata e in quale fascia: mattina, intermedio,
-- pomeriggio, festa e ferie. Non c'entra niente con le chiusure di cassa, che
-- pure si chiamano turni: qui non ci sono importi, solo nomi.
--
-- I turni li scrive l'app: qui c'è soltanto come è fatta la tabella.
--
-- Lo leggono tutti, lo scrive soltanto chi amministra: il divieto sta qui e
-- non solo nell'interfaccia, così nascondere i comandi resta una comodità e
-- non l'unica barriera.
-- =========================================================================

-- Serve alle policy per sapere chi amministra senza rileggere profili con le
-- sue stesse regole di riga, che si morderebbero la coda.
CREATE OR REPLACE FUNCTION public.e_amministratore()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profili
        WHERE id = auth.uid()
          AND accesso
          AND admin
    );
$$;

CREATE TABLE IF NOT EXISTS public.turni_lavoro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    data DATE NOT NULL,

    -- Le fasce del foglio appeso in negozio. L'intermedio non c'è tutti i
    -- giorni ed è normale; le ferie valgono per più giornate di fila e si
    -- scrivono una riga per giorno, come tutto il resto.
    turno TEXT NOT NULL,

    -- Il nome scritto per esteso: i turni si assegnano anche a chi non ha un
    -- profilo sull'app, e un riferimento a profili lascerebbe fuori proprio
    -- quelli
    persona TEXT NOT NULL,

    -- Una precisazione breve accanto al nome: "entra alle 7", "fino alle 12"
    nota TEXT NOT NULL DEFAULT '',

    creato_da TEXT NOT NULL DEFAULT '',
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- La stessa persona sta in un turno una volta sola: riassegnarla aggiorna
    -- la sua nota invece di sdoppiare la riga
    UNIQUE (data, turno, persona)
);

-- Il vincolo si rifà ogni volta: le fasce sono cambiate dopo la prima versione
-- e una tabella già creata resterebbe ferma a quelle vecchie.
ALTER TABLE public.turni_lavoro DROP CONSTRAINT IF EXISTS turni_lavoro_turno_check;
ALTER TABLE public.turni_lavoro
    ADD CONSTRAINT turni_lavoro_turno_check
    CHECK (turno IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie'));

CREATE INDEX IF NOT EXISTS idx_turni_lavoro_data ON public.turni_lavoro(data);

ALTER TABLE public.turni_lavoro ENABLE ROW LEVEL SECURITY;

-- Il calendario lo legge chiunque abbia l'accesso: sapere quando si lavora
-- serve prima di tutto a chi ci lavora.
DROP POLICY IF EXISTS "Lettura turni" ON public.turni_lavoro;
CREATE POLICY "Lettura turni" ON public.turni_lavoro FOR SELECT USING (true);

DROP POLICY IF EXISTS "Scrittura turni" ON public.turni_lavoro;
CREATE POLICY "Scrittura turni" ON public.turni_lavoro
    FOR ALL
    USING (public.e_amministratore())
    WITH CHECK (public.e_amministratore());


-- =========================================================================
-- 16. ANTICIPI AI BARISTI
--
-- Registro mensile riservato agli amministratori. Le righe azzerate non
-- compaiono piu' nell'app, ma non vengono cancellate: restano in tabella con
-- data e ora dell'azzeramento per conservare lo storico completo.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.baristi_anticipi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    attivo BOOLEAN NOT NULL DEFAULT true,
    ordine INTEGER NOT NULL DEFAULT 0 CHECK (ordine >= 0),
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Un nome non puo' comparire due volte solo per una differenza di maiuscole.
CREATE UNIQUE INDEX IF NOT EXISTS uq_baristi_anticipi_nome
    ON public.baristi_anticipi (lower(nome));

-- I tre nomi di partenza. ON CONFLICT senza bersaglio rispetta anche l'indice
-- univoco su lower(nome), quindi il file resta rieseguibile.
INSERT INTO public.baristi_anticipi (nome, ordine)
VALUES ('Luigi', 0), ('Paolo', 1), ('Livio', 2)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.anticipi_baristi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Il riferimento aiuta le ricerche; il nome copiato conserva lo storico
    -- anche se in seguito il barista viene nascosto o rinominato.
    barista_id UUID REFERENCES public.baristi_anticipi(id) ON DELETE SET NULL,
    barista_nome TEXT NOT NULL,

    data DATE NOT NULL,
    importo NUMERIC(12,2) NOT NULL CHECK (importo > 0),
    nota TEXT NOT NULL DEFAULT '',
    creato_da TEXT NOT NULL DEFAULT '',
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- Azzera e' un'archiviazione, non una cancellazione.
    azzerato BOOLEAN NOT NULL DEFAULT false,
    azzerato_il TIMESTAMP WITH TIME ZONE,

    CONSTRAINT anticipi_baristi_azzeramento_coerente CHECK (
        (NOT azzerato AND azzerato_il IS NULL)
        OR (azzerato AND azzerato_il IS NOT NULL)
    )
);

-- Colonne aggiunte in modo sicuro anche se la tabella esiste da una versione
-- intermedia della funzione.
ALTER TABLE public.anticipi_baristi
    ADD COLUMN IF NOT EXISTS azzerato BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.anticipi_baristi
    ADD COLUMN IF NOT EXISTS azzerato_il TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.anticipi_baristi
    DROP CONSTRAINT IF EXISTS anticipi_baristi_azzeramento_coerente;
ALTER TABLE public.anticipi_baristi
    ADD CONSTRAINT anticipi_baristi_azzeramento_coerente CHECK (
        (NOT azzerato AND azzerato_il IS NULL)
        OR (azzerato AND azzerato_il IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_anticipi_baristi_data
    ON public.anticipi_baristi (data DESC);
CREATE INDEX IF NOT EXISTS idx_anticipi_baristi_attivi_mese
    ON public.anticipi_baristi (data DESC, barista_id)
    WHERE NOT azzerato;

ALTER TABLE public.baristi_anticipi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anticipi_baristi ENABLE ROW LEVEL SECURITY;

-- La verifica admin per questi dati sensibili vive in uno schema non esposto
-- alla Data API. La funzione controlla auth.uid() e non accetta parametri che
-- il client possa alterare.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.e_amministratore()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profili
        WHERE id = (SELECT auth.uid())
          AND accesso
          AND admin
    );
$$;

REVOKE ALL ON FUNCTION private.e_amministratore() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.e_amministratore() TO authenticated;

-- Si irrobustisce anche la funzione storica usata dai turni: verifica gia'
-- auth.uid() al suo interno, ma non deve essere eseguibile da PUBLIC.
REVOKE ALL ON FUNCTION public.e_amministratore() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.e_amministratore() TO authenticated;

-- Dal 2026 i nuovi progetti possono non esporre automaticamente le tabelle
-- alla Data API: i grant sono espliciti e RLS resta la barriera di riga.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.baristi_anticipi TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anticipi_baristi TO authenticated;

DROP POLICY IF EXISTS "Solo admin gestiscono nomi anticipi" ON public.baristi_anticipi;
CREATE POLICY "Solo admin gestiscono nomi anticipi"
    ON public.baristi_anticipi
    FOR ALL
    TO authenticated
    USING ((SELECT private.e_amministratore()))
    WITH CHECK ((SELECT private.e_amministratore()));

DROP POLICY IF EXISTS "Solo admin gestiscono anticipi" ON public.anticipi_baristi;
CREATE POLICY "Solo admin gestiscono anticipi"
    ON public.anticipi_baristi
    FOR ALL
    TO authenticated
    USING ((SELECT private.e_amministratore()))
    WITH CHECK ((SELECT private.e_amministratore()));


-- =========================================================================
-- 17. DEBITI PER AMMANCHI DI CASSA
--
-- Quando la differenza di un turno e' negativa, l'ammanco viene diviso fra
-- tutte le persone assegnate alla stessa data e fascia nei turni di lavoro.
-- La divisione avviene in centesimi: l'eventuale resto di uno o due centesimi
-- viene distribuito alle prime persone in ordine alfabetico, senza perdere o
-- inventare denaro.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.debiti_turno (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data DATE NOT NULL,
    turno TEXT NOT NULL CHECK (turno IN ('mattina', 'pomeriggio')),
    persona TEXT NOT NULL,
    ammanco_totale NUMERIC(12,2) NOT NULL CHECK (ammanco_totale > 0),
    persone_nel_turno INTEGER NOT NULL CHECK (persone_nel_turno >= 0),
    importo NUMERIC(12,2) NOT NULL CHECK (importo > 0),
    assegnato BOOLEAN NOT NULL DEFAULT true,
    attivo BOOLEAN NOT NULL DEFAULT true,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Una sola posizione corrente per persona, giornata e turno. Il confronto
-- senza maiuscole evita di addebitare due volte "Luigi" e "luigi".
CREATE UNIQUE INDEX IF NOT EXISTS uq_debiti_turno_persona
    ON public.debiti_turno (data, turno, lower(persona));
CREATE INDEX IF NOT EXISTS idx_debiti_turno_attivi_data
    ON public.debiti_turno (data DESC)
    WHERE attivo;

ALTER TABLE public.debiti_turno ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debiti_turno TO authenticated;

DROP POLICY IF EXISTS "Solo admin gestiscono debiti turno" ON public.debiti_turno;
CREATE POLICY "Solo admin gestiscono debiti turno"
    ON public.debiti_turno
    FOR ALL
    TO authenticated
    USING ((SELECT private.e_amministratore()))
    WITH CHECK ((SELECT private.e_amministratore()));

-- Ricalcola la posizione corrente senza cancellare le assegnazioni precedenti:
-- quelle superate vengono soltanto rese inattive e restano in tabella.
CREATE OR REPLACE FUNCTION private.ricalcola_debiti_turno(
    p_data DATE,
    p_turno TEXT,
    p_differenza NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ammanco_centesimi BIGINT;
    v_quante INTEGER;
BEGIN
    IF p_turno NOT IN ('mattina', 'pomeriggio') THEN
        RETURN;
    END IF;

    -- Prima si chiude la posizione precedente. Se l'ammanco non c'e' piu',
    -- queste righe inattive sono lo storico della rettifica.
    UPDATE public.debiti_turno
       SET attivo = false,
           aggiornato_il = now()
     WHERE data = p_data
       AND turno = p_turno
       AND attivo;

    IF COALESCE(p_differenza, 0) >= 0 THEN
        RETURN;
    END IF;

    v_ammanco_centesimi := round(abs(p_differenza) * 100)::BIGINT;

    SELECT count(*)::INTEGER
      INTO v_quante
      FROM (
          SELECT lower(trim(persona))
          FROM public.turni_lavoro
          WHERE data = p_data
            AND turno = p_turno
            AND trim(persona) <> ''
          GROUP BY lower(trim(persona))
      ) persone;

    -- Nessun nome ancora assegnato: l'ammanco non si perde e si ricalcolera'
    -- automaticamente quando l'amministratore compilerà i turni di lavoro.
    IF v_quante = 0 THEN
        INSERT INTO public.debiti_turno (
            data, turno, persona, ammanco_totale, persone_nel_turno,
            importo, assegnato, attivo, aggiornato_il
        )
        VALUES (
            p_data, p_turno, 'Da assegnare',
            (v_ammanco_centesimi / 100.0)::NUMERIC(12,2), 0,
            (v_ammanco_centesimi / 100.0)::NUMERIC(12,2), false, true, now()
        )
        ON CONFLICT (data, turno, lower(persona)) DO UPDATE SET
            ammanco_totale = EXCLUDED.ammanco_totale,
            persone_nel_turno = 0,
            importo = EXCLUDED.importo,
            assegnato = false,
            attivo = true,
            aggiornato_il = now();
        RETURN;
    END IF;

    INSERT INTO public.debiti_turno (
        data, turno, persona, ammanco_totale, persone_nel_turno,
        importo, assegnato, attivo, aggiornato_il
    )
    SELECT
        p_data,
        p_turno,
        persona,
        (v_ammanco_centesimi / 100.0)::NUMERIC(12,2),
        v_quante,
        ((v_ammanco_centesimi / v_quante)
          + CASE WHEN posizione <= (v_ammanco_centesimi % v_quante) THEN 1 ELSE 0 END
        )::NUMERIC / 100,
        true,
        true,
        now()
    FROM (
        SELECT
            min(trim(persona)) AS persona,
            row_number() OVER (ORDER BY lower(trim(persona))) AS posizione
        FROM public.turni_lavoro
        WHERE data = p_data
          AND turno = p_turno
          AND trim(persona) <> ''
        GROUP BY lower(trim(persona))
    ) persone
    ON CONFLICT (data, turno, lower(persona)) DO UPDATE SET
        ammanco_totale = EXCLUDED.ammanco_totale,
        persone_nel_turno = EXCLUDED.persone_nel_turno,
        importo = EXCLUDED.importo,
        assegnato = true,
        attivo = true,
        aggiornato_il = now();
END;
$$;

REVOKE ALL ON FUNCTION private.ricalcola_debiti_turno(DATE, TEXT, NUMERIC) FROM PUBLIC;

-- Ogni salvataggio della chiusura aggiorna immediatamente la divisione.
CREATE OR REPLACE FUNCTION private.aggiorna_debiti_da_incasso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.ricalcola_debiti_turno(NEW.date, NEW.turno, NEW.differenza_turno);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.aggiorna_debiti_da_incasso() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_aggiorna_debiti_da_incasso ON public.daily_logs;
CREATE TRIGGER trg_aggiorna_debiti_da_incasso
    AFTER INSERT OR UPDATE OF differenza_turno
    ON public.daily_logs
    FOR EACH ROW
    EXECUTE FUNCTION private.aggiorna_debiti_da_incasso();

-- Se si correggono i nomi nel calendario, anche una chiusura gia' salvata
-- viene ridistribuita. In UPDATE si ricalcolano sia la vecchia sia la nuova
-- posizione quando data o fascia cambiano.
CREATE OR REPLACE FUNCTION private.aggiorna_debiti_da_turni()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_riga public.daily_logs%ROWTYPE;
BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.turno IN ('mattina', 'pomeriggio') THEN
        SELECT * INTO v_riga
        FROM public.daily_logs
        WHERE date = OLD.data AND turno = OLD.turno;

        IF FOUND THEN
            PERFORM private.ricalcola_debiti_turno(v_riga.date, v_riga.turno, v_riga.differenza_turno);
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.turno IN ('mattina', 'pomeriggio') THEN
        SELECT * INTO v_riga
        FROM public.daily_logs
        WHERE date = NEW.data AND turno = NEW.turno;

        IF FOUND THEN
            PERFORM private.ricalcola_debiti_turno(v_riga.date, v_riga.turno, v_riga.differenza_turno);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.aggiorna_debiti_da_turni() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_aggiorna_debiti_da_turni ON public.turni_lavoro;
CREATE TRIGGER trg_aggiorna_debiti_da_turni
    AFTER INSERT OR UPDATE OR DELETE
    ON public.turni_lavoro
    FOR EACH ROW
    EXECUTE FUNCTION private.aggiorna_debiti_da_turni();

-- Porta nella nuova tabella anche gli ammanchi gia' presenti, se ci sono.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT date, turno, differenza_turno
        FROM public.daily_logs
        WHERE differenza_turno < 0
    LOOP
        PERFORM private.ricalcola_debiti_turno(r.date, r.turno, r.differenza_turno);
    END LOOP;
END;
$$;
