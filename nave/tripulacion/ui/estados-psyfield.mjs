/* PSYFIELD · perfiles de estado del cerebro 3D.
 * Son presets de visualización CONCEPTUAL. No se ajustaron a EEG, fMRI ni a
 * ningún registro: representan la idea de que un estado reorganiza la
 * actividad (intensidad, ritmo, sincronía, alcance de las conexiones).
 * Orden regional: frontal, parietal, occipital, temporal, cerebelo, tronco. */
export const REGIONES=['frontal','parietal','occipital','temporal','cerebelo','tronco'];
export const PROFILES={
 basal:     {weights:[.40,.42,.38,.36,.20,.20],rate:2.0,sync:.35,mode:0,links:40, cross:.25},
 foco:      {weights:[.88,.58,.34,.30,.18,.18],rate:2.7,sync:.62,mode:0,links:58, cross:.32},
 estres:    {weights:[.72,.48,.42,.82,.30,.62],rate:4.9,sync:.14,mode:0,links:112,cross:.72},
 fatiga:    {weights:[.24,.26,.22,.24,.14,.22],rate:1.0,sync:.72,mode:0,links:16, cross:.10},
 calma:     {weights:[.34,.40,.40,.34,.20,.30],rate:1.3,sync:.82,mode:0,links:30, cross:.20},
 activacion:{weights:[.86,.86,.82,.86,.40,.52],rate:6.2,sync:.10,mode:0,links:140,cross:.86},
};
export function regionWeight(p,point){return p.weights[REGIONES.indexOf(point.lob)]??.2;}
export function activityAt(p,n,t){const q=n.x*2.1+n.y*3.7+n.z*4.3;
 const irregular=.5+.5*Math.sin(t*p.rate+q*8+Math.sin(t*.73+q));
 const coherent=.5+.5*Math.sin(t*p.rate+n.z*2);
 return regionWeight(p,n)*(.22+.78*(irregular*(1-p.sync)+coherent*p.sync));
}
