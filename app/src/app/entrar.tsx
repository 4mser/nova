/* Entrar a NOVA con correo y clave. Las cuentas las crea quien administra (no hay registro abierto). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { entrar } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { C, F, Txt } from '../ui/tema';

export default function Entrar() {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  const [email, setEmail] = useState(''), [clave, setClave] = useState(''), [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const listo = /\S+@\S+\.\S+/.test(email) && clave.length > 0 && !enviando;
  const enviar = async () => {
    if (!listo) return;
    setEnviando(true); setError(null);
    try { await entrar(email.trim(), clave); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
    catch (e) { setError(t((e as Error).message)); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); }
    finally { setEnviando(false); }
  };
  const campo = { height: 54, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 18, color: C.t1, fontFamily: F.r, fontSize: 16 } as const;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: ins.top + 20, paddingBottom: ins.bottom + 24, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <NovaOrb size={170} orbes={2} expr="feliz" />
          <Txt f="s" size={30} ls={-1.2} style={{ marginTop: 8 }}>NOVA</Txt>
          <Txt size={15.5} lh={22} color={C.t2} style={{ textAlign: 'center', marginTop: 6, maxWidth: 300 }}>{t('Your body, your mind, your focus and your crew, every day.')}</Txt>
        </View>
        <View style={{ gap: 10, marginTop: 34, width: '100%', maxWidth: 420, alignSelf: 'center' }}>
          <TextInput value={email} onChangeText={setEmail} placeholder={t('Email')} placeholderTextColor={C.t3} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" style={campo} accessibilityLabel={t('Email')} />
          <View>
            <TextInput value={clave} onChangeText={setClave} placeholder={t('Password')} placeholderTextColor={C.t3} secureTextEntry={!ver} autoCapitalize="none" autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={enviar} style={[campo, { paddingRight: 54 }]} accessibilityLabel={t('Password')} />
            <Pressable onPress={() => setVer(v => !v)} hitSlop={8} accessibilityLabel={t(ver ? 'Hide password' : 'Show password')} style={{ position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' }}>
              <Ionicons name={ver ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.t3} />
            </Pressable>
          </View>
          {error ? <Txt size={14} color={C.alerta} style={{ paddingHorizontal: 4 }}>{error}</Txt> : null}
          <Pressable onPress={enviar} disabled={!listo} accessibilityRole="button" accessibilityLabel={t('Sign in')}
            style={({ pressed }) => ({ height: 54, borderRadius: 27, marginTop: 6, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: listo ? (pressed ? 0.8 : 1) : 0.4, boxShadow: '0 8px 28px -8px rgba(70,200,232,0.6)' })}>
            {enviando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t('Sign in')}</Txt>}
          </Pressable>
          <Txt size={13} lh={19} color={C.t3} style={{ textAlign: 'center', marginTop: 10 }}>{t('Accounts are created by the person who runs your crew. Ask them for yours.')}</Txt>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
