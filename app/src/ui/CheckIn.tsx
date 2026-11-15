/* Check-in del día: un minuto contigo, con NOVA al lado.
   Una pregunta a la vez, con palabras en vez de números: las cinco palabras de la escala en una lista (toca la que más
   se parezca) y la elegida queda en su color. Cada pregunta tiene su icono en su color; los pasos son iconitos que se
   encienden; las emociones llevan icono; y al terminar NOVA agradece antes del resumen, que se toca para corregir.
   Cada respuesta se guarda al tocarla; saltar una pregunta es válido (queda sin dato, no en cero).
   NOVA (el orbe chico) acompaña: sonríe con las respuestas buenas y se pone pensativa con las bajas. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { EMOCIONES, ESCALAS, nivelDe, registrar, type Escala, type Registro } from '../engine/diario';
import { useFunciones } from '../engine/funciones';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { COLOR_ANIMO } from './DiarioUI';
import { Boton, C, Cel, F, Txt } from './tema';

type Icono = keyof typeof Ionicons.glyphMap;
const N_PASOS = ESCALAS.length + 2; // + emociones + lo bueno del día
const SUAVE = Easing.out(Easing.cubic);

/** color de un nivel 1–5 según si «alto» es bueno */
export const colorNivel = (v: number, altoEsBueno: boolean) => COLOR_ANIMO[(altoEsBueno ? v : 6 - v) - 1];
/** el color propio de cada pregunta (para su icono) */
const ACENTO: Record<Escala, string> = { animo: C.nova, energia: C.aviso, estres: C.sig, sueno: C.lila, conexion: C.ok, carga: C.alerta };
/** un icono por emoción */
const ICONO_EMOCION: Record<string, Icono> = { Calm: 'leaf-outline', Focused: 'locate-outline', Proud: 'ribbon-outline', Grateful: 'heart-outline', Energized: 'flash-outline', Motivated: 'rocket-outline', Homesick: 'home-outline', Lonely: 'person-outline', Anxious: 'thunderstorm-outline', Irritable: 'flame-outline', Tired: 'bed-outline', Bored: 'time-outline' };

/** la emoción elegida lleva el icono lleno */
const LLENO = (i: Icono) => i.replace('-outline', '') as Icono;

/** cinco barras crecientes; se encienden hasta el nivel elegido (lo usan otras pantallas) */
export function Medidor({ v, col, alto = 18 }: { v?: number; col: string; alto?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: alto }}>
      {[1, 2, 3, 4, 5].map(n => (
        <View key={n} style={{ width: 4, height: alto * (0.3 + 0.14 * n), borderRadius: 2, backgroundColor: v && n <= v ? col : C.l2 }} />
      ))}
    </View>
  );
}

/** pasos respondidos (para el avance y para Today) */
export function avanceCheckIn(r?: Registro) {
  const escalas = ESCALAS.filter(e => r?.valores[e.id] != null).length;
  return { escalas, hechos: escalas + (r?.emociones.length ? 1 : 0) + (r?.bueno ? 1 : 0), total: N_PASOS, completo: escalas === ESCALAS.length };
}

/** cómo está NOVA según lo último que respondiste */
function expresionDe(r?: Registro): 'feliz' | 'normal' | 'pensativa' {
  const a = r?.valores.animo, e = r?.valores.energia;
  const v = a ?? e;
  if (v == null) return 'normal';
  return v >= 4 ? 'feliz' : v <= 2 ? 'pensativa' : 'normal';
}

export function CheckIn({ hoyR }: { hoyR?: Registro }) {
  const [paso, setPaso] = useState<number | null>(() => {
    const i = ESCALAS.findIndex(e => hoyR?.valores[e.id] == null);
    return i === -1 ? null : i;
  });
  const [gracias, setGracias] = useState(false);
  if (gracias) return <Gracias r={hoyR} onListo={() => setGracias(false)} />;
  if (paso === null) return <Resumen r={hoyR} onEditar={setPaso} />;
  return <Pasos r={hoyR} paso={paso} setPaso={setPaso} onTerminar={() => { setPaso(null); setGracias(true); }} />;
}

/** el icono redondo de una pregunta, en su color */
function IconoPregunta({ icono, color, size = 52 }: { icono: Icono; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}1f`, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icono} size={size * 0.5} color={color} />
    </View>
  );
}

/** los pasos como iconitos: hecho en su color, el actual con anillo, lo que falta apenas marcado */
function Pasitos({ r, paso, onIr }: { r?: Registro; paso: number; onIr: (p: number) => void }) {
  const { t } = useIdioma();
  const pasos: { icono: Icono; hecho: boolean; color: string; nombre: string }[] = [
    ...ESCALAS.map(e => { const v = r?.valores[e.id]; return { icono: e.icono as Icono, hecho: v != null, color: v ? colorNivel(v, e.altoEsBueno) : ACENTO[e.id], nombre: t(e.t) }; }),
    { icono: 'heart-outline', hecho: !!r?.emociones.length, color: C.lila, nombre: t('How you feel') },
    { icono: 'sparkles-outline', hecho: !!r?.bueno, color: C.aviso, nombre: t('One good thing') },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {pasos.map((p, i) => {
        const actual = i === paso;
        return (
          <Pressable key={i} onPress={() => onIr(i)} hitSlop={8} accessibilityLabel={t('Go to question {n}', { n: i + 1 }) + ` · ${p.nombre}`}
            style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: actual ? 1.5 : 1, borderColor: actual ? C.nova : p.hecho ? `${p.color}66` : C.l2, backgroundColor: p.hecho ? `${p.color}22` : actual ? `${C.nova}14` : 'transparent' }}>
            <Ionicons name={p.icono} size={14} color={actual ? C.nova : p.hecho ? p.color : C.t3} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** las cinco palabras de la escala, una por fila y de menos a más: se toca la palabra, y la elegida queda en su color,
    con su medidor encendido y un visto */
function Opciones({ e, v, onElegir }: { e: (typeof ESCALAS)[number]; v?: number; onElegir: (n: number) => void }) {
  const tr = useIdioma(), { t } = tr;
  return (
    <View style={{ marginTop: 16, gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => {
        const on = v === n, col = colorNivel(n, e.altoEsBueno);
        return (
          <Pressable key={n} onPress={() => onElegir(n)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t(e.t)}: ${nivelDe(tr, e, n)}`}
            style={({ pressed }) => ({ height: 48, borderRadius: 16, paddingLeft: 14, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: on ? col : C.l1, backgroundColor: on ? `${col}22` : pressed ? C.s2 : `${C.s2}99` })}>
            <Medidor v={n} col={on ? col : `${col}99`} alto={16} />
            <Txt f={on ? 's' : 'm'} size={15.5} color={on ? col : C.t1} style={{ flex: 1 }}>{nivelDe(tr, e, n)}</Txt>
            {on ? <Ionicons name="checkmark-circle" size={20} color={col} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Pasos({ r, paso, setPaso, onTerminar }: { r?: Registro; paso: number; setPaso: (p: number | null) => void; onTerminar: () => void }) {
  const [bueno, setBueno] = useState(r?.bueno ?? '');
  const { t } = useIdioma();
  const sig = (desde: number) => (desde + 1 >= N_PASOS ? onTerminar() : setPaso(desde + 1));
  const terminar = () => {
    registrar({ bueno: bueno.trim() || undefined });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onTerminar();
  };
  const e = ESCALAS[paso];
  return (
    <Cel style={{ padding: 18, paddingTop: 16 }}>
      {/* NOVA te acompaña: cambia de cara con lo que vas respondiendo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><NovaOrb size={58} halo={false} orbes={0} expr={expresionDe(r)} /></View>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={16}>{t('How are you today?')}</Txt>
          <Txt size={12.5} color={C.t3}>{t('A minute for you · only on this phone')}</Txt>
        </View>
        <Txt f="mono" size={11.5} color={C.t3}>{paso + 1}/{N_PASOS}</Txt>
      </View>
      <View style={{ marginTop: 14 }}><Pasitos r={r} paso={paso} onIr={setPaso} /></View>

      <Animated.View key={paso} entering={FadeIn.duration(220)} layout={LinearTransition.duration(220).easing(SUAVE)} style={{ marginTop: 22, minHeight: 190 }}>
        {e ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <IconoPregunta icono={e.icono as Icono} color={ACENTO[e.id]} />
              <View style={{ flex: 1 }}>
                <Txt f="m" size={12.5} color={ACENTO[e.id]} ls={0.3} style={{ textTransform: 'uppercase' }}>{t(e.t)}</Txt>
                <Txt f="s" size={21} ls={-0.5} lh={26} style={{ marginTop: 2 }}>{t(e.pregunta)}</Txt>
              </View>
            </View>
            <Opciones e={e} v={r?.valores[e.id]} onElegir={n => {
              Haptics.selectionAsync().catch(() => {});
              registrar({ valores: { [e.id]: n } });
              setTimeout(() => sig(paso), 420);
            }} />
          </>
        ) : paso === ESCALAS.length ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <IconoPregunta icono="heart-outline" color={C.lila} />
              <View style={{ flex: 1 }}>
                <Txt f="m" size={12.5} color={C.lila} ls={0.3} style={{ textTransform: 'uppercase' }}>{t('How you feel')}</Txt>
                <Txt f="s" size={21} ls={-0.5} lh={26} style={{ marginTop: 2 }}>{t('Which of these fit today?')}</Txt>
              </View>
            </View>
            <Txt size={13} color={C.t3} style={{ marginTop: 10 }}>{t('Pick any. None is fine too.')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {EMOCIONES.map(m => {
                const on = !!r?.emociones.includes(m);
                return (
                  <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t(m)}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); registrar({ emociones: on ? r!.emociones.filter(x => x !== m) : [...(r?.emociones ?? []), m] }); }}
                    style={{ paddingLeft: 11, paddingRight: 14, height: 38, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: on ? C.lila : C.l2, backgroundColor: on ? `${C.lila}2e` : 'transparent' }}>
                    <Ionicons name={on ? LLENO(ICONO_EMOCION[m] ?? 'ellipse-outline') : ICONO_EMOCION[m] ?? 'ellipse-outline'} size={15} color={on ? C.lila : C.t3} />
                    <Txt f={on ? 's' : 'm'} size={13.5} color={on ? C.lila : C.t2}>{t(m)}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <IconoPregunta icono="sparkles-outline" color={C.aviso} />
              <View style={{ flex: 1 }}>
                <Txt f="m" size={12.5} color={C.aviso} ls={0.3} style={{ textTransform: 'uppercase' }}>{t('One good thing')}</Txt>
                <Txt f="s" size={21} ls={-0.5} lh={26} style={{ marginTop: 2 }}>{t('One good thing today?')}</Txt>
              </View>
            </View>
            <Txt size={13} color={C.t3} style={{ marginTop: 10 }}>{t('Small things count. Only you can read this.')}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingLeft: 14, paddingRight: 8, height: 52, borderRadius: 16, backgroundColor: C.s2, borderWidth: 1, borderColor: `${C.aviso}44` }}>
              <Ionicons name="sparkles" size={16} color={C.aviso} />
              <TextInput value={bueno} onChangeText={setBueno} onSubmitEditing={terminar} placeholder={t('A call home, a good meal, the view…')} placeholderTextColor={C.t3} returnKeyType="done"
                style={{ flex: 1, color: C.t1, fontFamily: F.r, fontSize: 16, height: 50 }} />
            </View>
          </>
        )}
      </Animated.View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
        <Pressable onPress={() => paso > 0 && setPaso(paso - 1)} disabled={paso === 0} hitSlop={10} accessibilityLabel={t('Previous question')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: paso === 0 ? 0 : 1 }}>
          <Ionicons name="chevron-back" size={16} color={C.t2} />
          <Txt f="m" size={14} color={C.t2}>{t('Back')}</Txt>
        </Pressable>
        <View style={{ flex: 1 }} />
        {paso === N_PASOS - 1 ? (
          <Boton t={t('Finish')} primario onPress={terminar} />
        ) : paso === ESCALAS.length ? (
          <Boton t={t('Next')} primario onPress={() => sig(paso)} />
        ) : (
          <Pressable onPress={() => sig(paso)} hitSlop={10} accessibilityLabel={t('Skip this question')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt f="m" size={14} color={C.t3}>{t('Skip')}</Txt>
            <Ionicons name="chevron-forward" size={16} color={C.t3} />
          </Pressable>
        )}
      </View>
    </Cel>
  );
}

/** al terminar: NOVA agradece, un instante, y pasa al resumen */
function Gracias({ r, onListo }: { r?: Registro; onListo: () => void }) {
  const { t } = useIdioma();
  useEffect(() => { const id = setTimeout(onListo, 1700); return () => clearTimeout(id); }, [onListo]);
  const bajo = (r?.valores.animo ?? 3) <= 2;
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)}>
      <Cel style={{ padding: 18, alignItems: 'center', gap: 6, minHeight: 190, justifyContent: 'center' }}>
        <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}><NovaOrb size={110} orbes={3} expr={bajo ? 'pensativa' : 'feliz'} /></View>
        <Txt f="s" size={19} ls={-0.4} style={{ textAlign: 'center' }}>{t('Thanks for telling me.')}</Txt>
        <Txt size={14} color={C.t2} style={{ textAlign: 'center' }}>{t(bajo ? 'Go easy on yourself today. I am here.' : 'Nova keeps it in mind for today.')}</Txt>
      </Cel>
    </Animated.View>
  );
}

/** lo de hoy de un vistazo; cada valor se toca para cambiarlo */
function Resumen({ r, onEditar }: { r?: Registro; onEditar: (p: number) => void }) {
  const { escalas, completo } = avanceCheckIn(r);
  const tr = useIdioma(), { t } = tr;
  const { mision } = useFunciones();
  const hora = r?.actualizado ? new Date(r.actualizado).toLocaleTimeString(tr.locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: mision ? 'UTC' : undefined }) : null;
  return (
    <Animated.View entering={FadeIn.duration(220)}>
      <Cel style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><NovaOrb size={58} halo={false} orbes={0} expr={completo ? expresionDe(r) : 'normal'} /></View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={16}>{completo ? t('Your day at a glance') : escalas ? t('{n} of {total} answered', { n: escalas, total: ESCALAS.length }) : t('Not checked in yet')}</Txt>
            <Txt size={12.5} color={C.t3}>{hora ? t(mision ? 'Last change {h} ship time · ' : 'Last change {h} · ', { h: hora }) : ''}{t('tap any value to change it')}</Txt>
          </View>
          {completo && <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${C.ok}22`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={16} color={C.ok} /></View>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginHorizontal: -4 }}>
          {ESCALAS.map((e, i) => {
            const v = r?.valores[e.id], col = v ? colorNivel(v, e.altoEsBueno) : C.t3;
            return (
              <View key={e.id} style={{ width: '33.333%', padding: 4 }}>
                <Pressable onPress={() => onEditar(i)} accessibilityLabel={t('{escala}: {valor}. Change', { escala: t(e.t), valor: v ? nivelDe(tr, e, v) : t('not logged') })}
                  style={({ pressed }) => ({ borderRadius: 18, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', gap: 7, backgroundColor: pressed ? C.s2 : `${C.s2}99`, borderWidth: 1, borderColor: v ? `${col}33` : C.l1 })}>
                  <IconoPregunta icono={e.icono as Icono} color={v ? col : C.t3} size={38} />
                  <Txt size={11.5} color={C.t3}>{t(e.t)}</Txt>
                  <Txt f="s" size={13.5} color={v ? col : C.t3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{v ? nivelDe(tr, e, v) : t('Add')}</Txt>
                </Pressable>
              </View>
            );
          })}
        </View>
        {r?.emociones.length ? (
          <Pressable onPress={() => onEditar(ESCALAS.length)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }} accessibilityLabel={t('Change how you feel')}>
            {r.emociones.map(m => (
              <View key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 11, height: 28, borderRadius: 14, backgroundColor: `${C.lila}22` }}>
                <Ionicons name={ICONO_EMOCION[m] ?? 'ellipse-outline'} size={12} color={C.lila} />
                <Txt f="m" size={12.5} color={C.lila}>{t(m)}</Txt>
              </View>
            ))}
          </Pressable>
        ) : null}
        <Pressable onPress={() => onEditar(ESCALAS.length + 1)} accessibilityLabel={t('Change your good thing')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: r?.bueno ? `${C.aviso}14` : 'transparent', borderWidth: 1, borderColor: r?.bueno ? `${C.aviso}44` : C.l1 }}>
          <Ionicons name={r?.bueno ? 'sparkles' : 'sparkles-outline'} size={16} color={r?.bueno ? C.aviso : C.t3} />
          <Txt size={14.5} lh={20} color={r?.bueno ? C.t1 : C.t3} style={{ flex: 1 }}>{r?.bueno ?? t('Add one good thing from today')}</Txt>
        </Pressable>
      </Cel>
    </Animated.View>
  );
}
