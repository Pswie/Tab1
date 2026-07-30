-- =========================================================================
-- SCHEMA SUPABASE: TABACCHERIA iNES - REGISTRO INCASSI GIORNALIERI
-- Eseguilo per intero nell'SQL Editor del tuo progetto Supabase.
--
-- La giornata ha DUE turni:
--   mattina_*     chiusura di metà giornata (si compila tra le 10:00 e le 16:00)
--   pomeriggio_*  chiusura di fine giornata (dalle 16:00 alle 10:00 del giorno dopo)
--
-- I valori del pomeriggio sono LETTURE CUMULATIVE dell'intera giornata, non del
-- solo pomeriggio: con mattina 1000 e pomeriggio 2000 il secondo turno vale
-- 1000 e il totale della giornata vale 2000.
-- =========================================================================

-- -------------------------------------------------------------------------
-- IMPORTANTE
-- Le righe qui sotto ricreano la tabella da zero. Servono perché
-- "CREATE TABLE IF NOT EXISTS" non modifica una tabella che esiste già: se hai
-- una vecchia versione della tabella, le nuove colonne non verrebbero mai
-- aggiunte e l'app continuerebbe a fallire ogni scrittura.
--
-- ATTENZIONE: cancellano i dati eventualmente presenti.
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_archivia_versione ON public.daily_logs;
DROP FUNCTION IF EXISTS public.archivia_versione_precedente();
DROP TABLE IF EXISTS public.daily_logs_storico;
DROP TABLE IF EXISTS public.daily_logs;

-- =========================================================================
-- 1. TABELLA PRINCIPALE: una riga per giornata
-- =========================================================================
CREATE TABLE public.daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    user_id UUID,

    -- ---------------------------------------------------------------------
    -- TURNO MATTINA (Turno 1)
    -- ---------------------------------------------------------------------
    mattina_tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    mattina_fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    -- ---------------------------------------------------------------------
    -- TURNO POMERIGGIO (lettura cumulativa dell'intera giornata)
    -- ---------------------------------------------------------------------
    pomeriggio_tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    pomeriggio_fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,

    -- ---------------------------------------------------------------------
    -- TOTALI CALCOLATI DAL DATABASE
    --
    -- Le espressioni sono ripetute per esteso perché in PostgreSQL una colonna
    -- generata non può fare riferimento a un'altra colonna generata.
    -- ---------------------------------------------------------------------

    -- Totale Turno 1: la chiusura della mattina così com'è
    totale_turno_mattina NUMERIC(12,2) GENERATED ALWAYS AS (
        (mattina_tabacchi + mattina_sisal + mattina_lis + mattina_printer
            + (mattina_lotto_entrate - mattina_lotto_uscite)) - mattina_fatture
    ) STORED,

    -- Totale Turno 2: lettura del pomeriggio meno la mattina. Vale 0 finché il
    -- pomeriggio non è stato compilato, per non mostrare un turno 2 negativo.
    totale_turno_pomeriggio NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (pomeriggio_tabacchi <> 0 OR pomeriggio_sisal <> 0
                   OR pomeriggio_lis <> 0 OR pomeriggio_printer <> 0
                   OR pomeriggio_lotto_entrate <> 0 OR pomeriggio_lotto_uscite <> 0
                   OR pomeriggio_fatture <> 0)
            THEN ((pomeriggio_tabacchi + pomeriggio_sisal + pomeriggio_lis
                    + pomeriggio_printer
                    + (pomeriggio_lotto_entrate - pomeriggio_lotto_uscite))
                    - pomeriggio_fatture)
                 - ((mattina_tabacchi + mattina_sisal + mattina_lis + mattina_printer
                    + (mattina_lotto_entrate - mattina_lotto_uscite)) - mattina_fatture)
            ELSE 0
        END
    ) STORED,

    -- Totale Giornata: coincide con la lettura del pomeriggio perché è
    -- cumulativa. Finché il pomeriggio non è chiuso resta il totale della mattina.
    totale_giornata NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (pomeriggio_tabacchi <> 0 OR pomeriggio_sisal <> 0
                   OR pomeriggio_lis <> 0 OR pomeriggio_printer <> 0
                   OR pomeriggio_lotto_entrate <> 0 OR pomeriggio_lotto_uscite <> 0
                   OR pomeriggio_fatture <> 0)
            THEN (pomeriggio_tabacchi + pomeriggio_sisal + pomeriggio_lis
                    + pomeriggio_printer
                    + (pomeriggio_lotto_entrate - pomeriggio_lotto_uscite))
                    - pomeriggio_fatture
            ELSE (mattina_tabacchi + mattina_sisal + mattina_lis + mattina_printer
                    + (mattina_lotto_entrate - mattina_lotto_uscite)) - mattina_fatture
        END
    ) STORED,

    -- Aggio Lotto della giornata: 8% delle entrate cumulative
    lotto_aggio NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (pomeriggio_tabacchi <> 0 OR pomeriggio_sisal <> 0
                   OR pomeriggio_lis <> 0 OR pomeriggio_printer <> 0
                   OR pomeriggio_lotto_entrate <> 0 OR pomeriggio_lotto_uscite <> 0
                   OR pomeriggio_fatture <> 0)
            THEN pomeriggio_lotto_entrate * 0.08
            ELSE mattina_lotto_entrate * 0.08
        END
    ) STORED,

    -- Lotto Netto della giornata: entrate - uscite cumulative
    lotto_netto NUMERIC(12,2) GENERATED ALWAYS AS (
        CASE WHEN (pomeriggio_tabacchi <> 0 OR pomeriggio_sisal <> 0
                   OR pomeriggio_lis <> 0 OR pomeriggio_printer <> 0
                   OR pomeriggio_lotto_entrate <> 0 OR pomeriggio_lotto_uscite <> 0
                   OR pomeriggio_fatture <> 0)
            THEN pomeriggio_lotto_entrate - pomeriggio_lotto_uscite
            ELSE mattina_lotto_entrate - mattina_lotto_uscite
        END
    ) STORED,

    notes TEXT DEFAULT '',
    chat_notes JSONB DEFAULT '[]'::jsonb,
    todos JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX idx_daily_logs_date ON public.daily_logs(date DESC);

-- =========================================================================
-- 2. STORICO: copie di sicurezza delle versioni precedenti
--
-- Serve a non perdere una chiusura già consolidata quando qualcuno la
-- modifica. La riga viva in daily_logs è sempre la versione più recente;
-- ogni copia archiviata prende il numero successivo in ordine di
-- archiviazione, partendo da 2.
-- =========================================================================
CREATE TABLE public.daily_logs_storico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    versione INTEGER NOT NULL,

    archiviato_il TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    -- Da quando era ferma la versione archiviata (il suo updated_at)
    ferma_dal TIMESTAMP WITH TIME ZONE,

    mattina_tabacchi NUMERIC(10,2),
    mattina_sisal NUMERIC(10,2),
    mattina_lis NUMERIC(10,2),
    mattina_printer NUMERIC(10,2),
    mattina_lotto_entrate NUMERIC(10,2),
    mattina_lotto_uscite NUMERIC(10,2),
    mattina_fatture NUMERIC(10,2),

    pomeriggio_tabacchi NUMERIC(10,2),
    pomeriggio_sisal NUMERIC(10,2),
    pomeriggio_lis NUMERIC(10,2),
    pomeriggio_printer NUMERIC(10,2),
    pomeriggio_lotto_entrate NUMERIC(10,2),
    pomeriggio_lotto_uscite NUMERIC(10,2),
    pomeriggio_fatture NUMERIC(10,2),

    totale_turno_mattina NUMERIC(12,2),
    totale_turno_pomeriggio NUMERIC(12,2),
    totale_giornata NUMERIC(12,2),

    notes TEXT,

    UNIQUE (date, versione)
);

CREATE INDEX idx_storico_date ON public.daily_logs_storico(date DESC, versione DESC);

-- =========================================================================
-- 3. TRIGGER DI ARCHIVIAZIONE
--
-- L'app salva in automatico mentre si digita, quindi archiviare a ogni
-- scrittura riempirebbe lo storico di righe inutili. Si archivia solo quando
-- si modifica una chiusura RIMASTA FERMA DA ALMENO 2 ORE: è il segnale che
-- non si sta più scrivendo, ma si sta cambiando un dato già consolidato.
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
    -- Interessano solo le modifiche agli importi: note, chat e task non contano
    IF (OLD.mattina_tabacchi, OLD.mattina_sisal, OLD.mattina_lis,
        OLD.mattina_printer, OLD.mattina_lotto_entrate, OLD.mattina_lotto_uscite,
        OLD.mattina_fatture,
        OLD.pomeriggio_tabacchi, OLD.pomeriggio_sisal, OLD.pomeriggio_lis,
        OLD.pomeriggio_printer, OLD.pomeriggio_lotto_entrate,
        OLD.pomeriggio_lotto_uscite, OLD.pomeriggio_fatture)
       IS DISTINCT FROM
       (NEW.mattina_tabacchi, NEW.mattina_sisal, NEW.mattina_lis,
        NEW.mattina_printer, NEW.mattina_lotto_entrate, NEW.mattina_lotto_uscite,
        NEW.mattina_fatture,
        NEW.pomeriggio_tabacchi, NEW.pomeriggio_sisal, NEW.pomeriggio_lis,
        NEW.pomeriggio_printer, NEW.pomeriggio_lotto_entrate,
        NEW.pomeriggio_lotto_uscite, NEW.pomeriggio_fatture)
    THEN
        IF OLD.updated_at < now() - INTERVAL '2 hours' THEN
            SELECT COALESCE(MAX(versione), 1) + 1
              INTO prossima_versione
              FROM public.daily_logs_storico
             WHERE date = OLD.date;

            INSERT INTO public.daily_logs_storico (
                date, versione, ferma_dal,
                mattina_tabacchi, mattina_sisal, mattina_lis, mattina_printer,
                mattina_lotto_entrate, mattina_lotto_uscite, mattina_fatture,
                pomeriggio_tabacchi, pomeriggio_sisal, pomeriggio_lis,
                pomeriggio_printer, pomeriggio_lotto_entrate,
                pomeriggio_lotto_uscite, pomeriggio_fatture,
                totale_turno_mattina, totale_turno_pomeriggio, totale_giornata,
                notes
            ) VALUES (
                OLD.date, prossima_versione, OLD.updated_at,
                OLD.mattina_tabacchi, OLD.mattina_sisal, OLD.mattina_lis,
                OLD.mattina_printer, OLD.mattina_lotto_entrate,
                OLD.mattina_lotto_uscite, OLD.mattina_fatture,
                OLD.pomeriggio_tabacchi, OLD.pomeriggio_sisal, OLD.pomeriggio_lis,
                OLD.pomeriggio_printer, OLD.pomeriggio_lotto_entrate,
                OLD.pomeriggio_lotto_uscite, OLD.pomeriggio_fatture,
                OLD.totale_turno_mattina, OLD.totale_turno_pomeriggio,
                OLD.totale_giornata,
                OLD.notes
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
-- 4. ROW LEVEL SECURITY
-- =========================================================================
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs_storico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lettura registri" ON public.daily_logs
    FOR SELECT USING (true);

CREATE POLICY "Inserimento e aggiornamento registri" ON public.daily_logs
    FOR ALL USING (true) WITH CHECK (true);

-- Lo storico è di sola lettura per l'app: lo scrive unicamente il trigger,
-- che gira come proprietario della tabella e non passa da queste policy.
-- Così una copia di sicurezza non può essere sovrascritta o cancellata.
CREATE POLICY "Lettura storico" ON public.daily_logs_storico
    FOR SELECT USING (true);
