//! Escáner del cuerpo en vivo: el teléfono (o la pantalla) mira a un tripulante con la cámara, NOVA calza la anatomía
//! de referencia sobre su cuerpo y cada cuadro llega a la nave para verse en vivo en NOVA Station.
//!
//! · POST /v1/escaner/cuadro  → el visor manda el cuadro (JPEG chico) + los puntos del cuerpo + qué está mirando
//! · GET  /v1/escaner/flujo   → SSE con el último cuadro de cada visor (sin cola: si una pantalla se atrasa, salta al más nuevo)
//! · GET  /v1/escaner/visores → quién está escaneando ahora
//! · POST /v1/escaner/orden   → la estación cambia lo que muestra un visor (el teléfono va dentro del visor y no se puede
//!                              tocar): la orden espera en la nave y viaja en la respuesta del próximo cuadro de ese visor
//!
//! Además abre el enlace en HTTPS (puerto 8751, certificado propio de la nave guardado en ~/.nova-pc/tls): los
//! navegadores solo dan la cámara a páginas seguras, y el teléfono entra por la red de la nave, no por localhost.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use tokio::sync::watch;
use tokio_stream::wrappers::WatchStream;
use tokio_stream::StreamExt;

pub const PUERTO_SEGURO: u16 = 8751;

#[derive(Clone)]
pub struct Escaner {
    tx: watch::Sender<Arc<String>>,
    visores: Arc<Mutex<HashMap<String, (Instant, Value)>>>,
    /// órdenes de la estación que esperan al próximo cuadro de cada visor (con hora, para botar las viejas)
    ordenes: Arc<Mutex<HashMap<String, Vec<(Instant, Value)>>>>,
}

impl Escaner {
    pub fn nuevo() -> Self {
        let (tx, _) = watch::channel(Arc::new(String::new()));
        Escaner { tx, visores: Arc::new(Mutex::new(HashMap::new())), ordenes: Arc::new(Mutex::new(HashMap::new())) }
    }
}

/// Un cuadro del visor. El JPEG viaja en base64 dentro del JSON; se limita el tamaño para no ahogar la red de la nave.
pub async fn cuadro(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let disp = limpiar_disp(c["disp"].as_str().unwrap_or(""));
    if disp.is_empty() {
        return (StatusCode::BAD_REQUEST, "falta disp").into_response();
    }
    if c["jpg"].as_str().map(|s| s.len()).unwrap_or(0) > 600_000 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "cuadro muy grande").into_response();
    }
    let esc = &nave.escaner;
    let resumen = json!({ "disp": disp, "trip": c["trip"], "nombre": c["nombre"], "modo": c["modo"], "foco": c["foco"], "origen": c["origen"] });
    if let Ok(mut v) = esc.visores.lock() {
        v.insert(disp.clone(), (Instant::now(), resumen));
        v.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(10));
    }
    let mut c = c;
    c["disp"] = json!(disp);
    c["recibido"] = json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0));
    let _ = esc.tx.send(Arc::new(c.to_string()));
    // lo que la estación pidió para este visor, en orden; una orden de más de 10 s ya no corresponde a lo que se ve
    let ordenes: Vec<Value> = esc.ordenes.lock().ok().and_then(|mut o| o.remove(&disp))
        .map(|l| l.into_iter().filter(|(t, _)| t.elapsed() < Duration::from_secs(10)).map(|(_, v)| v).collect()).unwrap_or_default();
    Json(json!({ "ok": true, "ordenes": ordenes })).into_response()
}

fn limpiar_disp(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect()
}

/// La estación manda una orden a un visor: { disp, orden: { tipo, ... } }. El teléfono la aplica al recibir la respuesta
/// de su próximo cuadro (~100 ms) y su estado vuelve en el cuadro siguiente, así la estación ve lo que de verdad cambió.
pub async fn orden(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let disp = limpiar_disp(c["disp"].as_str().unwrap_or(""));
    let o = &c["orden"];
    if disp.is_empty() || !o["tipo"].is_string() {
        return (StatusCode::BAD_REQUEST, "falta disp u orden.tipo").into_response();
    }
    if o.to_string().len() > 2_000 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "orden muy grande").into_response();
    }
    let esc = &nave.escaner;
    let activo = esc.visores.lock().map(|v| v.get(&disp).map(|(t, _)| t.elapsed() < Duration::from_secs(4)).unwrap_or(false)).unwrap_or(false);
    if !activo {
        return (StatusCode::NOT_FOUND, "ese visor no está enviando cuadros").into_response();
    }
    if let Ok(mut m) = esc.ordenes.lock() {
        let l = m.entry(disp).or_default();
        l.retain(|(t, _)| t.elapsed() < Duration::from_secs(10));
        if l.len() >= 32 { l.remove(0); }
        l.push((Instant::now(), o.clone()));
    }
    Json(json!({ "ok": true })).into_response()
}

pub async fn flujo(State(nave): State<crate::Nave>) -> Response {
    let rx = nave.escaner.tx.subscribe();
    let s = WatchStream::new(rx)
        .filter(|m| !m.is_empty())
        .map(|m| Ok::<_, std::convert::Infallible>(Event::default().data(m.as_str())));
    Sse::new(s).keep_alive(KeepAlive::default()).into_response()
}

pub async fn visores(State(nave): State<crate::Nave>) -> Json<Value> {
    let l: Vec<Value> = nave.escaner.visores.lock().map(|v| v.values().filter(|(t, _)| t.elapsed() < Duration::from_secs(4)).map(|(t, r)| {
        let mut r = r.clone();
        r["hace_ms"] = json!(t.elapsed().as_millis() as u64);
        r
    }).collect()).unwrap_or_default();
    Json(json!({ "visores": l, "https": PUERTO_SEGURO, "ips": ips_locales() }))
}

/// IP de la nave en la red local (para armar el enlace del teléfono y el certificado).
pub fn ips_locales() -> Vec<String> {
    let mut l = vec![];
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
        // no manda nada: solo pregunta al sistema qué interfaz usaría
        if s.connect("10.255.255.255:1").is_ok() || s.connect("192.168.255.255:1").is_ok() {
            if let Ok(a) = s.local_addr() {
                if !a.ip().is_loopback() && !a.ip().is_unspecified() { l.push(a.ip().to_string()); }
            }
        }
    }
    l
}

fn carpeta_tls() -> PathBuf {
    let casa = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
    casa.join(".nova-pc").join("tls")
}

/// Certificado propio de la nave (se genera una vez). Incluye localhost y las IP locales de hoy; si cambia la IP se rehace.
fn certificado() -> Result<(Vec<u8>, Vec<u8>), String> {
    let dir = carpeta_tls();
    let (cp, kp, np) = (dir.join("nave.crt"), dir.join("nave.key"), dir.join("nombres.txt"));
    let mut nombres = vec!["localhost".to_string(), "127.0.0.1".to_string(), "nova.local".to_string()];
    nombres.extend(ips_locales());
    let firma = nombres.join(",");
    if let (Ok(c), Ok(k), Ok(n)) = (std::fs::read(&cp), std::fs::read(&kp), std::fs::read_to_string(&np)) {
        if n.trim() == firma { return Ok((c, k)); }
    }
    let ck = rcgen::generate_simple_self_signed(nombres).map_err(|e| e.to_string())?;
    let (c, k) = (ck.cert.pem().into_bytes(), ck.key_pair.serialize_pem().into_bytes());
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&cp, &c);
    let _ = std::fs::write(&kp, &k);
    let _ = std::fs::write(&np, &firma);
    Ok((c, k))
}

/// El mismo enlace, en HTTPS: para el visor del teléfono (la cámara exige página segura).
pub async fn servir_seguro(app: axum::Router) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (c, k) = match certificado() {
        Ok(x) => x,
        Err(e) => { eprintln!("[nova] sin certificado para HTTPS: {e}"); return; }
    };
    let conf = match axum_server::tls_rustls::RustlsConfig::from_pem(c, k).await {
        Ok(c) => c,
        Err(e) => { eprintln!("[nova] HTTPS no disponible: {e}"); return; }
    };
    let dir = std::net::SocketAddr::from(([0, 0, 0, 0], PUERTO_SEGURO));
    println!("[nova] enlace seguro en https://{dir} (visor del escáner en /escaner.html)");
    if let Err(e) = axum_server::bind_rustls(dir, conf).serve(app.into_make_service()).await {
        eprintln!("[nova] no pude abrir el enlace seguro en {dir}: {e}");
    }
}

// ---------------------------------------------------------------------------
// Visión de a bordo: el teléfono manda cuadros y recibe lo que ve el computador de la nave
// ---------------------------------------------------------------------------

const VISION_DEFECTO: &str = "ws://127.0.0.1:8792";

pub async fn vision_ws(ws: axum::extract::ws::WebSocketUpgrade) -> Response {
    ws.max_message_size(4 * 1024 * 1024).on_upgrade(puente_vision)
}

async fn puente_vision(cli: axum::extract::ws::WebSocket) {
    use axum::extract::ws::Message as A;
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message as T;
    let url = std::env::var("NOVA_VISION").unwrap_or_else(|_| VISION_DEFECTO.to_string());
    let (mut c_tx, mut c_rx) = futures_util::StreamExt::split(cli);
    let srv = match tokio_tungstenite::connect_async(url.as_str()).await {
        Ok((s, _)) => s,
        Err(e) => {
            let _ = c_tx.send(A::Text(json!({"tipo": "sin_vision", "error": e.to_string()}).to_string().into())).await;
            return;
        }
    };
    let (mut s_tx, mut s_rx) = futures_util::StreamExt::split(srv);
    let subir = async {
        while let Some(Ok(m)) = futures_util::StreamExt::next(&mut c_rx).await {
            let m = match m {
                A::Binary(b) => T::Binary(b),
                A::Text(t) => T::Text(t.as_str().into()),
                A::Close(_) => break,
                _ => continue,
            };
            if s_tx.send(m).await.is_err() { break; }
        }
    };
    let bajar = async {
        while let Some(Ok(m)) = futures_util::StreamExt::next(&mut s_rx).await {
            let m = match m {
                T::Text(t) => A::Text(t.as_str().into()),
                T::Binary(b) => A::Binary(b),
                T::Close(_) => break,
                _ => continue,
            };
            if c_tx.send(m).await.is_err() { break; }
        }
    };
    tokio::select! { _ = subir => {}, _ = bajar => {} }
}
