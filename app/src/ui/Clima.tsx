/* El clima en Hoy: ahora, máxima/mínima, si va a llover (y a qué hora) y una tira con las próximas horas.
   Tocarla abre la ciudad en Tú. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useIdioma } from '../i18n';
import { proximaLluvia, tipoClima, useClima } from '../sensores/clima';
import { useAhora } from './ahora';
import { C, Cel, Toque, Txt } from './tema';

const esNoche = (ts: number) => { const h = new Date(ts).getHours(); return h < 7 || h >= 20; };

export function TarjetaClima() {
  const { t } = useIdioma(), { clima, ciudad } = useClima(), ahora = useAhora(10 * 60e3);
  if (!clima) return null;
  const tipo = tipoClima(clima.ahora.codigo, esNoche(ahora));
  const lluvia = proximaLluvia(clima, ahora);
  const proximas = clima.horas.filter(h => h.ts > ahora).filter((_, i) => i % 2 === 0).slice(0, 6);
  const hora = (ts: number) => `${new Date(ts).getHours()}h`;
  const nota = lluvia ? t('Rain likely around {h}', { h: hora(lluvia.ts) }) : clima.hoy.uv >= 8 ? t('Very high UV today, use sunscreen') : clima.hoy.lluvia < 20 ? t('No rain today') : t('Rain chance {p}%', { p: clima.hoy.lluvia });
  return (
    <Toque onPress={() => router.push('/perfil')} label={`${Math.round(clima.ahora.temp)}° ${t(tipo.t)}, ${ciudad.nombre}`} style={{ marginTop: 16 }}>
      <Cel style={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name={tipo.icono as keyof typeof Ionicons.glyphMap} size={30} color={lluvia ? C.sig : C.aviso} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Txt f="l" size={34} ls={-1.4} lh={38}>{Math.round(clima.ahora.temp)}</Txt>
            <Txt f="l" size={18} color={C.t2} style={{ marginTop: 3 }}>°</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="m" size={14.5} numberOfLines={1}>{t(tipo.t)} · {ciudad.nombre}</Txt>
            <Txt size={12.5} color={C.t3} numberOfLines={1}>{t('High {a}° · low {b}°', { a: Math.round(clima.hoy.max), b: Math.round(clima.hoy.min) })}</Txt>
            <Txt size={12.5} color={lluvia ? C.sig : C.t3} numberOfLines={1}>{nota}</Txt>
          </View>
        </View>
        {proximas.length >= 4 ? (
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.l1, paddingTop: 10 }}>
            {proximas.map(h => {
              const tp = tipoClima(h.codigo, esNoche(h.ts));
              return (
                <View key={h.ts} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
                  <Txt f="monoR" size={11} color={C.t3}>{hora(h.ts)}</Txt>
                  <Ionicons name={tp.icono as keyof typeof Ionicons.glyphMap} size={15} color={h.lluvia >= 50 ? C.sig : C.t2} />
                  <Txt f="m" size={12.5}>{Math.round(h.temp)}°</Txt>
                  {h.lluvia >= 30 ? <Txt f="monoR" size={10} color={C.sig}>{h.lluvia}%</Txt> : <Txt size={10}> </Txt>}
                </View>
              );
            })}
          </View>
        ) : null}
      </Cel>
    </Toque>
  );
}
