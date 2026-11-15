/* «Live from your devices»: todo lo real que NOVA lee con tu consentimiento — el pulso del reloj, Health Connect,
   el uso del teléfono y sus sensores. Punto verde = dato real; el resto de la app sigue marcado como simulado. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useConsentimiento } from '../sensores/fuentes';
import { conectarReloj, desconectarReloj, relojDisponible } from '../sensores/reloj';
import { abrirPermisoUso, usoConPermiso } from '../sensores/uso';
import { useVivo } from '../sensores/vivo';
import { Barritas, Serie, TrazaViva } from './Graficos';
import { Boton, C, Cel, Lbl, Num, Toque, Txt } from './tema';
import { useIdioma } from '../i18n';

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} m` : `${Math.round(min)} min`);

function Vivo({ t: txt = 'Live' }: { t?: string }) {
  const { t } = useIdioma();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.ok }} />
      {txt ? <Txt f="m" size={12.5} color={C.ok}>{t(txt)}</Txt> : null}
    </View>
  );
}

function Dato({ t, v, u, w, real = true }: { t: string; v: string; u?: string; w?: number; real?: boolean }) {
  return (
    <View style={{ width: w, flex: w ? undefined : 1, padding: 12, borderRadius: 16, backgroundColor: C.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Txt size={12.5} color={C.t2} style={{ flex: 1 }}>{t}</Txt>{real ? <Vivo t="" /> : null}</View>
      <Num v={v} u={u} size={22} style={{ marginTop: 4 }} />
    </View>
  );
}

/** datos en filas de a dos (cada celda flex:1: con anchos medidos + flexWrap, Android manda la segunda a la fila siguiente) */
function Pares({ datos }: { w: number; datos: (false | undefined | { t: string; v: string; u?: string })[] }) {
  const l = datos.filter(Boolean) as { t: string; v: string; u?: string }[];
  const filas = Array.from({ length: Math.ceil(l.length / 2) }, (_, i) => l.slice(i * 2, i * 2 + 2));
  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      {filas.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {f.map(d => <View key={d.t} style={{ flex: 1 }}><Dato t={d.t} v={d.v} u={d.u} /></View>)}
          {f.length < 2 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

export function PanelEnVivo({ w }: { w: number }) {
  const v = useVivo(), r = v.reloj, { c, alguno } = useConsentimiento(), tr = useIdioma(), { t } = tr;
  const mitad = (w - 8) / 2;
  const conectado = r.estado === 'conectado' && !!v.fc;
  const s = v.salud, u = v.uso;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 2, paddingHorizontal: 2 }}>
        <Txt f="s" size={19} ls={-0.5} style={{ flex: 1 }}>{t('Live from your devices')}</Txt>
        <Toque onPress={() => router.push('/datos')} label={t('Manage your data')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="shield-checkmark-outline" size={14} color={C.nova} />
          <Txt f="m" size={13} color={C.nova}>{t('Your data')}</Txt>
        </Toque>
      </View>

      {!alguno && (
        <Toque onPress={() => router.push('/datos')} label={t('Choose what Nova can read')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="pulse" size={22} color={C.nova} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={16}>{t('Connect your real data')}</Txt>
              <Txt size={13.5} lh={19} color={C.t2}>{t('Watch, health apps, phone use and sensors. Only what you turn on, and it stays on this phone.')}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.t3} />
          </Cel>
        </Toque>
      )}

      {/* reloj */}
      {c.reloj && (
        <Cel style={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Lbl t={conectado ? t('Heart rate · {reloj}', { reloj: r.nombre ?? '' }) : t('Heart rate · watch')} style={{ flex: 1 }} />
            {conectado ? <Vivo /> : r.estado === 'buscando' ? <Txt size={12.5} color={C.nova}>{t('Searching…')}</Txt> : null}
          </View>
          {conectado ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
                <Num v={String(Math.round(v.fc ?? 0))} u={t('bpm')} size={44} style={{ flex: 1 }} />
                {v.rmssd ? (
                  <View style={{ alignItems: 'flex-end', paddingBottom: 6 }}>
                    <Txt size={12.5} color={C.t2}>{t('HRV now')}</Txt>
                    <Txt f="m" size={17}>{Math.round(v.rmssd)} <Txt size={12} color={C.t2}>ms</Txt></Txt>
                  </View>
                ) : null}
              </View>
              <View style={{ marginTop: 8 }}><TrazaViva w={w - 38} h={44} bpm={v.fc ?? 64} latidos={3} col={C.ok} /></View>
              {v.serieFc.length > 3 ? (
                <>
                  <View style={{ marginTop: 10 }}><Serie w={w - 38} h={56} vals={v.serieFc} col={C.ok} /></View>
                  <View style={{ flexDirection: 'row', marginTop: 4 }}>
                    <Txt size={11.5} color={C.t3} style={{ flex: 1 }}>{v.serieFc.length >= 60 ? t('{n} min ago', { n: Math.round(v.serieFc.length / 60) }) : t('{n} s ago', { n: v.serieFc.length })}</Txt>
                    <Txt size={11.5} color={C.t3}>{t('now · {a}–{b} bpm', { a: Math.round(Math.min(...v.serieFc)), b: Math.round(Math.max(...v.serieFc)) })}</Txt>
                  </View>
                </>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}><Boton t={t('Disconnect')} onPress={desconectarReloj} /></View>
            </>
          ) : !relojDisponible() ? (
            <Txt size={13.5} lh={19} color={C.t2} style={{ marginTop: 8 }}>{t('Reading the watch over Bluetooth needs the NOVA development build.')}</Txt>
          ) : (
            <View style={{ marginTop: 10, gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Ionicons name="watch-outline" size={18} color={C.t2} style={{ marginTop: 1 }} />
                <Txt size={13.5} lh={19} color={C.t2} style={{ flex: 1 }}>{r.mensaje ? `${t(r.mensaje)}. ` : ''}{t('On the watch, open Settings → HR Data Broadcasts and turn it on. Then connect.')}</Txt>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Boton t={t(r.estado === 'buscando' ? 'Searching…' : 'Connect watch')} icono="bluetooth" primario onPress={() => { if (r.estado !== 'buscando') conectarReloj(); }} />
              </View>
            </View>
          )}
        </Cel>
      )}

      {/* Health Connect */}
      {c.salud && (
        <Cel style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Lbl t="Health Connect" style={{ flex: 1 }} />
            {s?.origenes.length ? <Txt size={12} color={C.t3}>{t('from {apps}', { apps: s.origenes.join(', ') })}</Txt> : null}
          </View>
          {s && (s.pasos !== undefined || s.fc || s.sueno) ? (
            <>
              <Pares w={w - 32} datos={[
                s.pasos !== undefined && { t: t('Steps today'), v: s.pasos.toLocaleString(tr.locale) },
                s.sueno && { t: t('Sleep {a}–{b}', { a: hm(s.sueno.ini), b: hm(s.sueno.fin) }), v: dur(s.sueno.horas * 60) },
                s.fcReposo !== undefined && { t: t('Resting heart'), v: String(Math.round(s.fcReposo)), u: t('bpm') },
                s.vfc !== undefined && { t: t('HRV'), v: String(Math.round(s.vfc)), u: 'ms' },
                s.spo2 !== undefined && { t: 'SpO₂', v: String(Math.round(s.spo2)), u: '%' },
                s.ejercicioMin !== undefined && { t: t('Exercise today'), v: String(s.ejercicioMin), u: 'min' },
                s.calorias !== undefined && { t: t('Active energy'), v: String(Math.round(s.calorias)), u: 'kcal' },
                s.fc !== undefined && { t: t('Latest heart rate'), v: String(Math.round(s.fc)), u: t('bpm') },
              ]} />
              {s.serieFc.length > 3 ? <View style={{ marginTop: 10 }}><Serie w={w - 32} h={46} vals={s.serieFc} col={C.ok} /></View> : null}
            </>
          ) : (
            <Txt size={13.5} lh={19} color={C.t2} style={{ marginTop: 8 }}>{t('No data from other apps yet. Apps like Google Fit, Samsung Health or Fitbit write here; Huawei Health does not.')}</Txt>
          )}
        </Cel>
      )}

      {/* uso del teléfono */}
      {c.uso && (
        <Cel style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Phone use today')} style={{ flex: 1 }} />{u ? <Vivo t="" /> : null}</View>
          {u ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Dato w={(w - 32 - 16) / 3} t={t('Screen')} v={dur(u.pantallaMin)} />
                <Dato w={(w - 32 - 16) / 3} t={t('Unlocks')} v={String(u.desbloqueos)} />
                <Dato w={(w - 32 - 16) / 3} t={t('Last night')} v={dur(u.nocheMin)} />
              </View>
              {u.apps.length ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {u.apps.slice(0, 5).map(a => (
                    <View key={a.nombre} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row' }}><Txt size={13.5} style={{ flex: 1 }} numberOfLines={1}>{a.nombre}</Txt><Txt size={13} color={C.t2}>{dur(a.min)}</Txt></View>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: C.l2 }}><View style={{ width: `${Math.max(2, (a.min / u.apps[0].min) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: C.sig }} /></View>
                    </View>
                  ))}
                </View>
              ) : null}
              {(u.ultimoUso || u.primerUso) ? <Txt size={12.5} color={C.t3} style={{ marginTop: 10 }}>{u.ultimoUso ? t('Phone down at {h}', { h: hm(u.ultimoUso) }) : ''}{u.ultimoUso && u.primerUso ? ' · ' : ''}{u.primerUso ? t('first pickup {h}', { h: hm(u.primerUso) }) : ''}</Txt> : null}
            </>
          ) : !usoConPermiso() ? (
            <View style={{ marginTop: 8, gap: 10 }}>
              <Txt size={13.5} lh={19} color={C.t2}>{t('Android asks you to allow usage access for Nova in Settings.')}</Txt>
              <View style={{ flexDirection: 'row' }}><Boton t={t('Open Settings')} icono="settings-outline" primario onPress={() => abrirPermisoUso()} /></View>
            </View>
          ) : <Txt size={13.5} color={C.t2} style={{ marginTop: 8 }}>{t('Reading…')}</Txt>}
        </Cel>
      )}

      {/* sensores del teléfono */}
      {(c.movimiento || c.cabina) && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {c.movimiento && (
            <Cel style={{ width: c.cabina ? mitad : w }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Movement')} style={{ flex: 1 }} />{v.sensores.movimiento ? <Vivo t="" /> : null}</View>
              <Txt f="m" size={20} style={{ marginTop: 8 }}>{!v.sensores.movimiento ? '—' : t(v.actividad === 'quieto' ? 'Still' : v.actividad === 'moviendose' ? 'Moving' : 'Active')}</Txt>
              <View style={{ marginTop: 8 }}>{v.serieMov.length > 2 ? <Serie w={(c.cabina ? mitad : w) - 32} h={34} vals={[0, ...v.serieMov.slice(-60)]} col={C.nova} area /> : <View style={{ height: 34 }} />}</View>
              <Txt size={12} color={C.t3} style={{ marginTop: 4 }}>{c.pasos && v.sensores.pasos ? t('{n} steps since you opened Nova', { n: v.pasos }) : t('Accelerometer')}</Txt>
            </Cel>
          )}
          {c.cabina && (
            <Cel style={{ width: c.movimiento ? mitad : w }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Cabin pressure')} style={{ flex: 1 }} />{v.presion ? <Vivo t="" /> : null}</View>
              <Num v={v.presion ? v.presion.toFixed(1) : '—'} u={v.presion ? 'hPa' : undefined} size={24} style={{ marginTop: 8 }} />
              <View style={{ marginTop: 8 }}>{v.seriePresion.length > 2 ? <Serie w={(c.movimiento ? mitad : w) - 32} h={34} vals={v.seriePresion} col={C.sig} area={false} /> : <View style={{ height: 34 }} />}</View>
              <Txt size={12} color={C.t3} style={{ marginTop: 4 }}>{t(v.presion ? 'Phone barometer' : 'No barometer on this phone')}</Txt>
            </Cel>
          )}
        </View>
      )}
      {(c.cabina && v.luz !== undefined) || (c.bateria && v.bateria) || (c.ruido && v.ruido) ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {c.cabina && v.luz !== undefined && (
            <Cel style={{ flex: 1, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Light')} style={{ flex: 1 }} /><Vivo t="" /></View>
              <Num v={String(Math.round(v.luz))} u="lux" size={22} style={{ marginTop: 6 }} />
              {v.serieLuz.length > 2 ? <View style={{ marginTop: 6 }}><Barritas w={(w - 16) / 3 - 28} h={22} vals={v.serieLuz.slice(-8).map(x => Math.min(1, x / Math.max(...v.serieLuz.slice(-8), 1)))} col={C.aviso} /></View> : null}
            </Cel>
          )}
          {c.bateria && v.bateria && (
            <Cel style={{ flex: 1, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Battery')} style={{ flex: 1 }} /><Vivo t="" /></View>
              <Num v={String(Math.round(v.bateria.nivel * 100))} u="%" size={22} style={{ marginTop: 6 }} />
              <Txt size={12} color={v.bateria.cargando ? C.ok : C.t3} style={{ marginTop: 6 }}>{v.bateria.cargando ? (v.bateria.desdeCarga ? t('Charging since {h}', { h: hm(v.bateria.desdeCarga) }) : t('Charging')) : t('On battery')}</Txt>
            </Cel>
          )}
          {c.ruido && v.ruido && (
            <Cel style={{ flex: 1, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Lbl t={t('Noise')} style={{ flex: 1 }} /><Vivo t="" /></View>
              <Num v={`≈${Math.round(v.ruido)}`} u="dB" size={22} style={{ marginTop: 6 }} />
              <Txt size={12} color={v.ruido > 70 ? C.aviso : C.t3} style={{ marginTop: 6 }}>{t(v.ruido > 70 ? 'Loud' : v.ruido > 50 ? 'Moderate' : 'Quiet')} · {t('every 5 min')}</Txt>
            </Cel>
          )}
        </View>
      ) : null}
    </View>
  );
}
