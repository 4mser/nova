/* Tu perfil (se abre desde la foto del encabezado o deslizando desde Today o Journal): foto y nombre editables, la sesión con la psicóloga en la Tierra,
   los temas que NOVA le envía antes, a quién va cada dato y qué puede leer NOVA. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { cargarDiario, compartirDiario, useDiario } from '../../engine/diario';
import { hoy } from '../../engine/motor';
import { cambiarFoto, cambiarNombre, iniciales, usePerfil } from '../../engine/perfil';
import { Cuenta, Flujo } from '../../ui/Graficos';
import { Interruptor } from '../../ui/Interruptor';
import { C, Cel, F, Seccion, Toque, Txt } from '../../ui/tema';
import { useIdioma } from '../../i18n';
import { subirAvatar } from '../../cuenta/fotos';
import { imagen } from '../../cuenta/api';
import { cambiarNombreCuenta, cambiarRedesCuenta, cambiarRol, sacarDeCrew, salirDeCrew, useCrew, useSesion, type Crew, type Redes } from '../../cuenta/sesion';
import { cambiarFuncion, useFunciones } from '../../engine/funciones';
import { TusCosas } from '../../ui/TusCosas';
import { AvatarMiembro } from '../../ui/Crew';
import { CasaTarjeta } from '../../ui/CasaTarjeta';
import { EstadoNave } from '../../ui/EstadoNave';
import { PaseStation } from '../../ui/PaseStation';
import { useNaveEstado } from '../../cuenta/naveEstado';

const COMPARTE = [
  { k: 'vitales', t: 'Vital signs', a: 'Flight surgeon, always', fijo: true },
  { k: 'sueno', t: 'Sleep', a: 'Flight surgeon', fijo: false },
  { k: 'animo', t: 'Mood and stress', a: 'Your psychologist', fijo: false },
  { k: 'diario', t: 'Journal', a: 'Entries you mark go to your psychologist', fijo: false },
] as const;

export default function Perfil() {
  const { width } = useWindowDimensions(), ins = useSafeAreaInsets();
  const W = Math.min(width, 520) - 40;
  const { mision: misionNave } = useNaveEstado();
  const tr = useIdioma(), { t } = tr, { mision } = useFunciones();
  // los temas de la demo se traducen al mostrarlos (demo: true); los que escribes quedan tal cual
  const [temas, setTemas] = useState<{ t: string; ok: boolean; demo?: boolean }[]>([
    { t: "Missing my daughter's birthday", ok: true, demo: true },
    { t: 'Feeling short-tempered after night shifts', ok: true, demo: true },
    { t: 'Sleeping better before the landing', ok: false, demo: true },
  ]);
  const [nuevo, setNuevo] = useState('');
  const diario = useDiario();
  useEffect(() => { cargarDiario(); }, []);
  const [onLocal, setOn] = useState<Record<string, boolean>>({ vitales: true, sueno: true, animo: true });
  // el diario se guarda (lo usa también la pantalla del diario); lo demás es de la demo
  const on: Record<string, boolean> = { ...onLocal, diario: diario.compartir };
  const agregar = () => { const t = nuevo.trim(); if (t) { setTemas(x => [...x, { t, ok: true }]); setNuevo(''); } };
  const marcar = (i: number) => { Haptics.selectionAsync().catch(() => {}); setTemas(x => x.map((y, j) => (j === i ? { ...y, ok: !y.ok } : y))); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: ins.top + 14, paddingHorizontal: 20, paddingBottom: ins.bottom + 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt f="s" size={30} ls={-1.2} lh={33} style={{ flex: 1 }}>{t('You')}</Txt>
        <Pressable onPress={() => router.push('/ajustes')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('App settings')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="settings-outline" size={20} color={C.t1} />
        </Pressable>
      </View>
      <Txt size={15} color={C.t2} style={{ marginTop: 6, marginBottom: 8 }}>{t(mision ? 'Your profile, your session and what you share' : 'Your profile, your things and your crew')}</Txt>
      <SeccionPerfil />
      {mision ? <PaseStation /> : null}
        <TusRedes />
      {!mision ? <TusCosas /> : null}

      {/* todo lo ajustable vive en Configuración */}
      <Toque onPress={() => router.push('/ajustes')} label={t('App settings')} style={{ marginTop: 22 }}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderColor: `${C.nova}44` }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="settings" size={21} color={C.tinta} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={16}>{t('App settings')}</Txt>
            <Txt size={13} lh={18} color={C.t2}>{t('Performance, voice, notifications, language, connections and account')}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Cel>
      </Toque>

      {!mision ? <AjustesDiario /> : null}

      {mision ? <>
      <Txt f="s" size={22} ls={-0.6} style={{ marginTop: 28, marginBottom: 12 }}>{t('From home')}</Txt>
      <CasaTarjeta w={W} />
      <Txt f="s" size={22} ls={-0.6} style={{ marginTop: 28, marginBottom: 12 }}>{t('The ship')}</Txt>
      <EstadoNave />
      <Txt f="s" size={22} ls={-0.6} style={{ marginTop: 28 }}>{t('Private session')}</Txt>
      <Txt size={15} color={C.t2} style={{ marginTop: 4, marginBottom: 14 }}>{t('With your psychologist on Earth')}</Txt>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18 }}>
        <Cuenta size={92} v={0.72} n="2" u={t('days')} />
        <View style={{ flex: 1 }}>
          <Txt f="s" size={17} ls={-0.3}>{t('{h} ship time', { h: t('Saturday, 10:00') })}</Txt>
          <Txt size={14} lh={20} color={C.t2} style={{ marginTop: 2 }}>{t('Dr. Elena Ruiz, flight psychologist. Video arrives with a {m} min delay, so Nova sends your topics ahead.', { m: misionNave ? Math.round(misionNave.luz_seg / 60) : 18 })}</Txt>
        </View>
      </Cel>

      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 18, marginBottom: 8, paddingHorizontal: 4 }}>{t('What you want to talk about')}</Txt>
      <Cel style={{ paddingVertical: 6, paddingHorizontal: 18 }}>
        {temas.map((x, i) => { const tema = x.demo ? t(x.t) : x.t; return (
          <Animated.View key={x.t + i} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.l1 }}>
              <Pressable onPress={() => marcar(i)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: x.ok }} accessibilityLabel={tema}
                style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 1.5, borderColor: x.ok ? C.lila : C.l2, backgroundColor: x.ok ? C.lila : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {x.ok && <Ionicons name="checkmark" size={14} color={C.bg} />}
              </Pressable>
              <Txt size={15} lh={20} style={{ flex: 1 }}>{tema}</Txt>
              <Pressable hitSlop={12} onPress={() => setTemas(y => y.filter((_, j) => j !== i))} accessibilityLabel={t('Remove {tema}', { tema })}>
                <Ionicons name="close" size={16} color={C.t3} />
              </Pressable>
            </View>
          </Animated.View>
        ); })}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 1.5, borderColor: C.l2 }} />
          <TextInput value={nuevo} onChangeText={setNuevo} onSubmitEditing={agregar} placeholder={t('Add a topic')} placeholderTextColor={C.t3} returnKeyType="done" style={{ flex: 1, height: 46, color: C.t1, fontFamily: F.r, fontSize: 15 }} />
        </View>
      </Cel>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
        <Ionicons name="lock-closed-outline" size={14} color={C.t3} />
        <Txt size={13.5} color={C.t3}>{t('Only you and Dr. Ruiz can see this')}</Txt>
      </View>
      </> : null}



      {mision ? <>
      <Seccion t={t('What you share')} />
      <Txt size={15} color={C.t2} style={{ marginTop: -4, marginBottom: 10, paddingHorizontal: 2 }}>{t('Only what you switch on leaves your phone')}</Txt>
      <Cel>
        <Flujo w={W - 34} h={200} activos={{ vitales: on.vitales, sueno: on.sueno, animo: on.animo, diario: on.diario }} />
      </Cel>
      <Cel style={{ paddingVertical: 4, paddingHorizontal: 18, marginTop: 8 }}>
        {COMPARTE.map((c, i) => (
          <View key={c.k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
            <View style={{ flex: 1 }}>
              <Txt size={15}>{t(c.t)}</Txt>
              <Txt size={12.5} color={C.t3} style={{ marginTop: 2 }}>{t(on[c.k] ? c.a : 'Only you')}</Txt>
            </View>
            <Interruptor on={on[c.k]} fijo={c.fijo} label={t(c.t)} onChange={v => (c.k === 'diario' ? compartirDiario(v) : setOn(x => ({ ...x, [c.k]: v })))} />
          </View>
        ))}
      </Cel>

      </> : null}


      <Txt size={12.5} color={C.t3} lh={18} style={{ textAlign: 'center', marginTop: 18, paddingHorizontal: 10 }}>
        {mision ? t('{nombre}, mission specialist. NOVA is a prototype, not a medical device. Demo data.', { nombre: hoy(tr).nombre }) : t('NOVA is not a medical device. Your health data stays on your phone unless you share it.')}
      </Txt>
      </ScrollView>
    </View>
  );
}

function SeccionPerfil() {
  const p = usePerfil(), tr = useIdioma(), { t } = tr, { mision } = useFunciones(), { usuario } = useSesion(), crew = useCrew();
  const guardarNombre = (n: string) => { cambiarNombre(n); if (n.trim() && n.trim() !== usuario?.nombre) cambiarNombreCuenta(n.trim()).catch(() => {}); };
  const [nombre, setNombre] = useState(p.nombre);
  const elegir = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!r.canceled && r.assets[0]) { cambiarFoto(r.assets[0].uri); subirAvatar(r.assets[0].uri).catch(() => {}); Haptics.selectionAsync().catch(() => {}); }
  };
  return (
    <View style={{ alignItems: 'center', marginTop: 6 }}>
      <Pressable onPress={elegir} accessibilityLabel={t('Change your photo')} style={{ width: 104, height: 104 }}>
        <View style={{ width: 104, height: 104, borderRadius: 52, overflow: 'hidden', backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.l2 }}>
          {p.foto || usuario?.foto ? <Image source={p.foto ? { uri: p.foto } : imagen(usuario?.foto)} style={{ width: 104, height: 104 }} contentFit="cover" /> : <Txt f="s" size={36} color={C.bg}>{iniciales(p.nombre)}</Txt>}
        </View>
        <View style={{ position: 'absolute', right: 0, bottom: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: C.s2, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="camera-outline" size={17} color={C.nova} />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <TextInput
          value={nombre} onChangeText={setNombre} onEndEditing={() => guardarNombre(nombre)} onSubmitEditing={() => guardarNombre(nombre)}
          accessibilityLabel={t('Your name')} returnKeyType="done" maxLength={40}
          style={{ color: C.t1, fontFamily: F.s, fontSize: 26, letterSpacing: -0.8, textAlign: 'center', minWidth: 120, paddingVertical: 2 }}
        />
        <Ionicons name="create-outline" size={16} color={C.t3} />
      </View>
      <Txt size={14} color={C.t2} style={{ marginTop: 2 }}>{mision ? `${t(p.rol)} · ${t('crew of {n}', { n: 4 })} · Sol ${hoy(tr).sol}` : [usuario?.email, crew?.nombre].filter(Boolean).join(' · ')}</Txt>
      {p.foto ? (
        <Pressable onPress={() => cambiarFoto(undefined)} hitSlop={8} style={{ marginTop: 8 }}>
          <Txt f="m" size={13} color={C.t3}>{t('Remove photo')}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** tus redes: GitHub, LinkedIn, Instagram, X y tu sitio. NOVA las usa para tu ficha y tu crew puede verlas */
const REDES: { k: keyof Redes; icono: keyof typeof Ionicons.glyphMap; nombre: string; pista: string }[] = [
  { k: 'github', icono: 'logo-github', nombre: 'GitHub', pista: 'GitHub user' },
  { k: 'linkedin', icono: 'logo-linkedin', nombre: 'LinkedIn', pista: 'LinkedIn user or link' },
  { k: 'instagram', icono: 'logo-instagram', nombre: 'Instagram', pista: 'Instagram user' },
  { k: 'x', icono: 'logo-twitter', nombre: 'X', pista: 'X user' },
  { k: 'sitio', icono: 'globe-outline', nombre: 'Web', pista: 'Website' },
];
function TusRedes() {
  const { t } = useIdioma(), { usuario } = useSesion();
  const [v, setV] = useState<Redes>(() => ({ ...(usuario?.redes ?? {}) }));
  const guardar = (k: keyof Redes) => { if ((v[k] ?? '') !== (usuario?.redes?.[k] ?? '')) cambiarRedesCuenta({ [k]: v[k] ?? '' }).catch(() => {}); };
  return (
    <>
      <Seccion t={t('Your networks')} nota={t('so Nova and your crew can find you')} />
      <Cel style={{ paddingVertical: 4 }}>
        {REDES.map((r, i) => (
          <View key={r.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
            <Ionicons name={r.icono} size={18} color={v[r.k] ? C.t1 : C.t3} />
            <TextInput value={v[r.k] ?? ''} onChangeText={x => setV(o => ({ ...o, [r.k]: x }))} onEndEditing={() => guardar(r.k)} onSubmitEditing={() => guardar(r.k)}
              placeholder={t(r.pista)} placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} returnKeyType="done" accessibilityLabel={r.nombre}
              style={{ flex: 1, color: C.t1, fontFamily: F.r, fontSize: 15, height: 46 }} />
          </View>
        ))}
      </Cel>
    </>
  );
}

/** día a día: tu crew y lo que compartes con ella */
function AjustesDiario() {
  const { t } = useIdioma(), crew = useCrew(), { compartirDia, compartirSalud } = useFunciones();
  return (
    <>
      <Seccion t={t('Crew')} nota={crew ? undefined : t('none yet')} />
      {crew ? (
        <Cel style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt f="s" size={17} style={{ flex: 1 }}>{crew.nombre}</Txt>
            <Pressable onPress={() => router.push('/invitar')} hitSlop={8} accessibilityLabel={t('Invite')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.sigSuave }}>
              <Ionicons name="qr-code-outline" size={15} color={C.nova} />
              <Txt f="s" size={13} color={C.nova}>{t('Invite')}</Txt>
            </Pressable>
          </View>
          <View style={{ gap: 10 }}>
            {crew.miembros.map(m => <FilaMiembro key={m.id} m={m} crew={crew} />)}
          </View>
          <Pressable onPress={() => salirDeCrew(crew.id).catch(() => {})} hitSlop={8}><Txt f="m" size={13.5} color={C.alerta}>{t('Leave this crew')}</Txt></Pressable>
        </Cel>
      ) : (
        <Toque onPress={() => router.navigate('/crew')} label={t('Join or create a crew')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Ionicons name="people-outline" size={20} color={C.nova} />
            <Txt f="s" size={15.5} style={{ flex: 1 }}>{t('Join or create a crew')}</Txt>
            <Ionicons name="chevron-forward" size={18} color={C.t3} />
          </Cel>
        </Toque>
      )}
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 14 }}>
        <View style={{ flex: 1 }}>
          <Txt size={15}>{t('Share my day with the crew')}</Txt>
          <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 2 }}>{t('Steps, focus, exercise, sleep and check-in mood. Numbers only, never what you write.')}</Txt>
        </View>
        <Interruptor on={compartirDia} label={t('Share my day with the crew')} onChange={v => cambiarFuncion('compartirDia', v)} />
      </Cel>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 14, opacity: compartirDia ? 1 : 0.5 }}>
        <View style={{ flex: 1 }}>
          <Txt size={15}>{t('Share my health with the crew')}</Txt>
          <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 2 }}>{t('Recovery, resting heart rate and HRV, and the crew gets a heads-up if you have several rough days. You can turn it off anytime.')}</Txt>
        </View>
        <Interruptor on={compartirDia && compartirSalud} label={t('Share my health with the crew')} onChange={v => { if (!compartirDia && v) cambiarFuncion('compartirDia', true); cambiarFuncion('compartirSalud', v); }} />
      </Cel>
    </>
  );
}

/** un miembro de la crew; si eres admin, tocarlo muestra: hacer/quitar admin y sacar de la crew */
function FilaMiembro({ m, crew }: { m: Crew['miembros'][number]; crew: Crew }) {
  const { t } = useIdioma(), { usuario } = useSesion();
  const [abierto, setAbierto] = useState(false), [error, setError] = useState<string | null>(null);
  const puedo = crew.soyAdmin && m.id !== usuario?.id;
  const hacer = async (f: () => Promise<void>) => { setError(null); try { await f(); setAbierto(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch (e) { setError(t((e as Error).message)); } };
  return (
    <View>
      <Pressable onPress={() => puedo && setAbierto(a => !a)} disabled={!puedo} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AvatarMiembro u={m} size={32} />
        <Txt size={15} style={{ flex: 1 }}>{m.nombre}{m.id === usuario?.id ? <Txt size={13} color={C.t3}>{`  ${t('you')}`}</Txt> : null}</Txt>
        {m.rol === 'admin' ? <Txt size={12.5} color={C.t3}>{t('admin')}</Txt> : null}
        {puedo ? <Ionicons name={abierto ? 'chevron-up' : 'ellipsis-horizontal'} size={16} color={C.t3} /> : null}
      </Pressable>
      {abierto ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginLeft: 44 }}>
          <Pressable onPress={() => hacer(() => cambiarRol(crew.id, m.id, m.rol === 'admin' ? 'miembro' : 'admin'))} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}>
            <Txt f="m" size={13}>{m.rol === 'admin' ? t('Remove admin') : t('Make admin')}</Txt>
          </Pressable>
          <Pressable onPress={() => hacer(() => sacarDeCrew(crew.id, m.id))} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: `${C.alerta}66`, justifyContent: 'center' }}>
            <Txt f="m" size={13} color={C.alerta}>{t('Remove from crew')}</Txt>
          </Pressable>
          {error ? <Txt size={12.5} color={C.alerta} style={{ width: '100%' }}>{error}</Txt> : null}
        </View>
      ) : null}
    </View>
  );
}
