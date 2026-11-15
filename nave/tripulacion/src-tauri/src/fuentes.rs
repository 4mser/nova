//! De dónde viene cada dato: lo real manda y lo que nadie mide se simula.
//!
//! La tripulación puede ser el propio equipo con su teléfono vinculado a la nave (app NOVA → /v1/lote), la estación
//! física (Arduino con electrodos y lector NFC) o mediciones a mano (/v1/ingreso, tablet con tarjeta). La nave anota
//! la última lectura real de cada tripulante y sensor; el simulador pregunta GET /v1/fuentes y deja de inventar ese
//! sensor mientras siga llegando real. Lo que no tiene sensor (presión, glucosa, temperatura si nadie la mide) sigue
//! simulado, y las pantallas lo dicen.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::Json;
use serde_json::{json, Map, Value};

#[derive(Clone, Default)]
pub struct Fuentes(Arc<Mutex<HashMap<(String, String), (u64, String)>>>);

/// cuánto vale una lectura real antes de volver a simular ese sensor (ms): el check-in es diario, el resto frecuente
pub fn vigencia_ms(sensor: &str) -> u64 {
    match sensor {
        "sueno_h" | "animo" | "energia" | "fc_reposo" => 20 * 3600 * 1000,
        "pa" | "pa_sis" | "pa_dia" | "glucosa" | "temp" => 6 * 3600 * 1000,
        "pasos" => 30 * 60 * 1000,
        _ => 2 * 60 * 1000,
    }
}

impl Fuentes {
    pub fn anotar(&self, trip: &str, sensor: &str, fuente: &str, t_ms: u64) {
        let fuente: String = fuente.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(30).collect();
        if let Ok(mut m) = self.0.lock() {
            m.insert((trip.to_string(), sensor.to_string()), (t_ms, if fuente.is_empty() { "manual".into() } else { fuente }));
        }
    }
}

/// GET /v1/fuentes → {"T1": {"pulso": {"fuente": "nova-movil", "hace_s": 4, "vigente": true}, …}, …}
pub async fn ver(State(nave): State<crate::Nave>) -> Json<Value> {
    let ahora = crate::ahora_ms();
    let mut out = Map::new();
    if let Ok(m) = nave.fuentes.0.lock() {
        for ((trip, sensor), (t, fuente)) in m.iter() {
            let hace = ahora.saturating_sub(*t);
            let e = out.entry(trip.clone()).or_insert_with(|| json!({}));
            e[sensor] = json!({ "fuente": fuente, "hace_s": hace / 1000, "vigente": hace < vigencia_ms(sensor) });
        }
    }
    Json(Value::Object(out))
}
