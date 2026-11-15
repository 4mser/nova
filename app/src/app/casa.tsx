/* Casa: lo que la familia dejó para ti en la Tierra (fotos y mensajes), llegado a la nave con el retraso real de la luz,
   y tus respuestas, que viajan en el próximo contacto con la Tierra. Llega aquí desde Tú y desde el widget. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNave } from '../cuenta/nave';
import { pedirCasa, responderCasa, urlArchivoCasa, useNaveEstado, type MensajeCasa } from '../cuenta/naveEstado';
import { useIdioma } from '../i18n';
import { C, Cel, F, Txt } from '../ui/tema';
import { volver } from '../ui/volver';

export default function CasaPantalla() {
  const ins = useSafeAreaInsets(), { t, locale } = useIdioma(), { width } = useWindowDimensions();
  const { casa, mision } = useNaveEstado(), { url } = useNave();
  const [ahora, setAhora] = useState(() => Date.now());
  const [texto, setTexto] = useState(''), [foto, setFoto] = useState<{ uri: string; b64: string } | null>(null);
  const [enviando, setEnviando] = useState(false), [aviso, setAviso] = useState('');
  useEffect(() => { pedirCasa(); const id = setInterval(() => setAhora(Date.now()), 30e3); return () => clearInterval(id); }, []);
  const W = Math.min(width, 560) - 40;
  const mensajes = casa?.mensajes ?? [];
  const para = mensajes[0]?.de ?? '';

  const hace = (ms: number) => { const m = Math.max(0, Math.round((ahora - ms) / 60000)); return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : m < 1440 ? t('{n} h ago', { n: Math.round(m / 60) }) : new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' }); };
  const quien = (m: MensajeCasa) => m.relacion ? `${m.de} · ${t(m.relacion)}` : m.de;

  async function elegirFoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets[0]) return;
    // el enlace con la Tierra es escaso: 1280 px y JPEG
    const lista = await (await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 1280 }).renderAsync()).saveAsync({ compress: 0.78, format: SaveFormat.JPEG, base64: true });
    setFoto({ uri: lista.uri, b64: lista.base64 ?? '' });
  }

  async function enviar() {
    if ((!texto.trim() && !foto) || enviando) return;
    setEnviando(true); setAviso('');
    try {
      await responderCasa(para, texto.trim(), foto?.b64);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTexto(''); setFoto(null);
      setAviso(t('Queued. It goes down with the next contact with Earth.'));
    } catch { setAviso(t('The ship did not answer. Try again from the ship network.')); }
    setEnviando(false);
  }

  const luz = mision ? (mision.luz_seg / 60).toFixed(1) : null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 40, alignItems: 'center' }}>
        <View style={{ width: W }}>
          <Txt f="s" size={30} ls={-1.2} lh={34}>{t('From home')}</Txt>
          <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>
            {luz ? t('Photos and messages from your family. Each one travels {m} light-minutes to reach you.', { m: luz }) : t('Photos and messages from your family, delivered by the ship.')}
          </Txt>

          {casa?.en_camino ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: 'rgba(168,152,255,0.1)', borderWidth: 1, borderColor: 'rgba(168,152,255,0.3)' }}>
              <Ionicons name="paper-plane-outline" size={18} color={C.lila} />
              <Txt size={14} color={C.t1} style={{ flex: 1 }}>
                {casa.proximo_llega ? t('{n} on the way from Earth · the next one arrives in {m} min', { n: casa.en_camino, m: Math.max(1, Math.ceil((casa.proximo_llega - ahora) / 60000)) }) : t('{n} on the way from Earth', { n: casa.en_camino })}
              </Txt>
            </View>
          ) : null}

          {!url ? (
            <Cel style={{ marginTop: 18, padding: 18 }}><Txt size={15} lh={21} color={C.t2}>{t('Link your phone to the ship (Settings → Mission mode → Ship link) to receive what your family sends.')}</Txt></Cel>
          ) : !mensajes.length ? (
            <Cel style={{ marginTop: 18, padding: 22, alignItems: 'center', gap: 8 }}>
              <Ionicons name="images-outline" size={28} color={C.t3} />
              <Txt size={15} color={C.t2} style={{ textAlign: 'center' }}>{t('Nothing from home yet. When your family sends something, it shows up here and on your home screen widget.')}</Txt>
            </Cel>
          ) : (
            <View style={{ marginTop: 18, gap: 12 }}>
              {mensajes.map(m => m.tipo === 'foto' && m.archivo ? (
                <View key={m.id} style={{ borderRadius: 24, overflow: 'hidden', backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}>
                  <Image source={{ uri: urlArchivoCasa(m.id) }} style={{ width: W, height: W * 0.75 }} contentFit="cover" transition={250} cachePolicy="disk" accessibilityLabel={t('Photo from {n}', { n: m.de })} />
                  <View style={{ padding: 14, gap: 4 }}>
                    {m.texto ? <Txt size={16} lh={22}>{m.texto}</Txt> : null}
                    <Txt size={12.5} color={C.t3}>{quien(m)} · {t('arrived {h}', { h: hace(m.llega) })}</Txt>
                  </View>
                </View>
              ) : (
                <Cel key={m.id} style={{ padding: 18, gap: 8 }}>
                  <Txt size={18} lh={25} ls={-0.3}>“{m.texto}”</Txt>
                  <Txt size={12.5} color={C.t3}>{quien(m)} · {t('arrived {h}', { h: hace(m.llega) })}</Txt>
                </Cel>
              ))}
            </View>
          )}

          {url && mensajes.length ? (
            <>
              <Txt f="s" size={19} ls={-0.5} style={{ marginTop: 28, marginBottom: 10 }}>{para ? t('Reply to {n}', { n: para }) : t('Reply')}</Txt>
              <Cel style={{ padding: 12, gap: 10 }}>
                {foto ? (
                  <View>
                    <Image source={{ uri: foto.uri }} style={{ width: W - 26, height: (W - 26) * 0.62, borderRadius: 16 }} contentFit="cover" />
                    <Pressable onPress={() => setFoto(null)} hitSlop={8} accessibilityLabel={t('Remove photo')} style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="close" size={16} color="#fff" />
                    </Pressable>
                  </View>
                ) : null}
                <TextInput value={texto} onChangeText={setTexto} placeholder={t('Write something for home…')} placeholderTextColor={C.t3} multiline maxLength={1000}
                  style={{ minHeight: 56, maxHeight: 140, paddingHorizontal: 12, paddingTop: 12, color: C.t1, fontFamily: F.r, fontSize: 16 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pressable onPress={elegirFoto} accessibilityLabel={t('Add a photo')} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="image-outline" size={20} color={C.t2} />
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={enviar} disabled={enviando || (!texto.trim() && !foto)} accessibilityRole="button"
                    style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: !texto.trim() && !foto ? C.s2 : C.t1 }}>
                    {enviando ? <ActivityIndicator color={C.bg} /> : <Ionicons name="paper-plane" size={16} color={!texto.trim() && !foto ? C.t3 : C.bg} />}
                    <Txt f="s" size={15} color={!texto.trim() && !foto ? C.t3 : C.bg}>{t('Send to Earth')}</Txt>
                  </Pressable>
                </View>
              </Cel>
              {aviso ? <Txt size={13} color={C.t2} style={{ marginTop: 8 }}>{aviso}</Txt> : null}
              {casa?.respuestas.length ? (
                <View style={{ marginTop: 18, gap: 8 }}>
                  <Txt f="m" size={13} color={C.t3}>{t('Your replies')}</Txt>
                  {casa.respuestas.slice(0, 6).map(r => (
                    <View key={r.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      <Ionicons name={r.estado === 'enviado' ? 'checkmark-done' : 'time-outline'} size={16} color={r.estado === 'enviado' ? C.ok : C.t3} />
                      <Txt size={14} color={C.t2} style={{ flex: 1 }} numberOfLines={1}>{r.texto || t('Photo')}</Txt>
                      <Txt size={12} color={C.t3}>{r.estado === 'enviado' ? t('sent to Earth') : t('waiting for contact')}</Txt>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
