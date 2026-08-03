-- =========================================================================
-- PRODOTTI DEI DISTRIBUTORI H24
--
-- Da eseguire UNA VOLTA sull'editor SQL di Supabase, dopo supabase_schema.sql.
-- Serve solo a non dover scrivere a mano una trentina di prodotti: da qui in
-- poi l'elenco si tiene dall'app, dove si aggiunge, si sposta e si corregge.
--
-- SI PUÒ RIESEGUIRE SENZA FARE DANNI: ogni riga entra solo se quel prodotto
-- non c'è già in quella macchina, quindi non si creano doppioni e non si
-- tocca quello che nel frattempo è stato corretto.
--
-- I pezzi per pacco restano a 1: è il numero che cambia da fornitore a
-- fornitore e da confezione a confezione, e va messo dalla scheda del
-- prodotto nell'app (la matita accanto al nome). Finché resta 1, un pacco
-- vale un pezzo e i conti delle vendite sono prudenti, mai gonfiati.
-- =========================================================================

INSERT INTO public.h24_prodotti (nome, distributore)
SELECT v.nome, v.distributore
FROM (VALUES
    -- ---------------------------------------------------------------- SNACK
    ('Mems',                        'snack'),
    ('Mikado (entrambi)',           'snack'),
    ('Happy Hippo x3 (entrambi)',   'snack'),
    ('Tronki',                      'snack'),
    ('Kinder Bueno (entrambi)',     'snack'),
    ('Snickers',                    'snack'),
    ('Mars',                        'snack'),
    ('Biscotti all''amarena',       'snack'),
    ('Milkiss (o simile)',          'snack'),
    ('Nutella Kit (Nutella e grissini)', 'snack'),

    -- ---------------------------------------------------------------- DRINK
    ('Acqua naturale',              'drink'),
    ('Acqua frizzante',             'drink'),
    ('Coca Cola',                   'drink'),
    ('Coca Cola Zero',              'drink'),
    ('Red Bull',                    'drink'),
    ('Tennent''s',                  'drink'),
    ('Peroni',                      'drink'),
    ('Heineken',                    'drink'),
    ('Monster base',                'drink'),
    ('Monster Viking',              'drink'),
    ('Monster Valentino Rossi',     'drink'),
    ('Monster verde',               'drink'),
    ('Monster mango',               'drink'),
    ('Monster nuova',               'drink'),
    ('Thè San Benedetto pesca',     'drink'),
    ('Thè San Benedetto limone',    'drink'),
    ('Estathè limone',              'drink'),
    ('Estathè pesca',               'drink'),
    ('Energade arancia',            'drink'),
    ('Energade arancia rossa',      'drink'),
    ('Energade limone',             'drink')

    -- I prodotti della macchina 'vari' non ci sono ancora: si aggiungono
    -- dall'app quando si sa cosa ci va dentro.
) AS v(nome, distributore)
WHERE NOT EXISTS (
    SELECT 1
      FROM public.h24_prodotti p
     WHERE p.nome = v.nome
       AND p.distributore = v.distributore
);
