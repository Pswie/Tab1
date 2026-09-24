-- Il filtro include anche autori disattivati o eliminati, senza leggere
-- l'elenco profili: il nome resta l'ultima fotografia presente nel registro.
CREATE OR REPLACE FUNCTION public.elenca_autori_modifiche_gestione()
RETURNS TABLE (id UUID, nome TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.e_amministratore() THEN
        RAISE EXCEPTION 'Solo un amministratore puo leggere gli autori del registro' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT autore.id, autore.nome
      FROM (
          SELECT DISTINCT ON (m.autore_id) m.autore_id AS id, m.autore_nome AS nome
            FROM private.modifiche_gestione m
           ORDER BY m.autore_id, m.id DESC
      ) autore
     ORDER BY LOWER(autore.nome), autore.id;
END;
$$;
REVOKE ALL ON FUNCTION public.elenca_autori_modifiche_gestione() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elenca_autori_modifiche_gestione() TO authenticated;
