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
-- 7bis. PULIZIE
--
-- Ogni riga è una voce di una checklist settimanale o mensile. Il cambio di
-- periodo non cancella niente: crea nuove righe e lascia quelle scadute come
-- storico, così la dashboard può dire cosa non è stato fatto e da chi era
-- previsto. I responsabili sono una fotografia del periodo, non un calcolo
-- retroattivo sui turni che potrebbero essere corretti in seguito.
-- =========================================================================
DROP VIEW IF EXISTS public.pulizie_non_fatte;

CREATE TABLE IF NOT EXISTS public.pulizie_registro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL CHECK (tipo IN ('bagno', 'settimanale', 'mensile')),
    voce TEXT NOT NULL,
    ordine INTEGER NOT NULL DEFAULT 0,
    periodo_inizio DATE NOT NULL,
    periodo_fine DATE NOT NULL,
    -- Giorno assegnato: per il bagno informa chi era prevista quel giorno,
    -- mentre la X resta consentita fino alla fine della settimana.
    prevista_il DATE,
    turno TEXT CHECK (turno IS NULL OR turno IN ('mattina', 'pomeriggio')),
    gruppo TEXT CHECK (gruppo IS NULL OR gruppo IN ('gruppo-1', 'gruppo-2')),
    responsabili JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(responsabili) = 'array'),
    completata_il TIMESTAMP WITH TIME ZONE,
    completata_da UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    completata_da_nome TEXT NOT NULL DEFAULT '',
    non_fatta_il TIMESTAMP WITH TIME ZONE,
    creata_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CHECK (periodo_fine >= periodo_inizio),
    CHECK (prevista_il IS NULL OR prevista_il BETWEEN periodo_inizio AND periodo_fine),
    UNIQUE (tipo, voce, periodo_inizio)
);

ALTER TABLE public.pulizie_registro
    ADD COLUMN IF NOT EXISTS prevista_il DATE;

CREATE INDEX IF NOT EXISTS idx_pulizie_periodo
    ON public.pulizie_registro(periodo_inizio DESC, tipo, ordine);
DROP INDEX IF EXISTS public.idx_pulizie_scadute;
CREATE INDEX idx_pulizie_scadute
    ON public.pulizie_registro(periodo_fine DESC)
    WHERE non_fatta_il IS NOT NULL;

-- Data da cui parte il registro. Permette di ricostruire periodi interamente
-- trascorsi anche se in quei giorni nessun telefono ha aperto l'app.
CREATE TABLE IF NOT EXISTS public.pulizie_configurazione (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    prima_settimana DATE NOT NULL,
    primo_mese DATE NOT NULL,
    CHECK (EXTRACT(ISODOW FROM prima_settimana) = 1),
    CHECK (EXTRACT(DAY FROM primo_mese) = 1)
);

INSERT INTO public.pulizie_configurazione (id, prima_settimana, primo_mese)
VALUES (true, '2026-08-10'::DATE, '2026-08-01'::DATE)
ON CONFLICT (id) DO NOTHING;

-- Congela le omissioni già maturate prima di preparare il nuovo periodo. Dopo
-- la scadenza la RPC delle X rifiuta ogni modifica: il periodo resta storico.
CREATE OR REPLACE FUNCTION public.aggiorna_pulizie_non_fatte()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_aggiornate INTEGER;
    v_oggi_italiano DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
        SELECT 1
          FROM public.profili
         WHERE id = (SELECT auth.uid())
           AND accesso
    ) THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;

    UPDATE public.pulizie_registro
       SET non_fatta_il = COALESCE(
           non_fatta_il,
           ((periodo_fine + 1)::TIMESTAMP AT TIME ZONE 'Europe/Rome')
       )
     WHERE periodo_fine < v_oggi_italiano
       AND (
           completata_il IS NULL
           OR completata_il >= ((periodo_fine + 1)::TIMESTAMP AT TIME ZONE 'Europe/Rome')
       )
       AND non_fatta_il IS NULL;

    GET DIAGNOSTICS v_aggiornate = ROW_COUNT;
    RETURN v_aggiornate;
END;
$$;

-- Prepara le checklist richieste senza duplicarle. La settimana deve arrivare
-- come lunedì e il mese come primo giorno: l'app usa esattamente queste chiavi.
CREATE OR REPLACE FUNCTION public.prepara_pulizie(p_settimana DATE, p_mese DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_oggi_italiano DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_richiesta_consentita BOOLEAN;
    v_settimana_corrente DATE;
    v_mese_corrente DATE;
    v_fine_settimana DATE := p_settimana + 6;
    v_fine_mese DATE := (p_mese + INTERVAL '1 month - 1 day')::DATE;
    v_gruppo_uno_prima BOOLEAN := MOD(
        (EXTRACT(YEAR FROM p_mese)::INTEGER * 12 + EXTRACT(MONTH FROM p_mese)::INTEGER)
        - (2026 * 12 + 8),
        2
    ) = 0;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM public.profili
         WHERE id = (SELECT auth.uid())
           AND accesso
    ) INTO v_richiesta_consentita;

    IF NOT v_richiesta_consentita THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;

    v_settimana_corrente := v_oggi_italiano - (EXTRACT(ISODOW FROM v_oggi_italiano)::INTEGER - 1);
    v_mese_corrente := DATE_TRUNC('month', v_oggi_italiano)::DATE;

    IF p_settimana IS NULL OR EXTRACT(ISODOW FROM p_settimana) <> 1 THEN
        RAISE EXCEPTION 'La settimana deve iniziare di lunedì' USING ERRCODE = '22023';
    END IF;

    IF p_mese IS NULL OR EXTRACT(DAY FROM p_mese) <> 1 THEN
        RAISE EXCEPTION 'Il mese deve iniziare il giorno 1' USING ERRCODE = '22023';
    END IF;

    -- Niente righe future o anteriori al registro; i periodi saltati possono
    -- però essere ricostruiti al primo accesso successivo.
    IF p_settimana BETWEEN (
        SELECT prima_settimana FROM public.pulizie_configurazione WHERE id
    ) AND v_settimana_corrente THEN
    INSERT INTO public.pulizie_registro (
        tipo, voce, ordine, periodo_inizio, periodo_fine, prevista_il, responsabili
    ) VALUES
        ('bagno', 'Lunedì', 1, p_settimana, v_fine_settimana, p_settimana, '["Maria Rosaria"]'::JSONB),
        ('bagno', 'Martedì', 2, p_settimana, v_fine_settimana, p_settimana + 1, '["Anita"]'::JSONB),
        ('bagno', 'Mercoledì', 3, p_settimana, v_fine_settimana, p_settimana + 2, '["Mery"]'::JSONB),
        ('bagno', 'Giovedì', 4, p_settimana, v_fine_settimana, p_settimana + 3, '["Cinzia"]'::JSONB),
        ('bagno', 'Venerdì', 5, p_settimana, v_fine_settimana, p_settimana + 4, '["Francesca Imparato"]'::JSONB)
    ON CONFLICT (tipo, voce, periodo_inizio) DO UPDATE
       SET periodo_fine = EXCLUDED.periodo_fine,
           prevista_il = EXCLUDED.prevista_il,
           responsabili = EXCLUDED.responsabili
     WHERE public.pulizie_registro.completata_il IS NULL
       AND public.pulizie_registro.non_fatta_il IS NULL;

    -- Per le settimanali il responsabile è il turno: si conserva anche la
    -- fotografia dei nomi presenti in quella fascia durante la settimana.
    WITH conteggi AS (
        SELECT COALESCE(
                   t.profilo_id::TEXT,
                   LOWER(BTRIM(t.persona))
               ) AS persona_chiave,
               COALESCE(NULLIF(BTRIM(MIN(p.nome)), ''), MIN(BTRIM(t.persona))) AS persona,
               COUNT(*) FILTER (WHERE t.turno = 'mattina') AS mattine,
               COUNT(*) FILTER (WHERE t.turno = 'pomeriggio') AS pomeriggi
          FROM public.turni_lavoro t
          LEFT JOIN public.profili p ON p.id = t.profilo_id
         WHERE t.data BETWEEN p_settimana AND v_fine_settimana
           AND t.turno IN ('mattina', 'pomeriggio')
           AND NOT COALESCE(t.annullato, false)
           AND BTRIM(t.persona) <> ''
         GROUP BY COALESCE(t.profilo_id::TEXT, LOWER(BTRIM(t.persona)))
    ), turnisti AS (
        -- Una copertura o un cambio di un solo giorno non deve assegnare le
        -- pulizie di entrambe le fasce alla stessa persona. Ogni dipendente
        -- appartiene alla fascia in cui compare piu' volte nella settimana;
        -- in parita' decide il turno del lunedi', poi la mattina come fallback
        -- stabile per i dati storici incompleti.
        SELECT fascia AS turno,
               TO_JSONB(ARRAY_AGG(persona ORDER BY persona)) AS nomi
          FROM (
              SELECT c.persona,
                     CASE
                         WHEN c.mattine > c.pomeriggi THEN 'mattina'
                         WHEN c.pomeriggi > c.mattine THEN 'pomeriggio'
                         ELSE COALESCE((
                             SELECT t.turno
                               FROM public.turni_lavoro t
                              WHERE t.data = p_settimana
                                AND t.turno IN ('mattina', 'pomeriggio')
                                AND NOT COALESCE(t.annullato, false)
                                AND COALESCE(t.profilo_id::TEXT, LOWER(BTRIM(t.persona))) = c.persona_chiave
                              ORDER BY CASE t.turno WHEN 'mattina' THEN 1 ELSE 2 END
                              LIMIT 1
                         ), 'mattina')
                     END AS fascia
                FROM conteggi c
          ) prevalenti
         GROUP BY fascia
    ), voci(tipo, voce, ordine, turno) AS (
        VALUES
            ('settimanale', 'Mensole', 1, 'mattina'),
            ('settimanale', 'Staffe', 2, 'mattina'),
            ('settimanale', 'Marmo (pulizia completa)', 3, 'mattina'),
            ('settimanale', 'Terminali', 4, 'mattina'),
            ('settimanale', 'Vetri (pulizia completa)', 5, 'mattina'),
            ('settimanale', 'Vetrine', 6, 'pomeriggio'),
            ('settimanale', 'Patatine', 7, 'pomeriggio'),
            ('settimanale', 'TV', 8, 'pomeriggio'),
            ('settimanale', 'Tavolo', 9, 'pomeriggio'),
            ('settimanale', 'Sedie', 10, 'pomeriggio')
    )
    INSERT INTO public.pulizie_registro (
        tipo, voce, ordine, periodo_inizio, periodo_fine, turno, responsabili
    )
    SELECT v.tipo,
           v.voce,
           v.ordine,
           p_settimana,
           v_fine_settimana,
           v.turno,
           COALESCE(t.nomi, '[]'::JSONB)
      FROM voci v
      LEFT JOIN turnisti t ON t.turno = v.turno
    ON CONFLICT (tipo, voce, periodo_inizio) DO UPDATE
       SET responsabili = EXCLUDED.responsabili
     -- Il periodo corrente segue i turni anche dopo una X: la X conserva chi
     -- l'ha messa, mentre i responsabili restano corretti se il turno cambia.
     -- Lo storico scaduto, invece, resta la fotografia congelata del periodo.
     WHERE public.pulizie_registro.non_fatta_il IS NULL
       AND public.pulizie_registro.periodo_fine >= v_oggi_italiano;
    END IF;

    IF p_mese BETWEEN (
        SELECT primo_mese FROM public.pulizie_configurazione WHERE id
    ) AND v_mese_corrente THEN
    WITH gruppi AS (
        SELECT 'gruppo-1'::TEXT AS gruppo,
               '["Mery", "Francesca Imparato", "Cinzia"]'::JSONB AS nomi
        UNION ALL
        SELECT 'gruppo-2', '["Anita", "Maria Rosaria"]'::JSONB
    ), voci(tipo, voce, ordine, elenco) AS (
        VALUES
            ('mensile', 'Deposito', 1, 1),
            ('mensile', 'Legno', 2, 1),
            ('mensile', 'Porta', 3, 1),
            ('mensile', 'Pedana', 4, 2),
            ('mensile', 'Sottobanco', 5, 2),
            ('mensile', 'Cassetti', 6, 2),
            ('mensile', 'Souvenir', 7, 2)
    )
    INSERT INTO public.pulizie_registro (
        tipo, voce, ordine, periodo_inizio, periodo_fine, gruppo, responsabili
    )
    SELECT v.tipo,
           v.voce,
           v.ordine,
           p_mese,
           v_fine_mese,
           CASE
               WHEN (v.elenco = 1) = v_gruppo_uno_prima THEN 'gruppo-1'
               ELSE 'gruppo-2'
           END,
           g.nomi
      FROM voci v
      JOIN gruppi g ON g.gruppo = CASE
          WHEN (v.elenco = 1) = v_gruppo_uno_prima THEN 'gruppo-1'
          ELSE 'gruppo-2'
      END
    ON CONFLICT (tipo, voce, periodo_inizio) DO UPDATE
       SET ordine = EXCLUDED.ordine,
           periodo_fine = EXCLUDED.periodo_fine,
           gruppo = EXCLUDED.gruppo,
           responsabili = EXCLUDED.responsabili
     WHERE public.pulizie_registro.completata_il IS NULL
       AND public.pulizie_registro.non_fatta_il IS NULL;
    END IF;

    PERFORM public.aggiorna_pulizie_non_fatte();
    RETURN NULL;
END;
$$;

-- La scadenza è inclusiva: una voce diventa "non fatta" soltanto dal giorno
-- successivo e da quel momento non può più essere modificata.
CREATE OR REPLACE VIEW public.pulizie_non_fatte
WITH (security_invoker = on) AS
SELECT
    id,
    tipo,
    voce,
    periodo_inizio,
    -- Il giorno assegnato resta separato: per ogni tipo la vera scadenza è la
    -- fine del periodo, cioè anche per il bagno la domenica della settimana.
    periodo_fine AS scadenza,
    prevista_il,
    turno,
    gruppo,
    responsabili,
    non_fatta_il,
    completata_il,
    completata_da_nome
FROM public.pulizie_registro
WHERE non_fatta_il IS NOT NULL;

-- Finché non vengono concessi i permessi alla fine dello schema, nessuna di
-- queste funzioni SECURITY DEFINER deve essere invocabile dall'esterno.
REVOKE ALL ON FUNCTION public.prepara_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggiorna_pulizie_non_fatte() FROM PUBLIC, anon, authenticated;


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
ALTER TABLE public.pulizie_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulizie_configurazione ENABLE ROW LEVEL SECURITY;
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

-- Policy e RPC delle pulizie vengono definite dopo profili e turni: su una
-- installazione vuota devono già esistere entrambi per poter controllare
-- accesso e fotografare le persone assegnate.

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

-- Permessi e preferenze molto circoscritti: non rendono amministratore chi li
-- riceve e non aprono dashboard, H24 o altre sezioni riservate.
ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS gestione_turni BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS correzione_importi_virgole BOOLEAN NOT NULL DEFAULT false;

-- Le deleghe sono gestite dall amministratore: rieseguire lo schema non le riassegna.

UPDATE public.profili
   SET correzione_importi_virgole = true
 WHERE id = 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID;

CREATE OR REPLACE FUNCTION public.crea_profilo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profili (
        id, email, nome, correzione_importi_virgole
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', ''),
        NEW.id = 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
    )
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

-- Il permesso del calendario è separato dall'amministrazione generale. La
-- funzione resta SECURITY INVOKER: legge soltanto il profilo del chiamante,
-- rispettando la sua policy RLS, e non aggira altri permessi.
CREATE OR REPLACE FUNCTION public.puo_gestire_turni()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profili
        WHERE id = (SELECT auth.uid())
          AND accesso
          AND (admin OR gestione_turni)
    );
$$;

REVOKE ALL ON FUNCTION public.puo_gestire_turni() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puo_gestire_turni() TO authenticated;

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

-- Metadati del calendario ricorrente. Sono dichiarati qui, prima delle
-- funzioni degli ammanchi che devono ignorare le righe annullate; la sezione 19
-- completa poi vincoli, indici, backfill e RPC.
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS profilo_id UUID REFERENCES public.profili(id) ON DELETE SET NULL;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato_il TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato_da UUID REFERENCES auth.users(id) ON DELETE SET NULL;

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
    TO authenticated
    USING ((SELECT public.puo_gestire_turni()))
    WITH CHECK ((SELECT public.puo_gestire_turni()));


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
    compenso_mensile NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (compenso_mensile >= 0),
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Un nome non puo' comparire due volte solo per una differenza di maiuscole.
CREATE UNIQUE INDEX IF NOT EXISTS uq_baristi_anticipi_nome
    ON public.baristi_anticipi (lower(nome));

-- Colonna compenso_mensile aggiunta in modo sicuro se la tabella esiste già da una versione precedente.
ALTER TABLE public.baristi_anticipi
    ADD COLUMN IF NOT EXISTS compenso_mensile NUMERIC(12,2) DEFAULT 0.00;

-- I tre nomi di partenza con le rispettive cifre base (Luigi: 1100, Paolo: 1000, Livio: 1000).
INSERT INTO public.baristi_anticipi (nome, ordine, compenso_mensile)
VALUES
    ('Luigi', 0, 1100.00),
    ('Paolo', 1, 1000.00),
    ('Livio', 2, 1000.00)
ON CONFLICT DO NOTHING;

-- Se i record esistono già ma con compenso a 0 o non valorizzato, assegna i valori base concordati senza toccare altri dati.
UPDATE public.baristi_anticipi SET compenso_mensile = 1100.00 WHERE lower(nome) = 'luigi' AND (compenso_mensile IS NULL OR compenso_mensile = 0);
UPDATE public.baristi_anticipi SET compenso_mensile = 1000.00 WHERE lower(nome) = 'paolo' AND (compenso_mensile IS NULL OR compenso_mensile = 0);
UPDATE public.baristi_anticipi SET compenso_mensile = 1000.00 WHERE lower(nome) = 'livio' AND (compenso_mensile IS NULL OR compenso_mensile = 0);

CREATE TABLE IF NOT EXISTS public.anticipi_baristi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Il riferimento aiuta le ricerche; il nome copiato conserva lo storico
    -- anche se in seguito il barista viene nascosto o rinominato.
    barista_id UUID REFERENCES public.baristi_anticipi(id) ON DELETE SET NULL,
    barista_nome TEXT NOT NULL,

    data DATE NOT NULL,
    importo NUMERIC(12,2) NOT NULL CHECK (importo > 0),
    -- Autore della registrazione (username admin). Per i riporti ereditati
    -- automaticamente dal mese precedente contiene 'riporto:YYYY-MM'
    -- (o 'riporto_modificato:YYYY-MM' in caso di modifica manuale dell'importo o nota).
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
    importo_calcolato NUMERIC(12,2) NOT NULL CHECK (importo_calcolato > 0),
    importo NUMERIC(12,2) NOT NULL CHECK (importo >= 0),
    assegnato BOOLEAN NOT NULL DEFAULT true,
    attivo BOOLEAN NOT NULL DEFAULT true,
    modificato_manualmente BOOLEAN NOT NULL DEFAULT false,
    nota_modifica TEXT NOT NULL DEFAULT '',
    modificato_da TEXT NOT NULL DEFAULT '',
    modificato_il TIMESTAMP WITH TIME ZONE,
    azzerato BOOLEAN NOT NULL DEFAULT false,
    azzerato_il TIMESTAMP WITH TIME ZONE,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Aggiornamento sicuro per chi ha gia' creato la prima versione della tabella.
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS importo_calcolato NUMERIC(12,2);
UPDATE public.debiti_turno
SET importo_calcolato = importo
WHERE importo_calcolato IS NULL;
ALTER TABLE public.debiti_turno
    ALTER COLUMN importo_calcolato SET NOT NULL;

ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS modificato_manualmente BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS nota_modifica TEXT NOT NULL DEFAULT '';
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS modificato_da TEXT NOT NULL DEFAULT '';
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS modificato_il TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS azzerato BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.debiti_turno
    ADD COLUMN IF NOT EXISTS azzerato_il TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.debiti_turno
    DROP CONSTRAINT IF EXISTS debiti_turno_importo_check;
ALTER TABLE public.debiti_turno
    ADD CONSTRAINT debiti_turno_importo_check CHECK (importo >= 0);

ALTER TABLE public.debiti_turno
    DROP CONSTRAINT IF EXISTS debiti_turno_importo_calcolato_check;
ALTER TABLE public.debiti_turno
    ADD CONSTRAINT debiti_turno_importo_calcolato_check CHECK (importo_calcolato > 0);

ALTER TABLE public.debiti_turno
    DROP CONSTRAINT IF EXISTS debiti_turno_azzeramento_coerente;
ALTER TABLE public.debiti_turno
    ADD CONSTRAINT debiti_turno_azzeramento_coerente CHECK (
        (NOT azzerato AND azzerato_il IS NULL)
        OR (azzerato AND azzerato_il IS NOT NULL AND importo = 0)
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
           AND NOT COALESCE(annullato, false)
           AND trim(persona) <> ''
          GROUP BY lower(trim(persona))
      ) persone;

    -- Nessun nome ancora assegnato: l'ammanco non si perde e si ricalcolera'
    -- automaticamente quando l'amministratore compilerà i turni di lavoro.
    IF v_quante = 0 THEN
        INSERT INTO public.debiti_turno (
            data, turno, persona, ammanco_totale, persone_nel_turno,
            importo_calcolato, importo, assegnato, attivo, aggiornato_il
        )
        VALUES (
            p_data, p_turno, 'Da assegnare',
            (v_ammanco_centesimi / 100.0)::NUMERIC(12,2), 0,
            (v_ammanco_centesimi / 100.0)::NUMERIC(12,2),
            (v_ammanco_centesimi / 100.0)::NUMERIC(12,2), false, true, now()
        )
        ON CONFLICT (data, turno, lower(persona)) DO UPDATE SET
            ammanco_totale = EXCLUDED.ammanco_totale,
            persone_nel_turno = 0,
            importo_calcolato = EXCLUDED.importo_calcolato,
            importo = CASE
                WHEN public.debiti_turno.modificato_manualmente OR public.debiti_turno.azzerato
                THEN public.debiti_turno.importo
                ELSE EXCLUDED.importo
            END,
            assegnato = false,
            attivo = NOT public.debiti_turno.azzerato,
            aggiornato_il = now();
        RETURN;
    END IF;

    INSERT INTO public.debiti_turno (
        data, turno, persona, ammanco_totale, persone_nel_turno,
        importo_calcolato, importo, assegnato, attivo, aggiornato_il
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
          AND NOT COALESCE(annullato, false)
          AND trim(persona) <> ''
        GROUP BY lower(trim(persona))
    ) persone
    ON CONFLICT (data, turno, lower(persona)) DO UPDATE SET
        ammanco_totale = EXCLUDED.ammanco_totale,
        persone_nel_turno = EXCLUDED.persone_nel_turno,
        importo_calcolato = EXCLUDED.importo_calcolato,
        importo = CASE
            WHEN public.debiti_turno.modificato_manualmente OR public.debiti_turno.azzerato
            THEN public.debiti_turno.importo
            ELSE EXCLUDED.importo
        END,
        assegnato = true,
        attivo = NOT public.debiti_turno.azzerato,
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
    AFTER INSERT OR DELETE OR UPDATE OF data, turno, persona, annullato
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

-- =========================================================================
-- 18. ACCESSO CONDIVISO E SCRITTURE FIRMATE DELLE PULIZIE
--
-- Tutto il personale approvato vede l'intero registro. Le tabelle non sono
-- pero' scrivibili direttamente: generazione, scadenze e X passano da funzioni
-- che controllano il profilo e firmano lato database identita' e orario.
-- =========================================================================
DROP POLICY IF EXISTS "Lettura pulizie" ON public.pulizie_registro;
DROP POLICY IF EXISTS "Creazione pulizie" ON public.pulizie_registro;
DROP POLICY IF EXISTS "Aggiornamento pulizie" ON public.pulizie_registro;

CREATE POLICY "Lettura pulizie" ON public.pulizie_registro
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.profili
             WHERE id = (SELECT auth.uid())
               AND accesso
        )
    );

CREATE OR REPLACE FUNCTION public.imposta_pulizia_completata(
    p_id UUID,
    p_completata BOOLEAN
)
RETURNS SETOF public.pulizie_registro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi_italiano DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_nome TEXT;
BEGIN
    IF p_id IS NULL OR p_completata IS NULL THEN
        RAISE EXCEPTION 'Parametri pulizia non validi' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
               NULLIF(BTRIM(nome), ''),
               NULLIF(BTRIM(email), ''),
               'Dipendente'
           )
      INTO v_nome
      FROM public.profili
     WHERE id = (SELECT auth.uid())
       AND accesso;

    IF (SELECT auth.uid()) IS NULL OR v_nome IS NULL THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.pulizie_registro
       SET completata_il = CASE WHEN p_completata THEN CURRENT_TIMESTAMP ELSE NULL END,
           completata_da = CASE WHEN p_completata THEN (SELECT auth.uid()) ELSE NULL END,
           completata_da_nome = CASE WHEN p_completata THEN v_nome ELSE '' END
     WHERE id = p_id
       -- Nessuna X, neppure rimossa, prima o dopo il periodo operativo.
       AND v_oggi_italiano BETWEEN periodo_inizio AND periodo_fine
       AND non_fatta_il IS NULL
    RETURNING public.pulizie_registro.*;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.pulizie_registro WHERE id = p_id) THEN
            RAISE EXCEPTION 'Il periodo di questa pulizia è concluso' USING ERRCODE = '22023';
        END IF;

        RAISE EXCEPTION 'Pulizia non trovata' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- Le due funzioni create insieme alla tabella vengono rese SECURITY DEFINER
-- soltanto ora che profili e turni esistono. Il corpo resta quello già
-- definito sopra; accesso e firma sono controllati dalle RPC pubbliche.
ALTER FUNCTION public.prepara_pulizie(DATE, DATE) SECURITY DEFINER;
ALTER FUNCTION public.aggiorna_pulizie_non_fatte() SECURITY DEFINER;

REVOKE ALL ON public.pulizie_registro FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pulizie_non_fatte FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pulizie_configurazione FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pulizie_registro TO authenticated;
GRANT SELECT ON public.pulizie_non_fatte TO authenticated;
GRANT SELECT ON public.profili TO authenticated;

REVOKE ALL ON FUNCTION public.prepara_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggiorna_pulizie_non_fatte() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_pulizia_completata(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepara_pulizie(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aggiorna_pulizie_non_fatte() TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_pulizia_completata(UUID, BOOLEAN) TO authenticated;

-- Privilegi Data API espliciti; le policy RLS continuano a decidere chi può
-- scrivere, quindi questo grant non allarga il permesso oltre admin/Marianna.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.turni_lavoro TO authenticated;


-- =========================================================================
-- 19. TURNI RICORRENTI, DIPENDENTI REGISTRATI E CAMBI FIRMATI
--
-- Dal 24 agosto 2026 il calendario nasce da due squadre che scambiano mattina
-- e pomeriggio ogni lunedi'. Il calendario resta materializzato nella tabella
-- storica turni_lavoro: il modello genera soltanto righe nuove e non cancella
-- ne' sovrascrive mai un cambio manuale. Le righe annullate restano auditabili
-- ma non sono visibili dall'app e impediscono al generatore di ricrearle.
-- =========================================================================

-- Metadati aggiunti in modo non distruttivo: le righe gia' presenti conservano
-- data, fascia, persona, nota e firma originali.
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS profilo_id UUID REFERENCES public.profili(id) ON DELETE SET NULL;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato_il TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.turni_lavoro
    ADD COLUMN IF NOT EXISTS annullato_da UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.turni_lavoro
    DROP CONSTRAINT IF EXISTS turni_lavoro_origine_check;
ALTER TABLE public.turni_lavoro
    ADD CONSTRAINT turni_lavoro_origine_check
    CHECK (origine IN ('legacy', 'automatico', 'manuale'));

ALTER TABLE public.turni_lavoro
    DROP CONSTRAINT IF EXISTS turni_lavoro_annullamento_coerente;
ALTER TABLE public.turni_lavoro
    ADD CONSTRAINT turni_lavoro_annullamento_coerente CHECK (
        (NOT annullato AND annullato_il IS NULL AND annullato_da IS NULL)
        OR (annullato AND annullato_il IS NOT NULL)
    );

-- Il vecchio vincolo includeva il nome e impediva di conservare una riga
-- annullata accanto alla sua sostituzione. Ora l'identita' e' il profilo e
-- l'unicita' vale soltanto fra le posizioni attive.
ALTER TABLE public.turni_lavoro
    DROP CONSTRAINT IF EXISTS turni_lavoro_data_turno_persona_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turni_lavoro_profilo_giorno_attivo
    ON public.turni_lavoro(data, profilo_id)
    WHERE profilo_id IS NOT NULL AND NOT annullato;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turni_lavoro_legacy_attivo
    ON public.turni_lavoro(data, turno, LOWER(BTRIM(persona)))
    WHERE profilo_id IS NULL AND NOT annullato;

CREATE INDEX IF NOT EXISTS idx_turni_lavoro_profilo_data
    ON public.turni_lavoro(profilo_id, data)
    WHERE NOT annullato;
CREATE INDEX IF NOT EXISTS idx_turni_lavoro_data_attivi
    ON public.turni_lavoro(data, turno)
    WHERE NOT annullato;

-- Collega gli alias del vecchio foglio ai profili senza cambiare il testo
-- storico mostrato nelle righe gia' esistenti.
UPDATE public.turni_lavoro
   SET profilo_id = CASE
       WHEN LOWER(BTRIM(persona)) IN ('anita', 'anita schettino')
           THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID
       WHEN LOWER(BTRIM(persona)) IN ('cinzia', 'cinzia salemi')
           THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID
       WHEN LOWER(BTRIM(persona)) IN ('imparato', 'francy', 'francesca imparato')
           THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
       WHEN LOWER(BTRIM(persona)) IN ('mery', 'marianna palermo')
           THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID
       WHEN LOWER(BTRIM(persona)) IN ('rosy', 'maria rosaria', 'mariarosaria chierchia')
           THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
       ELSE profilo_id
   END
 WHERE profilo_id IS NULL
   AND LOWER(BTRIM(persona)) IN (
       'anita', 'anita schettino',
       'cinzia', 'cinzia salemi',
       'imparato', 'francy', 'francesca imparato',
       'mery', 'marianna palermo',
       'rosy', 'maria rosaria', 'mariarosaria chierchia'
   );

-- Una nuova validita' non modifica la precedente: chi era in squadra in un
-- certo periodo resta ricostruibile. Il profilo e' l'unita' stabile.
CREATE TABLE IF NOT EXISTS public.turni_squadre (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profilo_id UUID NOT NULL REFERENCES public.profili(id) ON DELETE RESTRICT,
    squadra SMALLINT NOT NULL CHECK (squadra IN (1, 2)),
    ordine_squadra SMALLINT NOT NULL CHECK (ordine_squadra > 0),
    valida_dal DATE NOT NULL,
    valida_al DATE,
    creata_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    creata_da UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CHECK (valida_al IS NULL OR valida_al >= valida_dal),
    UNIQUE (profilo_id, valida_dal)
);

CREATE INDEX IF NOT EXISTS idx_turni_squadre_validita
    ON public.turni_squadre(profilo_id, valida_dal DESC, valida_al);

-- Una riga per mese preparato. Serve sia per idempotenza sia per sapere se il
-- job del 15 ha davvero completato il lavoro.
CREATE TABLE IF NOT EXISTS public.turni_generazioni (
    mese DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM mese) = 1),
    generata_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    generata_da UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    giorni_dal DATE NOT NULL,
    giorni_al DATE NOT NULL,
    righe_generate INTEGER NOT NULL DEFAULT 0 CHECK (righe_generate >= 0),
    CHECK (giorni_al >= giorni_dal)
);

-- Il seed e' idempotente. Se il file viene riapplicato, una configurazione gia'
-- resa stabile dall'utente non viene riportata ai valori iniziali.
INSERT INTO public.turni_squadre (
    profilo_id, squadra, ordine_squadra, valida_dal
) VALUES
    -- Configurazione valida fino al 30 settembre 2026.
    ('8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID, 1, 1, '2026-08-24'::DATE),
    ('f5196428-c7b3-4900-af4d-28571064adbb'::UUID, 1, 2, '2026-08-24'::DATE),
    ('bbdea927-f41d-4593-8fba-43067b9f300b'::UUID, 1, 3, '2026-08-24'::DATE),
    ('0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID, 2, 1, '2026-08-24'::DATE),
    ('9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID, 2, 2, '2026-08-24'::DATE)
ON CONFLICT DO NOTHING;

-- Dal 1 ottobre 2026 la squadra 1 e' Marianna, Francesca e Maria Rosaria;
-- la squadra 2 e' Anita e Cinzia. La prima settimana di ottobre parte con
-- la squadra 1 al mattino e la squadra 2 al pomeriggio; dal lunedi' 5 le
-- due fasce si scambiano come ogni lunedi'.
INSERT INTO public.turni_squadre (
    profilo_id, squadra, ordine_squadra, valida_dal
)
VALUES
    ('8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID, 1, 1, '2026-10-01'::DATE),
    ('f5196428-c7b3-4900-af4d-28571064adbb'::UUID, 1, 2, '2026-10-01'::DATE),
    ('9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID, 1, 3, '2026-10-01'::DATE),
    ('0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID, 2, 1, '2026-10-01'::DATE),
    ('bbdea927-f41d-4593-8fba-43067b9f300b'::UUID, 2, 2, '2026-10-01'::DATE)
ON CONFLICT DO NOTHING;

ALTER TABLE public.turni_squadre ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turni_generazioni ENABLE ROW LEVEL SECURITY;

-- Le tabelle di configurazione non sono un'API diretta. Tutte le letture e le
-- scritture esterne passano dalle RPC sottostanti.
REVOKE ALL ON public.turni_squadre FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.turni_generazioni FROM PUBLIC, anon, authenticated;

-- Funzione interna: nessuna dipendenza dalla policy RLS del chiamante.
CREATE OR REPLACE FUNCTION private.puo_gestire_turni(p_utente UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_utente IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.profili
         WHERE id = p_utente
           AND accesso
           AND (admin OR gestione_turni)
    );
$$;

REVOKE ALL ON FUNCTION private.puo_gestire_turni(UUID) FROM PUBLIC, anon, authenticated;

-- Il roster valido in un giorno: al massimo una riga per profilo, scelta dalla
-- validita' piu' recente che copre quel giorno.
CREATE OR REPLACE FUNCTION private.roster_turni_al(p_data DATE)
RETURNS TABLE (
    profilo_id UUID,
    nome TEXT,
    squadra SMALLINT,
    ordine_squadra SMALLINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT DISTINCT ON (s.profilo_id)
           s.profilo_id,
           COALESCE(NULLIF(BTRIM(p.nome), ''), NULLIF(BTRIM(p.email), ''), 'Dipendente'),
           s.squadra,
           s.ordine_squadra
      FROM public.turni_squadre s
      JOIN public.profili p ON p.id = s.profilo_id
     WHERE s.valida_dal <= p_data
       AND (s.valida_al IS NULL OR s.valida_al >= p_data)
       AND p.accesso
     ORDER BY s.profilo_id, s.valida_dal DESC;
$$;

REVOKE ALL ON FUNCTION private.roster_turni_al(DATE) FROM PUBLIC, anon, authenticated;

-- Inserisce una singola posizione automatica. Manuali e annullamenti espliciti
-- prevalgono; gli automatici possono essere riallineati o rigenerati.
CREATE OR REPLACE FUNCTION private.inserisci_turno_automatico(
    p_data DATE,
    p_turno TEXT,
    p_profilo_id UUID,
    p_persona TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_righe INTEGER := 0;
    v_id UUID;
BEGIN
    IF p_turno NOT IN ('mattina', 'pomeriggio', 'festa') THEN
        RAISE EXCEPTION 'Fascia automatica non valida' USING ERRCODE = '22023';
    END IF;

    -- Un annullamento esplicito fatto da un gestore e una riga manuale sono
    -- tombstone: il generatore li rispetta. Un automatico attivo puo' invece
    -- essere riallineato se cambia il roster ricorrente.
    IF EXISTS (
        SELECT 1
          FROM public.turni_lavoro
         WHERE data = p_data
           AND profilo_id = p_profilo_id
           AND (
               origine = 'manuale'
               OR annullato_da IS NOT NULL
           )
    ) THEN
        RETURN 0;
    END IF;

    SELECT id
      INTO v_id
      FROM public.turni_lavoro
     WHERE data = p_data
       AND profilo_id = p_profilo_id
       AND NOT annullato
       AND origine = 'automatico'
     ORDER BY aggiornato_il DESC, creato_il DESC
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE public.turni_lavoro
           SET turno = p_turno,
               persona = p_persona,
               nota = '',
               creato_da = 'Generazione automatica',
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE id = v_id
           AND (turno IS DISTINCT FROM p_turno
                OR persona IS DISTINCT FROM p_persona
                OR nota IS DISTINCT FROM '');

        GET DIAGNOSTICS v_righe = ROW_COUNT;
        RETURN v_righe;
    END IF;

    SELECT id
      INTO v_id
      FROM public.turni_lavoro
     WHERE data = p_data
       AND profilo_id = p_profilo_id
       AND origine = 'automatico'
       AND annullato
       AND annullato_da IS NULL
     ORDER BY aggiornato_il DESC, creato_il DESC
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE public.turni_lavoro
           SET turno = p_turno,
               persona = p_persona,
               nota = '',
               creato_da = 'Generazione automatica',
               annullato = false,
               annullato_il = NULL,
               annullato_da = NULL,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE id = v_id;

        RETURN 1;
    END IF;

    INSERT INTO public.turni_lavoro (
        data, turno, profilo_id, persona, nota, creato_da,
        origine, annullato, aggiornato_il
    ) VALUES (
        p_data, p_turno, p_profilo_id, p_persona, '', 'Generazione automatica',
        'automatico', false, CURRENT_TIMESTAMP
    );

    GET DIAGNOSTICS v_righe = ROW_COUNT;
    RETURN v_righe;
END;
$$;

REVOKE ALL ON FUNCTION private.inserisci_turno_automatico(DATE, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;

-- Motore del calendario. La settimana 24-30 agosto ha squadra 1 al pomeriggio
-- e squadra 2 al mattino; ogni lunedi' le fasce si scambiano. Dal 1 ottobre
-- i giorni di festa continuano dal riferimento della settimana precedente.
-- Se Anita o Cinzia sono in festa, una componente della squadra da tre copre
-- la loro fascia per tutta la settimana: Marianna, Francesca e Maria Rosaria
-- si alternano una settimana ciascuna.
CREATE OR REPLACE FUNCTION private.genera_turni_periodo(
    p_dal DATE,
    p_al DATE,
    p_generata_da UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_data DATE;
    v_lunedi DATE;
    v_settimane INTEGER;
    v_turno_squadra_1 TEXT;
    v_turno_squadra_2 TEXT;
    v_festa UUID;
    v_copertura UUID;
    v_ordine_copertura SMALLINT;
    v_r RECORD;
    v_turno TEXT;
    v_totale INTEGER := 0;
BEGIN
    IF p_dal IS NULL OR p_al IS NULL OR p_al < p_dal THEN
        RAISE EXCEPTION 'Periodo turni non valido' USING ERRCODE = '22023';
    END IF;

    -- Serializza generatori concorrenti e chiamate client/cron simultanee.
    PERFORM pg_advisory_xact_lock(20260824, 1901);

    FOR v_data IN
        SELECT giorno::DATE
          FROM generate_series(p_dal::TIMESTAMP, p_al::TIMESTAMP, INTERVAL '1 day') AS giorno
    LOOP
        IF v_data < '2026-08-24'::DATE THEN
            CONTINUE;
        END IF;

        v_lunedi := v_data - (EXTRACT(ISODOW FROM v_data)::INTEGER - 1);
        v_settimane := ((v_lunedi - '2026-08-24'::DATE) / 7)::INTEGER;

        IF MOD(v_settimane, 2) = 0 THEN
            v_turno_squadra_1 := 'pomeriggio';
            v_turno_squadra_2 := 'mattina';
        ELSE
            v_turno_squadra_1 := 'mattina';
            v_turno_squadra_2 := 'pomeriggio';
        END IF;

        v_festa := CASE
            -- Da ottobre si continua il riferimento della settimana 28
            -- settembre-4 ottobre: quando la squadra 1 e' al mattino Cinzia
            -- fa festa il martedi' e Maria Rosaria il venerdi'; nella
            -- settimana invertita si scambiano quei due giorni.
            WHEN v_data >= '2026-10-01'::DATE THEN
                CASE EXTRACT(ISODOW FROM v_data)::INTEGER
                    WHEN 1 THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID -- Marianna
                    WHEN 2 THEN CASE
                        WHEN v_turno_squadra_1 = 'pomeriggio'
                            THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID -- Maria Rosaria
                        ELSE 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID     -- Cinzia
                    END
                    WHEN 3 THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID -- Francesca
                    WHEN 4 THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID -- Anita
                    WHEN 5 THEN CASE
                        WHEN v_turno_squadra_1 = 'pomeriggio'
                            THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID -- Cinzia
                        ELSE '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID     -- Maria Rosaria
                    END
                    ELSE NULL
                END
            ELSE CASE EXTRACT(ISODOW FROM v_data)::INTEGER
                WHEN 1 THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID -- Marianna
                WHEN 2 THEN CASE
                    WHEN v_turno_squadra_1 = 'pomeriggio'
                        THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID -- Francesca
                    ELSE '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID     -- Maria Rosaria
                END
                WHEN 3 THEN CASE
                    WHEN v_turno_squadra_1 = 'mattina'
                        THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID -- Francesca
                    ELSE '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID     -- Maria Rosaria
                END
                WHEN 4 THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID -- Anita
                WHEN 5 THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID -- Cinzia
                ELSE NULL
            END
        END;

        -- Se la festa cade nella squadra 2, una persona della squadra 1 copre
        -- l'altra fascia. Da ottobre la stessa persona copre tutta la settimana;
        -- la settimana parziale del 1 ottobre continua con Maria Rosaria, poi
        -- dal 5 ottobre partono Marianna, Francesca e Maria Rosaria a rotazione.
        v_copertura := NULL;
        v_ordine_copertura := CASE
            WHEN v_lunedi < '2026-10-05'::DATE THEN 3
            ELSE (MOD(((v_lunedi - '2026-10-05'::DATE) / 7)::INTEGER, 3) + 1)::SMALLINT
        END;
        IF v_festa IS NOT NULL AND EXISTS (
            SELECT 1
              FROM private.roster_turni_al(v_data) r
             WHERE r.profilo_id = v_festa
               AND r.squadra = 2
        ) AND (
            SELECT COUNT(*)
              FROM private.roster_turni_al(v_data) r
             WHERE r.squadra = 2
               AND r.profilo_id <> v_festa
        ) < 2 THEN
            IF v_data >= '2026-10-01'::DATE THEN
                SELECT r.profilo_id
                  INTO v_copertura
                  FROM private.roster_turni_al(v_data) r
                 WHERE r.squadra = 1
                   AND r.profilo_id <> v_festa
                 ORDER BY CASE WHEN r.ordine_squadra = v_ordine_copertura THEN 0 ELSE 1 END,
                          r.ordine_squadra
                 LIMIT 1;
            ELSE
                SELECT r.profilo_id
                  INTO v_copertura
                  FROM private.roster_turni_al(v_data) r
                 WHERE r.squadra = 1
                   AND r.profilo_id <> v_festa
                 ORDER BY MOD(
                              (v_data - '2026-08-24'::DATE)::INTEGER + r.ordine_squadra - 1,
                              GREATEST((SELECT COUNT(*) FROM private.roster_turni_al(v_data) q WHERE q.squadra = 1), 1)
                          ),
                          r.ordine_squadra
                 LIMIT 1;
            END IF;
        END IF;

        FOR v_r IN SELECT * FROM private.roster_turni_al(v_data)
        LOOP
            IF v_r.profilo_id = v_festa THEN
                v_turno := 'festa';
            ELSIF v_r.profilo_id = v_copertura THEN
                v_turno := v_turno_squadra_2;
            ELSIF v_r.squadra = 1 THEN
                v_turno := v_turno_squadra_1;
            ELSE
                v_turno := v_turno_squadra_2;
            END IF;

            v_totale := v_totale + private.inserisci_turno_automatico(
                v_data, v_turno, v_r.profilo_id, v_r.nome
            );
        END LOOP;
    END LOOP;

    RETURN v_totale;
END;
$$;

REVOKE ALL ON FUNCTION private.genera_turni_periodo(DATE, DATE, UUID)
    FROM PUBLIC, anon, authenticated;

-- La variante interna del cron non ha una sessione Auth, ma non accetta alcun
-- parametro esterno e puo' soltanto invocare lo stesso generatore deterministico.
CREATE OR REPLACE FUNCTION private.genera_turni_cron(p_oggi DATE DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := COALESCE(p_oggi, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE);
    v_corrente DATE;
    v_dal_corrente DATE;
    v_al_corrente DATE;
    v_mese DATE;
    v_al DATE;
    v_righe INTEGER := 0;
    v_aggiunte INTEGER := 0;
BEGIN
    -- Garantisce anzitutto il mese corrente. Per agosto 2026 il modello parte
    -- il 24; per i mesi successivi parte dal primo giorno.
    v_corrente := DATE_TRUNC('month', v_oggi)::DATE;
    IF (v_corrente + INTERVAL '1 month - 1 day')::DATE >= '2026-08-24'::DATE THEN
        v_dal_corrente := GREATEST(v_corrente, '2026-08-24'::DATE);
        v_al_corrente := (v_corrente + INTERVAL '1 month - 1 day')::DATE;
        v_aggiunte := private.genera_turni_periodo(v_dal_corrente, v_al_corrente, NULL);
        v_righe := v_righe + v_aggiunte;

        INSERT INTO public.turni_generazioni (
            mese, generata_da, giorni_dal, giorni_al, righe_generate
        ) VALUES (v_corrente, NULL, v_dal_corrente, v_al_corrente, v_aggiunte)
        ON CONFLICT (mese) DO UPDATE
           SET generata_il = CURRENT_TIMESTAMP,
               righe_generate = public.turni_generazioni.righe_generate + EXCLUDED.righe_generate;
    END IF;

    IF EXTRACT(DAY FROM v_oggi)::INTEGER < 15 THEN
        RETURN v_righe;
    END IF;

    v_mese := (DATE_TRUNC('month', v_oggi) + INTERVAL '1 month')::DATE;
    v_al := (v_mese + INTERVAL '1 month - 1 day')::DATE;
    v_aggiunte := private.genera_turni_periodo(v_mese, v_al, NULL);
    v_righe := v_righe + v_aggiunte;

    INSERT INTO public.turni_generazioni (
        mese, generata_da, giorni_dal, giorni_al, righe_generate
    ) VALUES (v_mese, NULL, v_mese, v_al, v_aggiunte)
    ON CONFLICT (mese) DO UPDATE
       SET generata_il = CURRENT_TIMESTAMP,
           righe_generate = public.turni_generazioni.righe_generate + EXCLUDED.righe_generate;

    RETURN v_righe;
END;
$$;

REVOKE ALL ON FUNCTION private.genera_turni_cron(DATE) FROM PUBLIC, anon, authenticated;

-- RPC idempotente richiamabile dal client. Garantisce il tratto operativo del
-- mese corrente e, dal giorno 15 italiano, prepara anche il mese seguente.
CREATE OR REPLACE FUNCTION public.genera_turni_automatici()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    RETURN private.genera_turni_cron(NULL);
END;
$$;

-- Elenco minimale per il selettore: niente email, flag amministrativi o altri
-- dati del profilo. Maria, Francesca, Cinzia, Anita e Maria Rosaria soltanto.
CREATE OR REPLACE FUNCTION public.elenca_dipendenti_turni()
RETURNS TABLE (
    id UUID,
    nome TEXT,
    squadra SMALLINT,
    ordine_squadra SMALLINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH roster AS (
        -- Mostra subito anche un'appartenenza che iniziera' in una settimana
        -- futura: dopo la conferma "Aggiungi alla squadra" il picker deve
        -- ricordarla senza aspettare che arrivi quella data.
        SELECT DISTINCT ON (s.profilo_id)
               s.profilo_id,
               s.squadra,
               s.ordine_squadra
          FROM public.turni_squadre s
         WHERE s.valida_al IS NULL
         ORDER BY s.profilo_id, s.valida_dal DESC
    )
    SELECT p.id,
           COALESCE(NULLIF(BTRIM(p.nome), ''), NULLIF(BTRIM(p.email), ''), 'Dipendente'),
           r.squadra,
           r.ordine_squadra
      FROM public.profili p
      LEFT JOIN roster r ON r.profilo_id = p.id
     WHERE p.accesso
       AND p.id <> 'bb9b9cb8-be6e-470c-b70f-cd844436b39c'::UUID
     ORDER BY r.squadra NULLS LAST, r.ordine_squadra NULLS LAST, p.nome;
END;
$$;

-- Modifica una posizione del calendario. `p_rendi_stabile` non rende ricorrente
-- il singolo giorno: inserisce una persona nuova nella squadra della fascia e
-- rigenera solo automatici futuri. Le righe manuali, le ferie e gli
-- annullamenti espliciti restano intatti.
CREATE OR REPLACE FUNCTION public.imposta_turno_dipendente(
    p_data DATE,
    p_turno TEXT,
    p_profilo_id UUID,
    p_nota TEXT DEFAULT '',
    p_rendi_stabile BOOLEAN DEFAULT false
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_nome_autore TEXT;
    v_nome TEXT;
    v_squadra_attuale SMALLINT;
    v_ordine_attuale SMALLINT;
    v_nuova_squadra SMALLINT;
    v_nuovo_ordine SMALLINT;
    v_fine_generata DATE;
    v_riga public.turni_lavoro%ROWTYPE;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    IF p_data IS NULL OR p_turno NOT IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
       OR p_profilo_id IS NULL THEN
        RAISE EXCEPTION 'Parametri turno non validi' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(20260824, 1901);

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Gestore')
      INTO v_nome_autore
      FROM public.profili
     WHERE id = v_utente;

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Dipendente')
      INTO v_nome
      FROM public.profili
     WHERE id = p_profilo_id
       AND accesso
       AND id <> 'bb9b9cb8-be6e-470c-b70f-cd844436b39c'::UUID;

    IF v_nome IS NULL THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;

    SELECT r.squadra, r.ordine_squadra
      INTO v_squadra_attuale, v_ordine_attuale
      FROM private.roster_turni_al(GREATEST(p_data, '2026-08-24'::DATE)) r
     WHERE r.profilo_id = p_profilo_id;

    IF p_rendi_stabile THEN
        IF p_turno NOT IN ('mattina', 'pomeriggio') THEN
            RAISE EXCEPTION 'Una squadra stabile puo essere mattina o pomeriggio' USING ERRCODE = '22023';
        END IF;

        IF p_data < '2026-08-24'::DATE THEN
            RAISE EXCEPTION 'La ricorrenza stabile parte dal 24 agosto 2026' USING ERRCODE = '22023';
        END IF;

        -- Nella settimana della data richiesta si ricava quale squadra occupa
        -- la fascia scelta. Si aggiunge/sposta soltanto la persona selezionata:
        -- gli altri componenti delle due squadre non cambiano.
        IF MOD((((p_data - (EXTRACT(ISODOW FROM p_data)::INTEGER - 1)) - '2026-08-24'::DATE) / 7)::INTEGER, 2) = 0 THEN
            v_nuova_squadra := CASE WHEN p_turno = 'pomeriggio' THEN 1 ELSE 2 END;
        ELSE
            v_nuova_squadra := CASE WHEN p_turno = 'mattina' THEN 1 ELSE 2 END;
        END IF;

        -- Le persone gia' nel ciclo fanno i cambi una tantum senza smontare le
        -- due squadre base. "Rendi stabile" serve a inserire una persona nuova;
        -- se e' gia' nella squadra della fascia richiesta, e' gia' stabile.
        IF v_squadra_attuale IS NOT NULL AND v_squadra_attuale <> v_nuova_squadra THEN
            RAISE EXCEPTION 'Dipendente gia in una squadra: usa il cambio per questa data' USING ERRCODE = '22023';
        END IF;

        IF v_squadra_attuale IS NULL THEN
            UPDATE public.turni_squadre
               SET valida_al = p_data - 1
             WHERE profilo_id = p_profilo_id
               AND valida_dal < p_data
               AND (valida_al IS NULL OR valida_al >= p_data);

            SELECT (COALESCE(MAX(r.ordine_squadra), 0) + 1)::SMALLINT
              INTO v_nuovo_ordine
              FROM private.roster_turni_al(p_data) r
             WHERE r.squadra = v_nuova_squadra;

            INSERT INTO public.turni_squadre (
                profilo_id, squadra, ordine_squadra, valida_dal, creata_da
            ) VALUES (
                p_profilo_id, v_nuova_squadra, v_nuovo_ordine, p_data, v_utente
            )
            ON CONFLICT (profilo_id, valida_dal) DO UPDATE
               SET squadra = EXCLUDED.squadra,
                   ordine_squadra = EXCLUDED.ordine_squadra,
                   valida_al = NULL,
                   creata_da = EXCLUDED.creata_da;
        END IF;

        SELECT COALESCE(MAX(giorni_al), p_data)
          INTO v_fine_generata
          FROM public.turni_generazioni;

        -- Gli automatici futuri sono un prodotto rigenerabile, non storico
        -- umano. Si annullano tecnicamente invece di cancellarli; manuali, ferie
        -- e annullamenti espliciti non si toccano.
        UPDATE public.turni_lavoro
           SET annullato = true,
               annullato_il = CURRENT_TIMESTAMP,
               annullato_da = NULL,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE data >= p_data
           AND data <= GREATEST(p_data, v_fine_generata)
           AND origine = 'automatico'
           AND NOT annullato;

        PERFORM private.genera_turni_periodo(p_data, GREATEST(p_data, v_fine_generata), v_utente);
    END IF;

    -- Qualunque vecchia posizione della persona nel giorno diventa storico.
    UPDATE public.turni_lavoro
       SET annullato = true,
           annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE data = p_data
       AND profilo_id = p_profilo_id
       AND NOT annullato;

    INSERT INTO public.turni_lavoro (
        data, turno, profilo_id, persona, nota, creato_da,
        origine, annullato, aggiornato_il
    ) VALUES (
        p_data, p_turno, p_profilo_id, v_nome, COALESCE(p_nota, ''), v_nome_autore,
        'manuale', false, CURRENT_TIMESTAMP
    )
    RETURNING * INTO v_riga;

    RETURN NEXT v_riga;
END;
$$;

CREATE OR REPLACE FUNCTION public.annulla_turno_lavoro(p_id UUID)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'Turno non valido' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(20260824, 1901);

    RETURN QUERY
    UPDATE public.turni_lavoro
       SET annullato = true,
           annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE id = p_id
       AND NOT annullato
    RETURNING public.turni_lavoro.*;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno non trovato o gia annullato' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- Accesso al calendario: tutti gli account approvati leggono soltanto righe
-- attive; nessuno scrive direttamente. I gestori usano RPC firmate.
DROP POLICY IF EXISTS "Lettura turni" ON public.turni_lavoro;
CREATE POLICY "Lettura turni" ON public.turni_lavoro
    FOR SELECT
    TO authenticated
    USING (
        NOT annullato
        AND EXISTS (
            SELECT 1
              FROM public.profili
             WHERE id = (SELECT auth.uid())
               AND accesso
        )
    );

DROP POLICY IF EXISTS "Scrittura turni" ON public.turni_lavoro;

REVOKE ALL ON public.turni_lavoro FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.turni_lavoro TO authenticated;

REVOKE ALL ON FUNCTION public.genera_turni_automatici() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_dipendenti_turni() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.annulla_turno_lavoro(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.genera_turni_automatici() TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_dipendenti_turni() TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.annulla_turno_lavoro(UUID) TO authenticated;

DO $$
BEGIN
    -- Installa e pianifica il controllo giornaliero senza fissare una versione.
    -- Tutto vive nel blocco protetto: se il piano non abilita Cron, lo schema e
    -- la generazione via client restano comunque utilizzabili.
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'genera-turni-mese-successivo',
            '15 2 * * *',
            'SELECT private.genera_turni_cron();'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        -- In progetti in cui Cron non e' abilitabile dal ruolo SQL, il client
        -- conserva comunque la generazione idempotente tramite RPC.
        RAISE NOTICE 'Cron turni non configurato: %', SQLERRM;
END;
$$;

-- =========================================================================
-- 19B. SCHEDE RICORRENTI ADMIN E SPOSTAMENTO FESTA OCCASIONALE
-- =========================================================================

-- Schede ricorrenti dei dipendenti. Migrazione incrementale, senza riscrivere
-- il calendario esistente: le nuove impostazioni hanno effetto solo al salvataggio.

CREATE TABLE IF NOT EXISTS public.turni_schede (
    revisione BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profilo_id UUID NOT NULL REFERENCES public.profili(id) ON DELETE RESTRICT,
    valida_dal DATE NOT NULL,
    squadra SMALLINT CHECK (squadra IN (1, 2)),
    ordine_squadra SMALLINT NOT NULL CHECK (ordine_squadra > 0),
    festa_mode TEXT NOT NULL CHECK (festa_mode IN ('legacy', 'personalizzato')),
    festa_mattina SMALLINT CHECK (festa_mattina BETWEEN 1 AND 7),
    festa_pomeriggio SMALLINT CHECK (festa_pomeriggio BETWEEN 1 AND 7),
    creata_il TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    creata_da UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    CHECK (isfinite(valida_dal)),
    CHECK (festa_mode = 'personalizzato' OR (festa_mattina IS NULL AND festa_pomeriggio IS NULL))
);

-- Append-only: due salvataggi della stessa decorrenza restano entrambi nello
-- storico. La revisione piu' recente prevale; le decorrenze successive restano.
CREATE INDEX IF NOT EXISTS idx_turni_schede_profilo_decorrenza
    ON public.turni_schede(profilo_id, valida_dal DESC, revisione DESC);
CREATE INDEX IF NOT EXISTS idx_turni_schede_autore ON public.turni_schede(creata_da);
ALTER TABLE public.turni_schede ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.turni_schede FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.turni_schede_revisione_seq FROM PUBLIC, anon, authenticated;

-- Le due fasce sono quelle abituali della squadra, prima di eventuali coperture.
-- Si conserva esattamente la rotazione storica, compreso il cambio di ottobre.
CREATE OR REPLACE FUNCTION private.giorno_festa_legacy_turni(
    p_profilo_id UUID, p_turno TEXT, p_data DATE
)
RETURNS SMALLINT
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT (CASE p_profilo_id
        WHEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID THEN 1
        WHEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID THEN 4
        WHEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID THEN
            CASE WHEN p_data < DATE '2026-10-01' OR p_turno = 'mattina' THEN 5 ELSE 2 END
        WHEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID THEN
            CASE WHEN p_data >= DATE '2026-10-01' OR p_turno = 'mattina' THEN 3 ELSE 2 END
        WHEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID THEN
            CASE WHEN p_turno = 'pomeriggio' THEN 2
                 WHEN p_data >= DATE '2026-10-01' THEN 5 ELSE 3 END
        ELSE NULL
    END)::SMALLINT;
$$;
REVOKE ALL ON FUNCTION private.giorno_festa_legacy_turni(UUID, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.roster_turni_al(p_data DATE)
RETURNS TABLE (profilo_id UUID, nome TEXT, squadra SMALLINT, ordine_squadra SMALLINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id,
           COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente'),
           CASE WHEN c.revisione IS NOT NULL THEN c.squadra ELSE s.squadra END,
           COALESCE(c.ordine_squadra, s.ordine_squadra)
      FROM public.profili p
      LEFT JOIN LATERAL (
          SELECT t.squadra, t.ordine_squadra
            FROM public.turni_squadre t
           WHERE t.profilo_id = p.id AND t.valida_dal <= p_data
             AND (t.valida_al IS NULL OR t.valida_al >= p_data)
           ORDER BY t.valida_dal DESC LIMIT 1
      ) s ON true
      LEFT JOIN LATERAL (
          SELECT t.revisione, t.squadra, t.ordine_squadra
            FROM public.turni_schede t
           WHERE t.profilo_id = p.id AND t.valida_dal <= p_data
           ORDER BY t.valida_dal DESC, t.revisione DESC LIMIT 1
      ) c ON true
     WHERE p.accesso AND NOT p.admin
       AND (CASE WHEN c.revisione IS NOT NULL THEN c.squadra ELSE s.squadra END) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.roster_turni_al(DATE) FROM PUBLIC, anon, authenticated;

-- Una previsione pura, condivisa dal generatore e dal ripristino della festa.
-- p_ignora_festa serve solo al ripristino di un giorno spostato: non cambia schede.
CREATE OR REPLACE FUNCTION private.programma_turni_giorno(
    p_data DATE, p_ignora_festa UUID DEFAULT NULL
)
RETURNS TABLE (profilo_id UUID, nome TEXT, turno TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_lunedi DATE := p_data - (EXTRACT(ISODOW FROM p_data)::INTEGER - 1);
    v_squadra1 TEXT;
    v_squadra2 TEXT;
    v_feste UUID[];
    v_copertura UUID;
    v_ordine SMALLINT;
BEGIN
    IF p_data < DATE '2026-08-24' THEN RETURN; END IF;
    v_squadra1 := CASE WHEN MOD(((v_lunedi - DATE '2026-08-24') / 7)::INTEGER, 2) = 0
                      THEN 'pomeriggio' ELSE 'mattina' END;
    v_squadra2 := CASE WHEN v_squadra1 = 'mattina' THEN 'pomeriggio' ELSE 'mattina' END;

    SELECT COALESCE(array_agg(r.profilo_id), ARRAY[]::UUID[])
      INTO v_feste
      FROM private.roster_turni_al(p_data) r
      LEFT JOIN LATERAL (
          SELECT s.festa_mode, s.festa_mattina, s.festa_pomeriggio
            FROM public.turni_schede s
           WHERE s.profilo_id = r.profilo_id AND s.valida_dal <= p_data
           ORDER BY s.valida_dal DESC, s.revisione DESC LIMIT 1
      ) c ON true
     WHERE r.profilo_id IS DISTINCT FROM p_ignora_festa
       AND EXTRACT(ISODOW FROM p_data)::INTEGER = CASE
           WHEN c.festa_mode = 'personalizzato' THEN
               CASE WHEN (CASE WHEN r.squadra = 1 THEN v_squadra1 ELSE v_squadra2 END) = 'mattina'
                    THEN c.festa_mattina ELSE c.festa_pomeriggio END
           ELSE private.giorno_festa_legacy_turni(r.profilo_id,
               CASE WHEN r.squadra = 1 THEN v_squadra1 ELSE v_squadra2 END, p_data)
       END;

    -- La regola di copertura storica rimane: una componente della squadra 1
    -- aiuta la 2 quando una festa la lascia sotto due presenti. Chi e' in festa
    -- non puo' essere scelto per coprire, anche con piu' feste nello stesso giorno.
    IF EXISTS (SELECT 1 FROM private.roster_turni_al(p_data) r
               WHERE r.squadra = 2 AND r.profilo_id = ANY(v_feste))
       AND (SELECT COUNT(*) FROM private.roster_turni_al(p_data) r
            WHERE r.squadra = 2 AND NOT r.profilo_id = ANY(v_feste)) < 2 THEN
        v_ordine := CASE WHEN v_lunedi < DATE '2026-10-05' THEN 3
                        ELSE (MOD(((v_lunedi - DATE '2026-10-05') / 7)::INTEGER, 3) + 1)::SMALLINT END;
        SELECT r.profilo_id INTO v_copertura
          FROM private.roster_turni_al(p_data) r
         WHERE r.squadra = 1 AND NOT r.profilo_id = ANY(v_feste)
         ORDER BY CASE WHEN p_data >= DATE '2026-10-01'
                       THEN CASE WHEN r.ordine_squadra = v_ordine THEN 0 ELSE 1 END
                       ELSE MOD((p_data - DATE '2026-08-24')::INTEGER + r.ordine_squadra - 1,
                           GREATEST((SELECT COUNT(*)::INTEGER FROM private.roster_turni_al(p_data) q WHERE q.squadra = 1), 1))
                  END, r.ordine_squadra, r.profilo_id
         LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT r.profilo_id, r.nome,
           CASE WHEN r.profilo_id = ANY(v_feste) THEN 'festa'
                WHEN r.profilo_id = v_copertura THEN v_squadra2
                WHEN r.squadra = 1 THEN v_squadra1 ELSE v_squadra2 END
      FROM private.roster_turni_al(p_data) r;
END;
$$;
REVOKE ALL ON FUNCTION private.programma_turni_giorno(DATE, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.genera_turni_periodo(
    p_dal DATE, p_al DATE, p_generata_da UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_data DATE;
    v_r RECORD;
    v_totale INTEGER := 0;
BEGIN
    IF p_dal IS NULL OR p_al IS NULL OR NOT isfinite(p_dal) OR NOT isfinite(p_al) OR p_al < p_dal THEN
        RAISE EXCEPTION 'Periodo turni non valido' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    FOR v_data IN SELECT giorno::DATE FROM generate_series(p_dal::TIMESTAMP, p_al::TIMESTAMP, INTERVAL '1 day') giorno
    LOOP
        FOR v_r IN SELECT * FROM private.programma_turni_giorno(v_data)
        LOOP
            -- Le righe legacy sono storico umano: non sostituirle e non tentare
            -- un inserimento che violerebbe l'unicita' della giornata.
            IF EXISTS (SELECT 1 FROM public.turni_lavoro t WHERE t.data = v_data
                       AND t.profilo_id = v_r.profilo_id AND t.origine = 'legacy' AND NOT t.annullato) THEN
                CONTINUE;
            END IF;
            v_totale := v_totale + private.inserisci_turno_automatico(v_data, v_r.turno, v_r.profilo_id, v_r.nome);
        END LOOP;
    END LOOP;
    IF to_regprocedure('private.sincronizza_pulizie_turni(date,date)') IS NOT NULL THEN
        PERFORM private.sincronizza_pulizie_turni(p_dal, p_al);
    END IF;
    RETURN v_totale;
END;
$$;
REVOKE ALL ON FUNCTION private.genera_turni_periodo(DATE, DATE, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.elenca_schede_turni(p_data DATE DEFAULT NULL)
RETURNS TABLE (
    id UUID, nome TEXT, squadra SMALLINT, festa_mode TEXT,
    festa_mattina SMALLINT, festa_pomeriggio SMALLINT,
    valida_dal DATE, configurata BOOLEAN, prossima_valida_dal DATE
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_data DATE := COALESCE(p_data, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE);
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere le schede turni' USING ERRCODE = '42501';
    END IF;
    IF NOT isfinite(v_data) THEN RAISE EXCEPTION 'Data non valida' USING ERRCODE = '22023'; END IF;
    RETURN QUERY
    SELECT p.id, COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente'),
           CASE WHEN c.revisione IS NOT NULL THEN c.squadra ELSE s.squadra END,
           COALESCE(c.festa_mode, 'legacy'),
           CASE WHEN c.festa_mode = 'personalizzato' THEN c.festa_mattina
                ELSE private.giorno_festa_legacy_turni(p.id, 'mattina', v_data) END,
           CASE WHEN c.festa_mode = 'personalizzato' THEN c.festa_pomeriggio
                ELSE private.giorno_festa_legacy_turni(p.id, 'pomeriggio', v_data) END,
           COALESCE(c.valida_dal, s.valida_dal), c.revisione IS NOT NULL,
           (SELECT MIN(f.data) FROM (
               SELECT t.valida_dal AS data FROM public.turni_schede t
                WHERE t.profilo_id = p.id AND t.valida_dal > v_data
               UNION ALL
               SELECT t.valida_dal FROM public.turni_squadre t
                WHERE t.profilo_id = p.id AND t.valida_dal > v_data AND c.revisione IS NULL
           ) f)
      FROM public.profili p
      LEFT JOIN LATERAL (
          SELECT t.* FROM public.turni_schede t
           WHERE t.profilo_id = p.id AND t.valida_dal <= v_data
           ORDER BY t.valida_dal DESC, t.revisione DESC LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
          SELECT t.squadra, t.valida_dal FROM public.turni_squadre t
           WHERE t.profilo_id = p.id AND t.valida_dal <= v_data
             AND (t.valida_al IS NULL OR t.valida_al >= v_data)
           ORDER BY t.valida_dal DESC LIMIT 1
      ) s ON true
     WHERE p.accesso AND NOT p.admin
     ORDER BY LOWER(p.nome), p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.salva_scheda_turni(
    p_profilo_id UUID, p_valida_dal DATE, p_squadra SMALLINT,
    p_festa_mode TEXT, p_festa_mattina SMALLINT, p_festa_pomeriggio SMALLINT
)
RETURNS TABLE (
    id UUID, nome TEXT, squadra SMALLINT, festa_mode TEXT,
    festa_mattina SMALLINT, festa_pomeriggio SMALLINT,
    valida_dal DATE, configurata BOOLEAN, prossima_valida_dal DATE
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_ordine SMALLINT;
    v_mese DATE;
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo modificare le schede turni' USING ERRCODE = '42501';
    END IF;
    IF p_profilo_id IS NULL OR p_valida_dal IS NULL OR NOT isfinite(p_valida_dal)
       OR p_valida_dal < v_oggi OR (p_squadra IS NOT NULL AND p_squadra NOT IN (1, 2))
       OR p_festa_mode IS NULL OR p_festa_mode NOT IN ('legacy', 'personalizzato')
       OR (p_festa_mattina IS NOT NULL AND p_festa_mattina NOT BETWEEN 1 AND 7)
       OR (p_festa_pomeriggio IS NOT NULL AND p_festa_pomeriggio NOT BETWEEN 1 AND 7)
       OR (p_festa_mode = 'legacy' AND (p_festa_mattina IS NOT NULL OR p_festa_pomeriggio IS NOT NULL)) THEN
        RAISE EXCEPTION 'Impostazioni turni non valide: la decorrenza non puo essere nel passato' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin) THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;

    SELECT r.ordine_squadra INTO v_ordine FROM private.roster_turni_al(p_valida_dal) r
     WHERE r.profilo_id = p_profilo_id AND r.squadra = p_squadra;
    IF v_ordine IS NULL THEN
        SELECT (COALESCE(MAX(r.ordine_squadra), 0) + 1)::SMALLINT INTO v_ordine
          FROM private.roster_turni_al(p_valida_dal) r WHERE r.squadra = p_squadra;
    END IF;
    INSERT INTO public.turni_schede (
        profilo_id, valida_dal, squadra, ordine_squadra, festa_mode,
        festa_mattina, festa_pomeriggio, creata_da
    ) VALUES (p_profilo_id, p_valida_dal, p_squadra, v_ordine, p_festa_mode,
              p_festa_mattina, p_festa_pomeriggio, v_utente);

    -- Solo una scelta "Da assegnare" ritira le posizioni automatiche di questa
    -- persona. Le schede future possono reinserirla, quindi si rispetta il roster
    -- valido in ogni giorno. Manuali, ferie, legacy e annullamenti non si toccano.
    UPDATE public.turni_lavoro t
       SET annullato = true, annullato_il = CURRENT_TIMESTAMP,
           annullato_da = NULL, aggiornato_il = CURRENT_TIMESTAMP
     WHERE t.profilo_id = p_profilo_id AND t.data >= p_valida_dal
       AND t.origine = 'automatico' AND NOT t.annullato
       AND NOT EXISTS (SELECT 1 FROM private.roster_turni_al(t.data) r WHERE r.profilo_id = p_profilo_id);

    -- Tocca soltanto i mesi gia' preparati e quello della decorrenza. Una
    -- programmazione lontana non deve creare tutti i mesi intermedi quando
    -- si aggiorna in seguito la scheda con decorrenza odierna.
    FOR v_mese IN
        SELECT DATE_TRUNC('month', p_valida_dal)::DATE
        UNION
        SELECT g.mese FROM public.turni_generazioni g WHERE g.giorni_al >= p_valida_dal
        UNION
        SELECT DISTINCT DATE_TRUNC('month', t.data)::DATE FROM public.turni_lavoro t
         WHERE t.origine = 'automatico' AND t.data >= p_valida_dal
        ORDER BY 1
    LOOP
        PERFORM private.genera_turni_periodo(GREATEST(p_valida_dal, v_mese),
            (v_mese + INTERVAL '1 month - 1 day')::DATE, v_utente);
    END LOOP;
    RETURN QUERY SELECT s.* FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
END;
$$;

-- Sposta una sola festa, nello stesso lunedi'-domenica, senza toccare il modello.
-- Entrambe le scritture sono manuali e atomiche, quindi il cron le rispetta.
CREATE OR REPLACE FUNCTION public.sposta_festa_turni(
    p_profilo_id UUID, p_dal DATE, p_al DATE, p_nota TEXT DEFAULT ''
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_ripristino TEXT;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_profilo_id IS NULL OR p_dal IS NULL OR p_al IS NULL OR NOT isfinite(p_dal) OR NOT isfinite(p_al)
       OR p_dal = p_al OR DATE_TRUNC('week', p_dal) <> DATE_TRUNC('week', p_al) THEN
        RAISE EXCEPTION 'Scegli due giorni diversi della stessa settimana' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin) THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.turni_lavoro t WHERE t.profilo_id = p_profilo_id
                   AND t.data = p_dal AND t.turno = 'festa' AND NOT t.annullato) THEN
        RAISE EXCEPTION 'La festa di partenza non e piu disponibile: aggiorna il calendario' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.turni_lavoro t WHERE t.profilo_id = p_profilo_id
                AND t.data = p_al AND t.turno IN ('ferie', 'festa') AND NOT t.annullato) THEN
        RAISE EXCEPTION 'Il giorno scelto e gia segnato come ferie o festa' USING ERRCODE = '22023';
    END IF;
    SELECT r.turno INTO v_ripristino FROM private.programma_turni_giorno(p_dal, p_profilo_id) r
     WHERE r.profilo_id = p_profilo_id;
    IF v_ripristino IS NULL OR v_ripristino NOT IN ('mattina', 'pomeriggio') THEN
        RAISE EXCEPTION 'Assegna prima il turno abituale del dipendente' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM public.imposta_turno_dipendente(p_dal, v_ripristino, p_profilo_id,
        'Festa spostata al ' || TO_CHAR(p_al, 'DD/MM/YYYY'), false);
    RETURN QUERY SELECT * FROM public.imposta_turno_dipendente(p_al, 'festa', p_profilo_id,
        COALESCE(NULLIF(BTRIM(p_nota), ''), 'Festa spostata dal ' || TO_CHAR(p_dal, 'DD/MM/YYYY')), false);
END;
$$;

REVOKE ALL ON FUNCTION public.elenca_schede_turni(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salva_scheda_turni(UUID, DATE, SMALLINT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sposta_festa_turni(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_schede_turni(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salva_scheda_turni(UUID, DATE, SMALLINT, TEXT, SMALLINT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sposta_festa_turni(UUID, DATE, DATE, TEXT) TO authenticated;

-- Il selettore delle eccezioni usa la squadra effettiva di oggi, comprese le
-- schede nuove. Non espone le impostazioni ricorrenti alla gestione delegata.
CREATE OR REPLACE FUNCTION public.elenca_dipendenti_turni()
RETURNS TABLE (id UUID, nome TEXT, squadra SMALLINT, ordine_squadra SMALLINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.puo_gestire_turni((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT p.id, COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente'), r.squadra, r.ordine_squadra
      FROM public.profili p
      LEFT JOIN private.roster_turni_al((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE) r ON r.profilo_id = p.id
     WHERE p.accesso AND NOT p.admin
     ORDER BY LOWER(p.nome), p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.elenca_dipendenti_turni() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_dipendenti_turni() TO authenticated;

-- Compatibilita' con client precedenti: eccezioni delegate, ricorrenza solo admin.
CREATE OR REPLACE FUNCTION public.imposta_turno_dipendente(
    p_data DATE,
    p_turno TEXT,
    p_profilo_id UUID,
    p_nota TEXT DEFAULT '',
    p_rendi_stabile BOOLEAN DEFAULT false
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_nome_autore TEXT;
    v_nome TEXT;
    v_squadra_attuale SMALLINT;
    v_ordine_attuale SMALLINT;
    v_nuova_squadra SMALLINT;
    v_nuovo_ordine SMALLINT;
    v_fine_generata DATE;
    v_riga public.turni_lavoro%ROWTYPE;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    -- Il vecchio client non puo usare l'aggiunta stabile per aggirare le schede.
    IF p_rendi_stabile AND NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo modificare i turni abituali' USING ERRCODE = '42501';
    END IF;
    IF p_data IS NULL OR p_turno NOT IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
       OR p_profilo_id IS NULL THEN
        RAISE EXCEPTION 'Parametri turno non validi' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(20260824, 1901);

    IF p_rendi_stabile AND (p_data < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE OR EXISTS (
        SELECT 1 FROM public.turni_schede s WHERE s.profilo_id = p_profilo_id AND s.valida_dal <= p_data
    )) THEN
        RAISE EXCEPTION 'Modifica il turno abituale dalla scheda dipendente' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Gestore')
      INTO v_nome_autore
      FROM public.profili
     WHERE id = v_utente;

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Dipendente')
      INTO v_nome
      FROM public.profili
     WHERE id = p_profilo_id
       AND accesso
       AND NOT admin;

    IF v_nome IS NULL THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;

    SELECT r.squadra, r.ordine_squadra
      INTO v_squadra_attuale, v_ordine_attuale
      FROM private.roster_turni_al(GREATEST(p_data, '2026-08-24'::DATE)) r
     WHERE r.profilo_id = p_profilo_id;

    IF p_rendi_stabile THEN
        IF p_turno NOT IN ('mattina', 'pomeriggio') THEN
            RAISE EXCEPTION 'Una squadra stabile puo essere mattina o pomeriggio' USING ERRCODE = '22023';
        END IF;

        IF p_data < '2026-08-24'::DATE THEN
            RAISE EXCEPTION 'La ricorrenza stabile parte dal 24 agosto 2026' USING ERRCODE = '22023';
        END IF;

        -- Nella settimana della data richiesta si ricava quale squadra occupa
        -- la fascia scelta. Si aggiunge/sposta soltanto la persona selezionata:
        -- gli altri componenti delle due squadre non cambiano.
        IF MOD((((p_data - (EXTRACT(ISODOW FROM p_data)::INTEGER - 1)) - '2026-08-24'::DATE) / 7)::INTEGER, 2) = 0 THEN
            v_nuova_squadra := CASE WHEN p_turno = 'pomeriggio' THEN 1 ELSE 2 END;
        ELSE
            v_nuova_squadra := CASE WHEN p_turno = 'mattina' THEN 1 ELSE 2 END;
        END IF;

        -- Le persone gia' nel ciclo fanno i cambi una tantum senza smontare le
        -- due squadre base. "Rendi stabile" serve a inserire una persona nuova;
        -- se e' gia' nella squadra della fascia richiesta, e' gia' stabile.
        IF v_squadra_attuale IS NOT NULL AND v_squadra_attuale <> v_nuova_squadra THEN
            RAISE EXCEPTION 'Dipendente gia in una squadra: usa il cambio per questa data' USING ERRCODE = '22023';
        END IF;

        IF v_squadra_attuale IS NULL THEN
            UPDATE public.turni_squadre
               SET valida_al = p_data - 1
             WHERE profilo_id = p_profilo_id
               AND valida_dal < p_data
               AND (valida_al IS NULL OR valida_al >= p_data);

            SELECT (COALESCE(MAX(r.ordine_squadra), 0) + 1)::SMALLINT
              INTO v_nuovo_ordine
              FROM private.roster_turni_al(p_data) r
             WHERE r.squadra = v_nuova_squadra;

            INSERT INTO public.turni_squadre (
                profilo_id, squadra, ordine_squadra, valida_dal, creata_da
            ) VALUES (
                p_profilo_id, v_nuova_squadra, v_nuovo_ordine, p_data, v_utente
            )
            ON CONFLICT (profilo_id, valida_dal) DO UPDATE
               SET squadra = EXCLUDED.squadra,
                   ordine_squadra = EXCLUDED.ordine_squadra,
                   valida_al = NULL,
                   creata_da = EXCLUDED.creata_da;
        END IF;

        SELECT COALESCE(MAX(giorni_al), p_data)
          INTO v_fine_generata
          FROM public.turni_generazioni;

        -- Gli automatici futuri sono un prodotto rigenerabile, non storico
        -- umano. Si annullano tecnicamente invece di cancellarli; manuali, ferie
        -- e annullamenti espliciti non si toccano.
        UPDATE public.turni_lavoro
           SET annullato = true,
               annullato_il = CURRENT_TIMESTAMP,
               annullato_da = NULL,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE data >= p_data
           AND data <= GREATEST(p_data, v_fine_generata)
           AND origine = 'automatico'
           AND NOT annullato;

        PERFORM private.genera_turni_periodo(p_data, GREATEST(p_data, v_fine_generata), v_utente);
    END IF;

    -- Qualunque vecchia posizione della persona nel giorno diventa storico.
    UPDATE public.turni_lavoro
       SET annullato = true,
           annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE data = p_data
       AND profilo_id = p_profilo_id
       AND NOT annullato;

    INSERT INTO public.turni_lavoro (
        data, turno, profilo_id, persona, nota, creato_da,
        origine, annullato, aggiornato_il
    ) VALUES (
        p_data, p_turno, p_profilo_id, v_nome, COALESCE(p_nota, ''), v_nome_autore,
        'manuale', false, CURRENT_TIMESTAMP
    )
    RETURNING * INTO v_riga;

    IF to_regprocedure('private.sincronizza_pulizie_turni(date,date)') IS NOT NULL THEN
        PERFORM private.sincronizza_pulizie_turni(p_data, p_data);
    END IF;
    RETURN NEXT v_riga;
END;
$$;

REVOKE ALL ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN)
    TO authenticated;

-- Assegnazioni pulizie: una correzione amministrativa riguarda soltanto una
-- voce ancora aperta nel periodo corrente. Lo storico e le X restano immutati.
-- Applicare insieme a pulizie_collegate_turni.sql, che definisce il calcolo
-- privato dei responsabili automatici; qui non si rigenerano righe esistenti.

ALTER TABLE public.pulizie_registro
    ADD COLUMN IF NOT EXISTS responsabili_profili UUID[] NOT NULL DEFAULT '{}'::UUID[];
ALTER TABLE public.pulizie_registro
    ADD COLUMN IF NOT EXISTS origine_assegnazione TEXT NOT NULL DEFAULT 'automatico'
        CHECK (origine_assegnazione IN ('automatico', 'manuale'));
ALTER TABLE public.pulizie_registro
    ADD COLUMN IF NOT EXISTS assegnata_da UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.pulizie_registro
    ADD COLUMN IF NOT EXISTS assegnata_il TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.assegna_responsabili_pulizia(
    p_id UUID,
    p_profili UUID[] DEFAULT '{}'::UUID[],
    p_automatico BOOLEAN DEFAULT false
)
RETURNS SETOF public.pulizie_registro
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_riga public.pulizie_registro%ROWTYPE;
    v_profili UUID[];
    v_nomi JSONB;
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo assegnare le pulizie' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL OR p_automatico IS NULL OR (NOT p_automatico AND p_profili IS NULL) THEN
        RAISE EXCEPTION 'Parametri assegnazione non validi' USING ERRCODE = '22023';
    END IF;

    -- Stesso ordine di lock della generazione turni e della sincronizzazione.
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    SELECT r.* INTO v_riga FROM public.pulizie_registro r WHERE r.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pulizia non trovata' USING ERRCODE = 'P0002';
    END IF;
    IF v_riga.completata_il IS NOT NULL OR v_riga.non_fatta_il IS NOT NULL
       OR v_oggi NOT BETWEEN v_riga.periodo_inizio AND v_riga.periodo_fine THEN
        RAISE EXCEPTION 'Puoi modificare solo una pulizia ancora da fare nel periodo corrente' USING ERRCODE = '22023';
    END IF;

    IF p_automatico THEN
        SELECT a.profili, a.nomi INTO v_profili, v_nomi
          FROM private.responsabili_pulizia_automatici(
              v_riga.tipo, v_riga.periodo_inizio, v_riga.turno, v_riga.gruppo, v_riga.prevista_il
          ) a;
        v_profili := COALESCE(v_profili, '{}'::UUID[]);
        v_nomi := COALESCE(v_nomi, '[]'::JSONB);
    ELSE
        IF EXISTS (
            SELECT 1 FROM unnest(p_profili) richiesto(id)
            LEFT JOIN public.profili p ON p.id = richiesto.id
            WHERE p.id IS NULL OR NOT p.accesso OR p.admin
        ) THEN
            RAISE EXCEPTION 'Scegli soltanto dipendenti con accesso approvato' USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(array_agg(p.id ORDER BY LOWER(p.nome), p.id), '{}'::UUID[]),
               COALESCE(jsonb_agg(COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente')
                   ORDER BY LOWER(p.nome), p.id), '[]'::JSONB)
          INTO v_profili, v_nomi
          FROM public.profili p WHERE p.id = ANY(p_profili);
    END IF;

    RETURN QUERY
    UPDATE public.pulizie_registro r
       SET responsabili_profili = v_profili,
           responsabili = v_nomi,
           origine_assegnazione = CASE WHEN p_automatico THEN 'automatico' ELSE 'manuale' END,
           assegnata_da = v_utente,
           assegnata_il = clock_timestamp()
     WHERE r.id = p_id
    RETURNING r.*;
END;
$$;

-- Avvisi operativi: una scelta manuale resta consentita anche se differisce
-- dal turno o dal gruppo. La segnalazione non sostituisce mai un responsabile.
CREATE OR REPLACE FUNCTION public.elenca_incongruenze_pulizie(
    p_settimana DATE,
    p_mese DATE
)
RETURNS TABLE (id UUID, avvisi TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_riga public.pulizie_registro%ROWTYPE;
    v_avvisi TEXT[];
    v_attesi UUID[];
    v_nomi_non_collegati BOOLEAN;
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere le incongruenze delle pulizie' USING ERRCODE = '42501';
    END IF;
    IF p_settimana IS NULL OR p_mese IS NULL OR NOT isfinite(p_settimana) OR NOT isfinite(p_mese)
       OR EXTRACT(ISODOW FROM p_settimana) <> 1 OR EXTRACT(DAY FROM p_mese) <> 1 THEN
        RAISE EXCEPTION 'Indica il lunedi della settimana e il primo giorno del mese' USING ERRCODE = '22023';
    END IF;

    FOR v_riga IN
        SELECT r.* FROM public.pulizie_registro r
         WHERE r.completata_il IS NULL AND r.non_fatta_il IS NULL
           AND v_oggi BETWEEN r.periodo_inizio AND r.periodo_fine
           AND ((r.tipo IN ('bagno', 'settimanale') AND r.periodo_inizio = p_settimana)
                OR (r.tipo = 'mensile' AND r.periodo_inizio = p_mese))
         ORDER BY r.tipo, r.ordine, r.id
    LOOP
        v_avvisi := '{}'::TEXT[];
        v_nomi_non_collegati := false;
        -- Le righe gia' presenti possono avere soltanto i nomi del vecchio
        -- foglio. La risoluzione e' di sola lettura, anche per un bagno dei
        -- giorni precedenti: non cambia la fotografia salvata nel registro.
        IF cardinality(v_riga.responsabili_profili) = 0 AND jsonb_array_length(v_riga.responsabili) > 0 THEN
            SELECT COALESCE(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}'::UUID[]),
                   COALESCE(bool_or(p.id IS NULL), false)
              INTO v_riga.responsabili_profili, v_nomi_non_collegati
              FROM jsonb_array_elements_text(v_riga.responsabili) nome(valore)
              LEFT JOIN public.profili p ON LOWER(BTRIM(p.nome)) = LOWER(BTRIM(nome.valore))
                OR p.id = CASE LOWER(BTRIM(nome.valore))
                    WHEN 'anita' THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID
                    WHEN 'cinzia' THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID
                    WHEN 'imparato' THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
                    WHEN 'francy' THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
                    WHEN 'mery' THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID
                    WHEN 'rosy' THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
                    WHEN 'maria rosaria' THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
                END;
        END IF;
        IF cardinality(v_riga.responsabili_profili) = 0 AND jsonb_array_length(v_riga.responsabili) = 0 THEN
            v_avvisi := array_append(v_avvisi, 'Nessun responsabile assegnato.');
        END IF;
        IF v_nomi_non_collegati THEN
            v_avvisi := array_append(v_avvisi, 'Un responsabile non e collegato a un profilo dipendente.');
        END IF;
        IF EXISTS (
            SELECT 1 FROM unnest(v_riga.responsabili_profili) assegnato(id)
            LEFT JOIN public.profili p ON p.id = assegnato.id
            WHERE p.id IS NULL OR NOT p.accesso OR p.admin
        ) THEN
            v_avvisi := array_append(v_avvisi, 'Uno o piu responsabili non sono dipendenti approvati.');
        END IF;

        IF v_riga.tipo = 'bagno' THEN
            IF v_riga.prevista_il IS NULL THEN
                v_avvisi := array_append(v_avvisi, 'Manca il giorno previsto per questa pulizia.');
            ELSE
                IF EXISTS (
                    SELECT 1 FROM public.turni_lavoro t
                     WHERE t.profilo_id = ANY(v_riga.responsabili_profili)
                       AND t.data = v_riga.prevista_il AND NOT t.annullato
                       AND t.turno IN ('festa', 'ferie')
                ) THEN
                    v_avvisi := array_append(v_avvisi, 'Un responsabile e in festa o in ferie nel giorno previsto.');
                END IF;
                IF EXISTS (
                    SELECT 1 FROM unnest(v_riga.responsabili_profili) assegnato(id)
                    JOIN public.profili p ON p.id = assegnato.id AND p.accesso AND NOT p.admin
                    WHERE NOT EXISTS (
                        SELECT 1 FROM public.turni_lavoro t
                         WHERE t.profilo_id = assegnato.id AND t.data = v_riga.prevista_il
                           AND NOT t.annullato
                           AND t.turno IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
                    )
                ) THEN
                    v_avvisi := array_append(v_avvisi, 'Un responsabile non ha un turno di lavoro nel giorno previsto.');
                END IF;
            END IF;
        ELSE
            SELECT a.profili INTO v_attesi FROM private.responsabili_pulizia_automatici(
                v_riga.tipo, v_riga.periodo_inizio, v_riga.turno, v_riga.gruppo, v_riga.prevista_il
            ) a;
            v_attesi := COALESCE(v_attesi, '{}'::UUID[]);
            IF NOT (v_riga.responsabili_profili @> v_attesi AND v_riga.responsabili_profili <@ v_attesi) THEN
                v_avvisi := array_append(v_avvisi, CASE WHEN v_riga.tipo = 'settimanale'
                    THEN 'Responsabili diversi da quelli previsti dai turni della settimana.'
                    ELSE 'Responsabili diversi dal gruppo previsto per questo mese.' END);
            END IF;
        END IF;

        IF cardinality(v_avvisi) > 0 THEN
            id := v_riga.id;
            avvisi := v_avvisi;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assegna_responsabili_pulizia(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assegna_responsabili_pulizia(UUID, UUID[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) TO authenticated;

-- Applicare dopo turni_schede_admin.sql e pulizie_assegnazioni_admin.sql.
-- Le pulizie aperte seguono il calendario effettivo; manuali e storico restano.

CREATE OR REPLACE FUNCTION private.responsabili_pulizia_automatici(
    p_tipo TEXT, p_periodo DATE, p_turno TEXT, p_gruppo TEXT, p_prevista DATE
)
RETURNS TABLE (profili UUID[], nomi JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_riferimento DATE;
    v_profilo UUID;
BEGIN
    IF p_tipo = 'settimanale' THEN
        RETURN QUERY
        WITH conteggi AS (
            SELECT COALESCE(t.profilo_id::TEXT, LOWER(BTRIM(t.persona))) AS chiave,
                   t.profilo_id,
                   COALESCE(NULLIF(BTRIM(MIN(p.nome)), ''), MIN(BTRIM(t.persona))) AS persona,
                   COUNT(*) FILTER (WHERE t.turno = 'mattina') AS mattine,
                   COUNT(*) FILTER (WHERE t.turno = 'pomeriggio') AS pomeriggi
              FROM public.turni_lavoro t
              LEFT JOIN public.profili p ON p.id = t.profilo_id
             WHERE t.data BETWEEN p_periodo AND p_periodo + 6
               AND t.turno IN ('mattina', 'pomeriggio') AND NOT t.annullato
               AND BTRIM(t.persona) <> ''
               AND (t.profilo_id IS NULL OR (p.accesso AND NOT p.admin))
             GROUP BY COALESCE(t.profilo_id::TEXT, LOWER(BTRIM(t.persona))), t.profilo_id
        ), prevalenti AS (
            SELECT c.profilo_id, c.persona,
                   CASE WHEN c.mattine > c.pomeriggi THEN 'mattina'
                        WHEN c.pomeriggi > c.mattine THEN 'pomeriggio'
                        ELSE COALESCE((
                            SELECT t.turno FROM public.turni_lavoro t
                             WHERE t.data = p_periodo AND NOT t.annullato
                               AND t.turno IN ('mattina', 'pomeriggio')
                               AND COALESCE(t.profilo_id::TEXT, LOWER(BTRIM(t.persona))) = c.chiave
                             ORDER BY CASE t.turno WHEN 'mattina' THEN 1 ELSE 2 END LIMIT 1
                        ), 'mattina') END AS fascia
              FROM conteggi c
        )
        SELECT COALESCE(array_agg(t.profilo_id ORDER BY t.persona, t.profilo_id)
                        FILTER (WHERE t.profilo_id IS NOT NULL), ARRAY[]::UUID[]),
               COALESCE(jsonb_agg(t.persona ORDER BY t.persona, t.profilo_id), '[]'::JSONB)
          FROM prevalenti t WHERE t.fascia = p_turno;
    ELSIF p_tipo = 'mensile' THEN
        -- Per il mese corrente vale il roster di oggi; per altri periodi il
        -- riferimento resta dentro il mese, evitando una fotografia retroattiva.
        v_riferimento := LEAST((p_periodo + INTERVAL '1 month - 1 day')::DATE, GREATEST(p_periodo, v_oggi));
        RETURN QUERY
        SELECT COALESCE(array_agg(r.profilo_id ORDER BY r.nome, r.profilo_id), ARRAY[]::UUID[]),
               COALESCE(jsonb_agg(r.nome ORDER BY r.nome, r.profilo_id), '[]'::JSONB)
          FROM private.roster_turni_al(v_riferimento) r
         WHERE r.squadra = CASE p_gruppo WHEN 'gruppo-1' THEN 1 WHEN 'gruppo-2' THEN 2 END;
    ELSIF p_tipo = 'bagno' THEN
        -- Si mantiene la responsabilita' abituale. Un'assenza viene segnalata
        -- all'admin, che puo' scegliere la sostituta senza assegnazioni casuali.
        v_profilo := CASE EXTRACT(ISODOW FROM p_prevista)::INTEGER
            WHEN 1 THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
            WHEN 2 THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID
            WHEN 3 THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID
            WHEN 4 THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID
            WHEN 5 THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
        END;
        RETURN QUERY
        SELECT COALESCE(array_agg(p.id), ARRAY[]::UUID[]),
               COALESCE(jsonb_agg(COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente')), '[]'::JSONB)
          FROM public.profili p WHERE p.id = v_profilo;
    ELSE
        RETURN QUERY SELECT ARRAY[]::UUID[], '[]'::JSONB;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.responsabili_pulizia_automatici(TEXT, DATE, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sincronizza_pulizie_turni(p_dal DATE, p_al DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_righe INTEGER;
BEGIN
    IF p_dal IS NULL OR p_al IS NULL OR p_al < p_dal THEN RETURN 0; END IF;
    -- I chiamanti possiedono gia' lo stesso lock del calendario; mantenerlo
    -- qui rende atomica anche la preparazione della checklist da un altro client.
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    WITH attese AS (
        SELECT r.id, a.profili, a.nomi
          FROM public.pulizie_registro r
          CROSS JOIN LATERAL private.responsabili_pulizia_automatici(
              r.tipo, r.periodo_inizio, r.turno, r.gruppo, r.prevista_il
          ) a
         WHERE r.origine_assegnazione = 'automatico'
           AND r.completata_il IS NULL AND r.non_fatta_il IS NULL
           AND r.periodo_fine >= v_oggi
           AND r.periodo_inizio <= p_al AND r.periodo_fine >= p_dal
           AND (r.tipo <> 'bagno' OR r.prevista_il >= v_oggi)
    )
    UPDATE public.pulizie_registro r
       SET responsabili = a.nomi, responsabili_profili = a.profili,
           assegnata_il = clock_timestamp(), assegnata_da = NULL
     FROM attese a
     WHERE r.id = a.id
       -- Ripete i vincoli sul target per l'UPDATE concorrente: se un altro
       -- telefono ha appena completato la voce, non ne cambia i responsabili.
       AND r.origine_assegnazione = 'automatico'
       AND r.completata_il IS NULL AND r.non_fatta_il IS NULL
       AND (r.responsabili IS DISTINCT FROM a.nomi OR r.responsabili_profili IS DISTINCT FROM a.profili);
    GET DIAGNOSTICS v_righe = ROW_COUNT;
    RETURN v_righe;
END;
$$;
REVOKE ALL ON FUNCTION private.sincronizza_pulizie_turni(DATE, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepara_pulizie(p_settimana DATE, p_mese DATE)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_gruppo_uno_prima BOOLEAN := MOD(
        (EXTRACT(YEAR FROM p_mese)::INTEGER * 12 + EXTRACT(MONTH FROM p_mese)::INTEGER) - (2026 * 12 + 8), 2
    ) = 0;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.profili p WHERE p.id = (SELECT auth.uid()) AND p.accesso
    ) THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;
    IF p_settimana IS NULL OR NOT isfinite(p_settimana) OR EXTRACT(ISODOW FROM p_settimana) <> 1
       OR p_mese IS NULL OR NOT isfinite(p_mese) OR EXTRACT(DAY FROM p_mese) <> 1 THEN
        RAISE EXCEPTION 'Periodo pulizie non valido' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);

    IF p_settimana BETWEEN (SELECT c.prima_settimana FROM public.pulizie_configurazione c WHERE c.id)
                         AND v_oggi - (EXTRACT(ISODOW FROM v_oggi)::INTEGER - 1) THEN
        WITH voci(voce, ordine) AS (VALUES
            ('Lunedì', 1), ('Martedì', 2), ('Mercoledì', 3), ('Giovedì', 4), ('Venerdì', 5)
        )
        INSERT INTO public.pulizie_registro (
            tipo, voce, ordine, periodo_inizio, periodo_fine, prevista_il, responsabili, responsabili_profili
        )
        SELECT 'bagno', v.voce, v.ordine, p_settimana, p_settimana + 6, p_settimana + v.ordine - 1, a.nomi, a.profili
          FROM voci v CROSS JOIN LATERAL private.responsabili_pulizia_automatici(
              'bagno', p_settimana, NULL, NULL, p_settimana + v.ordine - 1
          ) a
        ON CONFLICT (tipo, voce, periodo_inizio) DO NOTHING;

        WITH voci(voce, ordine, turno) AS (VALUES
            ('Mensole', 1, 'mattina'), ('Staffe', 2, 'mattina'), ('Marmo (pulizia completa)', 3, 'mattina'),
            ('Terminali', 4, 'mattina'), ('Vetri (pulizia completa)', 5, 'mattina'),
            ('Vetrine', 6, 'pomeriggio'), ('Patatine', 7, 'pomeriggio'), ('TV', 8, 'pomeriggio'),
            ('Tavolo', 9, 'pomeriggio'), ('Sedie', 10, 'pomeriggio')
        )
        INSERT INTO public.pulizie_registro (
            tipo, voce, ordine, periodo_inizio, periodo_fine, turno, responsabili, responsabili_profili
        )
        SELECT 'settimanale', v.voce, v.ordine, p_settimana, p_settimana + 6, v.turno, a.nomi, a.profili
          FROM voci v CROSS JOIN LATERAL private.responsabili_pulizia_automatici(
              'settimanale', p_settimana, v.turno, NULL, NULL
          ) a
        ON CONFLICT (tipo, voce, periodo_inizio) DO NOTHING;
    END IF;

    IF p_mese BETWEEN (SELECT c.primo_mese FROM public.pulizie_configurazione c WHERE c.id)
                  AND DATE_TRUNC('month', v_oggi)::DATE THEN
        WITH voci(voce, ordine, elenco) AS (VALUES
            ('Deposito', 1, 1), ('Legno', 2, 1), ('Porta', 3, 1),
            ('Pedana', 4, 2), ('Sottobanco', 5, 2), ('Cassetti', 6, 2), ('Souvenir', 7, 2)
        ), assegnazioni AS (
            SELECT v.*, CASE WHEN (v.elenco = 1) = v_gruppo_uno_prima THEN 'gruppo-1' ELSE 'gruppo-2' END AS gruppo
              FROM voci v
        )
        INSERT INTO public.pulizie_registro (
            tipo, voce, ordine, periodo_inizio, periodo_fine, gruppo, responsabili, responsabili_profili
        )
        SELECT 'mensile', v.voce, v.ordine, p_mese, (p_mese + INTERVAL '1 month - 1 day')::DATE, v.gruppo, a.nomi, a.profili
          FROM assegnazioni v CROSS JOIN LATERAL private.responsabili_pulizia_automatici(
              'mensile', p_mese, NULL, v.gruppo, NULL
          ) a
        ON CONFLICT (tipo, voce, periodo_inizio) DO NOTHING;
    END IF;

    PERFORM private.sincronizza_pulizie_turni(LEAST(p_settimana, p_mese),
        GREATEST(p_settimana + 6, (p_mese + INTERVAL '1 month - 1 day')::DATE));
    PERFORM public.aggiorna_pulizie_non_fatte();
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.prepara_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepara_pulizie(DATE, DATE) TO authenticated;

-- Anche l'annullamento manuale riallinea le checklist aperte nella stessa
-- transazione. Gli altri hook sono nei punti finali del generatore e della RPC
-- imposta_turno_dipendente: non scatta un trigger per ciascuna riga automatica.
CREATE OR REPLACE FUNCTION public.annulla_turno_lavoro(p_id UUID)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_data DATE;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL THEN RAISE EXCEPTION 'Turno non valido' USING ERRCODE = '22023'; END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    SELECT t.data INTO v_data FROM public.turni_lavoro t WHERE t.id = p_id AND NOT t.annullato;
    IF v_data IS NULL THEN
        RAISE EXCEPTION 'Turno non trovato o gia annullato' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY
    UPDATE public.turni_lavoro t
       SET annullato = true, annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente, aggiornato_il = CURRENT_TIMESTAMP
     WHERE t.id = p_id AND NOT t.annullato
    RETURNING t.*;
    PERFORM private.sincronizza_pulizie_turni(v_data, v_data);
END;
$$;
REVOKE ALL ON FUNCTION public.annulla_turno_lavoro(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.annulla_turno_lavoro(UUID) TO authenticated;

-- Permessi indipendenti e registro riservato delle modifiche umane.
-- Dopo le tre patch turni/pulizie. Nessuna rigenerazione o scrittura di dati
-- all'applicazione: le colonne nuove ricevono soltanto il proprio default.

ALTER TABLE public.profili ADD COLUMN IF NOT EXISTS gestione_pulizie BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.pulizie_registro ADD COLUMN IF NOT EXISTS programma_manuale BOOLEAN NOT NULL DEFAULT false;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profili FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.turni_lavoro, public.turni_squadre,
    public.turni_schede, public.pulizie_registro FROM PUBLIC, anon, authenticated;

-- I nuovi profili non ereditano deleghe da UUID o metadati del client.
CREATE OR REPLACE FUNCTION public.crea_profilo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    INSERT INTO public.profili (id, email, nome, correzione_importi_virgole)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', ''),
            NEW.id = 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crea_profilo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.puo_gestire_pulizie(p_utente UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p_utente IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profili p WHERE p.id = p_utente AND p.accesso AND (p.admin OR p.gestione_pulizie)
    );
$$;
REVOKE ALL ON FUNCTION private.puo_gestire_pulizie(UUID) FROM PUBLIC, anon, authenticated;

-- Identita' e nome dell'autore sono fotografie: una successiva cancellazione
-- del profilo non deve cancellare ne' anonimizzare la cronologia amministrativa.
CREATE TABLE IF NOT EXISTS private.modifiche_gestione (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    autore_id UUID NOT NULL,
    autore_nome TEXT NOT NULL,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ambito TEXT NOT NULL CHECK (ambito IN ('turni', 'pulizie', 'permessi')),
    azione TEXT NOT NULL,
    oggetto TEXT NOT NULL,
    prima JSONB,
    dopo JSONB
);
CREATE INDEX IF NOT EXISTS idx_modifiche_gestione_autore_id ON private.modifiche_gestione(autore_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_modifiche_gestione_ambito_id ON private.modifiche_gestione(ambito, id DESC);
CREATE INDEX IF NOT EXISTS idx_modifiche_gestione_data ON private.modifiche_gestione(creata_il, id DESC);
ALTER TABLE private.modifiche_gestione ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.modifiche_gestione FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.modifiche_gestione_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.impedisci_modifica_registro_gestione()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'Il registro delle modifiche e di sola appendice' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.impedisci_modifica_registro_gestione() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_registro_gestione_immutabile ON private.modifiche_gestione;
CREATE TRIGGER trg_registro_gestione_immutabile
    BEFORE UPDATE OR DELETE OR TRUNCATE ON private.modifiche_gestione
    FOR EACH STATEMENT EXECUTE FUNCTION private.impedisci_modifica_registro_gestione();

CREATE OR REPLACE FUNCTION private.registra_modifica_gestione(
    p_ambito TEXT, p_azione TEXT, p_oggetto TEXT, p_prima JSONB, p_dopo JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_nome TEXT;
BEGIN
    IF p_prima IS NOT DISTINCT FROM p_dopo THEN RETURN; END IF;
    SELECT COALESCE(NULLIF(BTRIM(p.nome), ''), 'Utente') INTO v_nome
      FROM public.profili p WHERE p.id = v_utente AND p.accesso;
    IF v_utente IS NULL OR v_nome IS NULL THEN
        RAISE EXCEPTION 'Autore della modifica non autenticato' USING ERRCODE = '42501';
    END IF;
    INSERT INTO private.modifiche_gestione (autore_id, autore_nome, ambito, azione, oggetto, prima, dopo)
    VALUES (v_utente, v_nome, p_ambito, p_azione, p_oggetto, p_prima, p_dopo);
END;
$$;
REVOKE ALL ON FUNCTION private.registra_modifica_gestione(TEXT, TEXT, TEXT, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.fotografia_turno_gestione(p_riga public.turni_lavoro)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN p_riga.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', p_riga.id, 'data', p_riga.data, 'turno', p_riga.turno,
        'profilo_id', p_riga.profilo_id, 'persona', p_riga.persona,
        'nota', p_riga.nota, 'origine', p_riga.origine
    ) END;
$$;
REVOKE ALL ON FUNCTION private.fotografia_turno_gestione(public.turni_lavoro) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.fotografia_pulizia_gestione(p_riga public.pulizie_registro)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'id', p_riga.id, 'tipo', p_riga.tipo, 'voce', p_riga.voce,
        'periodo_inizio', p_riga.periodo_inizio, 'periodo_fine', p_riga.periodo_fine,
        'prevista_il', p_riga.prevista_il, 'turno', p_riga.turno, 'gruppo', p_riga.gruppo,
        'responsabili', p_riga.responsabili, 'responsabili_profili', p_riga.responsabili_profili,
        'origine_assegnazione', p_riga.origine_assegnazione, 'programma_manuale', p_riga.programma_manuale,
        'completata_il', p_riga.completata_il, 'completata_da', p_riga.completata_da,
        'completata_da_nome', p_riga.completata_da_nome
    );
$$;
REVOKE ALL ON FUNCTION private.fotografia_pulizia_gestione(public.pulizie_registro) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.elenca_permessi_utenti()
RETURNS TABLE (id UUID, nome TEXT, email TEXT, accesso BOOLEAN, admin BOOLEAN, gestione_turni BOOLEAN, gestione_pulizie BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere i permessi' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p.id, COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente'),
        p.email, p.accesso, p.admin, p.gestione_turni, p.gestione_pulizie
      FROM public.profili p WHERE p.accesso AND NOT p.admin ORDER BY LOWER(p.nome), p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.salva_permessi_utente(
    p_profilo_id UUID, p_gestione_turni BOOLEAN, p_gestione_pulizie BOOLEAN
)
RETURNS TABLE (id UUID, nome TEXT, email TEXT, accesso BOOLEAN, admin BOOLEAN, gestione_turni BOOLEAN, gestione_pulizie BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima public.profili%ROWTYPE;
    v_dopo public.profili%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo cambiare i permessi' USING ERRCODE = '42501';
    END IF;
    IF p_profilo_id IS NULL OR p_gestione_turni IS NULL OR p_gestione_pulizie IS NULL THEN
        RAISE EXCEPTION 'Permessi non validi' USING ERRCODE = '22023';
    END IF;
    SELECT p.* INTO v_prima FROM public.profili p
     WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Scegli un dipendente con accesso approvato' USING ERRCODE = '22023';
    END IF;
    IF v_prima.gestione_turni IS DISTINCT FROM p_gestione_turni OR v_prima.gestione_pulizie IS DISTINCT FROM p_gestione_pulizie THEN
        UPDATE public.profili p SET gestione_turni = p_gestione_turni, gestione_pulizie = p_gestione_pulizie
         WHERE p.id = p_profilo_id RETURNING p.* INTO v_dopo;
        PERFORM private.registra_modifica_gestione('permessi', 'permessi_modificati', v_dopo.nome,
            jsonb_build_object('id', v_prima.id, 'nome', v_prima.nome, 'gestione_turni', v_prima.gestione_turni, 'gestione_pulizie', v_prima.gestione_pulizie),
            jsonb_build_object('id', v_dopo.id, 'nome', v_dopo.nome, 'gestione_turni', v_dopo.gestione_turni, 'gestione_pulizie', v_dopo.gestione_pulizie));
    END IF;
    RETURN QUERY SELECT p.* FROM public.elenca_permessi_utenti() p WHERE p.id = p_profilo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.elenca_dipendenti_pulizie()
RETURNS TABLE (id UUID, nome TEXT, aliases TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.puo_gestire_pulizie((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione pulizie non consentita' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p.id, COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente'),
        CASE p.id
            WHEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID THEN ARRAY['Anita']
            WHEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID THEN ARRAY['Cinzia']
            WHEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID THEN ARRAY['Imparato', 'Francy']
            WHEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID THEN ARRAY['Mery']
            WHEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID THEN ARRAY['Rosy', 'Maria Rosaria']
            ELSE '{}'::TEXT[] END
      FROM public.profili p WHERE p.accesso AND NOT p.admin ORDER BY LOWER(p.nome), p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.elenca_modifiche_gestione(
    p_autore UUID DEFAULT NULL, p_ambito TEXT DEFAULT NULL,
    p_dal DATE DEFAULT NULL, p_al DATE DEFAULT NULL,
    p_prima_id BIGINT DEFAULT NULL, p_limite INTEGER DEFAULT 50
)
RETURNS TABLE (
    id TEXT, autore_id UUID, autore_nome TEXT, creata_il TIMESTAMPTZ,
    ambito TEXT, azione TEXT, oggetto TEXT, prima JSONB, dopo JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere il registro delle modifiche' USING ERRCODE = '42501';
    END IF;
    IF (p_ambito IS NOT NULL AND p_ambito NOT IN ('turni', 'pulizie', 'permessi'))
       OR (p_dal IS NOT NULL AND NOT isfinite(p_dal)) OR (p_al IS NOT NULL AND NOT isfinite(p_al))
       OR p_al < p_dal OR p_prima_id <= 0 THEN
        RAISE EXCEPTION 'Filtri del registro non validi' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT m.id::TEXT, m.autore_id, m.autore_nome, m.creata_il, m.ambito, m.azione, m.oggetto, m.prima, m.dopo
      FROM private.modifiche_gestione m
     WHERE (p_autore IS NULL OR m.autore_id = p_autore)
       AND (p_ambito IS NULL OR m.ambito = p_ambito)
       AND (p_dal IS NULL OR m.creata_il >= (p_dal::TIMESTAMP AT TIME ZONE 'Europe/Rome'))
       AND (p_al IS NULL OR m.creata_il < ((p_al + 1)::TIMESTAMP AT TIME ZONE 'Europe/Rome'))
       AND (p_prima_id IS NULL OR m.id < p_prima_id)
     ORDER BY m.id DESC LIMIT LEAST(100, GREATEST(1, COALESCE(p_limite, 50)));
END;
$$;

-- Motori interni e wrapper firmati seguono qui.
-- I client non possono chiamare direttamente un motore privo di registrazione.

CREATE OR REPLACE FUNCTION private.imposta_turno_dipendente_interno(
    p_data DATE,
    p_turno TEXT,
    p_profilo_id UUID,
    p_nota TEXT DEFAULT '',
    p_rendi_stabile BOOLEAN DEFAULT false
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_nome_autore TEXT;
    v_nome TEXT;
    v_squadra_attuale SMALLINT;
    v_ordine_attuale SMALLINT;
    v_nuova_squadra SMALLINT;
    v_nuovo_ordine SMALLINT;
    v_fine_generata DATE;
    v_riga public.turni_lavoro%ROWTYPE;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;

    -- Il vecchio client non puo usare l'aggiunta stabile per aggirare le schede.
    IF p_rendi_stabile AND NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo modificare i turni abituali' USING ERRCODE = '42501';
    END IF;
    IF p_data IS NULL OR p_turno NOT IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
       OR p_profilo_id IS NULL THEN
        RAISE EXCEPTION 'Parametri turno non validi' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(20260824, 1901);

    IF p_rendi_stabile AND (p_data < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE OR EXISTS (
        SELECT 1 FROM public.turni_schede s WHERE s.profilo_id = p_profilo_id AND s.valida_dal <= p_data
    )) THEN
        RAISE EXCEPTION 'Modifica il turno abituale dalla scheda dipendente' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Gestore')
      INTO v_nome_autore
      FROM public.profili
     WHERE id = v_utente;

    SELECT COALESCE(NULLIF(BTRIM(nome), ''), NULLIF(BTRIM(email), ''), 'Dipendente')
      INTO v_nome
      FROM public.profili
     WHERE id = p_profilo_id
       AND accesso
       AND NOT admin;

    IF v_nome IS NULL THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;

    SELECT r.squadra, r.ordine_squadra
      INTO v_squadra_attuale, v_ordine_attuale
      FROM private.roster_turni_al(GREATEST(p_data, '2026-08-24'::DATE)) r
     WHERE r.profilo_id = p_profilo_id;

    IF p_rendi_stabile THEN
        IF p_turno NOT IN ('mattina', 'pomeriggio') THEN
            RAISE EXCEPTION 'Una squadra stabile puo essere mattina o pomeriggio' USING ERRCODE = '22023';
        END IF;

        IF p_data < '2026-08-24'::DATE THEN
            RAISE EXCEPTION 'La ricorrenza stabile parte dal 24 agosto 2026' USING ERRCODE = '22023';
        END IF;

        -- Nella settimana della data richiesta si ricava quale squadra occupa
        -- la fascia scelta. Si aggiunge/sposta soltanto la persona selezionata:
        -- gli altri componenti delle due squadre non cambiano.
        IF MOD((((p_data - (EXTRACT(ISODOW FROM p_data)::INTEGER - 1)) - '2026-08-24'::DATE) / 7)::INTEGER, 2) = 0 THEN
            v_nuova_squadra := CASE WHEN p_turno = 'pomeriggio' THEN 1 ELSE 2 END;
        ELSE
            v_nuova_squadra := CASE WHEN p_turno = 'mattina' THEN 1 ELSE 2 END;
        END IF;

        -- Le persone gia' nel ciclo fanno i cambi una tantum senza smontare le
        -- due squadre base. "Rendi stabile" serve a inserire una persona nuova;
        -- se e' gia' nella squadra della fascia richiesta, e' gia' stabile.
        IF v_squadra_attuale IS NOT NULL AND v_squadra_attuale <> v_nuova_squadra THEN
            RAISE EXCEPTION 'Dipendente gia in una squadra: usa il cambio per questa data' USING ERRCODE = '22023';
        END IF;

        IF v_squadra_attuale IS NULL THEN
            UPDATE public.turni_squadre
               SET valida_al = p_data - 1
             WHERE profilo_id = p_profilo_id
               AND valida_dal < p_data
               AND (valida_al IS NULL OR valida_al >= p_data);

            SELECT (COALESCE(MAX(r.ordine_squadra), 0) + 1)::SMALLINT
              INTO v_nuovo_ordine
              FROM private.roster_turni_al(p_data) r
             WHERE r.squadra = v_nuova_squadra;

            INSERT INTO public.turni_squadre (
                profilo_id, squadra, ordine_squadra, valida_dal, creata_da
            ) VALUES (
                p_profilo_id, v_nuova_squadra, v_nuovo_ordine, p_data, v_utente
            )
            ON CONFLICT (profilo_id, valida_dal) DO UPDATE
               SET squadra = EXCLUDED.squadra,
                   ordine_squadra = EXCLUDED.ordine_squadra,
                   valida_al = NULL,
                   creata_da = EXCLUDED.creata_da;
        END IF;

        SELECT COALESCE(MAX(giorni_al), p_data)
          INTO v_fine_generata
          FROM public.turni_generazioni;

        -- Gli automatici futuri sono un prodotto rigenerabile, non storico
        -- umano. Si annullano tecnicamente invece di cancellarli; manuali, ferie
        -- e annullamenti espliciti non si toccano.
        UPDATE public.turni_lavoro
           SET annullato = true,
               annullato_il = CURRENT_TIMESTAMP,
               annullato_da = NULL,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE data >= p_data
           AND data <= GREATEST(p_data, v_fine_generata)
           AND origine = 'automatico'
           AND NOT annullato;

        PERFORM private.genera_turni_periodo(p_data, GREATEST(p_data, v_fine_generata), v_utente);
    END IF;

    -- Qualunque vecchia posizione della persona nel giorno diventa storico.
    UPDATE public.turni_lavoro
       SET annullato = true,
           annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE data = p_data
       AND profilo_id = p_profilo_id
       AND NOT annullato;

    INSERT INTO public.turni_lavoro (
        data, turno, profilo_id, persona, nota, creato_da,
        origine, annullato, aggiornato_il
    ) VALUES (
        p_data, p_turno, p_profilo_id, v_nome, COALESCE(p_nota, ''), v_nome_autore,
        'manuale', false, CURRENT_TIMESTAMP
    )
    RETURNING * INTO v_riga;

    IF to_regprocedure('private.sincronizza_pulizie_turni(date,date)') IS NOT NULL THEN
        PERFORM private.sincronizza_pulizie_turni(p_data, p_data);
    END IF;
    RETURN NEXT v_riga;
END;
$$;
REVOKE ALL ON FUNCTION private.imposta_turno_dipendente_interno(DATE, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.salva_scheda_turni_interno(
    p_profilo_id UUID, p_valida_dal DATE, p_squadra SMALLINT,
    p_festa_mode TEXT, p_festa_mattina SMALLINT, p_festa_pomeriggio SMALLINT
)
RETURNS TABLE (
    id UUID, nome TEXT, squadra SMALLINT, festa_mode TEXT,
    festa_mattina SMALLINT, festa_pomeriggio SMALLINT,
    valida_dal DATE, configurata BOOLEAN, prossima_valida_dal DATE
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_ordine SMALLINT;
    v_mese DATE;
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo modificare le schede turni' USING ERRCODE = '42501';
    END IF;
    IF p_profilo_id IS NULL OR p_valida_dal IS NULL OR NOT isfinite(p_valida_dal)
       OR p_valida_dal < v_oggi OR (p_squadra IS NOT NULL AND p_squadra NOT IN (1, 2))
       OR p_festa_mode IS NULL OR p_festa_mode NOT IN ('legacy', 'personalizzato')
       OR (p_festa_mattina IS NOT NULL AND p_festa_mattina NOT BETWEEN 1 AND 7)
       OR (p_festa_pomeriggio IS NOT NULL AND p_festa_pomeriggio NOT BETWEEN 1 AND 7)
       OR (p_festa_mode = 'legacy' AND (p_festa_mattina IS NOT NULL OR p_festa_pomeriggio IS NOT NULL)) THEN
        RAISE EXCEPTION 'Impostazioni turni non valide: la decorrenza non puo essere nel passato' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin) THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;

    SELECT r.ordine_squadra INTO v_ordine FROM private.roster_turni_al(p_valida_dal) r
     WHERE r.profilo_id = p_profilo_id AND r.squadra = p_squadra;
    IF v_ordine IS NULL THEN
        SELECT (COALESCE(MAX(r.ordine_squadra), 0) + 1)::SMALLINT INTO v_ordine
          FROM private.roster_turni_al(p_valida_dal) r WHERE r.squadra = p_squadra;
    END IF;
    INSERT INTO public.turni_schede (
        profilo_id, valida_dal, squadra, ordine_squadra, festa_mode,
        festa_mattina, festa_pomeriggio, creata_da
    ) VALUES (p_profilo_id, p_valida_dal, p_squadra, v_ordine, p_festa_mode,
              p_festa_mattina, p_festa_pomeriggio, v_utente);

    -- Solo una scelta "Da assegnare" ritira le posizioni automatiche di questa
    -- persona. Le schede future possono reinserirla, quindi si rispetta il roster
    -- valido in ogni giorno. Manuali, ferie, legacy e annullamenti non si toccano.
    UPDATE public.turni_lavoro t
       SET annullato = true, annullato_il = CURRENT_TIMESTAMP,
           annullato_da = NULL, aggiornato_il = CURRENT_TIMESTAMP
     WHERE t.profilo_id = p_profilo_id AND t.data >= p_valida_dal
       AND t.origine = 'automatico' AND NOT t.annullato
       AND NOT EXISTS (SELECT 1 FROM private.roster_turni_al(t.data) r WHERE r.profilo_id = p_profilo_id);

    -- Tocca soltanto i mesi gia' preparati e quello della decorrenza. Una
    -- programmazione lontana non deve creare tutti i mesi intermedi quando
    -- si aggiorna in seguito la scheda con decorrenza odierna.
    FOR v_mese IN
        SELECT DATE_TRUNC('month', p_valida_dal)::DATE
        UNION
        SELECT g.mese FROM public.turni_generazioni g WHERE g.giorni_al >= p_valida_dal
        UNION
        SELECT DISTINCT DATE_TRUNC('month', t.data)::DATE FROM public.turni_lavoro t
         WHERE t.origine = 'automatico' AND t.data >= p_valida_dal
        ORDER BY 1
    LOOP
        PERFORM private.genera_turni_periodo(GREATEST(p_valida_dal, v_mese),
            (v_mese + INTERVAL '1 month - 1 day')::DATE, v_utente);
    END LOOP;
    RETURN QUERY SELECT s.* FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
END;
$$;
REVOKE ALL ON FUNCTION private.salva_scheda_turni_interno(UUID, DATE, SMALLINT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sposta_festa_turni_interno(
    p_profilo_id UUID, p_dal DATE, p_al DATE, p_nota TEXT DEFAULT ''
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_ripristino TEXT;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_profilo_id IS NULL OR p_dal IS NULL OR p_al IS NULL OR NOT isfinite(p_dal) OR NOT isfinite(p_al)
       OR p_dal = p_al OR DATE_TRUNC('week', p_dal) <> DATE_TRUNC('week', p_al) THEN
        RAISE EXCEPTION 'Scegli due giorni diversi della stessa settimana' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin) THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.turni_lavoro t WHERE t.profilo_id = p_profilo_id
                   AND t.data = p_dal AND t.turno = 'festa' AND NOT t.annullato) THEN
        RAISE EXCEPTION 'La festa di partenza non e piu disponibile: aggiorna il calendario' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.turni_lavoro t WHERE t.profilo_id = p_profilo_id
                AND t.data = p_al AND t.turno IN ('ferie', 'festa') AND NOT t.annullato) THEN
        RAISE EXCEPTION 'Il giorno scelto e gia segnato come ferie o festa' USING ERRCODE = '22023';
    END IF;
    SELECT r.turno INTO v_ripristino FROM private.programma_turni_giorno(p_dal, p_profilo_id) r
     WHERE r.profilo_id = p_profilo_id;
    IF v_ripristino IS NULL OR v_ripristino NOT IN ('mattina', 'pomeriggio') THEN
        RAISE EXCEPTION 'Assegna prima il turno abituale del dipendente' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM private.imposta_turno_dipendente_interno(p_dal, v_ripristino, p_profilo_id,
        'Festa spostata al ' || TO_CHAR(p_al, 'DD/MM/YYYY'), false);
    RETURN QUERY SELECT * FROM private.imposta_turno_dipendente_interno(p_al, 'festa', p_profilo_id,
        COALESCE(NULLIF(BTRIM(p_nota), ''), 'Festa spostata dal ' || TO_CHAR(p_dal, 'DD/MM/YYYY')), false);
END;
$$;
REVOKE ALL ON FUNCTION private.sposta_festa_turni_interno(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.annulla_turno_lavoro_interno(p_id UUID)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_data DATE;
BEGIN
    IF NOT private.puo_gestire_turni(v_utente) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL THEN RAISE EXCEPTION 'Turno non valido' USING ERRCODE = '22023'; END IF;
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    SELECT t.data INTO v_data FROM public.turni_lavoro t WHERE t.id = p_id AND NOT t.annullato;
    IF v_data IS NULL THEN
        RAISE EXCEPTION 'Turno non trovato o gia annullato' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY
    UPDATE public.turni_lavoro t
       SET annullato = true, annullato_il = CURRENT_TIMESTAMP,
           annullato_da = v_utente, aggiornato_il = CURRENT_TIMESTAMP
     WHERE t.id = p_id AND NOT t.annullato
    RETURNING t.*;
    PERFORM private.sincronizza_pulizie_turni(v_data, v_data);
END;
$$;
REVOKE ALL ON FUNCTION private.annulla_turno_lavoro_interno(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.imposta_pulizia_completata_interno(
    p_id UUID,
    p_completata BOOLEAN
)
RETURNS SETOF public.pulizie_registro
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi_italiano DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_nome TEXT;
BEGIN
    IF p_id IS NULL OR p_completata IS NULL THEN
        RAISE EXCEPTION 'Parametri pulizia non validi' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
               NULLIF(BTRIM(nome), ''),
               NULLIF(BTRIM(email), ''),
               'Dipendente'
           )
      INTO v_nome
      FROM public.profili
     WHERE id = (SELECT auth.uid())
       AND accesso;

    IF (SELECT auth.uid()) IS NULL OR v_nome IS NULL THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.pulizie_registro
       SET completata_il = CASE WHEN p_completata THEN CURRENT_TIMESTAMP ELSE NULL END,
           completata_da = CASE WHEN p_completata THEN (SELECT auth.uid()) ELSE NULL END,
           completata_da_nome = CASE WHEN p_completata THEN v_nome ELSE '' END
     WHERE id = p_id
       -- Nessuna X, neppure rimossa, prima o dopo il periodo operativo.
       AND v_oggi_italiano BETWEEN periodo_inizio AND periodo_fine
       AND non_fatta_il IS NULL
    RETURNING public.pulizie_registro.*;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.pulizie_registro WHERE id = p_id) THEN
            RAISE EXCEPTION 'Il periodo di questa pulizia è concluso' USING ERRCODE = '22023';
        END IF;

        RAISE EXCEPTION 'Pulizia non trovata' USING ERRCODE = 'P0002';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.imposta_pulizia_completata_interno(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Le autorizzazioni sono rilette dopo il lock condiviso con la loro revoca.
-- Nessun flag di sessione controllabile dal client puo disattivare il registro.
CREATE OR REPLACE FUNCTION public.imposta_turno_dipendente(
    p_data DATE, p_turno TEXT, p_profilo_id UUID,
    p_nota TEXT DEFAULT '', p_rendi_stabile BOOLEAN DEFAULT false
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima public.turni_lavoro%ROWTYPE;
    v_dopo public.turni_lavoro%ROWTYPE;
    v_foto_prima JSONB;
    v_foto_dopo JSONB;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.puo_gestire_turni((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_data IS NULL OR NOT isfinite(p_data) OR p_turno IS NULL
       OR p_turno NOT IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
       OR p_profilo_id IS NULL OR p_rendi_stabile IS NULL THEN
        RAISE EXCEPTION 'Parametri turno non validi' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = p_profilo_id AND p.accesso AND NOT p.admin) THEN
        RAISE EXCEPTION 'Dipendente non disponibile per i turni' USING ERRCODE = '22023';
    END IF;
    SELECT t.* INTO v_prima FROM public.turni_lavoro t
     WHERE t.profilo_id = p_profilo_id AND t.data = p_data AND NOT t.annullato;
    -- Ripetere una richiesta gia salvata non crea nuove versioni ne nuovi autori.
    IF NOT p_rendi_stabile AND v_prima.origine = 'manuale'
       AND v_prima.turno = p_turno AND v_prima.nota IS NOT DISTINCT FROM COALESCE(p_nota, '') THEN
        RETURN NEXT v_prima;
        RETURN;
    END IF;
    v_foto_prima := private.fotografia_turno_gestione(v_prima);
    IF p_rendi_stabile THEN
        v_foto_prima := COALESCE(v_foto_prima, '{}'::JSONB) || jsonb_build_object('squadra',
            (SELECT r.squadra FROM private.roster_turni_al(p_data) r WHERE r.profilo_id = p_profilo_id));
    END IF;
    SELECT t.* INTO v_dopo FROM private.imposta_turno_dipendente_interno(
        p_data, p_turno, p_profilo_id, p_nota, p_rendi_stabile) t;
    v_foto_dopo := private.fotografia_turno_gestione(v_dopo);
    IF p_rendi_stabile THEN
        v_foto_dopo := v_foto_dopo || jsonb_build_object('squadra',
            (SELECT r.squadra FROM private.roster_turni_al(p_data) r WHERE r.profilo_id = p_profilo_id));
    END IF;
    PERFORM private.registra_modifica_gestione('turni', 'turno_modificato',
        v_dopo.persona || ' · ' || TO_CHAR(p_data, 'DD/MM/YYYY'), v_foto_prima, v_foto_dopo);
    RETURN NEXT v_dopo;
END;
$$;

CREATE OR REPLACE FUNCTION public.annulla_turno_lavoro(p_id UUID)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima public.turni_lavoro%ROWTYPE;
    v_dopo public.turni_lavoro%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.puo_gestire_turni((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    SELECT t.* INTO v_prima FROM public.turni_lavoro t WHERE t.id = p_id AND NOT t.annullato;
    SELECT t.* INTO v_dopo FROM private.annulla_turno_lavoro_interno(p_id) t;
    PERFORM private.registra_modifica_gestione('turni', 'turno_annullato',
        v_prima.persona || ' · ' || TO_CHAR(v_prima.data, 'DD/MM/YYYY'),
        private.fotografia_turno_gestione(v_prima), NULL);
    RETURN NEXT v_dopo;
END;
$$;

CREATE OR REPLACE FUNCTION public.salva_scheda_turni(
    p_profilo_id UUID, p_valida_dal DATE, p_squadra SMALLINT,
    p_festa_mode TEXT, p_festa_mattina SMALLINT, p_festa_pomeriggio SMALLINT
)
RETURNS TABLE (
    id UUID, nome TEXT, squadra SMALLINT, festa_mode TEXT,
    festa_mattina SMALLINT, festa_pomeriggio SMALLINT,
    valida_dal DATE, configurata BOOLEAN, prossima_valida_dal DATE
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima JSONB;
    v_dopo JSONB;
    v_corrente public.turni_schede%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo modificare le schede turni' USING ERRCODE = '42501';
    END IF;
    IF p_valida_dal IS NULL OR NOT isfinite(p_valida_dal)
       OR p_valida_dal < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE THEN
        RAISE EXCEPTION 'La decorrenza non puo essere nel passato' USING ERRCODE = '22023';
    END IF;
    SELECT to_jsonb(s) - 'prossima_valida_dal' INTO v_prima
      FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
    SELECT s.* INTO v_corrente FROM public.turni_schede s
     WHERE s.profilo_id = p_profilo_id AND s.valida_dal = p_valida_dal
     ORDER BY s.revisione DESC LIMIT 1;
    IF v_prima IS NOT NULL AND v_corrente.revisione IS NOT NULL
       AND v_corrente.squadra IS NOT DISTINCT FROM p_squadra
       AND v_corrente.festa_mode IS NOT DISTINCT FROM p_festa_mode
       AND v_corrente.festa_mattina IS NOT DISTINCT FROM p_festa_mattina
       AND v_corrente.festa_pomeriggio IS NOT DISTINCT FROM p_festa_pomeriggio THEN
        RETURN QUERY SELECT s.* FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
        RETURN;
    END IF;
    PERFORM private.salva_scheda_turni_interno(
        p_profilo_id, p_valida_dal, p_squadra, p_festa_mode, p_festa_mattina, p_festa_pomeriggio);
    SELECT to_jsonb(s) - 'prossima_valida_dal' INTO v_dopo
      FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
    PERFORM private.registra_modifica_gestione('turni', 'scheda_turni_modificata',
        v_dopo->>'nome', v_prima, v_dopo);
    RETURN QUERY SELECT s.* FROM public.elenca_schede_turni(p_valida_dal) s WHERE s.id = p_profilo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sposta_festa_turni(
    p_profilo_id UUID, p_dal DATE, p_al DATE, p_nota TEXT DEFAULT ''
)
RETURNS SETOF public.turni_lavoro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima JSONB;
    v_dopo JSONB;
    v_nome TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.puo_gestire_turni((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione turni non consentita' USING ERRCODE = '42501';
    END IF;
    SELECT p.nome INTO v_nome FROM public.profili p WHERE p.id = p_profilo_id;
    SELECT jsonb_build_object('dipendente', v_nome, 'dal', p_dal, 'al', p_al,
        'turni', COALESCE(jsonb_agg(private.fotografia_turno_gestione(t) ORDER BY t.data), '[]'::JSONB))
      INTO v_prima FROM public.turni_lavoro t
     WHERE t.profilo_id = p_profilo_id AND t.data IN (p_dal, p_al) AND NOT t.annullato;
    -- Il motore chiama i due motori giornalieri privati: una sola operazione nel registro.
    RETURN QUERY SELECT t.* FROM private.sposta_festa_turni_interno(p_profilo_id, p_dal, p_al, p_nota) t;
    SELECT jsonb_build_object('dipendente', v_nome, 'dal', p_dal, 'al', p_al,
        'turni', COALESCE(jsonb_agg(private.fotografia_turno_gestione(t) ORDER BY t.data), '[]'::JSONB))
      INTO v_dopo FROM public.turni_lavoro t
     WHERE t.profilo_id = p_profilo_id AND t.data IN (p_dal, p_al) AND NOT t.annullato;
    PERFORM private.registra_modifica_gestione('turni', 'festa_spostata', v_nome,
        v_prima, v_dopo);
END;
$$;

-- Motore unico per le due RPC pulizie: programma e persone cambiano insieme.
CREATE OR REPLACE FUNCTION private.modifica_pulizia_interno(
    p_id UUID, p_profili UUID[], p_prevista_il DATE, p_automatico BOOLEAN, p_cambia_data BOOLEAN
)
RETURNS SETOF public.pulizie_registro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_prima public.pulizie_registro%ROWTYPE;
    v_dopo public.pulizie_registro%ROWTYPE;
    v_profili UUID[];
    v_nomi JSONB;
    v_prevista DATE;
    v_programma_manuale BOOLEAN;
    v_origine TEXT;
    v_azione TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT private.puo_gestire_pulizie(v_utente) THEN
        RAISE EXCEPTION 'Gestione pulizie non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL OR p_automatico IS NULL OR p_cambia_data IS NULL
       OR (NOT p_automatico AND p_profili IS NULL) THEN
        RAISE EXCEPTION 'Parametri pulizia non validi' USING ERRCODE = '22023';
    END IF;
    SELECT r.* INTO v_prima FROM public.pulizie_registro r WHERE r.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pulizia non trovata' USING ERRCODE = 'P0002'; END IF;
    IF v_prima.completata_il IS NOT NULL OR v_prima.non_fatta_il IS NOT NULL
       OR v_oggi NOT BETWEEN v_prima.periodo_inizio AND v_prima.periodo_fine THEN
        RAISE EXCEPTION 'Puoi modificare solo una pulizia ancora da fare nel periodo corrente' USING ERRCODE = '22023';
    END IF;

    IF p_automatico THEN
        v_prevista := CASE WHEN v_prima.tipo = 'bagno' THEN v_prima.periodo_inizio + v_prima.ordine - 1 ELSE NULL END;
        v_programma_manuale := false;
        v_origine := 'automatico';
        v_azione := 'pulizia_ripristinata';
        SELECT a.profili, a.nomi INTO v_profili, v_nomi
          FROM private.responsabili_pulizia_automatici(
              v_prima.tipo, v_prima.periodo_inizio, v_prima.turno, v_prima.gruppo, v_prevista) a;
        v_profili := COALESCE(v_profili, '{}'::UUID[]);
        v_nomi := COALESCE(v_nomi, '[]'::JSONB);
    ELSE
        v_prevista := CASE WHEN p_cambia_data THEN p_prevista_il ELSE v_prima.prevista_il END;
        v_programma_manuale := p_cambia_data OR v_prima.programma_manuale;
        v_origine := 'manuale';
        v_azione := CASE WHEN p_cambia_data THEN 'pulizia_riprogrammata' ELSE 'pulizia_assegnata' END;
        IF EXISTS (
            SELECT 1 FROM unnest(p_profili) richiesto(id)
            LEFT JOIN public.profili p ON p.id = richiesto.id
            WHERE p.id IS NULL OR NOT p.accesso OR p.admin
        ) THEN
            RAISE EXCEPTION 'Scegli soltanto dipendenti con accesso approvato' USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(array_agg(p.id ORDER BY LOWER(p.nome), p.id), '{}'::UUID[]),
               COALESCE(jsonb_agg(COALESCE(NULLIF(BTRIM(p.nome), ''), 'Dipendente')
                   ORDER BY LOWER(p.nome), p.id), '[]'::JSONB)
          INTO v_profili, v_nomi FROM public.profili p WHERE p.id = ANY(p_profili);
    END IF;
    IF (v_prima.tipo = 'bagno' AND v_prevista IS NULL)
       OR (v_prevista IS NOT NULL AND (NOT isfinite(v_prevista)
           OR v_prevista NOT BETWEEN v_prima.periodo_inizio AND v_prima.periodo_fine)) THEN
        RAISE EXCEPTION 'Scegli un giorno all interno del periodo della pulizia' USING ERRCODE = '22023';
    END IF;
    IF v_prima.responsabili_profili IS NOT DISTINCT FROM v_profili
       AND v_prima.responsabili IS NOT DISTINCT FROM v_nomi
       AND v_prima.prevista_il IS NOT DISTINCT FROM v_prevista
       AND v_prima.programma_manuale = v_programma_manuale
       AND v_prima.origine_assegnazione = v_origine THEN
        RETURN NEXT v_prima;
        RETURN;
    END IF;
    UPDATE public.pulizie_registro r
       SET responsabili_profili = v_profili, responsabili = v_nomi,
           prevista_il = v_prevista, programma_manuale = v_programma_manuale,
           origine_assegnazione = v_origine, assegnata_da = v_utente, assegnata_il = clock_timestamp()
     WHERE r.id = p_id RETURNING r.* INTO v_dopo;
    PERFORM private.registra_modifica_gestione('pulizie', v_azione,
        INITCAP(v_prima.tipo) || ' · ' || v_prima.voce,
        private.fotografia_pulizia_gestione(v_prima), private.fotografia_pulizia_gestione(v_dopo));
    RETURN NEXT v_dopo;
END;
$$;
REVOKE ALL ON FUNCTION private.modifica_pulizia_interno(UUID, UUID[], DATE, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assegna_responsabili_pulizia(
    p_id UUID, p_profili UUID[] DEFAULT '{}'::UUID[], p_automatico BOOLEAN DEFAULT false
)
RETURNS SETOF public.pulizie_registro
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    SELECT * FROM private.modifica_pulizia_interno(p_id, p_profili, NULL, p_automatico, false);
$$;

CREATE OR REPLACE FUNCTION public.modifica_programma_pulizia(p_id UUID, p_profili UUID[], p_prevista_il DATE)
RETURNS SETOF public.pulizie_registro
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    SELECT * FROM private.modifica_pulizia_interno(p_id, p_profili, p_prevista_il, false, true);
$$;

CREATE OR REPLACE FUNCTION public.imposta_pulizia_completata(p_id UUID, p_completata BOOLEAN)
RETURNS SETOF public.pulizie_registro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_prima public.pulizie_registro%ROWTYPE;
    v_dopo public.pulizie_registro%ROWTYPE;
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE p.id = (SELECT auth.uid()) AND p.accesso) THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL OR p_completata IS NULL THEN
        RAISE EXCEPTION 'Parametri pulizia non validi' USING ERRCODE = '22023';
    END IF;
    SELECT r.* INTO v_prima FROM public.pulizie_registro r WHERE r.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pulizia non trovata' USING ERRCODE = 'P0002'; END IF;
    IF v_oggi NOT BETWEEN v_prima.periodo_inizio AND v_prima.periodo_fine OR v_prima.non_fatta_il IS NOT NULL THEN
        RAISE EXCEPTION 'Il periodo di questa pulizia e concluso' USING ERRCODE = '22023';
    END IF;
    IF (v_prima.completata_il IS NOT NULL) = p_completata THEN
        RETURN NEXT v_prima;
        RETURN;
    END IF;
    SELECT r.* INTO v_dopo FROM private.imposta_pulizia_completata_interno(p_id, p_completata) r;
    PERFORM private.registra_modifica_gestione('pulizie',
        CASE WHEN p_completata THEN 'pulizia_completata' ELSE 'pulizia_riaperta' END,
        INITCAP(v_prima.tipo) || ' · ' || v_prima.voce,
        private.fotografia_pulizia_gestione(v_prima), private.fotografia_pulizia_gestione(v_dopo));
    RETURN NEXT v_dopo;
END;
$$;


CREATE OR REPLACE FUNCTION public.elenca_incongruenze_pulizie(
    p_settimana DATE,
    p_mese DATE
)
RETURNS TABLE (id UUID, avvisi TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_riga public.pulizie_registro%ROWTYPE;
    v_avvisi TEXT[];
    v_attesi UUID[];
    v_nomi_non_collegati BOOLEAN;
BEGIN
    IF NOT private.puo_gestire_pulizie((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Gestione pulizie non consentita' USING ERRCODE = '42501';
    END IF;
    IF p_settimana IS NULL OR p_mese IS NULL OR NOT isfinite(p_settimana) OR NOT isfinite(p_mese)
       OR EXTRACT(ISODOW FROM p_settimana) <> 1 OR EXTRACT(DAY FROM p_mese) <> 1 THEN
        RAISE EXCEPTION 'Indica il lunedi della settimana e il primo giorno del mese' USING ERRCODE = '22023';
    END IF;

    FOR v_riga IN
        SELECT r.* FROM public.pulizie_registro r
         WHERE r.completata_il IS NULL AND r.non_fatta_il IS NULL
           AND v_oggi BETWEEN r.periodo_inizio AND r.periodo_fine
           AND ((r.tipo IN ('bagno', 'settimanale') AND r.periodo_inizio = p_settimana)
                OR (r.tipo = 'mensile' AND r.periodo_inizio = p_mese))
         ORDER BY r.tipo, r.ordine, r.id
    LOOP
        v_avvisi := '{}'::TEXT[];
        v_nomi_non_collegati := false;
        -- Le righe gia' presenti possono avere soltanto i nomi del vecchio
        -- foglio. La risoluzione e' di sola lettura, anche per un bagno dei
        -- giorni precedenti: non cambia la fotografia salvata nel registro.
        IF cardinality(v_riga.responsabili_profili) = 0 AND jsonb_array_length(v_riga.responsabili) > 0 THEN
            SELECT COALESCE(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}'::UUID[]),
                   COALESCE(bool_or(p.id IS NULL), false)
              INTO v_riga.responsabili_profili, v_nomi_non_collegati
              FROM jsonb_array_elements_text(v_riga.responsabili) nome(valore)
              LEFT JOIN public.profili p ON LOWER(BTRIM(p.nome)) = LOWER(BTRIM(nome.valore))
                OR p.id = CASE LOWER(BTRIM(nome.valore))
                    WHEN 'anita' THEN '0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID
                    WHEN 'cinzia' THEN 'bbdea927-f41d-4593-8fba-43067b9f300b'::UUID
                    WHEN 'imparato' THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
                    WHEN 'francy' THEN 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID
                    WHEN 'mery' THEN '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID
                    WHEN 'rosy' THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
                    WHEN 'maria rosaria' THEN '9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID
                END;
        END IF;
        IF cardinality(v_riga.responsabili_profili) = 0 AND jsonb_array_length(v_riga.responsabili) = 0 THEN
            v_avvisi := array_append(v_avvisi, 'Nessun responsabile assegnato.');
        END IF;
        IF v_nomi_non_collegati THEN
            v_avvisi := array_append(v_avvisi, 'Un responsabile non e collegato a un profilo dipendente.');
        END IF;
        IF EXISTS (
            SELECT 1 FROM unnest(v_riga.responsabili_profili) assegnato(id)
            LEFT JOIN public.profili p ON p.id = assegnato.id
            WHERE p.id IS NULL OR NOT p.accesso OR p.admin
        ) THEN
            v_avvisi := array_append(v_avvisi, 'Uno o piu responsabili non sono dipendenti approvati.');
        END IF;

        IF v_riga.tipo = 'bagno' OR v_riga.prevista_il IS NOT NULL THEN
            IF v_riga.prevista_il IS NULL THEN
                v_avvisi := array_append(v_avvisi, 'Manca il giorno previsto per questa pulizia.');
            ELSE
                IF EXISTS (
                    SELECT 1 FROM public.turni_lavoro t
                     WHERE t.profilo_id = ANY(v_riga.responsabili_profili)
                       AND t.data = v_riga.prevista_il AND NOT t.annullato
                       AND t.turno IN ('festa', 'ferie')
                ) THEN
                    v_avvisi := array_append(v_avvisi, 'Un responsabile e in festa o in ferie nel giorno previsto.');
                END IF;
                IF EXISTS (
                    SELECT 1 FROM unnest(v_riga.responsabili_profili) assegnato(id)
                    JOIN public.profili p ON p.id = assegnato.id AND p.accesso AND NOT p.admin
                    WHERE NOT EXISTS (
                        SELECT 1 FROM public.turni_lavoro t
                         WHERE t.profilo_id = assegnato.id AND t.data = v_riga.prevista_il
                           AND NOT t.annullato
                           AND t.turno IN ('mattina', 'intermedio', 'pomeriggio', 'festa', 'ferie')
                    )
                ) THEN
                    v_avvisi := array_append(v_avvisi, 'Un responsabile non ha un turno di lavoro nel giorno previsto.');
                END IF;
            END IF;
        END IF;
        IF v_riga.tipo <> 'bagno' THEN
            SELECT a.profili INTO v_attesi FROM private.responsabili_pulizia_automatici(
                v_riga.tipo, v_riga.periodo_inizio, v_riga.turno, v_riga.gruppo, v_riga.prevista_il
            ) a;
            v_attesi := COALESCE(v_attesi, '{}'::UUID[]);
            IF NOT (v_riga.responsabili_profili @> v_attesi AND v_riga.responsabili_profili <@ v_attesi) THEN
                v_avvisi := array_append(v_avvisi, CASE WHEN v_riga.tipo = 'settimanale'
                    THEN 'Responsabili diversi da quelli previsti dai turni della settimana.'
                    ELSE 'Responsabili diversi dal gruppo previsto per questo mese.' END);
            END IF;
        END IF;

        IF v_riga.tipo = 'bagno' AND v_riga.prevista_il IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.pulizie_registro r
             WHERE r.tipo = 'bagno' AND r.periodo_inizio = v_riga.periodo_inizio
               AND r.prevista_il = v_riga.prevista_il AND r.id <> v_riga.id
               AND r.completata_il IS NULL AND r.non_fatta_il IS NULL
        ) THEN
            v_avvisi := array_append(v_avvisi, 'Due pulizie bagno sono previste nello stesso giorno.');
        END IF;

        IF cardinality(v_avvisi) > 0 THEN
            id := v_riga.id;
            avvisi := v_avvisi;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

-- Nessun EXECUTE implicito: solo utenti autenticati, poi verifica server a ogni chiamata.
REVOKE ALL ON FUNCTION public.elenca_permessi_utenti() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salva_permessi_utente(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_dipendenti_pulizie() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_modifiche_gestione(UUID, TEXT, DATE, DATE, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.annulla_turno_lavoro(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salva_scheda_turni(UUID, DATE, SMALLINT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sposta_festa_turni(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assegna_responsabili_pulizia(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modifica_programma_pulizia(UUID, UUID[], DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_pulizia_completata(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_permessi_utenti() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salva_permessi_utente(UUID, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_dipendenti_pulizie() TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_modifiche_gestione(UUID, TEXT, DATE, DATE, BIGINT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_turno_dipendente(DATE, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.annulla_turno_lavoro(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salva_scheda_turni(UUID, DATE, SMALLINT, TEXT, SMALLINT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sposta_festa_turni(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assegna_responsabili_pulizia(UUID, UUID[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.modifica_programma_pulizia(UUID, UUID[], DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_pulizia_completata(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) TO authenticated;

-- Il filtro include anche autori disattivati o eliminati, senza leggere
-- l'elenco profili: il nome resta l'ultima fotografia presente nel registro.
CREATE OR REPLACE FUNCTION public.elenca_autori_modifiche_gestione()
RETURNS TABLE (id UUID, nome TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere gli autori del registro' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT autore.id, autore.nome
      FROM (
          SELECT DISTINCT ON (m.autore_id) m.autore_id AS id, m.autore_nome AS nome
            FROM private.modifiche_gestione m
           ORDER BY m.autore_id, m.id DESC
      ) autore
     ORDER BY LOWER(autore.nome), autore.id;
END;
$$;
REVOKE ALL ON FUNCTION public.elenca_autori_modifiche_gestione() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_autori_modifiche_gestione() TO authenticated;

-- La prima applicazione garantisce il tratto del mese corrente. Se viene
-- applicata dal giorno 15 in poi prepara naturalmente anche il mese seguente.
SELECT private.genera_turni_cron(NULL);


-- =========================================================================
-- 20. ORDINI SETTIMANALI E NOTIFICHE DELLE 07:00
--
-- Il programma e' ricorrente: il giorno e la voce possono essere cambiati
-- dall'amministratore, mentre l'orario resta fisso alle 07:00 italiane.
-- Le righe iniziali hanno una chiave stabile e vengono inserite una sola volta:
-- rieseguire questo file non rimette un ordine disattivato e non sovrascrive le
-- correzioni fatte dall'app.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ordini_settimanali (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chiave_seed TEXT UNIQUE,
    voce TEXT NOT NULL CHECK (char_length(BTRIM(voce)) BETWEEN 1 AND 120),
    -- Numerazione ISO: lunedi' = 1, domenica = 7.
    giorno_settimana SMALLINT NOT NULL CHECK (giorno_settimana BETWEEN 1 AND 7),
    ordine SMALLINT NOT NULL DEFAULT 0 CHECK (ordine >= 0),
    attivo BOOLEAN NOT NULL DEFAULT true,
    creato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ordini_settimanali_giorno
    ON public.ordini_settimanali (giorno_settimana, ordine, voce)
    WHERE attivo;

INSERT INTO public.ordini_settimanali (
    chiave_seed, voce, giorno_settimana, ordine
)
VALUES
    ('lunedi-nicola-cartinee', 'Nicola Cartinee', 1, 10),
    ('lunedi-gratta-e-vinci', 'Gratta e vinci', 1, 20),
    ('martedi-sigarette', 'Sigarette', 2, 10),
    ('giovedi-detersivo', 'Detersivo', 4, 10),
    ('giovedi-gratta-e-vinci', 'Gratta e vinci', 4, 20)
ON CONFLICT (chiave_seed) DO NOTHING;

ALTER TABLE public.ordini_settimanali ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gli approvati leggono gli ordini settimanali"
    ON public.ordini_settimanali;
CREATE POLICY "Gli approvati leggono gli ordini settimanali"
    ON public.ordini_settimanali
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.profili
             WHERE id = (SELECT auth.uid())
               AND accesso
        )
    );

DROP POLICY IF EXISTS "Gli admin aggiungono ordini settimanali"
    ON public.ordini_settimanali;
CREATE POLICY "Gli admin aggiungono ordini settimanali"
    ON public.ordini_settimanali
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT private.e_amministratore()));

DROP POLICY IF EXISTS "Gli admin aggiornano ordini settimanali"
    ON public.ordini_settimanali;
CREATE POLICY "Gli admin aggiornano ordini settimanali"
    ON public.ordini_settimanali
    FOR UPDATE
    TO authenticated
    USING ((SELECT private.e_amministratore()))
    WITH CHECK ((SELECT private.e_amministratore()));

-- La cancellazione e' intenzionalmente assente: un ordine si disattiva e resta
-- recuperabile. I grant espliciti coprono i progetti che dal 2026 non espongono
-- automaticamente le nuove tabelle alla Data API.
REVOKE ALL ON public.ordini_settimanali FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ordini_settimanali TO authenticated;


-- Selettore interno testabile per il mittente server. Converte sempre l'istante
-- in Europe/Rome, quindi le 07:00 restano corrette sia con l'ora legale sia con
-- quella solare. Fuori da quell'ora non espone alcun ordine.
CREATE OR REPLACE FUNCTION private.ordini_da_notificare(
    p_istante TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    ordine_id UUID,
    voce TEXT,
    data_locale DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH istante AS (
        SELECT p_istante AT TIME ZONE 'Europe/Rome' AS locale
    )
    SELECT o.id,
           BTRIM(o.voce),
           i.locale::DATE
      FROM public.ordini_settimanali o
      CROSS JOIN istante i
     WHERE EXTRACT(HOUR FROM i.locale)::INTEGER = 7
       AND o.attivo
       AND o.giorno_settimana = EXTRACT(ISODOW FROM i.locale)::SMALLINT
     ORDER BY o.ordine, o.voce, o.id;
$$;

REVOKE ALL ON FUNCTION private.ordini_da_notificare(TIMESTAMP WITH TIME ZONE)
    FROM PUBLIC, anon, authenticated;

-- RPC volutamente senza parametri: il backend protetto non puo' scegliere una
-- data o un'ora arbitraria. E' una sola lettura, non crea claim e non puo'
-- impedire i tentativi successivi del servizio di pianificazione esterno.
CREATE OR REPLACE FUNCTION public.ordini_da_notificare_ora()
RETURNS TABLE (
    ordine_id UUID,
    voce TEXT,
    data_locale DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT *
      FROM private.ordini_da_notificare(CURRENT_TIMESTAMP);
$$;

REVOKE ALL ON FUNCTION public.ordini_da_notificare_ora()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ordini_da_notificare_ora()
    TO service_role;


-- =========================================================================
-- 21. STATO NOTIFICHE PER DIPENDENTE
--
-- Le iscrizioni storiche restano valide: il collegamento al profilo e'
-- volutamente nullable, quindi gli endpoint gia' presenti non vengono persi.
-- Quando il dispositivo rinnova l'iscrizione, il client compila questi campi
-- e l'amministratore puo' vedere chi ha effettivamente le notifiche attive.
-- =========================================================================
ALTER TABLE public.push_iscrizioni
    ADD COLUMN IF NOT EXISTS profilo_id UUID;

ALTER TABLE public.push_iscrizioni
    ADD COLUMN IF NOT EXISTS aggiornata_il TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Il vincolo viene aggiunto separatamente dalla colonna: in questo modo anche
-- un'applicazione interrotta fra i due passaggi si completa alla riesecuzione.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'push_iscrizioni_profilo_id_fkey'
           AND conrelid = 'public.push_iscrizioni'::regclass
    ) THEN
        ALTER TABLE public.push_iscrizioni
            ADD CONSTRAINT push_iscrizioni_profilo_id_fkey
            FOREIGN KEY (profilo_id)
            REFERENCES public.profili(id)
            ON DELETE CASCADE;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_push_iscrizioni_profilo_aggiornamento
    ON public.push_iscrizioni (profilo_id, aggiornata_il DESC)
    WHERE profilo_id IS NOT NULL;


-- L'aggregazione vive nello schema non esposto e scavalca RLS soltanto per
-- leggere profili e iscrizioni. Non contiene il controllo del chiamante perche'
-- non e' eseguibile dai ruoli dell'app; il wrapper pubblico lo verifica prima.
CREATE OR REPLACE FUNCTION private.stato_notifiche_dipendenti()
RETURNS TABLE (
    profilo_id UUID,
    nome TEXT,
    attive BOOLEAN,
    numero_dispositivi INTEGER,
    ultimo_aggiornamento TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id,
           COALESCE(
               NULLIF(BTRIM(p.nome), ''),
               NULLIF(BTRIM(p.email), ''),
               'Dipendente'
           ),
           COUNT(i.id) > 0,
           COUNT(i.id)::INTEGER,
           MAX(i.aggiornata_il)
      FROM public.profili p
      LEFT JOIN public.push_iscrizioni i ON i.profilo_id = p.id
     WHERE p.accesso
       AND NOT p.admin
     GROUP BY p.id, p.nome, p.email
     ORDER BY COALESCE(
                  NULLIF(BTRIM(p.nome), ''),
                  NULLIF(BTRIM(p.email), ''),
                  'Dipendente'
              ),
              p.id;
$$;

REVOKE ALL ON FUNCTION private.stato_notifiche_dipendenti()
    FROM PUBLIC, anon, authenticated;


-- Il riepilogo espone soltanto stato e conteggi, mai endpoint o chiavi push.
-- Il controllo usa auth.uid() tramite la funzione privata gia' adottata dagli
-- altri registri amministrativi.
CREATE OR REPLACE FUNCTION public.stato_notifiche_dipendenti()
RETURNS TABLE (
    profilo_id UUID,
    nome TEXT,
    attive BOOLEAN,
    numero_dispositivi INTEGER,
    ultimo_aggiornamento TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo vedere lo stato delle notifiche'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT s.profilo_id,
           s.nome,
           s.attive,
           s.numero_dispositivi,
           s.ultimo_aggiornamento
      FROM private.stato_notifiche_dipendenti() s;
END;
$$;

REVOKE ALL ON FUNCTION public.stato_notifiche_dipendenti()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stato_notifiche_dipendenti()
    TO authenticated;


-- La registrazione non passa piu' da INSERT/UPSERT diretto. Il profilo viene
-- ricavato esclusivamente dal JWT: neppure un client modificato puo' attribuire
-- il proprio dispositivo a un'altra persona.
CREATE OR REPLACE FUNCTION public.registra_iscrizione_push(
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT,
    p_dispositivo TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_endpoint TEXT := BTRIM(COALESCE(p_endpoint, ''));
    v_p256dh TEXT := BTRIM(COALESCE(p_p256dh, ''));
    v_auth TEXT := BTRIM(COALESCE(p_auth, ''));
    v_dispositivo TEXT := BTRIM(COALESCE(p_dispositivo, ''));
BEGIN
    IF v_utente IS NULL OR NOT EXISTS (
        SELECT 1
          FROM public.profili
         WHERE id = v_utente
           AND accesso
    ) THEN
        RAISE EXCEPTION 'Profilo non autorizzato alle notifiche'
            USING ERRCODE = '42501';
    END IF;

    IF char_length(v_endpoint) NOT BETWEEN 10 AND 4096
       OR v_endpoint !~ '^https://'
       OR char_length(v_p256dh) NOT BETWEEN 20 AND 512
       OR char_length(v_auth) NOT BETWEEN 8 AND 256
       OR char_length(v_dispositivo) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Dati iscrizione push non validi'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.push_iscrizioni (
        endpoint,
        p256dh,
        auth,
        dispositivo,
        profilo_id,
        aggiornata_il
    ) VALUES (
        v_endpoint,
        v_p256dh,
        v_auth,
        v_dispositivo,
        v_utente,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           dispositivo = EXCLUDED.dispositivo,
           profilo_id = v_utente,
           aggiornata_il = CURRENT_TIMESTAMP;
END;
$$;

REVOKE ALL ON FUNCTION public.registra_iscrizione_push(TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registra_iscrizione_push(TEXT, TEXT, TEXT, TEXT)
    TO authenticated;


-- Gli endpoint e le chiavi dei dispositivi non vengono esposti da alcuna RPC
-- pubblica. Soltanto le funzioni server Vercel, configurate con service role,
-- possono leggerli e ripulire quelli scaduti.
DROP FUNCTION IF EXISTS public.elenca_iscrizioni_push();


-- Le vecchie policy permettevano a chiunque di leggere, creare e cancellare
-- recapiti. Questo blocco e' volutamente in fondo allo schema: dopo ogni
-- riesecuzione prevale sulle definizioni storiche senza toccare i dati.
DROP POLICY IF EXISTS "Lettura iscrizioni push" ON public.push_iscrizioni;
DROP POLICY IF EXISTS "Scrittura iscrizioni push" ON public.push_iscrizioni;

REVOKE ALL ON public.push_iscrizioni FROM PUBLIC, anon, authenticated;
-- Il server configurato con service role continua a leggere e a rimuovere gli
-- endpoint scaduti direttamente; i browser passano solo dalla RPC autenticata.
GRANT SELECT, DELETE ON public.push_iscrizioni TO service_role;


-- =========================================================================
-- 22. DATI TABACCHERIA: CREDENZIALI E PROCEDURE
--
-- Username e password vivono esclusivamente in Supabase Vault: nelle tabelle
-- pubbliche restano soltanto gli UUID dei segreti cifrati. Il client legge i
-- dati tramite RPC e non deve mai salvarli nella cache locale. Tutti i profili
-- con accesso attivo possono consultare i dati; creazione, modifica,
-- archiviazione, ripristino e riordino sono riservati agli amministratori.
--
-- Non esiste alcuna cancellazione applicativa. Le procedure conservano una
-- revisione immutabile per ogni modifica, mentre l'audit registra chi ha
-- visualizzato/copiato un campo o modificato una voce senza memorizzare valori.
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.dati_tabaccheria_credenziali (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_servizio TEXT NOT NULL
        CHECK (char_length(BTRIM(nome_servizio)) BETWEEN 1 AND 120),
    username_secret_id UUID NOT NULL,
    password_secret_id UUID NOT NULL,
    ordine INTEGER NOT NULL DEFAULT 0
        CHECK (ordine BETWEEN 0 AND 1000000),
    attivo BOOLEAN NOT NULL DEFAULT true,
    versione INTEGER NOT NULL DEFAULT 1
        CHECK (versione > 0),
    creato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    aggiornato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (username_secret_id <> password_secret_id)
);

CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_credenziali_ordine
    ON public.dati_tabaccheria_credenziali (attivo DESC, ordine, nome_servizio, id);
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_credenziali_creato_da
    ON public.dati_tabaccheria_credenziali (creato_da)
    WHERE creato_da IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_credenziali_aggiornato_da
    ON public.dati_tabaccheria_credenziali (aggiornato_da)
    WHERE aggiornato_da IS NOT NULL;


CREATE TABLE IF NOT EXISTS public.dati_tabaccheria_procedure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titolo TEXT NOT NULL
        CHECK (char_length(BTRIM(titolo)) BETWEEN 1 AND 160),
    versione_corrente INTEGER NOT NULL DEFAULT 1
        CHECK (versione_corrente > 0),
    ordine INTEGER NOT NULL DEFAULT 0
        CHECK (ordine BETWEEN 0 AND 1000000),
    attivo BOOLEAN NOT NULL DEFAULT true,
    creato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    aggiornato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aggiornato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_procedure_ordine
    ON public.dati_tabaccheria_procedure (attivo DESC, ordine, titolo, id);
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_procedure_creato_da
    ON public.dati_tabaccheria_procedure (creato_da)
    WHERE creato_da IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_procedure_aggiornato_da
    ON public.dati_tabaccheria_procedure (aggiornato_da)
    WHERE aggiornato_da IS NOT NULL;


-- Titolo e passaggi vengono fotografati insieme: una modifica crea la
-- versione successiva e non sovrascrive mai le istruzioni precedenti.
CREATE TABLE IF NOT EXISTS public.dati_tabaccheria_procedure_versioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedura_id UUID NOT NULL
        REFERENCES public.dati_tabaccheria_procedure(id) ON DELETE RESTRICT,
    versione INTEGER NOT NULL CHECK (versione > 0),
    titolo TEXT NOT NULL
        CHECK (char_length(BTRIM(titolo)) BETWEEN 1 AND 160),
    passaggi JSONB NOT NULL CHECK (jsonb_typeof(passaggi) = 'array'),
    creato_da UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (procedura_id, versione)
);

CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_procedure_versioni_creato_da
    ON public.dati_tabaccheria_procedure_versioni (creato_da)
    WHERE creato_da IS NOT NULL;


-- L'audit contiene soltanto identita', operazione e riferimento alla voce.
-- Username, password, titoli e passaggi non vengono mai copiati nel log.
CREATE TABLE IF NOT EXISTS public.dati_tabaccheria_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profilo_id UUID REFERENCES public.profili(id) ON DELETE SET NULL,
    evento TEXT NOT NULL CHECK (evento IN (
        'campo_visualizzato',
        'campo_copiato',
        'credenziale_creata',
        'credenziale_modificata',
        'credenziale_archiviata',
        'credenziale_ripristinata',
        'credenziali_riordinate',
        'procedura_creata',
        'procedura_modificata',
        'procedura_archiviata',
        'procedura_ripristinata',
        'procedure_riordinate'
    )),
    entita_tipo TEXT NOT NULL CHECK (entita_tipo IN ('credenziale', 'procedura')),
    entita_id UUID,
    campo TEXT CHECK (campo IS NULL OR campo IN ('username', 'password')),
    creato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_audit_data
    ON public.dati_tabaccheria_audit (creato_il DESC);
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_audit_profilo
    ON public.dati_tabaccheria_audit (profilo_id, creato_il DESC)
    WHERE profilo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dati_tabaccheria_audit_entita
    ON public.dati_tabaccheria_audit (entita_tipo, entita_id, creato_il DESC)
    WHERE entita_id IS NOT NULL;


-- Anche se in futuro qualcuno concedesse per errore un privilegio di tabella,
-- RLS senza policy impedisce l'accesso dai ruoli applicativi. Le RPC firmate
-- sono l'unico varco e ripetono sempre il controllo sul profilo corrente.
ALTER TABLE public.dati_tabaccheria_credenziali ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dati_tabaccheria_procedure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dati_tabaccheria_procedure_versioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dati_tabaccheria_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dati_tabaccheria_credenziali
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dati_tabaccheria_procedure
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dati_tabaccheria_procedure_versioni
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dati_tabaccheria_audit
    FROM PUBLIC, anon, authenticated;


-- Restituisce l'UUID soltanto se l'account esiste ancora, e' approvato e,
-- quando richiesto, e' ancora amministratore. Il controllo quindi non dipende
-- da claim JWT potenzialmente vecchi o modificabili dal client.
CREATE OR REPLACE FUNCTION private.autorizza_dati_tabaccheria(
    p_richiedi_admin BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
BEGIN
    IF v_utente IS NULL OR NOT EXISTS (
        SELECT 1
          FROM public.profili p
         WHERE p.id = v_utente
           AND p.accesso
           AND (NOT p_richiedi_admin OR p.admin)
    ) THEN
        RAISE EXCEPTION 'Accesso ai dati della tabaccheria non autorizzato'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_utente;
END;
$$;

REVOKE ALL ON FUNCTION private.autorizza_dati_tabaccheria(BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION private.registra_audit_dati_tabaccheria(
    p_profilo_id UUID,
    p_evento TEXT,
    p_entita_tipo TEXT,
    p_entita_id UUID DEFAULT NULL,
    p_campo TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.dati_tabaccheria_audit (
        profilo_id,
        evento,
        entita_tipo,
        entita_id,
        campo
    ) VALUES (
        p_profilo_id,
        p_evento,
        p_entita_tipo,
        p_entita_id,
        p_campo
    );
$$;

REVOKE ALL ON FUNCTION private.registra_audit_dati_tabaccheria(
    UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;


-- Elenca le credenziali senza restituire la password. Lo username e' letto
-- da Vault al momento della risposta e non esiste in chiaro in public.
CREATE OR REPLACE FUNCTION public.elenca_credenziali_tabaccheria(
    p_includi_archiviate BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    nome_servizio TEXT,
    username TEXT,
    ordine INTEGER,
    attiva BOOLEAN,
    versione INTEGER,
    aggiornato_il TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(false);
    v_admin BOOLEAN;
BEGIN
    SELECT p.admin
      INTO v_admin
      FROM public.profili p
     WHERE p.id = v_utente
       AND p.accesso;

    IF p_includi_archiviate AND NOT COALESCE(v_admin, false) THEN
        RAISE EXCEPTION 'Solo un amministratore puo vedere le credenziali archiviate'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT c.id,
           c.nome_servizio,
           s.decrypted_secret,
           c.ordine,
           c.attivo,
           c.versione,
           c.aggiornato_il
      FROM public.dati_tabaccheria_credenziali c
      LEFT JOIN vault.decrypted_secrets s ON s.id = c.username_secret_id
     WHERE c.attivo OR p_includi_archiviate
     ORDER BY c.attivo DESC, c.ordine, c.nome_servizio, c.id;
END;
$$;


-- Visualizzare o copiare username/password passa da questa RPC: il valore
-- viene restituito soltanto dopo aver scritto l'evento di audit.
CREATE OR REPLACE FUNCTION public.usa_credenziale_tabaccheria(
    p_id UUID,
    p_campo TEXT,
    p_azione TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(false);
    v_admin BOOLEAN;
    v_attivo BOOLEAN;
    v_secret_id UUID;
    v_valore TEXT;
BEGIN
    IF p_campo NOT IN ('username', 'password') THEN
        RAISE EXCEPTION 'Campo credenziale non valido'
            USING ERRCODE = '22023';
    END IF;

    IF p_azione NOT IN ('visualizza', 'copia') THEN
        RAISE EXCEPTION 'Azione credenziale non valida'
            USING ERRCODE = '22023';
    END IF;

    SELECT p.admin
      INTO v_admin
      FROM public.profili p
     WHERE p.id = v_utente
       AND p.accesso;

    SELECT c.attivo,
           CASE p_campo
               WHEN 'username' THEN c.username_secret_id
               ELSE c.password_secret_id
           END
      INTO v_attivo, v_secret_id
      FROM public.dati_tabaccheria_credenziali c
     WHERE c.id = p_id;

    IF NOT FOUND OR (NOT v_attivo AND NOT COALESCE(v_admin, false)) THEN
        RAISE EXCEPTION 'Credenziale non trovata'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT s.decrypted_secret
      INTO v_valore
      FROM vault.decrypted_secrets s
     WHERE s.id = v_secret_id;

    IF NOT FOUND OR v_valore IS NULL THEN
        RAISE EXCEPTION 'Valore cifrato non disponibile'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM private.registra_audit_dati_tabaccheria(
        v_utente,
        CASE p_azione
            WHEN 'visualizza' THEN 'campo_visualizzato'
            ELSE 'campo_copiato'
        END,
        'credenziale',
        p_id,
        p_campo
    );

    RETURN v_valore;
END;
$$;


-- p_id NULL crea una voce. In modifica username e metadati vengono aggiornati;
-- password NULL o vuota conserva il segreto esistente.
CREATE OR REPLACE FUNCTION public.salva_credenziale_tabaccheria(
    p_id UUID,
    p_nome_servizio TEXT,
    p_username TEXT,
    p_password TEXT,
    p_ordine INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(true);
    v_id UUID := COALESCE(p_id, gen_random_uuid());
    v_nome_servizio TEXT := BTRIM(COALESCE(p_nome_servizio, ''));
    v_username TEXT := BTRIM(COALESCE(p_username, ''));
    v_password TEXT := COALESCE(p_password, '');
    v_ordine INTEGER;
    v_username_secret_id UUID;
    v_password_secret_id UUID;
BEGIN
    IF char_length(v_nome_servizio) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'Il nome del servizio deve contenere da 1 a 120 caratteri'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_username) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Lo username deve contenere da 1 a 500 caratteri'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_password) > 4096 THEN
        RAISE EXCEPTION 'La password supera la lunghezza consentita'
            USING ERRCODE = '22023';
    END IF;

    IF p_ordine IS NOT NULL AND p_ordine NOT BETWEEN 0 AND 1000000 THEN
        RAISE EXCEPTION 'Ordine non valido'
            USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
        IF v_password = '' THEN
            RAISE EXCEPTION 'La password e obbligatoria per una nuova credenziale'
                USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(
                   p_ordine,
                   COALESCE(MAX(c.ordine), 0) + 10
               )
          INTO v_ordine
          FROM public.dati_tabaccheria_credenziali c;

        v_username_secret_id := vault.create_secret(
            v_username,
            'dati_tabaccheria.' || v_id::TEXT || '.username',
            'Username cifrato dei dati tabaccheria',
            NULL
        );
        v_password_secret_id := vault.create_secret(
            v_password,
            'dati_tabaccheria.' || v_id::TEXT || '.password',
            'Password cifrata dei dati tabaccheria',
            NULL
        );

        INSERT INTO public.dati_tabaccheria_credenziali (
            id,
            nome_servizio,
            username_secret_id,
            password_secret_id,
            ordine,
            creato_da,
            aggiornato_da
        ) VALUES (
            v_id,
            v_nome_servizio,
            v_username_secret_id,
            v_password_secret_id,
            v_ordine,
            v_utente,
            v_utente
        );

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'credenziale_creata', 'credenziale', v_id, NULL
        );
    ELSE
        SELECT c.username_secret_id,
               c.password_secret_id,
               COALESCE(p_ordine, c.ordine)
          INTO v_username_secret_id, v_password_secret_id, v_ordine
          FROM public.dati_tabaccheria_credenziali c
         WHERE c.id = p_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Credenziale non trovata'
                USING ERRCODE = 'P0002';
        END IF;

        PERFORM vault.update_secret(
            v_username_secret_id,
            v_username,
            'dati_tabaccheria.' || v_id::TEXT || '.username',
            'Username cifrato dei dati tabaccheria',
            NULL
        );

        IF v_password <> '' THEN
            PERFORM vault.update_secret(
                v_password_secret_id,
                v_password,
                'dati_tabaccheria.' || v_id::TEXT || '.password',
                'Password cifrata dei dati tabaccheria',
                NULL
            );
        END IF;

        UPDATE public.dati_tabaccheria_credenziali c
           SET nome_servizio = v_nome_servizio,
               ordine = v_ordine,
               versione = c.versione + 1,
               aggiornato_da = v_utente,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE c.id = p_id;

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'credenziale_modificata', 'credenziale', p_id, NULL
        );
    END IF;

    RETURN v_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.imposta_credenziale_tabaccheria_attiva(
    p_id UUID,
    p_attiva BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(true);
BEGIN
    IF p_attiva IS NULL THEN
        RAISE EXCEPTION 'Stato credenziale non valido'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.dati_tabaccheria_credenziali c
       SET attivo = p_attiva,
           aggiornato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE c.id = p_id
       AND c.attivo IS DISTINCT FROM p_attiva;

    IF NOT FOUND THEN
        IF NOT EXISTS (
            SELECT 1
              FROM public.dati_tabaccheria_credenziali c
             WHERE c.id = p_id
        ) THEN
            RAISE EXCEPTION 'Credenziale non trovata'
                USING ERRCODE = 'P0002';
        END IF;
        RETURN;
    END IF;

    PERFORM private.registra_audit_dati_tabaccheria(
        v_utente,
        CASE WHEN p_attiva
             THEN 'credenziale_ripristinata'
             ELSE 'credenziale_archiviata'
        END,
        'credenziale',
        p_id,
        NULL
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.elenca_procedure_tabaccheria(
    p_includi_archiviate BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    titolo TEXT,
    passaggi JSONB,
    versione INTEGER,
    ordine INTEGER,
    attiva BOOLEAN,
    aggiornato_il TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(false);
    v_admin BOOLEAN;
BEGIN
    SELECT p.admin
      INTO v_admin
      FROM public.profili p
     WHERE p.id = v_utente
       AND p.accesso;

    IF p_includi_archiviate AND NOT COALESCE(v_admin, false) THEN
        RAISE EXCEPTION 'Solo un amministratore puo vedere le procedure archiviate'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT p.id,
           p.titolo,
           v.passaggi,
           p.versione_corrente,
           p.ordine,
           p.attivo,
           p.aggiornato_il
      FROM public.dati_tabaccheria_procedure p
      JOIN public.dati_tabaccheria_procedure_versioni v
        ON v.procedura_id = p.id
       AND v.versione = p.versione_corrente
     WHERE p.attivo OR p_includi_archiviate
     ORDER BY p.attivo DESC, p.ordine, p.titolo, p.id;
END;
$$;


CREATE OR REPLACE FUNCTION public.salva_procedura_tabaccheria(
    p_id UUID,
    p_titolo TEXT,
    p_passaggi JSONB,
    p_ordine INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(true);
    v_id UUID := COALESCE(p_id, gen_random_uuid());
    v_titolo TEXT := BTRIM(COALESCE(p_titolo, ''));
    v_passaggi JSONB;
    v_ordine INTEGER;
    v_versione INTEGER;
BEGIN
    IF char_length(v_titolo) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Il titolo deve contenere da 1 a 160 caratteri'
            USING ERRCODE = '22023';
    END IF;

    IF p_passaggi IS NULL OR jsonb_typeof(p_passaggi) <> 'array' THEN
        RAISE EXCEPTION 'I passaggi devono essere una lista ordinata'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_passaggi) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'Una procedura deve contenere da 1 a 50 passaggi'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_passaggi) e(valore)
         WHERE jsonb_typeof(e.valore) <> 'string'
            OR char_length(BTRIM(e.valore #>> '{}')) NOT BETWEEN 1 AND 500
    ) THEN
        RAISE EXCEPTION 'Ogni passaggio deve essere testo da 1 a 500 caratteri'
            USING ERRCODE = '22023';
    END IF;

    SELECT jsonb_agg(
               to_jsonb(BTRIM(e.valore #>> '{}'))
               ORDER BY e.posizione
           )
      INTO v_passaggi
      FROM jsonb_array_elements(p_passaggi)
           WITH ORDINALITY AS e(valore, posizione);

    IF p_ordine IS NOT NULL AND p_ordine NOT BETWEEN 0 AND 1000000 THEN
        RAISE EXCEPTION 'Ordine non valido'
            USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
        SELECT COALESCE(
                   p_ordine,
                   COALESCE(MAX(p.ordine), 0) + 10
               )
          INTO v_ordine
          FROM public.dati_tabaccheria_procedure p;
        v_versione := 1;

        INSERT INTO public.dati_tabaccheria_procedure (
            id,
            titolo,
            versione_corrente,
            ordine,
            creato_da,
            aggiornato_da
        ) VALUES (
            v_id,
            v_titolo,
            v_versione,
            v_ordine,
            v_utente,
            v_utente
        );

        INSERT INTO public.dati_tabaccheria_procedure_versioni (
            procedura_id,
            versione,
            titolo,
            passaggi,
            creato_da
        ) VALUES (
            v_id,
            v_versione,
            v_titolo,
            v_passaggi,
            v_utente
        );

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'procedura_creata', 'procedura', v_id, NULL
        );
    ELSE
        SELECT p.versione_corrente + 1,
               COALESCE(p_ordine, p.ordine)
          INTO v_versione, v_ordine
          FROM public.dati_tabaccheria_procedure p
         WHERE p.id = p_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Procedura non trovata'
                USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.dati_tabaccheria_procedure_versioni (
            procedura_id,
            versione,
            titolo,
            passaggi,
            creato_da
        ) VALUES (
            p_id,
            v_versione,
            v_titolo,
            v_passaggi,
            v_utente
        );

        UPDATE public.dati_tabaccheria_procedure p
           SET titolo = v_titolo,
               versione_corrente = v_versione,
               ordine = v_ordine,
               aggiornato_da = v_utente,
               aggiornato_il = CURRENT_TIMESTAMP
         WHERE p.id = p_id;

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'procedura_modificata', 'procedura', p_id, NULL
        );
    END IF;

    RETURN v_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.imposta_procedura_tabaccheria_attiva(
    p_id UUID,
    p_attiva BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(true);
BEGIN
    IF p_attiva IS NULL THEN
        RAISE EXCEPTION 'Stato procedura non valido'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.dati_tabaccheria_procedure p
       SET attivo = p_attiva,
           aggiornato_da = v_utente,
           aggiornato_il = CURRENT_TIMESTAMP
     WHERE p.id = p_id
       AND p.attivo IS DISTINCT FROM p_attiva;

    IF NOT FOUND THEN
        IF NOT EXISTS (
            SELECT 1
              FROM public.dati_tabaccheria_procedure p
             WHERE p.id = p_id
        ) THEN
            RAISE EXCEPTION 'Procedura non trovata'
                USING ERRCODE = 'P0002';
        END IF;
        RETURN;
    END IF;

    PERFORM private.registra_audit_dati_tabaccheria(
        v_utente,
        CASE WHEN p_attiva
             THEN 'procedura_ripristinata'
             ELSE 'procedura_archiviata'
        END,
        'procedura',
        p_id,
        NULL
    );
END;
$$;


-- Riordino atomico delle sole voci attive. L'array deve contenerle tutte una
-- volta sola, evitando ordini parziali o duplicati in caso di client vecchi.
CREATE OR REPLACE FUNCTION public.riordina_dati_tabaccheria(
    p_tipo TEXT,
    p_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := private.autorizza_dati_tabaccheria(true);
    v_totale INTEGER;
BEGIN
    IF p_tipo NOT IN ('credenziali', 'procedure') THEN
        RAISE EXCEPTION 'Tipo di riordino non valido'
            USING ERRCODE = '22023';
    END IF;

    IF p_ids IS NULL OR array_position(p_ids, NULL) IS NOT NULL OR EXISTS (
        SELECT 1
          FROM unnest(p_ids) x(id)
         GROUP BY x.id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Elenco di riordino non valido'
            USING ERRCODE = '22023';
    END IF;

    IF p_tipo = 'credenziali' THEN
        PERFORM 1
          FROM public.dati_tabaccheria_credenziali c
         WHERE c.attivo
         FOR UPDATE;

        SELECT COUNT(*)::INTEGER
          INTO v_totale
          FROM public.dati_tabaccheria_credenziali c
         WHERE c.attivo;

        IF v_totale <> cardinality(p_ids) OR EXISTS (
            SELECT 1
              FROM public.dati_tabaccheria_credenziali c
             WHERE c.attivo
               AND NOT (c.id = ANY (p_ids))
        ) THEN
            RAISE EXCEPTION 'Il riordino deve includere tutte le credenziali attive'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.dati_tabaccheria_credenziali c
           SET ordine = (x.posizione * 10)::INTEGER,
               aggiornato_da = v_utente,
               aggiornato_il = CURRENT_TIMESTAMP
          FROM unnest(p_ids) WITH ORDINALITY AS x(id, posizione)
         WHERE c.id = x.id;

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'credenziali_riordinate', 'credenziale', NULL, NULL
        );
    ELSE
        PERFORM 1
          FROM public.dati_tabaccheria_procedure p
         WHERE p.attivo
         FOR UPDATE;

        SELECT COUNT(*)::INTEGER
          INTO v_totale
          FROM public.dati_tabaccheria_procedure p
         WHERE p.attivo;

        IF v_totale <> cardinality(p_ids) OR EXISTS (
            SELECT 1
              FROM public.dati_tabaccheria_procedure p
             WHERE p.attivo
               AND NOT (p.id = ANY (p_ids))
        ) THEN
            RAISE EXCEPTION 'Il riordino deve includere tutte le procedure attive'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.dati_tabaccheria_procedure p
           SET ordine = (x.posizione * 10)::INTEGER,
               aggiornato_da = v_utente,
               aggiornato_il = CURRENT_TIMESTAMP
          FROM unnest(p_ids) WITH ORDINALITY AS x(id, posizione)
         WHERE p.id = x.id;

        PERFORM private.registra_audit_dati_tabaccheria(
            v_utente, 'procedure_riordinate', 'procedura', NULL, NULL
        );
    END IF;
END;
$$;


-- Le RPC pubbliche sono endpoint PostgREST, quindi il privilegio predefinito
-- di PUBLIC viene sempre tolto prima di concederle ai soli utenti autenticati.
REVOKE ALL ON FUNCTION public.elenca_credenziali_tabaccheria(BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usa_credenziale_tabaccheria(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salva_credenziale_tabaccheria(
    UUID, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_credenziale_tabaccheria_attiva(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elenca_procedure_tabaccheria(BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salva_procedura_tabaccheria(UUID, TEXT, JSONB, INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imposta_procedura_tabaccheria_attiva(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.riordina_dati_tabaccheria(TEXT, UUID[])
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.elenca_credenziali_tabaccheria(BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.usa_credenziale_tabaccheria(UUID, TEXT, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.salva_credenziale_tabaccheria(
    UUID, TEXT, TEXT, TEXT, INTEGER
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_credenziale_tabaccheria_attiva(UUID, BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_procedure_tabaccheria(BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.salva_procedura_tabaccheria(UUID, TEXT, JSONB, INTEGER)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.imposta_procedura_tabaccheria_attiva(UUID, BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.riordina_dati_tabaccheria(TEXT, UUID[])
    TO authenticated;
