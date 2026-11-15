/* «Your data»: qué puede leer NOVA, para qué, y el sí o no de cada fuente. Nada se lee sin consentimiento y todo
   se queda en el teléfono; lo que sale hacia la Tierra se decide en «What you share». */
import { agendaDisponible, delDia, pedirAgenda, useAgenda } from '../sensores/agenda';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { consentir, FUENTES, useConsentimiento, type Fuente } from '../sensores/fuentes';
import { permisos as permisosReloj, relojDisponible } from '../sensores/reloj';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { Pedometer } from 'expo-sensors';
import { pedirSalud, saludDisponible } from '../sensores/salud';
import { abrirPermisoUso, usoConPermiso, usoDisponible } from '../sensores/uso';
import { useVivo } from '../sensores/vivo';
import { Interruptor } from '../ui/Interruptor';
import { Boton, C, Cel, Txt } from '../ui/tema';
import { useIdioma } from '../i18n';

const disponible = (f: Fuente) => (f === 'reloj' ? relojDisponible() : f === 'salud' ? saludDisponible() : f === 'uso' ? usoDisponible() : f === 'agenda' ? agendaDisponible() : Platform.OS !== 'web');

export default function Datos() {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  const { c } = useConsentimiento();
  const v = useVivo(), agenda = useAgenda();
  const [nota, setNota] = useState<Partial<Record<Fuente, string>>>({});
  // mientras se pide el permiso el switch ya se ve encendido (si se niega, vuelve a apagarse)
  const [pidiendo, setPidiendo] = useState<Partial<Record<Fuente, boolean>>>({});
  const vista = { ...c };
  (Object.keys(pidiendo) as Fuente[]).forEach(f => { if (pidiendo[f]) vista[f] = true; });

  const estado = (f: Fuente): { t: string; col: string } | null => {
    // los avisos se guardan en inglés (también los de los sensores) y se traducen al mostrarlos
    if (!disponible(f)) return { t: t(Platform.OS === 'web' ? 'Phone only' : 'Needs the NOVA development build'), col: C.t3 };
    if (nota[f]) return { t: t(nota[f]!), col: C.aviso };
    if (pidiendo[f]) return { t: t('Waiting for permission…'), col: C.nova };
    if (!c[f]) return null;
    if (f === 'reloj') return v.reloj.estado === 'conectado' ? { t: t('Connected · {reloj}', { reloj: v.reloj.nombre ?? '' }), col: C.ok } : v.reloj.estado === 'buscando' ? { t: t('Searching for your watch…'), col: C.nova } : { t: t(v.reloj.mensaje ?? 'Not connected'), col: C.aviso };
    if (f === 'agenda') return { t: agenda.leido ? t('Reading · {n} events today', { n: delDia(agenda.eventos, Date.now()).length }) : t('Reading…'), col: C.ok };
    if (f === 'uso') return usoConPermiso() ? { t: v.uso ? t('Reading · {n} min today', { n: Math.round(v.uso.pantallaMin) }) : t('Reading…'), col: C.ok } : { t: t('Allow usage access in Settings'), col: C.aviso };
    if (f === 'salud') return v.salud ? { t: v.salud.origenes.length ? t('Reading · from {apps}', { apps: v.salud.origenes.join(', ') }) : t('On · no data from other apps yet'), col: v.salud.origenes.length ? C.ok : C.aviso } : { t: t('Reading…'), col: C.nova };
    return { t: t('On'), col: C.ok };
  };

  /** el permiso de Android se pide en el mismo toque; la fuente se enciende solo si se concede */
  const permiso = async (f: Fuente): Promise<string | null> => {
    try {
      if (f === 'salud') { const r = await pedirSalud(); return r.ok ? null : r.mensaje ?? 'No permission granted'; }
      if (f === 'reloj') return (await permisosReloj()) ? null : 'Allow Nearby devices for Nova in Android settings';
      if (f === 'pasos') return (await Pedometer.requestPermissionsAsync()).granted ? null : 'Allow Physical activity for Nova in Android settings';
      if (f === 'agenda') { const r = await pedirAgenda(); return r.ok ? null : r.mensaje ?? 'No permission granted'; }
      if (f === 'ruido') return (await requestRecordingPermissionsAsync()).granted ? null : 'Allow the microphone for Nova in Android settings';
    } catch (e) { return (e as Error).message; }
    return null;
  };

  const cambiarFuente = async (f: Fuente, si: boolean) => {
    setNota(n => ({ ...n, [f]: undefined }));
    if (!si) { consentir(f, false); return; }
    setPidiendo(p => ({ ...p, [f]: true }));
    const error = await permiso(f);
    setPidiendo(p => ({ ...p, [f]: false }));
    if (error) { setNota(n => ({ ...n, [f]: error })); return; }
    consentir(f, true);
    if (f === 'uso' && !usoConPermiso()) abrirPermisoUso();
  };

  const todo = async () => { for (const f of FUENTES) if (disponible(f.id) && !c[f.id]) await cambiarFuente(f.id, true); };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Your data')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Nova only reads what you turn on. Everything stays on this phone; what leaves it is decided in What you share.')}</Txt>
        <View style={{ flexDirection: 'row', marginTop: 16 }}>
          <Boton t={t('Turn on everything available')} icono="flash-outline" primario onPress={todo} />
        </View>
        <Grupo titulo={t('From your watch and health apps')} ids={['reloj', 'salud', 'agenda', 'uso']} c={vista} estado={estado} onCambio={cambiarFuente} />
        <Pressable onPress={() => router.push('/conectar-reloj')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 }}>
          <Ionicons name="watch-outline" size={16} color={C.nova} />
          <Txt f="m" size={13.5} color={C.nova} style={{ flex: 1 }}>{t('How to connect your watch (Huawei, Xiaomi, Samsung…)')}</Txt>
          <Ionicons name="chevron-forward" size={15} color={C.nova} />
        </Pressable>
        <Grupo titulo={t("From this phone's sensors")} ids={['movimiento', 'pasos', 'cabina', 'bateria', 'ruido']} c={vista} estado={estado} onCambio={cambiarFuente} />
        <Txt size={12.5} lh={18} color={C.t3} style={{ marginTop: 18, paddingHorizontal: 4 }}>
          {t('You can turn any source off at any time; Nova stops reading it at once. Health Connect and usage access can also be revoked from Android settings.')}
        </Txt>
      </ScrollView>
    </View>
  );
}

function Grupo({ titulo, ids, c, estado, onCambio }: {
  titulo: string; ids: Fuente[]; c: Record<Fuente, boolean>; estado: (f: Fuente) => { t: string; col: string } | null; onCambio: (f: Fuente, si: boolean) => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 22, marginBottom: 8, paddingHorizontal: 4 }}>{titulo}</Txt>
      <Cel style={{ paddingVertical: 2, paddingHorizontal: 16 }}>
        {FUENTES.filter(f => ids.includes(f.id)).map((f, i) => {
          const e = estado(f.id), ok = disponible(f.id);
          return (
            <View key={f.id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1, opacity: ok ? 1 : 0.55 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                <Ionicons name={f.icono as keyof typeof Ionicons.glyphMap} size={18} color={c[f.id] ? C.nova : C.t2} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt f="m" size={15.5}>{t(f.titulo)}</Txt>
                <Txt size={13} lh={18} color={C.t2}>{t(f.lee)}</Txt>
                <Txt size={12.5} lh={17} color={C.t3}>{t('Why: {para}', { para: t(f.para) })}</Txt>
                {e ? (
                  <Pressable disabled={!(f.id === 'uso' && c.uso && !usoConPermiso())} onPress={abrirPermisoUso} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: e.col }} />
                    <Txt f="m" size={12.5} color={e.col}>{e.t}</Txt>
                  </Pressable>
                ) : null}
              </View>
              {ok ? <Interruptor on={c[f.id]} label={t(f.titulo)} onChange={si => onCambio(f.id, si)} /> : null}
            </View>
          );
        })}
      </Cel>
    </>
  );
}
