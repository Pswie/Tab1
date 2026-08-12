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

-- Per ora queste due eccezioni appartengono soltanto agli account indicati.
UPDATE public.profili
   SET gestione_turni = true
 WHERE id = '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID;

UPDATE public.profili
   SET correzione_importi_virgole = true
 WHERE id = 'f5196428-c7b3-4900-af4d-28571064adbb'::UUID;

CREATE OR REPLACE FUNCTION public.crea_profilo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profili (
        id, email, nome, gestione_turni, correzione_importi_virgole
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nome', ''),
        NEW.id = '8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID,
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
    ('8d0fcb4a-31b5-4adc-a97c-98642f07a3e8'::UUID, 1, 1, '2026-08-24'::DATE),
    ('f5196428-c7b3-4900-af4d-28571064adbb'::UUID, 1, 2, '2026-08-24'::DATE),
    ('bbdea927-f41d-4593-8fba-43067b9f300b'::UUID, 1, 3, '2026-08-24'::DATE),
    ('0e40e42a-67c1-4594-87c7-ec2df529e540'::UUID, 2, 1, '2026-08-24'::DATE),
    ('9ff1c482-1e80-4fa8-aca6-0f17873abc87'::UUID, 2, 2, '2026-08-24'::DATE)
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
-- prevalgono; un automatico invalidato tecnicamente puo' essere rigenerato.
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
    -- tombstone: il generatore li rispetta. Un automatico annullato senza autore
    -- e' invece un'invalidazione tecnica e puo' essere riattivato in-place.
    IF EXISTS (
        SELECT 1
          FROM public.turni_lavoro
         WHERE data = p_data
           AND profilo_id = p_profilo_id
           AND (
               NOT annullato
               OR origine = 'manuale'
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
-- e squadra 2 al mattino; ogni lunedi' le fasce si scambiano. Nei feriali si
-- applica la festa fissa. Se manca una componente della squadra da due, una
-- componente della squadra da tre copre la fascia opposta a rotazione: chi si
-- sposta compare una volta sola. Sabato e domenica lavorano le squadre intere.
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

        v_festa := CASE EXTRACT(ISODOW FROM v_data)::INTEGER
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
        END;

        -- Se la festa cade nella squadra 2, una persona della squadra 1 copre
        -- l'altra fascia. La rotazione dipende dal giorno assoluto e dall'ordine
        -- del roster, quindi e' deterministica anche dopo una rigenerazione.
        v_copertura := NULL;
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

-- La prima applicazione garantisce il tratto del mese corrente. Se viene
-- applicata dal giorno 15 in poi prepara naturalmente anche il mese seguente.
SELECT private.genera_turni_cron(NULL);
