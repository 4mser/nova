/* Fichas médicas del gemelo: qué es cada región, qué le hace el espacio, cómo está hoy esta persona y qué hacer.
   Las cifras del espacio salen de la NASA (Human Research Program y hojas públicas); cada ficha nombra su fuente.
   El estado de hoy sale de los datos en vivo del núcleo o del modelo de a bordo (y lo dice). */
'use strict';

/* ejercicio cumplido en las últimas semanas (demo, tripulación ficticia) */
const GEM_EJ = { T1: .96, T2: .82, T3: .9, T4: .74 };

/* modelo de a bordo para el día d de la misión: hueso, músculo y columna (con o sin ejercicio) */
/* días en ingravidez y en Marte hasta el día d (ida, estadía en Marte con 0,38 g, regreso) */
function fasesHasta(d) {
  const tot = (typeof mision !== 'undefined' && mision && mision.total_dias) || 1018, tr = (mision && mision.transferencia_dias) || 259;
  const ida = Math.min(d, tr), marte = Math.max(0, Math.min(d, tot - tr) - tr), vuelta = Math.max(0, d - (tot - tr));
  return { micro: ida + vuelta, marte };
}
const MARTE_FACTOR = .4; // supuesto: en 0,38 g se pierde menos hueso; no hay datos humanos todavía

function modeloCuerpo(id, d, conEjercicio = true) {
  const ej = conEjercicio ? (GEM_EJ[id] ?? .9) : 0, f = fasesHasta(d), diasEq = f.micro + f.marte * MARTE_FACTOR;
  return {
    ej, enMarte: f.marte > 0,
    hueso: 1.25 * (1 - .5 * ej) * diasEq / 30.4,         // NASA: 1–1,5 %/mes sin ejercicio; el ejercicio lo corta a la mitad
    musculo: 20 * (1 - Math.exp(-diasEq / 120)) * (1 - .65 * ej), // NASA: hasta 20 % sin contramedidas
    columna: 3 * (1 - Math.exp(-d / 10)),                 // se estira en los primeros días y se queda
  };
}

const vivoGem = (tr, k, s = 30) => tr && tr.edades[k] > 0 && tr.edades[k] <= s;
const nivelDe = (tr, ...ks) => ks.reduce((a, k) => (tr && RANGO[tr.niveles[k]] > RANGO[a] ? tr.niveles[k] : a), 'sin_dato');

/* cada región: qué estructuras la forman (por nombre y sistema), su ficha y su estado */
const REGIONES = [
  {
    id: 'corazon', n: 'Heart', medir: 'pa',
    es: p => (p.system === 'cardiac' && !/ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|interventricular foramen|choroid/i.test(p.name)) || /coronary|cardiac vein|great cardiac|small cardiac|middle cardiac/i.test(p.name),
    funcion: 'Pumps about 5 liters of blood a minute to every organ.',
    espacio: 'Without gravity, about 2 liters of fluid move toward the head and the heart works less. Over months it gets rounder and can lose some muscle, and standing up after landing can cause fainting.',
    fuente: 'NASA Human Research Program · Risk of cardiovascular adaptations; NASA Twins Study (Circulation, 2021)',
    hoy(i, tr) {
      const fc = vivoGem(tr, 'pulso', 6) ? tr.pulso : null, pa = vivoGem(tr, 'pa_sis', 120) ? `${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}` : null;
      return { nivel: fc || pa ? (nivelDe(tr, 'pulso', 'pa_sis', 'pa_dia') === 'sin_dato' ? 'normal' : nivelDe(tr, 'pulso', 'pa_sis', 'pa_dia')) : 'sin_dato',
        valor: fc ? `${Math.round(fc)} bpm` : '—', texto: [fc ? `Heart rate ${Math.round(fc)} bpm, live` : 'Heart rate: waiting for the station', pa ? `blood pressure ${pa} mmHg` : 'no blood pressure yet', vivoGem(tr, 'vfc', 60) ? `variability ${Math.round(tr.vfc)} ms` : ''].filter(Boolean).join(' · '), vivo: true };
    },
    accion: 'Keep the daily aerobic session. Measure blood pressure seated, arm strapped at heart level. Before landing, fluid loading and a compression garment help prevent fainting.',
  },
  {
    id: 'pulmones', n: 'Lungs', medir: 'spo2',
    es: p => p.system === 'respiratory' && !/nasal|pharyn|epiglott|palatopharyngeus|stylopharyngeus|salpingo|concha|arytenoid|cricoid|thyroid cartilage|corniculate/i.test(p.name),
    funcion: 'Bring oxygen into the blood and take carbon dioxide out.',
    espacio: 'Lung function stays mostly normal in weightlessness. The risks come from the cabin: CO₂ that builds up in closed air causes headaches and slows thinking, and dust on the Moon or Mars irritates the airways.',
    fuente: 'NASA Human Research Program · Risk of adverse health effects due to host-microorganism interactions and celestial dust; ISS CO₂ studies',
    hoy(i, tr) {
      const s = vivoGem(tr, 'spo2', 6) ? tr.spo2 : null, f = vivoGem(tr, 'fr', 10) ? tr.fr : null, co2 = ultimo && ultimo.cabina.co2;
      return { nivel: s ? (nivelDe(tr, 'spo2', 'fr') === 'sin_dato' ? 'normal' : nivelDe(tr, 'spo2', 'fr')) : 'sin_dato', valor: s ? `${Math.round(s)}%` : '—',
        texto: [s ? `Oxygen ${Math.round(s)}%` : 'Oxygen: waiting', f ? `breathing ${Math.round(f)}/min` : '', co2 ? `cabin CO₂ ${Math.round(co2).toLocaleString('en-US')} ppm` : ''].filter(Boolean).join(' · '), vivo: true };
    },
    accion: 'If oxygen drops below 94% or breathing speeds up, measure again at rest and check the cabin CO₂. Keep the scrubbers on schedule.',
  },
  {
    id: 'cerebro', n: 'Brain',
    es: p => (p.system === 'nervous' && !/nerve|ganglion|spinal|cord|nasociliary|dura|chiasm/i.test(p.name)) || /ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|interventricular foramen|choroid plexus/i.test(p.name) || /^Allen_/.test(p.id || ''),
    funcion: 'Thinking, mood, sleep, balance and control of every other organ.',
    espacio: 'The brain shifts upward in the skull and the fluid spaces grow. Isolation, confinement and short sleep wear on mood and focus over long missions.',
    fuente: 'Roberts et al., NEJM 2017 (brain structure after spaceflight); NASA HRP · Risk of adverse cognitive or behavioral conditions',
    hoy(i, tr) {
      if (typeof estadoMente !== 'function') return { nivel: 'sin_dato', valor: '—', texto: 'Open Mind to read the state' };
      const e = estadoMente(i), nom = e.nombre || ESTADO_N[e.k];
      const niv = e.k === 'activacion' ? 'atencion' : e.k === 'estres' || e.k === 'fatiga' ? 'vigilar' : 'normal';
      return { nivel: niv, valor: nom, texto: e.por.slice(0, 2).join(' · '), vivo: true };
    },
    accion: 'Protect 7–8 hours of sleep, keep the private calls home, and do the weekly cognition test. Nova only shares check-ins the person allows.',
  },
  {
    id: 'ojos', n: 'Eyes',
    es: p => p.system === 'sensory' && /retina|sclera|cornea|lens|iris|vitreous|choroid|optic disc|macula|fovea|chamber of|pupil|ciliary|aqueous|conjunctiva|trabecular|schlemm|ora serrata|corona ciliaris/i.test(p.name) || /optic nerve/i.test(p.name),
    funcion: 'Vision. The optic nerve carries the image to the brain.',
    espacio: 'Pressure from the fluid shift can swell the optic disc and fold the back of the eye (SANS). NASA sees signs of it in about 70% of long-duration crews. It can blur near vision.',
    fuente: 'NASA HRP · Risk of spaceflight associated neuro-ocular syndrome (SANS)',
    // la última revisión de ojos del escáner (sistema Eyes: apertura, párpados, parpadeo; método de N. Richardson)
    hoy(i) {
      const id = (typeof CREW !== 'undefined' ? CREW : [])[i]?.id, r = id && window.ojosUltimas?.[id];
      if (!r) return { nivel: 'vigilar', valor: 'Not measured', texto: 'No eye check with the body scan yet · no OCT, fundus or ultrasound logged on this mission' };
      const dias = Math.floor((Date.now() - r.t) / 864e5), cuando = dias < 1 ? 'today' : dias === 1 ? 'yesterday' : `${dias} days ago`;
      const mm = ((r.A_R + r.A_L) / 2 * 11.7).toFixed(1);
      return { nivel: dias > 7 ? 'vigilar' : 'normal', valor: `${mm} mm`, texto: `Eye check ${cuando} · eye opening (est.)${r.parpadeos_min != null ? ` · ${r.parpadeos_min} blinks/min` : ''} · OCT still due`, vivo: dias < 1 };
    },
    accion: 'Weekly: the 20-second eye check in the body scan (Eyes), a near-vision chart, then OCT or eye ultrasound. Nova follows changes against each person\'s own baseline.',
  },
  {
    id: 'cuello', n: 'Neck veins',
    es: p => /jugular/i.test(p.name),
    funcion: 'Bring the blood back from the head to the heart.',
    espacio: 'Without gravity, blood slows down in the jugular vein in about half of crew members, women and men, and the first clots seen in flight formed there. NASA now checks every crewmember with an ultrasound.',
    fuente: 'Marshall-Goebel et al., JAMA Netw Open 2019 · NASA OCHMO-MTB-007 (2026)',
    hoy() { return { nivel: 'vigilar', valor: 'Scan due', texto: 'No jugular ultrasound logged on this mission yet' }; },
    accion: 'Jugular ultrasound on the NASA schedule. If the neck swells or hurts, tell the flight surgeon now. Hormonal methods with estrogen are noted for women.',
  },
  {
    id: 'cadera', n: 'Hip and thigh bones',
    es: p => p.system === 'skeletal' && /hip bone|ilium|ischium|pubis|femur|condyle|trochlear|intercondylar|epicondylar|perichondular|enthesis/i.test(p.name),
    funcion: 'Carry the body weight and anchor the strongest muscles.',
    espacio: 'Without weight on them, the hip and leg bones lose 1–1.5% of their density each month. Exercise on the resistance device cuts that about in half. Bone lost takes years to come back.',
    fuente: 'NASA HRP · Risk of early onset osteoporosis due to spaceflight',
    hoy(i, tr, d, con) { const m = modeloCuerpo(CREW[i].id, d, con); return { nivel: m.hueso > 6 ? 'atencion' : m.hueso > 2 ? 'vigilar' : 'normal', valor: `−${m.hueso.toFixed(1)}%`, texto: `Estimated density loss by day ${Math.round(d)} · exercise on plan ${Math.round(m.ej * 100)}%${m.enMarte ? ' · Mars gravity rate assumed' : ''}`, estimado: true }; },
    accion: 'Resistance training 6 days a week (squats and deadlifts), enough calcium and vitamin D. A scan before and after flight confirms the estimate.',
  },
  {
    id: 'columna', n: 'Spine',
    es: p => p.system === 'skeletal' && /vertebra|sacrum|coccyx|intervertebral/i.test(p.name),
    funcion: 'Holds the body upright and protects the spinal cord.',
    espacio: 'The discs swell without gravity and astronauts grow up to 3% taller. Back pain is common in the first weeks, and the risk of a herniated disc goes up after landing.',
    fuente: 'NASA HRP · Risk of intervertebral disc damage upon and immediately after re-exposure to gravity',
    hoy(i, tr, d, con) { const m = modeloCuerpo(CREW[i].id, d, con); return { nivel: 'normal', valor: `+${m.columna.toFixed(1)} cm`, texto: 'Estimated height gain · settles in the first weeks', estimado: true }; },
    accion: 'Core exercises and the knees-to-chest position ease the pain. After landing, avoid lifting and bending for the first days.',
  },
  {
    id: 'musculo', n: 'Leg muscles',
    es: p => /gastrocnemius|soleus|vastus|rectus femoris|quadriceps/i.test(p.name),
    funcion: 'Calves and thighs keep posture and push the body when walking.',
    espacio: 'Postural muscles shrink fastest. NASA reports up to 20% muscle loss on flights of only 5 to 11 days without exercise.',
    fuente: 'NASA · Muscle atrophy fact sheet; HRP · Risk of impaired performance due to reduced muscle mass, strength and endurance',
    hoy(i, tr, d, con) { const m = modeloCuerpo(CREW[i].id, d, con); return { nivel: m.musculo > 10 ? 'atencion' : m.musculo > 4 ? 'vigilar' : 'normal', valor: `−${m.musculo.toFixed(0)}%`, texto: `Estimated calf volume loss · exercise on plan ${Math.round(m.ej * 100)}%`, estimado: true }; },
    accion: 'Treadmill with harness and the resistance device, every day. Strength tests each month show if the plan is working.',
  },
  {
    id: 'rinones', n: 'Kidneys',
    es: p => p.system === 'urinary' && /kidney|renal|calyx|ureter|papilla|pyramid|cortex|hilum of kidney/i.test(p.name),
    funcion: 'Filter the blood and balance water and salts.',
    espacio: 'Calcium released by the bones and drinking less water raise the risk of kidney stones, which would be very hard to treat on the way to Mars.',
    fuente: 'NASA HRP · Risk of renal stone formation',
    hoy(i, tr, d, con) { const m = modeloCuerpo(CREW[i].id, d, con); return { nivel: m.hueso > 3 ? 'vigilar' : 'normal', valor: m.hueso > 3 ? 'Higher risk' : 'Usual risk', texto: 'Estimated from bone loss · no urine test logged', estimado: true }; },
    accion: 'Drink enough to pass at least 2 liters of urine a day. Sudden flank pain with blood in the urine goes to the flight surgeon.',
  },
  {
    id: 'piel', n: 'Skin and temperature', medir: 'temp',
    es: p => /^skin$/i.test(p.name) || /^VH_F_skin$/.test(p.id || ''),
    funcion: 'Protects the body, keeps the temperature and senses touch.',
    espacio: 'Skin gets thinner and drier, rashes are common and wounds heal more slowly. Body temperature runs a little higher in space.',
    fuente: 'NASA HRP · Risk of adverse health outcomes due to altered immune response; ESA Skin-B study',
    hoy(i, tr) { const t = vivoGem(tr, 'temp', 120) ? tr.temp : null; return { nivel: t ? (nivelDe(tr, 'temp') === 'sin_dato' ? 'normal' : nivelDe(tr, 'temp')) : 'sin_dato', valor: t ? `${t.toFixed(1)} °C` : '—', texto: t ? `Temperature ${t.toFixed(1)} °C, live` : 'Temperature: waiting', vivo: true }; },
    accion: 'Moisturize daily and check any wound every day. Fever over 38 °C opens the fever protocol.',
  },
];

/* últimas revisiones de ojos por tripulante (/v1/ojos), para la región Eyes */
(function leerOjos() {
  const base = typeof BASE !== 'undefined' ? BASE : '';
  fetch(base + '/v1/ojos', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (d) window.ojosUltimas = d.ultimas || {}; }).catch(() => {});
  setTimeout(leerOjos, 60000);
})();
