//! «Ask Nova»: preguntas de la tripulación respondidas por un modelo de lenguaje que corre a bordo (llama.cpp,
//! Qwen3 4B) con los datos de la nave en el contexto. El modelo no decide nada médico: responde con las cifras que
//! tiene la nave y con los pasos de los protocolos aprobados (ui/protocolos.json).

use serde_json::{json, Value};

use crate::historia::Historia;

pub const MODELO_URL_DEFECTO: &str = "http://127.0.0.1:8081";

/// Tripulación (la misma de ui/tripulacion.json)
pub fn tripulacion(carpeta_ui: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(carpeta_ui.join("tripulacion.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

const SERIES_TXT: [(&str, &str, &str, usize); 11] = [
    ("pulso", "heart rate", "bpm", 0),
    ("spo2", "SpO2", "%", 0),
    ("pa_sis", "systolic BP", "mmHg", 0),
    ("pa_dia", "diastolic BP", "mmHg", 0),
    ("temp", "temperature", "°C", 1),
    ("fr", "breathing", "/min", 0),
    ("glucosa", "blood sugar", "mg/dL", 0),
    ("vfc", "HRV", "ms", 0),
    ("sueno_h", "sleep last night", "h", 1),
    ("animo", "mood (check-in)", "/5", 0),
    ("energia", "energy (check-in)", "/5", 0),
];

fn nivel_txt(n: &str) -> &'static str {
    match n {
        "atencion" => "ATTENTION",
        "aviso_tierra" => "TELL EARTH",
        "esperado_vuelo" => "expected in flight",
        "normal" => "ok",
        _ => "no data",
    }
}

/// Qué límite cruzó un valor marcado (la comparación la hace la nave, no el modelo)
fn cruce(e: &Value, k: &str, v: f64) -> String {
    let Some(u) = e["umbrales"][k].as_array() else { return String::new() };
    let x: Vec<f64> = u.iter().map(|a| a.as_f64().unwrap_or(-1.0)).collect();
    if x.len() < 4 {
        return String::new();
    }
    if x[1] > 0.0 && v >= x[1] { return format!(": at or above the tell-Earth limit of {}", x[1]); }
    if x[3] > 0.0 && v <= x[3] { return format!(": at or below the tell-Earth limit of {}", x[3]); }
    if x[0] > 0.0 && v >= x[0] { return format!(": at or above the attention limit of {}", x[0]); }
    if x[2] > 0.0 && v <= x[2] { return format!(": at or below the attention limit of {}", x[2]); }
    String::new()
}

fn hace(seg: u64) -> String {
    if seg <= 3 {
        "live".into()
    } else if seg < 120 {
        format!("{seg} s ago")
    } else if seg < 7200 {
        format!("{} min ago", seg / 60)
    } else {
        format!("{} h ago", seg / 3600)
    }
}

fn f(v: f64, dec: usize) -> String {
    format!("{v:.dec$}")
}

/// El contexto que ve el modelo: misión, tripulación en vivo, historia, umbrales, alertas y protocolos
/// Datos en vivo para la pregunta. Lo fijo (reglas, protocolos) va en el mensaje de sistema, así el modelo lo guarda en
/// caché y solo lee esto. Las historias de 1 h y 24 h van solo para quien nombra la pregunta (o quien necesita atención).
pub fn contexto(estado: Option<&Value>, historia: &Historia, mision: &Value, crew: &[Value], pregunta: &str, ahora: u64) -> String {
    let mut c = String::new();
    let luz = mision["luz_seg"].as_f64().unwrap_or(0.0) / 60.0;
    c += &format!(
        "Mission: day {} · phase {} · Mars orbit in {} days · Earth {:.0} million km away · light takes {:.1} min one way · solar conjunction (no Earth link): {}.\n",
        mision["dia"], mision["fase"].as_str().unwrap_or("?"), mision["llegada_en_dias"], mision["distancia_km"].as_f64().unwrap_or(0.0) / 1e6, luz,
        if mision["conjuncion"].as_bool().unwrap_or(false) { "YES" } else { "no" }
    );
    let hh = (ahora % 86400) / 3600;
    let mm = (ahora % 3600) / 60;
    c += &format!("Ship time now: {hh:02}:{mm:02} UTC.\n\nCREW, CURRENT READINGS\n");

    let Some(e) = estado else {
        c += "No readings from the onboard core yet.\n";
        return c;
    };
    let trips = e["trip"].as_array().cloned().unwrap_or_default();
    // prioridades calculadas a bordo (reglas fijas), de lo más grave a lo menos
    let mut prioridades: Vec<(u8, String)> = vec![];
    for (i, tr) in trips.iter().enumerate() {
        if crew.get(i).map(|p| p["vacio"] == true).unwrap_or(false) { continue; } // asiento sin nadie: no existe para NOVA
        let nombre = crew.get(i).and_then(|p| p["corto"].as_str()).unwrap_or("?");
        let mut cosas = vec![];
        let mut peor = 0u8;
        for (k, n, u, dec) in SERIES_TXT {
            let nv = tr["niveles"][k].as_str().unwrap_or("");
            let g = match nv { "aviso_tierra" => 2, "atencion" => 1, _ => 0 };
            if g > 0 && tr["edades"][k].as_u64().unwrap_or(0) > 0 {
                peor = peor.max(g);
                let v = tr[k].as_f64().unwrap_or(0.0);
                cosas.push(format!("{n} {} {u} ({}{})", f(v, dec), nivel_txt(nv), cruce(e, k, v)));
            }
        }
        if !cosas.is_empty() {
            prioridades.push((peor, format!("{nombre}: {}", cosas.join(", "))));
        }
    }
    let ncab = e["cabina"]["nivel_co2"].as_str().unwrap_or("");
    if ncab == "atencion" || ncab == "aviso_tierra" {
        prioridades.push((if ncab == "aviso_tierra" { 2 } else { 1 }, format!("Cabin: CO2 {:.0} ppm ({})", e["cabina"]["co2"].as_f64().unwrap_or(0.0), nivel_txt(ncab))));
    }
    prioridades.sort_by(|a, b| b.0.cmp(&a.0));
    if prioridades.is_empty() {
        c += "NEEDS ATTENTION NOW: nobody. Every measured value is within the limits.\n\n";
    } else {
        c += "NEEDS ATTENTION NOW (computed onboard, most serious first; mention all of them when asked who needs attention):\n";
        for (j, (_, t)) in prioridades.iter().enumerate() {
            c += &format!("{}. {t}\n", j + 1);
        }
        c += "\n";
    }
    for (i, tr) in trips.iter().enumerate() {
        if crew.get(i).map(|p| p["vacio"] == true).unwrap_or(false) { continue; }
        let id = format!("T{}", i + 1);
        let quien = crew.get(i).map(|p| format!("{} ({}, {})", p["nombre"].as_str().unwrap_or(&id), p["rol"].as_str().unwrap_or(""), p["pronombre"].as_str().unwrap_or("they"))).unwrap_or(id.clone());
        c += &format!("- {id} {quien}. Overall: {}.\n  ", nivel_txt(tr["nivel"].as_str().unwrap_or("")));
        let mut partes = vec![];
        for (k, nombre, u, dec) in SERIES_TXT {
            let edad = tr["edades"][k].as_u64().unwrap_or(0);
            if edad == 0 {
                continue;
            }
            let v = tr[k].as_f64().unwrap_or(0.0);
            let n = tr["niveles"][k].as_str().unwrap_or("");
            let marca = if n == "atencion" || n == "aviso_tierra" { format!(", {}{}", nivel_txt(n), cruce(e, k, v)) } else { String::new() };
            let diario = matches!(k, "sueno_h" | "animo" | "energia");
            if diario {
                partes.push(format!("{nombre} {} {u}{}", f(v, dec), if marca.is_empty() { String::new() } else { format!(" ({})", &marca[2..]) }));
            } else {
                partes.push(format!("{nombre} {} {u} ({}{marca})", f(v, dec), hace(edad)));
            }
        }
        if partes.is_empty() {
            c += "no readings yet\n";
        } else {
            c += &(partes.join("; ") + "\n");
        }
        // historia: última hora y 24 h, solo de quien importa para esta pregunta
        let q = pregunta.to_lowercase();
        let nombrada = crew.iter().any(|p| ["corto", "nombre"].iter().any(|k| p[*k].as_str().map(|n| q.contains(&n.to_lowercase())).unwrap_or(false)));
        let esta = crew.get(i).map(|p| ["corto", "nombre"].iter().any(|k| p[*k].as_str().map(|n| q.contains(&n.to_lowercase())).unwrap_or(false))).unwrap_or(false);
        let atencion = matches!(tr["nivel"].as_str(), Some("atencion") | Some("aviso_tierra"));
        if !(esta || (!nombrada && atencion)) {
            continue;
        }
        for (ventana, seg) in [("last hour (only what was recorded)", 3600u64), ("last 24 h (only what was recorded)", 86400u64)] {
            let mut h = vec![];
            for (k, nombre, u, dec) in SERIES_TXT.iter().take(8) {
                if let Some((media, mn, mx, n)) = historia.resumen(&format!("{id}.{k}"), seg, ahora) {
                    if n >= 2 {
                        h.push(format!("{nombre} avg {} ({}–{}) {u} from {n} readings", f(media as f64, *dec), f(mn as f64, *dec), f(mx as f64, *dec)));
                    }
                }
            }
            if !h.is_empty() {
                c += &format!("  {ventana}: {}\n", h.join("; "));
            }
        }
    }
    let cab = &e["cabina"];
    c += &format!(
        "Cabin: CO2 {:.0} ppm ({}), O2 {:.1} %, temperature {:.1} °C.\n",
        cab["co2"].as_f64().unwrap_or(0.0), nivel_txt(cab["nivel_co2"].as_str().unwrap_or("")), cab["o2"].as_f64().unwrap_or(0.0), cab["temp"].as_f64().unwrap_or(0.0)
    );

    c += "\nLIMITS IN FORCE (attention / tell Earth; set by the flight surgeon, updated from Earth)\n";
    if let Some(u) = e["umbrales"].as_object() {
        for (k, nombre, unidad, _) in SERIES_TXT {
            let Some(a) = u.get(k).and_then(|v| v.as_array()) else { continue };
            let x: Vec<f64> = a.iter().map(|v| v.as_f64().unwrap_or(-1.0)).collect();
            if x.len() < 4 || x.iter().all(|v| *v <= 0.0) {
                continue;
            }
            let mut s = vec![];
            if x[0] > 0.0 || x[1] > 0.0 {
                s.push(format!("high ≥{} / ≥{}", x[0], x[1]));
            }
            if x[2] > 0.0 || x[3] > 0.0 {
                s.push(format!("low ≤{} / ≤{}", x[2], if x[3] > 0.0 { x[3].to_string() } else { "-".into() }));
            }
            c += &format!("- {nombre} ({unidad}): {}\n", s.join(", "));
        }
    }

    let alertas = historia.ultimas_alertas(8);
    if !alertas.is_empty() {
        c += "\nRECENT ALERTS (oldest first; trip 0 = cabin)\n";
        for a in alertas {
            let t = a["t"].as_u64().unwrap_or(0);
            let trip = a["trip"].as_u64().unwrap_or(0) as usize;
            if trip > 0 && crew.get(trip - 1).map(|p| p["vacio"] == true).unwrap_or(false) { continue; }
            // alertas de antes de que la persona real ocupara el asiento eran de la tripulación de demostración
            let desde = crew.get(trip.wrapping_sub(1)).and_then(|p| p["desde"].as_u64()).unwrap_or(0);
            if trip > 0 && desde > 0 && t.saturating_mul(if t < 1_000_000_000_000 { 1000 } else { 1 }) < desde { continue; }
            let quien = if trip == 0 { "Cabin".to_string() } else { crew.get(trip - 1).and_then(|p| p["corto"].as_str()).unwrap_or("?").to_string() };
            c += &format!("- {} ago: {quien} {} = {} → {}\n", hace(ahora.saturating_sub(t)), a["sensor"].as_str().unwrap_or("?"), a["valor"], nivel_txt(a["nivel"].as_str().unwrap_or("")));
        }
    }
    c
}

pub fn protocolos_txt(json: &str) -> String {
    let Ok(v) = serde_json::from_str::<Value>(json) else { return String::new() };
    let mut t = String::new();
    for p in v["protocolos"].as_array().cloned().unwrap_or_default() {
        t += &format!("* {} — when: {}\n", p["titulo"].as_str().unwrap_or(""), p["cuando"].as_str().unwrap_or(""));
        for (i, paso) in p["pasos"].as_array().cloned().unwrap_or_default().iter().enumerate() {
            t += &format!("  {}. {}\n", i + 1, paso.as_str().unwrap_or(""));
        }
        if let Some(e) = p["tierra"].as_str() {
            t += &format!("  Earth: {e}\n");
        }
        if let Some(f) = p["fuente"].as_str() {
            t += &format!("  Source: {f}\n");
        }
    }
    t
}

/// ¿La pregunta es sobre cómo está la tripulación ahora (datos en vivo) y no sobre conocimiento médico?
pub fn pregunta_de_estado(pregunta: &str, crew: &[Value]) -> bool {
    let q = format!(" {} ", pregunta.to_lowercase());
    let saber = ["why", "what is", "what are", "what does", "how does", "how do ", "cause", "risk", "treat", "should we", "what if", "por qué", "porque", "qué es", "que es", "qué hace", "causa", "riesgo", "tratar", "tratamiento", "qué pasa si", "y si "];
    if saber.iter().any(|w| q.contains(w)) {
        return false;
    }
    let estado = ["who ", "attention", "how is", "how's", "how are", "doing", "status", "slept", "sleep", "mood", "right now", "quién", "quien", "atención", "atencion", "cómo está", "como esta", "cómo están", "como estan", "durmió", "durmio", "ánimo", "animo"];
    let nombra = crew.iter().any(|p| p["corto"].as_str().map(|n| q.contains(&n.to_lowercase())).unwrap_or(false));
    estado.iter().any(|w| q.contains(w)) || (nombra && q.split_whitespace().count() <= 6)
}

/// Idioma de la pregunta: español si tiene marcas o palabras típicas; si no, inglés
pub fn idioma(pregunta: &str) -> &'static str {
    let q = pregunta.to_lowercase();
    let marcas = q.chars().any(|c| "áéíóúñ¿¡".contains(c));
    let palabras = [" que ", "qué", " cómo", "como ", " está", "esta ", " hay ", "quién", "quien", " de ", " la ", " el ", " los ", " las ", " hoy", "durmió", "si ", "hacemos", "necesita"];
    let n = palabras.iter().filter(|p| format!(" {q} ").contains(*p)).count();
    if marcas || n >= 2 { "Spanish" } else { "English" }
}

pub fn sistema(luz_min: f64) -> String {
    format!(
        "You are NOVA, the onboard health copilot of a crewed spacecraft on a mission to Mars. You run fully onboard with no internet. \
Earth is about {luz_min:.0} light-minutes away one way, so the crew cannot wait for the flight surgeon in an emergency.\n\
Rules:\n\
1. Use only the ONBOARD DATA in the latest message. Quote real numbers with units and how long ago they were measured. If something was not measured, say so. Never invent readings, history or diagnoses.\n\
2. You are not a doctor and you do not replace the flight surgeon. For any medical action use only the steps of the matching PROTOCOL, in order, and name the protocol. If none fits, say what to measure next and that it goes to the flight surgeon.\n\
3. EMERGENCIES: if the question is about an emergency covered by a PROTOCOL (cardiac arrest, choking, severe allergic reaction, severe bleeding, seizure, fainting, low blood sugar, low oxygen, decompression sickness, fever), give ONLY that protocol's steps exactly as written, in order, say its title, and tell the crew to press Emergency to open the guided version. Never add, change or reorder emergency steps, and never use library excerpts for emergency steps. Short sleep or low mood is never an emergency.\n\
4. Be brief and plain: at most 5 short sentences or a short numbered list. No headings, no markdown tables, no jargon.\n\
5. Answer in the language you are told in the latest message.\n\
6. Mood and check-in data are shared by each crew member with consent; mention them with care and only when relevant.\n\
7. Medical knowledge (causes, risks, treatments, how things work in spaceflight) comes only from the MEDICAL LIBRARY EXCERPTS. Cite them as [1], [2] right after the sentence that uses them. Never cite anything else. If the excerpts do not cover the question, say the onboard library does not cover it."
    )
}

/// Mensajes para el modelo: sistema + datos + conversación reciente + pregunta
pub fn mensajes(sistema: &str, protocolos: &str, kit: &str, datos: &str, previos: &[Value], pregunta: &str) -> Vec<Value> {
    let lengua = idioma(pregunta);
    // primero lo fijo (se reutiliza de una pregunta a otra; el kit cambia solo cuando se usa algo), al final lo que cambia cada segundo
    let mut m = vec![json!({"role": "system", "content": format!("{sistema}\n\nPROTOCOLS (approved steps; use them as written and call them by their title)\n{}\nMEDICAL KIT ONBOARD (live inventory). When you mention a supply, say where it is and how many are left. Never suggest a supply that is not listed or has none left; say so and that it goes to the flight surgeon.\n{kit}", protocolos_txt(protocolos))})];
    for p in previos.iter().rev().take(6).rev() {
        let rol = if p["rol"].as_str() == Some("nova") { "assistant" } else { "user" };
        if let Some(t) = p["texto"].as_str() {
            m.push(json!({"role": rol, "content": t.chars().take(1200).collect::<String>()}));
        }
    }
    m.push(json!({"role": "user", "content": format!("ONBOARD DATA (live, right now)\n{datos}\n\nReply in {lengua}.\n\nQUESTION: {}", pregunta.chars().take(800).collect::<String>())}));
    m
}

/// Emergencias: la nave reconoce la pregunta con reglas fijas (inglés y español) y le entrega al modelo el protocolo
/// exacto. Las preguntas de conocimiento («¿por qué…?», «what is…») no cuentan como emergencia.
const CLAVES: [(&str, &[&str]); 10] = [
    ("paro_cardiaco", &["cpr", "rcp", "cardiac arrest", "paro card", "heart stop", "heart has stopped", "heart stopped", "no heartbeat", "not breathing", "stopped breathing", "corazon se", "paro el corazon", "paro su corazon", "se le paro", "dejo de latir", "sin latido", "no pulse", "sin pulso", "no respira", "dejo de respirar", "resuscitat", "reanim", "masaje cardiaco"]),
    ("atragantamiento", &["chok", "atragant", "atorad", "something stuck in", "se le fue algo", "no puede respirar comiendo", "can't breathe while eating"]),
    ("anafilaxia", &["anaphyla", "anafila", "allergic", "alergic", "stung", " sting", "picad", "pico ", "lips are swelling", "lips swelling", "labios hinchad", "se le hinchan", "throat is swelling", "garganta hinchad"]),
    ("hemorragia", &["bleeding", "bleed", "sangr", "hemorrag", "tourniquet", "torniquete"]),
    ("convulsion", &["seizure", "seizing", "convuls", "epilep"]),
    ("desmayo", &["faint", "passed out", "desmay", "sincope", "se desvaneci"]),
    ("descompresion", &["decompression", "descompresi", "the bends", "after the spacewalk", "despues de la caminata"]),
    ("hipoglucemia", &["low blood sugar", "hypoglyc", "hipogluc", "azucar baja", "azucar bajo", "glucosa baja"]),
    ("oxigeno_bajo", &["low oxygen", "oxygen is low", "oxigeno bajo", "saturacion baja", "hypox", "hipox"]),
    ("fiebre", &["fever", "fiebre", "temperature is high", "temperatura alta"]),
];
const CONOCIMIENTO: [&str; 11] = ["why", "por que", "porque", "explain", "explica", "what is", "que es", "different", "diferente", "how does", "como funciona"];

/// minúsculas y sin tildes, para comparar frases
fn plano(t: &str) -> String {
    t.to_lowercase().chars().map(|c| match c { 'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' | 'ü' => 'u', _ => c }).collect()
}

pub fn emergencia(pregunta: &str, protocolos: &str) -> Option<(String, String, Vec<String>)> {
    let q = format!(" {} ", plano(pregunta));
    if CONOCIMIENTO.iter().any(|w| q.contains(w)) {
        return None;
    }
    let id = CLAVES.iter().find(|(_, ws)| ws.iter().any(|w| q.contains(w)))?.0;
    let v: Value = serde_json::from_str(protocolos).ok()?;
    let p = v["protocolos"].as_array()?.iter().find(|p| p["id"].as_str() == Some(id))?;
    let es = idioma(pregunta) == "Spanish" && p["pasos_es"].is_array();
    let (kt, kp) = if es { ("titulo_es", "pasos_es") } else { ("titulo", "pasos") };
    let pasos = p[kp].as_array()?.iter().filter_map(|x| x.as_str().map(String::from)).collect();
    Some((id.to_string(), p[kt].as_str().unwrap_or(id).to_string(), pasos))
}

/// Respuesta fija para una emergencia reconocida: el protocolo tal cual, sin modelo de lenguaje
pub fn respuesta_emergencia(pregunta: &str, titulo: &str, pasos: &[String], crew: &[Value]) -> String {
    let q = pregunta.to_lowercase();
    let quien = crew.iter().filter_map(|c| c["corto"].as_str()).find(|n| q.contains(&n.to_lowercase()));
    let es = idioma(pregunta) == "Spanish";
    let mut t = match quien { Some(n) => format!("{n}: {titulo}.\n"), None => format!("{titulo}.\n") };
    for (i, p) in pasos.iter().enumerate() {
        t += &format!("{}. {p}\n", i + 1);
    }
    t += if es { "Presiona Emergency para abrir la guía paso a paso." } else { "Press Emergency to open the step-by-step guide." };
    t
}

/// Tope duro al largo de la respuesta: el modelo chico a veces se pasa de las 5 frases que pide la regla 4.
/// Devuelve dónde cortar (byte) apenas empieza la frase que sobra: 5 frases en prosa, 7 líneas si es una lista.
/// Las citas [1] que van después del punto se conservan con su frase.
pub fn corte_de_largo(texto: &str) -> Option<usize> {
    let es_lista = texto.lines().any(|l| marcador_lista(l.trim_start()) > 0);
    let tope = if es_lista { 7 } else { 5 };
    let mut n = 0;
    let mut pos = 0;
    for linea in texto.split_inclusive('\n') {
        let sangria = linea.len() - linea.trim_start().len();
        let resto_ini = pos + sangria + marcador_lista(linea.trim_start());
        let cuerpo = &texto[resto_ini..pos + linea.len()];
        let mut abierta = false; // hay texto de una frase sin cerrar
        let mut chars = cuerpo.char_indices().peekable();
        while let Some((i, c)) = chars.next() {
            if n >= tope && !c.is_whitespace() && !matches!(c, '[' | ']' | '.' | '!' | '?' | ',' | ')') && !c.is_ascii_digit() {
                // empieza algo después de la última frase permitida (las citas [1] no cuentan)
                return Some(texto[..resto_ini + i].trim_end().len());
            }
            if n >= tope {
                continue;
            }
            if matches!(c, '.' | '!' | '?') {
                let sigue = chars.peek().map(|(_, s)| s.is_whitespace()).unwrap_or(false);
                if sigue && abierta {
                    n += 1;
                    abierta = false;
                }
            } else if !c.is_whitespace() {
                abierta = true;
            }
        }
        // una línea de lista sin punto final también es una unidad
        if abierta && linea.ends_with('\n') && es_lista {
            n += 1;
        }
        pos += linea.len();
    }
    None
}

/// Largo del marcador «1. », «2) » o «- » al inicio de una línea (0 si no hay)
fn marcador_lista(l: &str) -> usize {
    let d = l.chars().take_while(|c| c.is_ascii_digit()).count();
    if d > 0 && d < 3 && (l[d..].starts_with(". ") || l[d..].starts_with(") ")) {
        return d + 2;
    }
    if l.starts_with("- ") || l.starts_with("* ") {
        return 2;
    }
    0
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn corta_la_sexta_frase_y_deja_las_citas() {
        let t = "Uno es así. Dos también [1]. Tres sigue. Cuatro 37.5 °C ok. Cinco cierra. [2] Seis sobra. Siete.";
        let c = corte_de_largo(t).unwrap();
        assert_eq!(&t[..c], "Uno es así. Dos también [1]. Tres sigue. Cuatro 37.5 °C ok. Cinco cierra. [2]");
        assert_eq!(corte_de_largo("Una. Dos. Tres. Cuatro. Cinco."), None);
        assert_eq!(corte_de_largo("Una. Dos. Tres. Cuatro. Cinco. Seis"), Some(30));
        let lista = "Do this now:\n1. Stop the bleeding.\n2. Raise the leg.\n3. Check pulse.\n4. Call Earth.\n";
        assert_eq!(corte_de_largo(lista), None);
    }

    fn protocolos() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/protocolos.json")).unwrap()
    }

    #[test]
    fn reconoce_emergencias_en_ingles_y_espanol() {
        let p = protocolos();
        let casos = [
            ("¡A Ingrid se le paró el corazón! ¿Qué hacemos?", "paro_cardiaco"),
            ("How do we do CPR on Kenji? We're in microgravity.", "paro_cardiaco"),
            ("Kenji is not breathing and doesn't respond", "paro_cardiaco"),
            ("¡David se está atragantando y no puede hablar!", "atragantamiento"),
            ("Mara got stung and her lips are swelling", "anafilaxia"),
            ("Kenji is bleeding a lot from his forearm", "hemorragia"),
            ("Ingrid está convulsionando", "convulsion"),
            ("Mara se desmayó", "desmayo"),
            ("Kenji has joint pain after the spacewalk", "descompresion"),
            ("A David le bajó la glucosa, azúcar baja", "hipoglucemia"),
            ("Ingrid tiene fiebre", "fiebre"),
        ];
        for (q, id) in casos {
            assert_eq!(emergencia(q, &p).map(|x| x.0), Some(id.to_string()), "{q}");
        }
    }

    #[test]
    fn preguntas_de_conocimiento_no_son_emergencias() {
        let p = protocolos();
        for q in [
            "Is the CPR technique different in microgravity? Why?",
            "¿Por qué los astronautas tienen más riesgo de cálculos renales?",
            "What is decompression sickness?",
            "We are testing the station sensors today",
            "How did Kenji sleep?",
        ] {
            assert!(emergencia(q, &p).is_none(), "{q}");
        }
    }

    #[test]
    fn respuesta_en_espanol_con_nombre() {
        let p = protocolos();
        let (_, t, pasos) = emergencia("¡A Ingrid se le paró el corazón!", &p).unwrap();
        let crew = vec![json!({"corto": "Ingrid"})];
        let r = respuesta_emergencia("¡A Ingrid se le paró el corazón!", &t, &pasos, &crew);
        assert!(r.starts_with("Ingrid: Paro cardiaco en microgravedad"));
        assert!(r.contains("Evetts-Russomano"));
        assert!(r.ends_with("Presiona Emergency para abrir la guía paso a paso."));
    }
}
