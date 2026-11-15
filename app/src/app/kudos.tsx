/* Reconocer a alguien de la crew: eliges a quién (una o varias personas) y por qué. Le llega un aviso, queda en la
   bitácora (y en Slack/Discord si la crew los conectó) y NOVA lo menciona en el resumen del viernes. */
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { escribirBitacora } from '../cuenta/datos';
import { useCrew, useSesion } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { AvatarMiembro } from '../ui/Crew';
import { BotonAncho, Chip, Hoja } from '../ui/Hoja';
import { volver } from '../ui/volver';
import { C, F, Txt } from '../ui/tema';

const RAZONES = ['Saved the day', 'Great help', 'Shipped it', 'Taught me something', 'Kept us going'];

export default function KudosPantalla() {
  const { para: p0 } = useLocalSearchParams<{ para?: string }>();
  const { t } = useIdioma(), crew = useCrew(), { usuario } = useSesion();
  const [para, setPara] = useState<string[]>(p0 ? [p0] : []), [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const otros = (crew?.miembros ?? []).filter(m => m.id !== usuario?.id);
  const listo = !!crew && para.length > 0 && texto.trim().length > 2;
  const enviar = async () => {
    if (!crew || !listo) return;
    setEnviando(true); setError(null);
    try { await escribirBitacora(crew.id, JSON.stringify({ para, texto: texto.trim() }), 'kudos'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); volver('/crew'); }
    catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  return (
    <Hoja titulo={t('Give kudos')} sub={t('Say thanks for something concrete. It reaches them right away and stays in the crew log.')} volverA="/crew">
      <Txt f="m" size={13.5} color={C.t2} style={{ marginTop: 20, marginBottom: 10 }}>{t('Who?')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {otros.map(m => {
          const on = para.includes(m.id);
          return (
            <Pressable key={m.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setPara(on ? para.filter(x => x !== m.id) : [...para, m.id]); }} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ alignItems: 'center', gap: 5, width: 62 }}>
              <AvatarMiembro u={m} size={52} anillo={on ? C.alerta : undefined} apagado={para.length > 0 && !on} />
              <Txt size={12} color={on ? C.alerta : C.t2} numberOfLines={1}>{m.nombre.split(/\s+/)[0]}</Txt>
            </Pressable>
          );
        })}
      </View>
      <Txt f="m" size={13.5} color={C.t2} style={{ marginTop: 22, marginBottom: 10 }}>{t('For what?')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {RAZONES.map(r => <Chip key={r} t={t(r)} on={texto === t(r)} onPress={() => setTexto(t(r))} />)}
      </View>
      <TextInput value={texto} onChangeText={setTexto} multiline maxLength={400} placeholder={t('e.g. For staying late to fix the deploy')} placeholderTextColor={C.t3}
        style={{ minHeight: 90, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5, textAlignVertical: 'top' }} />
      {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 12 }}>{error}</Txt> : null}
      <View style={{ marginTop: 22 }}><BotonAncho t={t('Send kudos')} onPress={enviar} activo={listo} cargando={enviando} color={C.alerta} /></View>
    </Hoja>
  );
}
