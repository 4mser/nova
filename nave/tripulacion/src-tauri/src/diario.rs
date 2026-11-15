//! El diario de cada persona real (check-in de ánimo y energía, y horas de sueño), día por día, tal como lo compartió
//! desde su app NOVA. Va aparte del historial del núcleo porque ese registra cada valor cuando llega: un día pasado
//! que manda el teléfono quedaría con la fecha de hoy. Cada día guarda el nombre de quien lo escribió, para que si
//! otra persona ocupa el asiento no herede la semana de la anterior. ~/.nova-pc/diario.json
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};

type Dias = BTreeMap<String, Map<String, Value>>; // fecha AAAA-MM-DD → {animo, energia, sueno_h, nombre, t}

fn archivo() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default().join(".nova-pc").join("diario.json")
}
fn datos() -> &'static Mutex<HashMap<String, Dias>> {
    static D: OnceLock<Mutex<HashMap<String, Dias>>> = OnceLock::new();
    D.get_or_init(|| Mutex::new(std::fs::read_to_string(archivo()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()))
}
/// diferencia horaria del computador de la nave (segundos), para fechar el check-in de hoy en hora local
fn desfase() -> i64 {
    static O: OnceLock<i64> = OnceLock::new();
    *O.get_or_init(|| {
        let s = std::process::Command::new("date").arg("+%z").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        if s.len() != 5 { return 0; }
        let signo = if s.starts_with('-') { -1 } else { 1 };
        let h: i64 = s[1..3].parse().unwrap_or(0);
        let m: i64 = s[3..5].parse().unwrap_or(0);
        signo * (h * 3600 + m * 60)
    })
}
fn hoy() -> String {
    crate::historia::dia_de((crate::ahora_seg() as i64 + desfase()).max(0) as u64)
}
fn fecha_valida(f: &str) -> bool {
    f.len() == 10 && f.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}
fn valor(k: &str, v: &Value) -> Option<f64> {
    let x = v.as_f64()?;
    let ok = match k { "animo" | "energia" => (1.0..=5.0).contains(&x), "sueno_h" => (0.0..=16.0).contains(&x), _ => false };
    ok.then_some(x)
}

/// Llamado desde /v1/lote: guarda el diario que manda la app (últimos días) y el check-in de hoy que llega como medición.
pub fn anotar_lote(trip: &str, nombre: &str, c: &Value) {
    if nombre.is_empty() { return; }
    let mut cambios: Vec<(String, &str, f64)> = vec![];
    if let Some(dias) = c["diario"].as_array() {
        for d in dias.iter().take(31) {
            let Some(f) = d["fecha"].as_str().filter(|f| fecha_valida(f)) else { continue };
            for k in ["animo", "energia", "sueno_h"] {
                if let Some(x) = valor(k, &d[k]) { cambios.push((f.to_string(), k, x)); }
            }
        }
    }
    if let Some(ms) = c["mediciones"].as_array() {
        let h = hoy();
        for m in ms {
            let Some(k) = m["sensor"].as_str().filter(|k| matches!(*k, "animo" | "energia" | "sueno_h")) else { continue };
            if let Some(x) = valor(k, &m["valor"]) { cambios.push((h.clone(), k, x)); }
        }
    }
    if cambios.is_empty() { return; }
    let Ok(mut d) = datos().lock() else { return };
    let p = d.entry(trip.to_string()).or_default();
    for (f, k, x) in cambios {
        let dia = p.entry(f).or_default();
        if dia.get("nombre").and_then(Value::as_str) != Some(nombre) { dia.clear(); } // otro dueño: el día se reescribe
        dia.insert("nombre".into(), json!(nombre));
        dia.insert(k.into(), json!(x));
        dia.insert("t".into(), json!(crate::ahora_ms()));
    }
    while p.len() > 60 { let primero = p.keys().next().cloned().unwrap(); p.remove(&primero); }
    if let Some(dir) = archivo().parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(archivo(), serde_json::to_string(&*d).unwrap_or_default());
}

/// GET /v1/diario?trip=T1 → los días de quien ocupa hoy ese asiento
pub async fn ver(State(nave): State<crate::Nave>, Query(q): Query<HashMap<String, String>>) -> Response {
    let trip = q.get("trip").cloned().unwrap_or_default();
    let nombre = nave.crew.lista().into_iter().find(|c| c["id"] == trip.as_str()).and_then(|c| c["nombre"].as_str().map(String::from)).unwrap_or_default();
    let dias: Vec<Value> = datos().lock().ok().and_then(|d| d.get(&trip).cloned()).unwrap_or_default().into_iter()
        .filter(|(_, v)| v.get("nombre").and_then(Value::as_str) == Some(nombre.as_str()))
        .map(|(f, mut v)| { v.insert("fecha".into(), json!(f)); v.remove("nombre"); Value::Object(v) }).collect();
    Json(json!({"trip": trip, "hoy": hoy(), "dias": dias})).into_response()
}
