/* Piezas del Journal: chips, el editor de entradas (con la pregunta del día) y cada entrada de la línea de tiempo. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ANIMOS, animoDe, borrar, escribir, etiquetas as listaEtiquetas, preguntaDelDia, type Entrada } from '../engine/diario';
import { leerFunciones, useFunciones } from '../engine/funciones';
import { useIdioma } from '../i18n';
import { Interruptor } from './Interruptor';
import { Boton, C, Cel, F, Lbl, Txt } from './tema';

export const COLOR_ANIMO = [C.alerta, C.aviso, C.t2, C.sig, C.ok];
/** hora de la nave (UTC) en modo misión; la tuya en el día a día */
const horaNave = (ts: number) => { const d = new Date(ts), u = leerFunciones().mision; return `${String(u ? d.getUTCHours() : d.getHours()).padStart(2, '0')}:${String(u ? d.getUTCMinutes() : d.getMinutes()).padStart(2, '0')}`; };

export function Chip({ t, on, onPress, color = C.nova }: { t: string; on: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 13, height: 34, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: on ? color : C.l2, backgroundColor: on ? `${color}22` : 'transparent' }}>
      <Txt f="m" size={13.5} color={on ? color : C.t2}>{t}</Txt>
    </Pressable>
  );
}

export function Editor({ inicial, puedeCompartir, onListo }: { inicial?: Entrada; puedeCompartir: boolean; onListo: () => void }) {
  const [texto, setTexto] = useState(inicial?.texto ?? '');
  const [animo, setAnimo] = useState(inicial?.animo ?? 2);
  const [etiquetas, setEtiquetas] = useState<string[]>(inicial?.etiquetas ?? []);
  const [compartir, setCompartir] = useState(inicial?.compartir ?? false);
  const tr = useIdioma(), { t } = tr, { mision } = useFunciones();
  const guardar = () => {
    if (!texto.trim()) return;
    escribir({ id: inicial?.id, texto: texto.trim(), animo, etiquetas, compartir: compartir && puedeCompartir });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onListo();
  };
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
      <Cel style={{ padding: 16, gap: 14 }}>
        <TextInput
          value={texto} onChangeText={setTexto} multiline autoFocus={!inicial}
          placeholder={preguntaDelDia(tr)} placeholderTextColor={C.t3}
          style={{ minHeight: 130, color: C.t1, fontFamily: F.r, fontSize: 16.5, lineHeight: 24, textAlignVertical: 'top' }}
        />
        <View style={{ gap: 8 }}>
          <Lbl t={t('How do you feel?')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ANIMOS.map((a, i) => <Chip key={a} t={animoDe(tr, i)} on={animo === i} color={COLOR_ANIMO[i]} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAnimo(i); }} />)}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Lbl t={t('About')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {listaEtiquetas().map(k => <Chip key={k} t={t(k)} on={etiquetas.includes(k)} onPress={() => setEtiquetas(x => (x.includes(k) ? x.filter(y => y !== k) : [...x, k]))} />)}
          </View>
        </View>
        {mision ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.l1, opacity: puedeCompartir ? 1 : 0.6 }}>
          <Ionicons name={compartir && puedeCompartir ? 'paper-plane-outline' : 'lock-closed-outline'} size={17} color={C.t2} />
          <View style={{ flex: 1 }}>
            <Txt f="m" size={14.5}>{t(compartir && puedeCompartir ? 'Send to Dr. Ruiz' : 'Only you')}</Txt>
            <Txt size={12.5} lh={17} color={C.t3}>{t(puedeCompartir ? 'Goes out with the next Earth link, 18 min delay.' : 'Turn on Journal in What you share to send entries to Dr. Ruiz.')}</Txt>
          </View>
          {puedeCompartir ? <Interruptor on={compartir} label={t('Send to Dr. Ruiz')} onChange={setCompartir} /> : null}
        </View> : null}
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
          <Boton t={t('Cancel')} onPress={onListo} />
          <Boton t={t(inicial ? 'Save changes' : 'Save entry')} primario onPress={guardar} />
        </View>
      </Cel>
    </Animated.View>
  );
}

export function EntradaVista({ e, onEditar }: { e: Entrada; onEditar: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const tr = useIdioma(), { t } = tr;
  return (
    <Pressable onPress={() => { setAbierta(!abierta); setConfirmar(false); }}>
      <Cel style={{ padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt f="mono" size={12.5} color={C.t3}>{horaNave(e.ts)}</Txt>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: COLOR_ANIMO[e.animo] }} />
          <Txt f="m" size={13} color={COLOR_ANIMO[e.animo]} style={{ flex: 1 }}>{animoDe(tr, e.animo)}</Txt>
          <Ionicons name={e.compartir ? 'paper-plane-outline' : 'lock-closed-outline'} size={14} color={C.t3} />
        </View>
        <Txt size={15.5} lh={23} numberOfLines={abierta ? undefined : 4}>{e.texto}</Txt>
        {e.etiquetas.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {e.etiquetas.map(k => <View key={k} style={{ paddingHorizontal: 9, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: C.s2 }}><Txt size={12} color={C.t2}>{t(k)}</Txt></View>)}
          </View>
        ) : null}
        {abierta && (
          <Animated.View entering={FadeIn.duration(180)} style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', paddingTop: 6 }}>
            <Boton t={t('Edit')} icono="create-outline" onPress={onEditar} />
            <Boton t={t(confirmar ? 'Tap again to delete' : 'Delete')} icono="trash-outline" onPress={() => { if (confirmar) borrar(e.id); else setConfirmar(true); }} />
          </Animated.View>
        )}
      </Cel>
    </Pressable>
  );
}

