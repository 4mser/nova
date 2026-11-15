/* Rack médico en 3D (three.js r170, mismo estilo HALO que el gemelo): seis cajones con borde de luz, que se deslizan
   al tocarlos y sueltan sus insumos como tarjetas con la foto real. En modo escenario (una emergencia elegida) se
   encienden solo los cajones e insumos de ese protocolo, con un hilo de luz de cada tarjeta a su cajón.
   kit.js manda el estado (kit3d.pintar) y recibe los clics (onCajon / onItem). */
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';

const W = 1.7, HC = .34, GAP = .045, D = 1.1, N = 6;          // ancho, alto de cajón, separación, fondo
const ALTO = N * HC + (N - 1) * GAP;
let ren, esc, cam, ctrl, caja, raiz, corre = false, tAnt = 0;
let KIT = null, est = { pack: null, item: null, escenario: '' };
const cajones = [];                 // {id, grupo, frente, borde, color, abierto, objetivo}
const tarjetas = new Map();         // item id → {malla, hilo, objetivo, escala}
const texturas = new Map();         // item id → CanvasTexture
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let sobre = null, abajo = null, vuelo = null;
const cb = { onCajon: () => {}, onItem: () => {} };

/* ── texturas dibujadas en canvas: frente del cajón y tarjeta del insumo ── */
function texFrente(p, i, its) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 200;
  const g = c.getContext('2d'), stock = its.reduce((a, x) => a + Math.min(1, x.cantidad / Math.max(1, x.inicial)), 0) / Math.max(1, its.length);
  const mal = its.filter(x => x.estado !== 'ok').length;
  g.fillStyle = 'rgba(8,14,20,.92)'; g.fillRect(0, 0, 1024, 200);
  g.fillStyle = p.color; g.globalAlpha = .9; g.fillRect(0, 0, 10, 200); g.globalAlpha = 1;
  g.font = '600 92px "Space Grotesk", SG, sans-serif'; g.fillStyle = p.color; g.fillText('ABCDEF'[i], 46, 128);
  g.font = '500 50px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#f2f5f8'; g.fillText(p.n, 150, 92);
  g.font = '400 34px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#9aa4b2';
  g.fillText(`${its.length} items${mal ? ` · ${mal} low` : ''}`, 150, 146);
  // barra de stock
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(760, 120, 210, 10);
  g.fillStyle = mal ? '#f2b457' : p.color; g.fillRect(760, 120, 210 * stock, 10);
  g.font = '500 32px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#9aa4b2'; g.textAlign = 'right'; g.fillText(`${Math.round(stock * 100)}%`, 970, 96);
  // tirador
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(430, 172, 160, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const EST = { ok: '#6fd6b0', bajo: '#f2b457', agotado: '#ec6aa8' };
function texTarjeta(it, p, img) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 660;
  const g = c.getContext('2d');
  g.fillStyle = '#0d141c'; g.beginPath(); g.roundRect(0, 0, 512, 660, 36); g.fill();
  // foto (recorte que llena)
  g.save(); g.beginPath(); g.roundRect(14, 14, 484, 420, 26); g.clip();
  g.fillStyle = '#e9eef2'; g.fillRect(14, 14, 484, 420);
  if (img) { const k = Math.max(484 / img.width, 420 / img.height), w = img.width * k, h = img.height * k; g.drawImage(img, 14 + (484 - w) / 2, 14 + (420 - h) / 2, w, h); }
  g.restore();
  g.fillStyle = p.color; g.fillRect(14, 446, 6, 34);
  g.font = '500 36px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#f2f5f8';
  // nombre en hasta dos líneas
  const pal = it.n.split(' '); let l1 = '', l2 = '';
  for (const w of pal) { if (!l2 && g.measureText(l1 + w).width < 440) l1 += w + ' '; else l2 += w + ' '; }
  g.fillText(l1.trim(), 34, 476); if (l2) g.fillText(l2.trim().slice(0, 26), 34, 518);
  g.beginPath(); g.arc(44, 600, 11, 0, Math.PI * 2); g.fillStyle = EST[it.estado] || '#6fd6b0'; g.fill();
  g.font = '600 46px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#f2f5f8'; g.fillText(String(it.cantidad), 70, 616);
  const ancho = g.measureText(String(it.cantidad)).width;
  g.font = '400 30px "Space Grotesk", SG, sans-serif'; g.fillStyle = '#9aa4b2'; g.fillText(`${it.unidad}${it.cantidad === 1 ? '' : 's'}`, 82 + ancho, 614);
  g.textAlign = 'right'; g.font = '600 32px "Space Grotesk", SG, sans-serif'; g.fillStyle = p.color; g.fillText('ABCDEF'[KIT.packs.indexOf(p)], 478, 614);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const imgs = new Map();
function foto(it) {
  if (!it.foto) return Promise.resolve(null);
  if (!imgs.has(it.id)) imgs.set(it.id, new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = it.foto.archivo; }));
  return imgs.get(it.id);
}

/* ── escena ── */
function montar(el) {
  caja = el;
  ren = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  ren.outputColorSpace = THREE.SRGBColorSpace; ren.toneMapping = THREE.ACESFilmicToneMapping;
  caja.appendChild(ren.domElement);
  esc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, .05, 40);
  cam.position.set(1.8, .75, 6);
  esc.add(new THREE.HemisphereLight('#dfefff', '#10161c', .9));
  const l = new THREE.DirectionalLight('#ffffff', 1.6); l.position.set(2, 3, 3); esc.add(l);
  raiz = new THREE.Group(); esc.add(raiz);
  // piso: anillos como en el gemelo
  const piso = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.52, 96), new THREE.MeshBasicMaterial({ color: '#46c8e8', transparent: true, opacity: .25, side: THREE.DoubleSide }));
  piso.rotation.x = -Math.PI / 2; piso.position.y = -ALTO / 2 - .12; esc.add(piso);
  const piso2 = piso.clone(); piso2.scale.setScalar(1.35); piso2.material = piso.material.clone(); piso2.material.opacity = .1; esc.add(piso2);
  ctrl = new OrbitControls(cam, ren.domElement);
  ctrl.enableDamping = true; ctrl.enablePan = false; ctrl.minDistance = 3; ctrl.maxDistance = 9;
  ctrl.addEventListener('start', () => { vuelo = null; });
  ctrl.minPolarAngle = Math.PI * .28; ctrl.maxPolarAngle = Math.PI * .62;
  ctrl.minAzimuthAngle = -Math.PI * .38; ctrl.maxAzimuthAngle = Math.PI * .38;
  ctrl.target.set(.55, 0, 0);
  ren.domElement.addEventListener('pointermove', mover);
  ren.domElement.addEventListener('pointerdown', e => { abajo = [e.clientX, e.clientY]; });
  ren.domElement.addEventListener('pointerup', e => { if (abajo && Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) < 5) clic(e); abajo = null; });
  new ResizeObserver(medir).observe(caja); medir();
}
function medir() {
  if (!ren) return;
  const r = caja.getBoundingClientRect(), z = caja.offsetWidth ? r.width / caja.offsetWidth : 1;   // la escena está escalada
  const w = caja.offsetWidth, h = caja.offsetHeight; if (!w || !h) return;
  ren.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * z));
  ren.setSize(w, h, false); ren.domElement.style.width = w + 'px'; ren.domElement.style.height = h + 'px';
  cam.aspect = w / h; cam.updateProjectionMatrix();
}

/* el rack: armazón de líneas y un cajón por pack */
function armarRack() {
  raiz.clear(); cajones.length = 0;
  const marco = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W + .14, ALTO + .16, D + .06)), new THREE.LineBasicMaterial({ color: '#8fe6f5', transparent: true, opacity: .45 }));
  raiz.add(marco);
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(W + .14, ALTO + .16, D + .06), new THREE.MeshStandardMaterial({ color: '#0b1218', transparent: true, opacity: .55, roughness: .7, metalness: .3, depthWrite: false }));
  raiz.add(cuerpo);
  KIT.packs.forEach((p, i) => {
    const y = ALTO / 2 - HC / 2 - i * (HC + GAP), g = new THREE.Group(); g.position.set(0, y, 0);
    const color = new THREE.Color(p.color);
    // caja del cajón: líneas + fondo translúcido
    const geo = new THREE.BoxGeometry(W, HC, D);
    const borde = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55 }));
    const fondo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#0e1820', emissive: color, emissiveIntensity: .05, transparent: true, opacity: .5, roughness: .6, depthWrite: false }));
    const frente = new THREE.Mesh(new THREE.PlaneGeometry(W, HC), new THREE.MeshBasicMaterial({ map: texFrente(p, i, KIT.items.filter(x => x.pack === p.id)), transparent: true }));
    frente.position.z = D / 2 + .002;
    // contenido: bloquecitos con el color del pack (se ven cuando el cajón sale)
    const its = KIT.items.filter(x => x.pack === p.id), bloques = [];
    its.forEach((it, k) => {
      const col = k % 6, fila = Math.floor(k / 6), lleno = Math.min(1, it.cantidad / Math.max(1, it.inicial));
      const b = new THREE.Mesh(new THREE.BoxGeometry(.2, .08 + .1 * lleno, .2), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .35, transparent: true, opacity: .85 }));
      b.position.set(-W / 2 + .2 + col * .26, -HC / 2 + .06 + (.04 + .05 * lleno), D / 2 - .22 - fila * .28);
      b.userData = { item: it.id }; g.add(b); bloques.push(b);
    });
    g.add(fondo, borde, frente);
    [fondo, frente].forEach(m => m.userData = { pack: p.id });
    raiz.add(g);
    cajones.push({ id: p.id, grupo: g, frente, borde, fondo, bloques, color, z: 0, objetivo: 0, brillo: 0 });
  });
}

/* tarjetas flotantes: las del cajón abierto, o las del escenario */
async function armarTarjetas() {
  const quiero = new Set(visibles());
  for (const [id, t] of tarjetas) if (!quiero.has(id)) { t.objetivo = 0; t.salir = true; }
  const lista = [...quiero], n = lista.length, cols = n > 4 ? 3 : Math.max(1, Math.min(n, 3)), filas = Math.ceil(n / cols);
  const TW = n > 9 ? .42 : .52, TH = TW * 660 / 512, gx = .1, gy = .1;
  lista.forEach((id, k) => {
    const it = KIT.items.find(x => x.id === id), p = KIT.packs.find(x => x.id === it.pack);
    const col = k % cols, fila = Math.floor(k / cols);
    const x = W / 2 + .5 + TW / 2 + col * (TW + gx), y = (filas - 1) * (TH + gy) / 2 - fila * (TH + gy), z = .45;
    let t = tarjetas.get(id);
    if (!t) {
      const mat = new THREE.MeshBasicMaterial({ map: texTarjeta(it, p, null), transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), mat); m.userData = { item: id };
      const borde = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(TW, TH)), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0 }));
      m.add(borde);
      const hilo = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0 }));
      esc.add(m, hilo);
      t = { malla: m, borde, hilo, objetivo: 1, a: 0, retraso: k * .05, pack: p.id };
      tarjetas.set(id, t);
      foto(it).then(img => { if (img) { mat.map.dispose(); mat.map = texTarjeta(it, p, img); mat.needsUpdate = true; } });
    }
    const nueva = !t.pos;
    t.salir = false; t.objetivo = 1; t.pos = new THREE.Vector3(x, y, z);
    if (nueva) t.malla.position.copy(t.pos).add(new THREE.Vector3(-.5, 0, -.4));
  });
}
function visibles() {
  if (est.escenario) return KIT.items.filter(x => (x.protocolos || []).includes(est.escenario)).map(x => x.id);
  if (est.pack) return KIT.items.filter(x => x.pack === est.pack).map(x => x.id);
  return [];
}

/* ── interacción ── */
function tocar(e) {
  const r = ren.domElement.getBoundingClientRect();
  ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ptr, cam);
  const objs = [...[...tarjetas.values()].filter(t => !t.salir).map(t => t.malla), ...cajones.flatMap(c => [c.frente, c.fondo])];
  const h = ray.intersectObjects(objs, false)[0];
  return h ? h.object.userData : null;
}
function mover(e) { sobre = tocar(e); ren.domElement.style.cursor = sobre ? 'pointer' : 'grab'; }
function clic(e) {
  const u = tocar(e); if (!u) return;
  if (u.item) cb.onItem(u.item); else if (u.pack) cb.onCajon(u.pack);
}

/* ── animación ── */
function cuadro(t) {
  if (!corre) return;
  if (typeof vista !== 'undefined' && vista !== 'kit') { corre = false; return; }
  const dt = Math.min(.1, (t - tAnt) / 1000) || .016; tAnt = t;
  const enEsc = new Set(est.escenario ? KIT.items.filter(x => (x.protocolos || []).includes(est.escenario)).map(x => x.pack) : []);
  for (const c of cajones) {
    c.objetivo = est.pack === c.id ? .75 : est.escenario && enEsc.has(c.id) ? .18 : 0;
    c.z += (c.objetivo - c.z) * Math.min(1, dt * 7); c.grupo.position.z = c.z;
    const activo = est.pack === c.id || enEsc.has(c.id), apagado = (est.pack || est.escenario) && !activo;
    const pulso = enEsc.has(c.id) ? .5 + .5 * Math.sin(t / 300) : 0, hover = sobre && sobre.pack === c.id ? 1 : 0;
    c.borde.material.opacity += ((apagado ? .12 : .55 + .4 * pulso + .3 * hover) - c.borde.material.opacity) * Math.min(1, dt * 8);
    c.fondo.material.emissiveIntensity = apagado ? .01 : .05 + .25 * pulso + .12 * hover;
    c.frente.material.opacity += ((apagado ? .3 : 1) - c.frente.material.opacity) * Math.min(1, dt * 8);
    // el contenido de un cajón apagado se apaga con él (si no, se ve a través del rack y ensucia el escenario)
    for (const b of c.bloques) { b.material.opacity += ((apagado ? .12 : .85) - b.material.opacity) * Math.min(1, dt * 8); b.material.emissiveIntensity = apagado ? .05 : .35; }
  }
  for (const [id, tj] of tarjetas) {
    tj.retraso -= dt; if (tj.retraso > 0 && !tj.salir) continue;
    tj.a += ((tj.salir ? 0 : 1) - tj.a) * Math.min(1, dt * 6);
    const elegida = est.item === id, hover = sobre && sobre.item === id;
    if (tj.pos) tj.malla.position.lerp(tj.pos, Math.min(1, dt * 6));
    tj.malla.material.opacity = tj.a; tj.borde.material.opacity = tj.a * (elegida ? 1 : hover ? .7 : .25);
    const s = (elegida ? 1.12 : hover ? 1.05 : 1) * (.85 + .15 * tj.a); tj.malla.scale.lerp(new THREE.Vector3(s, s, s), Math.min(1, dt * 10));
    tj.malla.quaternion.copy(cam.quaternion);
    // hilo de luz de la tarjeta a su cajón
    const c = cajones.find(x => x.id === tj.pack);
    if (c) {
      const a = tj.malla.position.clone().add(new THREE.Vector3(-.2 * tj.malla.scale.x, 0, 0)), b = new THREE.Vector3(W / 2, c.grupo.position.y, c.grupo.position.z + D / 2);
      tj.hilo.geometry.setFromPoints([a, new THREE.Vector3((a.x + b.x) / 2, a.y, (a.z + b.z) / 2), b]);
      tj.hilo.material.opacity = tj.a * (elegida ? .9 : .35);
    }
    if (tj.salir && tj.a < .02) { esc.remove(tj.malla, tj.hilo); tj.malla.material.map.dispose(); tarjetas.delete(id); }
  }
  if (vuelo) {
    ctrl.target.lerp(vuelo.t, Math.min(1, dt * 3)); cam.position.lerp(vuelo.c, Math.min(1, dt * 3));
    if (cam.position.distanceTo(vuelo.c) < .01) vuelo = null;
  }
  ctrl.update();
  ren.render(esc, cam);
  requestAnimationFrame(cuadro);
}

window.kit3d = {
  /* (contenedor, datos del kit, {pack, item, escenario}, {onCajon, onItem}) */
  pintar(el, datos, estado, callbacks) {
    Object.assign(cb, callbacks || {});
    if (!ren) montar(el);
    const nuevo = KIT !== datos; KIT = datos; est = { ...est, ...estado };
    if (nuevo) {
      // datos nuevos (un uso registrado): se rehacen frentes y tarjetas con las cantidades al día
      const abiertos = Object.fromEntries(cajones.map(c => [c.id, c.z]));
      armarRack(); cajones.forEach(c => { c.z = abiertos[c.id] || 0; });
      for (const [, t] of tarjetas) { esc.remove(t.malla, t.hilo); t.malla.material.map.dispose(); } tarjetas.clear();
    }
    armarTarjetas();
    // la cámara se corre a la derecha cuando hay tarjetas
    const hay = visibles().length;
    const tx = hay ? 1.25 : 0, dist = hay ? 6.4 : 6.3;
    if (!vuelo || vuelo.tx !== tx) vuelo = { tx, t: new THREE.Vector3(tx, 0, 0), c: new THREE.Vector3(tx + dist * .28, .75, dist * .96) };
    if (!corre) { corre = true; tAnt = performance.now(); medir(); requestAnimationFrame(cuadro); }
  },
  parar() { corre = false; },
};
