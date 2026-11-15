/* Vista Body twin: el gemelo anatómico de cada astronauta, en 3D y tocable.
   · Anatomía real y abierta: BodyParts3D 4.0 (hombre adulto, 2.234 estructuras, © DBCLS, CC BY 4.0) y el set femenino del
     Human Reference Atlas del NIH (HuBMAP, CC BY 4.0). Son cuerpos de referencia, no el escáner de esta persona.
   · Cada región (corazón, pulmones, cerebro, ojos, cadera, columna, piernas, riñones, piel) se colorea con su estado:
     en vivo desde el núcleo F Prime, o estimado por el modelo de a bordo con tasas de la NASA (y lo dice).
   · Se gira, se acerca, se encienden capas y al tocar una estructura se abre su ficha: qué es, qué le hace el espacio,
     cómo está hoy y qué hacer. La línea de tiempo proyecta hueso y músculo hasta el regreso, con y sin ejercicio. */
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';

const CARPETA = { hombre: 'anatomia/hombre/', mujer: 'anatomia/mujer/' };
const COLOR_EST = { normal: '#46c8e8', esperado_vuelo: '#46c8e8', vigilar: '#a898ff', atencion: '#f2b457', aviso_tierra: '#ec6aa8' };
const REAL = { skeletal: '#e6d9bf', muscular: '#9c3f36', arterial: '#c23a2e', venous: '#3b5596', nervous: '#e2c46a', respiratory: '#d79b9b', digestive: '#c48862', cardiac: '#b3302e', urinary: '#8f4a44', sensory: '#d8d0e8', connective: '#cfc6b0', reproductive: '#b97a7a', endocrine: '#c9a04f', lymphatic: '#7fa36b', integumentary: '#e0b9a0' };
const CAPAS = [['piel', 'Skin'], ['esqueleto', 'Skeleton'], ['organos', 'Organs'], ['musculos', 'Muscles'], ['vasos', 'Vessels'], ['nervios', 'Nerves']];

let ren = null, esc, cam, ctrl, raiz, cajaEl, corre = false, tAnt = 0, faseLatido = 0;
const modelos = {};            // sexo → { grupo, mallas, porRegion, listo }
let sexo = '', gT = 0, estilo = 'halo', sel = null, dia = null, conEj = true, estados = {}, firmaPanel = '', firmaMat = '';
const capas = new Set(['piel', 'esqueleto', 'organos']);
let vuelo = null, hoverT = 0;

/* ── carga ── */
async function bajar(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url);
  if (!url.endsWith('.gz')) return r.arrayBuffer();
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function capaDe(p) {
  const n = p.name;
  if (p.system === 'integumentary') return /^skin$/i.test(n) || /^VH_F_(skin|fat)/.test(p.id) ? 'piel' : null;
  if (p.system === 'skeletal' || p.system === 'connective') return 'esqueleto';
  if (p.system === 'muscular') return 'musculos';
  if (p.system === 'arterial' || p.system === 'venous') return 'vasos';
  if (p.system === 'nervous' && /nerve|ganglion|spinal|cord|dura|chiasm/i.test(n)) return 'nervios';
  if (p.system === 'reproductive' && /mammary|lactiferous|areola|nipple|suspensory ligaments/i.test(n)) return 'piel';
  return 'organos';
}
async function cargar(sx) {
  if (modelos[sx]) return modelos[sx].promesa;
  const m = modelos[sx] = { grupo: new THREE.Group(), mallas: [], porRegion: {}, listo: false };
  m.promesa = (async () => {
    const atlas = await (await fetch(CARPETA[sx] + 'atlas.json')).json();
    let hechos = 0;
    const bufs = await Promise.all(atlas.chunks.map((c, i) => bajar(`${CARPETA[sx]}body-${i}.bin.gz`).then(b => { hechos++; avisoCarga(`Loading ${sx === 'mujer' ? 'female' : 'male'} anatomy · ${Math.round(hechos / atlas.chunks.length * 100)}%`); return b; })));
    for (const p of atlas.parts) {
      const capa = capaDe(p); if (!capa) continue;
      const b = bufs[p.chunk], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b, p.positions, p.vertexCount * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(b, p.normals, p.vertexCount * 3), 3, true));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(b, p.indices, p.indexCount), 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const r = REGIONES.find(R => R.es(p)), malla = new THREE.Mesh(g);
      malla.userData = { p, capa, region: r ? r.id : null };
      malla.renderOrder = capa === 'piel' ? 10 : 0;
      m.grupo.add(malla); m.mallas.push(malla);
      if (r) (m.porRegion[r.id] = m.porRegion[r.id] || []).push(malla);
    }
    // centro de cada región (para el latido y para acercar la cámara)
    m.cajas = {};
    for (const [id, l] of Object.entries(m.porRegion)) { const c = new THREE.Box3(); l.forEach(x => c.union(x.geometry.boundingBox)); m.cajas[id] = c; }
    m.cajaTodo = new THREE.Box3().setFromObject(m.grupo);
    // ancla de cada región: el punto de su superficie más cercano al centro (ahí llega la línea del panel)
    m.anclas = {};
    for (const [id, l] of Object.entries(m.porRegion)) {
      const c = m.cajas[id].getCenter(new THREE.Vector3()); if (id === 'piel') c.set(m.cajas[id].max.x * .55, c.y + .32, m.cajas[id].max.z);
      let mejor = null, d2 = Infinity;
      for (const x of l) { const a = x.geometry.attributes.position, paso = Math.max(1, Math.floor(a.count / 4000));
        for (let i = 0; i < a.count; i += paso) { const dx = a.getX(i) - c.x, dy = a.getY(i) - c.y, dz = a.getZ(i) - c.z, q = dx * dx + dy * dy + dz * dz; if (q < d2) { d2 = q; mejor = [a.getX(i), a.getY(i), a.getZ(i)]; } } }
      if (mejor) m.anclas[id] = new THREE.Vector3(...mejor);
    }
    m.listo = true; firmaMat = '';
    return m;
  })();
  return m.promesa;
}
function avisoCarga(t) { const e = $('gCarga'); if (e) { e.textContent = t; e.hidden = !t; } }

/* ── materiales ── */
const mats = {};
function fresnel(col, k, pw) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(col) }, k: { value: k }, p: { value: pw } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; uniform float p; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-abs(dot(normalize(vN),vV)), p); gl_FragColor = vec4(c*f*k, 1.); }' });
}
function material(malla) {
  const { p, capa, region } = malla.userData, nivel = region ? (estados[region] || {}).nivel : null;
  const elegida = sel && region === sel, apagada = sel && region !== sel;
  const resalta = nivel && COLOR_EST[nivel] && nivel !== 'normal' && nivel !== 'esperado_vuelo';
  const clave = [estilo, capa === 'piel' ? 'piel' : capa + ':' + p.system, elegida ? 'sel' : resalta ? nivel : region && nivel ? 'reg' : '', apagada ? 'dim' : ''].join('|');
  if (mats[clave]) return mats[clave];
  let m;
  if (capa === 'piel') m = estilo === 'halo' ? fresnel('#8fe6f5', apagada ? .35 : .85, 2.4) : fresnel('#cfe3f0', apagada ? .25 : .55, 2.6);
  else if (estilo === 'anatomia') {
    m = new THREE.MeshStandardMaterial({ color: REAL[p.system] || '#aaa', roughness: p.system === 'skeletal' ? .55 : .42 });
    if (elegida) { m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = .18; }
    else if (resalta) { m.emissive = new THREE.Color(COLOR_EST[nivel]); m.emissiveIntensity = .4; }
  } else {
    const col = elegida ? '#ffffff' : resalta ? COLOR_EST[nivel] : null;
    if (col) m = new THREE.MeshStandardMaterial({ color: elegida && resalta ? COLOR_EST[nivel] : col, emissive: elegida && resalta ? COLOR_EST[nivel] : col, emissiveIntensity: elegida ? .55 : .7, roughness: .35 });
    else {
      // cada capa con su color propio, para que encenderla se note: músculo rosado, arterias rojas, venas azules, nervios dorados
      const CAPA_HALO = { musculos: ['#e0607e', .62, .22], nervios: ['#ffd76a', .9, .55] };
      const SIS_HALO = { arterial: ['#ff5468', .85, .4], venous: ['#5a8cff', .8, .4] };
      const [col0, op, em] = CAPA_HALO[capa] || SIS_HALO[p.system] || [{ skeletal: '#c9d6e4', connective: '#9fb0c2' }[p.system] || '#3a5266', p.system === 'skeletal' ? 1 : .55, 0];
      const opaco = op >= 1;
      m = new THREE.MeshStandardMaterial({ color: col0, roughness: .5, transparent: !opaco, opacity: op, depthWrite: opaco || op > .8 });
      if (em) { m.emissive = new THREE.Color(col0); m.emissiveIntensity = em; }
      if (region && nivel) { m.emissive = new THREE.Color('#46c8e8'); m.emissiveIntensity = .12; }
    }
  }
  if (apagada && capa !== 'piel') { m.transparent = true; m.opacity = estilo === 'halo' ? .12 : .18; m.depthWrite = false; }
  return mats[clave] = m;
}
function aplicarMateriales() {
  const m = modelos[sexo]; if (!m || !m.listo) return;
  const firma = [sexo, estilo, sel, [...capas].join(','), JSON.stringify(Object.fromEntries(Object.entries(estados).map(([k, v]) => [k, v.nivel])))].join('#');
  if (firma === firmaMat) return; firmaMat = firma;
  for (const x of m.mallas) { x.visible = capas.has(x.userData.capa) || (!!sel && x.userData.region === sel); x.material = material(x); } // visible booleano: three.js solo oculta con === false
}

/* ── escena ── */
function montar() {
  cajaEl = $('g3d');
  ren = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  ren.toneMapping = THREE.ACESFilmicToneMapping; ren.outputColorSpace = THREE.SRGBColorSpace;
  cajaEl.appendChild(ren.domElement);
  esc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, 1, .02, 30);
  cam.position.set(.6, 1.05, 4.4);
  esc.add(new THREE.HemisphereLight('#dfefff', '#1a1410', .9));
  const l1 = new THREE.DirectionalLight('#ffffff', 2); l1.position.set(1.5, 2.5, 2); esc.add(l1);
  const l2 = new THREE.DirectionalLight('#8fe6f5', .8); l2.position.set(-2, 1, -1.5); esc.add(l2);
  raiz = new THREE.Group(); esc.add(raiz);
  // anillo en el piso
  const anillo = new THREE.Mesh(new THREE.RingGeometry(.42, .425, 96), new THREE.MeshBasicMaterial({ color: '#8fe6f5', transparent: true, opacity: .35, side: THREE.DoubleSide }));
  anillo.rotation.x = -Math.PI / 2; esc.add(anillo);
  const anillo2 = new THREE.Mesh(new THREE.RingGeometry(.58, .583, 96), new THREE.MeshBasicMaterial({ color: '#8fe6f5', transparent: true, opacity: .12, side: THREE.DoubleSide }));
  anillo2.rotation.x = -Math.PI / 2; esc.add(anillo2);
  ctrl = new OrbitControls(cam, ren.domElement);
  ctrl.target.set(0, .9, 0); ctrl.enableDamping = true; ctrl.dampingFactor = .08; ctrl.minDistance = .25; ctrl.maxDistance = 7;
  ctrl.autoRotate = true; ctrl.autoRotateSpeed = .7; ctrl.zoomSpeed = .8;
  ctrl.addEventListener('start', () => { ctrl.autoRotate = false; vuelo = null; });
  new ResizeObserver(medir).observe(cajaEl);
  medir();
  // tocar y pasar el cursor
  let abajo = null;
  ren.domElement.addEventListener('pointerdown', e => { abajo = [e.clientX, e.clientY]; });
  ren.domElement.addEventListener('pointerup', e => { if (abajo && Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) < 5) tocar(e); abajo = null; });
  ren.domElement.addEventListener('pointermove', e => { const t = performance.now(); if (t - hoverT > 70) { hoverT = t; pasar(e); } });
  ren.domElement.addEventListener('pointerleave', () => { $('gEtq').hidden = true; });
}
function medir() {
  if (!ren) return;
  const w = cajaEl.offsetWidth, h = cajaEl.offsetHeight; if (!w || !h) return;
  const z = cajaEl.getBoundingClientRect().width / w || 1;
  ren.setPixelRatio(Math.min(2.2, (devicePixelRatio || 1) * z)); ren.setSize(w, h, false);
  ren.domElement.style.width = '100%'; ren.domElement.style.height = '100%';
  cam.aspect = w / h; cam.updateProjectionMatrix();
}
const ray = new THREE.Raycaster();
function golpe(e) {
  const m = modelos[sexo]; if (!m || !m.listo) return null;
  const r = ren.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
  const vis = m.mallas.filter(x => x.visible && x.userData.capa !== 'piel' && !(sel && x.userData.region !== sel && x.material.opacity < .3));
  const h = ray.intersectObjects(vis, false)[0];
  if (h) return h.object;
  const piel = m.mallas.filter(x => x.visible && x.userData.capa === 'piel');
  const h2 = ray.intersectObjects(piel, false)[0];
  return h2 ? h2.object : null;
}
function pasar(e) {
  const o = golpe(e), etq = $('gEtq');
  if (!o) { etq.hidden = true; ren.domElement.style.cursor = ''; return; }
  const r = REGIONES.find(R => R.id === o.userData.region);
  const caja = $('gem').getBoundingClientRect(), z = caja.width / $('gem').offsetWidth;
  etq.innerHTML = `<b>${o.userData.p.name}</b>${r ? `<span>${r.n} · click for details</span>` : ''}`;
  etq.style.transform = `translate(${(e.clientX - caja.left) / z + 16}px, ${(e.clientY - caja.top) / z - 10}px)`;
  etq.hidden = false; ren.domElement.style.cursor = r ? 'pointer' : '';
}
function tocar(e) {
  const o = golpe(e);
  if (!o || !o.userData.region) { if (sel) elegir(null); return; }
  elegir(o.userData.region);
}

/* ── cámara ── */
function volarA(caja, factor = 1.5) {
  const c = caja.getCenter(new THREE.Vector3()), r = caja.getSize(new THREE.Vector3()).length() / 2;
  const sz = caja.getSize(new THREE.Vector3()), mitad = THREE.MathUtils.degToRad(cam.fov / 2);
  // que quepa a lo alto y a lo ancho
  const dist = Math.max(.3, Math.max(sz.y / 2 / Math.tan(mitad), Math.max(sz.x, sz.z) / 2 / Math.tan(mitad) / cam.aspect) * factor + sz.z / 2);
  const dir = cam.position.clone().sub(ctrl.target).normalize();
  vuelo = { t: 0, de: [cam.position.clone(), ctrl.target.clone()], a: [c.clone().add(dir.multiplyScalar(dist)), c] };
}
function verTodo() { const m = modelos[sexo]; if (m && m.cajaTodo) volarA(m.cajaTodo, 1.32); }

/* ── estado de cada región ── */
function calcular() {
  const tr = ultimo && ultimo.trip[gT], d = dia ?? (mision ? mision.dia : 0);
  for (const r of REGIONES) estados[r.id] = r.hoy(gT, tr, d, conEj);
}

function pintarPanel() {
  const c = CREW[gT], d = dia ?? (mision ? mision.dia : 0), proy = dia != null && mision && dia > mision.dia;
  const pastilla = s => s.vivo ? '<em class="pv">Live</em>' : s.estimado ? `<em class="pe">${proy ? 'Projection' : 'Estimated'}</em>` : '<em class="pn">Not measured</em>';
  const punto = s => `<i style="background:${COLOR_EST[s.nivel] || 'var(--t3)'}"></i>`;
  let h;
  if (!sel) {
    h = `<div class="gpcab"><b>${c.corto}'s body today</b><span>Reference ${c.ella === 'her' ? 'female' : 'male'} anatomy · click any part</span></div>` +
      REGIONES.map(r => { const s = estados[r.id] || {}; const hay = (modelos[sexo] && modelos[sexo].porRegion[r.id]) ? '' : ' sin3d';
        return `<button class="gpfila${hay}" data-gr="${r.id}">${punto(s)}<span><b>${r.n}</b><small>${s.texto || ''}</small></span><strong>${s.valor || '—'}</strong></button>`; }).join('');
  } else {
    const r = REGIONES.find(x => x.id === sel), s = estados[sel] || {};
    const reg = r.medir && typeof REG !== 'undefined' && REG[r.medir] ? `<button class="gpbtn pri" data-greg="${r.medir}">Log ${REG[r.medir].n.toLowerCase()}</button>` : '';
    h = `<button class="gpvolver" data-gr="">← All of ${c.corto}'s body</button>
      <div class="gpt">${punto(s)}<b>${r.n}</b>${pastilla(s)}</div>
      <div class="gpv">${s.valor || '—'}</div><div class="gps">${s.texto || ''}</div>
      ${modelos[sexo] && !modelos[sexo].porRegion[sel] ? '<div class="gps aviso">Not part of the female reference model; values still apply.</div>' : ''}
      <h4>What it does</h4><p>${r.funcion}</p>
      <h4>What space does</h4><p>${r.espacio}</p><p class="gpf">${r.fuente}</p>
      <h4>What to do</h4><p>${r.accion}</p>
      <div class="gpacc">${reg}<button class="gpbtn" data-gask="${r.id}">Ask Nova</button></div>`;
  }
  if (h !== firmaPanel) { firmaPanel = h; $('gPanel').innerHTML = h; }
  // línea de tiempo
  if (mision && mision.total_dias) {
    const tot = mision.total_dias, ent = $('gDia');
    ent.max = tot; if (document.activeElement !== ent) ent.value = d;
    $('gHoyM').style.left = (mision.dia / tot * 100) + '%';
    $('gMarte').style.left = Math.min(100, (mision.dia + (mision.llegada_en_dias || 0)) / tot * 100) + '%';
    $('gMarte').hidden = mision.fase !== 'cruise';
    $('gDiaTxt').innerHTML = `<b>Day ${Math.round(d)}</b> of ${tot}${proy ? ' · projection' : dia != null && dia < mision.dia ? ' · past' : ' · today'}`;
    $('gHoy').hidden = dia == null;
    $('gEj').classList.toggle('on', conEj);
  }
}

function elegir(id) {
  sel = id || null; firmaPanel = '';
  ctrl.autoRotate = false;
  const m = modelos[sexo];
  if (sel && m && m.cajas[sel]) volarA(m.cajas[sel], sel === 'piel' ? 1.12 : 1.5); else verTodo();
  aplicarMateriales(); pintarPanel();
}

/* ── cuadro ── */
function cuadro(t) {
  if (vista !== 'gemelo') { corre = false; return; }
  const dt = Math.min(.1, (t - tAnt) / 1000) || .016; tAnt = t;
  if (vuelo) {
    vuelo.t = Math.min(1, vuelo.t + dt / .7); const k = 1 - Math.pow(1 - vuelo.t, 3);
    cam.position.lerpVectors(vuelo.de[0], vuelo.a[0], k); ctrl.target.lerpVectors(vuelo.de[1], vuelo.a[1], k);
    if (vuelo.t >= 1) vuelo = null;
  }
  ctrl.update();
  // latido al pulso en vivo
  const m = modelos[sexo], tr = ultimo && ultimo.trip[gT];
  const fc = tr && tr.edades.pulso > 0 && tr.edades.pulso <= 6 ? tr.pulso : 0;
  if (m && m.listo && m.porRegion.corazon) {
    faseLatido += dt * (fc || 60) / 60;
    const lat = fc ? Math.pow(Math.max(0, Math.sin(faseLatido * Math.PI * 2)), 6) : 0, s = 1 + lat * .06;
    const c = m.cajas.corazon.getCenter(new THREE.Vector3());
    for (const x of m.porRegion.corazon) { x.scale.setScalar(s); x.position.copy(c).multiplyScalar(1 - s); }
  }
  ren.render(esc, cam);
  lineas(t / 1000);
  requestAnimationFrame(cuadro);
}

/* ── líneas del panel al cuerpo: cada fila (o la ficha abierta) apunta a su región ── */
const vTmp = new THREE.Vector3();
function lineas(t) {
  const m = modelos[sexo], svg = $('gLin'); if (!svg) return;
  if (!m || !m.listo || vuelo) { if (svg.innerHTML) svg.innerHTML = ''; return; }
  const gem = $('gem'), gr = gem.getBoundingClientRect(), z = gr.width / gem.offsetWidth || 1, W = cajaEl.offsetWidth, H = cajaEl.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${gem.offsetWidth} ${gem.offsetHeight}`);
  const filas = sel ? [[sel, document.querySelector('#gPanel .gpt')]] : [...document.querySelectorAll('#gPanel .gpfila[data-gr]')].map(f => [f.dataset.gr, f]);
  const panel = $('gPanel').getBoundingClientRect();
  let h = '', k = 0;
  for (const [id, el] of filas) {
    const a = m.anclas[id]; if (!a || !el) continue;
    const r = el.getBoundingClientRect(); if (r.bottom < panel.top + 4 || r.top > panel.bottom - 4) continue;
    vTmp.copy(a).project(cam); if (vTmp.z > 1 || Math.abs(vTmp.x) > 1.05 || Math.abs(vTmp.y) > 1.05) continue;
    const px = (vTmp.x + 1) / 2 * W, py = (1 - vTmp.y) / 2 * H;
    const ex = (panel.left - gr.left) / z, ey = (r.top + Math.min(r.height / 2, 22) - gr.top) / z, mx = ex - 28 - (k % 3) * 10;
    const col = COLOR_EST[(estados[id] || {}).nivel] || '#9aa4b2', op = sel ? .75 : .38;
    h += `<path d="M${ex} ${ey.toFixed(1)} H${mx} L${px.toFixed(1)} ${py.toFixed(1)}" fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="1"/>`
      + `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.2" fill="${col}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(8 + 2.5 * Math.sin(t * 3 + k)).toFixed(1)}" fill="none" stroke="${col}" stroke-opacity=".45"/>`;
    k++;
  }
  svg.innerHTML = h;
}

/* ── abrir, cambiar de persona y refrescar ── */
async function ponerPersona(i) {
  gT = i; sel = null; firmaPanel = ''; firmaMat = '';
  const sx = CREW[i].ella === 'her' ? 'mujer' : 'hombre';
  document.querySelectorAll('#gQuien button').forEach((b, j) => b.classList.toggle('on', j === gT));
  $('gNombre').textContent = CREW[i].nombre; $('gRol').textContent = `${CREW[i].rol} · mission day ${mision ? mision.dia : '—'}`;
  calcular(); pintarPanel(); novaGemelo();
  if (sx !== sexo) {
    Object.entries(modelos).forEach(([k, v]) => { if (v.grupo.parent) raiz.remove(v.grupo); });
    sexo = sx; avisoCarga('Loading anatomy…');
    const m = await cargar(sx); if (sexo !== sx) return;
    raiz.add(m.grupo); avisoCarga('');
    calcular(); aplicarMateriales(); pintarPanel(); verTodo(); ctrl.autoRotate = true;
  } else { aplicarMateriales(); verTodo(); }
}

function armar() {
  $('gQuien').innerHTML = CREW.map((c, j) => `<button data-gt="${j}">${c.corto}</button>`).join('');
  $('gCapas').innerHTML = CAPAS.map(([k, n]) => `<button data-gc="${k}">${n}</button>`).join('');
  marcarCapas();
}
function marcarCapas() {
  document.querySelectorAll('#gCapas button').forEach(b => b.classList.toggle('on', capas.has(b.dataset.gc)));
  document.querySelectorAll('#gEstilo button').forEach(b => b.classList.toggle('on', b.dataset.ge === estilo));
}

window.abrirGemelo = async function (i = gT) {
  cambiarVista('gemelo');
  if (!ren) { armar(); montar(); }
  if (typeof pedirBases === 'function') pedirBases().then(() => { calcular(); aplicarMateriales(); pintarPanel(); });
  medir();
  if (!corre) { corre = true; tAnt = performance.now(); requestAnimationFrame(cuadro); }
  await ponerPersona(i);
};
window.pintarGemelo = function () {
  if (!ren) return;
  calcular(); aplicarMateriales(); pintarPanel();
};
window.novaGemelo = function () {
  const c = CREW[gT]; calcular();
  const lista = REGIONES.map(r => [r, estados[r.id]]).filter(([, s]) => s && ['atencion', 'aviso_tierra', 'vigilar'].includes(s.nivel));
  $('novaDice').textContent = lista.length ? `In ${c.corto}'s body, ${lista.length === 1 ? 'one thing needs' : `${lista.length} things need`} watching. Click any part to see what space does to it and what to do.`
    : `${c.corto}'s body looks on plan for day ${mision ? mision.dia : '—'}. Click any part to see what space does to it.`;
  const fila = (col, b, txt) => `<div><i style="background:${col}"></i><span><b>${b}</b> ${txt}</span></div>`;
  $('ultimas').innerHTML = (lista.length ? lista : REGIONES.slice(0, 2).map(r => [r, estados[r.id]])).slice(0, 4)
    .map(([r, s]) => fila(COLOR_EST[s.nivel] || 'var(--t3)', r.n, `${s.valor} · ${s.texto}`)).join('');
};

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ren) return;
  if (b.dataset.gt != null && b.closest('#gQuien')) ponerPersona(+b.dataset.gt);
  else if (b.dataset.gc) { capas.has(b.dataset.gc) ? capas.delete(b.dataset.gc) : capas.add(b.dataset.gc); marcarCapas(); firmaMat = ''; aplicarMateriales(); }
  else if (b.dataset.ge) { estilo = b.dataset.ge; marcarCapas(); firmaMat = ''; aplicarMateriales(); }
  else if (b.dataset.gr != null) elegir(b.dataset.gr);
  else if (b.dataset.greg) abrirRegistro(gT, b.dataset.greg);
  else if (b.dataset.gask) { const r = REGIONES.find(x => x.id === b.dataset.gask); preguntarNova(`How is ${CREW[gT].corto}'s ${r.n.toLowerCase()} doing, and what should we do?`); }
  else if (b.id === 'gHoy') { dia = null; calcular(); aplicarMateriales(); pintarPanel(); }
  else if (b.id === 'gEj') { conEj = !conEj; calcular(); aplicarMateriales(); pintarPanel(); }
  else if (b.id === 'gVer') elegir(null);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'gDia' || !mision) return;
  const v = +e.target.value; dia = Math.abs(v - mision.dia) < 2 ? null : v;
  calcular(); aplicarMateriales(); pintarPanel();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && vista === 'gemelo' && sel) elegir(null); });
