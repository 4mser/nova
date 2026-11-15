/* Orquesta todas las fuentes de datos reales según el consentimiento (fuentes.ts): cada una se enciende solo si dijiste
   que sí, y se apaga apenas lo retiras. Sensores del teléfono (Expo Go): movimiento, pasos, presión y luz, batería y
   ruido por muestras. Con la versión de desarrollo: reloj por Bluetooth, Health Connect y uso del teléfono. */
import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { createRecordingOptions } from 'expo-audio/build/utils/options';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Accelerometer, Barometer, LightSensor, Pedometer } from 'expo-sensors';
import { fechaDe } from '../engine/diario';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { cargarConsentimiento, useConsentimiento } from './fuentes';
import { conectarReloj, desconectarReloj, relojDisponible } from './reloj';
import { leerAgenda, olvidarAgenda } from './agenda';
import { leerSalud } from './salud';
import { leerUso } from './uso';
import { cambiar, empujar, leer } from './vivo';

const PASOS_TEL = 'nova.pasosTel.v1';

const movil = Platform.OS !== 'web';

export function useFuentes() {
  const { c } = useConsentimiento();
  useEffect(() => { cargarConsentimiento(); }, []);

  // movimiento: |aceleración| menos la gravedad, suavizado; un punto por segundo para el gráfico
  useEffect(() => {
    if (!movil || !c.movimiento) return;
    let mov = 0, ultimo = 0, sub: { remove: () => void } | null = null, vivo = true;
    Accelerometer.isAvailableAsync().then(ok => {
      if (!ok || !vivo) return;
      Accelerometer.setUpdateInterval(100);
      sub = Accelerometer.addListener(({ x, y, z }) => {
        mov += (Math.min(1, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1) * 2.5) - mov) * 0.12;
        const ahora = Date.now();
        if (ahora - ultimo < 1000) return;
        ultimo = ahora;
        cambiar(v => ({ movimiento: mov, serieMov: empujar(v.serieMov, mov), actividad: mov < 0.04 ? 'quieto' : mov < 0.18 ? 'moviendose' : 'activo', sensores: { ...v.sensores, movimiento: true } }));
      });
    });
    return () => { vivo = false; sub?.remove(); cambiar(v => ({ sensores: { ...v.sensores, movimiento: false }, serieMov: [] })); };
  }, [c.movimiento]);

  // pasos del sensor del teléfono (cuando no hay Health Connect): el sensor cuenta desde que se suscribe, así que el
  // total del día se guarda y cada sesión suma encima; antes partía de cero cada vez que abrías la app
  useEffect(() => {
    if (!movil || !c.pasos) return;
    let sub: { remove: () => void } | null = null, vivo = true;
    (async () => {
      try {
        if (!(await Pedometer.isAvailableAsync()) || !(await Pedometer.requestPermissionsAsync()).granted || !vivo) return;
        const guardado = JSON.parse((await AsyncStorage.getItem(PASOS_TEL).catch(() => null)) ?? 'null') as { fecha: string; pasos: number } | null;
        let fecha = fechaDe(Date.now()), base = guardado?.fecha === fecha ? guardado.pasos : 0, ultimoGuardado = 0;
        sub = Pedometer.watchStepCount(r => {
          const hoy = fechaDe(Date.now());
          if (hoy !== fecha) { fecha = hoy; base = -r.steps; } // pasó la medianoche con la app abierta
          const total = Math.max(0, base + r.steps);
          cambiar(v => ({ pasos: total, sensores: { ...v.sensores, pasos: true } }));
          if (Date.now() - ultimoGuardado > 10e3) { ultimoGuardado = Date.now(); AsyncStorage.setItem(PASOS_TEL, JSON.stringify({ fecha, pasos: total })).catch(() => {}); }
        });
      } catch {}
    })();
    return () => { vivo = false; sub?.remove(); cambiar(v => ({ sensores: { ...v.sensores, pasos: false } })); };
  }, [c.pasos]);

  // presión de la «cabina» y luz ambiente (la luz solo en Android)
  useEffect(() => {
    if (!movil || !c.cabina) return;
    const subs: { remove: () => void }[] = [];
    let vivo = true;
    (async () => {
      if (await Barometer.isAvailableAsync() && vivo) {
        Barometer.setUpdateInterval(2000);
        subs.push(Barometer.addListener(({ pressure }) => cambiar(v => ({ presion: pressure, seriePresion: empujar(v.seriePresion, pressure, 90), sensores: { ...v.sensores, presion: true } }))));
      }
      if (Platform.OS === 'android' && (await LightSensor.isAvailableAsync()) && vivo) {
        LightSensor.setUpdateInterval(1000);
        subs.push(LightSensor.addListener(({ illuminance }) => cambiar(v => ({ luz: illuminance, serieLuz: empujar(v.serieLuz, illuminance, 90), sensores: { ...v.sensores, luz: true } }))));
      }
    })();
    return () => { vivo = false; subs.forEach(s => s.remove()); cambiar(v => ({ presion: undefined, luz: undefined, seriePresion: [], serieLuz: [], sensores: { ...v.sensores, presion: false, luz: false } })); };
  }, [c.cabina]);

  // batería y carga
  useEffect(() => {
    if (!movil || !c.bateria) return;
    let vivo = true;
    const leerBateria = async () => {
      const [nivel, est] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
      const cargando = est === Battery.BatteryState.CHARGING || est === Battery.BatteryState.FULL;
      if (vivo) cambiar(v => ({ bateria: { nivel, cargando, desdeCarga: cargando ? v.bateria?.desdeCarga ?? Date.now() : undefined } }));
    };
    leerBateria().catch(() => {});
    const s1 = Battery.addBatteryLevelListener(() => { leerBateria().catch(() => {}); });
    const s2 = Battery.addBatteryStateListener(() => { leerBateria().catch(() => {}); });
    return () => { vivo = false; s1.remove(); s2.remove(); cambiar(() => ({ bateria: undefined })); };
  }, [c.bateria]);

  // reloj por Bluetooth
  useEffect(() => {
    if (!c.reloj) { desconectarReloj(); return; }
    if (relojDisponible()) conectarReloj();
    else cambiar(() => ({ reloj: { estado: 'no_disponible' } }));
  }, [c.reloj]);

  // Health Connect y uso del teléfono: cada 5 min y al volver a la app (por ejemplo, desde Ajustes)
  useEffect(() => {
    if (!c.salud && !c.uso) return;
    const todo = () => { if (c.salud) leerSalud(); if (c.uso) leerUso(); };
    todo();
    const id = setInterval(todo, 5 * 60e3);
    const s = AppState.addEventListener('change', e => { if (e === 'active') todo(); });
    return () => { clearInterval(id); s.remove(); };
  }, [c.salud, c.uso]);
  useEffect(() => { if (!c.salud) cambiar(() => ({ salud: undefined })); }, [c.salud]);
  useEffect(() => { if (!c.uso) cambiar(() => ({ uso: undefined })); }, [c.uso]);
  // agenda: cada 5 min y al volver a la app
  useEffect(() => {
    if (!c.agenda) { olvidarAgenda(); return; }
    leerAgenda();
    const id = setInterval(leerAgenda, 5 * 60e3);
    const s = AppState.addEventListener('change', e => { if (e === 'active') leerAgenda(); });
    return () => { clearInterval(id); s.remove(); };
  }, [c.agenda]);
}

/** ruido: una muestra de 5 s cada 5 min, solo el nivel (no se guarda audio). Se salta si estás hablando con NOVA.
    El grabador se crea recién al medir y se libera al terminar: si se creaba al montar la app (como hook en la raíz),
    al volver de la cámara Android a veces recrea la pantalla y el grabador fallaba con «The current activity is no
    longer available», tumbando toda la app («Algo falló»). */
export function useMedidorRuido() {
  const { c } = useConsentimiento();
  useEffect(() => {
    if (!movil || !c.ruido) { cambiar(() => ({ ruido: undefined, serieRuido: [] })); return; }
    let vivo = true;
    const muestra = async () => {
      if (!vivo || leer().vozActiva || AppState.currentState !== 'active') return;
      let rec: AudioRecorder | null = null;
      try {
        if (!(await requestRecordingPermissionsAsync()).granted) return;
        // eslint-disable-next-line import/namespace
        rec = new AudioModule.AudioRecorder(createRecordingOptions({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true }));
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await rec.prepareToRecordAsync();
        rec.record();
        const niveles: number[] = [];
        for (let i = 0; i < 10 && vivo; i++) {
          await new Promise(r => setTimeout(r, 500));
          const m = rec.getStatus().metering;
          if (m !== undefined && m > -160) niveles.push(m);
        }
        await rec.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!niveles.length || !vivo) return;
        // dBFS del micrófono → dB aproximados (sin calibrar: sirve para comparar, no para certificar)
        const db = Math.max(25, Math.min(110, niveles.reduce((a, b) => a + b, 0) / niveles.length + 100));
        cambiar(v => ({ ruido: db, serieRuido: empujar(v.serieRuido, db, 48) }));
      } catch {} finally { try { rec?.release(); } catch {} }
    };
    const primera = setTimeout(muestra, 800);
    const id = setInterval(muestra, 5 * 60e3);
    return () => { vivo = false; clearTimeout(primera); clearInterval(id); };
  }, [c.ruido]);
}
