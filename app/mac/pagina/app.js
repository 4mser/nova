/* El widget: NOVA flotando, con dos modos.
   · NOVA (⌥Espacio o clic): asistente personal por el puente de voz (Gemini). Doble clic: escribirle.
   · CLAUDE (⌥⇧Espacio): Claude Code con voz 100 % local; muestra cada paso y pide permiso para lo riesgoso.
   NOVA sigue el cursor por toda la pantalla y reacciona cuando se le acerca. Arrastrar: mover. Clic derecho: menú. */
import { Nova } from './nova.js';
import { Conversacion } from './voz.js';
import { Altavoz, Grabadora } from './grabar.js';
import { renderizar } from './visual.js';

const $ = id => document.getElementById(id);
const nova = new Nova($('nova'));
const mac = window.mac;
const grabadora = new Grabadora(), altavoz = new Altavoz();

const SILENCIO_MAX = 25e3; // NOVA: sin voz por este rato, la conversación se cierra sola
const DORMIR = 5 * 60e3;   // sin uso, NOVA se duerme
const PANEL_VIDA = 14e3;   // el panel se esconde solo después de esto sin novedades

let config = null, usuario = null, conv = null, ultimo = Date.now();
let modo = 'nova';         // 'nova' | 'claude'
let fase = 'quieta';       // quieta | conectando | escuchando | pensando | hablando | trabajando
let claudeOcupado = false, preguntaActual = null, escondePanel = null, ultimaNota = null;
// voz de Claude: cada respuesta hablada lleva un número; callar o pedir otra cosa la invalida aunque aún no llegue
let vozTurno = 0, esperandoVoz = false;
const UMBRAL_VOZ = 0.03, UMBRAL_ENCIMA = 0.05; // hablar encima de NOVA exige más volumen que su propia voz

/* ════════ panel ════════ */
const hilo = $('hilo'), panel = $('panel');
/* UNA SOLA NOVA (pedido de Nico, 15 oct): ya no hay modo Claude aparte. Cuando NOVA le encarga algo al computador
   (herramienta en_el_mac → Claude Code), se pone naranja mientras trabaja y después ella dice el resultado */
function enElMac(on) {
  document.body.classList.toggle('claude', on);
  $('modo').querySelector('b').textContent = on ? 'NOVA · MAC' : 'NOVA';
  if (on) { const e = $('escena'); e.classList.remove('cambio'); void e.offsetWidth; e.classList.add('cambio'); }
}
function ponerModo(m) {
  m = 'nova'; // (se conserva la firma; el modo Claude aparte ya no existe)
  const cambio = m !== modo;
  modo = m;
  document.body.classList.toggle('claude', m === 'claude');
  $('modo').querySelector('b').textContent = m === 'claude' ? 'CLAUDE' : 'NOVA';
  $('chip-modo').querySelector('b').textContent = m === 'claude' ? 'CLAUDE' : 'NOVA';
  $('chip-modo').title = m === 'claude' ? 'Modo Claude · clic para pasar a NOVA' : 'Modo NOVA · clic para pasar a Claude';
  if (cambio) { const e = $('escena'); e.classList.remove('cambio'); void e.offsetWidth; e.classList.add('cambio'); }
}

/* ── cambio de modo por voz: se revisa ANTES de mandar nada al modelo ──
   «modo Claude», «cambia a Nova», «pásame a Claude», «habla con Nova», «vuelve a Nova»…, o el nombre del OTRO modo
   al comienzo seguido de una pausa («Claude, abre Nexium»). Lo que viene después es el primer pedido en el modo nuevo. */
const A_MODO = /^[\s¡¿,.]*(?:(?:oye|hey|ey|ok(?:ay)?)[\s,.]+)?(?:modo|cambia(?:r|me|te)?\s+(?:a|al)(?:\s+modo)?|p[aá]sa(?:me|te)?\s+(?:a|al)(?:\s+modo)?|pasemos\s+a|vamos\s+a|vuelve\s+a|vuelvo\s+a|habla(?:r)?\s+con|quiero\s+hablar\s+con|ponte\s+en(?:\s+modo)?|activa(?:r)?(?:\s+el)?\s+modo)\s+(claude|clod|cloud|clo|nova|noba)\b[\s,.:;!?¿¡]*(.*)$/i;
const POR_NOMBRE = /^[\s¡¿,.]*(?:(?:oye|hey|ey|ok(?:ay)?)[\s,.]+)?(claude|clod|cloud|nova|noba)(?:[\s]*[,.:;!?¿¡]+|\s+(?=\S))\s*(.*)$/i;
function detectarCambio(texto, actual) {
  return null; // una sola NOVA: no hay a qué modo cambiar
}
function detectarCambioAntiguo(texto, actual) {
  const t = String(texto ?? '').trim();
  const m = t.match(A_MODO);
  if (m) return { destino: /^c/i.test(m[1]) ? 'claude' : 'nova', resto: m[2].trim() };
  const n = t.match(POR_NOMBRE);
  if (!n) return null;
  const destino = /^c/i.test(n[1]) ? 'claude' : 'nova';
  // «Nova, …» en modo Nova es solo hablarle; «Claude, …» sin oye/hey/coma en modo Claude también
  if (destino === actual) return null;
  // sin coma ni «oye», el nombre de pasada no cuenta («claude dijo que…»); con «oye/hey» o puntuación sí
  if (!/[,.:;!?¿¡]/.test(t.slice(0, n[0].length - n[2].length)) && !/^(?:[\s¡¿,.]*(?:oye|hey|ey|ok))/i.test(t)) return null;
  return { destino, resto: n[2].trim() };
}
/** escuchar: false solo cambia de modo (el chip, estando quieta); true sigue la conversación en el otro modo */
function cambiarModo(destino, resto = '', { escuchar = true } = {}) {
  ultimo = Date.now();
  vozTurno++; esperandoVoz = false; altavoz.callar(); grabadora.parar();
  if ((!escuchar || micOff) && resto.length <= 2) {
    if (conv) cerrarNova();
    ponerModo(destino);
    ponerFase(claudeOcupado ? 'trabajando' : 'quieta', destino === 'claude' ? 'Modo Claude · tócala para hablar' : 'Modo NOVA · tócala para hablar');
    return;
  }
  if (destino === 'claude') {
    if (conv) { conv.silenciar(); cerrarNova(); }
    ponerModo('claude');
    if (resto.length > 2) { nuevoTurno(); lineaTu(resto); return pedirClaude(resto); }
    return escucharClaude();
  }
  ponerModo('nova');
  abrirNova(resto.length > 2 ? resto : undefined).then(() => { if (resto.length > 2) { tuActual = lineaTu(resto); turnoNuevo = false; } });
}
// cerrado con la ×: no se vuelve a abrir solo hasta tu próximo pedido (o algo que necesite tu respuesta)
let panelCerrado = false;
function mostrarPanel(forzar = false) { if (panelCerrado && !forzar) return; if (forzar) panelCerrado = false; clearTimeout(escondePanel); panel.classList.remove('oculto'); }
function cerrarPanel() { panelCerrado = true; clearTimeout(escondePanel); panel.classList.add('oculto'); }
function soltarPanel(ms = PANEL_VIDA) {
  clearTimeout(escondePanel);
  // con visuales el panel dura más: se están mirando
  if (panel.classList.contains('ancho')) ms = Math.max(ms, 60e3);
  escondePanel = setTimeout(() => { if (fase === 'quieta' && !preguntaActual && !panel.matches(':hover')) panel.classList.add('oculto'); else soltarPanel(4000); }, ms);
}
function estado(texto, mal = false) {
  const e = $('estado');
  e.textContent = texto; e.classList.toggle('mal', mal);
  if (texto) mostrarPanel();
}
function ponerFase(f, texto) {
  fase = f;
  panel.classList.toggle('vivo', f === 'pensando' || f === 'trabajando' || f === 'conectando');
  if (texto !== undefined) estado(texto);
  nova.brillo = f === 'escuchando' ? 1 : 0;
  if (f === 'pensando' || f === 'trabajando') { nova.expresion('pensativa'); nova.mirar([0.5, -0.5]); }
  else if (f === 'escuchando') { nova.expresion('normal'); nova.mirar([0, 0.25]); }
  else if (f === 'quieta') { nova.expresion('normal'); nova.mirar(null); soltarPanel(); }
}
function nuevoTurno() { panelCerrado = false; hilo.replaceChildren(); panel.classList.remove('ancho'); }

/** un bloque visual en el panel (el panel se ensancha); ⤢ lo abre en grande */
function mostrarBloque(b) {
  if (!b?.tipo) return;
  panel.classList.add('ancho');
  hilo.append(renderizar(b, { abrir: url => mac.abrirUrl(url), ampliar: x => mac.ampliar(x), ampliarImagen: it => mac.ampliar({ tipo: 'imagenes', titulo: it.titulo, items: [it] }), md }));
  mostrarPanel(); bajar();
  setTimeout(bajar, 60);
}

/* lo que devuelven las herramientas de NOVA, convertido en algo que se ve */
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function visualDeHerramienta(nombre, args, r, imagen) {
  if (r.ok === false) return null;
  if (imagen) return { tipo: 'imagenes', titulo: nombre === 'pantallazo' ? 'Pantallazo' : 'Tu pantalla', items: [{ src: `data:image/jpeg;base64,${imagen}` }] };
  switch (nombre) {
    case 'mi_github': {
      if (r.contribuciones_anio != null) return { tipo: 'metricas', titulo: `GitHub de ${r.login ?? 'ti'} · este año`, items: [{ etiqueta: 'Contribuciones', valor: r.contribuciones_anio }, { etiqueta: 'Días activos', valor: r.dias_activos }, { etiqueta: 'Racha actual', valor: r.racha_actual_dias, unidad: 'días' }] };
      if (r.prs_abiertos && Array.isArray(r.prs_abiertos)) return { tipo: 'lista', titulo: 'Pendiente en GitHub', items: [...r.revisiones_que_te_piden.map(t => ({ texto: t, detalle: 'Te piden revisión' })), ...r.prs_abiertos.map(t => ({ texto: t, detalle: 'Tu PR abierto' })), ...r.issues_asignados.map(t => ({ texto: t, detalle: 'Issue asignado' }))] };
      return [
        { tipo: 'metricas', titulo: 'GitHub hoy', items: [{ etiqueta: 'Commits hoy', valor: r.commits_hoy }, { etiqueta: 'Esta semana', valor: r.contribuciones_semana, unidad: 'contrib.' }, { etiqueta: 'PRs abiertos', valor: r.prs_abiertos }, { etiqueta: 'Por revisar', valor: r.revisiones_pendientes }] },
        Array.isArray(r.por_dia_semana) && r.por_dia_semana.length ? { tipo: 'grafico', titulo: 'Contribuciones · últimos 7 días', forma: 'barras', etiquetas: r.por_dia_semana.map((_, i, a) => DIAS[(new Date().getDay() - (a.length - 1 - i) + 7) % 7]), series: [{ nombre: 'Contribuciones', valores: r.por_dia_semana }] } : null,
      ];
    }
    case 'leer_lista': return { tipo: 'lista', titulo: r.lista, subtitulo: `${r.pendientes.length} pendientes${r.hechos ? ` · ${r.hechos} hechos` : ''}`, items: r.pendientes.map(t => ({ texto: t })) };
    case 'tareas_externas': return { tipo: 'tabla', titulo: 'Tareas en otras apps', columnas: ['Tarea', 'Dónde', 'Vence'], filas: r.tareas.map(t => [t.titulo, t.en, t.vence ?? '']) };
    case 'carga_equipo': return { tipo: 'grafico', titulo: 'Carga del equipo', subtitulo: 'Tareas abiertas y vencidas por persona', forma: 'barras_h', etiquetas: r.personas.map(p => p.quien), series: [{ nombre: 'Abiertas', valores: r.personas.map(p => p.abiertas) }, { nombre: 'Vencidas', valores: r.personas.map(p => p.vencidas) }] };
    case 'buscar_bitacora': return r.crew?.length ? { tipo: 'tarjetas', titulo: 'En la bitácora', items: r.crew.map(e => ({ titulo: e.texto.slice(0, 90), resumen: e.texto.length > 90 ? e.texto : '', fuente: `${e.quien} · ${e.cuando}` })) } : null;
    case 'estado_github': return r.eventos?.length ? { tipo: 'lista', titulo: 'Repos del equipo', items: r.eventos.map(e => ({ texto: `${e.titulo ?? e.tipo}`, detalle: `${e.repo} · hace ${e.hace_min} min` })) } : null;
  }
  // cualquier otra (las del teléfono): la primera lista de objetos, como tabla
  const arr = Object.values(r).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
  if (!arr) return null;
  const cols = [...new Set(arr.slice(0, 20).flatMap(o => Object.keys(o)))].filter(k => !/id$|^url$/.test(k)).slice(0, 4);
  return { tipo: 'tabla', titulo: NOMBRES[nombre] ?? nombre.replace(/_/g, ' '), columnas: cols, filas: arr.slice(0, 30).map(o => cols.map(c => (typeof o[c] === 'object' ? JSON.stringify(o[c]) : o[c]))) };
}
function bajar() { hilo.scrollTop = hilo.scrollHeight; }

/** el texto aparece palabra por palabra */
function escribir(el, texto, retraso = 0) {
  const partes = texto.split(/(\s+)/);
  let i = 0;
  for (const p of partes) {
    if (!p) continue;
    if (/^\s+$/.test(p)) { el.append(p); continue; }
    const s = document.createElement('span');
    s.className = 'p'; s.textContent = p; s.style.animationDelay = `${retraso + i++ * 28}ms`;
    el.append(s);
  }
  bajar();
}
function lineaTu(texto) { const d = document.createElement('div'); d.className = 'tu'; d.textContent = texto; hilo.append(d); bajar(); return d; }
function lineaElla(clase = '') { const d = document.createElement('div'); d.className = `ella ${clase}`; hilo.append(d); return d; }

/** markdown mínimo y seguro (se escapa todo primero) para la respuesta final de Claude */
function md(texto) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const enLinea = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const bloques = texto.replace(/```[\s\S]*?```/g, m => `\n${m.replace(/```\w*\n?/g, '').trim().split('\n').map(l => `    ${l}`).join('\n')}\n`).split(/\n{2,}/);
  return bloques.map(b => {
    const l = b.split('\n').filter(Boolean);
    if (l.length && l.every(x => /^\s*[-*•]\s/.test(x))) return `<ul>${l.map(x => `<li>${enLinea(x.replace(/^\s*[-*•]\s/, ''))}</li>`).join('')}</ul>`;
    if (l.length && l.every(x => /^ {4}/.test(x))) return `<p><code>${esc(l.map(x => x.slice(4)).join('\n'))}</code></p>`;
    return `<p>${l.map(enLinea).join('<br>')}</p>`;
  }).join('');
}

/** lo que se dice en voz alta: la primera frase, sin markdown ni código */
function paraDecir(texto) {
  const limpio = texto.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/[*_#>|]/g, '').replace(/\s+/g, ' ').trim();
  const m = limpio.match(/^.{12,220}?[.!?](\s|$)/);
  return (m ? m[0] : limpio.slice(0, 220)).trim();
}

/* ════════ ícono de los pasos ════════ */
const icono = (cual, clase = '') => `<svg class="${clase}" aria-hidden="true"><use href="#i-${cual}"/></svg>`;
const pasos = new Map();
function agregarPaso({ id, icono: ic, texto, detalle }) {
  const d = document.createElement('div');
  d.className = 'paso';
  d.innerHTML = `${icono(ic)}<span class="txt"></span><span class="marca"></span>${detalle ? '<span class="det"></span>' : ''}`;
  d.querySelector('.txt').textContent = texto;
  if (detalle) d.querySelector('.det').textContent = detalle;
  hilo.append(d); bajar();
  pasos.set(id, d);
}
function cerrarPaso(id, error) { const d = pasos.get(id); if (d) d.classList.add('listo', ...(error ? ['fallo'] : [])); }

/* ════════ onda (micrófono al escuchar, voz al hablar) ════════ */
const onda = $('onda'), octx = onda.getContext('2d'), historia = new Array(18).fill(0);
onda.width = 64 * devicePixelRatio; onda.height = 18 * devicePixelRatio;
function dibujarOnda(nivel) {
  historia.push(nivel); historia.shift();
  const w = onda.width, h = onda.height, n = historia.length, ancho = w / n;
  octx.clearRect(0, 0, w, h);
  octx.fillStyle = getComputedStyle(document.body).getPropertyValue('--acento').trim() || '#5ad8f2';
  historia.forEach((v, i) => {
    const alto = Math.max(2 * devicePixelRatio, v * h);
    octx.globalAlpha = 0.35 + 0.65 * (i / n);
    octx.beginPath(); octx.roundRect(i * ancho + ancho * 0.2, (h - alto) / 2, ancho * 0.6, alto, ancho * 0.3); octx.fill();
  });
}

/* ════════ NOVA personal (puente de voz) ════════ */
const NOMBRES = { crear_tarea: 'Tarea creada', completar_tarea: 'Tarea completada', editar_tarea: 'Tarea movida', agregar_a_lista: 'Agregado a la lista', marcar_en_lista: 'Marcado', leer_lista: 'Lista', poner_alarma: 'Alarma', poner_temporizador: 'Temporizador', recordarme: 'Recordatorio', pantallazo: 'Pantallazo', mirar_pantalla: 'Mirando tu pantalla', leer_pantalla: 'Leyendo la pantalla', abrir_app: 'App abierta', control_musica: 'Música', poner_musica: 'Música', volumen: 'Volumen', copiar: 'Copiado', navegar: 'Ruta abierta', linterna: 'Linterna', marcar_habito: 'Hábito', leer_mensajes: 'Mensajes', leer_notificaciones: 'Notificaciones', llamar: 'Llamando', mi_github: 'GitHub', escribir_diario: 'Bitácora' };
let turnoNuevo = true, ellaActual = null, tuActual = null, cambioPendiente = null;

function fallar(msg) {
  estado(msg, true);
  nova.expresion('triste'); setTimeout(() => nova.expresion('normal'), 2500);
  soltarPanel(6000);
}

async function abrirNova(primerTexto) {
  if (conv) return;
  if (!config?.vozToken) return fallar('Falta VOZ_TOKEN en mac/.env');
  cancelarClaude(false);
  ponerModo('nova');
  ultimo = Date.now(); turnoNuevo = true;
  nuevoTurno();
  ponerFase('conectando', 'Conectando…');
  const url = `${config.vozUrl.replace(/^http/, 'ws')}/vivo?k=${encodeURIComponent(config.vozToken)}`;
  // el contexto llega mientras el puente conecta y el micrófono se abre (no se espera antes)
  const contexto = mac.contexto().catch(() => '').then(datos => ({ nombre: usuario?.usuario?.nombre ?? 'Nico', datos }));
  conv = new Conversacion({
    url, contexto,
    eventos: {
      estado: e => {
        if (e === 'escuchando') ponerFase('escuchando', 'Te escucho');
        else if (e === 'cerrada') { conv = null; ponerFase('quieta', ''); }
      },
      oye: t => {
        ultimo = Date.now();
        if (turnoNuevo || !tuActual) { if (turnoNuevo) nuevoTurno(); ellaActual = null; turnoNuevo = false; tuActual = lineaTu(''); }
        tuActual.textContent += t; bajar();
        // «chao Nova»: si la frase termina ahí (0,7 s sin más palabras), cierra sin esperar la respuesta
        clearTimeout(despedidaPendiente); despedidaPendiente = null;
        if (DESPEDIDA.test(tuActual.textContent)) despedidaPendiente = setTimeout(() => despedirse(), 700);
        // «modo Claude…» dicho a NOVA: se calla, no ejecuta nada y pasa a Claude con lo que venga después
        const cambio = detectarCambio(tuActual.textContent, 'nova');
        if (cambio?.destino === 'claude') {
          if (!cambioPendiente) { conv?.silenciar(); estado('Pasando a Claude…'); }
          clearTimeout(cambioPendiente);
          const dicho = tuActual.textContent;
          cambioPendiente = setTimeout(() => { cambioPendiente = null; const c = detectarCambio(dicho, 'nova'); if (c) cambiarModo('claude', c.resto); }, 900);
          return;
        }
        if (fase === 'escuchando') ponerFase('pensando', 'Pensando…');
      },
      dice: t => {
        if (cambioPendiente) return;
        ultimo = Date.now();
        if (turnoNuevo) { nuevoTurno(); turnoNuevo = false; }
        ellaActual ??= lineaElla();
        if (fase !== 'hablando') ponerFase('hablando', 'Hablando');
        escribir(ellaActual, t);
      },
      interrumpe: () => { ultimo = Date.now(); ponerFase('escuchando', 'Te escucho'); },
      finTurno: () => { ultimo = Date.now(); turnoNuevo = true; ellaActual = null; tuActual = null; if (conv) ponerFase('escuchando', 'Te escucho'); },
      herramienta: async (nombre, args) => {
        if (nombre === 'en_el_mac') { ultimo = Date.now(); return encargarAlMac(args?.pedido); }
        if (cambioPendiente) return { ok: false, motivo: 'cancelled: the user is switching to Claude mode' };
        ultimo = Date.now();
        estado('Haciéndolo…');
        const { _imagen, _vista, ...r } = (await mac.herramienta(nombre, args)) ?? {};
        if (_imagen) conv?.imagen(_imagen);
        const chip = document.createElement('div');
        chip.className = `accion ${r.pendiente ? 'espera' : r.ok === false ? 'mal' : ''}`;
        chip.innerHTML = icono(r.en === 'telefono' || r.pendiente ? 'telefono' : r.ok === false ? 'mal' : 'ok');
        chip.append(r.pendiente ? 'Esperando al teléfono' : `${NOMBRES[nombre] ?? nombre.replace(/_/g, ' ')}${r.ok === false ? ' · no se pudo' : ''}`);
        hilo.append(chip); bajar();
        for (const b of [visualDeHerramienta(nombre, args, r, _imagen ?? _vista)].flat()) if (b) mostrarBloque(b);
        nova.expresion(r.ok === false ? (r.pendiente ? 'pensativa' : 'triste') : 'feliz');
        setTimeout(() => nova.expresion(fase === 'pensando' ? 'pensativa' : 'normal'), 1800);
        return r;
      },
      error: fallar,
    },
  });
  try { await conv.abrir(); if (primerTexto) conv.texto(primerTexto); }
  catch (e) { conv?.cerrar(); fallar(e?.name === 'NotAllowedError' ? 'Sin permiso de micrófono' : 'No pude abrir la conversación'); }
}
function cerrarNova() { conv?.cerrar(); }

/* ════════ encargos al Mac (Claude Code) ════════
   NOVA llama en_el_mac: Claude trabaja (los pasos se ven en el panel, NOVA en naranja). Si termina en 25 s, el
   resultado vuelve a NOVA y ella lo dice; si no, NOVA avisa que sigue y el resultado llega después (a la conversación
   si sigue abierta, o con su voz si ya se cerró) */
let encargo = null;
function encargarAlMac(pedido) {
  pedido = String(pedido ?? '').trim();
  if (!pedido) return { ok: false, motivo: 'empty request' };
  if (encargo?.res) encargo.res({ ok: false, motivo: 'replaced by a newer request' });
  clearTimeout(encargo?.t);
  claudeOcupado = true; pasos.clear(); ultimaNota = null;
  enElMac(true);
  agregarPaso({ id: 'encargo', icono: 'agente', texto: pedido.length > 120 ? `${pedido.slice(0, 117)}…` : pedido });
  mostrarPanel(); estado('Trabajando en el Mac…');
  mac.claude.pedir(pedido);
  return new Promise(res => {
    const e = (encargo = { res, t: null });
    e.t = setTimeout(() => { if (encargo === e && e.res) { e.res = null; res({ ok: true, en_curso: true, nota: 'Still working on the Mac. The result will arrive later as a message: tell them then.' }); } }, 25e3);
  });
}
/** Claude terminó un encargo: el detalle al panel, el resultado a NOVA (o a su voz si la conversación se cerró) */
function terminarEncargo(ev) {
  const e = encargo; encargo = null; clearTimeout(e.t);
  enElMac(false); cerrarPaso('encargo', ev.error);
  const texto = ev.cancelado ? 'Cancelado.' : String(ev.texto || (ev.error ? 'No se pudo.' : 'Listo.'));
  const d = lineaElla(); d.innerHTML = md(texto); bajar();
  if (ev.ms) estado(`Listo en el Mac · ${(ev.ms / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} s`);
  if (e.res) return e.res({ ok: !ev.error && !ev.cancelado, resultado: texto.slice(0, 1500) });
  if (conv) return conv.texto(`(Resultado de la tarea que hiciste en el Mac: ${texto.slice(0, 1200)} — cuéntaselo en una o dos frases.)`);
  const frase = paraDecir(texto);
  if (!frase) return ponerFase('quieta', '');
  ponerFase('hablando', 'Hablando');
  decirPorPartes(frase).then(() => { if (fase === 'hablando') ponerFase('quieta', ''); });
}

/* ════════ despedida: «chao Claude», «hasta luego Nova», «eso es todo»… ════════
   Deja de escuchar hasta que la vuelvas a llamar. Se detecta aquí (frase completa) y nunca llega al modelo */
const DESPEDIDA = /^[\s¡¿,.]*(?:(?:bueno|ok(?:ay)?|listo|ya|perfecto|vale|gracias|muchas\s+gracias)[\s,.!]+)*(?:hasta\s+luego|hasta\s+pronto|hasta\s+la\s+pr[oó]xima|hasta\s+ma[nñ]ana|ch[aá]o|chau|adi[oó]s|bye|nos\s+vemos|eso\s+(?:es|ser[ií]a)\s+todo|es\s+todo|nada\s+m[aá]s|por\s+ahora\s+(?:es\s+todo|nada\s+m[aá]s)|ya\s+no\s+te\s+necesito|deja\s+de\s+escuchar(?:me)?|desc[aá]nsa|buenas\s+noches|gracias\s+por\s+todo)(?:[\s,.!]+(?:por\s+ahora|entonces|gracias|muchas\s+gracias|claude|clod|cloud|nova|noba))*[\s,.!¡]*$/i;
let despedidaPendiente = null;
function despedirse(dicho) {
  clearTimeout(despedidaPendiente); despedidaPendiente = null;
  if (dicho) { nuevoTurno(); lineaTu(dicho); }
  const cual = modo;
  dejarDeEscuchar();
  vigiaPausa = 0; // «Oye Nova/Claude» la vuelve a llamar al tiro
  nova.expresion('feliz'); setTimeout(() => nova.expresion('normal'), 1400);
  estado('Hasta luego · llámame cuando quieras'); soltarPanel(2500);
  decirPorPartes(cual === 'claude' ? '¡Chao!' : '¡Hasta luego!');
}

/* ════════ CLAUDE (voz local) ════════ */
const SI = /^(s[ií]|sip|dale|hazlo|hágalo|ok(ay)?|ya|claro|adelante|confirmo|perfecto|permit[eo]|de una)\b/i, NO = /^(no|nop|para|cancela|detente|mejor no|espera)\b/i;

const vozActiva = () => altavoz.hablando() || esperandoVoz;
async function escucharClaude({ seguir = false } = {}) {
  ponerModo('claude');
  if (!seguir) nuevoTurno();
  ponerFase('escuchando', seguir ? (vozActiva() ? 'Hablando · puedes hablarme encima' : '¿Algo más?') : 'Te escucho');
  // mientras NOVA habla (o su voz viene en camino) pide más volumen para empezar y el plazo no corre;
  // si hablas, su voz se corta y tu frase se toma igual
  const wav = await grabadora.frase({
    esperaMax: seguir ? 6 : 8,
    umbral: () => (altavoz.hablando() ? UMBRAL_ENCIMA : UMBRAL_VOZ),
    inicioMin: () => (altavoz.hablando() ? 3 : 2),
    pausa: vozActiva,
    alEmpezar: () => { if (vozActiva()) { vozTurno++; esperandoVoz = false; altavoz.callar(); } estado('Te escucho…'); },
  });
  // terminó sin oír nada: si su voz aún suena queda «hablando» (y después quieta); nunca «escuchando» sin micrófono
  if (!wav) { if (fase === 'escuchando' && !grabadora.activa) { if (vozActiva()) ponerFase('hablando', 'Hablando'); else ponerFase('quieta', seguir ? '' : 'No te escuché'); } return; }
  ponerFase('pensando', 'Transcribiendo…');
  const { texto, error } = await mac.transcribir(wav);
  if (error) return fallar(error);
  if (!texto) { ponerFase('quieta', 'No te entendí'); return; }
  if (DESPEDIDA.test(texto)) return despedirse(texto);
  // «modo Nova…»: se cambia aquí, sin mandarlo a Claude
  const cambio = detectarCambio(texto, 'claude');
  if (cambio) {
    if (cambio.destino === 'nova') return cambiarModo('nova', cambio.resto);
    if (cambio.resto.length <= 2) return escucharClaude({ seguir: true }); // «modo Claude» estando en Claude
  }
  if (seguir) nuevoTurno();
  lineaTu(cambio?.resto || texto);
  if (cambio?.resto) return pedirClaude(cambio.resto);
  if (/^(nueva conversaci[oó]n|empecemos de nuevo|olvida (todo|lo anterior))/i.test(texto)) {
    mac.claude.nueva();
    return responderClaude('Listo, empezamos una conversación nueva.');
  }
  if (NO.test(texto) && texto.split(' ').length <= 2) { ponerFase('quieta', ''); return; }
  pedirClaude(texto);
}

function pedirClaude(texto) {
  claudeOcupado = true; pasos.clear(); ultimaNota = null;
  ponerFase('trabajando', 'Pensando…');
  mac.claude.pedir(texto);
}

async function responderClaude(texto, { error = false } = {}) {
  const d = lineaElla();
  d.innerHTML = md(texto);
  d.querySelectorAll('p, li').forEach((el, i) => { el.style.animation = `entra 0.4s ${i * 60}ms ease both`; });
  bajar();
  nova.expresion(error ? 'triste' : 'feliz');
  const frase = paraDecir(texto), mio = ++vozTurno;
  esperandoVoz = !!frase;
  // ya escucha: no hay que esperar a que termine de hablar para pedir otra cosa
  const escucha = modo === 'claude' && !claudeOcupado && !error && !micOff;
  if (escucha) escucharClaude({ seguir: true });
  else if (frase) ponerFase('hablando', 'Hablando');
  if (!frase) { if (!escucha) ponerFase('quieta', ''); return; }
  // la voz llega por partes: suena con el primer trozo
  await decirPorPartes(frase, () => mio === vozTurno, () => { esperandoVoz = false; });
  if (mio !== vozTurno) return; // la callaron o pidieron otra cosa mientras llegaba
  esperandoVoz = false;
  if (!escucha || fase === 'hablando') ponerFase('quieta', '');
}

/** dice una frase con la voz de NOVA a medida que el puente la genera. vigente(): si deja de serlo antes del primer
    trozo, no suena nada. alEmpezar: al primer trozo. Termina cuando terminó de sonar (o la callaron) */
let vozId = 0;
function decirPorPartes(frase, vigente = () => true, alEmpezar) {
  const id = ++vozId;
  return new Promise(fin => {
    let flujo = null, listo = false;
    const terminar = () => { if (!listo) { listo = true; quitar(); fin(); } };
    const quitar = mac.alTrozoVoz((i, pcm, hz) => {
      if (i !== id || listo) return;
      if (!flujo) { if (!vigente()) return terminar(); alEmpezar?.(); flujo = altavoz.flujo(terminar); }
      flujo.trozo(pcm, hz);
    });
    mac.decirFlujo(id, frase).then(() => { if (flujo) flujo.fin(); else terminar(); });
  });
}

function cancelarClaude(avisar = true) {
  vozTurno++; esperandoVoz = false;
  grabadora.parar(); altavoz.callar();
  if (claudeOcupado) { mac.claude.cancelar(); claudeOcupado = false; }
  ocultarPregunta();
  if (avisar) ponerFase('quieta', 'Cancelado');
}

/* tarjeta de permiso: botón o voz */
let preguntaSinVoz = null;
function ocultarPregunta() { preguntaActual = null; $('pregunta').classList.add('oculto'); }
async function preguntar({ id, texto, detalle, siempre }) {
  preguntaActual = id;
  $('siempre').classList.toggle('oculto', !siempre);
  $('siempre').textContent = siempre ? `Siempre «${siempre.length > 18 ? `${siempre.slice(0, 17)}…` : siempre}»` : 'Siempre';
  $('pregunta-pista').textContent = siempre ? 'o di «sí», «no» o «siempre»' : 'o di «sí» o «no»';
  $('pregunta-texto').textContent = texto;
  $('pregunta-detalle').textContent = detalle ?? '';
  $('pregunta').classList.remove('oculto');
  mostrarPanel(true); bajar();
  ponerFase('escuchando', 'Necesito tu OK');
  nova.expresion('sorprendida');
  if (conv) return; // con la conversación abierta se contesta con los botones (el micrófono ya es de NOVA)
  const voz = await mac.decir('¿Lo hago?');
  if (voz) await new Promise(fin => altavoz.decir(voz, fin));
  // escucha un «sí» o un «no» mientras la tarjeta siga abierta
  // (con el micrófono apagado no escucha: se responde con los botones)
  while (preguntaActual === id && !micOff && preguntaSinVoz !== id) {
    const wav = await grabadora.frase({ esperaMax: 12 });
    if (preguntaActual !== id || micOff || preguntaSinVoz === id) break;
    if (!wav) continue;
    const { texto: dicho } = await mac.transcribir(wav);
    if (preguntaActual !== id) break;
    if (dicho && /^siempre\b/i.test(dicho) && !$('siempre').classList.contains('oculto')) return contestar(id, 'siempre');
    if (dicho && SI.test(dicho)) return contestar(id, true);
    if (dicho && NO.test(dicho)) return contestar(id, false);
  }
}
function contestar(id, si) {
  if (preguntaActual !== id) return;
  grabadora.parar();
  ocultarPregunta();
  mac.claude.responder(id, si);
  ponerFase('trabajando', si === 'siempre' ? 'Hecho, no vuelvo a preguntar eso' : si ? 'Haciéndolo…' : 'Entendido, no lo hago');
}
$('si').addEventListener('click', () => contestar(preguntaActual, true));
$('siempre').addEventListener('click', () => contestar(preguntaActual, 'siempre'));
$('no').addEventListener('click', () => contestar(preguntaActual, false));

mac.claude.alEvento(ev => {
  if (ev.tipo === 'paso') { agregarPaso(ev); estado(`Trabajando · ${pasos.size} ${pasos.size === 1 ? 'paso' : 'pasos'}`); nova.expresion('pensativa'); }
  else if (ev.tipo === 'paso_listo') cerrarPaso(ev.id, ev.error);
  else if (ev.tipo === 'nota') { const d = lineaElla('nota'); escribir(d, ev.texto.length > 280 ? `${ev.texto.slice(0, 277)}…` : ev.texto); ultimaNota = { d, texto: ev.texto }; }
  else if (ev.tipo === 'pregunta') preguntar(ev);
  else if (ev.tipo === 'visual') mostrarBloque(ev.bloque);
  else if (ev.tipo === 'respondida') { if (preguntaActual === ev.id) ocultarPregunta(); }
  else if (ev.tipo === 'fin') {
    claudeOcupado = false; ocultarPregunta();
    for (const d of pasos.values()) d.classList.add('listo');
    if (ultimaNota && ultimaNota.texto.trim() === String(ev.texto).trim()) { ultimaNota.d.remove(); ultimaNota = null; }
    if (encargo) return terminarEncargo(ev);
    if (ev.cancelado) return ponerFase('quieta', 'Cancelado');
    // la última nota suele ser la misma respuesta final: no la muestra dos veces
    if (ultimaNota && ultimaNota.texto.trim() === String(ev.texto).trim()) ultimaNota.d.remove();
    ultimaNota = null;
    responderClaude(ev.texto || 'Listo.', { error: ev.error });
    if (ev.ms) estado(`Listo · ${(ev.ms / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} s`);
  } else if (ev.tipo === 'error') { claudeOcupado = false; ocultarPregunta(); if (encargo) return terminarEncargo({ error: true, texto: `No pude hacerlo en el Mac: ${ev.texto}` }); fallar(ev.texto); }
});

/* ════════ «Oye Nova»: escucha local continua de la palabra de activación ════════
   Mientras NOVA está quieta, graba frases cortas, las transcribe en el Mac (Whisper) y solo despierta si oye su nombre.
   Nada sale del Mac hasta que la llamas. «Oye Claude» abre el modo Claude. Lo que digas después del nombre en la misma
   frase («oye Nova, ¿qué tengo hoy?») va como primer pedido. Cuando la conversación se cierra por silencio, vuelve a
   esperar su nombre. Se apaga desde el menú (por ejemplo, en reuniones). */
// solo al comienzo de la frase: «oye/hey Nova…», «Nova, ¿estás ahí?»; Claude siempre con «oye/hey/ok» delante
// (así una reunión que menciona «nova» o «cloud» a mitad de frase no la despierta)
const LLAMADO = /^[\s¡¿,.]*(?:(?:eh|ah|este)[\s,.]+)?(?:(?:oye|hey|ey|hola|ok(?:ay)?|oiga)[\s,.]+(nova|noba|claude|clod|cloud)|(nova|noba)(?=[\s,.!?¿¡]*(?:est[aá]s|me escuchas|ay[uú]dame|$|[,.!?])))\b[\s,.!?¿¡]*(.*)$/i;
let vigiaOn = false, vigiando = false, micOff = false, vigiaPausa = 0;
const PAUSA_VIGIA = 90e3; // tras «deja de escuchar» a mano, ni siquiera espera «Oye Nova» por un rato
async function vigiar() {
  if (vigiando) return;
  vigiando = true;
  try {
    while (vigiaOn && !micOff && fase === 'quieta' && !conv && !claudeOcupado && !preguntaActual) {
      const wav = await grabadora.frase({ esperaMax: 3600, fraseMax: 7 }).catch(() => null);
      if (!wav || !vigiaOn || fase !== 'quieta' || conv || claudeOcupado) break;
      const { texto } = await mac.transcribir(wav, 'Oye Nova. Hey Nova. Nova, ¿estás ahí? Oye Claude.');
      const m = texto && texto.match(LLAMADO);
      const porModo = !m && texto && texto.match(A_MODO);
      if (m || porModo) mac.invocar(); // si estás en otro escritorio, llega hasta ahí
      if (porModo) { vigiando = false; return cambiarModo(/^c/i.test(porModo[1]) ? 'claude' : 'nova', porModo[2].trim()); }
      if (!m) continue;
      const quien = /clau|clod|cloud/i.test(m[1] ?? '') ? 'claude' : 'nova';
      const resto = m[3].replace(/^(est[aá]s ah[ií]|me escuchas)\??\s*/i, '').trim();
      ultimo = Date.now();
      nova.expresion('sorprendida'); setTimeout(() => nova.expresion('normal'), 700);
      vigiando = false;
      if (quien === 'claude') {
        abrirNova(resto.length > 3 ? resto : undefined).then(() => { if (resto.length > 3) { tuActual = lineaTu(resto); turnoNuevo = false; } }); // una sola NOVA
      } else abrirNova(resto.length > 3 ? resto : undefined).then(() => { if (resto.length > 3) { tuActual = lineaTu(resto); turnoNuevo = false; } });
      return;
    }
  } finally { vigiando = false; }
}
/** vuelve a esperar su nombre apenas NOVA queda quieta */
let huerfana = 0;
setInterval(() => {
  // red de seguridad: «escuchando» sin nada escuchando de verdad la deja trabada (y sin «Oye Nova/Claude»)
  huerfana = fase === 'escuchando' && !conv && !grabadora.activa && !vozActiva() && !preguntaActual ? huerfana + 1 : 0;
  if (huerfana >= 2) { huerfana = 0; ponerFase('quieta', ''); }
  document.body.classList.toggle('vigia', vigiando && !micOff);
  if (vigiaOn && !micOff && !vigiando && Date.now() > vigiaPausa && fase === 'quieta' && !conv && !claudeOcupado && !preguntaActual && !altavoz.hablando()) vigiar(); }, 1500);

/* ════════ atajos y clics ════════ */
/* ── micrófono apagado: NOVA no escucha nada (ni «Oye Nova») hasta que la toques o la prendas ── */
function ponerMic(prendido, avisar = true) {
  micOff = !prendido;
  mac.guardarPref('mic', prendido);
  document.body.classList.toggle('silenciada', micOff);
  grabadora.bloqueada = micOff;
  if (micOff) {
    if (conv) cerrarNova();
    grabadora.parar(); vigiando = false; // siempre: aunque el micrófono todavía se esté abriendo
    if (fase === 'escuchando') ponerFase('quieta', '');
    nova.expresion('dormida');
    if (avisar) { estado('Micrófono apagado'); soltarPanel(2500); }
  } else {
    vigiaPausa = 0;
    nova.expresion('feliz'); setTimeout(() => nova.expresion('normal'), 900);
    if (avisar) { estado(vigiaOn ? 'Micrófono prendido · di «Oye Nova»' : 'Micrófono prendido'); soltarPanel(2500); }
  }
}
/** ¿está escuchando de verdad ahora? (para el anillo y para el toque) */
const escuchandoAhora = () => !micOff && (modo === 'claude' ? fase === 'escuchando' : !!conv && (fase === 'escuchando' || fase === 'hablando'));

/** corta todo lo que esté escuchando o diciendo (la tarea de Claude, si hay, sigue) */
function dejarDeEscuchar() {
  if (preguntaActual) preguntaSinVoz = preguntaActual; // la tarjeta queda, pero se contesta con los botones
  vozTurno++; esperandoVoz = false; altavoz.callar();
  if (conv) cerrarNova();
  grabadora.parar(); vigiando = false;
  vigiaPausa = Date.now() + PAUSA_VIGIA;
  ponerFase(claudeOcupado ? 'trabajando' : 'quieta', 'Dejé de escuchar');
}
/** un toque a NOVA: si escucha o habla, corta las dos cosas y deja de escuchar; si no, empieza a escuchar en el modo
    actual. (Para interrumpirla y pedirle otra cosa al tiro: el atajo, o hablarle encima) */
function toque() {
  ultimo = Date.now();
  if (micOff) ponerMic(true, false);
  if (conv || vozActiva() || fase === 'escuchando' || fase === 'hablando') return dejarDeEscuchar();
  if (modo === 'claude') {
    if (preguntaActual) return; // la tarjeta espera tu respuesta
    if (claudeOcupado) return cancelarClaude();
    if (vigiando) { grabadora.parar(); vigiando = false; }
    return escucharClaude();
  }
  if (vigiando) { grabadora.parar(); vigiando = false; }
  abrirNova();
}

/** un toque mientras habla: se calla y nada más (lo que esté haciendo sigue) */
function callar() {
  if (conv?.hablando()) { conv.silenciar(); ponerFase('escuchando', 'Te escucho'); return true; }
  if (vozActiva()) { vozTurno++; esperandoVoz = false; altavoz.callar(); if (fase !== 'escuchando') ponerFase('quieta', ''); return true; }
  return false;
}
function alternarNova() {
  ultimo = Date.now();
  if (callar()) return;
  if (micOff) ponerMic(true, false);
  if (vigiando) grabadora.parar();
  if (conv) return cerrarNova();
  if (modo === 'claude' && (claudeOcupado || fase === 'escuchando')) return cancelarClaude();
  abrirNova();
}
function alternarClaude() {
  ultimo = Date.now();
  if (callar()) return;
  if (vigiando) { grabadora.parar(); vigiando = false; return escucharClaude(); }
  if (conv) cerrarNova();
  if (preguntaActual) return; // la tarjeta espera tu respuesta
  if (micOff) ponerMic(true, false);
  if (fase === 'escuchando' && modo === 'claude') { ponerFase('quieta', 'Dejé de escuchar'); vigiaPausa = Date.now() + PAUSA_VIGIA; return grabadora.parar(); }
  if (claudeOcupado) return cancelarClaude();
  escucharClaude();
}

// el chip cambia de modo; solo sigue escuchando si ya estaba escuchando
const alternarModo = () => cambiarModo(modo === 'claude' ? 'nova' : 'claude', '', { escuchar: !!conv || fase === 'escuchando' });
$('chip-modo').addEventListener('click', alternarModo);
$('cerrar-panel').addEventListener('click', e => { e.stopPropagation(); cerrarPanel(); });
$('modo').addEventListener('click', alternarModo);

/* escribirle: ↩ envía al modo actual; ⇥ cambia entre NOVA y Claude */
function teclado(mostrar) {
  $('teclado').classList.toggle('oculto', !mostrar);
  if (mostrar) { $('texto').value = ''; $('texto').placeholder = modo === 'claude' ? 'Pídele algo a Claude…' : 'Escríbele a NOVA…'; $('texto').focus(); }
}
$('teclado').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('texto').value.trim();
  teclado(false);
  if (!t) return;
  ultimo = Date.now();
  if (DESPEDIDA.test(t)) return despedirse(t);
  const cambio = detectarCambio(t, modo);
  if (cambio && cambio.destino !== modo) return cambiarModo(cambio.destino, cambio.resto);
  if (modo === 'claude') { if (conv) cerrarNova(); nuevoTurno(); lineaTu(t); return pedirClaude(t); }
  if (conv) { nuevoTurno(); lineaTu(t); turnoNuevo = false; conv.texto(t); } else { abrirNova(t).then(() => { lineaTu(t); turnoNuevo = false; }); }
});
$('texto').addEventListener('keydown', e => {
  if (e.key === 'Escape') teclado(false);
  if (e.key === 'Tab') e.preventDefault();
});

/* entrar */
$('entrar').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('entrar').querySelector('button');
  b.disabled = true; $('entrar-error').textContent = '';
  const r = await mac.entrar($('email').value.trim(), $('clave').value);
  b.disabled = false; $('clave').value = '';
  if (!r.ok) { $('entrar-error').textContent = r.error === 'Error 401' ? 'Correo o clave incorrectos' : r.error; return; }
  usuario = r;
  $('entrar').classList.add('oculto');
  nova.expresion('feliz');
  estado(`Hola, ${r.usuario.nombre.split(' ')[0]}`); soltarPanel(3000);
});
async function cargarSesion() {
  usuario = await mac.sesion();
  if (usuario?.sinConexion) { usuario = null; fallar('Sin conexión con la API de NOVA'); return; }
  $('entrar').classList.toggle('oculto', !!usuario);
}

/* ════════ ratón y cursor ════════ */
let sobre = false, arrastre = null, clicPendiente = null, cursorAntes = null, ultimoCursor = Date.now();
function centroNova() { const c = $('nova').getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; }
function solido(x, y) {
  if ([...document.querySelectorAll('.solido:not(.oculto)')].some(el => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; })) return 'control';
  const [cx, cy] = centroNova(), dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy < (nova.R * 1.8) ** 2 ? 'nova' : null;
}

/* el cursor en cualquier parte de la pantalla: NOVA lo mira, se gira un poco y reacciona si se le acerca */
mac.alCursor((x, y) => {
  const ahora = Date.now(), [cx, cy] = centroNova(), dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
  const vel = cursorAntes ? Math.hypot(x - cursorAntes.x, y - cursorAntes.y) / Math.max(1, ahora - cursorAntes.t) : 0;
  cursorAntes = { x, y, t: ahora };
  // despierta si estaba dormida
  if (ahora - ultimo > DORMIR) { ultimo = ahora; nova.expresion('sorprendida'); setTimeout(() => nova.expresion('normal'), 900); }
  ultimoCursor = ahora;
  if (fase === 'pensando' || fase === 'trabajando' || fase === 'escuchando') return; // escuchando, te mira a ti
  const lejos = Math.max(260, d);
  nova.mirar([Math.max(-1, Math.min(1, dx / lejos)) * 0.9, Math.max(-1, Math.min(1, dy / lejos)) * 0.8]);
  nova.girar(Math.max(-1, Math.min(1, dx / 1200)) * 0.45, Math.max(-1, Math.min(1, dy / 1200)) * 0.3);
  const cerca = d < nova.R * 1.8;
  if (fase === 'quieta' && !micOff) {
    nova.brillo = cerca ? 0.7 : d < 220 ? 0.25 : 0;
    // un cursor que llega rápido la sorprende; encima, se pone contenta
    if (d < 160 && vel > 2.2) { nova.expresion('sorprendida'); clearTimeout(alCursor.t); alCursor.t = setTimeout(() => nova.expresion(cerca ? 'feliz' : 'normal'), 700); }
    else if (cerca && !alCursor.encima) { alCursor.encima = true; nova.expresion('feliz'); }
    else if (!cerca && alCursor.encima) { alCursor.encima = false; nova.expresion('normal'); }
  }
});
const alCursor = {};
// NOVA en la mitad de abajo de la pantalla: el panel se abre hacia arriba
document.body.classList.toggle('abajo', new URLSearchParams(location.search).has('abajo'));
mac.alLado(abajo => document.body.classList.toggle('abajo', abajo));

addEventListener('mousemove', e => {
  if (arrastre && e.buttons === 0) soltarRaton(); // se soltó fuera de la ventana: el mouseup no llegó
  if (arrastre) {
    // pasado el umbral, el proceso principal mueve la ventana siguiendo al cursor hasta que se suelta
    if (!arrastre.movio && Math.abs(e.screenX - arrastre.x0) + Math.abs(e.screenY - arrastre.y0) > 4) {
      arrastre.movio = true; clearTimeout(presion); $('nova').classList.remove('apretando'); mac.arrastrar(true);
    }
    return;
  }
  const s = !!solido(e.clientX, e.clientY);
  if (s !== sobre) { sobre = s; mac.raton(s); }
});
let presion = null;
addEventListener('mousedown', e => {
  if (e.button !== 0 || solido(e.clientX, e.clientY) !== 'nova') return;
  arrastre = { x0: e.screenX, y0: e.screenY, movio: false, largo: false };
  $('nova').classList.add('apretando');
  // mantener presionado 0,6 s: prende o apaga el micrófono
  presion = setTimeout(() => { if (arrastre && !arrastre.movio) { arrastre.largo = true; $('nova').classList.remove('apretando'); ponerMic(micOff); } }, 600);
});
addEventListener('mouseup', () => soltarRaton());
function soltarRaton() {
  clearTimeout(presion); $('nova').classList.remove('apretando');
  if (!arrastre) return;
  const fue = arrastre; arrastre = null;
  if (fue.movio) mac.arrastrar(false);
  if (fue.movio || fue.largo) return;
  // un clic: hablar (en el modo en que está); dos clics: escribir
  if (clicPendiente) { clearTimeout(clicPendiente); clicPendiente = null; teclado(true); return; }
  clicPendiente = setTimeout(() => { clicPendiente = null; toque(); }, 230);
}
addEventListener('contextmenu', e => { if (solido(e.clientX, e.clientY)) { e.preventDefault(); mac.menu(); } });
addEventListener('mouseleave', () => { if (!arrastre && sobre) { sobre = false; mac.raton(false); } });

/* ════════ visita a otro escritorio ════════
   Llamada desde otro escritorio, NOVA llega con una entrada animada; cuando la conversación termina (quieta, sin
   panel, sin tarea de Claude) avisa y se vuelve a su escritorio con una salida animada */
let deVisita = false;
mac.alVisita(que => {
  const e = $('escena');
  if (que === 'llega') {
    deVisita = true;
    e.classList.remove('yendo', 'llega'); void e.offsetWidth; e.classList.add('llega');
    setTimeout(() => e.classList.remove('llega'), 1000);
  } else if (que === 'sale') {
    deVisita = false;
    panel.classList.add('oculto'); teclado(false);
    e.classList.add('yendo');
  } else e.classList.remove('yendo'); // volvió (o se quedó) en su escritorio
});
setInterval(() => {
  if (deVisita && fase === 'quieta' && !conv && !claudeOcupado && !preguntaActual && !vozActiva()
    && panel.classList.contains('oculto') && $('teclado').classList.contains('oculto') && !panel.matches(':hover') && Date.now() - ultimo > 3000) {
    deVisita = false;
    mac.reposo();
  }
}, 1000);

mac.alAtajo(cual => {
  if (cual === 'hablar') alternarNova();
  if (cual === 'claude') alternarNova(); // una sola NOVA
  if (cual === 'claude-nueva') { nuevoTurno(); estado('Claude empieza de cero en el Mac'); soltarPanel(3000); }
  if (cual === 'mic-off') ponerMic(false);
  if (cual === 'mic-on') ponerMic(true);
  if (cual === 'vigia-on') { vigiaOn = true; vigiaPausa = 0; estado('Escuchando «Oye Nova»'); soltarPanel(2500); }
  if (cual === 'vigia-off') { vigiaOn = false; if (vigiando) grabadora.parar(); estado('«Oye Nova» apagado'); soltarPanel(2500); }
  if (cual === 'sesion') { cerrarNova(); usuario = null; $('entrar').classList.remove('oculto'); }
});

/* ════════ ciclo: voz → cuerpo, onda, cierre por silencio, sueño ════════ */
setInterval(() => {
  const voz = conv ? conv.nivel() : altavoz.nivel();
  const mic = conv ? (conv.hablando() ? 0 : conv.nivelMic ?? 0) : grabadora.nivel;
  nova.habla = voz;
  nova.escucha = escuchandoAhora() ? 1 : 0;
  nova.mic = nova.escucha ? mic : 0;
  dibujarOnda(fase === 'hablando' ? voz : fase === 'escuchando' ? mic : fase === 'quieta' ? 0 : 0.15 + 0.1 * Math.sin(Date.now() / 180));
  if (conv && (voz > 0.02 || conv.hablando())) ultimo = Date.now();
  if (conv && !claudeOcupado && !encargo && Date.now() - ultimo > SILENCIO_MAX) cerrarNova();
  if (!conv && fase === 'quieta' && (micOff || Date.now() - Math.max(ultimo, ultimoCursor) > DORMIR)) nova.expresion('dormida');
}, 33);

/* --captura: un estado de ejemplo para revisar el diseño sin hablarle */
window.__demo = cual => {
  $('entrar').classList.add('oculto');
  if (cual === 'nova') {
    ponerModo('nova'); nuevoTurno(); lineaTu('¿Qué tengo pendiente hoy?');
    escribir(lineaElla(), 'Tienes tres tareas: revisar el widget, la reunión de Nexium a las 16:00 y comprar café.');
    const chip = document.createElement('div'); chip.className = 'accion'; chip.innerHTML = icono('telefono'); chip.append('Alarma · 07:00'); hilo.append(chip);
    ponerFase('hablando', 'Hablando'); nova.habla = 0.6;
    return;
  }
  if (cual === 'escuchando') { ponerModo('nova'); nuevoTurno(); ponerFase('escuchando', 'Te escucho'); conv = { hablando: () => false, nivel: () => 0, nivelMic: 0.55, cerrar() {} }; return; }
  if (cual === 'mudo') { ponerMic(false); return; }
  if (cual === 'visual') {
    ponerModo('claude'); nuevoTurno(); lineaTu('¿Cómo van las descargas de la app este mes vs el anterior?');
    agregarPaso({ id: 'a', icono: 'web', texto: 'Buscando en la web: descargas app' }); cerrarPaso('a');
    mostrarBloque({ tipo: 'metricas', titulo: 'Este mes', items: [{ etiqueta: 'Descargas', valor: 12840, cambio: 18.4, cambio_texto: '% vs sep' }, { etiqueta: 'Activos/día', valor: 3120, cambio: -2.1, cambio_texto: '%' }, { etiqueta: 'Crashes', valor: 14, cambio: 6, bueno: false }] });
    mostrarBloque({ tipo: 'grafico', titulo: 'Descargas por semana', forma: 'lineas', unidad: 'descargas', etiquetas: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], series: [{ nombre: 'Octubre', valores: [2100, 2600, 2400, 3100, 3300, 2900, 3500, 3800] }, { nombre: 'Septiembre', valores: [1800, 2000, 2300, 2200, 2500, 2400, 2700, 2600] }], fuente: 'Play Console' });
    mostrarBloque({ tipo: 'tarjetas', titulo: 'Resultados', items: [{ titulo: 'Cómo leer las métricas de retención en Play Console', url: 'https://support.google.com/googleplay', resumen: 'Guía oficial sobre usuarios activos, retención y desinstalaciones.' }, { titulo: 'Expo EAS Update: canales y runtime', url: 'https://docs.expo.dev/eas-update/introduction/', resumen: 'Cómo publicar actualizaciones OTA por canal.' }] });
    lineaElla().innerHTML = md('Este mes van 12.840 descargas, un 18 % más que septiembre.'); ponerFase('hablando', 'Hablando'); hilo.scrollTop = 0;
    return;
  }
  ponerModo('claude'); nuevoTurno(); lineaTu('Abre el proyecto en el navegador y corre los tests');
  agregarPaso({ id: 'a', icono: 'buscar', texto: 'Buscando package.json' }); cerrarPaso('a');
  agregarPaso({ id: 'b', icono: 'leer', texto: 'Leyendo mac/main.js' }); cerrarPaso('b');
  agregarPaso({ id: 'c', icono: 'consola', texto: 'Abrir en el navegador', detalle: 'open "http://localhost:3000"' }); cerrarPaso('c');
  agregarPaso({ id: 'd', icono: 'consola', texto: 'Correr los tests', detalle: 'npm test' });
  estado('Trabajando · 4 pasos'); panel.classList.add('vivo');
  preguntaActual = 'demo'; $('pregunta-texto').textContent = 'Correr los tests'; $('pregunta-detalle').textContent = 'npm test -- --watch=false'; $('pregunta').classList.remove('oculto');
  mostrarPanel();
};

config = await mac.config();
vigiaOn = (await mac.pref('vigia')) === true; // apagado salvo que se prenda en el menú: el micrófono no queda abierto esperando
if ((await mac.pref('mic')) === false) ponerMic(false, false);
await cargarSesion();
