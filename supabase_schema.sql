-- =========================================================================
-- SCHEMA SUPABASE: TABACCHERIA iNES - REGISTRO INCASSI GIORNALIERI
-- Eseguilo per intero nell'SQL Editor del tuo progetto Supabase.
--
-- Ogni giornata ha DUE righe in daily_logs, una per turno:
--   turno = 'mattina'      chiusura di metà giornata (tra le 10:00 e le 16:00)
--   turno = 'pomeriggio'   chiusura di fine giornata (dalle 16:00 alle 10:00)
--
-- I valori del pomeriggio sono LETTURE CUMULATIVE dell'intera giornata: con
-- mattina 1000 e pomeriggio 2000, il secondo turno vale 1000 e il totale della
-- giornata vale 2000. La vista riepilogo_giornaliero fa questo conto.
-- =========================================================================

-- -------------------------------------------------------------------------
-- IMPORTANTE
-- Le righe qui sotto ricreano tutto da zero. Servono perché
-- "CREATE TABLE IF NOT EXISTS" non modifica una tabella che esiste già: se
-- resta una versione precedente, le nuove colonne non verrebbero mai aggiunte
-- e l'app continuerebbe a fallire ogni scrittura.
--
-- ATTENZIONE: cancellano i dati eventualmente presenti.
-- -------------------------------------------------------------------------
DROP VIEW IF EXISTS public.riepilogo_giornaliero;
DROP TRIGGER IF EXISTS trg_archivia_versione ON public.daily_logs;
DROP FUNCTION IF EXISTS public.archivia_versione_precedente();
DROP TABLE IF EXISTS public.daily_logs_storico;
DROP TABLE IF EXISTS public.daily_logs;
DROP TABLE IF EXISTS public.daily_notes;
DROP TABLE IF EXISTS public.inventario_gratta_e_vinci;
DROP TABLE IF EXISTS public.inventario_sigarette;
DROP TABLE IF EXISTS public.catalogo_gratta_e_vinci;
DROP TABLE IF EXISTS public.catalogo_tabacchi;

-- =========================================================================
-- 1. TABELLA PRINCIPALE: una riga per turno
-- =========================================================================
CREATE TABLE public.daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    turno TEXT NOT NULL CHECK (turno IN ('mattina', 'pomeriggio')),

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    user_id UUID,

    tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mooney NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    -- Totale della lettura di questo turno
    totale_turno NUMERIC(12,2) GENERATED ALWAYS AS (
        (tabacchi + sisal + mooney + lis + printer
            + (lotto_entrate - lotto_uscite)) - fatture
    ) STORED,

    lotto_netto NUMERIC(12,2) GENERATED ALWAYS AS (
        lotto_entrate - lotto_uscite
    ) STORED,

    lotto_aggio NUMERIC(12,2) GENERATED ALWAYS AS (
        lotto_entrate * 0.08
    ) STORED,

    -- Distingue "turno a zero perché non ancora inserito" da "turno davvero a zero"
    compilato BOOLEAN GENERATED ALWAYS AS (
        tabacchi <> 0 OR sisal <> 0 OR mooney <> 0 OR lis <> 0 OR printer <> 0
        OR lotto_entrate <> 0 OR lotto_uscite <> 0 OR fatture <> 0
    ) STORED,

    UNIQUE (date, turno)
);

CREATE INDEX idx_daily_logs_date ON public.daily_logs(date DESC, turno);

-- =========================================================================
-- 2. NOTE E TASK: sono della giornata, non del singolo turno
-- =========================================================================
CREATE TABLE public.daily_notes (
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
CREATE TABLE public.daily_logs_storico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    turno TEXT NOT NULL,
    versione INTEGER NOT NULL,

    archiviato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    -- Da quando era ferma la versione archiviata (il suo updated_at)
    ferma_dal TIMESTAMP WITH TIME ZONE,

    tabacchi NUMERIC(10,2),
    sisal NUMERIC(10,2),
    mooney NUMERIC(10,2),
    lis NUMERIC(10,2),
    printer NUMERIC(10,2),
    lotto_entrate NUMERIC(10,2),
    lotto_uscite NUMERIC(10,2),
    fatture NUMERIC(10,2),
    totale_turno NUMERIC(12,2),

    UNIQUE (date, turno, versione)
);

CREATE INDEX idx_storico_date ON public.daily_logs_storico(date DESC, turno, versione DESC);

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
    IF (OLD.tabacchi, OLD.sisal, OLD.mooney, OLD.lis, OLD.printer,
        OLD.lotto_entrate, OLD.lotto_uscite, OLD.fatture)
       IS DISTINCT FROM
       (NEW.tabacchi, NEW.sisal, NEW.mooney, NEW.lis, NEW.printer,
        NEW.lotto_entrate, NEW.lotto_uscite, NEW.fatture)
    THEN
        IF OLD.updated_at < now() - INTERVAL '2 hours' THEN
            SELECT COALESCE(MAX(versione), 1) + 1
              INTO prossima_versione
              FROM public.daily_logs_storico
             WHERE date = OLD.date AND turno = OLD.turno;

            INSERT INTO public.daily_logs_storico (
                date, turno, versione, ferma_dal,
                tabacchi, sisal, mooney, lis, printer,
                lotto_entrate, lotto_uscite, fatture, totale_turno
            ) VALUES (
                OLD.date, OLD.turno, prossima_versione, OLD.updated_at,
                OLD.tabacchi, OLD.sisal, OLD.mooney, OLD.lis, OLD.printer,
                OLD.lotto_entrate, OLD.lotto_uscite, OLD.fatture, OLD.totale_turno
            );
        END IF;

        -- Il conto delle 2 ore riparte dall'ultima modifica vera di un importo
        NEW.updated_at := now();
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archivia_versione
    BEFORE UPDATE ON public.daily_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.archivia_versione_precedente();

-- =========================================================================
-- 5. VISTA DI RIEPILOGO
--
-- Rimette insieme le due righe della giornata e fa il conto del secondo turno.
-- Serve per guardare i dati dal database senza doverli sottrarre a mano.
-- =========================================================================
-- security_invoker = on: senza questa opzione la vista girerebbe con i permessi
-- del proprietario e scavalcherebbe le policy RLS delle tabelle sottostanti.
-- Con l'opzione attiva la vista applica i permessi di chi la interroga.
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
-- 6. ROW LEVEL SECURITY
-- =========================================================================
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs_storico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lettura registri" ON public.daily_logs
    FOR SELECT USING (true);
CREATE POLICY "Scrittura registri" ON public.daily_logs
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Lettura note" ON public.daily_notes
    FOR SELECT USING (true);
CREATE POLICY "Scrittura note" ON public.daily_notes
    FOR ALL USING (true) WITH CHECK (true);

-- Lo storico è di sola lettura per l'app: lo scrive unicamente il trigger,
-- che gira come proprietario della tabella e non passa da queste policy.
-- Così una copia di sicurezza non può essere sovrascritta o cancellata.
CREATE POLICY "Lettura storico" ON public.daily_logs_storico
    FOR SELECT USING (true);

-- =========================================================================
-- 6. INVENTARIO
--
-- Si registrano le DIFFERENZE rilevate contando il magazzino, non le giacenze
-- totali: un valore negativo indica merce mancante, uno positivo merce trovata
-- in più. Zero significa che il conto torna.
-- =========================================================================
CREATE TABLE public.inventario_gratta_e_vinci (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    gioco TEXT NOT NULL,
    prezzo NUMERIC(10,2) NOT NULL,

    pacchi INTEGER NOT NULL DEFAULT 0,
    pezzi INTEGER NOT NULL DEFAULT 0,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    UNIQUE (date, gioco)
);

CREATE INDEX idx_inv_gev_date ON public.inventario_gratta_e_vinci(date DESC);

CREATE TABLE public.inventario_sigarette (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    marca TEXT NOT NULL,

    stecche INTEGER NOT NULL DEFAULT 0,
    pacchetti INTEGER NOT NULL DEFAULT 0,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    UNIQUE (date, marca)
);

CREATE INDEX idx_inv_sig_date ON public.inventario_sigarette(date DESC);

ALTER TABLE public.inventario_gratta_e_vinci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_sigarette ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lettura inventario gratta e vinci" ON public.inventario_gratta_e_vinci
    FOR SELECT USING (true);
CREATE POLICY "Scrittura inventario gratta e vinci" ON public.inventario_gratta_e_vinci
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Lettura inventario sigarette" ON public.inventario_sigarette
    FOR SELECT USING (true);
CREATE POLICY "Scrittura inventario sigarette" ON public.inventario_sigarette
    FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 7. CATALOGHI
--
-- L'elenco degli articoli è modificabile dall'app, quindi vive nel database e
-- non nel codice. Al primo avvio, se le tabelle sono vuote, l'app le riempie
-- con gli articoli ricavati dagli ordini e dalle fatture.
-- =========================================================================
CREATE TABLE public.catalogo_gratta_e_vinci (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gioco TEXT NOT NULL UNIQUE,
    prezzo NUMERIC(10,2) NOT NULL,
    pezzi_per_pacco INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.catalogo_tabacchi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prodotto TEXT NOT NULL UNIQUE,
    marca TEXT NOT NULL,
    categoria TEXT NOT NULL
        CHECK (categoria IN ('sigarette', 'elettronico', 'sigari', 'busta_scatola')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_cat_tab_categoria ON public.catalogo_tabacchi(categoria, marca);

ALTER TABLE public.catalogo_gratta_e_vinci ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_tabacchi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lettura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci
    FOR SELECT USING (true);
CREATE POLICY "Scrittura catalogo gratta e vinci" ON public.catalogo_gratta_e_vinci
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Lettura catalogo tabacchi" ON public.catalogo_tabacchi
    FOR SELECT USING (true);
CREATE POLICY "Scrittura catalogo tabacchi" ON public.catalogo_tabacchi
    FOR ALL USING (true) WITH CHECK (true);
