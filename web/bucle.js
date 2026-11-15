/* Ciclo de aprendizaje propuesto, simulado: cada noche NOVA (a bordo, sin conexión) arma un informe de 6 KB que cruza
   a la Tierra a la velocidad de la luz (3 a 22 min según la distancia), allá se reentrena, la validación y los cirujanos
   de vuelo aprueban o rechazan, y la versión nueva (38 MB) vuelve a la nave. Conjunción solar: el Sol corta el enlace
   unas dos semanas (cada ~26 meses) y NOVA sigue sola con los informes en cola. Error y tamaños: datos de demostración. */
(() => {
const sec = document.getElementById('aprende'); if (!sec) return;
const ES = document.documentElement.lang === 'es';
const $ = id => document.getElementById(id), cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, x) => a + (b - a) * x;
const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, eOut = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const h1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
const L = ES ? {
  zonaA: 'A BORDO · NOVA SIN CONEXIÓN', zonaB: 'TIERRA · CONTROL DE MISIÓN', crew: ['C1', 'C2', 'C3', 'C4'], red: 'MODELOS A BORDO', nave: 'NAVE', dsn: 'RED DEL ESPACIO PROFUNDO',
  gpu: 'ENTRENANDO', loss: 'ERROR DE VALIDACIÓN', cir: 'CIRUJANOS DE VUELO', rep: 'Informe nocturno', repS: '6 KB · sin audio ni nombres', upd: 'NOVA', updS: '38 MB · comprimida para la nave',
  cola: n => `${n} informes en cola`, sinEnlace: 'SIN ENLACE', luz: m => `${m} min luz`, tira: 'ERROR DE ALERTAS A BORDO · DEMO', noches: 'NOCHES', ok: 'instalada', no: 'sin cambio', mal: 'bloqueada', cq: 'en cola',
  m: {
    noche: 'La tripulación duerme. Yo sigo con el sueño, el corazón y la dosis de cada uno, aquí mismo, sin la Tierra.',
    baja: d => `El informe de esta noche va en camino: 6 KB, sin audio ni nombres. Llega a la Tierra en <b>${d} min</b>.`,
    entrena: 'En la Tierra, modelos más grandes aprenden del informe junto a la ciencia abierta de la NASA y las misiones análogas.',
    revisaOk: e => `La versión candidata baja el error a <b>${e}%</b> con datos que nunca vio. Los cirujanos de vuelo la aprueban.`,
    revisaNo: 'La candidata de esta noche no mejora lo que ya tengo. No viaja nada y sigo como estoy.',
    revisaMal: 'La validación detectó una actualización mala. Nunca sale de la Tierra y yo sigo con mi versión.',
    sube: (v, d) => `La <b>${v}</b> vuelve a la nave. Tarda <b>${d} min</b> en llegar.`,
    instala: (v, e) => `Ya soy la <b>${v}</b>. El error de alertas baja a <b>${e}%</b>.`,
    conj: q => `El Sol quedó entre la Tierra y nosotros: unas dos semanas sin enlace. Sigo funcionando igual. Informes en cola: <b>${q}</b>.`,
    conjFin: q => `Volvió el enlace. Mando los <b>${q}</b> informes que guardé.`,
  },
  pasos: ['A bordo', 'A la Tierra', 'Aprende', 'Revisión', 'De vuelta'],
} : {
  zonaA: 'ON BOARD · NOVA OFFLINE', zonaB: 'EARTH · MISSION CONTROL', crew: ['C1', 'C2', 'C3', 'C4'], red: 'ON-BOARD MODELS', nave: 'SHIP', dsn: 'DEEP SPACE NETWORK',
  gpu: 'TRAINING', loss: 'VALIDATION ERROR', cir: 'FLIGHT SURGEONS', rep: 'Nightly report', repS: '6 KB · no audio, no names', upd: 'NOVA', updS: '38 MB · compressed for the ship',
  cola: n => `${n} reports queued`, sinEnlace: 'NO LINK', luz: m => `${m} light-min`, tira: 'ON-BOARD ALERT ERROR · DEMO', noches: 'NIGHTS', ok: 'installed', no: 'no change', mal: 'blocked', cq: 'queued',
  m: {
    noche: "The crew is asleep. I keep watching everyone's sleep, heart and dose right here, without Earth.",
    baja: d => `Tonight's report is on its way: 6 KB, no audio, no names. It reaches Earth in <b>${d} min</b>.`,
    entrena: 'On Earth, bigger models learn from the report together with NASA open science and analog missions.',
    revisaOk: e => `The candidate brings error down to <b>${e}%</b> on data it never saw. Flight surgeons approve it.`,
    revisaNo: "Tonight's candidate is no better than what I have. Nothing flies, and I stay as I am.",
    revisaMal: 'Validation caught a bad update. It never leaves Earth, and I keep my version.',
    sube: (v, d) => `<b>${v}</b> is flying back to the ship. It takes <b>${d} min</b> to arrive.`,
    instala: (v, e) => `I'm <b>${v}</b> now. Alert error is down to <b>${e}%</b>.`,
    conj: q => `The Sun is between us and Earth: about two weeks with no link. I keep working the same. Reports queued: <b>${q}</b>.`,
    conjFin: q => `The link is back. Sending the <b>${q}</b> reports I kept.`,
  },
  pasos: ['On board', 'To Earth', 'Learns', 'Review', 'Back'],
};

const cv = $('lpCv'), c = cv.getContext('2d'), bPlay = $('lpPlay'), rDist = $('lpD'), bConj = $('lpConj'), bMal = $('lpMal');
const PISO = 3.0;                                   // error mínimo alcanzable (demo)
const S = { fase: 'noche', tf: 0, noche: 41, ver: 4, err: 11.8, cand: null, hist: [], conj: 0, cola: 0, malo: false, flash: -9, conjFin: false, paquete: 1 };
for (let i = 0; i < 30; i++){ const r = h1(i + 3) < .72 ? 'ok' : 'no'; S.hist.push({ r, e: 0 }); }
// error histórico que termina en el actual
(() => { let e = 17.5; S.hist.forEach(x => { if (x.r === 'ok') e = e - (e - PISO) * .045; x.e = e; }); const k = S.err / e; S.hist.forEach(x => x.e *= k); })();
let jugando = !reducido, W = 0, H = 0, DPR = 1, vivo = false, tp = 0, P = {}, tReal = 0;

const demora = () => +rDist.value;                                   // minutos luz, una vía
const tViaje = () => .9 + 2.6 * (demora() - 3) / 19;                 // segundos de pantalla
const DUR = { noche: 2.8, baja: 0, entrena: 3.8, revisa: 2.4, sube: 0, instala: 1.8, pausa: 1.1, cnoche: 1.0 };
const dur = f => f === 'baja' || f === 'sube' ? tViaje() : DUR[f];
const vStr = v => 'v1.' + v;

function medir(){
  DPR = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR;
  const vert = W < 640;
  if (!vert){
    const ax = W * .04, aw = W * .27, bx = W * .69, bw = W * .27;
    P = { vert, za: [ax, H * .05, aw], zb: [bx, H * .05, bw],
      crew: [0, 1, 2, 3].map(i => [ax + aw * (i + .5) / 4, H * .17]), red: [ax + aw * .08, H * .27, aw * .84, H * .15], nave: [ax + aw * .5, H * .55], A: [ax + aw * .5 + 34, H * .52],
      gpu: [bx, H * .11, bw, H * .12], loss: [bx, H * .28, bw, H * .09], cir: [0, 1, 2].map(i => [bx + bw * (.18 + i * .32), H * .45]),
      D: [bx + bw * .16, H * .58], tierra: [bx + bw * .68, H * .6, Math.min(32, W * .036)],
      c1: [W * .5, H * .2], c2: [W * .5, H * .78], sol: [W * .5, H * .08], solC: [W * .5, H * .48], tira: [W * .05, H * .74, W * .9, H * .2] };
  } else {
    P = { vert, za: [W * .05, H * .02, W * .9], zb: [W * .05, H * .43, W * .9],
      crew: [0, 1, 2, 3].map(i => [W * (.14 + i * .1), H * .085]), red: [W * .52, H * .05, W * .42, H * .08], nave: [W * .3, H * .22], A: [W * .3, H * .265],
      gpu: [W * .05, H * .52, W * .55, H * .07], loss: [W * .05, H * .62, W * .55, H * .06], cir: [0, 1, 2].map(i => [W * (.71 + i * .1), H * .56]),
      D: [W * .84, H * .45], tierra: [W * .82, H * .66, 18],
      c1: [W * .66, H * .26], c2: [W * .42, H * .47], sol: [W * .1, H * .34], solC: [W * .57, H * .36], tira: [W * .05, H * .76, W * .9, H * .19] };
  }
}
addEventListener('resize', () => { if (W) medir(); });

const ESTR = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .2, a: Math.random() * .6 + .15, p: Math.random() * 6 }));
const ruta = (p0, cc, p1, u) => [(1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * cc[0] + u * u * p1[0], (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * cc[1] + u * u * p1[1]];
const txt = (s, x, y, col = '#6a7787', al = 'left', f = '500 10.5px PM') => { c.font = f; c.fillStyle = col; c.textAlign = al; c.fillText(s, x, y); };
const glow = (x, y, r, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
const rrect = (x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

/* ── la máquina del ciclo ── */
function avanzar(dt){
  S.tf += dt; if (S.tf < dur(S.fase)) return;
  S.tf = 0; const f = S.fase;
  if (S.conj > 0 && (f === 'noche' || f === 'cnoche')){ S.cola++; S.noche++; S.hist.push({ r: 'cola', e: S.err }); S.conj--; S.fase = S.conj > 0 ? 'cnoche' : 'baja'; S.conjFin = S.conj === 0; S.paquete = S.cola; return; }
  if (f === 'noche'){ S.fase = 'baja'; S.paquete = 1; S.conjFin = false; }
  else if (f === 'baja'){ S.fase = 'entrena'; S.cola = 0;
    // la candidata: más datos ayudan, con rendimientos decrecientes; a veces no mejora
    const n = S.noche, gan = (S.err - PISO) * (.07 + .09 * h1(n * 1.7)) * Math.min(3, S.paquete ** .5), ruido = (h1(n * 2.3) - .62) * 1.1;
    S.cand = S.malo ? { e: S.err + 3.2 + h1(n) * 2, r: 'mal' } : (() => { const e = S.err - gan + Math.max(0, ruido); return { e, r: e < S.err - .05 ? 'ok' : 'no' }; })();
    S.malo = false; bMal.classList.remove('on'); }
  else if (f === 'entrena') S.fase = 'revisa';
  else if (f === 'revisa'){ if (S.cand.r === 'ok') S.fase = 'sube'; else { S.hist.push({ r: S.cand.r, e: S.err }); S.fase = 'pausa'; } }
  else if (f === 'sube') S.fase = 'instala';
  else if (f === 'instala'){ S.ver++; S.err = S.cand.e; S.flash = tReal; S.hist.push({ r: 'ok', e: S.err }); S.fase = 'pausa'; }
  else if (f === 'pausa'){ S.noche++; S.fase = S.conj > 0 ? 'cnoche' : 'noche'; }
  if (S.hist.length > 40) S.hist.shift();
}

/* ── dibujo ── */
function dibujar(t){
  c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  const f = S.fase, u = cl(S.tf / dur(f)), enConj = S.conj > 0 || f === 'cnoche';
  // estrellas
  for (const s of ESTR){ const tw = .6 + .4 * Math.sin(t * 1.3 + s.p); c.fillStyle = `rgba(200,225,245,${s.a * tw * .7})`; c.fillRect(s.x * W, s.y * H * .72, s.r, s.r); }
  // el Sol: arriba y lejos; en conjunción baja entre los dos y tapa el enlace
  const kc = S._kc = lerp(S._kc || 0, enConj ? 1 : 0, .05), so = [lerp(P.sol[0], P.solC[0], eIO(kc)), lerp(P.sol[1], P.solC[1], eIO(kc))];
  glow(so[0], so[1], lerp(P.vert ? 60 : 110, P.vert ? 120 : 190, kc), 'rgba(255,200,120,A)', .22 + .4 * kc);
  glow(so[0], so[1], lerp(10, 34, kc), 'rgba(255,240,210,A)', .9);
  if (kc > .3){ c.save(); c.globalAlpha = (kc - .3) / .7; for (let i = 0; i < 18; i++){ const a = i / 18 * 6.283 + t * .15, r0 = 30, r1 = 70 + 30 * Math.sin(t * 2 + i * 1.7);
      c.strokeStyle = 'rgba(255,190,110,.25)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(so[0] + Math.cos(a) * r0, so[1] + Math.sin(a) * r0); c.lineTo(so[0] + Math.cos(a) * r1, so[1] + Math.sin(a) * r1); c.stroke(); }
    txt(L.sinEnlace, so[0], so[1] + (P.vert ? 52 : 70), '#f2b457', 'center', '500 11px PM'); c.restore(); }

  // rutas de ida y vuelta
  c.setLineDash([3, 8]); c.lineWidth = 1.3;
  [[P.A, P.c1, P.D, 'rgba(143,230,245,.22)'], [P.D, P.c2, P.A, 'rgba(168,152,255,.22)']].forEach(([a, cc, b, col]) => { c.strokeStyle = enConj ? 'rgba(242,180,87,.12)' : col; c.beginPath(); for (let i = 0; i <= 50; i++){ const p = ruta(a, cc, b, i / 50); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke(); });
  c.setLineDash([]);

  // zonas
  txt(L.zonaA, P.za[0], P.za[1] + 10, '#8fe6f5'); txt(L.zonaB, P.zb[0], P.zb[1] + 10, '#c3b8ff');

  // tripulación durmiendo: pulso y zZ
  const dormidos = f === 'noche' || f === 'cnoche' || f === 'baja';
  P.crew.forEach(([x, y], i) => {
    const late = (t * 1.05 + i * .37) % 1, k = Math.exp(-late * 9);
    glow(x, y, 16, 'rgba(111,214,176,A)', .12 + .25 * k);
    c.strokeStyle = 'rgba(111,214,176,.8)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 9, 0, 7); c.stroke();
    c.fillStyle = `rgba(111,214,176,${.5 + .5 * k})`; c.beginPath(); c.arc(x, y, 3 + k * 1.5, 0, 7); c.fill();
    if (dormidos){ const z = (t * .5 + i * .25) % 1; txt('z', x + 9 + z * 8, y - 8 - z * 14, `rgba(200,225,245,${.6 * (1 - z)})`, 'left', `500 ${9 + z * 4}px SG`); }
    if (!P.vert) txt(L.crew[i], x, y + 24, '#5d6a7a', 'center', '500 9.5px PM');
  });

  // red a bordo: siempre infiriendo; al instalar se tiñe de violeta
  const [rx, ry, rw, rh] = P.red, capas = [4, 6, 6, 3], nodos = capas.map((n, j) => Array.from({ length: n }, (_, i) => P.vert ? [rx + rw * j / (capas.length - 1), ry + rh * (i + .5) / n] : [rx + rw * (i + .5) / n, ry + rh * j / (capas.length - 1)]));
  const fl = cl(1 - (tReal - S.flash) / 2.2), ins = f === 'instala' ? u : 0;
  for (let j = 0; j < capas.length - 1; j++) nodos[j].forEach((a, ia) => nodos[j + 1].forEach((b, ib) => {
    const sweep = ins > 0 ? cl(1 - Math.abs(ins * 1.3 - j / 3) * 3) : 0;
    c.strokeStyle = sweep > 0 || fl > 0 ? `rgba(195,184,255,${.08 + .5 * Math.max(sweep, fl * .6)})` : 'rgba(143,230,245,.08)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    const q = (t * .9 + h1(j * 31 + ia * 7 + ib)) % 1; if (h1(ia * 13 + ib * 5 + j) > .72){ const x = lerp(a[0], b[0], q), y = lerp(a[1], b[1], q); c.fillStyle = 'rgba(143,230,245,.75)'; c.fillRect(x - 1, y - 1, 2, 2); }
  }));
  nodos.flat().forEach(([x, y], i) => { const a = .5 + .5 * Math.sin(t * 3 + i); c.fillStyle = fl > 0 ? `rgba(195,184,255,${.6 + .4 * fl})` : `rgba(143,230,245,${.35 + .45 * a})`; c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); });
  if (!P.vert) txt(L.red, rx + rw / 2, ry + rh + 16, '#5d6a7a', 'center', '500 9.5px PM');
  // datos de la tripulación a la red
  if (dormidos) P.crew.forEach(([x, y], i) => { const dst = P.vert ? [rx, ry + rh * (i + .5) / 4] : nodos[0][i]; for (let k = 0; k < 2; k++){ const q = (t * .8 + i * .21 + k * .5) % 1; c.fillStyle = `rgba(111,214,176,${.7 * Math.sin(q * Math.PI)})`; c.beginPath(); c.arc(lerp(x, dst[0], q), lerp(y + 9, dst[1], q), 1.6, 0, 7); c.fill(); } });

  // la nave
  const [nx, ny] = P.nave; c.save(); c.translate(nx, ny); const sc = P.vert ? .8 : 1; c.scale(sc, sc);
  glow(0, 0, 46, 'rgba(70,200,232,A)', .14 + .2 * fl);
  c.fillStyle = '#121b26'; c.strokeStyle = 'rgba(143,230,245,.55)'; c.lineWidth = 1.2;
  [-1, 1].forEach(s => { rrect(s > 0 ? 18 : -58, -9, 40, 18, 2); c.fill(); c.stroke(); for (let k = 1; k < 4; k++){ c.beginPath(); c.moveTo((s > 0 ? 18 : -58) + k * 10, -9); c.lineTo((s > 0 ? 18 : -58) + k * 10, 9); c.stroke(); } });
  rrect(-18, -13, 36, 26, 9); c.fillStyle = '#1a2533'; c.fill(); c.stroke();
  c.fillStyle = fl > 0 ? '#c3b8ff' : '#8fe6f5'; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill();
  c.restore();
  // antena + el informe que se arma de noche
  const [ax, ay] = P.A; c.strokeStyle = '#c5cfdb'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(nx + (P.vert ? 0 : 18 * sc), ny + (P.vert ? 11 * sc : -6)); c.lineTo(ax, ay); c.stroke();
  c.fillStyle = '#c5cfdb'; c.beginPath(); c.arc(ax, ay, 3, 0, 7); c.fill();
  if (!P.vert) txt(L.nave + ' · ' + vStr(S.ver), nx, ny + 38, fl > 0 ? '#c3b8ff' : '#a9b5c3', 'center', '500 10.5px PM');
  if (f === 'noche' || enConj){ const k = f === 'noche' ? u : 1, bx = P.vert ? nx + 50 : nx - 40, by = P.vert ? ny - 6 : ny + 50;
    rrect(bx, by, 80, 6, 3); c.fillStyle = 'rgba(255,255,255,.07)'; c.fill(); rrect(bx, by, 80 * k, 6, 3); c.fillStyle = enConj ? '#f2b457' : '#8fe6f5'; c.fill();
    txt(enConj ? L.cola(S.cola) : '6 KB', bx, by + 18, enConj ? '#f2b457' : '#8fe6f5', 'left', '500 9.5px PM'); }

  // Tierra + antena de la red del espacio profundo
  const [tx, ty, tr] = P.tierra; glow(tx, ty, tr * 2.4, 'rgba(70,200,232,A)', .22);
  let g = c.createRadialGradient(tx - tr * .35, ty - tr * .35, 0, tx, ty, tr); g.addColorStop(0, '#9fe9f7'); g.addColorStop(.55, '#1f7fa3'); g.addColorStop(1, '#06283a'); c.fillStyle = g; c.beginPath(); c.arc(tx, ty, tr, 0, 7); c.fill();
  c.save(); c.beginPath(); c.arc(tx, ty, tr, 0, 7); c.clip(); c.fillStyle = 'rgba(111,214,176,.35)'; for (let k = 0; k < 5; k++){ const a = t * .25 + k * 1.3; c.beginPath(); c.ellipse(tx + Math.cos(a) * tr * .6, ty + (h1(k) - .5) * tr, tr * .3, tr * .16, 0, 0, 7); if (Math.cos(a) > -.2) c.fill(); } c.restore();
  const [dx, dy] = P.D, apunta = Math.atan2(P.A[1] - dy, P.A[0] - dx);
  c.save(); c.translate(dx, dy + 14); c.strokeStyle = '#c5cfdb'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 12); c.moveTo(-8, 12); c.lineTo(8, 12); c.stroke(); c.restore();
  c.save(); c.translate(dx, dy); c.rotate(apunta + Math.PI / 2); c.strokeStyle = '#c5cfdb'; c.lineWidth = 1.8; c.beginPath(); c.arc(0, 8, 14, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); c.beginPath(); c.moveTo(0, -4); c.lineTo(0, -14); c.stroke(); c.restore();
  if (!enConj) for (let k = 0; k < 3; k++){ const q = (t * .55 + k / 3) % 1; c.strokeStyle = `rgba(143,230,245,${.35 * (1 - q)})`; c.lineWidth = 1; c.beginPath(); c.arc(dx, dy, 6 + q * 26, 0, 7); c.stroke(); }
  if (!P.vert) txt(L.dsn, dx, dy + 44, '#5d6a7a', 'center', '500 9.5px PM');

  // racimo de entrenamiento
  const [gx, gy, gw, gh] = P.gpu, C = P.vert ? 12 : 10, R = 4, ent = f === 'entrena';
  for (let r = 0; r < R; r++) for (let k = 0; k < C; k++){ const w = gw / C, hh = gh / R, on = ent ? Math.max(0, Math.sin(t * 6 - k * .6 + r * 1.1)) : 0;
    rrect(gx + k * w + 1.5, gy + r * hh + 1.5, w - 3, hh - 3, 3); c.fillStyle = on > .55 ? `rgba(168,152,255,${.35 + .65 * on})` : 'rgba(255,255,255,.05)'; c.fill(); }
  txt(L.gpu, gx, gy - 6, ent ? '#c3b8ff' : '#5d6a7a', 'left', '500 9.5px PM');
  // curva de error de validación
  const [lx, ly, lw, lh] = P.loss, kl = f === 'entrena' ? u : (['revisa', 'sube', 'instala'].includes(f) ? 1 : (f === 'pausa' ? 1 - u : 0));
  c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.beginPath(); c.moveTo(lx, ly + lh); c.lineTo(lx + lw, ly + lh); c.stroke();
  if (kl > 0 && S.cand){ const mal = S.cand.r === 'mal', col = mal ? '#e2589b' : '#a898ff'; c.strokeStyle = col; c.lineWidth = 1.8; c.beginPath();
    const N = Math.max(2, Math.floor(60 * (f === 'entrena' ? u : 1)));
    for (let i = 0; i <= N; i++){ const q = i / 60, base = mal ? .25 + .5 * Math.exp(-q * 4) + q * .55 : .1 + .85 * Math.exp(-q * 3.4); const y = ly + lh * (1 - cl(base + (h1(i + S.noche) - .5) * .12 * (1 - q))); i ? c.lineTo(lx + lw * q, y) : c.moveTo(lx + lw * q, y); }
    c.globalAlpha = f === 'pausa' ? 1 - u : 1; c.stroke(); c.globalAlpha = 1; }
  txt(L.loss, lx, ly - 4, '#5d6a7a', 'left', '500 9.5px PM');
  // cirujanos de vuelo
  P.cir.forEach(([x, y], i) => { const rev = f === 'revisa', k = rev ? cl((u - .15 - i * .22) / .18) : (['sube', 'instala'].includes(f) ? 1 : (f === 'pausa' && S.cand && S.cand.r !== 'ok' ? 1 - u : 0));
    const res = S.cand ? S.cand.r : 'ok', col = res === 'ok' ? '#6fd6b0' : (res === 'mal' ? '#e2589b' : '#f2b457');
    c.strokeStyle = k > 0 ? col : 'rgba(150,185,215,.25)'; c.lineWidth = 1.4; c.beginPath(); c.arc(x, y - 4, 5, 0, 7); c.stroke(); c.beginPath(); c.arc(x, y + 11, 9, Math.PI, 0); c.stroke();
    if (k > 0){ c.save(); c.globalAlpha = k; c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); if (res === 'ok'){ c.moveTo(x + 8, y - 10); c.lineTo(x + 11, y - 7); c.lineTo(x + 17, y - 14); } else { c.moveTo(x + 8, y - 14); c.lineTo(x + 16, y - 6); c.moveTo(x + 16, y - 14); c.lineTo(x + 8, y - 6); } c.stroke(); c.restore(); } });
  if (!P.vert) txt(L.cir, (P.cir[0][0] + P.cir[2][0]) / 2, P.cir[0][1] + 30, '#5d6a7a', 'center', '500 9.5px PM');

  // paquetes viajando a la velocidad de la luz
  const viaje = (a, cc, b, k, col, t1, t2) => {
    const q = eIO(k), p = ruta(a, cc, b, q);
    for (let i = 1; i <= 16; i++){ const pp = ruta(a, cc, b, Math.max(0, q - i * .012)); c.fillStyle = col.replace('A', (.5 * (1 - i / 16)).toFixed(3)); c.beginPath(); c.arc(pp[0], pp[1], 3.4 * (1 - i / 18), 0, 7); c.fill(); }
    glow(p[0], p[1], 20, col, .55); c.fillStyle = '#fff'; c.beginPath(); c.arc(p[0], p[1], 3.4, 0, 7); c.fill();
    const op = Math.min(1, k * 6, (1 - k) * 6); c.save(); c.globalAlpha = op;
    const bw = P.vert ? 150 : 178, bx = cl(p[0] - bw / 2, 6, W - bw - 6), by = p[1] - 50;
    rrect(bx, by, bw, 38, 11); c.fillStyle = 'rgba(12,19,27,.92)'; c.fill(); c.strokeStyle = col.replace('A', .55); c.lineWidth = 1; c.stroke();
    txt(t1, bx + 12, by + 16, '#e8eef5', 'left', '600 12.5px SG'); txt(t2, bx + 12, by + 30, col.replace('A', 1), 'left', '500 9.5px PM');
    txt(L.luz((demora() * q).toFixed(1)), bx + bw - 10, by + 16, '#6a7787', 'right', '500 9.5px PM'); c.restore();
  };
  if (f === 'baja') viaje(P.A, P.c1, P.D, u, 'rgba(143,230,245,A)', S.paquete > 1 ? `${S.paquete} × ${L.rep.toLowerCase()}` : L.rep, S.paquete > 1 ? `${S.paquete * 6} KB` : L.repS);
  if (f === 'sube') viaje(P.D, P.c2, P.A, u, 'rgba(168,152,255,A)', `${L.upd} ${vStr(S.ver + 1)}`, L.updS);
  // el informe rebota contra el Sol durante la conjunción
  if (enConj){ const q = (t * .6) % 1, p = ruta(P.A, P.c1, P.D, q * .42); glow(p[0], p[1], 10, 'rgba(242,180,87,A)', .5 * (1 - q)); }

  // tira: noche a noche
  const [sx, sy, sw, sh] = P.tira, N = P.vert ? 20 : 32, hs = S.hist.slice(-N), cw = sw / N;
  c.strokeStyle = 'rgba(150,185,215,.12)'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + sw, sy); c.stroke();
  txt(L.tira, sx, sy + 16, '#6a7787'); txt(S.err.toFixed(1) + '%', sx + sw, sy + 16, '#e8eef5', 'right', '500 12px PM');
  const eMin = Math.min(...hs.map(x => x.e)) - .4, eMax = Math.max(...hs.map(x => x.e)) + .4, ey = e => sy + 30 + (sh - 54) * (1 - cl((e - eMin) / (eMax - eMin)));
  c.strokeStyle = '#a898ff'; c.lineWidth = 2; c.beginPath(); hs.forEach((x, i) => { const X = sx + cw * (i + .5), Y = ey(x.e); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke();
  hs.forEach((x, i) => { const X = sx + cw * (i + .5), col = { ok: '#6fd6b0', no: '#6a7787', mal: '#e2589b', cola: '#f2b457' }[x.r];
    c.fillStyle = col; c.beginPath(); c.arc(X, sy + sh - 12, x.r === 'ok' ? 3.4 : 2.6, 0, 7); c.fill(); });
  if (!P.vert){ let lx2 = sx + sw; [['cola', L.cq], ['mal', L.mal], ['no', L.no], ['ok', L.ok]].forEach(([k, s]) => { c.font = '500 9.5px PM'; const w = c.measureText(s).width; lx2 -= w; txt(s, lx2, sy + sh + 6, '#6a7787'); lx2 -= 10; c.fillStyle = { ok: '#6fd6b0', no: '#6a7787', mal: '#e2589b', cola: '#f2b457' }[k]; c.beginPath(); c.arc(lx2 + 3, sy + sh + 3, 3, 0, 7); c.fill(); lx2 -= 16; });
    txt(L.noches + ' ' + (S.noche - hs.length + 1) + '–' + S.noche, sx, sy + sh + 6, '#5d6a7a'); }
}

/* ── panel ── */
const pesos = { normal: 1, feliz: 0, sorprendida: 0, pensativa: 0, dormida: 0 }; let tpN = 0;
function panel(t){
  const f = S.fase, enConj = S.conj > 0 || f === 'cnoche';
  $('lpNoche').textContent = S.noche; const v = $('lpVer'); if (v.textContent !== vStr(S.ver)){ v.textContent = vStr(S.ver); v.classList.remove('nuevo'); void v.offsetWidth; v.classList.add('nuevo'); }
  $('lpDel').textContent = demora().toFixed(1).replace(/\.0$/, '') + ' min';
  const paso = enConj ? 0 : { noche: 0, baja: 1, entrena: 2, revisa: 3, sube: 4, instala: 4, pausa: S.cand && S.cand.r !== 'ok' ? 3 : 4 }[f];
  [...$('lpPasos').children].forEach((li, i) => { li.classList.toggle('on', i === paso); li.classList.toggle('hecho', i < paso); li.classList.toggle('alto', i === 3 && paso === 3 && S.cand && (f === 'pausa' || (f === 'revisa' && S.tf > 1.2)) && S.cand.r !== 'ok'); });
  const M = L.m, d = demora().toFixed(1).replace(/\.0$/, ''); let m, ex = 'normal';
  if (enConj){ m = M.conj(S.cola); ex = 'pensativa'; }
  else if (f === 'noche'){ m = M.noche; ex = 'dormida'; }
  else if (f === 'baja'){ m = S.conjFin ? M.conjFin(S.paquete) : M.baja(d); }
  else if (f === 'entrena') m = M.entrena;
  else if (f === 'revisa' || (f === 'pausa' && S.cand && S.cand.r !== 'ok')){ const r = S.cand.r; m = r === 'ok' ? M.revisaOk(S.cand.e.toFixed(1)) : r === 'mal' ? M.revisaMal : M.revisaNo; ex = r === 'ok' ? 'feliz' : r === 'mal' ? 'sorprendida' : 'pensativa'; }
  else if (f === 'sube') m = M.sube(vStr(S.ver + 1), d);
  else { m = M.instala(vStr(S.ver), S.err.toFixed(1)); ex = 'feliz'; }
  const el = $('lpMsg'); if (el.dataset.m !== m){ el.dataset.m = m; el.innerHTML = m; }
  const dt = Math.min(.05, Math.max(0, t - tpN)); tpN = t; const k = 1 - Math.exp(-dt * 5); for (const e in pesos){ pesos[e] += ((e === ex ? 1 : 0) - pesos[e]) * k; pesos[e] = Math.max(1e-3, pesos[e]); }
  const dom = Object.keys(pesos).reduce((a, b) => pesos[a] > pesos[b] ? a : b);
  $('lpNova').innerHTML = mascotaOrbes({ x: 30, y: 31, R: 18, t, expr: dom, pesos, orbes: 3, sinHalo: true });
  bConj.classList.toggle('on', enConj); bConj.disabled = enConj;
}

/* ── controles ── */
bPlay.addEventListener('click', () => { jugando = !jugando; bPlay.classList.toggle('on', jugando); });
bConj.addEventListener('click', () => { if (S.conj > 0) return; S.conj = 14;
  // lo que ya viene de vuelta termina de llegar; todo lo demás se corta y empiezan las noches en cola
  if (S.fase === 'sube' || S.fase === 'instala') return; S.cola = S.fase === 'baja' ? S.paquete : 0; S.fase = 'cnoche'; S.tf = 0;
  if (!jugando){ jugando = true; bPlay.classList.add('on'); } });
bMal.addEventListener('click', () => { S.malo = !S.malo; bMal.classList.toggle('on', S.malo); if (!jugando){ jugando = true; bPlay.classList.add('on'); } });

new IntersectionObserver(es => es.forEach(e => { vivo = e.isIntersecting; if (vivo && !W) medir(); }), { rootMargin: '100px' }).observe(sec);
bPlay.classList.toggle('on', jugando);
function cuadro(ms){ requestAnimationFrame(cuadro); if (!vivo) return; const now = ms / 1000, dt = Math.min(.05, tp ? now - tp : 0); tp = now; tReal = now;
  if (jugando) avanzar(dt);
  if (!W) medir(); dibujar(now); panel(now); }
requestAnimationFrame(cuadro);
})();
