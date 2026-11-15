/* Vista «NOVA Station · hardware»: la estación médica física de Luis (ensamble de Inventor exportado a STEP y convertido a
   GLB, ui/estacion/estacion.glb) en 3D, con la interfaz real de NOVA Station viva sobre la pantalla de su tablet.
   · La pantalla es un iframe de station.html?mudo (la misma sesión que la tablet física, sin voz) puesto con CSS3D en el
     plano exacto de la pantalla (ui/estacion/pantalla.json, calculado del modelo).
   · «Exploded» separa las piezas como la presentación de Inventor; cada pieza tiene su etiqueta con su estado en vivo:
     el lector NFC (quién pasó su tarjeta), la placa del corazón (pulso de quien está en la estación), el Arduino (si
     llegan datos de la estación a la nave) y la tablet (sesión abierta).
   Las piezas: Tablet, NovaStation1 (cuerpo), NovaStation2 (soportes laterales), Base_NS, CierreNova (tapa inferior),
   NFC_Adapter, Arduino Uno R3, Corazon Placa (electrodos). */
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from './lib/CSS3DRenderer.js';

const $ = id => document.getElementById(id);
const URL_BASE = typeof BASE !== 'undefined' ? BASE : '';
const PIEZAS = {
  Tablet: { n: 'Tablet', rol: 'NOVA Station screen · shared by the crew', col: '#1b2430' },
  NovaStation1: { n: 'Station body', rol: 'houses the electronics', col: '#2a3341' },
  NovaStation2: { n: 'Side brackets', rol: 'hold the tablet at 30°', col: '#3a3366' },
  Base: { n: 'Base', rol: 'printed base', col: '#232b36' },
  CierreNova: { n: 'Rear cover', rol: 'closes the body', col: '#262f3b' },
  NFC: { n: 'NFC reader', rol: 'crew cards · opens each person\'s space', col: '#1d3b33' },
  Arduino: { n: 'Arduino Uno R3', rol: 'sensor hub · sends readings to the ship', col: '#1f4c86' },
  Corazon: { n: 'Heart board', rol: 'ECG electrodes', col: '#5a1f3d' },
};
/* ficha de cada pieza al aislarla: medidas del STEP de Luis, qué hace y cómo se conecta con la nave */
const FICHA = {
  Tablet: { tipo: 'Display · shared crew screen', datos: [['Size', '≈ 17 × 23 cm, tilted 30° back'], ['Runs', 'NOVA Station app (full-screen, native mic and camera)'], ['Opens a space', 'crew NFC card or personal QR (single use, 30 s)'], ['Closes', '«Sign out», the same card, or 2 min idle']],
    texto: 'The face of the station. With no card it shows the whole crew orbiting NOVA; with a card it opens that person\'s space: anatomical twin, check-in, measurements, messages from home and the medical kit.' },
  NFC: { tipo: 'Sensor · RC522 card reader · 13.56 MHz', datos: [['Cards', 'ISO 14443-A (MIFARE, NTAG) · uses the card serial number'], ['Fits', 'pocket of 37 × 70 × 5 mm in the NFC adapter'], ['Wiring', 'SPI to the Arduino (SDA, SCK, MOSI, MISO, RST, 3.3 V, GND) through the slot in the pocket'], ['Path to the ship', 'Arduino → USB serial 9600 → bridge script → POST /v1/nfc'], ['Contract', 'estacion/NFC.md · bridge in estacion/lector_nova.py']],
    texto: 'Each astronaut taps their card here to open their own space on the tablet. Any card works: the ship links it to a crew member with «Link a card». The Arduino prints each card\'s UID over USB and a small bridge on the station computer forwards it to the ship.' },
  Corazon: { tipo: 'Sensor · AD8232 heart monitor', datos: [['Board', 'AD8232 single-lead ECG, 3 electrodes'], ['Sampling', '250 Hz on the Arduino (A0), leads-off on D2/D3'], ['Bridge', 'finds each beat, pulse and HRV (RMSSD) on the station computer'], ['Sends', 'live waveform to the tablet and the PC · pulse and HRV every 2 s to the person signed in']],
    texto: 'Reads the heart of whoever is at the station. The live ECG appears on the tablet and here; the pulse goes into that person\'s record and through the onboard thresholds. If an electrode comes off, the station says so instead of showing a false value.' },
  Arduino: { tipo: 'Controller · sensor hub', datos: [['Chip', 'ATmega328P · 16 MHz · 32 KB flash · 2 KB SRAM'], ['I/O', '14 digital pins · 6 analog inputs · 5 V'], ['Link', 'USB serial or UDP to the ship, one NDJSON message per reading'], ['Contract', 'estacion/CONTRATO.md: measurement, waveform, heartbeat, event']],
    texto: 'Reads every sensor of the station and sends each reading to the onboard core. The core does not need to know the board or the sensor: if the message follows the contract, it understands it.' },
  NovaStation2: { tipo: 'Structure · side brackets', datos: [['Parts', '2 plates of 110 × 86 × 5 mm'], ['Job', 'hold the tablet at 30° and act as feet'], ['Made', '3D printed']],
    texto: 'Two gussets that give the station its angle: the tablet leans back 30° so it reads well standing or seated.' },
  NovaStation1: { tipo: 'Structure · station body', datos: [['Size', '170 × 87 × 84 mm'], ['Holds', 'tablet seat, Arduino and heart board'], ['Made', '3D printed']], texto: 'The main body: it carries the tablet and keeps the electronics inside.' },
  Base: { tipo: 'Structure · base', datos: [['Size', '172 × 70 mm'], ['Holds', 'the Arduino Uno, screwed to its standoffs'], ['Made', '3D printed']], texto: 'The floor of the station, where the controller sits.' },
  CierreNova: { tipo: 'Structure · rear cover', datos: [['Size', '172 × 75 × 69 mm'], ['Openings', 'USB port of the Arduino and cable holes'], ['Made', '3D printed']], texto: 'Closes the back of the body and protects the electronics, leaving the ports reachable.' },
};
const ACENTO = { Tablet: '#46c8e8', NovaStation1: '#8fe6f5', NovaStation2: '#a898ff', Base: '#8fe6f5', CierreNova: '#8fe6f5', NFC: '#6fd6b0', Arduino: '#46c8e8', Corazon: '#ec6aa8' };
const pieza = nombre => Object.keys(PIEZAS).find(k => nombre.replace(/[_ ]/g, '').startsWith(k.replace(/[_ ]/g, '')));

/* electrónica: colores reales por componente del Arduino (índice de la malla del STEP) */
const MAT_ARDUINO = { 0: 'oro', 1: 'metal', 2: 'negro', 3: 'metal', 4: 'negro', 5: 'negro', 6: 'beige', 7: 'metal', 8: 'negro', 9: 'metal', 10: 'negro', 11: 'negro', 12: 'metal', 13: 'alu', 14: 'metal', 15: 'negro', 16: 'pcb', 17: 'oro' };
const MATS = {
  pcb: { color: '#0b6f7c', metalness: .1, roughness: .6, emissive: '#46c8e8', emissiveIntensity: .03 },
  oro: { color: '#d6aa4f', metalness: .7, roughness: .3 }, metal: { color: '#c9d0d8', metalness: .6, roughness: .35 },
  alu: { color: '#b3bcc6', metalness: .55, roughness: .4 }, negro: { color: '#15181d', metalness: .1, roughness: .5 },
  beige: { color: '#d9cfb8', metalness: 0, roughness: .7 }, morado: { color: '#3b2465', metalness: .1, roughness: .6 },
};
const material = k => new THREE.MeshStandardMaterial({ ...MATS[k] });
const MM = .001;
let ren, css, esc, cam, ctrl, raiz, pantalla, iframe, corre = false, tAnt = 0, explotar = 0, explotarObj = 0, giro = true;
const grupos = {};     // pieza → { grupo, base: Vector3, dir: Vector3, centro: Vector3 }
let PANT = null, CENTRO = new THREE.Vector3();
const vivo = { sesion: null, tNfc: 0, fuentes: {}, pulso: null, tLote: 0 };

async function montar() {
  const caja = $('hw3d');
  ren = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  ren.outputColorSpace = THREE.SRGBColorSpace; ren.toneMapping = THREE.ACESFilmicToneMapping;
  caja.appendChild(ren.domElement);
  css = new CSS3DRenderer(); css.domElement.className = 'hwcss'; caja.appendChild(css.domElement);
  esc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, .005, 20);
  esc.add(new THREE.HemisphereLight('#dfefff', '#0b1016', 1.4));
  const l1 = new THREE.DirectionalLight('#ffffff', 2.2); l1.position.set(.6, 1.2, .9); esc.add(l1);
  const l2 = new THREE.DirectionalLight('#8fe6f5', 1.1); l2.position.set(-1, .4, -.8); esc.add(l2);
  raiz = new THREE.Group(); esc.add(raiz);
  PANT = await (await fetch('estacion/pantalla.json')).json();
  // el STEP de Inventor viene con Y arriba y la conversión lo dejó acostado: se para girando −90° en X (la caja abajo,
  // las escuadras de patas, la tablet de pie inclinada 30° hacia atrás). Se aplica a las mallas y a los datos de la pantalla.
  const PARAR = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const girar = (k, punto) => { const v = new THREE.Vector3().fromArray(PANT[k]); punto ? v.applyMatrix4(PARAR) : v.transformDirection(PARAR); PANT[k] = v.toArray(); };
  girar('centro', 1); girar('centro_estacion', 1); girar('normal'); girar('arriba'); girar('derecha');
  if (PANT.arriba[1] < 0) { PANT.arriba = PANT.arriba.map(x => -x); PANT.derecha = PANT.derecha.map(x => -x); }
  CENTRO.fromArray(PANT.centro_estacion);
  // la tablet, un 15 % más larga: se estira por su eje «arriba» desde el borde inferior, que queda apoyado en las escuadras
  const LARGO = 1.15, arrT = new THREE.Vector3().fromArray(PANT.arriba);
  const pie = new THREE.Vector3().fromArray(PANT.centro).addScaledVector(arrT, -PANT.alto / 2);
  const S = new THREE.Matrix4().set(
    1 + (LARGO - 1) * arrT.x * arrT.x, (LARGO - 1) * arrT.x * arrT.y, (LARGO - 1) * arrT.x * arrT.z, 0,
    (LARGO - 1) * arrT.y * arrT.x, 1 + (LARGO - 1) * arrT.y * arrT.y, (LARGO - 1) * arrT.y * arrT.z, 0,
    (LARGO - 1) * arrT.z * arrT.x, (LARGO - 1) * arrT.z * arrT.y, 1 + (LARGO - 1) * arrT.z * arrT.z, 0, 0, 0, 0, 1);
  const ESTIRAR = new THREE.Matrix4().makeTranslation(pie.x, pie.y, pie.z).multiply(S).multiply(new THREE.Matrix4().makeTranslation(-pie.x, -pie.y, -pie.z));
  PANT.centro = new THREE.Vector3().fromArray(PANT.centro).addScaledVector(arrT, PANT.alto * (LARGO - 1) / 2).toArray();
  PANT.alto *= LARGO;
  const g = await new GLTFLoader().loadAsync('estacion/estacion.glb');
  // cada malla, a su pieza; material HALO (grafito con borde de luz del color de la pieza)
  const porPieza = {};
  g.scene.updateMatrixWorld(true);
  g.scene.traverse(o => { if (o.isMesh) { const k = pieza(o.name) || 'NovaStation1'; (porPieza[k] ||= []).push(o); } });
  for (const [k, mallas] of Object.entries(porPieza)) {
    const grupo = new THREE.Group(); raiz.add(grupo);
    const caja3 = new THREE.Box3();
    for (const m of mallas) {
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(PARAR);
      if (k === 'Tablet') geo.applyMatrix4(ESTIRAR);
      // la electrónica con sus colores reales (el Arduino viene con cada componente; la placa del corazón se viste aparte)
      const real = k === 'Arduino' ? MAT_ARDUINO[+(m.name.match(/R3_(\d+)$/)?.[1] || 0)] : null;
      const mat = real ? material(real) : new THREE.MeshStandardMaterial({ color: PIEZAS[k].col, metalness: .15, roughness: .55, emissive: ACENTO[k], emissiveIntensity: .02 });
      const malla = new THREE.Mesh(geo, mat); malla.userData.pieza = k; malla.userData.real = real; grupo.add(malla);
      if (!real || real === 'pcb') {
        const bordes = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: ACENTO[k], transparent: true, opacity: real ? .25 : .55 }));
        grupo.add(bordes);
      }
      caja3.expandByObject(malla);
    }
    const centro = caja3.getCenter(new THREE.Vector3());
    const dir = centro.clone().sub(CENTRO); if (dir.length() < .01) dir.set(0, -1, 0); dir.normalize();
    grupos[k] = { grupo, centro, dir, mallas: grupo.children.filter(x => x.isMesh) };
  }
  // la pantalla: la interfaz real de NOVA Station, viva, en el plano exacto de la tablet
  const W = 850, H = Math.round(850 * PANT.alto / PANT.ancho);
  iframe = document.createElement('iframe');
  iframe.src = 'station.html?lector=station&mudo';
  iframe.style.cssText = `width:${W}px;height:${H}px;border:0;border-radius:22px;background:#04070b;pointer-events:auto`;
  pantalla = new CSS3DObject(iframe);
  const der = new THREE.Vector3().fromArray(PANT.derecha), arr = new THREE.Vector3().fromArray(PANT.arriba), nor = new THREE.Vector3().fromArray(PANT.normal);
  const m = new THREE.Matrix4().makeBasis(der, arr, nor);
  pantalla.quaternion.setFromRotationMatrix(m);
  pantalla.position.fromArray(PANT.centro).addScaledVector(nor, .0006);
  const marco = .93;   // la pantalla ocupa casi toda la cara de la tablet; queda un borde
  pantalla.scale.setScalar(PANT.ancho * marco / W);
  pantalla.element.style.backfaceVisibility = 'hidden';
  grupos.Tablet.grupo.add(pantalla);   // la pantalla viaja con la tablet al separar las piezas
  // el iframe va DEBAJO del canvas: este hueco (alfa 0, solo la cara de adelante) deja verlo donde está la pantalla, y
  // cualquier pieza que quede delante —o la propia tablet vista desde atrás— lo tapa por profundidad
  const hw = PANT.ancho * marco, hh = H * PANT.ancho * marco / W, rr = 22 * PANT.ancho * marco / W, forma = new THREE.Shape();
  forma.moveTo(-hw / 2 + rr, -hh / 2); forma.lineTo(hw / 2 - rr, -hh / 2); forma.quadraticCurveTo(hw / 2, -hh / 2, hw / 2, -hh / 2 + rr);
  forma.lineTo(hw / 2, hh / 2 - rr); forma.quadraticCurveTo(hw / 2, hh / 2, hw / 2 - rr, hh / 2); forma.lineTo(-hw / 2 + rr, hh / 2);
  forma.quadraticCurveTo(-hw / 2, hh / 2, -hw / 2, hh / 2 - rr); forma.lineTo(-hw / 2, -hh / 2 + rr); forma.quadraticCurveTo(-hw / 2, -hh / 2, -hw / 2 + rr, -hh / 2);
  const hueco = new THREE.Mesh(new THREE.ShapeGeometry(forma, 6), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending }));
  hueco.quaternion.copy(pantalla.quaternion); hueco.position.copy(pantalla.position); hueco.renderOrder = -1;
  grupos.Tablet.grupo.add(hueco);
  // los sensores y los cables, a la medida de las piezas de Luis
  armarElectronica();
  // cámara: de frente a la pantalla, un poco arriba
  ctrl = new OrbitControls(cam, css.domElement);
  ctrl.enableDamping = true; ctrl.dampingFactor = .08; ctrl.minDistance = .18; ctrl.maxDistance = 1.4;
  ctrl.target.copy(CENTRO).add(new THREE.Vector3(0, .01, 0));
  const frente = nor.clone().setY(0).normalize();   // de frente a la pantalla, a la altura de los ojos y un poco de lado
  cam.position.copy(ctrl.target).addScaledVector(frente, .62).add(new THREE.Vector3(.22, .2, 0));
  ctrl.addEventListener('start', () => { giro = false; $('hwGiro').classList.remove('on'); viaje = null; });
  // clic en una pieza: se aísla (un arrastre no cuenta como clic)
  const ray = new THREE.Raycaster(), p0 = { x: 0, y: 0 };
  const tocar = e => { const r = css.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), cam);
    // solo mallas visibles: las líneas de borde atrapan cualquier rayo
    const mallas = []; raiz.traverse(o => { if (o.isMesh && o.userData.pieza && o.material.opacity !== 0) mallas.push(o); });
    const h = ray.intersectObjects(mallas, false).find(x => { let o = x.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
    return h?.object.userData.pieza; };
  css.domElement.addEventListener('pointerdown', e => { p0.x = e.clientX; p0.y = e.clientY; });
  css.domElement.addEventListener('click', e => { if (Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 5) return; const k = tocar(e); if (k && k !== solo) aislar(k); });
  css.domElement.addEventListener('pointermove', e => { if (e.buttons) return; css.domElement.style.cursor = tocar(e) ? 'pointer' : ''; });
  new ResizeObserver(medir).observe(caja); medir();
  $('hwCarga').hidden = true;
}
/* Sensores que el ensamble deja como espacio o bloque, construidos a su medida:
   · lector NFC: placa de 36 × 68 mm con su antena, en el bolsillo de NFC_Adapter (37 × 70 × 5 mm, medido del STEP), con
     el conector saliendo por la ranura del fondo hacia el Arduino;
   · placa del corazón: la de Luis (15 × 15 mm) con sus colores, un LED que late al pulso y sus pines;
   · cables Dupont del Arduino a cada sensor (se ocultan en la vista explotada). */
const brillan = { NFC: [], Corazon: [], Arduino: [] };
let cables = null, viaje = null, solo = null, vistaGeneral = null;   // viaje: la cámara se aleja y baja al separar las piezas, para que entren todas
function caja(w, h, d, mat, x, y, z, padre) { const m = new THREE.Mesh(new THREE.BoxGeometry(w * MM, h * MM, d * MM), mat); m.position.set(x * MM, y * MM, z * MM); padre.add(m); return m; }
function texturaNFC() {
  const c = document.createElement('canvas'); c.width = 360; c.height = 680; const x = c.getContext('2d');
  x.fillStyle = '#0f2f57'; x.fillRect(0, 0, 360, 680);
  // antena: espiral de cobre de 4 vueltas
  x.strokeStyle = '#d6aa4f'; x.lineWidth = 7;
  for (let i = 0; i < 4; i++) { const m = 24 + i * 17; x.beginPath(); x.roundRect(m, 200 + i * 17, 360 - 2 * m, 455 - i * 34, 26 - i * 4); x.stroke(); }
  x.beginPath(); x.moveTo(110, 200); x.lineTo(110, 175); x.moveTo(250, 251); x.lineTo(250, 175); x.stroke();
  // pads del conector (arriba, sobre la ranura) y su rotulado
  const px = Array.from({ length: 8 }, (_, i) => 180 + (i - 3.5) * 25.4);   // conector del RC522: 8 pines a 2,54 mm
  px.forEach(v => { x.fillStyle = '#d6aa4f'; x.beginPath(); x.arc(v, 25, 9, 0, 7); x.fill(); x.fillStyle = '#0f2f57'; x.beginPath(); x.arc(v, 25, 4, 0, 7); x.fill(); });
  x.fillStyle = '#e8eef5'; x.font = '600 10px SG, sans-serif'; x.textAlign = 'center';
  x.font = '600 8px SG, sans-serif'; ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3.3V'].forEach((t, i) => x.fillText(t, px[i], 52));
  x.font = '600 19px SG, sans-serif'; x.fillText('RC522 · 13.56 MHz', 180, 92);
  x.font = '500 13px SG, sans-serif'; x.fillStyle = '#9fb3c8'; x.fillText('NOVA STATION · CREW CARD READER', 180, 430);
  x.strokeStyle = '#9fb3c8'; x.lineWidth = 2; x.beginPath(); x.roundRect(140, 455, 80, 52, 6); x.stroke();
  x.beginPath(); x.arc(180, 481, 9, -1, 1); x.stroke(); x.beginPath(); x.arc(180, 481, 16, -1, 1); x.stroke();
  x.fillStyle = '#04070b'; [[16, 16], [344, 16], [16, 664], [344, 664]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 9, 0, 7); x.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function armarElectronica() {
  // ── lector NFC en el bolsillo (marco del bolsillo: X ancho, U sube por la pendiente, N sale hacia el frente)
  const X = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3(0, .866, .5), N = new THREE.Vector3(0, .5, -.866);
  const enBolsillo = (x, u, n) => new THREE.Vector3().addScaledVector(X, x).addScaledVector(U, u).addScaledVector(N, n).multiplyScalar(MM);
  // base derecha: vista de frente, la derecha de quien mira es −X (igual que la pantalla)
  const nfc = new THREE.Group(); nfc.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X.clone().negate(), U, N));
  nfc.position.copy(enBolsillo(-84.1, -9.9, 6.8 + .6)); grupos.NFC.grupo.add(nfc);
  const tex = texturaNFC();
  const lados = material('negro'); lados.color.set('#0c2442');
  const arriba = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#6fd6b0', emissiveIntensity: 0, metalness: .2, roughness: .55 });
  nfc.add(new THREE.Mesh(new THREE.BoxGeometry(36 * MM, 68 * MM, 1.2 * MM), [lados, lados, lados, lados, arriba, lados]));
  const negro = material('negro'), metal = material('metal'), beige = material('beige');
  caja(5, 5, .9, negro, -7, 18, 1.05, nfc); caja(3.2, 2.5, .8, metal, 6, 18, 1, nfc);
  [[-2, 14], [2, 14], [9, 13], [-12, 15]].forEach(([a, b]) => caja(1.6, .8, .6, beige, a, b, .9, nfc));
  const led = new THREE.MeshStandardMaterial({ color: '#2a0d0d', emissive: '#ff4b4b', emissiveIntensity: 1.2 });
  caja(1.6, .8, .5, led, 14, 26, .85, nfc);
  // conector: carcasa negra bajo la placa, pasando por la ranura del fondo, con sus 4 pines
  const PINES = Array.from({ length: 8 }, (_, i) => (i - 3.5) * 2.54);
  caja(20.4, 2.5, 6, negro, 0, 31.5, -3.6, nfc);
  const oro = material('oro'); PINES.forEach(a => caja(.64, .64, 9, oro, a, 31.5, -7.5, nfc));
  brillan.NFC.push(arriba);
  // ── placa del corazón: la de Luis, vestida (PCB morada, sensor negro, componente metálico), con LED y pines
  const cor = grupos.Corazon, cajas = cor.mallas.map(m => { m.geometry.computeBoundingBox(); return [m, m.geometry.boundingBox]; });
  cajas.sort((a, b) => b[1].getSize(new THREE.Vector3()).length() - a[1].getSize(new THREE.Vector3()).length());
  const [placa, chip, chico] = cajas;
  placa[0].material = material('morado'); chip && (chip[0].material = material('negro')); chico && (chico[0].material = material('metal'));
  const bp = placa[1], sup = chip ? chip[1].min.y / MM : bp.max.y / MM;
  const ledC = new THREE.MeshStandardMaterial({ color: '#2a0d1a', emissive: '#ec6aa8', emissiveIntensity: .2 });
  caja(1.6, .5, .8, ledC, bp.max.x / MM - 2, sup + .25, bp.max.z / MM - 2, cor.grupo); brillan.Corazon.push(ledC);
  const pinesC = [0, 1, 2, 3].map(i => new THREE.Vector3(bp.min.x / MM + 1.4, sup, (bp.min.z + bp.max.z) / 2 / MM + (i - 1.5) * 2.54));
  pinesC.forEach(p => caja(.64, 6, .64, oro, p.x, p.y + 3, p.z, cor.grupo));
  brillan.Arduino = grupos.Arduino.mallas.filter(m => m.userData.real === 'pcb').map(m => m.material);
  for (const [k, g] of Object.entries(grupos)) g.grupo.traverse(o => { o.userData.pieza ||= k; });
  // ── cables Dupont desde los headers del Arduino
  const hdr = grupos.Arduino.mallas.find(m => /R3_11$/.test(m.name || '')) || grupos.Arduino.mallas[0];
  const gh = new THREE.Box3().setFromBufferAttribute(hdr.geometry.attributes.position);
  const top = gh.max.y / MM, zF = (gh.max.z / MM) - 1.3, zB = (gh.min.z / MM) + 1.3;   // dos hileras de headers
  cables = new THREE.Group(); raiz.add(cables);
  const tubo = (pts, color) => { const c = new THREE.CatmullRomCurve3(pts.map(p => p.clone().multiplyScalar(MM)), false, 'centripetal');
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 60, .55 * MM, 8), new THREE.MeshStandardMaterial({ color, roughness: .45, metalness: .05 })); cables.add(m);
    const pt = c.getPoint(0); const f = new THREE.Mesh(new THREE.BoxGeometry(2.5 * MM, 9 * MM, 2.5 * MM), negro); f.position.copy(pt).add(new THREE.Vector3(0, 3 * MM, 0)); cables.add(f); };
  const COL = ['#e5484d', '#1b1d22', '#f2c94c', '#3fb6e8'];
  // corazón: 4 cables desde la hilera más cercana
  const zC = Math.abs(zF - pinesC[0].z) < Math.abs(zB - pinesC[0].z) ? zF : zB;
  pinesC.forEach((p, i) => { const a = new THREE.Vector3(gh.max.x / MM - 6 - i * 2.54, top + 4, zC), b = p.clone().add(new THREE.Vector3(0, 7, 0));
    tubo([a, a.clone().add(new THREE.Vector3(0, 9, 0)), a.clone().lerp(b, .5).add(new THREE.Vector3(0, 14, 0)), b.clone().add(new THREE.Vector3(0, 7, 0)), b], COL[i]); });
  // NFC: 7 cables (SPI + alimentación; IRQ queda libre) desde la otra hilera hasta el conector detrás del bolsillo
  const zN = zC === zF ? zB : zF, COL7 = ['#f2c94c', '#3fb6e8', '#4cc38a', '#a98bf0', null, '#1b1d22', '#f0f0f0', '#e5484d'];
  [-3.5, -2.5, -1.5, -.5, .5, 1.5, 2.5, 3.5].map(v => v * 2.54).forEach((a, i) => { if (!COL7[i]) return;
    const s0 = new THREE.Vector3(gh.min.x / MM + 4 + i * 2.54, top + 4, zN);
    const fin = enBolsillo(-84.1 - a, 21.6, 6.8 + .6 - 12).multiplyScalar(1 / MM);
    const atras = fin.clone().addScaledVector(N, -8), bajo = new THREE.Vector3(-50, atras.y - 18, atras.z - 6 + i * .8);
    tubo([s0, s0.clone().add(new THREE.Vector3(0, 10, 0)), new THREE.Vector3(-30, s0.y + 18, (s0.z + bajo.z) / 2), bajo, atras, fin], COL7[i]);
  });
}

/* aislar: solo esa pieza, la cámara la encuadra y gira a su alrededor, y la ficha cuenta qué es */
function aislar(k) {
  if (!solo) vistaGeneral = { target: ctrl.target.clone(), cam: cam.position.clone() };
  solo = k; explotarObj = 0; const bx = $('hwExplotar'); bx.classList.remove('on'); bx.textContent = 'Exploded view';
  for (const [j, g] of Object.entries(grupos)) g.grupo.visible = j === k;
  const g = grupos[k]; g.grupo.position.set(0, 0, 0); g.grupo.updateMatrixWorld(true);
  const caja3 = new THREE.Box3(); g.grupo.traverse(o => { if (o.isMesh && o.material.opacity !== 0) caja3.expandByObject(o); });
  const c = caja3.getCenter(new THREE.Vector3()), r = caja3.getSize(new THREE.Vector3()).length() / 2;
  const dir = cam.position.clone().sub(ctrl.target).normalize();
  viaje = { target: c, cam: c.clone().addScaledVector(dir, Math.max(.09, r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.7)) };
  ctrl.minDistance = .04; giro = true; $('hwGiro').classList.add('on');
  pintarFicha(); encuadre();
}
function volver() {
  if (!solo) return; solo = null;
  for (const g of Object.values(grupos)) g.grupo.visible = true;
  if (vistaGeneral) viaje = { ...vistaGeneral }; ctrl.minDistance = .18;
  $('hwFicha').hidden = true; encuadre(); $('hwsello').hidden = false; document.querySelector('.hwpista').hidden = false;
}
function pintarFicha() {
  const k = solo, f = FICHA[k] || { tipo: PIEZAS[k].rol, datos: [], texto: '' };
  $('hwsello').hidden = true; document.querySelector('.hwpista').hidden = true;
  $('hwFicha').hidden = false;
  $('hwFicha').style.setProperty('--ac', ACENTO[k]);
  $('hwFicha').innerHTML = `<button class="hwvolver" id="hwVolver">← Whole station</button>
    <small>${f.tipo}</small><h3>${PIEZAS[k].n}</h3><p class="hwvivo"><i></i><span id="hwFichaVivo">${estadoDe(k)}</span></p>
    <p>${f.texto}</p><dl>${f.datos.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
    <div class="hwotras">${Object.keys(PIEZAS).filter(j => grupos[j] && j !== k).map(j => `<button data-hwpieza="${j}" style="--ac:${ACENTO[j]}">${PIEZAS[j].n}</button>`).join('')}</div>
    <span class="hwpie">Design: Luis González · measured from the Inventor assembly</span>`;
}

function medir() {
  const c = $('hw3d'); if (!ren || !c.offsetWidth) return;
  const w = c.offsetWidth, h = c.offsetHeight;
  ren.setPixelRatio(Math.min(2, devicePixelRatio || 1)); ren.setSize(w, h, false);
  ren.domElement.style.width = w + 'px'; ren.domElement.style.height = h + 'px';
  css.setSize(w, h); cam.aspect = w / h; encuadre();
}
// con la ficha abierta, el centro de la vista se corre a la izquierda para que la pieza no quede debajo de ella
function encuadre() {
  const c = $('hw3d'), w = c.offsetWidth, h = c.offsetHeight;
  if (solo && w) cam.setViewOffset(w, h, ($('hwFicha').offsetWidth + 40) / 2, 0, w, h); else cam.clearViewOffset();
  cam.updateProjectionMatrix();
}

/* etiquetas: una por pieza, con su estado en vivo, unidas con una línea a su pieza */
const ETQ = ['Tablet', 'NFC', 'Corazon', 'Arduino', 'NovaStation2'];
function estadoDe(k) {
  const s = vivo.sesion;
  if (k === 'Tablet') return s?.trip ? `Open for <b>${s.nombre || s.trip}</b>` : 'Shared view · waiting for a card or QR';
  if (k === 'NFC') return performance.now() - vivo.tNfc < 6000 ? '<b>Card read just now</b>' : 'Ready · tap a crew card';
  if (k === 'Corazon') return vivo.pulso ? `Heart <b>${Math.round(vivo.pulso)} bpm</b>${s?.trip ? ` · ${s.nombre || s.trip}` : ''}` : 'Electrodes ready';
  if (k === 'Arduino') { const r = Object.values(vivo.fuentes).some(x => Object.values(x).some(v => v.vigente && /estacion|station|arduino/i.test(v.fuente))); return r ? '<b>Live</b> · readings reaching the ship' : 'Waiting for the station firmware'; }
  return PIEZAS[k].rol;
}
function pintarEtiquetas() {
  const c = $('hw3d'), w = c.offsetWidth, h = c.offsetHeight; let svg = '', html = '';
  if (solo) { $('hwLin').innerHTML = ''; $('hwEtq').innerHTML = ''; const v = $('hwFichaVivo'); if (v) v.innerHTML = estadoDe(solo); return; }
  ETQ.forEach((k, i) => {
    const gr = grupos[k]; if (!gr) return;
    const p = gr.centro.clone().applyMatrix4(gr.grupo.matrixWorld).project(cam); if (p.z > 1) return;
    const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
    const izq = x < w / 2, ex = izq ? 24 : w - 284, ey = 90 + i * 104;
    svg += `<path d="M${x} ${y} L${izq ? ex + 260 : ex} ${ey + 26}" stroke="${ACENTO[k]}" stroke-opacity=".55" fill="none"/><circle cx="${x}" cy="${y}" r="4" fill="${ACENTO[k]}"/>`;
    html += `<div class="hwetq" data-hwpieza="${k}" style="left:${ex}px;top:${ey}px;border-color:${ACENTO[k]}66"><i style="background:${ACENTO[k]}"></i><b>${PIEZAS[k].n}</b><span>${estadoDe(k)}</span></div>`;
  });
  $('hwLin').innerHTML = svg; $('hwEtq').innerHTML = html;
}

function cuadro(t) {
  if (typeof vista !== 'undefined' && vista !== 'hardware') { corre = false; return; }
  requestAnimationFrame(cuadro);
  const dt = Math.min(.1, (t - tAnt) / 1000) || .016; tAnt = t;
  explotar += (explotarObj - explotar) * Math.min(1, dt * 4);
  for (const [k, g] of Object.entries(grupos)) {
    const lejos = k === 'Tablet' ? .06 : k === 'Arduino' || k === 'Corazon' ? .1 : .07;
    g.grupo.position.copy(g.dir).multiplyScalar(explotar * lejos);
  }
  // vida: la placa del corazón late al pulso de quien está en la estación; el NFC brilla al leer una tarjeta
  const pulso = vivo.pulso || 60, lat = Math.pow(Math.max(0, Math.sin(t / 1000 * Math.PI * pulso / 60)), 12);
  brillan.Corazon.forEach(m => { m.emissiveIntensity = .2 + 2.2 * lat; });
  if (cables) cables.visible = explotar < .02 && !solo;
  const nfc = Math.max(0, 1 - (performance.now() - vivo.tNfc) / 2500);
  grupos.NFC?.mallas.forEach(m => { if (!m.userData.real) m.material.emissiveIntensity = .03 + .8 * nfc; });
  brillan.NFC.forEach(m => { m.emissiveIntensity = .9 * nfc; });
  brillan.Arduino.forEach(m => { m.emissiveIntensity = .03 + .35 * Math.max(0, 1 - (performance.now() - vivo.tLote) / 800); });
  if (viaje) {
    const k = Math.min(1, dt * 4);
    ctrl.target.lerp(viaje.target, k); cam.position.lerp(viaje.cam, k);
    if (cam.position.distanceTo(viaje.cam) < .002) viaje = null;
  }
  if (giro) { const a = dt * .12, v = cam.position.clone().sub(ctrl.target); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), a); cam.position.copy(ctrl.target).add(v); }
  ctrl.update();
  ren.render(esc, cam); css.render(esc, cam);
  pintarEtiquetas();
}

/* datos en vivo: la sesión de la tablet (SSE), el pulso de quien tiene la sesión y de dónde llegan los datos */
async function leerVivo() {
  try { vivo.sesion = await (await fetch(URL_BASE + '/v1/sesion?lector=station', { cache: 'no-store' })).json(); } catch {}
  try { vivo.fuentes = await (await fetch(URL_BASE + '/v1/fuentes', { cache: 'no-store' })).json(); } catch {}
  const i = vivo.sesion?.trip ? +vivo.sesion.trip.slice(1) - 1 : -1;
  vivo.pulso = i >= 0 && typeof ultimo !== 'undefined' && ultimo?.trip?.[i] ? ultimo.trip[i].pulso : null;
}
function escuchar() {
  const es = new EventSource(URL_BASE + '/v1/flujo');
  es.onmessage = e => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.tipo === 'sesion' && d.lector === 'station') { vivo.tNfc = performance.now(); leerVivo(); }
    if (d.tipo === 'estado') vivo.tLote = performance.now();
  };
  es.onerror = () => { es.close(); setTimeout(escuchar, 3000); };
}

window.abrirHardware = async function () {
  if (!ren) { try { await montar(); } catch (e) { $('hwCarga').textContent = 'Could not load the station model.'; console.error(e); return; } escuchar(); setInterval(leerVivo, 3000); }
  leerVivo(); medir();
  if (!corre) { corre = true; tAnt = performance.now(); requestAnimationFrame(cuadro); }
};
document.addEventListener('click', e => {
  const pz = e.target.closest('[data-hwpieza]'); if (pz && ctrl) { aislar(pz.dataset.hwpieza); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'hwVolver') { volver(); return; }
  if (b.id === 'hwExplotar' && solo) volver();
  if (b.id === 'hwExplotar' && ctrl) {
    const f = explotarObj ? 1 / 1.45 : 1.45, dy = explotarObj ? .045 : -.045;
    const target = ctrl.target.clone().add(new THREE.Vector3(0, dy, 0));
    viaje = { target, cam: target.clone().add(cam.position.clone().sub(ctrl.target).multiplyScalar(f)) };
  }
  if (b.id === 'hwExplotar') { explotarObj = explotarObj ? 0 : 1; b.classList.toggle('on', !!explotarObj); b.textContent = explotarObj ? 'Assembled' : 'Exploded view'; }
  if (b.id === 'hwGiro') { giro = !giro; b.classList.toggle('on', giro); }
  if (b.id === 'hwPantalla') { const v = $('hwGrande'); v.hidden = !v.hidden; if (!v.hidden && !v.firstChild) v.innerHTML = '<iframe src="station.html?lector=station&mudo"></iframe>'; b.classList.toggle('on', !v.hidden); }
});
