/* Plantillas de listas (nombre, ícono y color) y el color de una lista por su ícono. */
import { C } from './tema';

export const PLANTILLAS = [
  { n: 'Groceries', i: 'cart-outline', c: '#6fd6b0' }, { n: 'Ideas', i: 'bulb-outline', c: '#f2b457' }, { n: 'Books', i: 'book-outline', c: '#a898ff' },
  { n: 'Movies and series', i: 'film-outline', c: '#ec6aa8' }, { n: 'Trip', i: 'airplane-outline', c: '#46c8e8' }, { n: 'Gifts', i: 'gift-outline', c: '#ff8a65' },
];
export const colorLista = (icono: string | null) => PLANTILLAS.find(p => p.i === icono)?.c ?? C.nova;
