/* «Ask Nova»: preguntas a NOVA, respondidas por el modelo de a bordo con los datos de la nave (ver /v1/preguntar). */
'use strict';
let charla = [], hablando = false, modeloOk = false;

function sugerencias() {
  if (!ultimo) return [];
  const s = [];
  const vale = i => !CREW[i]?.vacio; // asientos vacíos: no se sugiere nada sobre ellos
  const urg = ultimo.trip.findIndex((t, i) => vale(i) && t.nivel === 'aviso_tierra'), at = ultimo.trip.findIndex((t, i) => vale(i) && t.nivel === 'atencion');
  if (urg >= 0) s.push(`What do we do for ${CREW[urg].corto}?`);
  s.push('Who needs attention right now?');
  if (at >= 0 && at !== urg) s.push(`What's going on with ${CREW[at].corto}?`);
  const otro = CREW.find((c, i) => vale(i) && i !== urg) || CREW[0];
  s.push(`What if ${otro.corto} faints? None of us is a doctor.`);
  if (vista === 'vitals') s.unshift(`How has ${CREW[vT].corto} been in the last hour?`);
  return [...new Set(s)].slice(0, 3);
}

const escapar = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function formato(t) {
  return escapar(t.trim()).replace(/\[(\d+)\]/g, '<sup class="cita">$1</sup>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*/gm, '')
    .split(/\n+/).map(l => /^\s*(\d+)\.\s+/.test(l) ? `<div class="paso"><span>${l.match(/^\s*(\d+)/)[1]}</span>${l.replace(/^\s*\d+\.\s+/, '')}</div>` : `<p>${l}</p>`).join('');
}

const votosHtml = m => !m.texto || (hablando && m === charla.at(-1)) ? '' : `<div class="votos">${m.voto == null ? `<span>Was this useful?</span><button data-voto="${m.id}:1" aria-label="Useful">Yes</button><button data-voto="${m.id}:0" aria-label="Not useful">No</button>` : `<span>${m.voto ? 'Thanks. Noted for tonight’s report.' : 'Thanks. Earth will review it tonight.'}</span>`}</div>`;
const burbujaNova = m => `${m.texto ? formato(m.texto) : '<p class="pensando"><i></i><i></i><i></i></p>'}${m.error ? `<p class="err">${escapar(m.error)}</p>` : ''}${!hablando || m !== charla.at(-1) ? guiaHtml(m, (charla[charla.indexOf(m) - 1] || {}).texto) : ''}${fuentesHtml(m)}${votosHtml(m)}`;
let firmaCharla = '';
function pintarCharla() {
  const c = $('charla');
  c.hidden = !charla.length;
  // mientras NOVA escribe solo cambia su última burbuja: se reemplaza ese contenido y nada más (antes se redibujaba
  // todo el chat con cada palabra, y las burbujas y los puntos parpadeaban)
  const firma = charla.map(m => m.id || m.texto).join('|');
  const ultima = c.querySelector('.b.nv:last-of-type');
  if (firma === firmaCharla && ultima && charla.at(-1).rol === 'nova') {
    const html = burbujaNova(charla.at(-1));
    if (ultima.dataset.html !== html) { ultima.innerHTML = html; ultima.dataset.html = html; }
  } else {
    firmaCharla = firma;
    c.innerHTML = charla.length ? `<div class="sec"><span>Asked Nova</span><button class="cerrar" id="cerrarCharla">Clear</button></div>` +
      charla.map(m => m.rol === 'yo' ? `<div class="b yo">${m.voz ? '<svg class="mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>' : ''}${escapar(m.texto)}</div>`
        : `<div class="b nv">${burbujaNova(m)}</div>`).join('') : '';
    document.querySelector('.nova-cuerpo').scrollTop = 0;
  }
  const s = $('sugerencias'), sug = !hablando && modeloOk ? sugerencias().map(q => `<button data-q2="${escapar(q)}">${escapar(q)}</button>`).join('') : '';
  if (s.dataset.html !== sug) { s.innerHTML = sug; s.dataset.html = sug; }
}

/* fuentes de la biblioteca a bordo que NOVA usó (solo las que citó; si no citó ninguna, las consultadas) */
/* si la respuesta nombra un protocolo con guía, botón para abrirla (con la persona mencionada en la pregunta) */
function guiaHtml(m, q) {
  if (!m.texto || typeof PROTOCOLOS === 'undefined') return '';
  const t = m.texto.toLowerCase();
  const p = (m.guia && PROTOCOLOS.find(x => x.id === m.guia && x.guia)) || PROTOCOLOS.filter(x => x.guia).find(x => t.includes(x.titulo.toLowerCase().split(' (')[0]));
  if (!p) return '';
  const i = Math.max(0, CREW.findIndex(c => (q || '').toLowerCase().includes(c.corto.toLowerCase())));
  return `<div class="abrir-guia"><button data-guia="${p.id}" data-gi="${i}">Open the ${escapar(p.titulo.toLowerCase())} guide for ${escapar(CREW[i].corto)}</button></div>`;
}

function fuentesHtml(m) {
  if (!m.fuentes || !m.fuentes.length || !m.texto) return '';
  const citadas = new Set([...m.texto.matchAll(/\[(\d+)\]/g)].map(x => +x[1]));
  const lista = m.fuentes.filter(f => !citadas.size || citadas.has(f.n));
  return `<div class="fuentes"><span>${citadas.size ? 'Sources' : 'Library consulted'}</span>${lista.map(f =>
    `<button class="fuente${m.abierta === f.n ? ' on' : ''}" data-fu="${m.id}:${f.n}"><b>${f.n}</b>${escapar(String(f.editor || ''))} · ${escapar(String(f.titulo || '').slice(0, 54))}${String(f.titulo || '').length > 54 ? '…' : ''} · p.${f.pagina}</button>`).join('')}
    ${m.abierta ? (f => f ? `<div class="extracto"><b>${escapar(String(f.titulo))}</b> (${escapar(String(f.editor))} ${f.anio}), page ${f.pagina}${f.seccion ? ` · ${escapar(String(f.seccion))}` : ''}<p>${escapar(String(f.texto))}</p><em>${escapar(String(f.licencia || ''))}</em>${f.fuente ? `<button class="leer" data-leer="${m.id}:${f.n}">Read the real page →</button>` : ''}</div>` : '')(m.fuentes.find(x => x.n === m.abierta)) : ''}</div>`;
}

async function preguntarNova(q, op = {}) {
  q = q.trim(); if (!q || hablando) return;
  const previos = charla.filter(m => m.texto).map(m => ({ rol: m.rol === 'yo' ? 'yo' : 'nova', texto: m.texto }));
  charla.push({ rol: 'yo', texto: q, voz: !!op.porVoz }); const r = { rol: 'nova', texto: '', id: Date.now() }; charla.push(r);
  charla = charla.slice(-6);
  hablando = true; $('pregIn').value = ''; pintarCharla();
  callar(); let porDecir = '', yaHablo = false;
  const decirLo = (final = false) => {   // lee cada frase completa apenas llega; la primera puede partir en una coma
    let m = final ? porDecir : (porDecir.match(/^[\s\S]*[.!?](\s|$)/) || [''])[0];
    if (!m && !yaHablo && !final) m = (porDecir.match(/^[^.!?]{28,}?[,;:](\s)/) || [''])[0];
    if (m.trim()) { yaHablo = true; hablar(m.replace(/\*\*/g, '').replace(/\[\d+\]/g, '').replace(/^\s*\d+\.\s*/gm, ''), { nuevo: false, idioma: idiomaDe(q) }); porDecir = porDecir.slice(m.length); }
  };
  try {
    const resp = await fetch(BASE + '/v1/preguntar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pregunta: q, previos }) });
    const lector = resp.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await lector.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        const linea = bloque.split('\n').find(l => l.startsWith('data:')); if (!linea) continue;
        const d = JSON.parse(linea.slice(5));
        if (d.fuentes) { r.fuentes = d.fuentes; }
        if (d.guia) { r.guia = d.guia; }
        if (d.t) { r.texto += d.t; porDecir += d.t; decirLo(); pintarCharla(); }
        if (d.error) { r.error = d.error; pintarCharla(); }
      }
    }
  } catch { r.error = 'The onboard link is not answering.'; }
  decirLo(true);
  hablando = false; pintarCharla();
}

function pintarVozBtn() { const b = $('vozBtn'); if (b) { b.classList.toggle('off', !vozActiva); b.title = vozActiva ? 'Nova speaks (onboard voice)' : 'Nova is muted'; } }

async function revisarModelo() {
  let demo = false;
  try { const m = await (await fetch(BASE + '/v1/modelo')).json(); modeloOk = m.ok; demo = !!m.demo; } catch { modeloOk = false; }
  const i = $('pregIn');
  i.disabled = !modeloOk; i.placeholder = modeloOk ? 'Ask Nova about the crew' : 'Onboard model offline';
  // say honestly which brain answers: the demo one (Claude, needs internet) or the onboard one (no internet)
  $('pregEstado').textContent = !modeloOk ? 'offline' : demo ? 'demo brain · Claude' : 'onboard · no internet';
  $('pregEstado').className = modeloOk ? 'ok' : '';
  if (!hablando) pintarCharla();
}

$('pregForm').addEventListener('submit', e => { e.preventDefault(); preguntarNova($('pregIn').value); });
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.q2) preguntarNova(b.dataset.q2);
  else if (b.dataset.leer) { const [id, n] = b.dataset.leer.split(':').map(Number); const f = (charla.find(x => x.id === id)?.fuentes || []).find(x => x.n === n); if (f && window.leerCita) leerCita(f); }
  else if (b.dataset.fu) { const [id, n] = b.dataset.fu.split(':').map(Number); const m = charla.find(x => x.id === id); if (m) { m.abierta = m.abierta === n ? 0 : n; pintarCharla(); } }
  else if (b.dataset.voto) {
    // la tripulación dice si la respuesta sirvió: baja en el informe de la noche para que la Tierra la revise
    const [id, v] = b.dataset.voto.split(':').map(Number), i = charla.findIndex(x => x.id === id), m = charla[i]; if (!m) return;
    m.voto = !!v; firmaCharla = ''; pintarCharla();
    fetch(BASE + '/v1/opinion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pregunta: (charla[i - 1] || {}).texto || '', respuesta: m.texto, util: !!v }) }).catch(() => {});
  }
  else if (b.id === 'cerrarCharla') { charla = []; callar(); pintarCharla(); }
  else if (b.id === 'vozBtn') { vozActiva = !vozActiva; if (!vozActiva) callar(); pintarVozBtn(); }
});
revisarModelo(); setInterval(revisarModelo, 15000); pintarVozBtn();
