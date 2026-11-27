/* Tamaño de la figura 3D a partir del perfil personal: qué perfiles sirven, qué segmento va a qué medida del
   escáner y cómo se mezcla con lo que se ve en vivo. Solo cambia tamaños, nunca posición ni orientación de partida.
   El modelo anatómico es genérico y el perfil no es antropometría validada. Sin DOM: se prueba con node. */
import { VERSION, movimiento } from './angulos.mjs';

/* Cuánto puede separarse el largo usado del largo que se ve en vivo (fracción). Límite técnico, no validado:
   evita que un perfil ajeno o un cuadro raro despegue la anatomía de la imagen. */
export const TOLERANCIA = 0.15;
export const MIN_MUESTRAS = 15; // el mismo mínimo que exige Calibrador

/* Miembros de escaner.js (SEGMENTOS) y segmento del perfil con los mismos dos puntos. I = izquierda de la persona. */
export const SEGMENTO_PERFIL = {
  brazoI: 'brazo_izq', brazoD: 'brazo_der', antebrazoI: 'antebrazo_izq', antebrazoD: 'antebrazo_der',
  musloI: 'muslo_izq', musloD: 'muslo_der', piernaI: 'pierna_izq', piernaD: 'pierna_der',
};

/** { medidas, motivo }: medidas en metros, o null y el motivo (texto para la pantalla) si el perfil no se usa.
    hombros es la distancia entre los puntos 11 y 12, todavía sin el factor del escáner. */
export function medidasPerfil(perfil) {
  const no = motivo => ({ medidas: null, motivo });
  if (!perfil) return no('no hay perfil');
  if (perfil.version !== VERSION || !perfil.angulos || !perfil.segmentos) return no('el formato no es válido');
  if (!(perfil.muestras >= MIN_MUESTRAS)) return no(`tiene menos de ${MIN_MUESTRAS} cuadros`);
  if (movimiento(perfil)) return no('hubo movimiento durante esa calibración');
  const largo = k => perfil.segmentos[k]?.mediana_m;
  const medidas = {
    hombros: largo('ancho_hombros'), torso: largo('torso'),
    segmentos: Object.fromEntries(Object.entries(SEGMENTO_PERFIL).map(([g, k]) => [g, largo(k)])),
  };
  const todas = [medidas.hombros, medidas.torso, ...Object.values(medidas.segmentos)];
  if (!todas.every(v => Number.isFinite(v) && v > 0)) return no('le faltan largos de segmentos');
  return { medidas, motivo: null };
}

/** Largo a usar: el del perfil, sin alejarse más de la tolerancia del valor en vivo.
    Sin perfil (null o undefined) devuelve el valor en vivo; sin valor en vivo, el del perfil. */
export function mezclar(perfil, vivo, tolerancia = TOLERANCIA) {
  if (perfil == null) return vivo;
  if (vivo == null) return perfil;
  return Math.min(vivo * (1 + tolerancia), Math.max(vivo * (1 - tolerancia), perfil));
}
