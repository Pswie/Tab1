-- =========================================================================
-- SCHEMA SUPABASE: TABACCHERIA GESTIONE INCASSI GIORNALIERI
-- Executalo nell'SQL Editor del tuo progetto Supabase
-- =========================================================================

-- 1. Creazione Tabella daily_logs
CREATE TABLE IF NOT EXISTS public.daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIMEZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID,
    
    -- Voci Entrate
    tabacchi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    sisal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lis NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    printer NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    
    -- Movimenti Lotto
    lotto_entrate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_uscite NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lotto_aggio NUMERIC(10,2) GENERATED ALWAYS AS (lotto_entrate * 0.08) STORED,
    lotto_netto NUMERIC(10,2) GENERATED ALWAYS AS (lotto_entrate - lotto_uscite) STORED,
    
    -- Uscite e Fatture
    fatture NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    
    -- Totale Giornata Calcolato
    totale_giornata NUMERIC(10,2) GENERATED ALWAYS AS (
        (tabacchi + sisal + lis + printer + (lotto_entrate - lotto_uscite)) - fatture
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
CREATE POLICY "Permetti lettura registri recenti" ON public.daily_logs
    FOR SELECT USING (true);

CREATE POLICY "Permetti inserimento e aggiornamento registri" ON public.daily_logs
    FOR ALL USING (true) WITH CHECK (true);
