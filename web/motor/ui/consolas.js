/* Consolas de escritorio de HALO (sistema v3). Datos ficticios, marcados en pantalla. */
const ICONOS = {
  crew: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c2.6-.4 5 1 5.8 4.4"/>',
  vitals: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  mind: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 10h.01M15 10h.01"/>',
  body: '<path d="M6.5 6.5l11 11M4 9l5-5M15 20l5-5M3 12l9-9M12 21l9-9"/>',
  rad: '<circle cx="12" cy="12" r="2"/><path d="M12 10V4a8 8 0 0 0-6.9 4zM13.7 13l5.2 3a8 8 0 0 0 0-8zM10.3 13l-5.2 3a8 8 0 0 0 13.8 0z"/>',
};
function riel(on, badge = {}){
  const marca = `<div class="marca"><svg id="marcaNova" viewBox="0 0 48 48" style="width:48px;height:48px;overflow:visible"></svg></div>`;
  if ($('marcaNova')) { $('riel').querySelectorAll('.ico').forEach(n => n.remove()); $('riel').insertAdjacentHTML('beforeend', Object.entries(ICONOS).map(([k, d]) => `<div class="ico${k === on ? ' on' : ''}"><svg viewBox="0 0 24 24">${d}</svg>${badge[k] ? `<i class="badge ${badge[k]}"></i>` : ''}</div>`).join('')); return; }
  $('riel').innerHTML = marca + Object.entries(ICONOS).map(([k, d]) => `<div class="ico${k === on ? ' on' : ''}"><svg viewBox="0 0 24 24">${d}</svg>${badge[k] ? `<i class="badge ${badge[k]}"></i>` : ''}</div>`).join('');
}
function anilloFino(svg, v, col){
  const R = 88, C = 100, a1 = -Math.PI / 2 + Math.PI * 2 * v * .999, x1 = C + Math.cos(a1) * R, y1 = C + Math.sin(a1) * R;
  svg.innerHTML = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6"/>
    <path d="M${C} ${C - R} A${R} ${R} 0 ${v > .5 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`;
}
function novaPanel(t, o = {}){ const mk = $('marcaNova'); if (mk) mk.innerHTML = mascotaOrbes({ x: 24, y: 25, R: 15, t, expr: 'normal', orbes: 0, sinHalo: true, fluido: .6, alerta: o.alerta || 0 }); $('novaP').innerHTML = mascotaOrbes({ x: 150, y: 116, R: 66, t, expr: 'normal', orbes: 6, parpadeo: (t % 3.7) < .13 ? 1 : 0, ...o }); }
function reloj(t){ const s = 22364 + t; return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`; }

/* ── tripulación ── */
const CREW = [
  { o2: 98, md: 'Good', s7: [.8,.82,.78,.85,.8,.83,.81], ini: 'MR', n: 'Mara Reyes', r: 'Commander', rd: 86, hr: 64, sl: '7h 05m', hrv: 62, pvt: 251, ex: 96, ds: 214 },
  { o2: 99, md: 'Great', s7: [.84,.86,.83,.88,.85,.84,.86], ini: 'DO', n: 'David Okafor', r: 'Pilot', rd: 81, hr: 58, sl: '7h 20m', hrv: 71, pvt: 244, ex: 104, ds: 211 },
  { o2: 98, md: 'Good', s7: [.86,.88,.9,.86,.89,.87,.9], ini: 'IL', n: 'Ingrid Lindqvist', r: 'Flight engineer', rd: 88, hr: 61, sl: '7h 40m', hrv: 66, pvt: 259, ex: 90, ds: 209 },
  { o2: 97, md: 'Tired', s7: [.86,.84,.85,.7,.62,.58,.55], ini: 'KT', n: 'Kenji Tanaka', r: 'Mission specialist', rd: 63, hr: 72, sl: '4h 50m', hrv: 41, pvt: 298, ex: 52, ds: 216, x: ['sl', 'hrv', 'pvt'] },
];
function dibujarConsolaCrew(t){
  riel('crew', { sleep: 'nv' });
  const S = $('crew'); if (!S.children.length) S.innerHTML = CREW.map((c, i) => { const X = k => c.x && c.x.includes(k) ? ' x' : '';
    return `<div class="tri${c.x ? ' marcada' : ''}">
      <div class="persona"><div class="av"${c.x ? ' style="background:#c3b8ff"' : ''}>${c.ini}</div><div><b>${c.n}</b><span>${c.r}</span></div></div>
      <div class="anillo"><svg id="an${i}" viewBox="0 0 200 200"></svg><div class="c"><b>${c.rd}</b><span>Readiness</span></div></div>
      <div class="pulso"><div class="f"><span class="lbl">Heart</span><b><span id="hr${i}">${c.hr}</span><span class="u" style="font-size:14px">bpm</span></b></div><svg id="trz${i}" viewBox="0 0 300 40"></svg></div>
      <div class="fil${X('sl')}"><span>Sleep</span><b>${c.sl}</b></div>
      <div class="fil${X('hrv')}"><span>Heart rate variability</span><b>${c.hrv}<span class="u">ms</span></b></div>
      <div class="fil${X('pvt')}"><span>Reaction time</span><b>${c.pvt}<span class="u">ms</span></b></div>
      <div class="fil"><span>Exercise today</span><b>${c.ex}<span class="u">min</span></b></div>
      <div class="fil"><span>Mission dose</span><b>${c.ds}<span class="u">mSv</span></b></div>
      <div class="fil"><span>Oxygen</span><b>${c.o2}<span class="u">%</span></b></div>
      <div class="fil${X('sl')}" style="border-bottom:0"><span>Mood check-in</span><b>${c.md}</b></div>
      <div class="siete"><span class="lbl">Sleep, last 7 nights</span><svg id="s7${i}" viewBox="0 0 300 44"></svg></div>
      <div class="est" style="color:${c.x ? 'var(--nv)' : 'var(--ok)'}"><i style="background:currentColor"></i>${c.x ? 'Needs attention' : 'On track'}</div></div>`; }).join('');
  CREW.forEach((c, i) => { anilloFino($('an' + i), c.rd / 100, c.x ? '#a898ff' : '#8fe6f5');
    trazaViva($('trz' + i), 300, 40, t + i * .37, { ppm: c.hr, col: c.x ? '#a898ff' : '#46c8e8', ancho: 3 });
    barritas($('s7' + i), 300, 44, c.s7, { col: c.x ? '#a898ff' : '#8fe6f5' });
    $('hr' + i).textContent = c.hr + Math.round(Math.sin(t * .8 + i) * 1.3); });
  novaPanel(t, { expr: 'pensativa', mira: [-.6, .1] });
  $('met').textContent = 'Mission time 214d ' + reloj(t);
}

/* ── ficha de un tripulante ── */
function relojCircadiano(svg, t, k = 1){
  const C = 280, R0 = 140, DR = 17, ang = h => (h / 24) * Math.PI * 2 - Math.PI / 2, P = (h, r) => [C + Math.cos(ang(h)) * r, C + Math.sin(ang(h)) * r];
  const arco = (h0, h1, r) => { if (h1 < h0) h1 += 24; const [x0, y0] = P(h0, r), [x1, y1] = P(h1, r); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${(h1 - h0) > 12 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  let h = `<path d="${arco(22.5, 6.5, R0 + DR * 3)}" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="${DR * 7 + 4}"/>`;
  [0, 6, 12, 18].forEach(i => { const [tx, ty] = P(i, R0 + DR * 7 + 30); h += `<text x="${tx}" y="${ty + 5}" text-anchor="middle" font-family="SG" font-size="15" fill="#5b6573">${String(i).padStart(2, '0')}:00</text>`; });
  const N = [[22.7, 6.6], [23.0, 6.7], [22.8, 6.5], [23.6, 6.4], [0.4, 6.2], [0.9, 6.0], [1.6, 6.4]];
  const LUZ = [21.6, 21.8, 22, 23.1, 23.9, .6, 1.3];
  N.forEach(([a, b], i) => { const r = R0 + DR * i, kk = Math.min(1, Math.max(0, k * 8 - i)); if (kk <= 0) return;
    const bb = a + ((b < a ? b + 24 : b) - a) * kk, ult = i === 6;
    h += `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="9"/>`;
    if (LUZ[i] > 22.5 || LUZ[i] < 6) h += `<path d="${arco(22.5, LUZ[i], r)}" fill="none" stroke="#f2b457" stroke-width="9" stroke-linecap="round" opacity="${kk}"/>`;
    h += `<path d="${arco(a, bb % 24, r)}" fill="none" stroke="${ult ? '#c3b8ff' : '#a898ff'}" stroke-width="9" stroke-linecap="round" opacity="${ult ? 1 : .55 + i * .05}"/>`; });
  h += `<text x="${C}" y="${C - 8}" text-anchor="middle" font-family="SG" font-weight="300" font-size="58" letter-spacing="-3" fill="#f2f5f8">4h 50m</text>
        <text x="${C}" y="${C + 24}" text-anchor="middle" font-family="SG" font-size="15" fill="#9aa4b2">asleep last night</text>`;
  svg.innerHTML = h;
}
function dibujarConsolaAstronauta(t, k = 1){
  riel('crew', { sleep: 'nv' });
  relojCircadiano($('reloj'), t, k);
  const sh = .83, z = (u, i, a, d) => a + (u > sh ? (u - sh) / (1 - sh) * d : 0) + (h1(i * 7 + a * 10) - .5) * .05;
  const S30 = (a, d) => Array.from({ length: 31 }, (_, i) => z(i / 30, i, a, d));
  serie($('t1'), 420, 48, S30(.35, .45), { col: '#ec6aa8', marca: sh });
  serie($('t2'), 420, 48, S30(.75, -.5), { col: '#46c8e8', marca: sh });
  serie($('t3'), 420, 48, S30(.7, -.45), { col: '#a898ff', marca: sh });
  serie($('t4'), 420, 48, S30(.3, .45), { col: '#a898ff', marca: sh });
  const L = f => suave(Array.from({ length: 21 }, (_, i) => [i / 20 * 300, f(i / 20)]));
  $('hueso').innerHTML = `<path d="${L(u => 30 + u * 150)}" fill="none" stroke="rgba(236,106,168,.55)" stroke-width="1.6" stroke-dasharray="4 6"/><path d="${L(u => 30 + u * 40)}" fill="none" stroke="#6fd6b0" stroke-width="2"/>
    <text x="300" y="200" text-anchor="end" font-family="SG" font-size="13" fill="#ec6aa8">without exercise, −1.5%/month</text><text x="300" y="56" text-anchor="end" font-family="SG" font-size="13" fill="#6fd6b0">with his plan</text>`;
  barritas($('musculo'), 300, 200, Array.from({ length: 12 }, (_, i) => .86 + (h1(i + 3) - .5) * .08 - (i > 9 ? .03 : 0)), { col: '#6fd6b0' });
  novaPanel(t, { expr: 'pensativa', mira: [-.6, .1] });
}

/* ── radiación y hábitat ── */
const MODULOS = [['Command', 70, 210, 56, 4.9], ['Lab', 226, 446, 70, 5.6], ['Quarters', 462, 580, 60, 4.2], ['Shelter', 596, 776, 76, 1.6], ['Habitat', 792, 972, 70, 4.4], ['Airlock', 988, 1048, 42, 6.1]];
const colTasa = v => v < 2.5 ? '#46c8e8' : v < 5 ? '#f2b457' : '#ec6aa8';
function dibujarNave(svg, t){
  const Y = 210; let h = '';
  [[521, -1], [882, -1]].forEach(([x, d]) => { const y0 = Y + d * 100;
    h += `<line x1="${x}" y1="${Y + d * 62}" x2="${x}" y2="${y0}" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/><rect x="${x - 44}" y="${d < 0 ? y0 - 80 : y0}" width="88" height="80" rx="8" fill="none" stroke="rgba(255,255,255,.12)"/>`; });
  MODULOS.forEach(([n, x0, x1, r, v], i) => { const c = colTasa(v), sh = n === 'Shelter';
    h += `<rect x="${x0}" y="${Y - r}" width="${x1 - x0}" height="${r * 2}" rx="${i === 0 ? r : 20}" fill="${c}" fill-opacity="${sh ? .1 : .14 + .04 * Math.sin(t * 2 + i)}" stroke="${sh ? '#8fe6f5' : 'rgba(255,255,255,.18)'}" stroke-width="${sh ? 1.6 : 1}"/>`;
    h += `<text x="${(x0 + x1) / 2}" y="${Y + r + 32}" text-anchor="middle" font-family="SG" font-size="15" fill="${sh ? '#8fe6f5' : '#9aa4b2'}">${n}</text>`;
    h += `<text x="${(x0 + x1) / 2}" y="${Y + r + 58}" text-anchor="middle" font-family="SG" font-weight="300" font-size="22" fill="${c}">${v.toFixed(1)}<tspan font-size="13" fill="#5b6573"> mSv/h</tspan></text>`; });
  h += `<path d="M1060 186 L1112 164 L1112 256 L1060 234Z" fill="none" stroke="rgba(255,255,255,.18)"/>`;
  const u = Math.min(1, Math.max(0, (t - 1) / 7)), ix = 340 + (640 - 340) * (1 - Math.pow(1 - u, 2));
  [['MR', 652, Y - 22], ['DO', 712, Y - 22], ['KT', 682, Y + 26], ['IL', ix, Y]].forEach(([n, x, y], i) => { const mov = i === 3 && u < 1;
    h += `<circle cx="${x}" cy="${y}" r="15" fill="#05080c" stroke="${mov ? '#f2b457' : '#8fe6f5'}" stroke-width="1.5"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-family="SG" font-size="11.5" font-weight="600" fill="${mov ? '#f2b457' : '#8fe6f5'}">${n}</text>`; });
  if (u < 1) h += `<line x1="${ix + 20}" y1="${Y}" x2="628" y2="${Y}" stroke="#f2b457" stroke-width="1.2" stroke-dasharray="2 6"/>`;
  svg.innerHTML = h;
}
function dibujarFlujo(svg, t){
  const W = 820, H = 190, x = h => 44 + (h + 24) / 36 * (W - 60), y = v => H - 26 - Math.log10(Math.max(1, v)) / 3.2 * (H - 40);
  const f = hh => hh < -4 ? 1.6 + .4 * h1(Math.round(hh * 5) + 99) : hh <= 0 ? 1.6 + 400 * Math.pow((hh + 4) / 4, 3) : 900 * Math.exp(-(((hh - 2) / 2.2) ** 2)) + (hh > 2 ? 450 * Math.exp(-(hh - 2) / 4) : 0);
  let g = '';
  [1, 10, 100, 1000].forEach(v => g += `<line x1="44" y1="${y(v)}" x2="${W - 16}" y2="${y(v)}" stroke="rgba(255,255,255,.05)"/><text x="34" y="${y(v) + 4}" text-anchor="end" font-family="SG" font-size="12" fill="#5b6573">${v}</text>`);
  g += `<line x1="44" y1="${y(10)}" x2="${W - 16}" y2="${y(10)}" stroke="rgba(242,180,87,.45)" stroke-dasharray="3 5"/><text x="${W - 16}" y="${y(10) - 8}" text-anchor="end" font-family="SG" font-size="12.5" fill="#f2b457">storm level</text>`;
  const pas = [], fut = []; for (let i = 0; i <= 120; i++){ const hh = -24 + i * .2; pas.push([x(hh), y(f(hh))]); } for (let i = 0; i <= 60; i++){ const hh = i * .2; fut.push([x(hh), y(f(hh))]); }
  g += `<path d="${ruta(pas)}" fill="none" stroke="#ec6aa8" stroke-width="1.8"/><path d="${ruta(fut)}" fill="none" stroke="#a898ff" stroke-width="1.8" stroke-dasharray="5 6"/>`;
  g += `<text x="${x(3)}" y="${y(900) - 12}" font-family="SG" font-size="13" fill="#a898ff">Nova's forecast, peak in about 2 h</text>`;
  g += `<line x1="${x(0)}" y1="14" x2="${x(0)}" y2="${H - 26}" stroke="rgba(255,255,255,.15)"/><circle cx="${x(0)}" cy="${y(f(0))}" r="4" fill="#ec6aa8"/>`;
  [[-24, '24 h ago'], [-12, '12 h ago'], [0, 'now'], [12, 'in 12 h']].forEach(([hh, l]) => g += `<text x="${x(hh)}" y="${H}" text-anchor="middle" font-family="SG" font-size="12.5" fill="${hh ? '#5b6573' : '#9aa4b2'}">${l}</text>`);
  svg.innerHTML = g;
}
function dibujarConsolaRadiacion(t){
  riel('rad', { rad: 'al' });
  dibujarNave($('nave'), t); dibujarFlujo($('flujo'), t);
  $('tasaC').textContent = (4.8 + Math.sin(t * .9) * .15).toFixed(1) + ' mSv/h';
  novaPanel(t, { expr: 'sorprendida', alerta: 1, mira: [-.6, .15] });
}

/* ── mente ── */
const RAMPA = ['#2e2b6b', '#5b5bd6', '#46c8e8', '#7fe3c4', '#f2b35e'];
const colRampa = v => { const x = Math.max(0, Math.min(3.999, (v - 2.2) / 2.6 * 4)), i = Math.floor(x), f = x - i, h2 = c => [1, 3, 5].map(j => parseInt(c.slice(j, j + 2), 16)), A = h2(RAMPA[i]), B = h2(RAMPA[i + 1]); return `rgb(${A.map((a, j) => Math.round(a + (B[j] - a) * f)).join(',')})`; };
function dibujarConsolaMente(t, k = 1){
  riel('mind', { mind: 'nv' });
  if (window.dibujarCerebro) window.dibujarCerebro(t);
  const MOOD = [[4, 4, 4.2, 3.8, 4.1, 4.3, 4, 4.2, 4.1, 3.9, 4.2, 4.4, 4.1, 4.2], [4.4, 4.5, 4.3, 4.6, 4.4, 4.5, 4.3, 4.6, 4.5, 4.4, 4.6, 4.5, 4.4, 4.6], [4.1, 4, 4.2, 4.1, 3.9, 4, 4.1, 3.9, 3.8, 3.9, 3.7, 3.8, 3.7, 3.6], [4.2, 4.1, 4.3, 4, 4.2, 4.1, 4, 3.4, 3, 2.8, 2.6, 2.7, 2.5, 2.4]];
  const N = [['Mara', 'Commander'], ['David', 'Pilot'], ['Ingrid', 'Flight eng.'], ['Kenji', 'Mission spec.']];
  const cols = Math.ceil(14 * Math.min(1, k * 1.1));
  $('mapa').innerHTML = MOOD.map((r, i) => `<div class="nm">${N[i][0]}<span>${N[i][1]}</span></div><div class="celdas">${r.map((v, j) => `<i style="background:${j < cols ? colRampa(v) : 'rgba(255,255,255,.04)'};opacity:${j < cols ? .55 + .45 * (j / 13) : 1}"></i>`).join('')}</div><div class="pr" style="color:${i === 3 ? 'var(--nv)' : ''}">${(r.reduce((a, b) => a + b) / 14).toFixed(1)}<span class="u">/5</span></div>`).join('');
  $('dias').innerHTML = Array.from({ length: 14 }, (_, j) => `<span>${j === 13 ? 'Now' : j % 2 ? '' : 201 + j}</span>`).join('');
  const est = [['Mara', 1], ['David', 1], ['Ingrid', 2], ['Kenji', 3]];
  $('pStress').innerHTML = est.map(([n, e], i) => `<div class="fila4${i === 3 ? ' x' : ''}"><span>${n}</span><div style="display:flex;gap:5px">${[0, 1, 2, 3, 4].map(j => `<i style="flex:1;height:12px;border-radius:5px;background:${j <= e ? ['#46c8e8', '#8fb8ff', '#a898ff', '#d27fd0', '#ec6aa8'][j] : 'rgba(255,255,255,.07)'}"></i>`).join('')}</div><b>${['Low', 'Low', 'Mid', 'High'][i]}</b></div>`).join('');
  $('pFocus').innerHTML = [['Mara', 251, 0], ['David', 244, 0], ['Ingrid', 259, 0], ['Kenji', 298, 1]].map(([n, v, x], i) => `<div class="fila4${x ? ' x' : ''}"><span>${n}</span><svg id="fo${i}" viewBox="0 0 200 34"></svg><b>${v}<span class="u">ms</span></b></div>`).join('');
  [0, 1, 2, 3].forEach(i => serie($('fo' + i), 200, 34, Array.from({ length: 14 }, (_, j) => .5 + (h1(i * 20 + j) - .5) * .25 + (i === 3 && j > 8 ? (j - 8) * .09 : 0)), { col: i === 3 ? '#a898ff' : '#46c8e8', area: false }));
  $('pCon').innerHTML = [['Mara', 3], ['David', 4], ['Ingrid', 0], ['Kenji', 2]].map(([n, c], i) => `<div class="fila4${c === 0 ? ' x' : ''}"><span>${n}</span><div style="display:flex;gap:6px">${Array.from({ length: 7 }, (_, j) => `<i style="width:16px;height:16px;border-radius:50%;background:${j < c ? '#8fe6f5' : 'rgba(255,255,255,.07)'}"></i>`).join('')}</div><b>${c === 0 ? '9 d' : c}</b></div>`).join('');
  novaPanel(t, { expr: 'pensativa', mira: [-.6, .1] }); if ($('met')) $('met').textContent = 'Mission time 214d ' + reloj(t);
}

/* ── cuerpo ── */
function dibujarConsolaCuerpo(t, k = 1){
  riel('body', { body: 'nv' });
  const CR = [['Mara', 96, 0], ['David', 82, 1], ['Ingrid', 90, 0], ['Kenji', 74, 0]];
  $('ej').innerHTML = CR.map(([n, m, x], i) => `<div class="p"><div class="nm">${n}<b style="${x ? 'color:var(--nv)' : ''}">${[17.1, 13.8, 16.9, 15.2][i]}<span class="u">h this week</span></b></div><svg id="ej${i}" viewBox="0 0 300 130"></svg></div>`).join('');
  CR.forEach(([n, m, x], i) => { let h = `<line x1="0" y1="${130 - 2.5 / 3.2 * 120}" x2="300" y2="${130 - 2.5 / 3.2 * 120}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 5"/>`;
    for (let d = 0; d < 7; d++){ const vis = d < Math.ceil(7 * k); if (!vis) continue; const r = 1.1 + (h1(i * 9 + d) - .5) * .4, c = (x ? (d > 3 ? .45 : 1.1) : 1.2) + (h1(i * 9 + d + 50) - .5) * .4, bw = 26, xx = d * 42 + 8;
      const hr = r / 3.2 * 120, hc = c / 3.2 * 120; h += `<rect x="${xx}" y="${130 - hr}" width="${bw}" height="${hr}" rx="6" fill="#6fd6b0"/><rect x="${xx}" y="${130 - hr - hc - 3}" width="${bw}" height="${hc}" rx="6" fill="${x && d > 3 ? '#a898ff' : '#8fe6f5'}"/>`; }
    $('ej' + i).innerHTML = h; });
  // hueso: proyección de la misión (520 días)
  const W = 440, H = 500, X = d => 44 + d / 520 * (W - 64), Y = p => 24 + (-p) / 9 * (H - 64);
  let g = ''; [0, -3, -6, -9].forEach(p => g += `<line x1="40" y1="${Y(p)}" x2="${W - 20}" y2="${Y(p)}" stroke="rgba(255,255,255,.05)"/><text x="30" y="${Y(p) + 4}" text-anchor="end" font-family="SG" font-size="13" fill="#5b6573">${p}%</text>`);
  g += `<path d="${suave(Array.from({ length: 10 }, (_, j) => [X(j * 20), Y(-1.5 * j * 20 / 30)]))}" fill="none" stroke="rgba(236,106,168,.5)" stroke-width="1.6" stroke-dasharray="4 6"/><text x="${X(180) + 10}" y="${Y(-9) + 4}" font-family="SG" font-size="14" fill="#ec6aa8">without exercise</text>`;
  [['#8fe6f5', .38], ['#8fe6f5', .32], ['#8fe6f5', .35], ['#a898ff', .46]].forEach(([c, r], i) => { const hoy = 214, pts = Array.from({ length: 23 }, (_, j) => [X(j * hoy / 22), Y(-r * j * hoy / 22 / 30 + (h1(i * 30 + j) - .5) * .15)]);
    g += `<path d="${suave(pts)}" fill="none" stroke="${c}" stroke-width="1.8" opacity="${i === 3 ? 1 : .55}"/><path d="M${pts[22][0]} ${pts[22][1]} L${X(520)} ${Y(-r * 520 / 30)}" stroke="${c}" stroke-width="1.4" stroke-dasharray="2 5" opacity=".5"/>`; });
  g += `<line x1="${X(214)}" y1="16" x2="${X(214)}" y2="${H - 30}" stroke="rgba(255,255,255,.15)"/><text x="${X(214)}" y="${H - 10}" text-anchor="middle" font-family="SG" font-size="12.5" fill="#9aa4b2">today</text><text x="${X(520)}" y="${H - 10}" text-anchor="end" font-family="SG" font-size="12.5" fill="#5b6573">landing</text>`;
  $('pHueso').innerHTML = g;
  $('pMus').innerHTML = [['Mara', 97], ['David', 95], ['Ingrid', 98], ['Kenji', 96]].map(([n, v]) => `<div class="fila4"><span>${n}</span><div class="r"><i style="width:${v * k}%"></i><em></em></div><b>${v}%</b></div>`).join('') + `<div style="font:400 13px SG;color:var(--t3);margin-top:12px">Line marks 90%, the level to keep before landing.</div>`;
  $('pOjo').innerHTML = [['Mara', 'Normal', 'var(--ok)'], ['David', 'Normal', 'var(--ok)'], ['Ingrid', 'Normal', 'var(--ok)'], ['Kenji', 'Recheck Sol 220', 'var(--rd)']].map(([n, s, c]) => `<div class="ojo">${n}<span style="color:${c}">${s}</span></div>`).join('');
  novaPanel(t, { expr: 'normal', mira: [-.6, .1] }); if ($('met')) $('met').textContent = 'Mission time 214d ' + reloj(t);
}

/* ── radiación v4: tormenta solar en motion graphics ── */
const MOD4 = [ // nombre, x0, x1, radio, tasa
  ['Command', 150, 270, 50, 4.9], ['Lab', 290, 500, 64, 5.6], ['Quarters', 520, 630, 56, 4.2],
  ['Shelter', 650, 830, 70, 1.6], ['Habitat', 850, 1030, 64, 4.4], ['Airlock', 1050, 1110, 40, 6.1]];
const YN = 470, SH = { cx: 740, cy: YN, rx: 150, ry: 108 };
function dibujarConsolaRadiacion(t){
  riel('rad', { rad: 'al' });
  const cvs = $('cv'), W = 1296, H = 928; if (cvs.width !== W){ cvs.width = W; cvs.height = H; }
  const c = cvs.getContext('2d'); c.clearRect(0, 0, W, H);
  // campo de dosis: nubes que respiran sobre cada módulo
  MOD4.forEach(([n, x0, x1, r, v], i) => { const cx = (x0 + x1) / 2, col = v < 2.5 ? [70, 200, 232] : v < 5 ? [242, 180, 87] : [236, 106, 168], R = (x1 - x0) * .75 + 60, a = (n === 'Shelter' ? .1 : .2 + v / 40) * (1 + .15 * Math.sin(t * 1.6 + i));
    const g = c.createRadialGradient(cx, YN, 10, cx, YN, R); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.beginPath(); c.ellipse(cx, YN, R, R * .75, 0, 0, 7); c.fill(); });
  // tormenta: partículas que llegan del Sol (arriba a la izquierda); el escudo del refugio las frena
  const dx = .92, dy = .4, inside = (x, y) => ((x - SH.cx) / SH.rx) ** 2 + ((y - SH.cy) / SH.ry) ** 2 < 1;
  c.lineCap = 'round';
  for (let i = 0; i < 520; i++){ const s = h1(i), sp = 260 + s * 340, L = 18 + s * 46, per = 1900;
    const d = ((t * sp + h1(i + 7) * per) % per), sx = -300 + h1(i + 3) * 900 - 200, sy = -200 + h1(i + 11) * 1100 - 300;
    const x = sx + dx * d, y = sy + dy * d; if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
    if (inside(x, y)){ continue; }
    const tx = x - dx * L, ty = y - dy * L, al = .18 + .5 * s;
    const gr = c.createLinearGradient(tx, ty, x, y); gr.addColorStop(0, 'rgba(255,170,210,0)'); gr.addColorStop(1, `rgba(255,190,220,${al})`);
    c.strokeStyle = gr; c.lineWidth = .8 + s * 1.2; c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
    // a punto de chocar con el escudo: chispa
    const nx = x + dx * 14, ny = y + dy * 14; if (inside(nx, ny)){ c.fillStyle = `rgba(143,230,245,${.5 + .5 * s})`; c.beginPath(); c.arc(x, y, 2 + s * 2, 0, 7); c.fill(); }
  }
  // escudo del refugio
  const pul = .5 + .5 * Math.sin(t * 2.2);
  const gs = c.createRadialGradient(SH.cx, SH.cy, SH.rx * .4, SH.cx, SH.cy, SH.rx * 1.05); gs.addColorStop(0, 'rgba(70,200,232,0)'); gs.addColorStop(.85, `rgba(70,200,232,${.08 + .04 * pul})`); gs.addColorStop(1, 'rgba(143,230,245,.0)');
  c.fillStyle = gs; c.beginPath(); c.ellipse(SH.cx, SH.cy, SH.rx * 1.05, SH.ry * 1.05, 0, 0, 7); c.fill();
  c.strokeStyle = `rgba(143,230,245,${.55 + .25 * pul})`; c.lineWidth = 1.6; c.beginPath(); c.ellipse(SH.cx, SH.cy, SH.rx, SH.ry, 0, 0, 7); c.stroke();
  for (let k = 0; k < 2; k++){ const u = ((t * .5 + k * .5) % 1); c.strokeStyle = `rgba(143,230,245,${.35 * (1 - u)})`; c.lineWidth = 1; c.beginPath(); c.ellipse(SH.cx, SH.cy, SH.rx * (1 + u * .25), SH.ry * (1 + u * .25), 0, 0, 7); c.stroke(); }
  // nave (SVG): cilindros con volumen, paneles en perspectiva
  let h = `<defs><linearGradient id="cil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3442"/><stop offset=".35" stop-color="#18202b"/><stop offset="1" stop-color="#090d13"/></linearGradient>
    <linearGradient id="pan" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a44"/><stop offset="1" stop-color="#0c1422"/></linearGradient></defs>`;
  [[575, -1], [940, -1]].forEach(([x, d]) => { const y0 = YN + d * 78, y1 = YN + d * 250, sk = 40 * d;
    h += `<line x1="${x}" y1="${YN + d * 56}" x2="${x}" y2="${y0}" stroke="#2a3442" stroke-width="4"/>`;
    h += `<path d="M${x - 70} ${y0} L${x + 70} ${y0} L${x + 70 + sk} ${y1} L${x - 70 + sk} ${y1}Z" fill="url(#pan)" stroke="rgba(143,190,255,.25)" stroke-width="1"/>`;
    for (let j = 1; j < 6; j++){ const yy = y0 + (y1 - y0) * j / 6, xs = sk * j / 6; h += `<line x1="${x - 70 + xs}" y1="${yy}" x2="${x + 70 + xs}" y2="${yy}" stroke="rgba(143,190,255,.12)"/>`; }
    h += `<line x1="${x}" y1="${y0}" x2="${x + sk}" y2="${y1}" stroke="rgba(143,190,255,.12)"/>`; });
  h += `<rect x="140" y="${YN - 10}" width="990" height="20" rx="10" fill="#0e141c" stroke="rgba(255,255,255,.08)"/>`;
  MOD4.forEach(([n, x0, x1, r, v], i) => { const sh = n === 'Shelter', col = v < 2.5 ? '#8fe6f5' : v < 5 ? '#f2b457' : '#ec6aa8';
    h += `<rect x="${x0}" y="${YN - r}" width="${x1 - x0}" height="${r * 2}" rx="${i === 0 ? r : 24}" fill="url(#cil)" stroke="${sh ? 'rgba(143,230,245,.8)' : 'rgba(255,255,255,.12)'}" stroke-width="${sh ? 1.6 : 1}"/>`;
    h += `<rect x="${x0 + 14}" y="${YN - r + 10}" width="${x1 - x0 - 28}" height="5" rx="2.5" fill="rgba(255,255,255,.08)"/>`;
    for (let w = 0; w < Math.floor((x1 - x0) / 40); w++) h += `<circle cx="${x0 + 28 + w * 40}" cy="${YN + r * .45}" r="3" fill="${col}" opacity=".55"/>`;
    h += `<text x="${(x0 + x1) / 2}" y="${YN + r + 34}" text-anchor="middle" font-family="SG" font-size="16" fill="${sh ? '#8fe6f5' : '#c5cfdb'}">${n}</text>`;
    h += `<text x="${(x0 + x1) / 2}" y="${YN + r + 60}" text-anchor="middle" font-family="SG" font-weight="300" font-size="22" fill="${col}">${v.toFixed(1)}<tspan font-size="13" fill="#5b6573"> mSv/h</tspan></text>`; });
  h += `<path d="M1118 ${YN - 26} L1170 ${YN - 48} L1170 ${YN + 48} L1118 ${YN + 26}Z" fill="url(#cil)" stroke="rgba(255,255,255,.12)"/>`;
  // tripulación
  const u = Math.min(1, Math.max(0, (t - 1.5) / 6)), ix = 400 + (700 - 400) * (1 - Math.pow(1 - u, 2.2));
  const pin = (n, x, y, col, lbl) => `<circle cx="${x}" cy="${y}" r="17" fill="#05080c" stroke="${col}" stroke-width="1.8"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-family="SG" font-size="12.5" font-weight="600" fill="${col}">${n}</text>` + (lbl ? `<text x="${x}" y="${y - 28}" text-anchor="middle" font-family="SG" font-size="13.5" fill="${col}">${lbl}</text>` : '');
  h += pin('MR', 712, YN - 22, '#8fe6f5') + pin('DO', 772, YN - 22, '#8fe6f5') + pin('KT', 742, YN + 26, '#8fe6f5');
  if (u < 1){ h += `<line x1="${ix + 22}" y1="${YN}" x2="690" y2="${YN}" stroke="#f2b457" stroke-width="1.4" stroke-dasharray="2 6"/>` + pin('IL', ix, YN, '#f2b457', `Ingrid, ${Math.max(0, Math.round(12 * (1 - u)))} m`); }
  else h += pin('IL', 700, YN + 26, '#8fe6f5');
  $('nave').innerHTML = h;
  // datos
  $('tasa').textContent = (4.8 + Math.sin(t * .9) * .12).toFixed(1);
  const m = Math.max(0, 112 - Math.floor(t / 60)); $('pico').textContent = `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
  $('ref').innerHTML = (u < 1 ? 3 : 4) + '<span class="u"> of 4</span>';
  const fl = Array.from({ length: 60 }, (_, i) => { const hh = -24 + i * .4; return hh < -4 ? .05 + .02 * h1(i) : Math.min(1, .05 + Math.pow((hh + 4) / 4, 2.4)); });
  serie($('flujo'), 400, 40, fl, { col: '#ec6aa8' });
  $('chk').innerHTML = [['Mara Reyes', 1], ['David Okafor', 1], ['Kenji Tanaka', 1], ['Ingrid Lindqvist', u >= 1]].map(([n, ok], i) => `<div>${n}<span style="color:${ok ? 'var(--ok)' : 'var(--rd)'}">${ok ? 'Sheltered' : Math.max(1, Math.round(12 * (1 - u))) + ' m away'}</span></div>`).join('');
  novaPanel(t, { expr: 'sorprendida', alerta: 1, mira: [-.6, .15] });
}
