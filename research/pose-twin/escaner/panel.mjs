/* Panel de pose-twin sobre el escáner: instrucciones en pantalla, 8 ángulos, calibración y perfil personal.
   El perfil queda solo en localStorage de este navegador. Aquí no hay ninguna petición de red ni se guardan imágenes. */
import { Sesion, ANGULOS, UMBRAL_VIS, nombreSeguro } from './angulos.mjs';
import { SerieSentadilla, visibilidadLados, aCsv } from './sentadilla.mjs';
import { medidasPerfil, TOLERANCIA } from './figura.mjs';

const CLAVE = 'pose-twin:perfil';
const PIERNAS = [25, 26, 27, 28];
const SIN_CUADROS_S = 1.5; // sin resultados de visión durante este tiempo, las cifras ya no valen
const ETIQUETA = {
  codo_izq: 'Codo izquierdo', codo_der: 'Codo derecho', hombro_izq: 'Hombro izquierdo', hombro_der: 'Hombro derecho',
  cadera_izq: 'Cadera izquierda', cadera_der: 'Cadera derecha', rodilla_izq: 'Rodilla izquierda', rodilla_der: 'Rodilla derecha',
};

const $ = id => document.getElementById(id);
const ahora = () => performance.now() / 1000;
const poner = (el, texto) => { if (el.textContent !== texto) el.textContent = texto; };
const num = (v, d = 0) => (v === null || v === undefined ? '--' : v.toFixed(d));

function bajar(texto, tipo, archivo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = archivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Instrucción del momento durante una serie (mismo orden que pose_twin/dibujo.py: pasos_sentadilla). */
function instruccionSentadilla(s) {
  if (s.fase === 'preparando') return [`Ponte DE LADO a la cámara, a 2 o 3 m, cuerpo completo y de pie. Empieza en ${Math.ceil(s.faltan_s)} s. S cancela.`, 'aviso', 3];
  if (s.fase === 'buscando') return [s.sin_vista ? 'No veo tu pierna: ponte de lado, con cadera, rodilla y pie a la vista, y con luz.'
    : 'De lado, de pie y quieto un segundo para tomar el punto de partida.', 'aviso', 4];
  if (s.fase === 'listo' || s.fase === 'abajo') {
    if (s.sin_vista) return ['No veo tu pierna: vuelve a mostrar cadera, rodilla y pie, de lado.', 'mal', 5];
    if (s.fase === 'abajo') return [`Sube hasta quedar de pie. Repeticiones: ${s.n}.`, 'bien', 5];
    if (!s.n) return ['YA: haz sentadillas a tu ritmo, de lado, y vuelve a quedar de pie en cada una.', 'bien', 5];
    const fin = s.fin_en_s === null ? 'pulsa S' : `quédate de pie ${Math.ceil(s.fin_en_s)} s o pulsa S`;
    return [`Repeticiones: ${s.n}. Sigue, o para terminar ${fin}.`, 'bien', 5];
  }
  if (s.n) return [`Serie terminada: ${s.n} repeticiones. Mira el resultado abajo y descárgalo si quieres guardarlo. S hace otra serie.`, 'bien', 6];
  return ['No se contó ninguna repetición. Empieza de lado y de pie; baja y vuelve a subir. Pulsa S para repetir.', 'mal', 6];
}

function leerPerfil() {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE));
    return p && p.version === 1 && p.angulos && p.segmentos && typeof p.nombre === 'string' ? p : null;
  } catch { return null; }
}

export function crearPanel() {
  const guardado = leerPerfil();
  const sesion = new Sesion({ nombre: guardado?.nombre ?? 'perfil', perfil: guardado });
  let estado = null, pose = null, tCuadro = -1e9, tPintado = 0, avisoGuardado = '', serie = null;

  const nombre = $('ptNombre'), bCal = $('ptCalibrar'), bBajar = $('ptBajar'), bBorrar = $('ptBorrar');
  nombre.value = sesion.nombre;
  $('ptFilas').replaceChildren(...Object.keys(ANGULOS).map(k => {
    const tr = document.createElement('tr');
    tr.dataset.angulo = k;
    const th = document.createElement('th'); th.scope = 'row'; th.textContent = ETIQUETA[k];
    const v = document.createElement('td'); v.className = 'v'; v.textContent = '--';
    const d = document.createElement('td'); d.className = 'd'; d.textContent = '--';
    tr.append(th, v, d);
    return tr;
  }));
  const filas = [...$('ptFilas').children];

  /* Figura 3D: con un perfil aceptado se usa por defecto; el botón o la tecla F vuelven al ajuste en vivo. */
  const bFigura = $('ptFigura');
  let quierePerfil = true, revisado, revision = medidasPerfil(null);
  function figura() {
    if (sesion.perfil !== revisado) { revisado = sesion.perfil; revision = medidasPerfil(revisado); }
    return revision;
  }
  function alternarFigura() {
    if (!figura().medidas) return;
    quierePerfil = !quierePerfil; pintar();
  }
  function pintarFigura() {
    const { medidas, motivo } = figura(), usa = !!medidas && quierePerfil;
    poner(bFigura, `Figura: ${usa ? 'mi perfil' : 'en vivo'} (F)`);
    bFigura.disabled = !medidas;
    bFigura.setAttribute('aria-pressed', String(usa));
    poner($('ptFiguraNota'), usa
      ? `Hombros, torso, brazos, antebrazos, muslos y piernas toman el tamaño de tu perfil (como máximo ${Math.round(TOLERANCIA * 100)} % distinto de lo que se ve ahora). La posición y la orientación siguen la imagen; el extremo de un brazo o pierna puede quedar unos centímetros corrido. Cabeza y caderas no se miden con el perfil.`
      : medidas ? 'La figura toma su tamaño solo de lo que ve la cámara ahora, como en el escáner original.'
        : !sesion.perfil ? 'Sin perfil: la figura se ajusta en vivo. Calibra para poder usar tu perfil.'
          : `El perfil guardado no se usa en la figura: ${motivo}. Calibra de nuevo.`);
  }
  bFigura.addEventListener('click', alternarFigura);

  const serieActiva = () => serie !== null && !serie.terminada;
  const bSent = $('ptSentadilla'), bCsv = $('ptSentCsv'), bJson = $('ptSentJson');

  function sentadilla() {
    if (sesion.ocupada) return;
    avisoGuardado = '';
    if (serieActiva()) serie.terminar();
    else serie = new SerieSentadilla();
    pintar();
  }
  const archivoSerie = ext => `sentadilla_${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_')}.${ext}`;
  bSent.addEventListener('click', sentadilla);
  bCsv.addEventListener('click', () => bajar(aCsv(serie.resultado()), 'text/csv', archivoSerie('csv')));
  bJson.addEventListener('click', () => bajar(JSON.stringify(serie.resultado(), null, 2), 'application/json', archivoSerie('json')));

  function calibrar() {
    if (sesion.ocupada || serieActiva()) return;
    serie = null;
    try { sesion.nombre = nombreSeguro(nombre.value || 'perfil'); }
    catch (e) { avisoGuardado = e.message; nombre.focus(); pintar(); return; }
    nombre.value = sesion.nombre; avisoGuardado = '';
    sesion.iniciarCalibracion(ahora());
    estado = null; pintar();
  }

  function guardar(perfil) {
    try { localStorage.setItem(CLAVE, JSON.stringify(perfil)); avisoGuardado = ''; }
    catch { avisoGuardado = 'El navegador no permitió guardar el perfil. Descarga el JSON antes de cerrar la página.'; }
  }

  bCal.addEventListener('click', calibrar);
  addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const tecla = e.key.toLowerCase();
    if (tecla === 'c') calibrar();
    else if (tecla === 's') sentadilla();
    else if (tecla === 'f') alternarFigura();
  });
  bBajar.addEventListener('click', () => {
    if (!sesion.perfil) return;
    bajar(JSON.stringify(sesion.perfil, null, 2), 'application/json', `${nombreSeguro(sesion.perfil.nombre)}.json`);
  });
  bBorrar.addEventListener('click', () => {
    if (!sesion.perfil || !confirm('¿Borrar el perfil guardado en este navegador?')) return;
    try { localStorage.removeItem(CLAVE); } catch { avisoGuardado = 'El navegador no permitió borrar el perfil.'; }
    sesion.perfil = null; sesion.resultado = null;
    if (estado) estado.diferencias = null;
    pintar();
  });

  /* La instrucción del momento (mismo orden de decisión que pose_twin/dibujo.py: pasos). */
  function instruccion(vivo) {
    if (avisoGuardado) return [avisoGuardado, 'mal', 0];
    if (!vivo) return [tCuadro < 0 ? 'Cargando la cámara y la visión en este equipo. Espera unos segundos.'
      : 'No llegan cuadros de la cámara. Revisa que la pestaña esté visible y la cámara conectada.', 'aviso', 0];
    const r = sesion.resultado;
    if (serie) return instruccionSentadilla(serie.estado(tCuadro));
    if (estado?.preparando != null) return [`Aléjate y ponte de pie, de frente, con los brazos algo separados. La captura empieza en ${Math.ceil(estado.preparando)} s.`, 'aviso', 3];
    if (estado?.calibrando != null) return [`Quieto: calibrando ${Math.floor(100 * estado.calibrando)} %. Cuadros válidos: ${estado.muestras}.`
      + (estado.calidad !== 'buena' ? ' Ahora no se ve bien: muestra el cuerpo completo y busca más luz.' : ''), 'aviso', 4];
    if (sesion.pendiente) return ['Preparando la calibración.', 'aviso', 3];
    if (r && !r.ok) {
      const motivo = r.motivo.replace('dispersion', 'dispersión').replace('maximo', 'máximo');
      return [`No se pudo calibrar. ${motivo}${sesion.perfil ? ' El perfil anterior se mantiene.' : ''} Luego pulsa C otra vez.${r.aviso ? ` ${r.aviso}` : ''}`, 'mal', 2];
    }
    if (!pose) return ['No te veo: ponte frente a la cámara, con luz de frente.', 'aviso', 1];
    if (Math.min(...PIERNAS.map(i => pose.visibilidad[i])) < UMBRAL_VIS) return ['Aléjate hasta que se vean rodillas y pies.', 'aviso', 1];
    if (r?.ok) return [`Calibración guardada con ${r.muestras} cuadros. Ya puedes moverte: la columna Diferencia compara con tu postura de pie.${r.aviso ? ` ${r.aviso}` : ''}`, r.aviso ? 'aviso' : 'bien', 5];
    if (sesion.perfil) return ['Muévete: dobla codos y rodillas y mira la diferencia con tu perfil. Pulsa C para calibrar de nuevo o S para medir sentadillas.', 'bien', 5];
    return ['Cuerpo completo visible. Pulsa Calibrar (C) o Sentadilla (S).', 'bien', 2];
  }

  let filasPintadas = '';
  function pintarSerie(s) {
    $('ptSerie').hidden = !s;
    poner(bSent, serieActiva() ? 'Terminar serie (S)' : 'Sentadilla (S)');
    bSent.disabled = sesion.ocupada;
    bCsv.disabled = bJson.disabled = !(s && s.fase === 'fin' && s.n);
    if (!s) return;
    poner($('ptReps'), `Repeticiones: ${s.n}${s.descartadas ? ` (no contadas: ${s.descartadas})` : ''}`);
    const lista = serie.repeticiones, firma = `${lista.length}:${serie.t0}`;
    if (firma !== filasPintadas) {
      filasPintadas = firma;
      $('ptSerieFilas').replaceChildren(...lista.map(r => {
        const tr = document.createElement('tr');
        for (const texto of [r.n, num(r.rodilla_min), num(r.cadera_min), num(r.bajada_s, 1), num(r.subida_s, 1),
          r.dif_rodilla === null ? '--' : `${r.dif_rodilla > 0 ? '+' : ''}${num(r.dif_rodilla)}`, r.calidad]) {
          const td = document.createElement('td'); td.textContent = String(texto); tr.append(td);
        }
        return tr;
      }));
    }
    const res = s.resumen;
    $('ptResumen').hidden = !res || !s.n;
    if (res && s.n) {
      poner($('ptResumen'), [['rodilla_min', 'Rodilla mínima', '°', 0], ['cadera_min', 'Cadera mínima', '°', 0],
        ['bajada_s', 'Bajada', ' s', 1], ['subida_s', 'Subida', ' s', 1], ['dif_rodilla', 'Diferencia de rodilla (izq. menos der.)', '°', 0]]
        .map(([k, nombreMetrica, u, d]) => (res[k].n ? `${nombreMetrica}: media ${num(res[k].media, d)}${u}, desviación ${num(res[k].de, d)}${res[k].de === null ? '' : u} (n=${res[k].n})`
          : `${nombreMetrica}: -- (no se vio lo suficiente)`)).join('\n'));
    }
  }

  function pintar() {
    const vivo = ahora() - tCuadro < SIN_CUADROS_S;
    const [texto, tono, paso] = instruccion(vivo);
    const ins = $('ptAhora');
    poner(ins, texto); ins.dataset.tono = tono;
    [...$('ptPasos').children].forEach((li, i) => li.toggleAttribute('data-activo', i + 1 === paso));

    const s = serie ? serie.estado(tCuadro) : null;
    pintarSerie(s);
    if (s) [...$('ptPasos').children].forEach(li => li.removeAttribute('data-activo'));
    [...$('ptPasosSent').children].forEach((li, i) => li.toggleAttribute('data-activo', !!s && i + 1 === paso));
    const prep = vivo ? estado?.preparando ?? s?.faltan_s ?? null : null, cap = vivo ? estado?.calibrando : null;
    const cuenta = $('ptCuenta'), barra = $('ptBarra');
    cuenta.hidden = prep == null; if (prep != null) poner(cuenta, String(Math.ceil(prep)));
    barra.hidden = cap == null; if (cap != null) barra.value = cap;

    poner($('ptCalidad'), vivo && estado ? `Calidad: ${estado.calidad}` : 'Calidad: --');
    $('ptCalidad').dataset.calidad = vivo && estado ? estado.calidad : '';
    for (const tr of filas) {
      const k = tr.dataset.angulo, v = vivo ? estado?.angulos[k] ?? null : null;
      const d = v === null ? null : estado.diferencias?.angulos[k] ?? null;
      poner(tr.children[1], v === null ? '--' : `${v.toFixed(0)}°`);
      const dr = d === null ? null : Math.round(d) || 0;
      poner(tr.children[2], dr === null ? '--' : `${dr > 0 ? '+' : ''}${dr}°`);
    }
    poner($('ptPerfil'), sesion.perfil ? `Perfil: ${sesion.perfil.nombre} (${sesion.perfil.muestras} cuadros, ${sesion.perfil.creado.replace('T', ' ')})` : 'Sin perfil calibrado');
    bCal.disabled = sesion.ocupada || serieActiva(); nombre.disabled = sesion.ocupada;
    bBajar.disabled = bBorrar.disabled = !sesion.perfil || sesion.ocupada;
    pintarFigura();
  }
  setInterval(pintar, 250);
  pintar();

  return {
    sesion,
    get estado() { return estado; },
    get pose() { return pose; },
    get serie() { return serie; },
    cuadros: 0,
    /** Largos del perfil (m) para la figura 3D, o null para ajustarla en vivo. */
    get figura() { return quierePerfil ? figura().medidas : null; },
    usoFigura: null, // lo escribe escaner.js en cada cuadro del ajuste 3D
    /** p: la persona elegida por el escáner (o null); tc: tiempo del cuadro en ms; vw, vh: tamaño del video. */
    cuadro(p, tc, vw, vh) {
      pose = null;
      if (p && p.lm.length >= 33) {
        const mundo = p.mundo.length >= 33;
        // 3D sin suavizar; sin ellos, los píxeles de la imagen con z = 0 (como sesion.py)
        const puntos = mundo ? p.mundo.map(q => [q.x, q.y, q.z]) : p.lm.map(q => [q.x * vw, q.y * vh, 0]);
        pose = { puntos, mundo, visibilidad: p.lm.map(q => q.v) };
      }
      tCuadro = tc / 1000; this.cuadros++;
      estado = sesion.paso(pose, tCuadro);
      serie?.paso(estado.angulos, tCuadro, pose ? visibilidadLados(pose.visibilidad) : null);
      if (estado.perfilNuevo) guardar(sesion.perfil);
      if (tc - tPintado > 100) { tPintado = tc; pintar(); }
    },
  };
}
