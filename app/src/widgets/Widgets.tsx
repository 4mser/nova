/* Widgets de la pantalla de inicio (Android), con el estilo de la app: fondo #0a0f15, borde fino, Space Grotesk,
   números livianos, turquesa para lo vivo, ámbar para lo que se sale de lo habitual, lila para lo íntimo
   (check-in, sesión) y la escala de 5 colores del check-in. */
// la librería llama a los widgets como funciones simples: el React Compiler no puede memoizarlos (daría «Invalid hook call»)
'use no memo';

import { FlexWidget, ImageWidget, OverlapWidget, SvgWidget, TextWidget, type WidgetInfo } from 'react-native-android-widget';
import { estadoAgenda, horaNave } from '../engine/agenda';
import { traductor, type Traductor } from '../i18n';
import type { DatosWidget, DiaWidget } from './datos';
import type { DatosCrew } from './crew';
import type { DatosCasa } from './casa';

type Hex = `#${string}`;
const C = { fondo: '#0a0f15', borde: '#1a2129', s2: '#121a23', t1: '#f2f5f8', t2: '#9aa4b2', t3: '#5b6573', sig: '#46c8e8', nova: '#8fe6f5', lila: '#a898ff', aviso: '#f2b457', ok: '#6fd6b0', l2: '#232c36' } as const;
const F = { l: 'SpaceGrotesk_300Light', r: 'SpaceGrotesk_400Regular', m: 'SpaceGrotesk_500Medium', s: 'SpaceGrotesk_600SemiBold' };
/* lo mismo que el check-in de la app (ESCALAS de engine/diario): nombre, palabras por nivel y si «alto» es bueno */
const ESC = [
  { id: 'animo', t: 'Mood', n: ['Very low', 'Low', 'Okay', 'Good', 'Very good'], bueno: true },
  { id: 'energia', t: 'Energy', n: ['Drained', 'Low', 'Steady', 'Good', 'Full'], bueno: true },
  { id: 'estres', t: 'Stress', n: ['Calm', 'Mild', 'Some', 'High', 'Very high'], bueno: false },
  { id: 'sueno', t: 'Sleep', n: ['Poor', 'Restless', 'Fair', 'Good', 'Great'], bueno: true },
  { id: 'conexion', t: 'Crew', n: ['Isolated', 'Distant', 'Neutral', 'Close', 'Very close'], bueno: true },
  { id: 'carga', t: 'Work', n: ['Light', 'Easy', 'Fair', 'Heavy', 'Overloaded'], bueno: false },
];
const NIVEL = ['#ec6aa8', '#f2b457', '#9aa4b2', '#46c8e8', '#6fd6b0'];
const colorNivel = (v: number, bueno: boolean) => NIVEL[(bueno ? v : 6 - v) - 1] as Hex;

const marco = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: C.fondo as Hex, borderRadius: 26, borderWidth: 1, borderColor: C.borde as Hex, padding: 14 };

function linea(vals: number[], w: number, h: number, color: string) {
  if (vals.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`;
  const mn = Math.min(...vals), mx = Math.max(...vals), x = (i: number) => (i / (vals.length - 1)) * (w - 6) + 3, y = (v: number) => h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 8);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="3.6" fill="${color}"/></svg>`;
}

function barra(p: number, w: number, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6"><rect width="${w}" height="6" rx="3" fill="#1d2630"/><rect width="${Math.max(6, w * Math.min(1, p))}" height="6" rx="3" fill="${color}"/></svg>`;
}

/** anillo de avance con el hueco arriba, como el de la app */
function anillo(p: number, s: number, color: string) {
  const r = s / 2 - 5, c = s / 2, L = 2 * Math.PI * r;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#1d2630" stroke-width="7"/>${p > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(L * Math.min(1, p)).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : ''}</svg>`;
}

function Etiqueta({ t, color = C.t2 }: { t: string; color?: string }) {
  return <TextWidget text={t} style={{ fontFamily: F.m, fontSize: 12, color: color as Hex }} />;
}

/** el check-in solo vale el día en que se hizo */
function checkinDeHoy(d: DatosWidget, hoyF: string) {
  const vals = d.checkin?.fecha === hoyF ? d.checkin.valores : ESC.map(() => null);
  const hechos = vals.filter(v => v != null).length;
  return { vals, hechos, completo: hechos === ESC.length, emociones: d.checkin?.fecha === hoyF ? d.checkin.emociones : [] };
}

/** Heart (2×2): pulso con su curva y la variabilidad; «Live» si viene del reloj */
function Corazon({ d, w, tr: { t } }: { d: DatosWidget; w: number; tr: Traductor }) {
  const col = d.fcVivo ? C.ok : C.sig;
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://salud?seg=cuerpo' }} style={{ ...marco, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <Etiqueta t={t('Heart')} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={d.fcVivo ? `● ${t('Live')}` : t('Demo')} style={{ fontFamily: F.m, fontSize: 11, color: d.fcVivo ? C.ok : C.t3 }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <TextWidget text={String(d.fc)} style={{ fontFamily: F.l, fontSize: 40, color: C.t1 }} />
        <TextWidget text={` ${t('bpm')}`} style={{ fontFamily: F.r, fontSize: 13, color: C.t2, marginBottom: 7 }} />
      </FlexWidget>
      <SvgWidget svg={linea(d.serieFc, Math.max(100, w - 30), 30, col)} style={{ height: 30, width: 'match_parent' }} />
      <TextWidget text={`${t('HRV')} ${d.vfc} ms · ${d.fcVivo && d.relojNombre ? d.relojNombre : t('chest strap')}`} maxLines={1} truncate="END" style={{ fontFamily: F.r, fontSize: 11.5, color: C.t3 }} />
    </FlexWidget>
  );
}

/** Mission (4×1): Sol y avance a Marte, la próxima sesión privada y la dosis */
function Mision({ d, w, tr: { t } }: { d: DatosWidget; w: number; tr: Traductor }) {
  // «Saturday, 10:00» → «Sat 10:00» / «Sáb 10:00»
  const [dia, hora] = d.sesion.split(', ');
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://perfil' }} style={{ ...marco, flexDirection: 'row', alignItems: 'center', flexGap: 16, paddingVertical: 10 }}>
      <FlexWidget style={{ flexGap: 4 }}>
        <TextWidget text={`Sol ${d.sol}`} style={{ fontFamily: F.m, fontSize: 18, color: C.t1 }} />
        <SvgWidget svg={barra(d.avance, 96, C.sig)} style={{ height: 6, width: 96 }} />
        <TextWidget text={t('{p}% · {n} sols to Mars', { p: Math.round(d.avance * 100), n: d.solesRestantes })} style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, flexGap: 2 }}>
        <TextWidget text={t('Private session')} style={{ fontFamily: F.m, fontSize: 11.5, color: C.lila }} />
        <TextWidget text={t('In {n} days · {dia} {hora}', { n: d.sesionEnDias, dia: t(dia).slice(0, 3), hora: hora ?? '' })} maxLines={1} truncate="END" style={{ fontFamily: F.r, fontSize: 14, color: C.t1 }} />
      </FlexWidget>
      {w > 300 ? (
        <FlexWidget style={{ alignItems: 'flex-end', flexGap: 2 }}>
          <TextWidget text={`${d.dosis} mSv`} style={{ fontFamily: F.m, fontSize: 14, color: C.aviso }} />
          <TextWidget text={t('{p}% of limit', { p: Math.round(d.limiteP * 100) })} style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/** Check-in (2×2): cuánto falta, o tus seis respuestas en palabras y color; abre el Journal */
function CheckIn({ d, hoyF, tr }: { d: DatosWidget; hoyF: string; tr: Traductor }) {
  const { t } = tr;
  const ci = checkinDeHoy(d, hoyF);
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://journal' }} style={{ ...marco, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <Etiqueta t={t('Check-in')} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={ci.completo ? `✓ ${t('Done')}` : d.modo === 'mision' ? `Sol ${d.sol}` : d.dia?.diaTxt ?? ''} maxLines={1} style={{ fontFamily: F.m, fontSize: 11, color: ci.completo ? C.ok : C.t3 }} />
      </FlexWidget>
      {ci.completo ? (
        <TextWidget text={ci.emociones.length ? ci.emociones.slice(0, 3).map(m => t(m)).join(' · ') : t('{nombre}, all six answered', { nombre: d.nombre.split(' ')[0] })} maxLines={1} truncate="END" style={{ fontFamily: F.m, fontSize: 12.5, color: ci.emociones.length ? C.lila : C.t3 }} />
      ) : (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 12 }}>
          <SvgWidget svg={anillo(ci.hechos / ESC.length, 58, C.lila)} style={{ width: 58, height: 58 }} />
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text={`${ci.hechos}/${ESC.length}`} style={{ fontFamily: F.l, fontSize: 26, color: C.t1 }} />
            <TextWidget text={t('answered')} style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} />
          </FlexWidget>
        </FlexWidget>
      )}
      {ci.completo ? (
        <FlexWidget style={{ width: 'match_parent', flexGap: 10 }}>
          {[0, 3].map(f => (
            <FlexWidget key={f} style={{ flexDirection: 'row', width: 'match_parent' }}>
              {ESC.slice(f, f + 3).map((e, j) => {
                const v = ci.vals[f + j];
                return (
                  <FlexWidget key={e.t} style={{ flex: 1 }}>
                    <TextWidget text={t(e.t)} style={{ fontFamily: F.r, fontSize: 10.5, color: C.t3 }} />
                    <TextWidget text={v ? tr.tc(e.id, e.n[v - 1]) : '—'} maxLines={1} truncate="END" style={{ fontFamily: F.m, fontSize: 13, color: v ? colorNivel(v, e.bueno) : C.t3 }} />
                  </FlexWidget>
                );
              })}
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexGap: 2 }}>
          <TextWidget text={ci.hechos ? tr.tp(ESC.length - ci.hechos, '{n} question left', '{n} questions left') : t('How are you today?')} maxLines={1} truncate="END" style={{ fontFamily: F.m, fontSize: 14.5, color: C.t1 }} />
          <TextWidget text={t(ci.hechos ? 'Tap to finish' : 'About a minute')} style={{ fontFamily: F.m, fontSize: 12, color: C.nova }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** Plan (4×2): lo que viene hoy en hora de la nave, con lo que pasa ahora marcado. Se calcula al dibujar */
function Plan({ ahora, tr: { t } }: { ahora: number; tr: Traductor }) {
  const todo = estadoAgenda(ahora), desde = todo.findIndex(b => b.estado !== 'hecho');
  const lista = desde === -1 ? [] : todo.slice(desde, desde + 3);
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...marco, flexGap: 8 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <Etiqueta t={t("Today's plan")} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={t('{h} ship time', { h: horaNave(ahora) })} style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} />
      </FlexWidget>
      {lista.length ? lista.map((b, i) => {
        const now = b.estado === 'ahora';
        return (
          <FlexWidget key={b.h} style={{ flexDirection: 'row', alignItems: 'center', flexGap: 10, width: 'match_parent', paddingVertical: 2 }}>
            <TextWidget text={b.h} style={{ fontFamily: F.m, fontSize: 12.5, color: now ? C.nova : C.t3 }} />
            <TextWidget text="●" style={{ fontSize: now ? 10 : 7, color: now ? C.nova : i === 0 ? C.t2 : C.l2 }} />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={t(b.t)} maxLines={1} truncate="END" style={{ fontFamily: now ? F.s : F.m, fontSize: 14, color: C.t1 }} />
              <TextWidget text={b.estado === 'luego' && b.faltan < 120 ? t('In {n} min · {d}', { n: b.faltan, d: t(b.d) }) : t(b.d)} maxLines={1} truncate="END" style={{ fontFamily: F.r, fontSize: 11.5, color: C.t3 }} />
            </FlexWidget>
            {now ? <TextWidget text={` ${t('Now')} `} style={{ fontFamily: F.m, fontSize: 11, color: C.nova, backgroundColor: '#12303a', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2 }} /> : null}
          </FlexWidget>
        );
      }) : (
        <TextWidget text={t('Day complete. Tomorrow starts at {h} with {que}.', { h: todo[0].h, que: t(todo[0].t).toLowerCase() })} style={{ fontFamily: F.r, fontSize: 14, color: C.t2 }} />
      )}
    </FlexWidget>
  );
}

const horaTxt = (ts: number, tr: Traductor) => new Date(ts).toLocaleTimeString(tr.locale, { hour: '2-digit', minute: '2-digit', hour12: false });
const durTxt = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`; };

/** Cuerpo (2×2, día a día): pulso real, sueño de anoche, pasos y recuperación; sin datos, invita a conectar */
function CuerpoDia({ x, tr: { t, locale } }: { x: DiaWidget; tr: Traductor }) {
  const recCol = x.recup === 'buena' ? C.ok : x.recup === 'baja' ? C.aviso : C.nova;
  const nada = x.fc == null && x.suenoH == null && x.pasos == null;
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://salud?seg=cuerpo' }} style={{ ...marco, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <Etiqueta t={t('Body')} />
        <FlexWidget style={{ flex: 1 }} />
        {x.recup ? <TextWidget text={`● ${t(x.recup === 'buena' ? 'recovered' : x.recup === 'baja' ? 'go easy' : 'as usual')}`} style={{ fontFamily: F.m, fontSize: 11, color: recCol as Hex }} /> : x.fcVivo ? <TextWidget text={`● ${t('Live')}`} style={{ fontFamily: F.m, fontSize: 11, color: C.ok }} /> : null}
      </FlexWidget>
      {nada ? (
        <FlexWidget style={{ flexGap: 3 }}>
          <TextWidget text={t('No data yet')} style={{ fontFamily: F.m, fontSize: 15, color: C.t1 }} />
          <TextWidget text={t('Connect Health Connect or your watch in Nova')} maxLines={2} style={{ fontFamily: F.r, fontSize: 11.5, color: C.t3 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <TextWidget text={x.fc != null ? String(x.fc) : x.suenoH != null ? durTxt(x.suenoH) : (x.pasos ?? 0).toLocaleString(locale)} style={{ fontFamily: F.l, fontSize: 38, color: C.t1 }} />
          <TextWidget text={x.fc != null ? ` ${t('bpm')}` : x.suenoH != null ? '' : ` ${t('steps')}`} style={{ fontFamily: F.r, fontSize: 13, color: C.t2, marginBottom: 7 }} />
        </FlexWidget>
      )}
      <FlexWidget style={{ flexGap: 2 }}>
        {x.suenoH != null && x.fc != null ? <TextWidget text={`${t('Sleep')} ${durTxt(x.suenoH)}`} style={{ fontFamily: F.r, fontSize: 12, color: C.t2 }} /> : null}
        {x.pasos != null && (x.fc != null || x.suenoH != null) ? <TextWidget text={`${x.pasos.toLocaleString(locale)} ${t('steps')}`} style={{ fontFamily: F.r, fontSize: 12, color: C.t2 }} /> : null}
        {x.origen ? <TextWidget text={x.origen} maxLines={1} truncate="END" style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} /> : null}
      </FlexWidget>
    </FlexWidget>
  );
}

/** Hábitos y foco (4×1, día a día): un punto por hábito (lleno si ya lo hiciste), minutos de foco y la mejor racha */
function HabitosFoco({ x, w, tr: { t } }: { x: DiaWidget; w: number; tr: Traductor }) {
  const hechos = x.habitos.filter(h => h.hecho).length;
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...marco, flexDirection: 'row', alignItems: 'center', flexGap: 14, paddingVertical: 10 }}>
      <FlexWidget style={{ flex: 1, flexGap: 5 }}>
        <TextWidget text={x.habitos.length ? t('Habits · {n} of {total}', { n: hechos, total: x.habitos.length }) : t('Habits')} style={{ fontFamily: F.m, fontSize: 12, color: C.t2 }} />
        {x.habitos.length ? (
          <FlexWidget style={{ flexDirection: 'row', flexGap: 6 }}>
            {x.habitos.slice(0, 6).map((h, i) => (
              <FlexWidget key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: (h.hecho ? h.color : '#1d2630') as Hex, borderWidth: h.hecho ? 0 : 1, borderColor: '#2b3540' }} />
            ))}
            {x.racha >= 2 ? <TextWidget text={`  🔥 ${x.racha}`} style={{ fontFamily: F.m, fontSize: 12, color: C.aviso }} /> : null}
          </FlexWidget>
        ) : <TextWidget text={t('Choose your habits in Nova')} style={{ fontFamily: F.r, fontSize: 12.5, color: C.t3 }} />}
      </FlexWidget>
      {w > 220 ? (
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://foco' }} style={{ alignItems: 'flex-end', flexGap: 2 }}>
          <TextWidget text={`${x.focoMin} min`} style={{ fontFamily: F.m, fontSize: 16, color: x.focoMin ? C.t1 : C.t3 }} />
          <TextWidget text={t('focus today ▸')} style={{ fontFamily: F.r, fontSize: 11, color: C.nova }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/** Tu día (4×2, día a día): lo que viene en tu agenda (lo de ahora marcado) y tus tareas de hoy. Se calcula al dibujar */
function TuDia({ x, ahora, tr }: { x: DiaWidget; ahora: number; tr: Traductor }) {
  const { t } = tr;
  const fin = new Date(ahora); fin.setHours(23, 59, 59, 999);
  const prox = x.eventos.filter(e => !e.todoElDia && e.fin > ahora && e.ini <= fin.getTime()).slice(0, 3);
  const filas: { h: string; txt: string; sub?: string; ahora: boolean; color?: string }[] = prox.map(e => ({
    h: horaTxt(e.ini, tr), txt: e.titulo, ahora: e.ini <= ahora, color: e.color,
    sub: e.ini <= ahora ? t('until {h}', { h: horaTxt(e.fin, tr) }) : e.ini - ahora < 2 * 3600e3 ? t('in {n} min', { n: Math.round((e.ini - ahora) / 60e3) }) : undefined,
  }));
  const libres = 4 - filas.length;
  for (const tarea of x.tareas.slice(0, Math.max(0, libres))) filas.push({ h: '☐', txt: tarea, ahora: false });
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...marco, flexGap: 7 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <Etiqueta t={t('Your day')} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={x.diaTxt} style={{ fontFamily: F.r, fontSize: 11, color: C.t3 }} />
        {/* nota rápida por voz: abre NOVA grabando */}
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://nota' }} style={{ marginLeft: 10, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#12303a', flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
          <TextWidget text="🎙" style={{ fontSize: 12 }} />
          <TextWidget text={t('Note')} style={{ fontFamily: F.m, fontSize: 11.5, color: C.nova }} />
        </FlexWidget>
      </FlexWidget>
      {filas.length ? filas.map((f, i) => (
        <FlexWidget key={i} style={{ flexDirection: 'row', alignItems: 'center', flexGap: 10, width: 'match_parent' }}>
          <TextWidget text={f.h} style={{ fontFamily: F.m, fontSize: 12.5, color: (f.ahora ? C.nova : C.t3) as Hex }} />
          <FlexWidget style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: (f.h === '☐' ? '#2b3540' : f.color ?? C.sig) as Hex }} />
          <FlexWidget style={{ flex: 1 }}>
            <TextWidget text={f.txt} maxLines={1} truncate="END" style={{ fontFamily: f.ahora ? F.s : F.m, fontSize: 13.5, color: C.t1 }} />
            {f.sub ? <TextWidget text={f.sub} style={{ fontFamily: F.r, fontSize: 11, color: (f.ahora ? C.nova : C.t3) as Hex }} /> : null}
          </FlexWidget>
          {f.ahora ? <TextWidget text={` ${t('Now')} `} style={{ fontFamily: F.m, fontSize: 11, color: C.nova, backgroundColor: '#12303a', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2 }} /> : null}
        </FlexWidget>
      )) : (
        <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
          <TextWidget text={x.agenda ? t('Nothing left today. Enjoy it.') : t('Turn on Calendar in Nova to see your day here.')} maxLines={2} style={{ fontFamily: F.r, fontSize: 13.5, color: C.t2 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

const fechaLocal = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function dibujar(nombre: string, d: DatosWidget, info?: WidgetInfo) {
  const w = info?.width ?? 160, ahora = Date.now(), hoyF = fechaLocal(ahora);
  // en el idioma guardado con los datos (las instantáneas viejas no lo traen: inglés)
  const tr = traductor(d.idioma), diario = d.modo !== 'mision' && !!d.dia;
  switch (nombre) {
    // día a día: los mismos widgets muestran lo real de tu día (los de misión quedan para el modo misión)
    case 'Corazon': return diario ? <CuerpoDia x={d.dia!} tr={tr} /> : <Corazon d={d} w={w} tr={tr} />;
    case 'Mision': return diario ? <HabitosFoco x={d.dia!} w={w} tr={tr} /> : <Mision d={d} w={w} tr={tr} />;
    case 'Diario': return <CheckIn d={d} hoyF={hoyF} tr={tr} />;
    case 'Plan': return diario ? <TuDia x={d.dia!} ahora={ahora} tr={tr} /> : <Plan ahora={ahora} tr={tr} />;
    default: return <FlexWidget style={marco}><TextWidget text="Nova" style={{ fontSize: 14, color: C.t1 }} /></FlexWidget>;
  }
}

/** Crew (4×2): lo que dejó cada persona hoy, foto por foto; sin fotos, cuántos faltan. Tocar abre la crew. */
/** la grilla que deja los cuadrados más grandes para n fotos en un área a×b (con separación g) */
function grilla(n: number, a: number, b: number, g: number) {
  let mejor = { cols: 1, filas: n, lado: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const filas = Math.ceil(n / cols), lado = Math.floor(Math.min((a - (cols - 1) * g) / cols, (b - (filas - 1) * g) / filas));
    if (lado > mejor.lado) mejor = { cols, filas, lado };
  }
  return mejor;
}

export function CrewWidget({ d, w, h, ahora }: { d: DatosCrew | null; w: number; h: number; ahora: number }) {
  const tr = traductor(d?.idioma), { t } = tr;
  const hoyF = fechaLocal(ahora), deHoy = !!d && d.fecha === hoyF;
  const fotos = deHoy ? d!.fotos : [];
  const total = deHoy ? d!.total : 0;
  const abierto = !!d && deHoy && ahora >= d.momento && ahora - d.momento < 10 * 60e3;
  const G = 6, PAD = 12, CAB = 22;
  // si hay más personas que cuadros, el último dice «+k»
  const extra = Math.max(0, total - fotos.length);
  const n = fotos.length + (extra ? 1 : 0);
  const { cols, lado } = grilla(Math.max(1, n), w - PAD * 2, h - PAD * 2 - CAB - 8, G);
  const filas: (typeof fotos[number] | 'extra')[][] = [];
  const items: (typeof fotos[number] | 'extra')[] = [...fotos, ...(extra ? ['extra' as const] : [])];
  for (let k = 0; k < items.length; k += cols) filas.push(items.slice(k, k + cols));
  const conHora = lado >= 96, letra = lado >= 120 ? 13 : lado >= 80 ? 12 : 10.5;
  const faltan = deHoy ? d!.faltan ?? [] : [];
  const sub = !d ? '' : abierto ? t('Crew moment · now') : total && faltan.length && faltan.length <= 2 ? t('Missing: {x}', { x: faltan.join(', ') }) : t('{n} of {total} shared', { n: total, total: d.miembros });
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: abierto ? 'nova://compartir?momento=1' : 'nova://crew' }} style={{ ...marco, padding: PAD, flexGap: 8 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: CAB }}>
        <TextWidget text={d?.crew ?? 'Crew'} maxLines={1} style={{ fontFamily: F.s, fontSize: 14, color: C.t1 as Hex }} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={sub} maxLines={1} style={{ fontFamily: abierto ? F.s : F.r, fontSize: 12, color: (abierto ? C.nova : C.t3) as Hex }} />
      </FlexWidget>
      {fotos.length ? (
        <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center', flexGap: G }}>
          {filas.map((fila, i) => (
            <FlexWidget key={i} style={{ flexDirection: 'row', flexGap: G }}>
              {fila.map(f => f === 'extra' ? (
                <FlexWidget key="extra" style={{ width: lado, height: lado, borderRadius: 14, backgroundColor: C.s2 as Hex, justifyContent: 'center', alignItems: 'center' }}>
                  <TextWidget text={`+${extra}`} style={{ fontFamily: F.s, fontSize: Math.max(14, lado * 0.22), color: C.t2 as Hex }} />
                </FlexWidget>
              ) : (
                <OverlapWidget key={f.id} style={{ width: lado, height: lado, borderRadius: 14 }}>
                  <ImageWidget image={f.img as `data:image${string}`} imageWidth={lado} imageHeight={lado} radius={14} resizeMode="cover" />
                  <FlexWidget style={{ width: lado, height: lado, justifyContent: 'flex-end' }}>
                    <FlexWidget style={{ width: lado, height: Math.round(Math.min(46, lado * 0.42)), borderRadius: 14, justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 6, backgroundGradient: { from: '#00000000', to: '#000000b8', orientation: 'TOP_BOTTOM' } }}>
                      <TextWidget text={conHora ? `${f.nombre} · ${f.hora}` : f.nombre} maxLines={1} style={{ fontFamily: F.m, fontSize: letra, color: '#ffffff' }} />
                    </FlexWidget>
                  </FlexWidget>
                  {f.video ? (
                    <FlexWidget style={{ width: lado, height: lado, alignItems: 'flex-end', padding: 6 }}>
                      <FlexWidget style={{ width: Math.round(Math.max(20, lado * 0.2)), height: Math.round(Math.max(20, lado * 0.2)), borderRadius: 99, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center' }}>
                        <TextWidget text="▶" style={{ fontFamily: F.s, fontSize: Math.round(Math.max(9, lado * 0.09)), color: '#ffffff' }} />
                      </FlexWidget>
                    </FlexWidget>
                  ) : null}
                </OverlapWidget>
              ))}
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center', backgroundColor: C.s2 as Hex, borderRadius: 18 }}>
          <TextWidget text={abierto ? t('The moment is now!') : t('No photos yet today.')} style={{ fontFamily: F.m, fontSize: 14, color: (abierto ? C.nova : C.t2) as Hex }} />
          <TextWidget text={t('Tap to share yours')} style={{ fontFamily: F.r, fontSize: 12, color: C.nova as Hex, marginTop: 4 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** Casa (4×2): la última foto que dejó la familia, a todo el widget, con quién la envió y hace cuánto llegó.
   Sin foto, el último mensaje; sin nada, una invitación. Tocar abre Casa en la app. */
export function CasaWidget({ d, w, h, ahora }: { d: DatosCasa | null; w: number; h: number; ahora: number }) {
  const { t } = traductor(d?.idioma);
  const hace = (ms: number) => { const m = Math.max(0, Math.round((ahora - ms) / 60000)); return m < 60 ? t('{n} min ago', { n: m }) : m < 1440 ? t('{n} h ago', { n: Math.round(m / 60) }) : t('{n} d ago', { n: Math.round(m / 1440) }); };
  const quien = d ? (d.relacion ? `${d.de} · ${t(d.relacion)}` : d.de) : '';
  if (!d) {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://casa' }} style={{ ...marco, justifyContent: 'center', alignItems: 'center', flexGap: 6 }}>
        <TextWidget text={t('From home')} style={{ fontFamily: F.s, fontSize: 15, color: C.t1 as Hex }} />
        <TextWidget text={t('Photos and messages from your family will appear here.')} maxLines={2} style={{ fontFamily: F.r, fontSize: 12.5, color: C.t2 as Hex, textAlign: 'center' }} />
      </FlexWidget>
    );
  }
  if (!d.img) {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://casa' }} style={{ ...marco, padding: 16, flexGap: 8 }}>
        <TextWidget text={`${t('From home')} · ${hace(d.llega)}`} style={{ fontFamily: F.m, fontSize: 12, color: C.lila as Hex }} />
        <TextWidget text={`“${d.texto}”`} maxLines={4} style={{ fontFamily: F.r, fontSize: 17, color: C.t1 as Hex }} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text={quien} maxLines={1} style={{ fontFamily: F.m, fontSize: 13, color: C.t2 as Hex }} />
      </FlexWidget>
    );
  }
  const pie = Math.round(Math.min(92, h * 0.46));
  return (
    <OverlapWidget clickAction="OPEN_URI" clickActionData={{ uri: 'nova://casa' }} style={{ width: 'match_parent', height: 'match_parent', borderRadius: 26 }}>
      <ImageWidget image={d.img as `data:image${string}`} imageWidth={w} imageHeight={h} radius={26} resizeMode="cover" />
      <FlexWidget style={{ width: 'match_parent', height: 'match_parent', justifyContent: 'flex-end' }}>
        <FlexWidget style={{ width: 'match_parent', height: pie, borderRadius: 26, justifyContent: 'flex-end', paddingHorizontal: 14, paddingBottom: 12, flexGap: 2, backgroundGradient: { from: '#00000000', to: '#000000c8', orientation: 'TOP_BOTTOM' } }}>
          {d.texto ? <TextWidget text={d.texto} maxLines={1} style={{ fontFamily: F.m, fontSize: 14, color: '#ffffff' }} /> : null}
          <TextWidget text={`${quien} · ${hace(d.llega)}${d.mas ? ` · +${d.mas}` : ''}`} maxLines={1} style={{ fontFamily: F.r, fontSize: 12, color: '#d9e2ec' }} />
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}
