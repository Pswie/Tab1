/**
 * Catalogo dei Gratta e Vinci trattati, raggruppato per taglio di prezzo come
 * negli ordini Lotterie Nazionali.
 *
 * `pezziPerPacco` viene dagli ordini stessi: un pacco vale 150 € nei tagli fino
 * a 3 € e 300 € dai 5 € in su, quindi il numero di biglietti cambia per taglio.
 * Serve a convertire in euro le differenze contate a magazzino.
 */
export interface GrattaEVinciGruppo {
  prezzo: number;
  pezziPerPacco: number;
  giochi: string[];
}

export const CATALOGO_GRATTA_E_VINCI: GrattaEVinciGruppo[] = [
  {
    prezzo: 1,
    pezziPerPacco: 150,
    giochi: ['Buondì']
  },
  {
    prezzo: 2,
    pezziPerPacco: 75,
    giochi: ['Fai Scopa New', "Viva l'Estate Mini"]
  },
  {
    prezzo: 3,
    pezziPerPacco: 50,
    giochi: ['Crucijolly', 'Numeri Fortunati New', 'Doppia Sfida Small']
  },
  {
    prezzo: 5,
    pezziPerPacco: 60,
    giochi: [
      'Doppia Sfida Classic',
      'Il Turista per Sempre',
      'Miliardario New',
      'Numerissimi',
      "Viva l'Estate",
      'Color Puzzle 5'
    ]
  },
  {
    prezzo: 10,
    pezziPerPacco: 30,
    giochi: [
      "Un'Estate al Mare Super",
      'New Bonus Tutto per Tutto',
      'Super Numerissimi',
      '50X New',
      'Mega Miliardario New'
    ]
  },
  {
    prezzo: 20,
    pezziPerPacco: 15,
    giochi: ['100X New', 'Ultra Numerissimi', 'Maxi Miliardario New']
  },
  {
    prezzo: 30,
    pezziPerPacco: 10,
    giochi: ['Milioni di Diamanti']
  }
];

/** Quanti pezzi contiene un pacco del taglio indicato */
export function pezziPerPacco(prezzo: number): number {
  return CATALOGO_GRATTA_E_VINCI.find(g => g.prezzo === prezzo)?.pezziPerPacco ?? 0;
}
