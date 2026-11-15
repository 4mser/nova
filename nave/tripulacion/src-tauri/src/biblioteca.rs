//! Biblioteca médica a bordo: fragmentos de fuentes abiertas (NASA, OMS, OpenStax, MedlinePlus…) con sus vectores.
//! Se busca por significado (modelo de búsqueda local) más un empujón por palabras clave, y cada resultado lleva
//! su fuente, página y licencia para citarlo. El índice lo prepara biblioteca/indexar.py y sube en la actualización.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub struct Biblioteca {
    n: usize,
    dim: usize,
    vectores: Vec<f32>,
    fragmentos: Vec<Value>,
    fuentes: HashMap<String, Value>,
    relleno: Vec<bool>, // índices, referencias y avisos legales repetidos: no se citan
    pub version: String,
}

pub fn carpeta() -> PathBuf {
    std::env::var("NOVA_BIBLIOTECA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".nova-pc/biblioteca"))
}

impl Biblioteca {
    pub fn cargar(dir: &Path) -> Option<Biblioteca> {
        let mut f = fs::File::open(dir.join("vectores.f32")).ok()?;
        let mut cab = [0u8; 8];
        f.read_exact(&mut cab).ok()?;
        let n = u32::from_le_bytes(cab[0..4].try_into().ok()?) as usize;
        let dim = u32::from_le_bytes(cab[4..8].try_into().ok()?) as usize;
        let mut bytes = Vec::with_capacity(n * dim * 4);
        f.read_to_end(&mut bytes).ok()?;
        if bytes.len() != n * dim * 4 {
            return None;
        }
        let vectores: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let fragmentos: Vec<Value> = BufReader::new(fs::File::open(dir.join("fragmentos.jsonl")).ok()?)
            .lines()
            .map_while(Result::ok)
            .filter_map(|l| serde_json::from_str(&l).ok())
            .collect();
        if fragmentos.len() != n {
            return None;
        }
        let cat: Value = serde_json::from_str(&fs::read_to_string(dir.join("catalogo.json")).ok()?).ok()?;
        let fuentes = cat["fuentes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|f| f["id"].as_str().map(|id| (id.to_string(), f.clone())))
            .collect();
        // textos cortos que se repiten en varias páginas (avisos legales, pies de página) son relleno
        let prefijo = |fr: &Value| fr["texto"].as_str().unwrap_or("").chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).take(120).collect::<String>();
        let mut veces: HashMap<String, usize> = HashMap::new();
        for fr in &fragmentos {
            *veces.entry(prefijo(fr)).or_insert(0) += 1;
        }
        let relleno = fragmentos
            .iter()
            .map(|fr| es_relleno(fr) || (veces[&prefijo(fr)] >= 3 && fr["texto"].as_str().unwrap_or("").len() < 600))
            .collect();
        Some(Biblioteca { n, dim, vectores, fragmentos, fuentes, relleno, version: cat["version"].as_str().unwrap_or("").to_string() })
    }

    pub fn resumen(&self) -> Value {
        let mut f: Vec<Value> = self
            .fuentes
            .values()
            .map(|v| json!({"id": v["id"], "titulo": v["titulo"], "editor": v["editor"], "anio": v["anio"], "licencia": v["licencia"], "fragmentos": v["fragmentos"], "url": v["url"], "formato": v["formato"], "tema": v["tema"]}))
            .collect();
        f.sort_by(|a, b| a["editor"].as_str().cmp(&b["editor"].as_str()).then(a["titulo"].as_str().cmp(&b["titulo"].as_str())));
        json!({"version": self.version, "fragmentos": self.n, "fuentes": f})
    }

    /// Los k fragmentos más cercanos al vector de la pregunta (ya normalizado), con empujón por palabras clave
    pub fn buscar(&self, q: &[f32], texto: &str, k: usize) -> Vec<Value> {
        if q.len() != self.dim || self.n == 0 {
            return vec![];
        }
        let claves: Vec<String> = texto
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.chars().count() >= 5)
            .map(String::from)
            .collect();
        let mut puntajes: Vec<(f32, usize)> = (0..self.n)
            .map(|i| {
                let v = &self.vectores[i * self.dim..(i + 1) * self.dim];
                let mut s: f32 = v.iter().zip(q).map(|(a, b)| a * b).sum();
                if !claves.is_empty() {
                    let t = self.fragmentos[i]["texto"].as_str().unwrap_or("").to_lowercase();
                    let hits = claves.iter().filter(|w| t.contains(w.as_str())).count();
                    s += 0.03 * hits.min(4) as f32;
                }
                (s, i)
            })
            .collect();
        puntajes.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        // como mucho 2 fragmentos por página de la misma fuente, para no repetir
        let mut por_pagina: HashMap<String, usize> = HashMap::new();
        let mut out = vec![];
        for (s, i) in puntajes {
            let fr = &self.fragmentos[i];
            if self.relleno[i] {
                continue;
            }
            let clave = format!("{}#{}", fr["fuente"].as_str().unwrap_or(""), fr["pagina"]);
            let c = por_pagina.entry(clave).or_insert(0);
            if *c >= 2 {
                continue;
            }
            *c += 1;
            let fuente = self.fuentes.get(fr["fuente"].as_str().unwrap_or("")).cloned().unwrap_or(Value::Null);
            out.push(json!({
                "puntaje": s, "fuente": fr["fuente"], "titulo": fuente["titulo"], "editor": fuente["editor"], "anio": fuente["anio"],
                "licencia": fuente["licencia"], "url": fuente["url"], "pagina": fr["pagina"], "seccion": fr["seccion"], "texto": fr["texto"],
            }));
            if out.len() >= k {
                break;
            }
        }
        out
    }
}

/// Índices, listas de referencias y bibliografías: se indexan, pero no sirven como pasaje para citar
fn es_relleno(fr: &Value) -> bool {
    let s = fr["seccion"].as_str().unwrap_or("").trim().to_lowercase();
    let s = s.trim_start_matches(|c: char| c.is_ascii_digit() || c == ' ');
    if matches!(s, "contents" | "table of contents" | "index" | "references" | "reference" | "reference list" | "reference(s)" | "bibliography" | "referenced technical requirements") {
        return true;
    }
    // trozos que son casi solo citas o puntos de un índice
    let t = fr["texto"].as_str().unwrap_or("");
    let citas = t.matches("et al").count() + t.matches("doi").count() + t.matches("http").count();
    if citas >= 6 || t.matches("....").count() >= 4 {
        return true;
    }
    // lista numerada de referencias: muchos años y muchos «12. » seguidos
    let palabras: Vec<&str> = t.split_whitespace().collect();
    let anios = palabras.iter().filter(|w| {
        let d: String = w.chars().filter(|c| c.is_ascii_digit()).collect();
        d.len() == 4 && (d.starts_with("19") || d.starts_with("20"))
    }).count();
    let numerados = palabras.iter().filter(|w| w.len() <= 3 && w.ends_with('.') && w[..w.len() - 1].chars().all(|c| c.is_ascii_digit()) && w.len() > 1).count();
    // listas de autores: «Chang, T. T., Walther, I.,» → muchas iniciales sueltas
    let iniciales = palabras.iter().filter(|w| { let w = w.trim_end_matches(','); w.len() == 2 && w.ends_with('.') && w.starts_with(|c: char| c.is_ascii_uppercase()) }).count();
    (anios >= 6 && numerados >= 4) || iniciales * 6 >= palabras.len().max(1) && iniciales >= 12
}

/// Vector de una pregunta con el modelo de búsqueda local
pub async fn vector_pregunta(url: &str, texto: &str) -> Option<Vec<f32>> {
    let r = reqwest::Client::new()
        .post(format!("{url}/v1/embeddings"))
        .json(&json!({"input": [format!("search_query: {texto}")]}))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    let v: Value = r.json().await.ok()?;
    let e: Vec<f32> = v["data"][0]["embedding"].as_array()?.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect();
    let n = e.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    Some(e.into_iter().map(|x| x / n).collect())
}
