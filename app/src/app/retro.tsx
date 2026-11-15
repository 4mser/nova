/* Retro de la semana: qué funcionó, qué mejorar y qué probar. Se puede mandar anónima (nadie ve quién la escribió,
   salvo tú). No avisa a nadie: NOVA la junta en el resumen del viernes. Abajo, las respuestas de esta semana. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { escribirBitacora, leerJson, useBitacora, type Retro } from '../cuenta/datos';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { BotonAncho, Hoja } from '../ui/Hoja';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

export default function RetroPantalla() {
  const { t, tp } = useIdioma(), crew = useCrew(), { datos } = useBitacora(crew?.id ?? null);
  const ahora = useAhora(60 * 60e3);
  const [bien, setBien] = useState(''), [mejorar, setMejorar] = useState(''), [probar, setProbar] = useState(''), [anonimo, setAnonimo] = useState(true);
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const semana = useMemo(() => (datos ?? []).filter(e => e.tipo === 'retro' && e.ts > ahora - 7 * 864e5).map(e => leerJson<Retro>(e)).filter((r): r is Retro => !!r), [datos, ahora]);
  const listo = !!crew && [bien, mejorar, probar].some(x => x.trim().length > 2);
  const enviar = async () => {
    if (!crew || !listo) return;
    setEnviando(true); setError(null);
    try { await escribirBitacora(crew.id, JSON.stringify({ bien: bien.trim(), mejorar: mejorar.trim(), probar: probar.trim(), anonimo }), 'retro'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); volver('/crew'); }
    catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  const campo = (icono: keyof typeof Ionicons.glyphMap, color: string, titulo: string, v: string, f: (s: string) => void, ph: string) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 }}>
        <Ionicons name={icono} size={17} color={color} /><Txt f="s" size={16}>{titulo}</Txt>
      </View>
      <TextInput value={v} onChangeText={f} multiline maxLength={500} placeholder={ph} placeholderTextColor={C.t3}
        style={{ minHeight: 70, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5, textAlignVertical: 'top' }} />
    </>
  );
  return (
    <Hoja titulo={t('Weekly retro')} sub={t('One minute, three answers. Nova puts them together in Friday’s summary for {crew}.', { crew: crew?.nombre ?? '' })} volverA="/crew">
      {campo('thumbs-up-outline', C.ok, t('What worked this week?'), bien, setBien, t('e.g. Pairing on the deploy'))}
      {campo('construct-outline', C.aviso, t('What should we improve?'), mejorar, setMejorar, t('e.g. Meetings ran long'))}
      {campo('flask-outline', C.nova, t('What do we try next week?'), probar, setProbar, t('e.g. 15-minute standups'))}
      <Pressable onPress={() => setAnonimo(a => !a)} style={{ alignSelf: 'flex-start', marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: anonimo ? C.aviso : C.l2, backgroundColor: anonimo ? C.avisoSuave : 'transparent' }}>
        <Ionicons name={anonimo ? 'eye-off' : 'eye-outline'} size={15} color={anonimo ? C.aviso : C.t2} />
        <Txt f="m" size={13.5} color={anonimo ? C.aviso : C.t2}>{t(anonimo ? 'Anonymous' : 'With my name')}</Txt>
      </Pressable>
      {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 12 }}>{error}</Txt> : null}
      <View style={{ marginTop: 22 }}><BotonAncho t={t('Send retro')} onPress={enviar} activo={listo} cargando={enviando} color={C.aviso} /></View>
      {semana.length ? (
        <>
          <Seccion t={t('This week')} nota={tp(semana.length, '{n} answer', '{n} answers')} />
          <Cel style={{ gap: 12 }}>
            {(['bien', 'mejorar', 'probar'] as const).map(k => {
              const v = semana.map(r => r[k]).filter(Boolean);
              if (!v.length) return null;
              const [icono, color, titulo] = k === 'bien' ? ['thumbs-up-outline', C.ok, t('Worked')] as const : k === 'mejorar' ? ['construct-outline', C.aviso, t('Improve')] as const : ['flask-outline', C.nova, t('Try')] as const;
              return (
                <View key={k} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name={icono} size={14} color={color} /><Txt f="m" size={13} color={color}>{titulo}</Txt></View>
                  {v.map((x, i) => <Txt key={i} size={14.5} lh={20} color={C.t2}>· {x}</Txt>)}
                </View>
              );
            })}
          </Cel>
        </>
      ) : null}
    </Hoja>
  );
}
