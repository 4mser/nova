//! Puente con el sistema de tierra de F Prime (fprime-gds, JPL/NASA) para mostrar el núcleo de vuelo con la interfaz
//! de NOVA en vez de la consola técnica.
//!
//! · Lee cada segundo los eventos, la telemetría y el historial de comandos (API REST del GDS, sesión propia) y los
//!   traduce con los diccionarios del propio despliegue (nombres, componentes, severidad, descripciones).
//! · Cola de subida: un comando que sale desde la Tierra viaja con el retraso real de la luz (calculado por /v1/mision)
//!   y recién entonces se entrega al núcleo por el GDS (CCSDS sobre TCP). Cada comando queda con su estado.

use std::collections::{HashMap, VecDeque};

use serde_json::{json, Value};

pub const GDS_DEFECTO: &str = "http://127.0.0.1:5080";
const SESION: &str = "nova-enlace";
const MAX_EVENTOS: usize = 400;

#[derive(Default)]
pub struct Tierra {
    pub url: String,
    dic_eventos: HashMap<u64, Value>,
    dic_canales: HashMap<u64, Value>,
    pub dic_comandos: HashMap<String, Value>,
    eventos: VecDeque<Value>,
    canales: HashMap<String, Value>,
    comandos: VecDeque<Value>,
    pub ultimo_contacto: u64, // ms del último paquete de telemetría
    subida: Vec<Value>,      // comandos en vuelo (Tierra → nave) y entregados
    contador: u64,
}

fn severidad(v: &Value) -> String {
    // el GDS la da como "EventSeverity.WARNING_HI" o similar
    let s = v["severity"]["value"].as_str().or(v["severity"].as_str()).unwrap_or("").rsplit('.').next().unwrap_or("").to_string();
    if s.is_empty() { "ACTIVITY_LO".into() } else { s }
}

impl Tierra {
    pub fn nuevo(url: String) -> Tierra {
        Tierra { url, ..Default::default() }
    }

    pub fn diccionarios_cargados(&self) -> bool {
        !self.dic_canales.is_empty() && !self.dic_eventos.is_empty()
    }

    pub fn cargar_diccionarios(&mut self, eventos: &Value, canales: &Value, comandos: &Value) {
        let mapa = |v: &Value| -> HashMap<u64, Value> {
            v["dictionary"].as_object().map(|o| o.iter().filter_map(|(k, x)| k.parse().ok().map(|id| (id, x.clone()))).collect()).unwrap_or_default()
        };
        self.dic_eventos = mapa(eventos);
        self.dic_canales = mapa(canales);
        self.dic_comandos = comandos["dictionary"].as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
    }

    /// Eventos nuevos del GDS → traducidos; devuelve los nuevos para reenviarlos a las pantallas
    pub fn recibir_eventos(&mut self, h: &Value) -> Vec<Value> {
        let mut nuevos = vec![];
        for e in h["history"].as_array().cloned().unwrap_or_default() {
            let id = e["id"].as_u64().unwrap_or(0);
            let d = self.dic_eventos.get(&id).cloned().unwrap_or(Value::Null);
            let t = e["time"]["seconds"].as_u64().unwrap_or(0) * 1000 + e["time"]["microseconds"].as_u64().unwrap_or(0) / 1000;
            let ev = json!({
                "t": t, "id": id,
                "nombre": d["name"].as_str().unwrap_or("?"),
                "componente": d["comp_name"].as_str().unwrap_or("?"),
                "severidad": severidad(&d),
                "texto": e["display_text"].as_str().map(String::from).unwrap_or_else(|| e["display_text"].to_string()),
                "descripcion": d["description"],
            });
            self.eventos.push_back(ev.clone());
            if self.eventos.len() > MAX_EVENTOS {
                self.eventos.pop_front();
            }
            nuevos.push(ev);
        }
        nuevos
    }

    pub fn recibir_canales(&mut self, h: &Value, ahora: u64) {
        for c in h["history"].as_array().cloned().unwrap_or_default() {
            let id = c["id"].as_u64().unwrap_or(0);
            let Some(d) = self.dic_canales.get(&id) else { continue };
            let nombre = d["full_name"].as_str().unwrap_or("?").to_string();
            let t = c["time"]["seconds"].as_u64().unwrap_or(0);
            self.canales.insert(nombre, json!({"t": t, "valor": c["val"], "texto": c["display_text"], "descripcion": d["ch_desc"], "componente": d["comp_name"]}));
            self.ultimo_contacto = ahora;
        }
    }

    pub fn recibir_comandos(&mut self, h: &Value) {
        for c in h["history"].as_array().cloned().unwrap_or_default() {
            self.comandos.push_back(c);
            if self.comandos.len() > 100 {
                self.comandos.pop_front();
            }
        }
    }

    // ------------------------------------------------------------ subida con retraso de la luz

    pub fn encolar(&mut self, nombre: &str, argumentos: Vec<String>, motivo: &str, ahora: u64, luz_ms: u64) -> Result<Value, String> {
        if !self.dic_comandos.contains_key(nombre) {
            return Err(format!("{nombre} no es un comando de esta nave"));
        }
        self.contador += 1;
        let c = json!({
            "id": format!("u{ahora:x}{:02x}", self.contador % 256), "nombre": nombre, "argumentos": argumentos, "motivo": motivo,
            "enviado": ahora, "llega": ahora + luz_ms, "luz_ms": luz_ms, "estado": "en_vuelo",
        });
        self.subida.push(c.clone());
        Ok(c)
    }

    /// Los comandos que ya llegaron a la nave (para entregarlos al núcleo)
    pub fn por_entregar(&mut self, ahora: u64) -> Vec<Value> {
        let mut out = vec![];
        for c in self.subida.iter_mut().filter(|c| c["estado"] == "en_vuelo" && c["llega"].as_u64().unwrap_or(u64::MAX) <= ahora) {
            c["estado"] = json!("entregando");
            out.push(c.clone());
        }
        out
    }

    pub fn marcar(&mut self, id: &str, estado: &str, detalle: &str) {
        if let Some(c) = self.subida.iter_mut().find(|c| c["id"] == id) {
            c["estado"] = json!(estado);
            c["detalle"] = json!(detalle);
        }
    }

    // ------------------------------------------------------------ lectura para las pantallas

    pub fn resumen(&self, ahora: u64) -> Value {
        let mut canales: Vec<(&String, &Value)> = self.canales.iter().collect();
        canales.sort_by(|a, b| a.0.cmp(b.0));
        json!({
            "nucleo": {
                "en_linea": self.ultimo_contacto > 0 && ahora.saturating_sub(self.ultimo_contacto) < 5000,
                "ultimo_contacto": self.ultimo_contacto,
                "eventos_conocidos": self.dic_eventos.len(),
                "canales_conocidos": self.dic_canales.len(),
                "comandos_conocidos": self.dic_comandos.len(),
                "gds": self.url,
            },
            "eventos": self.eventos.iter().rev().take(200).collect::<Vec<_>>(),
            "canales": canales.into_iter().map(|(k, v)| { let mut v = v.clone(); v["nombre"] = json!(k); v }).collect::<Vec<_>>(),
            "comandos": self.comandos.iter().rev().take(40).collect::<Vec<_>>(),
            "subida": self.subida.iter().rev().take(40).collect::<Vec<_>>(),
        })
    }

    pub fn sesion() -> &'static str {
        SESION
    }
}
