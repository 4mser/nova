/* La tarjeta del standup de hoy: quién ya lo hizo (con check), quién falta y el botón para hacer el tuyo.
   El contenido de un standup en la bitácora: ayer · hoy · bloqueo, cada uno con su color. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useBitacora } from '../cuenta/datos';
import { useSesion, type Crew } from '../cuenta/sesion';
import { standupsDeHoy, type Standup } from '../cuenta/standup';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { AvatarMiembro } from './Crew';
import { C, Cel, Toque, Txt } from './tema';

export function TarjetaStandup({ crew, compacta }: { crew: Crew; compacta?: boolean }) {
  const { t } = useIdioma(), { usuario } = useSesion(), ahora = useAhora();
  const { datos } = useBitacora(crew.id);
  const hechos = standupsDeHoy(datos, ahora), yoListo = !!usuario && hechos.has(usuario.id);
  const bloqueos = [...hechos.values()].filter(e => { try { return !!JSON.parse(e.texto).bloqueo; } catch { return false; } }).length;
  if (compacta && yoListo) return null;
  return (
    <Toque onPress={() => router.push(yoListo ? { pathname: '/journal', params: { vista: 'crew' } } : '/standup')} label={t('Standup')} style={{ marginTop: compacta ? 16 : 0 }}>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: yoListo ? 'rgba(111,214,176,0.14)' : C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={yoListo ? 'checkmark-done' : 'chatbubbles-outline'} size={19} color={yoListo ? C.ok : C.nova} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt f="s" size={15}>{yoListo ? t("Today's standup") : t('Do your standup')}</Txt>
            <Txt f="monoR" size={12} color={C.t3}>{hechos.size}/{crew.miembros.length}</Txt>
            {bloqueos ? <Txt f="m" size={12} color={C.aviso}>· ⚠ {bloqueos}</Txt> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {crew.miembros.slice(0, 8).map(m => (
              <View key={m.id} style={{ opacity: hechos.has(m.id) ? 1 : 0.35 }}>
                <AvatarMiembro u={m} size={22} anillo={hechos.has(m.id) ? C.ok : undefined} />
              </View>
            ))}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={17} color={C.t3} />
      </Cel>
    </Toque>
  );
}

/** el cuerpo de una entrada de standup en la bitácora */
export function CuerpoStandup({ s }: { s: Standup }) {
  const { t } = useIdioma();
  const fila = (icono: keyof typeof Ionicons.glyphMap, color: string, k: string, v: string) => (
    <View key={k} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
      <Ionicons name={icono} size={15} color={color} style={{ marginTop: 3 }} />
      <Txt size={14.5} lh={20.5} style={{ flex: 1 }}><Txt f="m" size={13} color={C.t3}>{k} </Txt>{v}</Txt>
    </View>
  );
  return (
    <View>
      {s.ayer ? fila('checkmark-done', C.ok, t('Yesterday'), s.ayer) : null}
      {fila('arrow-forward-circle-outline', C.nova, t('Today'), s.hoy)}
      {s.bloqueo ? fila('alert-circle-outline', C.aviso, t('Blocked'), s.bloqueo) : null}
    </View>
  );
}
