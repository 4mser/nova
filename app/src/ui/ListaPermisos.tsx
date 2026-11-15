/* Lista de permisos: cada uno con su para qué y un botón (Permitir → ✓, o Ajustes si Android ya no deja preguntar).
   «Permitir todo» los pide en orden. Se refresca al volver de Ajustes o de Health Connect. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, View } from 'react-native';
import { estadoPermiso, pedirPermiso, PERMISOS, type EstadoPermiso, type IdPermiso } from '../cuenta/permisos';
import { useIdioma } from '../i18n';
import { C, Txt } from './tema';

const leerTodos = async () => Object.fromEntries(await Promise.all(PERMISOS.map(async p => [p.id, await estadoPermiso(p.id)] as const))) as Partial<Record<IdPermiso, EstadoPermiso>>;

export function ListaPermisos({ compacta, alAvisos }: { compacta?: boolean; alAvisos?: () => void }) {
  const { t } = useIdioma();
  const [estado, setEstado] = useState<Partial<Record<IdPermiso, EstadoPermiso>>>({});
  const [pidiendo, setPidiendo] = useState<IdPermiso | 'todo' | null>(null);
  useEffect(() => {
    const leer = () => leerTodos().then(setEstado);
    leer();
    const s = AppState.addEventListener('change', x => { if (x === 'active') leer(); });
    return () => s.remove();
  }, []);

  const pedir = async (id: IdPermiso) => {
    Haptics.selectionAsync().catch(() => {});
    setPidiendo(id);
    const e = await pedirPermiso(id, alAvisos);
    setEstado(x => ({ ...x, [id]: e }));
    setPidiendo(null);
    if (e === 'si') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  const todo = async () => {
    setPidiendo('todo');
    for (const p of PERMISOS) if (estado[p.id] === 'pedir') { const e = await pedirPermiso(p.id, alAvisos); setEstado(x => ({ ...x, [p.id]: e })); }
    setPidiendo(null);
  };
  const visibles = PERMISOS.filter(p => estado[p.id] && estado[p.id] !== 'no');
  const faltan = visibles.filter(p => estado[p.id] === 'pedir').length;

  return (
    <View>
      <View style={{ borderRadius: 22, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 14 }}>
        {visibles.map((p, i) => {
          const e = estado[p.id];
          return (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: compacta ? 10 : 13, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${p.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={p.icono as keyof typeof Ionicons.glyphMap} size={16} color={p.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt f="m" size={14.5}>{t(p.titulo)}</Txt>
                {!compacta ? <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 1 }}>{t(p.para)}</Txt> : null}
              </View>
              {e === 'si' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={t('{x} allowed', { x: t(p.titulo) })}>
                  <Ionicons name="checkmark-circle" size={20} color={C.ok} />
                </View>
              ) : (
                <Pressable onPress={() => pedir(p.id)} disabled={!!pidiendo} accessibilityRole="button" accessibilityLabel={e === 'ajustes' ? t('Open settings for {x}', { x: t(p.titulo) }) : t('Allow {x}', { x: t(p.titulo) })}
                  style={({ pressed }) => ({ height: 32, minWidth: 82, paddingHorizontal: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: e === 'ajustes' ? 'transparent' : C.sigSuave, borderWidth: 1, borderColor: e === 'ajustes' ? C.aviso : 'rgba(143,230,245,0.35)', opacity: pressed ? 0.7 : 1 })}>
                  {pidiendo === p.id ? <ActivityIndicator size="small" color={C.nova} /> : <Txt f="s" size={13} color={e === 'ajustes' ? C.aviso : C.nova}>{e === 'ajustes' ? t('Settings') : t('Allow')}</Txt>}
                </Pressable>
              )}
            </View>
          );
        })}
        {!visibles.length ? <Txt size={13.5} color={C.t3} style={{ paddingVertical: 14 }}>{t('Permissions are asked on the phone.')}</Txt> : null}
      </View>
      {faltan > 1 ? (
        <Pressable onPress={todo} disabled={!!pidiendo} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 10, alignSelf: 'flex-start', height: 38, paddingHorizontal: 16, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.l2, opacity: pressed ? 0.7 : 1 })}>
          {pidiendo === 'todo' ? <ActivityIndicator size="small" color={C.t1} /> : <Ionicons name="flash-outline" size={15} color={C.t1} />}
          <Txt f="m" size={13.5}>{t('Allow all ({n})', { n: faltan })}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
