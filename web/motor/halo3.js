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
const miles = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
const S = {intro: 0, dist: 9, cuerpo: 18.44, nova: 30.83, reveal: 39.58, phones: 53.18, checkin: 81.32, privacy: 93.32, crewS: 101.25, vitalsS: 110.25, gemeloS: 117.44, ojoS: 130.8, ejercicio: 139.28, mujeres: 149.76, menteS: 161.59, emerg: 169.47, escaner: 181.11, rcpg: 198.08, hackS: 207.53, kit: 227.13, bib: 241.61, pron: 248.11, radS: 256.55, misS: 268.26, abordo: 275.35, ciclo: 284.45, modelos: 324.73, ciencia: 335.75, ruta: 346.45, cierre: 358.42};
S.movil = S.phones;
const DUR = 364.96;
const V = [1.4, 9.6, 19.04, 31.43, 40.18, 53.78, 59.12, 69.46, 81.92, 93.92, 101.85, 110.85, 118.04, 162.19, 170.07, 181.71, 191.47, 198.68, 232.13, 248.71, 275.95, 285.05, 297.29, 312.04, 325.33, 336.35, 347.05, 359.02, 139.88, 150.36, 242.21, -999, 131.4, 257.15, 208.13, 268.86];
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
  hx.textAlign = 'right'; hx.fillText(`${NOMBRE_APP} · CREW HEALTH SYSTEM · NASA SPACE APPS 2026`.split('').join(String.fromCharCode(8202)), 1920 - m - 36, 1080 - m - 4); hx.textAlign = 'left';
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
  h += `<text x="${P0[0]}" y="${P0[1] + 72}" text-anchor="middle" font-family="PM" font-size="14" letter-spacing="4" fill="#8c99a9" opacity="${pe}">EARTH</text><text x="${P2[0]}" y="${P2[1] + 72}" text-anchor="middle" font-family="PM" font-size="14" letter-spacing="4" fill="#8c99a9" opacity="${pm}">MARS</text>`;
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

/* ── 04: la estación médica (los sensores que arma Luis) → núcleo F Prime de la nave ── */
function banda(t){
  const T = S.reveal - 1.2, k = eOut(pr(t, T + .5, 1.4)), cxB = 960, cyB = VERT ? 430 : 400, W = 600, H = 330;
  const x0 = cxB - W / 2, y0 = cyB - H / 2;
  let h = `<defs><linearGradient id="est1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16212d"/><stop offset="1" stop-color="#0a1018"/></linearGradient>
    <filter id="bb"><feGaussianBlur stdDeviation="18"/></filter></defs><g opacity="${k}" transform="translate(0 ${(1 - k) * 24})">`;
  h += `<rect x="${x0 - 10}" y="${y0 - 10}" width="${W + 20}" height="${H + 20}" rx="40" fill="#46c8e8" opacity=".10" filter="url(#bb)"/>`;
  h += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="30" fill="url(#est1)" stroke="rgba(143,230,245,.45)" stroke-width="1.6"/>`;
  // pantalla de la estación: ECG en vivo y valores
  const sx = x0 + 30, sy = y0 + 28, sw = W - 60, sh = 190;
  h += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="16" fill="#05090e" stroke="rgba(255,255,255,.06)"/>`;
  let d = ''; for (let i = 0; i <= 120; i++){ const u = i / 120, f = ((u * 3 + t * .9) % 1), y = f > .42 && f < .47 ? -34 * Math.sin((f - .42) / .05 * Math.PI) : f > .55 && f < .65 ? -6 * Math.sin((f - .55) / .1 * Math.PI) : 0;
    d += (i ? 'L' : 'M') + (sx + 14 + u * (sw - 150)).toFixed(1) + ' ' + (sy + 108 + y * 1.5).toFixed(1); }
  h += `<path d="${d}" fill="none" stroke="#6fd6b0" stroke-width="2.2"/>`;
  const pul = 61 + Math.round(Math.sin(t * .7) * 2);
  h += `<text x="${sx + sw - 22}" y="${sy + 74}" text-anchor="end" font-family="SG" font-weight="300" font-size="64" fill="#f2f5f8">${pul}</text><text x="${sx + sw - 22}" y="${sy + 100}" text-anchor="end" font-family="PM" font-size="13" letter-spacing="2" fill="#6fd6b0">BPM · ECG</text>`;
  h += `<text x="${sx + sw - 22}" y="${sy + 150}" text-anchor="end" font-family="SG" font-size="26" fill="#8fe6f5">98 % · 117/76</text>`;
  // puertos
  for (let i = 0; i < 6; i++){ const px = x0 + 80 + i * 88, on = .5 + .5 * Math.sin(t * 3 + i); h += `<circle cx="${px}" cy="${y0 + H - 44}" r="11" fill="#0b121b" stroke="rgba(143,230,245,.5)"/><circle cx="${px}" cy="${y0 + H - 44}" r="4" fill="${i % 2 ? '#8fe6f5' : '#46c8e8'}" opacity="${.5 + .5 * on}"/>`; }
  h += `<text x="${cxB}" y="${y0 + H - 12}" text-anchor="middle" font-family="PM" font-size="11" letter-spacing="3" fill="#8c99a9">${ES_ ? 'ESTACIÓN MÉDICA · TEAM B&amp;N' : 'MEDICAL STATION · TEAM B&amp;N'}</text>`;
  // cable al núcleo de la nave
  const kc = eOut(pr(t, T + 3.6, 1)), cy2 = y0 + H, nx = cxB, ny = VERT ? 820 : 655;
  if (kc > 0){ h += `<path d="M${cxB} ${cy2} L${cxB} ${lerp(cy2, ny - 30, kc)}" stroke="rgba(143,230,245,.55)" stroke-width="2" stroke-dasharray="4 6"/>`;
    const u = (t * .6) % 1; if (kc >= 1) h += `<circle cx="${cxB}" cy="${cy2 + (ny - 30 - cy2) * u}" r="4.5" fill="#8fe6f5"/>`;
    h += `<g opacity="${kc}"><rect x="${nx - 170}" y="${ny - 30}" width="340" height="56" rx="16" fill="#0b121b" stroke="rgba(143,230,245,.4)"/><rect x="${nx - 162}" y="${ny - 22}" width="44" height="40" rx="10" fill="#f2f5f8"/><image href="img/fprime-logo.svg" x="${nx - 155}" y="${ny - 17}" width="30" height="29"/><text x="${nx + 22}" y="${ny + 4}" text-anchor="middle" font-family="SG" font-weight="600" font-size="17" fill="#f2f5f8">${ES_ ? 'Núcleo de vuelo · F Prime' : 'Ship computer · F Prime core'}</text></g>`;
    h += `<text x="${cxB + 16}" y="${(cy2 + ny - 30) / 2 + 4}" font-family="PM" font-size="12" letter-spacing="2" fill="#8c99a9" opacity="${kc}">USB · NDJSON</text>`; }
  h += '</g>';
  // sensores que se abren hacia sus rótulos
  const S5 = ES_ ? (VERT ? [['ECG · PULSO', 780, 690], ['SpO₂', 780, 735], ['PRESIÓN', 780, 780], ['TEMPERATURA', 1140, 690], ['RESPIRACIÓN', 1140, 735], ['GLUCOSA · MASA', 1140, 780]]
    : [['ECG · PULSO', 560, 270], ['SpO₂', 520, 420], ['PRESIÓN ARTERIAL', 560, 570], ['TEMPERATURA', 1360, 270], ['RESPIRACIÓN', 1400, 420], ['GLUCOSA · MASA CORPORAL', 1360, 570]])
    : (VERT ? [['ECG · PULSE', 780, 690], ['SpO₂', 780, 735], ['BLOOD PRESSURE', 780, 780], ['TEMPERATURE', 1140, 690], ['BREATHING', 1140, 735], ['GLUCOSE · MASS', 1140, 780]]
    : [['ECG · HEART RATE', 500, 250], ['SpO₂', 450, 400], ['BLOOD PRESSURE', 500, 550], ['TEMPERATURE', 1420, 250], ['BREATHING', 1470, 400], ['GLUCOSE · BODY MASS', 1420, 550]]);
  S5.forEach(([n, x, y], i) => { const kk = eOut(pr(t, T + 1.6 + i * .16, .7)), izq = x < 960; if (kk <= 0) return;
    const ex = x + (izq ? 70 : -70), sx2 = izq ? x0 : x0 + W, sy2 = cyB - 60 + (i % 3) * 60;
    const qx = lerp(sx2, ex, kk), qy = lerp(sy2, y, kk);
    h += `<path d="M${sx2} ${sy2} Q${(sx2 + ex) / 2} ${(sy2 + y) / 2} ${qx} ${qy}" fill="none" stroke="rgba(143,230,245,.4)" stroke-width="1.2" stroke-dasharray="3 5"/>`;
    h += `<circle cx="${qx}" cy="${qy}" r="4" fill="#8fe6f5"/><circle cx="${qx}" cy="${qy}" r="${10 + 4 * Math.sin(t * 4 + i)}" fill="none" stroke="#8fe6f5" opacity=".35"/>`;
    h += `<text x="${x + (izq ? 50 : -50)}" y="${y + 5}" text-anchor="${izq ? 'end' : 'start'}" font-family="PM" font-weight="500" font-size="15" letter-spacing="3.2" fill="#e8eef5" opacity="${kk}">${n}</text>`; });
  E('svBand').innerHTML = h;
}
const ES_ = /motor-es/.test(location.pathname);

/* ── NOVA narra: subtítulos sincronizados con su voz ── */
const FRASES = ["In April, four humans flew around the Moon. Next, we go to Mars.", "Mars is 225 million kilometers away. A message home takes up to 22 minutes.", "Out there, the body changes. Bones thin, sleep drifts, and radiation adds up. And the crew has to catch it themselves.", "That's why I'm here. I'm Nova, and I watch over the crew, every minute of the mission.", "Every morning, each astronaut taps their card at NOVA Station, the medical station our team built. Today it reads a real ECG. It's designed to measure everything.", "Every morning, each astronaut sees their day at a glance, on their own phone.", "Their body: heart, oxygen and training, tracked every day, so small changes never become big problems.", "And their mind. Every evening they check in, and mood, stress and focus become a constellation: one for each of them, and one for the whole crew.", "The check-in takes a minute, with a tap or with their voice. No forms to fill in.", "And they decide what to share. Vital signs go to the flight surgeon, and their journal stays theirs.", "On the big screen, I watch the whole crew at once. Tap anyone, and their vital signs open.", "For each of them, every vital sign, live, against the limits the flight surgeon set.", "I keep a living model of every body on board, so you can see exactly what space is changing: fluid rising to the head, bone thinning in the hips, and a heart that works less.", "And I notice the quiet things, like a crewmate whose mood has been low for days.", "When something goes wrong, anyone on board can help. I open the right protocol, step by step, with my voice and a metronome.", "Point a phone at the patient, and I see the body: bones, organs, and the exact spot for each step.", "I confirm what's right and correct what isn't: a little higher, toward the head.", "And CPR changes with gravity: on Mars, astride the patient. In weightlessness, a technique built for zero g.", "Ask where the defibrillator is, and its drawer opens. In an emergency, the whole rack lights up what to grab.", "I don't just watch the numbers. I forecast where they're heading, and warn before a line is crossed.", "I think on board, without waiting for Earth. And every night, I send Mission Control a report smaller than a photo.", "That report travels as CCSDS packets, from F Prime, NASA's flight software, the same one that flew the Ingenuity helicopter on Mars.", "Our design goes further: on Earth, a much bigger parent model learns from it, and flight surgeons check every change. Then it teaches a smaller child model, light enough for the ship's computer.", "The child flies back signed. The ship checks the signature before installing it, and rolls back if anything fails. And Mission Control sees it all with the real delay of light.", "Inside me runs a language model, speech recognition and a voice, all on the ship's own computer. No internet needed.", "Everything I do is built on NASA's own research: its human health risks, the Twins Study, and radiation measured on the way to Mars.", "NASA calls this Earth-independent medical care. We would test it in analog missions like HERA and CHAPEA, then on the space station, and then on the way to Mars.", "NOVA. The doctor that travels with astronauts.", "Exercise is part of the treatment. I track every session, and show what skipping it would cost: bone and muscle, day by day.", "Women's health is built in from day one: cycle care that stays private, and a close watch on the risks NASA has found in flight, like clots in the neck veins.", "And every answer opens the real page of the book it came from.", "Inside, an Arduino, an NFC reader and a heart board, all designed by our team and open to inspect, piece by piece.", "A camera reads their eyes too: blinks, fatigue, and the changes NASA watches for in flight.", "I keep count of every millisievert against NASA's career limit. When a solar storm hits, every screen turns amber, and I guide the crew to the shelter.", "And it works for real. We tested it right here, on our own team.", "And I see the whole mission at once: the real path to Mars, day by day."];
let ENV = null; try { const x = new XMLHttpRequest(); x.open('GET', 'voz/env-en.json', false); x.send(); ENV = JSON.parse(x.responseText); } catch (e) { ENV = null; }
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

/* el ciclo está diseñado con sus frases en 0,6 / 10,3 / 21,8 s: el tiempo real se lleva a ese diseño por tramos */
function mapC(u){ const A = [0, V[21] - S.ciclo, V[22] - S.ciclo, V[23] - S.ciclo, S.modelos - S.ciclo], B = [0, .6, 10.3, 21.8, 31.46];
  for (let i = 0; i < 4; i++) if (u <= A[i + 1]) return B[i] + (u - A[i]) / (A[i + 1] - A[i]) * (B[i + 1] - B[i]); return B[4] + (u - A[4]); }
function invC(d){ const A = [0, V[21] - S.ciclo, V[22] - S.ciclo, V[23] - S.ciclo, S.modelos - S.ciclo], B = [0, .6, 10.3, 21.8, 31.46];
  for (let i = 0; i < 4; i++) if (d <= B[i + 1]) return A[i] + (d - B[i]) / (B[i + 1] - B[i]) * (A[i + 1] - A[i]); return A[4]; }
/* ── render ── */
function render(t){
  fondo(t, pr(t, .3, 1.5) * (t < S.dist ? .4 : 1)); capaHud(t);
  E('flash').style.opacity = 0;
  if (vis(E('eIntro'), t < S.dist + .05)){ const ks = eIO(pr(t, S.dist - .7, .7)), ki = pr(t, 0, 1.2);
    E('eIntro').style.opacity = ki * (1 - ks); E('eIntro').style.filter = ks > .02 ? `blur(${ks * 14}px)` : '';
    E('fIntro').style.transform = `scale(${1.14 - .1 * eIO(pr(t, 0, 6))}) translateX(${-30 * pr(t, 0, 6)}px)`;
    fx(E('rIntro'), { op: pr(t, .5, .6) * (1 - pr(t, 4.3, .4)) }); palabras(E('h1'), t, 1.0, 4.5); palabras(E('h2'), t, 5.1, S.dist - .3, .09);
    const km = eIO(pr(t, 4.5, 1.4)); E('marte').style.opacity = km; E('marteI').style.transform = `scale(${1.08 - .08 * eIO(pr(t, 4.5, S.dist - 4.5))}) rotate(${-3 * pr(t, 4.5, 5)}deg)`;
    E('credI').textContent = km > .5 ? 'MARS · NASA VIKING ORBITER' : 'PHOTO · NASA / ARTEMIS II'; }
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
  if (false){ banda(t); palabras(E('h7'), t, S.reveal + 1.2, S.movil - .3); }
  /* ── la app real en el teléfono y la estación real en la pantalla grande ── */
  const fono = (id, t, a, foco = 1, dy = 0) => { const el = E(id); if (!el) return; const k = eOut(pr(t, a, .8));
    el.style.opacity = k * (.45 + .55 * foco); el.style.transform = `translateY(${(1 - k) * 40 - 14 * foco + dy}px) scale(${1 + .03 * foco})`; };
  const nivel = (t, a, b) => eIO(pr(t, a - .3, .6)) * (1 - eIO(pr(t, b - .3, .6)));
  if (escena(E('eFonos'), t, S.phones, S.checkin) || (t > S.phones && t < S.checkin + .6)){ const T = S.phones;
    fono('fHoy', t, T + .2, nivel(t, V[5], V[6])); fono('fCuerpo', t, T + .4, nivel(t, V[6], V[7])); fono('fMente', t, T + .6, nivel(t, V[7], 1e9));
    palabras(E('hFon'), t, T + .4, S.checkin); }
  if (escena(E('eCheck'), t, S.checkin, S.privacy) || (t > S.checkin && t < S.privacy + .6)){ const T = S.checkin;
    fono('fCheck', t, T + .2, 1); palabras(E('hChk'), t, T + .5, S.privacy);
    { const ps = E('fCheck').querySelectorAll('.ckp'), a0 = T + .9, a1 = S.privacy - .9, n = ps.length, d = (a1 - a0) / (n - 1); ps.forEach((im, i) => { im.style.opacity = i === 0 ? 1 : eIO(pr(t, a0 + (i - .5) * d, .22)); }); } E('eCheck').querySelectorAll('.pt').forEach((c, i) => pop(c, t, T + 1.6 + i * .5, .6, 16)); }
  if (escena(E('ePriv'), t, S.privacy, S.crewS) || (t > S.privacy && t < S.crewS + .6)){ const T = S.privacy;
    fono('fCrew', t, T + .2, 1); palabras(E('hPriv'), t, T + .5, S.crewS); E('ePriv').querySelectorAll('.pt').forEach((c, i) => pop(c, t, T + 1.4 + i * .6, .6, 16)); }
  if (escena(E('eCrewS'), t, S.crewS, S.vitalsS, { s0: .99 }) || (t > S.crewS && t < S.vitalsS + .6)){ const T = S.crewS, d = V[10] - T;
    clip('vCrewS', t - T); camaraUI('pCrewS', t, [[T, .9, 960, 540], [S.vitalsS, .93, 960, 540]]); etiqueta('tCrewS', t, T); }
  if (escena(E('eVitS'), t, S.vitalsS, S.gemeloS, { s0: .99 }) || (t > S.vitalsS && t < S.gemeloS + .6)){ const T = S.vitalsS;
    clip('vVitS', t - T); camaraUI('pVitS', t, [[T, .9, 960, 540], [T + 1.4, .9, 960, 540], [T + 2.6, 1.35, 640, 420], [S.gemeloS, 1.37, 640, 420]]); etiqueta('tVitS', t, T); }
  if (escena(E('eGemS'), t, S.gemeloS, S.ojoS, { s0: .99 }) || (t > S.gemeloS && t < S.ojoS + .6)){ const T = S.gemeloS, L = S.ojoS - T;
    clip('vGemS', t - T); camaraUI('pGemS', t, [[T, .9, 960, 540], [T + 1.8, .9, 960, 540], [T + 3.2, 1.3, 600, 520], [T + L * .55, 1.32, 600, 520], [T + L * .55 + 1.2, 1.4, 1160, 560], [S.ojoS, 1.42, 1160, 560]]); etiqueta('tGemS', t, T); }
  if (escena(E('eEjer'), t, S.ejercicio, S.mujeres, { s0: .99 }) || (t > S.ejercicio && t < S.mujeres + .6)){ const T = S.ejercicio;
    clip('vEjer', t - T); camaraUI('pEjer', t, [[T, .9, 960, 540], [T + 2.2, .9, 960, 540], [T + 3.4, 1.55, 1190, 780], [S.mujeres, 1.57, 1190, 780]]); etiqueta('tEjer', t, T); }
  if (escena(E('eMuj'), t, S.mujeres, S.menteS) || (t > S.mujeres && t < S.menteS + .6)){ const T = S.mujeres, L = S.menteS - T;
    fono('fCicloApp', t, T + .2, 1); const k = eIO(pr(t, T + L * .38, L * .4)); E('iCiclo').style.transform = `translateY(${-1040 * k}px)`;
    palabras(E('hMuj'), t, T + .5, S.menteS); E('eMuj').querySelectorAll('.pt').forEach((c, i) => pop(c, t, T + 1.6 + i * .7, .6, 16)); etiqueta('tMuj', t, T); fx(E('fMuj'), { op: pr(t, T + 1.4, .6) * .9 }); }
  if (escena(E('eMenS'), t, S.menteS, S.emerg, { s0: .99 }) || (t > S.menteS && t < S.emerg + .6)){ const T = S.menteS;
    clip('vMenS', t - T); camaraUI('pMenS', t, [[T, .9, 960, 540], [S.emerg, .93, 960, 540]]); etiqueta('tMenS', t, T); }
  /* ── escenas nuevas: capturas reales (la nave y el escáner) ── */
  const ra = (i) => V[i], vE = V[18] - S.emerg;
  if (escena(E('eEmerg'), t, S.emerg, S.escaner, { s0: .99 }) || (t > S.emerg && t < S.escaner + .6)){ const u = t - S.emerg;
    clip('vEmerg', u); camaraUI('pEmerg', t, [[S.emerg, .9, 960, 540], [S.emerg + 3.4, .9, 960, 540], [S.emerg + 4.8, 1.3, 980, 520], [S.escaner, 1.32, 980, 520]]); etiqueta('tEmerg', t, S.emerg); }
  if (escena(E('eEscaner'), t, S.escaner, S.rcpg) || (t > S.escaner && t < S.rcpg + .6)){ const T = S.escaner, cambio = V[16] - .6;
    clip('vEscBase', t - T); clip('vEscRcp', t - cambio);
    const kc2 = eIO(pr(t, cambio, .6)); E('vEscRcp').style.opacity = kc2;
    fx(E('dEsc'), { op: eOut(pr(t, T + .2, .8)), y: lerp(30, 0, eOut(pr(t, T + .2, 1))) });
    palabras(E('hEsc1'), t, T + .8, cambio - .1); palabras(E('hEsc2'), t, cambio + .2, S.rcpg); etiqueta('tEsc', t, T); }
  if (escena(E('eRcpG'), t, S.rcpg, S.hackS) || (t > S.rcpg && t < S.hackS + .6)){ const T = S.rcpg, d2 = V[17] + (S.hackS - V[17]) * .42;
    clip('vMarte', t - T); clip('vMicro', t - d2);
    pop(E('dMarte'), t, T + .2, .8, 30); pop(E('dMicro'), t, d2, .8, 30); palabras(E('hRcp'), t, T + .4, S.hackS); etiqueta('tRcp', t, T); }
  if (escena(E('eKit'), t, S.kit, S.bib, { s0: .99 }) || (t > S.kit && t < S.bib + .6)){ const T = S.kit;
    // la toma real (clips/kit3.webm) está grabada 1:1 con la voz: pregunta a los 5,0 s, cajón a los 7,0 s, emergencia a los 8,6 s
    clip('vKit', t - T);
    camaraUI('pKit', t, [[T, 1, 960, 540], [T + .6, 1, 960, 540], [T + 4.6, 1.32, 760, 500], [S.bib, 1.38, 760, 500]]); etiqueta('tKit', t, S.kit); }
  if (escena(E('eBib'), t, S.bib, S.pron, { s0: .99 }) || (t > S.bib && t < S.pron + .6)){ clip('vBib', t - S.bib);
    camaraUI('pBib', t, [[S.bib, 1.1, 760, 470], [S.pron, 1.16, 720, 470]]); etiqueta('tBib', t, S.bib); }
  if (escena(E('ePron'), t, S.pron, S.radS, { s0: .99 }) || (t > S.pron && t < S.radS + .6)){ clip('vPron', t - S.pron);
    camaraUI('pPron', t, [[S.pron, .9, 960, 540], [S.pron + 1.6, .9, 960, 540], [S.pron + 3.0, 1.55, 560, 380], [S.radS, 1.58, 560, 380]]); etiqueta('tPron', t, S.pron); }
  if (escena(E('eHwS'), t, S.reveal, S.phones, { s0: .99 }) || (t > S.reveal && t < S.phones + .6)){ const T = S.reveal;
    clip('vHwS', t - T); camaraUI('pHwS', t, [[T, .92, 960, 540], [S.phones, .92, 960, 540]]); etiqueta('tHwS', t, T); }
  if (escena(E('eOjoS'), t, S.ojoS, S.ejercicio, { s0: .99 }) || (t > S.ojoS && t < S.ejercicio + .6)){ const T = S.ojoS, L = S.ejercicio - T;
    clip('vOjoS', t - T); camaraUI('pOjoS', t, [[T, .92, 960, 540], [S.ejercicio, .97, 960, 540]]); etiqueta('tOjoS', t, T); }
  if (escena(E('eHackS'), t, S.hackS, S.kit, { s0: .99 }) || (t > S.hackS && t < S.kit + .6)){ const T = S.hackS, L = S.kit - T;
    clip('vHackS', t - T); camaraUI('pHackS', t, [[T, .92, 960, 540], [S.kit, .95, 960, 540]]); etiqueta('tHackS', t, T); }
  if (escena(E('eRadS'), t, S.radS, S.misS, { s0: .99 }) || (t > S.radS && t < S.misS + .6)){ const T = S.radS, L = S.misS - T;
    clip('vRadS', t - T); camaraUI('pRadS', t, [[T, .9, 960, 540], [T + 1.2, .9, 960, 540], [T + 2.6, 1.3, 1220, 330], [T + L * .62, 1.32, 1220, 330], [T + L * .62 + 1.1, 1.25, 600, 330], [S.misS, 1.27, 600, 330]]); etiqueta('tRadS', t, T); }
  if (escena(E('eMisS'), t, S.misS, S.abordo, { s0: .99 }) || (t > S.misS && t < S.abordo + .6)){ const T = S.misS, L = S.abordo - T;
    clip('vMisS', t - T); camaraUI('pMisS', t, [[T, .9, 960, 540], [T + 1, .9, 960, 540], [S.abordo, 1.12, 900, 480]]); etiqueta('tMisS', t, T); }
  // piensa a bordo
  if (escena(E('eAbordo'), t, S.abordo, S.ciclo) || (t > S.abordo && t < S.ciclo + .6)){ const T = S.abordo, v = voz(t), amp = v ? v.amp : 0, ke = eSpr(pr(t, T + .2, 1.2));
    if (VERT){ let g = `<defs><radialGradient id="ab1"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient></defs>`;
      g += `<circle cx="960" cy="770" r="100" fill="url(#ab1)"/><circle cx="960" cy="770" r="24" fill="#46c8e8"/><text x="960" y="832" text-anchor="middle" font-family="SG" font-size="18" fill="#9aa4b2">Earth</text>`;
      g += `<line x1="960" y1="420" x2="960" y2="730" stroke="rgba(255,255,255,.18)" stroke-width="1.5" stroke-dasharray="3 8"/>`;
      const u = (t * .08) % 1; g += `<circle cx="960" cy="${420 + 310 * u}" r="4" fill="#8fe6f5"/>`;
      g += `<text x="990" y="560" font-family="SG" font-size="20" fill="#f2b457">18 minutes one way</text>`;
      const kp = pr(t, V[20] + 4.2, 3.6); if (kp > 0 && kp < 1){ const py = 430 + 260 * eIO(kp), op = Math.min(1, kp * 6, (1 - kp) * 6);
        g += `<g opacity="${op}" transform="translate(960 ${py})"><rect x="-108" y="0" width="216" height="64" rx="16" fill="#0f151d" stroke="rgba(143,230,245,.5)"/><text x="0" y="27" text-anchor="middle" font-family="SG" font-weight="600" font-size="17" fill="#f2f5f8">Daily health report</text><text x="0" y="48" text-anchor="middle" font-family="SG" font-size="14.5" fill="#8fe6f5">6 KB · to Mission Control</text></g>`; }
      E('svAbordo').innerHTML = g + mascotaOrbes({ x: 960, y: 270, R: 115 * ke, t, expr: 'feliz', orbes: 6, habla: amp, parpadeo: (t > T + 3 && t < T + 3.13) ? 1 : 0 });
    } else {
    let g = `<defs><radialGradient id="ab1"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient></defs>`;
      g += `<circle cx="1520" cy="430" r="110" fill="url(#ab1)"/><circle cx="1520" cy="430" r="26" fill="#46c8e8"/><text x="1520" y="500" text-anchor="middle" font-family="SG" font-size="18" fill="#9aa4b2">Earth</text>`;
      g += `<line x1="800" y1="430" x2="1480" y2="430" stroke="rgba(255,255,255,.18)" stroke-width="1.5" stroke-dasharray="3 8"/>`;
      const u = (t * .08) % 1; g += `<circle cx="${800 + 680 * u}" cy="430" r="4" fill="#8fe6f5"/>`;
      g += `<text x="1140" y="404" text-anchor="middle" font-family="SG" font-size="20" fill="#f2b457">18 minutes one way</text>`;
      const kp = pr(t, V[20] + 4.2, 3.6); if (kp > 0 && kp < 1){ const px = 800 + 640 * eIO(kp), op = Math.min(1, kp * 6, (1 - kp) * 6);
        g += `<g opacity="${op}" transform="translate(${px} 470)"><rect x="-108" y="0" width="216" height="64" rx="16" fill="#0f151d" stroke="rgba(143,230,245,.5)"/><text x="0" y="27" text-anchor="middle" font-family="SG" font-weight="600" font-size="17" fill="#f2f5f8">Daily health report</text><text x="0" y="48" text-anchor="middle" font-family="SG" font-size="14.5" fill="#8fe6f5">6 KB · to Mission Control</text></g>`; }
      E('svAbordo').innerHTML = g + mascotaOrbes({ x: 600, y: 430, R: 140 * ke, t, expr: 'feliz', orbes: 6, habla: amp, parpadeo: (t > T + 3 && t < T + 3.13) ? 1 : 0 });
    }
    palabras(E('hAb'), t, T + 1.6, S.ciclo - .2); }
  pantalla('eCiclo', 'pCiclo', 'fCiclo', t, S.ciclo, S.modelos, [[0, .92, 960, 560, 1], [20, .95, 960, 556, 1]], (w, u) => w.dibujarCiclo(mapC(u)));
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
  k(0, 960); k(S.phones - .5, 960);
  const ph = [520, 960, 1400];
  k(S.phones + .2, ph[0]); k(V[6] - .5, ph[0]); k(V[6] + .3, ph[1]); k(V[7] - .5, ph[1]); k(V[7] + .3, ph[2]); k(S.checkin - .4, ph[2]);
  k(S.checkin + .2, 1240); k(S.privacy - .4, 1240); k(S.privacy + .2, 1240); k(S.crewS - .4, 1240);
  const kc = (t, x, y = 540, z = 1) => k(t, 96 + .9 * x, 54 + .9 * y, z);
  k(S.crewS + .2, 960); k(V[10] + 3.2, 960); k(V[10] + 4.4, 960); k(S.vitalsS - .4, 960);
  k(S.vitalsS + .2, 960); k(S.gemeloS - .4, 960); k(S.gemeloS + .2, 960); k(S.ejercicio - .4, 960); k(S.ejercicio + .2, 960); k(S.mujeres - .4, 960); k(S.mujeres + .2, 1240); k(S.menteS - .4, 1240); k(S.menteS + .2, 960); k(S.emerg - .4, 960);
  // escenas nuevas: capturas reales de la nave y del escáner
  k(S.emerg + .2, 960); k(S.escaner - .4, 960);
  k(S.escaner + .2, 1180, 510, .59); k(S.rcpg - .4, 1180, 510, .59);
  k(S.rcpg + .2, 520, 520, .88); k(S.rcpg + 3.2, 520, 520, .88); k(S.rcpg + 4.2, 1400, 520, .88); k(S.hackS - .4, 1400, 520, .88);
  k(S.kit + .2, 960); k(S.bib - .4, 960); k(S.bib + .2, 960); k(S.pron - .4, 960); k(S.pron + .2, 960); k(S.abordo - .4, 960);
  k(S.ojoS + .2, 960); k(S.ejercicio - .4, 960); k(S.hackS + .2, 960); k(S.kit - .4, 960); k(S.radS + .2, 960); k(S.misS - .4, 960); k(S.misS + .2, 960);
  k(S.abordo + .2, 960); k(S.ciclo - .4, 960);
  k(S.ciclo + invC(.2), 380, 560, .95); k(S.ciclo + invC(4.6), 380, 560, .95); k(S.ciclo + invC(5.6), 960, 420, .95); k(S.ciclo + invC(9.6), 960, 420, .95);
  k(S.ciclo + invC(10.4), 1540, 560, .95); k(S.ciclo + invC(22), 1540, 560, .95); k(S.ciclo + invC(22.8), 960, 640, .95); k(S.ciclo + invC(26.8), 960, 640, .95);
  k(S.ciclo + invC(27.5), 520, 700, .95); k(S.ciclo + invC(29.6), 520, 700, .95); k(S.ciclo + invC(30.2), 1540, 640, .95); k(S.modelos - .4, 1540, 640, .95);
  k(S.modelos + .2, 960); k(S.ciencia - .4, 960);
  k(S.ciencia + .2, 960); k(S.ruta - .4, 960);
  k(S.ruta + .2, 960); k(S.cierre - .4, 960);
  k(S.cierre + .2, 960); k(DUR, 960);
  return K.sort((a, b) => a[0] - b[0]); })();
function focoV(t){ let i = 0; while (i < FOCO.length - 2 && t > FOCO[i + 1][0]) i++;
  const A = FOCO[i], B = FOCO[i + 1], u = eIO(pr(t, A[0], Math.max(.001, B[0] - A[0])));
  return { x: lerp(A[1], B[1], u), y: lerp(A[2], B[2], u), z: lerp(A[3], B[3], u) }; }
