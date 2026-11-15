/* HALO · video de presentación para NASA Space Apps 2026 (1920×1080, 30 fps). render(t) determinista.
   Paleta y UI de PSYFIELD; NOVA = la mascota de AURA en turquesa con orbes. Los nombres se cambian aquí: */
const NOMBRE_APP = 'NOVA', NOMBRE_IA = 'NOVA';
/* modo vertical (?v=1): la página muestra una ventana vertical del cuadro que sigue a la acción; aquí se reacomoda lo que no cabe */
let VERT = /[?&]v=1/.test(location.search);

const cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), pr = (t, a, d) => cl((t - a) / d);
const eOut = x => x === 1 ? 1 : 1 - Math.pow(2, -10 * x), eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const eBack = x => { const c = 1.3, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const eSpr = x => x >= 1 ? 1 : 1 - Math.exp(-7 * x) * (1 + 7 * x) * (1 - x * .02);
const lerp = (a, b, x) => a + (b - a) * x, E = id => document.getElementById(id);
const hsh = i => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
const vis = (el, on) => { el.style.display = on ? 'block' : 'none'; return on; };
const miles = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function fx(el, o = {}){ const { op = 1, x = 0, y = 0, s = 1, r = 0, b = 0 } = o;
  el.style.opacity = op; el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`; el.style.filter = b > .05 ? `blur(${b}px)` : ''; }
function palabras(el, t, t0, t1, gap = .07){ const on = t > t0 - .1 && t < t1 + .1; el.style.display = on ? 'block' : 'none'; if (!on) return;
  el.querySelectorAll('.w').forEach((w, i) => { const k = eOut(pr(t, t0 + i * gap, .8)), s = eIO(pr(t, t1 - .45, .45));
    w.style.opacity = k * (1 - s); w.style.transform = `translateY(${lerp(38, 0, k) - s * 16}px)`; w.style.filter = `blur(${lerp(12, 0, k) + s * 10}px)`; }); }
function escena(el, t, a, b, o = {}){ const on = t > a - .01 && t < b + .6; if (!vis(el, on)) return 0;
  const ke = eIO(pr(t, a, .7)), ks = eIO(pr(t, b, .6));
  fx(el, { op: ke * (1 - ks), s: lerp(o.s0 ?? .985, 1, eOut(pr(t, a, 1.2))) }); return ke * (1 - ks); }
const pop = (el, t, t0, d = .6, dy = 26) => { const k = pr(t, t0, d); fx(el, { op: eOut(k), y: lerp(dy, 0, eOut(k)), s: lerp(.85, 1, eBack(k)), b: lerp(8, 0, eOut(k)) }); return k; };

/* ── tiempos ── */
const S = {intro: 0, dist: 9.0, cuerpo: 18.12, nova: 29.84, reveal: 38.59, movilA: 45.67, checkin: 71.23, movilB: 83.97, crew: 101.95, cuerpoC: 109.97, gemelo: 119.43, menteC: 147.69, astro: 155.52, rad: 165.68, emerg: 174.38, escaner: 184.2, rcpg: 197.4, kit: 205.9, bib: 210.7, pron: 214.1, abordo: 220.9, ciclo: 230.0, modelos: 261.46, ciencia: 271.06, ruta: 282.02, cierre: 295.14};
S.movil = S.movilA;
const DUR = 301.675;
const V = [1.4, 9.6, 18.72, 30.44, 39.19, 46.27, 52.02, 61.82, 71.83, 84.57, 90.44, 102.55, 110.57, 120.03, 136.72, 148.29, 156.12, 166.28, 174.98, 184.8, 192.1, 198.0, 206.5, 214.7, 221.5, 230.6, 240.3, 251.8, 262.06, 271.66, 282.62, 295.74];
const VF = V.map((_, i) => i + 1);

/* ── fondo: estrellas fijas que derivan lento ── */
const cv = E('cv'), cx = cv.getContext('2d'); cv.width = 1920; cv.height = 1080;
const EST = Array.from({ length: 900 }, (_, i) => [hsh(i) * 1920, hsh(i + 1e3) * 1080, hsh(i + 2e3) < .94 ? .4 + hsh(i + 3e3) * .7 : 1 + hsh(i + 4e3), .15 + hsh(i + 5e3) * .5, hsh(i + 6e3) * 6.28]);
function fondo(t, alfa){
  cx.clearRect(0, 0, 1920, 1080); if (alfa <= 0) return;
  for (const [x, y, r, a, f] of EST){ const xx = (x - t * 6 * r + 1920 * 4) % 1920;
    cx.globalAlpha = alfa * a * (.7 + .3 * Math.sin(t * 1.3 + f)); cx.fillStyle = '#cfe6f5'; cx.beginPath(); cx.arc(xx, y, r, 0, 7); cx.fill(); }
  cx.globalAlpha = 1;
  E('fondo').style.setProperty('--fx', (62 + Math.sin(t * .11) * 8) + '%'); E('fondo').style.setProperty('--fy', (48 + Math.cos(t * .09) * 6) + '%');
}

/* ── HUD mínimo: esquinas, timecode, rótulo ── */
const hud = E('hud'), hx = hud.getContext('2d'); hud.width = 1920; hud.height = 1080;
function capaHud(t){
  hx.clearRect(0, 0, 1920, 1080); const a = pr(t, S.dist + .2, 1) * (1 - pr(t, S.movil - .6, .6)); if (a <= 0 || VERT) return;   // en vertical la ventana se mueve: las esquinas caerían sobre el texto
  hx.globalAlpha = a * .55; hx.strokeStyle = '#8fe6f5'; hx.lineWidth = 1.2; const m = 44, L = 26, x0 = VERT ? 625 : m, x1 = VERT ? 1295 : 1920 - m;
  [[x0, m, 1, 1], [x1, m, -1, 1], [x0, 1080 - m, 1, -1], [x1, 1080 - m, -1, -1]].forEach(([x, y, sx, sy]) => { hx.beginPath(); hx.moveTo(x + sx * L, y); hx.lineTo(x, y); hx.lineTo(x, y + sy * L); hx.stroke(); });
  if (VERT){ hx.globalAlpha = 1; return; }
  hx.font = '500 11px PM'; hx.fillStyle = '#8c99a9'; hx.globalAlpha = a * .7;
  const mm = Math.floor(t / 60), ss = (t % 60).toFixed(1).padStart(4, '0');
  hx.fillText(`T+ 0${mm}:${ss}`.split('').join(String.fromCharCode(8202)), m + 36, 1080 - m - 4);
  hx.textAlign = 'right'; hx.fillText(`${NOMBRE_APP} · SISTEMA DE SALUD DE LA TRIPULACIÓN · NASA SPACE APPS 2026`.split('').join(String.fromCharCode(8202)), 1920 - m - 36, 1080 - m - 4); hx.textAlign = 'left';
  hx.globalAlpha = 1;
}

/* ── 02: distancia Tierra → Marte ── */
let P0, PC, P2;
window.esVert = () => VERT;
function ponerVert(v){ VERT = v; P0 = VERT ? [700, 640] : [380, 600]; PC = VERT ? [960, 470] : [960, 400]; P2 = VERT ? [1220, 640] : [1540, 600];
  const st = document.getElementById('stage'); if (st) st.classList.toggle('vert', VERT);
  document.querySelectorAll('iframe').forEach(f => { try { f.contentDocument.documentElement.classList.toggle('vert', VERT); } catch (e) {} }); }
ponerVert(VERT);
const bz = u => [(1 - u) ** 2 * P0[0] + 2 * (1 - u) * u * PC[0] + u * u * P2[0], (1 - u) ** 2 * P0[1] + 2 * (1 - u) * u * PC[1] + u * u * P2[1]];
function distancia(t){
  const T = S.dist, k = pr(t, T + .5, 2.4), kc = eIO(k);
  let h = `<defs><radialGradient id="dT"><stop offset="0" stop-color="#8fe6f5"/><stop offset=".5" stop-color="#46c8e8"/><stop offset="1" stop-color="#0a4458"/></radialGradient>
    <radialGradient id="dM"><stop offset="0" stop-color="#ffd59a"/><stop offset=".55" stop-color="#f2b457"/><stop offset="1" stop-color="#7a3a1a"/></radialGradient>
    <radialGradient id="dH"><stop offset="0" stop-opacity=".45"/><stop offset="1" stop-opacity="0"/></radialGradient></defs>`;
  const pts = []; for (let i = 0; i <= 120; i++) pts.push(bz(i / 120));
  const d = 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L');
  h += `<path d="${d}" fill="none" stroke="rgba(150,185,215,.14)" stroke-width="1.5"/>`;
  h += `<path d="${d}" fill="none" stroke="url(#gL)" stroke-width="2.4" stroke-dasharray="1400" stroke-dashoffset="${1400 * (1 - kc)}"/>`;
  h += `<linearGradient id="gL" x1="${P0[0]}" x2="${P2[0]}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#46c8e8"/><stop offset=".6" stop-color="#9d8bff"/><stop offset="1" stop-color="#f2b457"/></linearGradient>`;
  const pe = pop1(t, T + .1), pm = pop1(t, T + .35);
  h += `<radialGradient id="hT"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset=".4" stop-color="#46c8e8" stop-opacity=".12"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient><radialGradient id="hM"><stop offset="0" stop-color="#f2b457" stop-opacity=".45"/><stop offset=".4" stop-color="#f2b457" stop-opacity=".1"/><stop offset="1" stop-color="#f2b457" stop-opacity="0"/></radialGradient>`;
  h += `<circle cx="${P0[0]}" cy="${P0[1]}" r="${150 * pe}" fill="url(#hT)"/><circle cx="${P0[0]}" cy="${P0[1]}" r="${34 * pe}" fill="url(#dT)"/>`;
  h += `<circle cx="${P2[0]}" cy="${P2[1]}" r="${120 * pm}" fill="url(#hM)"/><circle cx="${P2[0]}" cy="${P2[1]}" r="${22 * pm}" fill="url(#dM)"/>`;
  h += `<text x="${P0[0]}" y="${P0[1] + 72}" text-anchor="middle" font-family="PM" font-size="14" letter-spacing="4" fill="#8c99a9" opacity="${pe}">TIERRA</text><text x="${P2[0]}" y="${P2[1] + 72}" text-anchor="middle" font-family="PM" font-size="14" letter-spacing="4" fill="#8c99a9" opacity="${pm}">MARTE</text>`;
  if (k > 0 && k < 1){ const [x, y] = bz(kc); h += `<circle cx="${x}" cy="${y}" r="5" fill="#fff"/><circle cx="${x}" cy="${y}" r="14" fill="#8fe6f5" opacity=".35"/>`; }
  // mensaje que viaja a la velocidad de la luz (escena 2)
  const km = pr(t, T + 4.4, 2.9);
  if (km > 0){ const u = eIO(km), [x, y] = bz(u);
    for (let j = 0; j < 4; j++){ const uu = Math.max(0, u - j * .012), [a, b] = bz(uu); h += `<circle cx="${a}" cy="${b}" r="${5 - j}" fill="#8fe6f5" opacity="${(1 - j / 4) * (1 - pr(t, T + 7.1, .3))}"/>`; }
    const min = Math.floor(u * 22), seg = Math.floor((u * 22 - min) * 60);
    h += `<text x="${x}" y="${y - 26}" text-anchor="middle" font-family="PM" font-size="15" letter-spacing="3" fill="#8fe6f5" opacity="${1 - pr(t, T + 7.1, .3)}">T+ ${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}</text>`; }
  E('svDist').innerHTML = h;
  const kn = eOut(pr(t, T + .6, 2.2)); E('nDist').innerHTML = miles(225e6 * kn) + '<span style="font-size:44px;color:#8c99a9;letter-spacing:-.02em"> km</span>';
  fx(E('nDist'), { op: pr(t, T + .4, .5) * (1 - pr(t, T + 6.8, .5)), y: lerp(20, 0, eOut(pr(t, T + .4, .7))) }); fx(E('rDist'), { op: pr(t, T + .4, .5) * (1 - pr(t, T + 6.8, .5)) });
}
const pop1 = (t, a) => eBack(pr(t, a, .7));

/* ── 04: banda del wearable ── */
function banda(t){
  const T = S.reveal - 1.2, k = eOut(pr(t, T + .5, 1.6)), cxB = 960, cyB = 400, rx = 300 * (.6 + .4 * k), ry = 92 * (.6 + .4 * k), giro = Math.sin(t * .5) * .06;
  let h = `<defs><linearGradient id="bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2532"/><stop offset="1" stop-color="#0a1018"/></linearGradient>
    <linearGradient id="bf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0d151f"/><stop offset=".5" stop-color="#2a3a4c"/><stop offset="1" stop-color="#0d151f"/></linearGradient>
    <radialGradient id="bg"><stop offset="0" stop-color="#8fe6f5"/><stop offset=".4" stop-color="#46c8e8" stop-opacity=".6"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient>
    <filter id="bb"><feGaussianBlur stdDeviation="14"/></filter></defs><g opacity="${k}" transform="rotate(${giro * 57} ${cxB} ${cyB})">`;
  const arco = (a0, a1) => { let d = ''; for (let i = 0; i <= 60; i++){ const a = a0 + (a1 - a0) * i / 60; d += (i ? 'L' : 'M') + (cxB + Math.cos(a) * rx).toFixed(1) + ' ' + (cyB + Math.sin(a) * ry).toFixed(1); } return d; };
  h += `<ellipse cx="${cxB}" cy="${cyB}" rx="${rx}" ry="${ry}" fill="none" stroke="#46c8e8" stroke-width="40" opacity=".12" filter="url(#bb)"/>`;
  h += `<path d="${arco(Math.PI, Math.PI * 2)}" fill="none" stroke="url(#bk)" stroke-width="44" stroke-linecap="round"/>`;
  h += `<path d="${arco(Math.PI, Math.PI * 2)}" fill="none" stroke="#46c8e8" stroke-width="2" opacity=".35" transform="translate(0 20)"/>`;
  h += `<path d="${arco(0, Math.PI)}" fill="none" stroke="url(#bf)" stroke-width="50" stroke-linecap="round"/>`;
  h += `<path d="${arco(.15, Math.PI - .15)}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5" transform="translate(0 -22)"/>`;
  // módulo de sensores al frente
  const mx = cxB, my = cyB + ry; h += `<rect x="${mx - 74}" y="${my - 34}" width="148" height="68" rx="22" fill="#0b121b" stroke="rgba(143,230,245,.45)" stroke-width="1.5"/>`;
  const pul = .5 + .5 * Math.sin(t * 7.5);
  h += `<circle cx="${mx}" cy="${my}" r="${40 + pul * 8}" fill="url(#bg)" opacity="${.6 + .4 * pul}"/>`;
  [-36, -12, 12, 36].forEach((dx, i) => h += `<circle cx="${mx + dx}" cy="${my}" r="6" fill="${i % 2 ? '#8fe6f5' : '#46c8e8'}"/>`);
  h += '</g>';
  // sensores que se abren hacia sus rótulos
  const S5 = VERT ? [['PULSO', 780, 680], ['SpO₂', 780, 745], ['TEMP. PIEL', 780, 810], ['MOVIMIENTO', 1140, 680], ['SUEÑO', 1140, 745], ['RADIACIÓN', 1140, 810]]
    : [['FRECUENCIA CARDÍACA', 520, 250], ['SpO₂', 450, 420], ['TEMPERATURA DE LA PIEL', 560, 585], ['MOVIMIENTO · IMU', 1400, 250], ['SUEÑO', 1470, 420], ['DOSIS DE RADIACIÓN', 1360, 585]];
  S5.forEach(([n, x, y], i) => { const kk = eOut(pr(t, T + 2.6 + i * .16, .7)), izq = x < 960; if (kk <= 0) return;
    const ex = x + (izq ? 70 : -70), sx = mx + (izq ? -60 : 60), sy = my;
    const qx = lerp(sx, ex, kk), qy = lerp(sy, y, kk);
    h += `<path d="M${sx} ${sy} Q${(sx + ex) / 2} ${(sy + y) / 2 + 40} ${qx} ${qy}" fill="none" stroke="rgba(143,230,245,.4)" stroke-width="1.2" stroke-dasharray="3 5"/>`;
    h += `<circle cx="${qx}" cy="${qy}" r="4" fill="#8fe6f5"/><circle cx="${qx}" cy="${qy}" r="${10 + 4 * Math.sin(t * 4 + i)}" fill="none" stroke="#8fe6f5" opacity=".35"/>`;
    h += `<text x="${x + (izq ? 50 : -50)}" y="${y + 5}" text-anchor="${izq ? 'end' : 'start'}" font-family="PM" font-weight="500" font-size="15" letter-spacing="3.2" fill="#e8eef5" opacity="${kk}">${n}</text>`; });
  E('svBand').innerHTML = h;
}


/* ── NOVA narra: subtítulos sincronizados con su voz ── */
const FRASES = ["En abril, cuatro personas volaron alrededor de la Luna. Ahora vamos a Marte.", "Marte está a 225 millones de kilómetros. Un mensaje a casa tarda hasta 22 minutos.", "Allá afuera, el cuerpo cambia. Los huesos se debilitan, el sueño se desordena y la radiación se acumula. Y la tripulación tiene que detectarlo sola.", "Por eso estoy aquí. Soy Nova, y cuido a la tripulación en cada minuto de la misión.", "Una pulsera registra cada latido, cada respiración y cada noche de sueño.", "Cada mañana, cada astronauta ve de un vistazo si está listo.", "Su cuerpo: corazón, oxígeno, hueso y músculo, medidos cada día, para que los cambios pequeños nunca crezcan.", "Y su mente. Cada noche conversamos, y el ánimo, el estrés y la concentración forman una constelación que pueden leer.", "Cada noche, solo hablan conmigo un minuto. Leo el ánimo, el estrés y la fatiga en sus palabras, su voz y la pulsera. Sin formularios.", "Si necesitan apoyo, preparo una sesión privada con su psicólogo en la Tierra.", "Y ellos deciden qué compartir. Los signos vitales van al cirujano de vuelo, las emociones solo a su psicólogo, y su diario es solo suyo.", "En la pantalla grande, veo a toda la tripulación a la vez. Si algo se desvía, te digo por qué.", "En toda la tripulación sigo corazón, hueso, músculo y ojos, para corregir a tiempo los cambios pequeños.", "Llevo un modelo vivo de cada cuerpo a bordo, para que veas qué está cambiando el espacio: líquido que sube a la cabeza, hueso que se pierde en la cadera y un corazón que trabaja menos.", "Cada número viene de la investigación de la NASA y de exámenes que la tripulación ya hace a bordo: ecografías, exámenes de la vista y pruebas de fuerza.", "Y noto lo que no se dice, como alguien que no llama a casa hace nueve días.", "Tras un cambio de turno, Kenji duerme más tarde y su corazón lo resiente. Así que le armé un plan para esta noche.", "Y cuando el Sol hace erupción, guío a todos al refugio y cuento cada milisievert.", "Si algo sale mal, cualquiera a bordo puede ayudar. Abro el protocolo correcto, paso a paso, con mi voz y un metrónomo.", "Apunta un teléfono al paciente y veo el cuerpo: huesos, órganos y el punto exacto de cada paso.", "Confirmo lo que está bien y corrijo lo que no: un poco más arriba, hacia la cabeza.", "Y la reanimación cambia con la gravedad: en Marte, a horcajadas sobre el paciente. En ingravidez, una técnica hecha para cero g.", "Pregunta dónde está el desfibrilador y su cajón se enciende. Cada respuesta abre la página real del libro de donde salió.", "No solo miro los números. Pronostico hacia dónde van y aviso antes de que crucen un límite.", "Pienso a bordo, sin esperar a la Tierra. Y cada noche envío a Control de Misión un informe más liviano que una foto.", "Ese informe viaja en paquetes CCSDS, desde F Prime, el software de vuelo de la NASA, el mismo que hizo volar al helicóptero Ingenuity en Marte.", "En la Tierra, un modelo padre mucho más grande aprende de él, y los cirujanos de vuelo revisan cada cambio. Luego le enseña a un modelo hijo, más pequeño, que cabe en el computador de la nave.", "El hijo vuelve firmado. La nave verifica la firma antes de instalarlo y vuelve atrás si algo falla. Y Control de Misión lo ve todo con el retraso real de la luz.", "Dentro de mí funcionan un modelo de lenguaje, el reconocimiento de voz y una voz, todo en el computador de la nave. Sin internet.", "Todo lo que hago se basa en la investigación de la NASA: sus riesgos para la salud humana, el Estudio de los Gemelos y la radiación medida camino a Marte.", "La NASA lo llama atención médica independiente de la Tierra. Lo probaríamos en misiones análogas como HERA y CHAPEA, luego en la estación espacial y después camino a Marte.", "NOVA. Salud que viaja contigo."];
let ENV = null; try { const x = new XMLHttpRequest(); x.open('GET', 'voz/env-es.json', false); x.send(); ENV = JSON.parse(x.responseText); } catch (e) { ENV = null; }
const kV = i => String(VF[i]).padStart(2, '0'), durV = i => ENV ? ENV[kV(i)].d : 5;
function voz(t){ for (let i = 0; i < V.length; i++){ const a = V[i], d = durV(i); if (t >= a - .3 && t <= a + d + .5){ const e = ENV ? ENV[kV(i)].env : [];
      const f = (t - a) * 30, ev = j => (j >= 0 && j < e.length ? e[j] : 0);
      // envolvente suavizada (ventana de ~0,23 s): sube y baja con las sílabas, sin temblar
      let amp = 0, W = 0; for (let j = -3; j <= 3; j++){ const w = 1 - Math.abs(j) / 4, k0 = Math.floor(f + j), fr = f + j - k0; amp += w * (ev(k0) * (1 - fr) + ev(k0 + 1) * fr); W += w; } amp = Math.min(1, amp / W);
      return { i, a, d, amp }; } } return null; }
/* partir frases largas en dos tramos según el tiempo */
function tramo(i, u){ const f = FRASES[i]; if (f.length <= 74) return f;
  const o = f.match(/[^.]+[.]/g).map(x => x.trim()); let mejor = 1, dif = 1e9;
  for (let k = 1; k < o.length; k++){ const a = o.slice(0, k).join(' ').length, d = Math.abs(a - f.length / 2); if (d < dif){ dif = d; mejor = k; } }
  let A = o.slice(0, mejor).join(' '), B = o.slice(mejor).join(' ');
  if (o.length === 1){ const w = f.split(' '), c = w.findIndex((x, j) => j > w.length / 2 && x.endsWith(',')); const cc = c > 0 ? c + 1 : Math.ceil(w.length / 2); A = w.slice(0, cc).join(' '); B = w.slice(cc).join(' '); }
  return u < A.length / f.length ? A : B; }
function narrador(t){
  const v = voz(t), narr = E('narr'), grande = (t > S.nova && t < S.reveal) || (t > S.abordo && t < S.ciclo) || t > S.cierre;
  if (!v || grande){ narr.style.opacity = 0; return; }
  const u = (t - v.a) / v.d, on = pr(t, v.a - .3, .35) * (1 - pr(t, v.a + v.d + .15, .35));
  narr.style.opacity = on; narr.style.transform = `translateX(-50%) translateY(${(1 - on) * 12}px)`;
  const txt = tramo(v.i, u); if (E('narrT').dataset.t !== txt){ E('narrT').innerHTML = '<b>Nova</b>' + txt; E('narrT').dataset.t = txt; }
  E('narrN').innerHTML = mascotaOrbes({ x: 45, y: 46, R: 25, t, expr: 'normal', orbes: 3, apertura: .9, habla: v.amp, mira: [.4, 0], sinHalo: true });
}

/* ── pantallas reales: marco + cámara por fotogramas clave [t, escala, cx, cy] (cx,cy = punto de la UI al centro) ── */
function camaraUI(id, t, keys, fid){
  // cada fotograma clave se vuelve un encuadre final; la cámara va en línea recta de uno a otro.
  // [t, s, cx, cy, libre] = encuadre manual · [t, 'sel', selector, sMax] = centra ese elemento medido en la interfaz
  const doc = fid ? E(fid).contentDocument : null;
  const enc = (k) => { if (k[1] === 'sel'){ const el = doc && doc.querySelector(k[2]); if (el){ const r = el.getBoundingClientRect(), s = Math.min(k[3] || 1.6, 1560 / r.width, 760 / r.height);
        return [960 - (r.left + r.width / 2) * s, 470 - (r.top + r.height / 2) * s, s]; } return [0, 0, 1]; }
    const [, s, cx, cy, libre] = k; let tx = 960 - cx * s, ty = 540 - cy * s;
    if (libre) return [tx, ty, s];
    if (s >= 1){ tx = Math.min(0, Math.max(1920 - 1920 * s, tx)); ty = Math.min(0, Math.max(1080 - 1080 * s, ty)); } else { tx = (1920 - 1920 * s) / 2; ty = (1080 - 1080 * s) / 2; }
    return [tx, ty, s]; };
  if (VERT) keys = [keys[0], [keys[0][0] + 1, ...keys[0].slice(1)]];   // en vertical manda solo la cámara de la ventana
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const A = enc(keys[i]), B = enc(keys[i + 1]), u = eIO(pr(t, keys[i][0], keys[i + 1][0] - keys[i][0]));
  E(id).style.transform = `translate(${lerp(A[0], B[0], u)}px,${lerp(A[1], B[1], u)}px) scale(${lerp(A[2], B[2], u)})`;
}
function pantalla(esc, pid, fid, t, a, b, keys, dibujar){
  if (!escena(E(esc), t, a, b, { s0: .99 }) && !(t > a && t < b + .6)) return;
  try { dibujar(E(fid).contentWindow, t - a); } catch (e) {}
  camaraUI(pid, t, keys.map(k => [a + k[0], ...k.slice(1)]), fid);
}

/* ── clips de video reales: cada cuadro pide su tiempo exacto y el render espera a que el video llegue ── */
const ESPERAS = [];
function clip(id, u){ const v = E(id); if (!v) return; const d = (v.duration || 99) - .04, x = Math.min(d, Math.max(0, u));
  if (Math.abs(v.currentTime - x) > .002){ ESPERAS.push(new Promise(r => { const f = () => { v.removeEventListener('seeked', f); r(); }; v.addEventListener('seeked', f); setTimeout(r, 1500); })); v.currentTime = x; } }
window.__esperar = () => Promise.all(ESPERAS.splice(0));
function etiqueta(id, t, a){ const el = E(id); if (el) el.style.opacity = eOut(pr(t, a + .4, .6)) * .9; }
/* ── render ── */
function render(t){
  fondo(t, pr(t, .3, 1.5) * (t < S.dist ? .4 : 1)); capaHud(t);
  E('flash').style.opacity = 0;
  if (vis(E('eIntro'), t < S.dist + .05)){ const ks = eIO(pr(t, S.dist - .7, .7)), ki = pr(t, 0, 1.2);
    E('eIntro').style.opacity = ki * (1 - ks); E('eIntro').style.filter = ks > .02 ? `blur(${ks * 14}px)` : '';
    E('fIntro').style.transform = `scale(${1.14 - .1 * eIO(pr(t, 0, 6))}) translateX(${-30 * pr(t, 0, 6)}px)`;
    fx(E('rIntro'), { op: pr(t, .5, .6) * (1 - pr(t, 4.3, .4)) }); palabras(E('h1'), t, 1.0, 4.5); palabras(E('h2'), t, 5.1, S.dist - .3, .09);
    const km = eIO(pr(t, 4.5, 1.4)); E('marte').style.opacity = km; E('marteI').style.transform = `scale(${1.08 - .08 * eIO(pr(t, 4.5, S.dist - 4.5))}) rotate(${-3 * pr(t, 4.5, 5)}deg)`;
    E('credI').textContent = km > .5 ? 'MARTE · NASA VIKING ORBITER' : 'FOTO · NASA / ARTEMIS II'; }
  if (escena(E('eDist'), t, S.dist, S.cuerpo) || (t > S.dist && t < S.cuerpo)){ distancia(t); palabras(E('h3'), t, S.dist + 2.6, S.dist + 4.8); palabras(E('h4'), t, S.dist + 5.0, S.cuerpo - .2, .06); }
  if (escena(E('eCuerpo'), t, S.cuerpo, S.nova) || (t > S.cuerpo && t < S.nova)){ const T = S.cuerpo;
    palabras(E('h5'), t, T + .3, T + 5.6); palabras(E('h6'), t, T + 5.9, S.nova - .3, .06);
    ['f1', 'f2', 'f3'].forEach((id, i) => { pop(E(id), t, T + .6 + i * .22, .8, 60); E(id).querySelector('img').style.transform = `scale(${1.12 - .08 * pr(t, T, 11)})`; });
    pop(E('chips'), t, T + 3.0); E('chips').querySelectorAll('.chip').forEach((c, i) => pop(c, t, T + 3.2 + i * .14, .6, 16));
    fx(E('credF'), { op: pr(t, T + 1, .5) }); }
  // NOVA se presenta
  if (escena(E('eNova'), t, S.nova, S.reveal, { s0: 1 }) || (t > S.nova && t < S.reveal)){ const T = S.nova, v = voz(t), amp = v ? v.amp : 0;
    const ke = eSpr(pr(t, T + .3, 1.4)), ap = eOut(pr(t, T + .6, 1.8));
    if (t < T + 1){ E('flash').style.background = 'radial-gradient(circle at 50% 42%,rgba(143,230,245,.85),rgba(70,200,232,.25) 40%,transparent 70%)'; E('flash').style.opacity = Math.sin(pr(t, T - .1, 1) * Math.PI) * .7; }
    const wF = eIO(pr(t, T + 4.2, 1.1)); E('svNova').innerHTML = mascotaOrbes({ x: 960, y: 400 + Math.sin(t * 1.1) * 8, R: 150 * ke, t, expr: wF > .5 ? 'feliz' : 'normal', pesos: { normal: 1 - wF + 1e-3, feliz: wF + 1e-3 }, orbes: 6 * ap, apertura: lerp(.3, 1, ap), habla: amp, parpadeo: [T + 2.4, T + 5.6].some(a => t > a && t < a + .13) ? 1 : 0 });
    fx(E('novaN'), { op: pr(t, T + 2.2, .6), y: lerp(24, 0, eOut(pr(t, T + 2.2, .9))) });
    const dec = pr(t, T + 2.3, .7), ch = '01#/<>*◆'; E('novaT').textContent = NOMBRE_IA.split('').map((c, i) => dec * 4 > i + .5 ? c : ch[Math.floor(hsh(Math.floor(t * 30) + i) * ch.length)]).join('');
    fx(E('novaS'), { op: pr(t, T + 4.0, .7), y: lerp(14, 0, eOut(pr(t, T + 4.0, .9))) }); }
  // el wearable
  if (escena(E('eReveal'), t, S.reveal, S.movil, { s0: 1.04 }) || (t > S.reveal && t < S.movil)){ banda(t); palabras(E('h7'), t, S.reveal + 1.2, S.movil - .3); }
  // pantallas reales: una toma = un movimiento directo y suave
  const P1 = 442, P2 = 960, P3 = 1478, d6 = V[6] - S.movilA, d7 = V[7] - S.movilA;
  // teléfonos: los tres a la vista, más chicos y arriba (el subtítulo no los tapa); el que habla NOVA se resalta
  const foco = (w, act) => { w.document.querySelectorAll('.iph').forEach((el, i) => { const k = act[i]; el.style.opacity = 1; el.style.transform = `translateY(${-14 * k}px) scale(${1 + .025 * k})`; el.style.transition = 'none'; }); };
  const nivel = (u, a, b) => eIO(pr(u, a - .3, .6)) * (1 - eIO(pr(u, b - .3, .6)));
  pantalla('eMovilA', 'pMovilA', 'fMovilA', t, S.movilA, S.checkin, [[0, .9, 960, 600, 1], [30, .93, 960, 596, 1]], (w, u) => { w.dibujarMovilA(t, Math.min(1, Math.max(0, (u - d6 + .5) / 2)), Math.min(1, Math.max(0, (u - d7 + .3) / 2.4)));
    foco(w, [nivel(u, .6, d6), nivel(u, d6, d7), nivel(u, d7, 99)]); });
  pantalla('eCheckin', 'pCheckin', 'fCheckin', t, S.checkin, S.movilB, [[0, .9, 960, 600, 1], [12, .93, 960, 596, 1]], (w, u) => w.dibujarCheckin(Math.max(0, u - .4)));
  const v9 = V[9] - S.movilB, v21 = V[10] - S.movilB;
  pantalla('eMovilB', 'pMovilB', 'fMovilB', t, S.movilB, S.crew, [[0, .9, 960, 600, 1], [20, .93, 960, 596, 1]], (w, u) => { w.dibujarMovilB(t); foco(w, [0, nivel(u, v9 + .2, v21), nivel(u, v21, 99)]); });
  const d10 = V[11] - S.crew;
  pantalla('eCrew', 'pCrew', 'fCrew', t, S.crew, S.cuerpoC, [[0, .9, 960, 540], [d10 + 4.4, .92, 960, 540], [d10 + 5.8, 'sel', '.ins.nv', 1.3], [12, 'sel', '.ins.nv', 1.32]], (w, u) => w.dibujarConsolaCrew(t));
  pantalla('eCuerpoC', 'pCuerpoC', 'fCuerpoC', t, S.cuerpoC, S.gemelo, [[0, .9, 960, 540], [11, .95, 960, 540]], (w, u) => w.dibujarConsolaCuerpo(t, Math.min(1, u / 1.6)));
  pantalla('eGemelo', 'pGemelo', 'fGemelo', t, S.gemelo, S.menteC, [[0, .9, 960, 540], [30, .95, 960, 540]], (w, u) => w.dibujarConsolaGemelo(t, Math.min(1, u / 2.4)));
  const dM = V[15] - S.menteC;
  pantalla('eMenteC', 'pMenteC', 'fMenteC', t, S.menteC, S.astro, [[0, .9, 960, 540], [dM + 2.8, .92, 960, 540], [dM + 4.2, 'sel', '.ins.nv', 1.3], [12, 'sel', '.ins.nv', 1.32]], (w, u) => w.dibujarConsolaMente(t, Math.min(1, u / 1.6)));
  const d11 = V[16] - S.astro;
  pantalla('eAstro', 'pAstro', 'fAstro', t, S.astro, S.rad, [[0, .9, 960, 540], [d11 + 2.4, .9, 960, 540], [d11 + 3.8, 'sel', '#reloj', 1.2], [d11 + 5.6, 'sel', '#reloj', 1.21], [d11 + 6.9, 'sel', '.plan', 1.4], [14, 'sel', '.plan', 1.42]], (w, u) => w.dibujarConsolaAstronauta(t, Math.min(1, Math.max(0, (u - d11 - 2.4) / 2.2))));
  pantalla('eRad', 'pRad', 'fRad', t, S.rad, S.emerg, [[0, .9, 960, 540], [9.4, 1.06, 900, 560]], (w, u) => w.dibujarConsolaRadiacion(u + .5));
  /* ── escenas nuevas: capturas reales (la nave y el escáner) ── */
  const ra = (i) => V[i], vE = V[18] - S.emerg;
  if (escena(E('eEmerg'), t, S.emerg, S.escaner, { s0: .99 }) || (t > S.emerg && t < S.escaner + .6)){ const u = t - S.emerg;
    clip('vEmerg', u); camaraUI('pEmerg', t, [[S.emerg, .9, 960, 540], [S.emerg + 3.4, .9, 960, 540], [S.emerg + 4.8, 1.3, 980, 520], [S.escaner, 1.32, 980, 520]]); etiqueta('tEmerg', t, S.emerg); }
  if (escena(E('eEscaner'), t, S.escaner, S.rcpg) || (t > S.escaner && t < S.rcpg + .6)){ const T = S.escaner, cambio = V[20] - .6;
    clip('vEscBase', t - T); clip('vEscRcp', t - cambio);
    const kc2 = eIO(pr(t, cambio, .6)); E('vEscRcp').style.opacity = kc2;
    fx(E('dEsc'), { op: eOut(pr(t, T + .2, .8)), y: lerp(30, 0, eOut(pr(t, T + .2, 1))) });
    palabras(E('hEsc1'), t, T + .8, cambio - .1); palabras(E('hEsc2'), t, cambio + .2, S.rcpg); etiqueta('tEsc', t, T); }
  if (escena(E('eRcpG'), t, S.rcpg, S.kit) || (t > S.rcpg && t < S.kit + .6)){ const T = S.rcpg, d2 = T + 3.3;
    clip('vMarte', t - T); clip('vMicro', t - d2);
    pop(E('dMarte'), t, T + .2, .8, 30); pop(E('dMicro'), t, d2, .8, 30); palabras(E('hRcp'), t, T + .4, S.kit); etiqueta('tRcp', t, T); }
  if (escena(E('eKit'), t, S.kit, S.bib, { s0: .99 }) || (t > S.kit && t < S.bib + .6)){ clip('vKit', t - S.kit);
    camaraUI('pKit', t, [[S.kit, .9, 960, 540], [S.kit + 2.4, .9, 960, 540], [S.kit + 3.6, 1.25, 1180, 470], [S.bib, 1.27, 1180, 470]]); etiqueta('tKit', t, S.kit); }
  if (escena(E('eBib'), t, S.bib, S.pron, { s0: .99 }) || (t > S.bib && t < S.pron + .6)){ clip('vBib', t - S.bib);
    camaraUI('pBib', t, [[S.bib, 1.1, 760, 470], [S.pron, 1.16, 720, 470]]); etiqueta('tBib', t, S.bib); }
  if (escena(E('ePron'), t, S.pron, S.abordo, { s0: .99 }) || (t > S.pron && t < S.abordo + .6)){ clip('vPron', t - S.pron);
    camaraUI('pPron', t, [[S.pron, .9, 960, 540], [S.pron + 1.6, .9, 960, 540], [S.pron + 3.0, 1.55, 560, 380], [S.abordo, 1.58, 560, 380]]); etiqueta('tPron', t, S.pron); }
  // piensa a bordo
  if (escena(E('eAbordo'), t, S.abordo, S.ciclo) || (t > S.abordo && t < S.ciclo + .6)){ const T = S.abordo, v = voz(t), amp = v ? v.amp : 0, ke = eSpr(pr(t, T + .2, 1.2));
    if (VERT){ let g = `<defs><radialGradient id="ab1"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient></defs>`;
      g += `<circle cx="960" cy="770" r="100" fill="url(#ab1)"/><circle cx="960" cy="770" r="24" fill="#46c8e8"/><text x="960" y="832" text-anchor="middle" font-family="SG" font-size="18" fill="#9aa4b2">Tierra</text>`;
      g += `<line x1="960" y1="420" x2="960" y2="730" stroke="rgba(255,255,255,.18)" stroke-width="1.5" stroke-dasharray="3 8"/>`;
      const u = (t * .08) % 1; g += `<circle cx="960" cy="${420 + 310 * u}" r="4" fill="#8fe6f5"/>`;
      g += `<text x="990" y="560" font-family="SG" font-size="20" fill="#f2b457">18 minutos solo de ida</text>`;
      const kp = pr(t, V[24] + 4.2, 3.6); if (kp > 0 && kp < 1){ const py = 430 + 260 * eIO(kp), op = Math.min(1, kp * 6, (1 - kp) * 6);
        g += `<g opacity="${op}" transform="translate(960 ${py})"><rect x="-120" y="0" width="240" height="64" rx="16" fill="#0f151d" stroke="rgba(143,230,245,.5)"/><text x="0" y="27" text-anchor="middle" font-family="SG" font-weight="600" font-size="17" fill="#f2f5f8">Informe diario de salud</text><text x="0" y="48" text-anchor="middle" font-family="SG" font-size="14.5" fill="#8fe6f5">6 KB · a Control de Misión</text></g>`; }
      E('svAbordo').innerHTML = g + mascotaOrbes({ x: 960, y: 270, R: 115 * ke, t, expr: 'feliz', orbes: 6, habla: amp, parpadeo: (t > T + 3 && t < T + 3.13) ? 1 : 0 });
    } else {
    let g = `<defs><radialGradient id="ab1"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient></defs>`;
      g += `<circle cx="1520" cy="430" r="110" fill="url(#ab1)"/><circle cx="1520" cy="430" r="26" fill="#46c8e8"/><text x="1520" y="500" text-anchor="middle" font-family="SG" font-size="18" fill="#9aa4b2">Tierra</text>`;
      g += `<line x1="800" y1="430" x2="1480" y2="430" stroke="rgba(255,255,255,.18)" stroke-width="1.5" stroke-dasharray="3 8"/>`;
      const u = (t * .08) % 1; g += `<circle cx="${800 + 680 * u}" cy="430" r="4" fill="#8fe6f5"/>`;
      g += `<text x="1140" y="404" text-anchor="middle" font-family="SG" font-size="20" fill="#f2b457">18 minutos solo de ida</text>`;
      const kp = pr(t, V[24] + 4.2, 3.6); if (kp > 0 && kp < 1){ const px = 800 + 640 * eIO(kp), op = Math.min(1, kp * 6, (1 - kp) * 6);
        g += `<g opacity="${op}" transform="translate(${px} 470)"><rect x="-120" y="0" width="240" height="64" rx="16" fill="#0f151d" stroke="rgba(143,230,245,.5)"/><text x="0" y="27" text-anchor="middle" font-family="SG" font-weight="600" font-size="17" fill="#f2f5f8">Informe diario de salud</text><text x="0" y="48" text-anchor="middle" font-family="SG" font-size="14.5" fill="#8fe6f5">6 KB · a Control de Misión</text></g>`; }
      E('svAbordo').innerHTML = g + mascotaOrbes({ x: 600, y: 430, R: 140 * ke, t, expr: 'feliz', orbes: 6, habla: amp, parpadeo: (t > T + 3 && t < T + 3.13) ? 1 : 0 });
    }
    palabras(E('hAb'), t, T + 1.6, S.ciclo - .2); }
  pantalla('eCiclo', 'pCiclo', 'fCiclo', t, S.ciclo, S.modelos, [[0, .92, 960, 560, 1], [20, .95, 960, 556, 1]], (w, u) => w.dibujarCiclo(u));
  pantalla('eModelos', 'pModelos', 'fModelos', t, S.modelos, S.ciencia, [[0, .92, 960, 560, 1], [22, .95, 960, 556, 1]], (w, u) => w.dibujarModelos(Math.max(0, u - .4)));
  pantalla('eRuta', 'pRuta', 'fRuta', t, S.ruta, S.cierre, [[0, .94, 960, 560, 1], [16, .97, 960, 556, 1]], (w, u) => w.dibujarRuta(Math.max(0, u - .4)));
  // ciencia de NASA
  if (escena(E('eCiencia'), t, S.ciencia, S.ruta) || (t > S.ciencia && t < S.ruta + .6)){ const T = S.ciencia;
    palabras(E('hCi'), t, T + .3, S.ruta); E('ciG').querySelectorAll('.cic').forEach((c, i) => pop(c, t, T + 1.2 + i * 1.1, .7, 24)); }
  // cierre
  if (escena(E('eCierre'), t, S.cierre, DUR + 1, { s0: .97 }) || t > S.cierre){ const T = S.cierre, k = eSpr(pr(t, T + .2, 1.2)), v = voz(t), amp = v ? v.amp : 0;
    E('svCierre').innerHTML = mascotaOrbes({ x: 960, y: 400 + Math.sin(t * 1.2) * 6, R: 92 * k, t, expr: 'feliz', orbes: 6, habla: amp, parpadeo: (t > T + 3.6 && t < T + 3.73) ? 1 : 0 });
    const km = eOut(pr(t, T + .7, 1)); fx(E('cM'), { op: km, s: lerp(1.1, 1, km), b: lerp(16, 0, km) });
    palabras(E('h12'), t, T + 1.4, DUR + 2); fx(E('cFirma'), { op: pr(t, T + 2.8, .8), y: lerp(16, 0, eOut(pr(t, T + 2.8, 1))) });
    E('stage').style.opacity = 1 - pr(t, DUR - .9, .9); } else E('stage').style.opacity = 1;
  narrador(t);
}

/* ── cámara del modo vertical: qué punto del cuadro sigue la ventana en cada momento ── */
const FOCO = (() => { const K = [], k = (t, x, y = 540, z = 1) => K.push([t, x, y, z]);
  const ph = [495, 960, 1425], d6 = V[6] - S.movilA, d7 = V[7] - S.movilA, v9 = V[9] - S.movilB, v21 = V[10] - S.movilB;
  const d10 = V[11] - S.crew, dM = V[15] - S.menteC, d11 = V[16] - S.astro;
  k(0, 960); k(S.movilA - .5, 960);
  k(S.movilA, ph[0]); k(S.movilA + d6 - .4, ph[0]); k(S.movilA + d6 + .4, ph[1]); k(S.movilA + d7 - .4, ph[1]); k(S.movilA + d7 + .4, ph[2]); k(S.checkin - .4, ph[2]);
  k(S.checkin + .2, 1345); k(S.checkin + 5, 1345); k(S.checkin + 6, 620); k(S.movilB - .4, 620);
  k(S.movilB + .2, ph[0]); k(S.movilB + v9 - .2, ph[0]); k(S.movilB + v9 + .6, ph[1]); k(S.movilB + v21 - .2, ph[1]); k(S.movilB + v21 + .6, ph[2]); k(S.crew - .4, ph[2]);
  // consolas: un zoom fijo por escena y la cámara se desliza de un panel completo al siguiente (coordenadas de la interfaz → cuadro: escala .9 centrada)
  const kc = (t, x, y = 540, z = 1) => k(t, 96 + .9 * x, 54 + .9 * y, z);
  kc(S.crew + .2, 461, 540, 1.05); kc(S.crew + d10 + 3.2, 461, 540, 1.05); kc(S.crew + d10 + 4.2, 1108, 540, 1.05); kc(S.crew + d10 + 5.4, 1108, 540, 1.05); kc(S.crew + d10 + 6.2, 1700, 540, 1.05); kc(S.cuerpoC - .4, 1700, 540, 1.05);
  kc(S.cuerpoC + .2, 379, 640, 1.3); kc(S.cuerpoC + 5.6, 379, 640, 1.3); kc(S.cuerpoC + 6.4, 832, 640, 1.3); kc(S.cuerpoC + 7.8, 832, 640, 1.3); kc(S.cuerpoC + 8.6, 1237, 640, 1.3); kc(S.gemelo - .4, 1237, 640, 1.3);
  kc(S.gemelo + .2, 784, 560, 1.3); kc(S.gemelo + 3.5, 784, 560, 1.3); kc(S.gemelo + 4.5, 330, 560, 1.3); kc(S.gemelo + 9, 330, 560, 1.3); kc(S.gemelo + 10, 1240, 560, 1.3); kc(S.gemelo + 15, 1240, 560, 1.3); kc(S.gemelo + 16, 784, 560, 1.3); kc(S.gemelo + 21, 784, 560, 1.3); kc(S.gemelo + 22.5, 1700, 420, 1.3); kc(S.menteC - .4, 1700, 420, 1.3);
  kc(S.menteC + .2, 560); kc(S.menteC + dM + 2.4, 560); kc(S.menteC + dM + 3.4, 1700); kc(S.astro - .4, 1700);
  kc(S.astro + .2, 446); kc(S.astro + d11 + 2.4, 446); kc(S.astro + d11 + 3.6, 1102); kc(S.astro + d11 + 6.6, 1102); kc(S.astro + d11 + 7.4, 1700); kc(S.rad - .4, 1700);
  kc(S.rad + .2, 620, 540, .8); kc(S.emerg - .4, 620, 540, .8);
  // escenas nuevas: capturas reales de la nave y del escáner
  k(S.emerg + .2, 960); k(S.escaner - .4, 960);
  k(S.escaner + .2, 1180, 510, .59); k(S.rcpg - .4, 1180, 510, .59);
  k(S.rcpg + .2, 520, 520, .88); k(S.rcpg + 3.2, 520, 520, .88); k(S.rcpg + 4.2, 1400, 520, .88); k(S.kit - .4, 1400, 520, .88);
  k(S.kit + .2, 960); k(S.bib - .4, 960); k(S.bib + .2, 960); k(S.pron - .4, 960); k(S.pron + .2, 960); k(S.abordo - .4, 960);
  k(S.abordo + .2, 960); k(S.ciclo - .4, 960);
  k(S.ciclo + .2, 380, 560, .95); k(S.ciclo + 4.6, 380, 560, .95); k(S.ciclo + 5.6, 960, 420, .95); k(S.ciclo + 9.6, 960, 420, .95);
  k(S.ciclo + 10.4, 1540, 560, .95); k(S.ciclo + 22, 1540, 560, .95); k(S.ciclo + 22.8, 960, 640, .95); k(S.ciclo + 26.8, 960, 640, .95);
  k(S.ciclo + 27.5, 520, 700, .95); k(S.ciclo + 29.6, 520, 700, .95); k(S.ciclo + 30.2, 1540, 640, .95); k(S.modelos - .4, 1540, 640, .95);
  k(S.modelos + .2, 960); k(S.ciencia - .4, 960);
  k(S.ciencia + .2, 960); k(S.ruta - .4, 960);
  k(S.ruta + .2, 960); k(S.cierre - .4, 960);
  k(S.cierre + .2, 960); k(DUR, 960);
  return K.sort((a, b) => a[0] - b[0]); })();
function focoV(t){ let i = 0; while (i < FOCO.length - 2 && t > FOCO[i + 1][0]) i++;
  const A = FOCO[i], B = FOCO[i + 1], u = eIO(pr(t, A[0], Math.max(.001, B[0] - A[0])));
  return { x: lerp(A[1], B[1], u), y: lerp(A[2], B[2], u), z: lerp(A[3], B[3], u) }; }
