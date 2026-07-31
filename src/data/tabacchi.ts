/**
 * Catalogo dei tabacchi trattati, ricavato dalle fatture Logista di luglio 2026.
 *
 * I nomi sono ripuliti dei codici di confezionamento delle fatture
 * (*AST20*2A, *CART20, *20PZ...) che servono al fornitore ma non a chi conta
 * la merce sullo scaffale.
 */
export interface GruppoTabacchi {
  marca: string;
  categoria: 'sigarette' | 'elettronico' | 'sigari' | 'busta_scatola';
  prodotti: string[];
}

export const CATALOGO_TABACCHI: GruppoTabacchi[] = [
  // ------------------------------------------------------------------ SIGARETTE
  {
    marca: 'Marlboro',
    categoria: 'sigarette',
    prodotti: [
      'Marlboro KS',
      'Marlboro 100s',
      'Marlboro Gold KS',
      'Marlboro Gold 100s',
      'Marlboro Mix',
      'Marlboro Pocket Pack',
      'Marlboro Gold Pocket Pack',
      'Marlboro Crafted',
      'Marlboro Crafted Red',
      'Marlboro Crafted Red 100s',
      'Marlboro Crafted Gold KS',
      'Marlboro Crafted Gold 100s',
      'Marlboro Gold Touch KS',
      'Marlboro Gold Touch S-Line',
      'Marlboro Red Touch',
      'Marlboro Silver Touch S-Line',
      'Marlboro Advance Touch',
      'Marlboro Red Titanium Edition'
    ]
  },
  {
    marca: 'Winston',
    categoria: 'sigarette',
    prodotti: [
      'Winston Blue',
      'Winston Blue 100s',
      'Winston Blue Super Line',
      'Winston Red',
      'Winston Red 100s',
      'Winston Short Blue',
      'Winston Silver Super Line',
      'Winston White Super Line',
      'Winston Expand'
    ]
  },
  {
    marca: 'Rothmans',
    categoria: 'sigarette',
    prodotti: [
      'Rothmans of London Blue 20',
      'Rothmans of London Blue 100',
      'Rothmans of London Red 20',
      'Rothmans of London Red 100',
      'Rothmans of London Silver 20',
      'Rothmans of London White 100',
      'Rothmans of London D-Series',
      'Rothmans S-Series Blue',
      'Rothmans S-Series Silver',
      'Rothmans S-Series White',
      'Rothmans Sensora D-Series',
      'Rothmans Essence Blue KS'
    ]
  },
  {
    marca: 'Benson & Hedges',
    categoria: 'sigarette',
    prodotti: [
      'Benson & Hedges Blue',
      'Benson & Hedges Blue 100s',
      'Benson & Hedges Blue Super Slim',
      'Benson & Hedges Red',
      'Benson & Hedges Red 100s',
      'Benson & Hedges Yellow',
      'Benson & Hedges Yellow 100s',
      'Benson & Hedges Yellow Super Slim',
      'Benson & Hedges White'
    ]
  },
  {
    marca: 'Merit',
    categoria: 'sigarette',
    prodotti: ['Merit Bay KS', 'Merit Blu KS', 'Merit Gialla KS', 'Merit Gialla 100s', 'Merit SSL']
  },
  {
    marca: 'Philip Morris',
    categoria: 'sigarette',
    prodotti: [
      'Philip Morris Azure',
      'Philip Morris Blue',
      'Philip Morris Red',
      'Philip Morris SSL Blue',
      'Philip Morris Filter Kings 100s'
    ]
  },
  {
    marca: 'Chesterfield',
    categoria: 'sigarette',
    prodotti: [
      'Chesterfield Blue KS',
      'Chesterfield Blue 100s',
      'Chesterfield Original KS',
      'Chesterfield Original 100s',
      'Chesterfield Remix'
    ]
  },
  {
    marca: 'Diana',
    categoria: 'sigarette',
    prodotti: ['Diana Blu KS', 'Diana Blu 100s', 'Diana Rossa KS', 'Diana Rossa 100s', 'Diana SSL Blu']
  },
  {
    marca: 'The King',
    categoria: 'sigarette',
    prodotti: [
      'The King Blue',
      'The King Blue 100s',
      'The King Red',
      'The King Red 100s',
      'The King SSL Line Blue',
      'The King SSL Line White'
    ]
  },
  {
    marca: 'JPS',
    categoria: 'sigarette',
    prodotti: ['JPS Blue', 'JPS Blue Stream 100', 'JPS Red', 'JPS Red 100', 'JPS White', 'JPS SSL-Line Silver']
  },
  {
    marca: 'Camel',
    categoria: 'sigarette',
    prodotti: ['Camel Blue', 'Camel Yellow', 'Camel White', 'Camel Activate']
  },
  {
    marca: 'Lucky Strike',
    categoria: 'sigarette',
    prodotti: [
      'Lucky Strike Original',
      'Lucky Strike Amber',
      'Luckies Crafted 1871 Blue',
      'Luckies Crafted 1871 Red'
    ]
  },
  {
    marca: 'Dunhill',
    categoria: 'sigarette',
    prodotti: ['Dunhill Club', 'Dunhill Club Bianca', 'Dunhill MS Bionde']
  },
  {
    marca: 'Davidoff',
    categoria: 'sigarette',
    prodotti: ['Davidoff Classic', 'Davidoff Gold', 'Davidoff Gold Slim Line']
  },
  {
    marca: 'Muratti',
    categoria: 'sigarette',
    prodotti: ['Muratti Ambassador Blue KS', 'Muratti Red 100s']
  },
  {
    marca: 'West',
    categoria: 'sigarette',
    prodotti: ['West Original', 'West Original 100s', 'West Blue']
  },
  {
    marca: 'Altre sigarette',
    categoria: 'sigarette',
    prodotti: ['821 Blu', '821 Rossa', 'Linda Blu', 'Elixyr Blue', 'Vogue Classique Long Bleue']
  },

  // ----------------------------------------------------------------- TRINCIATI
  {
    marca: 'Trinciati',
    categoria: 'busta_scatola',
    prodotti: [
      'Marlboro Gold 30gr',
      'Marlboro Gold Touch Rolling 30gr',
      'Chesterfield Roll Your Own 30gr',
      'Chesterfield Blue 30gr',
      'Winston Blue 30gr',
      'Camel Blue 30gr',
      'Philip Morris Volume Tobacco 30gr',
      'Old Holborn Yellow 30gr',
      'Pueblo Classic 30gr',
      'Dover Blue 20gr'
    ]
  },

  // --------------------------------------------------------------------- STICK
  {
    marca: 'Terea',
    categoria: 'elettronico',
    prodotti: [
      'Terea Amber',
      'Terea Azure',
      'Terea Bronze',
      'Terea Cloud Fuse',
      'Terea Russet',
      'Terea Sienna',
      'Terea Silver',
      'Terea Teak',
      'Terea Turquoise'
    ]
  },
  {
    marca: 'Altri stick',
    categoria: 'elettronico',
    prodotti: [
      'Virto Sticks Blue Tobacco',
      'Virto Sticks Classic',
      'Virto Sticks Signature Tobacco',
      'Virto Sticks Silver',
      'Evo Amber',
      'Evo Silver',
      'Lucky Strike Sticks Balanced Tobacco',
      'Lucky Strike Sticks Gold Tobacco',
      'Lucky Strike Sticks Rich Tobacco',
      'ID Bronze Tobacco',
      'Delia Classic Gold',
      'Delia Classic Green',
      'Delia Classic Red',
      'Delia Classic Silver'
    ]
  },

  // -------------------------------------------------------------------- SIGARI
  {
    marca: 'Toscano',
    categoria: 'sigari',
    prodotti: [
      'Toscano Classico',
      'Toscano Originale',
      'Toscano Garibaldi',
      'Toscano Braccio Formato Robusto',
      'Toscanello',
      'Toscanello Rosso',
      'Toscanello Rosso Raffinato',
      'Toscanello Speciale',
      'Toscanello Castano Raffinato'
    ]
  },
  {
    marca: 'Ambasciator e Avanti',
    categoria: 'sigari',
    prodotti: [
      'Ambasciator Italico Sincero',
      'Ambasciator Italico Tradizionale',
      'Ambasciator Italico Amm. Classico',
      'Ambasciator Italico Bianco Stellato',
      'Avanti Ammezzato Classico Over',
      'Avanti Azzurro Stellato Over',
      'Avanti Lungo Tradizionale Over'
    ]
  },
  {
    marca: 'Altri sigari',
    categoria: 'sigari',
    prodotti: [
      'Pedroni London Memories',
      'Pedroni Mediterraneo',
      'Al Capone Filter',
      'Marlboro Leaf',
      'Marlboro Leaf Beyond',
      'Mini Moods Double Filter',
      'Rothmans of London Cigarillos',
      'Rothmans of London T. Leaf Roll'
    ]
  }
];

/** Etichette leggibili delle categorie */
export const ETICHETTE_CATEGORIA: Record<GruppoTabacchi['categoria'], string> = {
  sigarette: 'Sigarette',
  elettronico: 'Elettronico',
  sigari: 'Sigari',
  busta_scatola: 'Busta e scatola'
};

/** Ordine in cui compaiono le categorie nell'inventario */
export const ORDINE_CATEGORIE: Array<GruppoTabacchi['categoria']> = [
  'sigarette',
  'elettronico',
  'sigari',
  'busta_scatola'
];
