//! «Casa»: mensajes de la familia para cada astronauta (fotos y textos) y sus respuestas.
//!
//! La familia envía desde la Tierra; el relevo de Tierra (tierra/casa.py) los sube por el enlace. La nave calcula
//! cuándo llega cada mensaje con el retraso real de la luz en el momento del envío y solo lo muestra desde entonces.
//! Las respuestas del astronauta quedan en una cola de bajada para el próximo contacto con la Tierra.
//! Se guarda en disco (~/.nova-pc/casa): índice JSON + un archivo por foto.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

pub const MAX_ARCHIVO: usize = 3 * 1024 * 1024; // 3 MB por foto ya comprimida

pub struct Casa {
    dir: PathBuf,
    mensajes: Vec<Value>,
    salida: Vec<Value>,
}

impl Casa {
    pub fn cargar() -> Casa {
        let dir = std::env::var("NOVA_CASA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".nova-pc/casa"));
        let _ = fs::create_dir_all(dir.join("archivos"));
        let leer = |n: &str| -> Vec<Value> {
            fs::read_to_string(dir.join(n)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
        };
        let (mensajes, salida) = (leer("mensajes.json"), leer("salida.json"));
        Casa { dir, mensajes, salida }
    }

    fn guardar(&self) {
        let _ = fs::write(self.dir.join("mensajes.json"), serde_json::to_string_pretty(&self.mensajes).unwrap_or_default());
        let _ = fs::write(self.dir.join("salida.json"), serde_json::to_string_pretty(&self.salida).unwrap_or_default());
    }

    fn nuevo_id(prefijo: &str, ms: u64) -> String {
        format!("{prefijo}{ms:x}{:04x}", (ms.wrapping_mul(2654435761) >> 7) & 0xffff)
    }

    /// Un mensaje que sube desde la Tierra. `luz_ms` = retraso de la luz cuando se envió.
    pub fn subir(&mut self, trip: &str, de: &str, relacion: &str, texto: &str, enviado_ms: u64, luz_ms: u64, archivo: Option<(&[u8], &str)>) -> Result<Value, String> {
        let id = Self::nuevo_id("m", enviado_ms);
        let mut nombre = None;
        if let Some((bytes, mime)) = archivo {
            if bytes.len() > MAX_ARCHIVO {
                return Err("la foto pesa más de 3 MB: el relevo debe comprimirla".into());
            }
            let ext = match mime { "image/png" => "png", "image/webp" => "webp", _ => "jpg" };
            let n = format!("{id}.{ext}");
            fs::write(self.dir.join("archivos").join(&n), bytes).map_err(|e| e.to_string())?;
            nombre = Some(n);
        }
        let m = json!({
            "id": id, "trip": trip, "de": de, "relacion": relacion, "texto": texto,
            "tipo": if nombre.is_some() { "foto" } else { "texto" }, "archivo": nombre,
            "enviado": enviado_ms, "llega": enviado_ms + luz_ms, "luz_ms": luz_ms,
        });
        self.mensajes.push(m.clone());
        self.guardar();
        Ok(m)
    }

    /// Los mensajes que ya llegaron para un tripulante (lo más nuevo primero) y los que vienen en camino
    pub fn bandeja(&self, trip: &str, ahora_ms: u64) -> Value {
        let mut llegados: Vec<&Value> = self.mensajes.iter().filter(|m| m["trip"] == trip && m["llega"].as_u64().unwrap_or(0) <= ahora_ms).collect();
        llegados.sort_by_key(|m| std::cmp::Reverse(m["llega"].as_u64().unwrap_or(0)));
        let en_camino: Vec<u64> = self.mensajes.iter().filter(|m| m["trip"] == trip && m["llega"].as_u64().unwrap_or(0) > ahora_ms).filter_map(|m| m["llega"].as_u64()).collect();
        let respuestas: Vec<&Value> = self.salida.iter().filter(|r| r["trip"] == trip).collect();
        json!({
            "mensajes": llegados.into_iter().take(60).collect::<Vec<_>>(),
            "en_camino": en_camino.len(),
            "proximo_llega": en_camino.iter().min(),
            "respuestas": respuestas.into_iter().rev().take(20).collect::<Vec<_>>(),
        })
    }

    /// El archivo de un mensaje ya llegado (nunca uno que todavía viaja)
    pub fn archivo(&self, id: &str, ahora_ms: u64) -> Option<(Vec<u8>, &'static str)> {
        let m = self.mensajes.iter().find(|m| m["id"] == id && m["llega"].as_u64().unwrap_or(u64::MAX) <= ahora_ms)?;
        let n = m["archivo"].as_str()?;
        let mime = if n.ends_with(".png") { "image/png" } else if n.ends_with(".webp") { "image/webp" } else { "image/jpeg" };
        Some((fs::read(self.dir.join("archivos").join(n)).ok()?, mime))
    }

    /// Respuesta del astronauta: queda en la cola de bajada hasta el próximo contacto
    pub fn responder(&mut self, trip: &str, a: &str, texto: &str, ahora_ms: u64, archivo: Option<(&[u8], &str)>) -> Result<Value, String> {
        let id = Self::nuevo_id("r", ahora_ms);
        let mut nombre = None;
        if let Some((bytes, _mime)) = archivo {
            if bytes.len() > MAX_ARCHIVO {
                return Err("la foto pesa más de 3 MB".into());
            }
            let n = format!("{id}.jpg");
            fs::write(self.dir.join("archivos").join(&n), bytes).map_err(|e| e.to_string())?;
            nombre = Some(n);
        }
        let r = json!({"id": id, "trip": trip, "a": a, "texto": texto, "archivo": nombre, "creado": ahora_ms, "estado": "en_cola"});
        self.salida.push(r.clone());
        self.guardar();
        Ok(r)
    }

    /// El relevo de Tierra retira la cola de bajada (las marca como enviadas)
    pub fn bajar(&mut self, ahora_ms: u64) -> Vec<Value> {
        let mut out = vec![];
        for r in self.salida.iter_mut().filter(|r| r["estado"] == "en_cola") {
            r["estado"] = json!("enviado");
            r["enviado"] = json!(ahora_ms);
            out.push(r.clone());
        }
        self.guardar();
        out
    }

    pub fn archivo_respuesta(&self, id: &str) -> Option<Vec<u8>> {
        let r = self.salida.iter().find(|r| r["id"] == id)?;
        fs::read(self.dir.join("archivos").join(r["archivo"].as_str()?)).ok()
    }
}
