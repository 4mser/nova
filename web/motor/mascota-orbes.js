/* Mascota de la misión: el gel de AURA (mismo motor de siluetas, ojos y ánimos) en el turquesa de PSYFIELD, con ORBES que la
   orbitan y son de su mismo cuerpo. Los orbes que pasan por delante se funden con el cuerpo (metaball por umbral de alfa) y
   los de atrás quedan más tenues y en profundidad. Devuelve un string SVG; se dibuja por cuadro.
   Depende de mascota-base.js (FORMAS, formaMezcla, silueta, mezcla). */
let _oid = 0;
const PAL_TURQ = { centro: '#02121a', hondo: '#0a4458', medio: '#1d9cc0', borde: '#5ad8f2', ojo: '#a6f2fc', halo: '#46c8e8', claro: '#c4f6fd', lila: '#9d8bff', alerta: '#e2589b' };

/* órbitas fijas: radio (×R), inclinación, giro del plano, velocidad, fase, tamaño (×R) */
const ORBITAS = [
  [1.55, 1.25, .25, .55, 0.0, .14], [1.78, 1.1, 1.25, -.42, 2.1, .1], [1.62, 1.35, -.7, .7, 4.0, .095],
  [1.95, 1.18, 2.2, .33, 1.2, .08], [1.7, 1.3, -1.6, -.6, 5.1, .11], [2.1, 1.22, .75, .26, 3.3, .065],
];
/* nube de partículas finas (como el orbe de PSYFIELD): radio, velocidad, fase, tamaño */
const POLVO = Array.from({ length: 70 }, (_, i) => { const h = k => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  return [1.25 + h(1) * .75, (.15 + h(2) * .45) * (h(3) < .5 ? 1 : -1), h(4) * 6.283, .4 + h(5) * 1.1, h(6) * 6.283]; });

function orbePos(x, y, R, t, k, apertura){
  const [r, inc, giro, v, f, s] = ORBITAS[k], a = t * v + f, rr = r * R * apertura;
  let px = Math.cos(a) * rr, py = 0, pz = Math.sin(a) * rr;
  const ci = Math.cos(inc), si = Math.sin(inc); [py, pz] = [py * ci - pz * si, py * si + pz * ci];
  const cg = Math.cos(giro), sg = Math.sin(giro); [px, py] = [px * cg - py * sg, px * sg + py * cg];
  const prof = pz / (r * R);                       // −1 atrás … 1 delante
  return { x: x + px, y: y + py * .9, z: prof, r: s * R * (1 + .22 * prof) };
}

/* forma más viva que la de AURA: ángulos y largos derivan lento, base que respira y dos bultos que viajan por el borde */
function formaFluida(pesos, t, vel, f = 1, habla = 0){
  const F = formaMezcla(pesos, t, vel);
  F.L = F.L.map(([a, l, sg], j, _, i = j % 5) => [a + f * .2 * Math.sin(t * .43 + i * 2.3) + f * .08 * Math.sin(t * 1.1 + i), l * (1 + f * .16 * Math.sin(t * .71 + i * 1.7)), sg * (1 + f * .12 * Math.sin(t * .5 + i))]);
  F.L.push([t * .37 + 1, .1 * f * (.6 + .4 * Math.sin(t * .9)), .32], [-t * .29 + 3.5, .08 * f * (.6 + .4 * Math.sin(t * .7 + 2)), .3]);
  F.base *= 1 + .025 * f * Math.sin(t * 1.3);
  if (habla > .01){
    // tres ondas suaves que recorren el borde, más marcadas mientras más fuerte habla
    for (let j = 0; j < 3; j++) F.L.push([t * (.9 + j * .35) + j * 2.1, habla * .05, .22]);
    // la «boca»: el borde de abajo-adelante se abulta con cada sílaba
    F.L.push([Math.PI / 2 + .15 * Math.sin(t * .8), habla * .1, .42]);
    F.base *= 1 + habla * .015;
  }
  return F;
}
/* o: lo mismo que mascota() + { orbes: 0..6 (cuántos), apertura: 1 (radio de órbita), pal, estado: 0..1 alerta (magenta) } */
function mascotaOrbes(o){
  const { x, y, R, t, expr = 'normal', mira = [0, 0], parpadeo = 0, op = 1, estira: est0 = 0, pesos = { [expr]: 1 }, vel = [0, 0],
          orbes = 6, apertura = 1, pal = PAL_TURQ, alerta = 0, sinOjos = false, fluido = 1, sinHalo = false, habla = 0 } = o;
  if (R < 1) return '';
  const estira = est0;
  const id = 'mo' + (_oid++), P = {};
  for (const k in pal) P[k] = pal[k];
  if (alerta > 0){ P.borde = mezcla(P.borde, '#ff8cc4', alerta); P.medio = mezcla(P.medio, '#c23a7e', alerta); P.halo = mezcla(P.halo, P.alerta, alerta); P.ojo = mezcla(P.ojo, '#ffd0e6', alerta); }
  const dy = Math.sin(t * 1.6) * R * .03, cy = y + dy;
  const vv = Math.min(.3, Math.hypot(vel[0], vel[1]) / 1500);
  const G = silueta(x, cy, R, formaFluida(pesos, t, vel, fluido, habla));
  const L = [];
  for (let k = 0; k < Math.min(6, Math.ceil(orbes)); k++){ const p = orbePos(x, cy, R, t, k, apertura * (1 + habla * .08)); p.vis = Math.min(1, orbes - k); p.r *= p.vis; L.push(p); }
  const delante = L.filter(p => p.z >= -.15 && p.r > .5), atras = L.filter(p => p.z < -.15 && p.r > .5);
  const W = R * 7, X0 = x - W / 2, Y0 = cy - W / 2;
  const nx = x + mira[0] * R * .06, ny = cy + R * .08 + mira[1] * R * .05;
  let h = `<defs>
    <radialGradient id="${id}h"><stop offset="0" stop-color="${P.halo}" stop-opacity=".42"/><stop offset=".55" stop-color="${P.halo}" stop-opacity=".1"/><stop offset="1" stop-color="${P.halo}" stop-opacity="0"/></radialGradient>
    <filter id="${id}b" filterUnits="userSpaceOnUse" x="${X0}" y="${Y0}" width="${W}" height="${W}"><feGaussianBlur stdDeviation="${R * .06}"/></filter>
    <filter id="${id}e" filterUnits="userSpaceOnUse" x="${X0}" y="${Y0}" width="${W}" height="${W}"><feGaussianBlur stdDeviation="${R * .07}"/></filter>
    <filter id="${id}g" filterUnits="userSpaceOnUse" x="${X0}" y="${Y0}" width="${W}" height="${W}"><feGaussianBlur stdDeviation="${R * .075}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter>
    <radialGradient id="${id}v" cx="${nx}" cy="${ny}" r="${R * (1.9 + vv * 1.6)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.centro}"/><stop offset=".25" stop-color="${P.hondo}"/><stop offset=".43" stop-color="${P.medio}"/><stop offset=".56" stop-color="${P.borde}"/><stop offset="1" stop-color="${P.claro}"/></radialGradient>
    <radialGradient id="${id}o"><stop offset="0" stop-color="${P.claro}"/><stop offset=".45" stop-color="${P.borde}"/><stop offset="1" stop-color="${P.medio}"/></radialGradient>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="${X0}" y="${Y0}" width="${W}" height="${W}"><g filter="url(#${id}g)" fill="#fff"><path d="${G}"/>${delante.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.r}"/>`).join('')}</g></mask>
  </defs><g opacity="${op}" transform="translate(${x} ${y + R}) scale(${1 + estira * .1} ${1 - estira * .1}) translate(${-x} ${-y - R})">`;
  if (!sinHalo) h += `<ellipse cx="${x}" cy="${cy}" rx="${R * 2.6}" ry="${R * 2.4}" fill="url(#${id}h)" opacity="${1 + habla * .35}"/>`;
  // polvo de partículas en órbita (plano levemente inclinado), las de atrás más tenues
  for (const [r, v, f, s, ph] of POLVO){ const a = t * v + f, px = x + Math.cos(a) * r * R * apertura, pz = Math.sin(a), py = cy + pz * r * R * .32 * apertura + Math.sin(t * .8 + ph) * R * .05;
    const al = (.25 + .45 * Math.sin(t * 2 + ph) ** 2) * (pz > 0 ? 1 : .45) * Math.min(1, orbes / 2);
    if (al > .02) h += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(s * R / 110 * (pz > 0 ? 1.1 : .8)).toFixed(2)}" fill="${P.claro}" opacity="${al.toFixed(2)}"/>`; }
  // orbes de atrás: más chicos, más oscuros, desenfocados
  for (const p of atras){ const k = (p.z + 1) / .85;
    h += `<circle cx="${p.x}" cy="${p.y}" r="${p.r * .9}" fill="${P.medio}" opacity="${(.35 + .4 * k) * p.vis}" filter="url(#${id}b)"/>`; }
  // cuerpo + orbes delanteros fundidos: un solo material
  h += `<rect x="${X0}" y="${Y0}" width="${W}" height="${W}" fill="url(#${id}v)" mask="url(#${id}m)"/>`;
  h += `<g mask="url(#${id}m)"><path d="${G}" fill="none" stroke="${P.claro}" stroke-width="${R * .16}" opacity="${.3 + habla * .12}" filter="url(#${id}b)"/></g>`;
  // cada orbe con su brillo propio
  for (const p of delante){
    h += `<circle cx="${p.x}" cy="${p.y}" r="${p.r * .92}" fill="url(#${id}o)" opacity=".55"/>`;
    h += `<ellipse cx="${p.x - p.r * .32}" cy="${p.y - p.r * .38}" rx="${p.r * .32}" ry="${p.r * .16}" transform="rotate(-30 ${p.x - p.r * .32} ${p.y - p.r * .38})" fill="#fff" opacity=".75"/>`; }
  // reflejo fijo arriba (sin brillo giratorio)
  h += `<ellipse cx="${x - R * .34}" cy="${cy - R * .52}" rx="${R * .36}" ry="${R * .15}" transform="rotate(-28 ${x - R * .34} ${cy - R * .52})" fill="#fff" opacity=".3" filter="url(#${id}b)"/>`;
  h += `<ellipse cx="${x - R * .4}" cy="${cy - R * .56}" rx="${R * .14}" ry="${R * .045}" transform="rotate(-30 ${x - R * .4} ${cy - R * .56})" fill="#fff" opacity=".8"/>`;
  // ojos: los de AURA (se reutiliza mascota() sólo para la capa de ojos)
  if (!sinOjos){
    const ojos = mascota({ x, y, R, t, expr, mira, parpadeo, pesos, vel, op: 1 });
    const m = ojos.match(/<g color="[^"]*" fill="[^"]*" filter="url\(#(ma\d+)e\)" opacity="\.9">([\s\S]*?)<\/g><g color="#fff" fill="#fff">([\s\S]*?)<\/g>/);
    if (m) h += `<g color="${P.ojo}" fill="${P.ojo}" filter="url(#${id}e)" opacity=".95">${m[2]}</g><g color="#fff" fill="#fff">${m[3]}</g>`;
  }
  return h + '</g>';
}
