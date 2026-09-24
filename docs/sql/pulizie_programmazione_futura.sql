-- Programmazione pulizie corrente/futura e aggiunta del bagno del sabato.
-- Applicare dopo permessi_registro_gestione.sql, in un'unica transazione.
-- Nessuna riscrittura immediata: le checklist vengono preparate all'apertura.
-- Le settimane prima del 21 settembre 2026 mantengono il programma precedente.

CREATE OR REPLACE FUNCTION public.prepara_pulizie(p_settimana DATE, p_mese DATE)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_utente UUID := (SELECT auth.uid());
    v_oggi DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Rome')::DATE;
    v_settimana_corrente DATE := v_oggi - (EXTRACT(ISODOW FROM v_oggi)::INTEGER - 1);
    v_gruppo_uno_prima BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(20260824, 1901);
    IF v_utente IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.profili p WHERE p.id = v_utente AND p.accesso
    ) THEN
        RAISE EXCEPTION 'Accesso alle pulizie non consentito' USING ERRCODE = '42501';
    END IF;
    IF p_settimana IS NULL OR NOT isfinite(p_settimana) OR EXTRACT(ISODOW FROM p_settimana) <> 1
       OR p_mese IS NULL OR NOT isfinite(p_mese) OR EXTRACT(DAY FROM p_mese) <> 1 THEN
        RAISE EXCEPTION 'Periodo pulizie non valido' USING ERRCODE = '22023';
    END IF;
    -- La preparazione anticipata e' riservata a chi gestisce le pulizie.
    -- I permessi sono riletti dopo il lock condiviso con la loro revoca.
    IF (p_settimana > v_settimana_corrente OR p_mese > DATE_TRUNC('month', v_oggi)::DATE)
       AND NOT private.puo_gestire_pulizie(v_utente) THEN
        RAISE EXCEPTION 'Gestione pulizie non consentita per i periodi futuri' USING ERRCODE = '42501';
    END IF;
    v_gruppo_uno_prima := MOD(
        (EXTRACT(YEAR FROM p_mese)::INTEGER * 12 + EXTRACT(MONTH FROM p_mese)::INTEGER) - (2026 * 12 + 8), 2
    ) = 0;

    IF p_settimana >= (SELECT c.prima_settimana FROM public.pulizie_configurazione c WHERE c.id) THEN
        WITH voci(voce, ordine) AS (VALUES
            ('Lunedì', 1), ('Martedì', 2), ('Mercoledì', 3), ('Giovedì', 4), ('Venerdì', 5), ('Sabato', 6)
        )
        INSERT INTO public.pulizie_registro (
            tipo, voce, ordine, periodo_inizio, periodo_fine, prevista_il, responsabili, responsabili_profili
        )
        SELECT 'bagno', v.voce, v.ordine, p_settimana, p_settimana + 6, p_settimana + v.ordine - 1, a.nomi, a.profili
          FROM voci v CROSS JOIN LATERAL private.responsabili_pulizia_automatici(
              'bagno', p_settimana, NULL, NULL, p_settimana + v.ordine - 1
          ) a
         -- La decorrenza fissa preserva le settimane precedenti alla modifica.
         -- Il sabato resta da assegnare: nessuna responsabilita' viene inventata.
         WHERE v.ordine <> 6 OR p_settimana >= DATE '2026-09-21'
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

    IF p_mese >= (SELECT c.primo_mese FROM public.pulizie_configurazione c WHERE c.id) THEN
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
       OR v_prima.periodo_fine < v_oggi THEN
        RAISE EXCEPTION 'Puoi modificare solo una pulizia ancora da fare nel periodo corrente o futuro' USING ERRCODE = '22023';
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
REVOKE ALL ON FUNCTION private.modifica_pulizia_interno(UUID, UUID[], DATE, BOOLEAN, BOOLEAN)
    FROM PUBLIC, anon, authenticated;

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
           AND r.periodo_fine >= v_oggi
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
REVOKE ALL ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_incongruenze_pulizie(DATE, DATE) TO authenticated;
