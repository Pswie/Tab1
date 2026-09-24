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
