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
