-- =========================================================================
-- SCHEMA SUPABASE: TABACCHERIA GESTIONE INCASSI GIORNALIERI
-- Eseguilo nell'SQL Editor del tuo progetto Supabase
--
-- La giornata ha DUE chiusure:
--   pranzo_*  chiusura di metà giornata (si compila tra le 10:00 e le 16:00)
--   sera_*    chiusura di fine giornata (dalle 16:00 alle 10:00 del giorno dopo)
--
-- I valori serali sono LETTURE CUMULATIVE dell'intera giornata, non del solo
-- turno serale: con pranzo 1000 e sera 2000 il secondo turno vale 1000 e il
-- totale della giornata vale 2000.
-- =========================================================================

-- Se stai ricreando la tabella da una versione precedente a turno singolo,
-- decommenta la riga seguente. ATTENZIONE: cancella i dati già registrati.
-- DROP TABLE IF EXISTS public.daily_logs;

-- 1. Creazione Tabella daily_logs
CREATE TABLE IF NOT EXISTS public.daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID,

    -- ---------------------------------------------------------------------
    -- CHIUSURA DI PRANZO (Turno 1)
    -- ---------------------------------------------------------------------
    pranzo_tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pranzo_fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    -- ---------------------------------------------------------------------
    -- CHIUSURA SERALE (lettura cumulativa dell'intera giornata)
    -- ---------------------------------------------------------------------
    sera_tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sera_fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    -- ---------------------------------------------------------------------
    -- TOTALI CALCOLATI DAL DATABASE
    --
    -- Le espressioni sono ripetute per esteso perché in PostgreSQL una colonna
    -- generata non può fare riferimento a un'altra colonna generata.
    -- ---------------------------------------------------------------------

    -- Totale Turno 1: la chiusura di pranzo così com'è
    totale_turno_pranzo NUMERIC(12,2) GENERATED ALWAYS AS (
        (pranzo_tabacchi + pranzo_sisal + pranzo_lis + pranzo_printer
            + (pranzo_lotto_entrate - pranzo_lotto_uscite)) - pranzo_fatture
    ) STORED,

    -- Totale Turno 2: lettura serale meno il pranzo. Vale 0 finché la chiusura
    -- serale non è stata compilata, per non mostrare un turno 2 negativo.
    totale_turno_sera NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (sera_tabacchi <> 0 OR sera_sisal <> 0 OR sera_lis <> 0
                   OR sera_printer <> 0 OR sera_lotto_entrate <> 0
                   OR sera_lotto_uscite <> 0 OR sera_fatture <> 0)
            THEN ((sera_tabacchi + sera_sisal + sera_lis + sera_printer
                    + (sera_lotto_entrate - sera_lotto_uscite)) - sera_fatture)
                 - ((pranzo_tabacchi + pranzo_sisal + pranzo_lis + pranzo_printer
                    + (pranzo_lotto_entrate - pranzo_lotto_uscite)) - pranzo_fatture)
            ELSE 0
        END
    ) STORED,

    -- Totale Giornata: coincide con la lettura serale perché è cumulativa.
    -- Finché la sera non è chiusa resta il totale del solo pranzo.
    totale_giornata NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (sera_tabacchi <> 0 OR sera_sisal <> 0 OR sera_lis <> 0
                   OR sera_printer <> 0 OR sera_lotto_entrate <> 0
                   OR sera_lotto_uscite <> 0 OR sera_fatture <> 0)
            THEN (sera_tabacchi + sera_sisal + sera_lis + sera_printer
                    + (sera_lotto_entrate - sera_lotto_uscite)) - sera_fatture
            ELSE (pranzo_tabacchi + pranzo_sisal + pranzo_lis + pranzo_printer
                    + (pranzo_lotto_entrate - pranzo_lotto_uscite)) - pranzo_fatture
        END
    ) STORED,

    -- Aggio Lotto della giornata: 8% delle entrate cumulative
    lotto_aggio NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (sera_tabacchi <> 0 OR sera_sisal <> 0 OR sera_lis <> 0
                   OR sera_printer <> 0 OR sera_lotto_entrate <> 0
                   OR sera_lotto_uscite <> 0 OR sera_fatture <> 0)
            THEN sera_lotto_entrate * 0.08
            ELSE pranzo_lotto_entrate * 0.08
        END
    ) STORED,

    -- Lotto Netto della giornata: entrate - uscite cumulative
    lotto_netto NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (sera_tabacchi <> 0 OR sera_sisal <> 0 OR sera_lis <> 0
                   OR sera_printer <> 0 OR sera_lotto_entrate <> 0
                   OR sera_lotto_uscite <> 0 OR sera_fatture <> 0)
            THEN sera_lotto_entrate - sera_lotto_uscite
            ELSE pranzo_lotto_entrate - pranzo_lotto_uscite
        END
    ) STORED,

    notes TEXT DEFAULT '',
    chat_notes JSONB DEFAULT '[]'::jsonb,
    todos JSONB DEFAULT '[]'::jsonb
);

-- 2. Indice per velocizzare la ricerca per Data
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON public.daily_logs(date DESC);

-- 3. Attivazione Row Level Security (RLS)
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;

-- 4. Policy di accesso per utenti autenticati e anonimi (Demo / Sviluppo)
DROP POLICY IF EXISTS "Permetti lettura registri recenti" ON public.daily_logs;
CREATE POLICY "Permetti lettura registri recenti" ON public.daily_logs
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permetti inserimento e aggiornamento registri" ON public.daily_logs;
CREATE POLICY "Permetti inserimento e aggiornamento registri" ON public.daily_logs
    FOR ALL USING (true) WITH CHECK (true);
