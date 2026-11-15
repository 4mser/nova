//! Revisiones de ojos del escáner (sistema «Eyes»): cada una es la mediana de ~20 s de cámara con la persona quieta
//! (apertura del ojo, párpados, parpadeo, distancia), medida con MediaPipe Face Landmarker según el diseño de visión
//! ocular de Nicolás Richardson (rama computer-vision-ocular del repo del equipo). La nave guarda el historial de cada
//! tripulante en ~/.nova-pc/ojos.json para que el escáner lo compare con su línea base. No es un diagnóstico.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const POR_PERSONA: usize = 120;

fn archivo() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default().join(".nova-pc").join("ojos.json")
}

fn datos() -> &'static Mutex<HashMap<String, Vec<Value>>> {
    static D: OnceLock<Mutex<HashMap<String, Vec<Value>>>> = OnceLock::new();
    D.get_or_init(|| {
        let m = std::fs::read_to_string(archivo()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Mutex::new(m)
    })
}

/// POST /v1/ojos {"trip":"T1","camara":"frontal",…métricas} → guarda la revisión y devuelve el historial de esa persona
pub async fn guardar(State(nave): State<crate::Nave>, h: HeaderMap, Json(mut c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let trip = c["trip"].as_str().unwrap_or("").to_string();
    if !crate::trip_valido(&trip) || trip == "CABINA" || !c.is_object() || c.to_string().len() > 4_000 {
        return (StatusCode::BAD_REQUEST, "revisión inválida").into_response();
    }
    c["t"] = json!(crate::ahora_ms());
    let historial = {
        let Ok(mut d) = datos().lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
        let l = d.entry(trip.clone()).or_default();
        l.push(c.clone());
        if l.len() > POR_PERSONA {
            let sobra = l.len() - POR_PERSONA;
            l.drain(..sobra);
        }
        let h = l.clone();
        if let Some(dir) = archivo().parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(archivo(), serde_json::to_string(&*d).unwrap_or_default());
        h
    };
    let _ = nave.tx.send(json!({"tipo": "ojos", "trip": trip}).to_string());
    Json(json!({"ok": true, "trip": trip, "historial": historial})).into_response()
}

/// GET /v1/ojos?trip=T1 → su historial; sin trip → la última revisión de cada persona (para el gemelo)
pub async fn ver(Query(q): Query<HashMap<String, String>>) -> Response {
    let Ok(d) = datos().lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    match q.get("trip") {
        Some(t) => Json(json!({"trip": t, "historial": d.get(t).cloned().unwrap_or_default()})).into_response(),
        None => {
            let ult: HashMap<&String, &Value> = d.iter().filter_map(|(k, v)| v.last().map(|x| (k, x))).collect();
            Json(json!({"ultimas": ult})).into_response()
        }
    }
}

/// La última revisión de una persona (para el contexto de NOVA)
pub fn ultima(trip: &str) -> Option<Value> {
    datos().lock().ok().and_then(|d| d.get(trip).and_then(|l| l.last().cloned()))
}
