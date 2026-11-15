//! La tripulación de la nave: cuatro asientos (T1–T4) que ocupan personas reales.
//!
//! El archivo ui/tripulacion.json trae la tripulación de demostración (nombres ficticios). Cuando un teléfono con la
//! app NOVA se vincula a un asiento, manda junto a sus lecturas quién es ({"persona": {"nombre", "pronombre"}}) y
//! la nave pone a esa persona en el asiento: NOVA la llama por su nombre, la estación, la tablet y la app la muestran,
//! y el gemelo elige la anatomía por sus pronombres. Se guarda en ~/.nova-pc/tripulacion.json y sobrevive reinicios.
//!
//! · GET  /tripulacion.json  → la tripulación vigente (reemplaza al archivo fijo; lo leen todas las pantallas)
//! · POST /v1/tripulacion    → cambiar a mano un asiento ({trip, nombre, pronombre, rol}) o liberarlo ({trip, liberar})

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Clone)]
pub struct Tripulacion {
    base: Arc<Vec<Value>>,
    propia: Arc<RwLock<HashMap<String, Value>>>,
}

fn archivo() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default().join(".nova-pc").join("tripulacion.json")
}

fn limpio(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>' | '"' | '\\')).collect::<String>().trim().chars().take(n).collect()
}

fn iniciales(nombre: &str) -> String {
    let p: Vec<&str> = nombre.split_whitespace().collect();
    match p.as_slice() {
        [] => "?".into(),
        [uno] => uno.chars().take(2).collect::<String>().to_uppercase(),
        [a, .., z] => format!("{}{}", a.chars().next().unwrap_or('?'), z.chars().next().unwrap_or('?')).to_uppercase(),
    }
}

/// she/her · he/him · they/them (cualquier otra cosa queda como they/them)
fn pronombre(s: &str) -> &'static str {
    let s = s.trim().to_lowercase();
    if s.starts_with("she") || s.starts_with("ella") { "she/her" } else if s.starts_with("he") || s.starts_with("él") || s.starts_with("el/") { "he/him" } else { "they/them" }
}

impl Tripulacion {
    pub fn cargar(carpeta_ui: &std::path::Path) -> Self {
        let base = crate::nova::tripulacion(carpeta_ui);
        let propia = std::fs::read_to_string(archivo()).ok().and_then(|s| serde_json::from_str::<HashMap<String, Value>>(&s).ok()).unwrap_or_default();
        Tripulacion { base: Arc::new(base), propia: Arc::new(RwLock::new(propia)) }
    }

    /// la tripulación vigente: la de demostración con cada asiento ocupado por quien se vinculó
    /// Si al menos un asiento lo ocupa alguien real, los demás quedan «vacio»: las pantallas no los muestran, NOVA no
    /// habla de ellos y el simulador no les inventa datos. Sin nadie real, se ve la tripulación de demostración entera.
    pub fn lista(&self) -> Vec<Value> {
        let propia = self.propia.read().map(|p| p.clone()).unwrap_or_default();
        let hay_real = self.base.iter().any(|b| b["id"].as_str().map(|id| propia.contains_key(id)).unwrap_or(false));
        self.base.iter().map(|b| {
            let mut c = b.clone();
            if let Some(p) = b["id"].as_str().and_then(|id| propia.get(id)) {
                for k in ["nombre", "corto", "rol", "ini", "pronombre", "desde", "mente"] {
                    if !p[k].is_null() { c[k] = p[k].clone(); }
                }
                c["real"] = json!(true);
                // los pronombres del asiento de demostración no son de esta persona
                if p["pronombre"].is_null() { c["pronombre"] = json!("they/them"); }
            } else if hay_real {
                c["vacio"] = json!(true);
            }
            c
        }).collect()
    }

    fn guardar(&self) {
        if let Ok(p) = self.propia.read() {
            let f = archivo();
            if let Some(d) = f.parent() { let _ = std::fs::create_dir_all(d); }
            let _ = std::fs::write(&f, serde_json::to_string_pretty(&*p).unwrap_or_default());
        }
    }

    /// un teléfono vinculado dice quién es; devuelve true si el asiento cambió
    pub fn reclamar(&self, trip: &str, persona: &Value) -> bool {
        let nombre = limpio(persona["nombre"].as_str().unwrap_or(""), 60);
        if nombre.is_empty() || !self.base.iter().any(|b| b["id"].as_str() == Some(trip)) {
            return false;
        }
        let corto = nombre.split_whitespace().next().unwrap_or(&nombre).to_string();
        let mut nuevo = json!({ "nombre": nombre, "corto": corto, "ini": iniciales(&nombre) });
        // pronombres: los que mande la persona; si no manda, se conservan los que ya tenía el asiento
        if let Some(pr) = persona["pronombre"].as_str().filter(|x| !x.trim().is_empty()) { nuevo["pronombre"] = json!(pronombre(pr)); }
        // permiso para mostrar su constelación (ánimo, sueño y energía de la semana): «Compartir mi día» en su app
        if let Some(m) = persona["mente"].as_bool() { nuevo["mente"] = json!(m); }
        let rol = limpio(persona["rol"].as_str().unwrap_or(""), 40);
        if !rol.is_empty() { nuevo["rol"] = json!(rol); }
        let Ok(mut p) = self.propia.write() else { return false };
        let antes = p.get(trip).cloned().unwrap_or(Value::Null);
        let igual = ["nombre", "pronombre", "rol", "mente"].iter().all(|k| nuevo[*k].is_null() || antes[*k] == nuevo[*k]);
        if igual { return false; }
        for k in ["rol", "pronombre", "mente"] { if !antes[k].is_null() && nuevo[k].is_null() { nuevo[k] = antes[k].clone(); } }
        nuevo["desde"] = json!(crate::ahora_ms());
        p.insert(trip.to_string(), nuevo);
        drop(p);
        self.guardar();
        true
    }

    fn liberar(&self, trip: &str) -> bool {
        let cambio = self.propia.write().map(|mut p| p.remove(trip).is_some()).unwrap_or(false);
        if cambio { self.guardar(); }
        cambio
    }
}

pub async fn ver(State(nave): State<crate::Nave>) -> Response {
    ([("cache-control", "no-cache")], Json(Value::Array(nave.crew.lista()))).into_response()
}

pub async fn cambiar(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let trip = c["trip"].as_str().unwrap_or("");
    if !crate::trip_valido(trip) || trip == "CABINA" {
        return (StatusCode::BAD_REQUEST, "trip inválido").into_response();
    }
    let cambio = if c["liberar"].as_bool() == Some(true) { nave.crew.liberar(trip) } else { nave.crew.reclamar(trip, &c) };
    if cambio { avisar(&nave); }
    Json(json!({ "ok": true, "cambio": cambio, "tripulacion": nave.crew.lista() })).into_response()
}

/// las pantallas abiertas se enteran al tiro (vuelven a pedir /tripulacion.json)
pub fn avisar(nave: &crate::Nave) {
    let _ = nave.tx.send(json!({ "tipo": "tripulacion" }).to_string());
}
