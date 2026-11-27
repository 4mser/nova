//! Espejo multicámara del gemelo. Cada cámara (el computador o un teléfono en camara.html) corre MediaPipe Pose en su
//! propio equipo y manda solo los 33 puntos del cuerpo en metros (nunca la imagen). La nave los reparte a la pantalla
//! del gemelo, que estima la orientación de cada cámara alineando los esqueletos y los funde en uno solo.
//! Se usa un canal broadcast (no watch) para que una cámara no tape los cuadros de otra.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

#[derive(Clone)]
pub struct Espejo {
    tx: broadcast::Sender<Arc<String>>,
    camaras: Arc<Mutex<HashMap<String, (Instant, Value)>>>,
}

impl Espejo {
    pub fn nuevo() -> Self {
        let (tx, _) = broadcast::channel(256);
        Espejo { tx, camaras: Arc::new(Mutex::new(HashMap::new())) }
    }
}

fn limpiar(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect()
}

/// Una vista de una cámara: { cam, nombre, w: [[x,y,z,visibilidad] × 33] } en las coordenadas de mundo de MediaPipe.
pub async fn vista(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let cam = limpiar(c["cam"].as_str().unwrap_or(""));
    if cam.is_empty() {
        return (StatusCode::BAD_REQUEST, "falta cam").into_response();
    }
    let n = c["w"].as_array().map(|a| a.len()).unwrap_or(0);
    if n != 0 && n != 33 {
        return (StatusCode::BAD_REQUEST, "w debe traer 33 puntos").into_response();
    }
    let nombre: String = c["nombre"].as_str().unwrap_or("Camera").chars().take(40).collect();
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    if let Ok(mut v) = nave.espejo.camaras.lock() {
        v.insert(cam.clone(), (Instant::now(), json!({ "cam": cam, "nombre": nombre, "persona": n == 33 })));
        v.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(10));
    }
    let m = json!({ "cam": cam, "nombre": nombre, "w": c["w"], "recibido": ms });
    let _ = nave.espejo.tx.send(Arc::new(m.to_string()));
    Json(json!({ "ok": true })).into_response()
}

pub async fn flujo(State(nave): State<crate::Nave>) -> Response {
    let rx = nave.espejo.tx.subscribe();
    // si la pantalla se atrasa se saltan cuadros viejos (Lagged) en vez de cortar el flujo
    let s = BroadcastStream::new(rx)
        .filter_map(|m| m.ok())
        .map(|m| Ok::<_, std::convert::Infallible>(Event::default().data(m.as_str())));
    Sse::new(s).keep_alive(KeepAlive::default()).into_response()
}

pub async fn camaras(State(nave): State<crate::Nave>) -> Json<Value> {
    let l: Vec<Value> = nave.espejo.camaras.lock().map(|v| v.values().filter(|(t, _)| t.elapsed() < Duration::from_secs(4)).map(|(t, r)| {
        let mut r = r.clone();
        r["hace_ms"] = json!(t.elapsed().as_millis() as u64);
        r
    }).collect()).unwrap_or_default();
    Json(json!({ "camaras": l, "https": crate::escaner::PUERTO_SEGURO, "ips": crate::escaner::ips_locales() }))
}
