/* Contratos de NOVA (NOVA-ENG-001 §04): la interfaz solo consume estado estructurado.
   Regla: si evidenceRefs está vacío, NOVA no puede hacer una afirmación de salud. */

export type Fuente = 'LIVE' | 'PUBLIC_DATA' | 'SIMULATED';

export type Evidencia = {
  id: string;
  rasgo: string;          // p. ej. 'RMSSD'
  valor: number;
  base: number;           // línea base personal
  delta: number;          // relativo a la base (−0.26 = 26 % bajo la base)
  unidad: string;
  fuente: Fuente;
};

export type EstadoModelo = 'normal' | 'elevated' | 'unknown';
export type Confianza = 'low' | 'moderate' | 'high';

export type Inferencia = {
  modelo: string;
  version: string;
  estado: EstadoModelo;
  confianza: Confianza;
  calidad: number;        // 0..1
  evidencia: Evidencia[];
  abstiene: boolean;
  motivo?: string;
  limites: string[];
};

export type EstadoNova = 'nominal' | 'attention' | 'uncertain' | 'review';

export type RespuestaNova = {
  estado: EstadoNova;
  mensaje: string;
  evidenceRefs: string[];
  accion: 'none' | 'monitor' | 'review';
  requiereHumano: boolean;
};
