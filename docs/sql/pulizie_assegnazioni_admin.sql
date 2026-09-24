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
