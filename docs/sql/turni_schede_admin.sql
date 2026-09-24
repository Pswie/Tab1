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
