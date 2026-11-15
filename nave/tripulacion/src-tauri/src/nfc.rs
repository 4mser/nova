//! Tarjetas NFC de la tripulación y sesiones en NOVA Station (la tablet común de la nave).
//!
//! La tablet es de todos: muestra lo que la tripulación comparte. Cuando un astronauta acerca su tarjeta al lector, la
//! nave abre una sesión a su nombre en ese lector y la tablet pasa a su espacio personal (su salud, su check-in, sus
//! mensajes de casa, NOVA con su contexto y acciones que quedan firmadas con su nombre). La sesión se cierra al volver a
//! acercar la tarjeta, con «Salir» o tras 2 minutos sin uso.
//!
//! · POST /v1/nfc               → el lector externo (o la tablet, si el lector escribe como teclado) avisa un UID
//! · GET  /v1/sesion?lector=…   → la sesión abierta en ese lector (o la tarjeta nueva que espera dueño)
//! · POST /v1/sesion/asignar    → la tarjeta nueva queda a nombre de un tripulante (solo la que el lector acaba de leer)
//! · POST /v1/sesion/cerrar     → salir
//! · POST /v1/sesion/accion     → check-in, medición, respuesta a casa, uso del kit: siempre a nombre de quien tiene la sesión
//!
//! Las tarjetas viven en ~/.nova-pc/tarjetas.json ({"04A1B2C3": "T1"}). Cada apertura, cierre y acción queda en la
//! historia de la nave (tipo «sesiones») para el cirujano de vuelo.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

/// sin uso por este tiempo, la sesión se cierra sola
const VENCE: Duration = Duration::from_secs(120);
/// una tarjeta nueva espera dueño este tiempo
const PENDIENTE: Duration = Duration::from_secs(60);
/// dos lecturas de la misma tarjeta dentro de este tiempo son una sola (el lector repite mientras la tarjeta está cerca)
const REBOTE: Duration = Duration::from_millis(2500);

struct Sesion {
    trip: String,
    token: String,
    desde: Instant,
    ultimo: Instant,
}

#[derive(Default)]
struct Estado {
    tarjetas: HashMap<String, String>,
    sesiones: HashMap<String, Sesion>,          // lector → sesión
    pendientes: HashMap<String, (String, Instant)>, // lector → tarjeta sin dueño
    lecturas: HashMap<String, (String, Instant)>,   // lector → última tarjeta leída (rebote)
    vinculando: HashMap<String, (String, Instant)>, // lector → tripulante que pidió «vincular la próxima tarjeta»
    qr: HashMap<String, (String, Instant)>,         // código QR de un solo uso → tripulante
}

/// un QR personal vale este tiempo (la app lo cambia antes) y una sola vez
const QR_VALE: Duration = Duration::from_secs(60);
/// «Link a card» espera la tarjeta este tiempo
const VINCULAR: Duration = Duration::from_secs(45);

#[derive(Clone)]
pub struct Nfc(Arc<Mutex<Estado>>);

fn archivo() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default().join(".nova-pc").join("tarjetas.json")
}

impl Nfc {
    pub fn cargar() -> Self {
        let tarjetas = std::fs::read_to_string(archivo()).ok().and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok()).unwrap_or_default();
        Nfc(Arc::new(Mutex::new(Estado { tarjetas, ..Default::default() })))
    }
}

fn guardar(t: &HashMap<String, String>) {
    let f = archivo();
    if let Some(d) = f.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(&f, serde_json::to_string_pretty(t).unwrap_or_default());
}

/// UID tal como lo imprimen los lectores («04:a1:b2:c3», «04 A1 B2 C3», «04a1b2c3») → «04A1B2C3»
fn normalizar_uid(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_hexdigit()).map(|c| c.to_ascii_uppercase()).take(32).collect()
}

/// «nova:T1», «NOVA:t3» o un link que termine en «nova:T2» → «T1»… (lo que se escribe en la tarjeta como texto NDEF)
fn tarjeta_escrita(s: &str) -> Option<String> {
    let s = s.trim().to_ascii_uppercase();
    let i = s.rfind("NOVA:")?;
    let t: String = s[i + 5..].chars().take(2).collect();
    (t.len() == 2 && t.starts_with('T') && matches!(t.as_bytes()[1], b'1'..=b'4')).then_some(t)
}

fn normalizar_lector(s: Option<&str>) -> String {
    let l: String = s.unwrap_or("station").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    if l.is_empty() { "station".into() } else { l }
}

fn token_nuevo() -> String {
    let mut b = [0u8; 16];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut b)).is_ok();
    if !ok {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        b = n.to_le_bytes();
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn persona(nave: &crate::Nave, trip: &str) -> Value {
    nave.crew.lista().into_iter().find(|c| c["id"].as_str() == Some(trip)).unwrap_or_else(|| json!({ "id": trip }))
}

fn anotar(nave: &crate::Nave, v: Value) {
    if let Ok(h) = nave.historia.lock() {
        h.registrar("sesiones", crate::ahora_seg(), &v);
    }
}

/// lo que la tablet necesita saber del lector (sin el token: ese solo va en GET /v1/sesion)
fn aviso(nave: &crate::Nave, lector: &str, e: &Estado) -> Value {
    let s = e.sesiones.get(lector);
    json!({
        "tipo": "sesion", "lector": lector,
        "trip": s.map(|s| s.trip.clone()),
        "nombre": s.map(|s| persona(nave, &s.trip)["nombre"].clone()),
        "pendiente": e.pendientes.get(lector).map(|_| true).unwrap_or(false),
    })
}

fn avisar(nave: &crate::Nave, lector: &str, e: &Estado) {
    let _ = nave.tx.send(aviso(nave, lector, e).to_string());
}

/// cierra lo que venció (se llama en cada consulta: la tablet pregunta cada pocos segundos)
fn vencer(nave: &crate::Nave, e: &mut Estado) {
    let vencidas: Vec<String> = e.sesiones.iter().filter(|(_, s)| s.ultimo.elapsed() > VENCE).map(|(l, _)| l.clone()).collect();
    for l in vencidas {
        if let Some(s) = e.sesiones.remove(&l) {
            anotar(nave, json!({"t": crate::ahora_seg(), "lector": l, "trip": s.trip, "evento": "vence", "min": s.desde.elapsed().as_secs() / 60}));
            avisar(nave, &l, e);
        }
    }
    e.pendientes.retain(|_, (_, t)| t.elapsed() < PENDIENTE);
    e.qr.retain(|_, (_, t)| t.elapsed() < QR_VALE);
    e.vinculando.retain(|_, (_, t)| t.elapsed() < VINCULAR);
}

fn abrir(nave: &crate::Nave, e: &mut Estado, lector: &str, trip: &str) {
    let ahora = Instant::now();
    e.sesiones.insert(lector.to_string(), Sesion { trip: trip.to_string(), token: token_nuevo(), desde: ahora, ultimo: ahora });
    e.pendientes.remove(lector);
    anotar(nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": trip, "evento": "entra"}));
    avisar(nave, lector, e);
}

/// {"uid":"04:A1:B2:C3","lector":"station"} desde el lector externo; también desde la tablet si el lector escribe como teclado
pub async fn leer(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let crudo = c["uid"].as_str().or(c["texto"].as_str()).unwrap_or("");
    // tarjeta escrita para NOVA (registro NDEF de texto «nova:T1»): ya dice de quién es, no hace falta registrarla
    let escrita = tarjeta_escrita(crudo);
    let uid = escrita.as_ref().map(|t| format!("NOVA-{t}")).unwrap_or_else(|| normalizar_uid(crudo));
    if let Some(t) = &escrita {
        if let Ok(mut e) = nave.nfc.0.lock() {
            if e.tarjetas.get(&uid) != Some(t) { e.tarjetas.insert(uid.clone(), t.clone()); guardar(&e.tarjetas); }
        }
    }
    if uid.len() < 4 {
        return (StatusCode::BAD_REQUEST, "uid inválido").into_response();
    }
    let lector = normalizar_lector(c["lector"].as_str());
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    vencer(&nave, &mut e);
    if let Some((u, t)) = e.lecturas.get(&lector) {
        if *u == uid && t.elapsed() < REBOTE {
            return Json(json!({"ok": true, "repetida": true})).into_response();
        }
    }
    e.lecturas.insert(lector.clone(), (uid.clone(), Instant::now()));
    if let Some((trip, t)) = e.vinculando.remove(&lector) {
        if t.elapsed() < VINCULAR {
            let antes = e.tarjetas.insert(uid.clone(), trip.clone());
            guardar(&e.tarjetas);
            anotar(&nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": trip, "evento": "tarjeta", "uid": uid, "antes": antes}));
            let _ = nave.tx.send(json!({"tipo": "sesion", "lector": lector, "vinculada": trip}).to_string());
            return Json(json!({"ok": true, "vinculada": trip})).into_response();
        }
    }
    match e.tarjetas.get(&uid).cloned() {
        Some(trip) => {
            // la misma persona vuelve a acercar su tarjeta: sale
            if e.sesiones.get(&lector).map(|s| s.trip == trip).unwrap_or(false) {
                if let Some(s) = e.sesiones.remove(&lector) {
                    anotar(&nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": s.trip, "evento": "sale", "min": s.desde.elapsed().as_secs() / 60}));
                }
                avisar(&nave, &lector, &e);
                return Json(json!({"ok": true, "trip": trip, "sesion": "cerrada"})).into_response();
            }
            abrir(&nave, &mut e, &lector, &trip);
            Json(json!({"ok": true, "trip": trip, "sesion": "abierta"})).into_response()
        }
        None => {
            e.pendientes.insert(lector.clone(), (uid.clone(), Instant::now()));
            avisar(&nave, &lector, &e);
            Json(json!({"ok": true, "nueva": true})).into_response()
        }
    }
}

/// GET /v1/sesion?lector=station → quién está y su token (la tablet lo usa en cada acción personal)
pub async fn ver(State(nave): State<crate::Nave>, Query(q): Query<HashMap<String, String>>) -> Response {
    let lector = normalizar_lector(q.get("lector").map(String::as_str));
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    vencer(&nave, &mut e);
    let mut v = aviso(&nave, &lector, &e);
    if let Some(s) = e.sesiones.get(&lector) {
        v["persona"] = persona(&nave, &s.trip);
        v["token"] = json!(s.token);
        v["quedan_s"] = json!(VENCE.saturating_sub(s.ultimo.elapsed()).as_secs());
    }
    v["tarjetas"] = json!(e.tarjetas.len());
    Json(v).into_response()
}

/// {"lector":"station","trip":"T1"}: la tarjeta que el lector acaba de leer queda a nombre de T1 y se abre su sesión
pub async fn asignar(State(nave): State<crate::Nave>, Json(c): Json<Value>) -> Response {
    let lector = normalizar_lector(c["lector"].as_str());
    let trip = c["trip"].as_str().unwrap_or("");
    if !crate::trip_valido(trip) || trip == "CABINA" {
        return (StatusCode::BAD_REQUEST, "trip inválido").into_response();
    }
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    vencer(&nave, &mut e);
    let Some((uid, _)) = e.pendientes.remove(&lector) else {
        return (StatusCode::CONFLICT, "no hay una tarjeta nueva esperando en ese lector").into_response();
    };
    e.tarjetas.insert(uid.clone(), trip.to_string());
    guardar(&e.tarjetas);
    anotar(&nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": trip, "evento": "tarjeta", "uid": uid}));
    abrir(&nave, &mut e, &lector, trip);
    Json(json!({"ok": true})).into_response()
}

pub async fn cerrar(State(nave): State<crate::Nave>, Json(c): Json<Value>) -> Response {
    let token = c["token"].as_str().unwrap_or("");
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    let lector = e.sesiones.iter().find(|(_, s)| s.token == token).map(|(l, _)| l.clone());
    match lector {
        Some(l) => {
            if let Some(s) = e.sesiones.remove(&l) {
                anotar(&nave, json!({"t": crate::ahora_seg(), "lector": l, "trip": s.trip, "evento": "sale", "min": s.desde.elapsed().as_secs() / 60}));
            }
            avisar(&nave, &l, &e);
            Json(json!({"ok": true})).into_response()
        }
        None => (StatusCode::NOT_FOUND, "esa sesión ya no está abierta").into_response(),
    }
}

/// la sesión de ese token, renovada; None si venció o no existe
fn quien(nave: &crate::Nave, token: &str) -> Option<(String, String)> {
    let mut e = nave.nfc.0.lock().ok()?;
    vencer(nave, &mut e);
    let (l, s) = e.sesiones.iter_mut().find(|(_, s)| !token.is_empty() && s.token == token)?;
    s.ultimo = Instant::now();
    Some((l.clone(), s.trip.clone()))
}

/// {"token":"…","accion":"checkin"|"medir"|"casa"|"kit"|"seguir","datos":{…}}. El tripulante siempre es el de la sesión:
/// la tablet no puede escribir a nombre de otro.
pub async fn accion(State(nave): State<crate::Nave>, Json(c): Json<Value>) -> Response {
    let Some((lector, trip)) = quien(&nave, c["token"].as_str().unwrap_or("")) else {
        return (StatusCode::UNAUTHORIZED, "la sesión venció: acerca tu tarjeta otra vez").into_response();
    };
    let a = c["accion"].as_str().unwrap_or("");
    let d = &c["datos"];
    // las rutas originales exigen el token de la nave si existe: aquí la autorización ya la dio la tarjeta
    let mut h = HeaderMap::new();
    if let Some(t) = nave.token.as_deref().and_then(|t| HeaderValue::from_str(t).ok()) {
        h.insert("x-nova-token", t);
    }
    let r = match a {
        "seguir" => Json(json!({"ok": true})).into_response(),
        "vincular" => {
            if let Ok(mut e) = nave.nfc.0.lock() { e.vinculando.insert(lector.clone(), (trip.clone(), Instant::now())); }
            Json(json!({"ok": true, "espera_s": VINCULAR.as_secs()})).into_response()
        }
        "no_vincular" => {
            if let Ok(mut e) = nave.nfc.0.lock() { e.vinculando.remove(&lector); }
            Json(json!({"ok": true})).into_response()
        }
        "tarjetas" => {
            let mut e = match nave.nfc.0.lock() { Ok(e) => e, Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
            if d["quitar"].as_bool() == Some(true) { e.tarjetas.retain(|_, t| *t != trip); guardar(&e.tarjetas); }
            let n = e.tarjetas.values().filter(|t| **t == trip).count();
            Json(json!({"ok": true, "tarjetas": n})).into_response()
        }
        "checkin" => {
            let mut m = vec![];
            for (k, u, lo, hi) in [("sueno_h", "h", 0.0, 16.0), ("animo", "1-5", 1.0, 5.0), ("energia", "1-5", 1.0, 5.0)] {
                if let Some(v) = d[k].as_f64().filter(|v| *v >= lo && *v <= hi) {
                    m.push(json!({"sensor": k, "valor": v, "unidad": u, "calidad": 1.0}));
                }
            }
            if m.is_empty() {
                return (StatusCode::BAD_REQUEST, "check-in vacío").into_response();
            }
            crate::lote(State(nave.clone()), h, Json(json!({"trip": trip, "fuente": "station", "mediciones": m}))).await
        }
        "medir" => crate::ingreso(State(nave.clone()), Json(json!({"trip": trip, "sensor": d["sensor"], "valor": d["valor"]}))).await,
        "casa" => crate::casa_respuesta(State(nave.clone()), Json(json!({"trip": trip, "a": d["a"], "texto": d["texto"]}))).await,
        "kit" => crate::kit_uso(State(nave.clone()), Json(json!({"trip": trip, "id": d["id"], "cantidad": d["cantidad"], "nota": d["nota"]}))).await,
        _ => return (StatusCode::BAD_REQUEST, "acción desconocida").into_response(),
    };
    if a != "seguir" {
        anotar(&nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": trip, "evento": "accion", "accion": a, "ok": r.status().is_success()}));
    }
    r
}

#[cfg(test)]
mod pruebas {
    use super::*;
    #[test]
    fn uid_de_cualquier_lector() {
        assert_eq!(normalizar_uid("04:a1:b2:c3"), "04A1B2C3");
        assert_eq!(normalizar_uid(" 04 A1 B2 C3\r\n"), "04A1B2C3");
        assert_eq!(normalizar_lector(Some("station-1!")), "station-1");
        assert_eq!(normalizar_lector(None), "station");
        assert_eq!(token_nuevo().len(), 32);
        assert_eq!(tarjeta_escrita("nova:T1").as_deref(), Some("T1"));
        assert_eq!(tarjeta_escrita(" NOVA:t3\r\n").as_deref(), Some("T3"));
        assert_eq!(tarjeta_escrita("nova:T9"), None);
        assert_eq!(tarjeta_escrita("04:A1:B2"), None);
    }
}

/// POST /v1/qr {"trip":"T1"} desde el teléfono vinculado a ese asiento → un código de un solo uso para mostrar como QR.
/// La app lo pide de nuevo cada 30 s, así una foto del QR deja de servir enseguida.
pub async fn qr_nuevo(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let trip = c["trip"].as_str().unwrap_or("");
    if !crate::trip_valido(trip) || trip == "CABINA" {
        return (StatusCode::BAD_REQUEST, "trip inválido").into_response();
    }
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    vencer(&nave, &mut e);
    // a lo más 3 códigos vivos por persona (el actual y los que todavía pueden estar en pantalla)
    let mut suyos: Vec<(String, Instant)> = e.qr.iter().filter(|(_, (t, _))| t == trip).map(|(k, (_, i))| (k.clone(), *i)).collect();
    suyos.sort_by_key(|(_, i)| *i);
    while suyos.len() >= 3 { let (k, _) = suyos.remove(0); e.qr.remove(&k); }
    let codigo = token_nuevo();
    e.qr.insert(codigo.clone(), (trip.to_string(), Instant::now()));
    Json(json!({"codigo": format!("nova-qr:{codigo}"), "vale_s": QR_VALE.as_secs()})).into_response()
}

/// POST /v1/qr/entrar {"codigo":"nova-qr:…","lector":"station"}: la tablet escaneó un QR personal
pub async fn qr_entrar(State(nave): State<crate::Nave>, Json(c): Json<Value>) -> Response {
    let codigo = c["codigo"].as_str().unwrap_or("").trim().trim_start_matches("nova-qr:").to_string();
    let lector = normalizar_lector(c["lector"].as_str());
    let Ok(mut e) = nave.nfc.0.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    vencer(&nave, &mut e);
    let Some((trip, _)) = e.qr.remove(&codigo) else {
        return (StatusCode::UNAUTHORIZED, "QR vencido o ya usado: abre uno nuevo en tu app").into_response();
    };
    // un código usado invalida los demás de esa persona
    e.qr.retain(|_, (t, _)| *t != trip);
    abrir(&nave, &mut e, &lector, &trip);
    anotar(&nave, json!({"t": crate::ahora_seg(), "lector": lector, "trip": trip, "evento": "qr"}));
    Json(json!({"ok": true, "trip": trip, "sesion": "abierta"})).into_response()
}
