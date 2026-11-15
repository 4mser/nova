/* Medical procedures in AR: every protocol in protocolos.json, step by step, on the person's own body.

   For each step Nova knows WHERE (a point on the fitted body: the CPR point, the outer mid-thigh for epinephrine, the
   upper arm above a wound, the AED pad sites...), WHAT TO WATCH (the rescuer's hands reaching that point, the timer,
   the live twin values) and WHEN TO SPEAK. Like a good instructor (HoloAssist, Wang et al. 2023): it confirms what is
   right, corrects what is wrong with short spatial words ("a little higher, toward the head"), and stays quiet
   otherwise. Timed steps branch on the live twin (the protocol's own recovery thresholds), so Nova decides the next
   step from the crew member's real values and says why.

   Everything a step shows comes from the protocol text; the AR only places it on the body. */

// where: torso points in the reference anatomy (m; x = the person's left, z = front), or limb points from landmarks
const T = (x, y, z) => ({ torso: [x, y, z] });
const L = (a, b, t, lado = 0) => ({ lm: [a, b, t, lado] }); // between landmarks a→b at t; lado: push sideways (outer side)
export const AR = {
  'paro_cardiaco/er': { modo: 'rcp', tecnica: 'er' },
  'paro_cardiaco/ritmo': { modo: 'rcp', tecnica: 'er' },
  'paro_cardiaco/cmrs': { modo: 'rcp', tecnica: 'hs' },
  'paro_cardiaco/dos_min': { modo: 'rcp' },
  'paro_cardiaco/dea': { puntos: [{ ...T(-.085, 1.335, .11), n: 'Pad 1', s: 'right, below the collarbone' }, { ...T(.135, 1.16, .06), n: 'Pad 2', s: 'left side, below the armpit' }], manos: true },
  'desmayo/responde': { puntos: [{ ...L(11, 12, .15), n: 'Tap here', s: 'shoulder · call the name' }] },
  'desmayo/respira': { puntos: [{ ...T(0, 1.32, .12), n: 'Watch the chest', s: 'look, listen, feel · 10 s' }], vitales: ['fr', 'spo2'] },
  'desmayo/asegurar': { puntos: [{ ...T(0, 1.05, .1), n: 'Restraint', s: 'secure the torso, loosen tight clothing' }] },
  'desmayo/medir': { puntos: [{ ...L(11, 13, .45, 1), n: 'Cuff', s: 'upper arm, 2 cm above the elbow crease' }], vitales: ['pa_sis', 'pulso'] },
  'desmayo/medir2': { puntos: [{ ...L(11, 13, .45, 1), n: 'Cuff', s: 'measure again' }], vitales: ['pa_sis', 'pulso'] },
  'hipoglucemia/azucar': { puntos: [{ ...L(9, 10, .5), n: '15 g fast sugar', s: 'juice pouch or glucose gel' }], vitales: ['glucosa'], kit: 'Glucose gel · drawer B' },
  'hipoglucemia/esperar': { vitales: ['glucosa', 'pulso'] },
  'hipoglucemia/repetir': { puntos: [{ ...L(9, 10, .5), n: 'Another 15 g', s: 'fast sugar' }], vitales: ['glucosa'] },
  'hipoglucemia/esperar2': { vitales: ['glucosa', 'pulso'] },
  'fiebre/reposo': { vitales: ['temp', 'pulso'] },
  'fiebre/medir': { puntos: [{ ...L(7, 8, 0, 0), n: 'Thermometer', s: 'ear or forehead' }], vitales: ['temp'] },
  'oxigeno_bajo/sensor': { puntos: [{ ...L(19, 15, 0), n: 'Finger sensor', s: 'snug, hand still and warm' }], vitales: ['spo2'] },
  'oxigeno_bajo/calma': { puntos: [{ ...T(0, 1.3, .12), n: 'Slow breathing', s: 'in 4 s · out 6 s' }], vitales: ['spo2', 'fr'] },
  'anafilaxia/signos': { puntos: [{ ...L(9, 10, .5), n: 'Face and throat', s: 'swelling? noisy breathing?' }], vitales: ['spo2', 'pa_sis'] },
  'anafilaxia/epi': { puntos: [{ ...L(23, 25, .5, 1), n: 'Epinephrine 0.5 mg IM', s: 'outer middle of the thigh' }], manos: true, kit: 'Epinephrine 1:1000 · drawer A' },
  'anafilaxia/apoyo': { vitales: ['spo2', 'pa_sis', 'fr'] },
  'anafilaxia/esperar': { vitales: ['spo2', 'pa_sis'] },
  'anafilaxia/repetir': { puntos: [{ ...L(24, 26, .5, 1), n: 'Second dose', s: 'other thigh, outer middle' }], manos: true },
  'anafilaxia/esperar2': { vitales: ['spo2', 'pa_sis'] },
  'atragantamiento/tos': { puntos: [{ ...L(9, 10, .5), n: 'Cough or sounds?', s: '' }] },
  'atragantamiento/abdominales': { puntos: [{ ...T(0, 1.12, .12), n: 'Fist here', s: 'above the navel, below the breastbone · in and up' }], manos: true, flecha: [0, .06, -.08] },
  'atragantamiento/espalda': { puntos: [{ ...T(0, 1.33, -.12), n: '5 back blows', s: 'between the shoulder blades', atras: true }], manos: true },
  'hemorragia/presion': { herida: true, manos: true },
  'hemorragia/mantener': { herida: true, manos: true, vitales: ['pulso', 'pa_sis'] },
  'hemorragia/torniquete': { herida: true, torniquete: true, manos: true },
  'convulsion/proteger': { zona: true },
  'convulsion/cronometro': { zona: true, cronometro: true, vitales: ['spo2'] },
  'convulsion/benzo': { kit: 'Benzodiazepine · per checklist', vitales: ['spo2'] },
  'convulsion/cronometro2': { cronometro: true, vitales: ['spo2', 'fr'] },
  'descompresion/sintomas': { puntos: [{ ...L(13, 13, 0), n: 'Joints', s: 'pain? tingling?' }, { ...L(25, 25, 0), n: '', s: '' }] },
  'descompresion/traje': { vitales: ['spo2'] },
};

const NOMBRE_VITAL = { pulso: ['Heart rate', 'bpm', 0], spo2: ['SpO₂', '%', 0], pa_sis: ['Systolic BP', 'mmHg', 0], fr: ['Breathing', '/min', 0], glucosa: ['Glucose', 'mg/dL', 0], temp: ['Temp', '°C', 1] };

/* the step machine: same graph as the station's emergency guide */
export class Procedimiento {
  constructor(protocolos, id, crew, decir, registrar) {
    this.p = protocolos.find(x => x.id === id); this.crew = crew; this.decir = decir; this.registrar = registrar;
    this.pasos = Object.fromEntries((this.p.guia || []).map(s => [s.id, s]));
    this.herida = null; this.tInicio = performance.now(); this.historial = [];
    this.ir((this.p.guia || [])[0]?.id);
  }
  texto(s) {
    const c = this.crew || {}, pr = (c.pronombre || 'they/them').split('/')[0];
    const su = pr === 'she' ? 'her' : pr === 'he' ? 'his' : 'their', el = pr === 'she' ? 'she' : pr === 'he' ? 'he' : 'they', lo = pr === 'she' ? 'her' : pr === 'he' ? 'him' : 'them';
    return (s || '').replace(/\{nombre\}/g, c.corto || 'them').replace(/\{Nombre\}/g, c.corto || 'They').replace(/\{su\}/g, su).replace(/\{el\}/g, el).replace(/\{lo\}/g, lo).replace(/\{El\}/g, el[0].toUpperCase() + el.slice(1));
  }
  get paso() { return this.pasos[this.id]; }
  get ar() { return AR[`${this.p.id}/${this.id}`] || {}; }
  ir(id) {
    if (!id || !this.pasos[id]) return;
    this.id = id; this.tPaso = performance.now(); this.bien = 0; this.mal = 0; this.dicho = '';
    const s = this.paso;
    this.historial.push(id);
    this.registrar(s.tipo === 'fin' ? 'fin' : 'paso', this.texto(s.texto), s.grave);
    this.decir(s.tipo === 'fin' ? `${this.texto(s.texto)} That concludes the procedure.` : this.texto(s.texto));
  }
  // answers: 'si' / 'no' for questions, 'hecho' for actions, auto for timers
  responder(r) {
    const s = this.paso; if (!s) return;
    if (s.tipo === 'pregunta') this.ir(r === 'si' ? s.si : s.no);
    else if (s.tipo === 'accion') this.ir(s.sig);
    else if (s.tipo === 'espera') this.cerrarEspera(r);
  }
  restante() { const s = this.paso; return s?.tipo === 'espera' ? Math.max(0, (s.seg || 0) - (performance.now() - this.tPaso) / 1000) : null; }
  // a timed step ends with Nova reading the twin against the protocol's own recovery thresholds
  cerrarEspera(forzado, vit) {
    const s = this.paso; if (!s || s.tipo !== 'espera') return;
    let ok = null, porque = '';
    if (s.recupera && vit) {
      ok = Object.entries(s.recupera).every(([k, [min, max]]) => vit[k] != null && vit[k] > 0 && (min == null || vit[k] >= min) && (max == null || vit[k] <= max));
      porque = Object.keys(s.recupera).map(k => `${(NOMBRE_VITAL[k] || [k])[0]} ${vit[k] != null ? vit[k].toFixed(NOMBRE_VITAL[k]?.[2] || 0) : '—'}`).join(', ');
    }
    if (forzado === 'mejor') ok = true; if (forzado === 'peor') ok = false;
    const sig = ok === false ? s.no_recupera : s.si_recupera;
    if (porque) this.registrar('decision', `${ok ? 'Recovered' : 'Not recovered'}: ${porque}`, !ok);
    this.ir(sig);
  }
  get fin() { return this.paso?.tipo === 'fin'; }
}

/* spatial words for a correction: the offset from the hands to the target, in the body's own frame */
export function corregir(dx, dy, ejeArriba) {
  // ejeArriba: unit 2D vector (screen) from hips to shoulders; dx,dy: target − hands (screen px)
  // across the body in the rescuer's own terms: what they see as left/right through the phone
  const up = ejeArriba; let lat = { x: -up.y, y: up.x }; if (lat.x < 0) lat = { x: -lat.x, y: -lat.y };
  const a = dx * up.x + dy * up.y, b = dx * lat.x + dy * lat.y, n = Math.hypot(a, b);
  const vert = Math.abs(a) > n * .4 ? (a > 0 ? 'toward the head' : 'toward the feet') : '';
  const lado = Math.abs(b) > n * .4 ? (b > 0 ? 'to your right' : 'to your left') : '';
  return [vert, lado].filter(Boolean).join(' and ');
}
export { NOMBRE_VITAL };
