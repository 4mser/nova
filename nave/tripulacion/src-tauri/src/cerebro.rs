//! El "cerebro" de lenguaje de NOVA, intercambiable:
//! · a bordo (por defecto): llama.cpp local, sin internet (la arquitectura de vuelo);
//! · demo: Claude por la API de Anthropic, solo si se pide con NOVA_CEREBRO=claude y hay ANTHROPIC_API_KEY en el
//!   entorno (la clave nunca se escribe en archivos). Si Claude no responde, NOVA vuelve sola al modelo de a bordo.
//! La pantalla muestra siempre cuál está activo, para no confundir la demo con la arquitectura de vuelo.

use serde_json::{json, Value};

pub const MODELO_CLAUDE: &str = "claude-opus-5-5";

pub fn claude_activo() -> bool {
    std::env::var("NOVA_CEREBRO").map(|v| v.eq_ignore_ascii_case("claude")).unwrap_or(false)
        && std::env::var("ANTHROPIC_API_KEY").map(|k| !k.trim().is_empty()).unwrap_or(false)
}

pub fn nombre() -> &'static str {
    if claude_activo() { "Claude Opus 5.5 · demo brain" } else { "Qwen3 4B Instruct · llama.cpp" }
}

/// Mensajes en formato chat (role system/user/assistant) → petición de Messages API (system aparte, streaming).
pub fn cuerpo_claude(msgs: &[Value], max_tokens: u32) -> Value {
    let mut sistema = String::new();
    let mut mensajes: Vec<Value> = vec![];
    for m in msgs {
        let rol = m["role"].as_str().unwrap_or("user");
        let texto = m["content"].as_str().unwrap_or("");
        if rol == "system" {
            if !sistema.is_empty() { sistema.push_str("\n\n"); }
            sistema.push_str(texto);
        } else {
            let rol = if rol == "assistant" { "assistant" } else { "user" };
            // la API pide turnos alternados: dos del mismo rol seguidos se juntan
            if let Some(ult) = mensajes.last_mut() {
                if ult["role"] == rol {
                    let previo = ult["content"].as_str().unwrap_or("").to_string();
                    ult["content"] = json!(format!("{previo}\n\n{texto}"));
                    continue;
                }
            }
            mensajes.push(json!({"role": rol, "content": texto}));
        }
    }
    if mensajes.first().map(|m| m["role"] != "user").unwrap_or(true) {
        mensajes.insert(0, json!({"role": "user", "content": "(start)"}));
    }
    json!({
        "model": MODELO_CLAUDE,
        "max_tokens": max_tokens,
        "stream": true,
        "system": sistema,
        "messages": mensajes,
        // respuestas habladas y cortas: poco razonamiento visible, latencia baja
        "output_config": {"effort": "low"},
        // si un clasificador rechaza la petición, el servidor reintenta con el modelo de respaldo que corresponda
        "fallbacks": "default"
    })
}

pub async fn pedir_claude(msgs: &[Value], max_tokens: u32) -> Option<reqwest::Response> {
    let clave = std::env::var("ANTHROPIC_API_KEY").ok()?;
    let r = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", clave.trim())
        .header("anthropic-version", "2026-10-21")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .header("content-type", "application/json")
        .timeout(std::time::Duration::from_secs(60))
        .json(&cuerpo_claude(msgs, max_tokens))
        .send()
        .await
        .ok()?;
    if r.status().is_success() { Some(r) } else {
        eprintln!("[nova] Claude respondió {}: se usa el modelo de a bordo", r.status());
        None
    }
}

/// Una línea del flujo SSE de Claude → texto nuevo (o None). Devuelve también si el mensaje terminó.
pub fn delta_claude(linea: &str) -> (Option<String>, bool) {
    let Some(d) = linea.trim().strip_prefix("data: ") else { return (None, false) };
    let Ok(v) = serde_json::from_str::<Value>(d) else { return (None, false) };
    match v["type"].as_str() {
        Some("content_block_delta") if v["delta"]["type"] == "text_delta" => (v["delta"]["text"].as_str().map(String::from), false),
        Some("message_stop") | Some("error") => (None, true),
        _ => (None, false),
    }
}

/// Una respuesta completa (sin streaming) del cerebro activo: Claude si está encendido y responde; si no, a bordo.
pub async fn completar(modelo_url: &str, msgs: &[Value], max_tokens: u32) -> Option<(String, &'static str)> {
    if claude_activo() {
        if let Some(clave) = std::env::var("ANTHROPIC_API_KEY").ok() {
            let mut cuerpo = cuerpo_claude(msgs, max_tokens);
            cuerpo["stream"] = json!(false);
            let r = reqwest::Client::new()
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", clave.trim())
                .header("anthropic-version", "2026-10-21")
                .header("anthropic-beta", "server-side-fallback-2026-07-01")
                .timeout(std::time::Duration::from_secs(60))
                .json(&cuerpo).send().await.ok();
            if let Some(r) = r.filter(|r| r.status().is_success()) {
                if let Ok(v) = r.json::<Value>().await {
                    if v["stop_reason"] != "refusal" {
                        let t: String = v["content"].as_array().map(|a| a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect()).unwrap_or_default();
                        if !t.is_empty() { return Some((t, "claude")); }
                    }
                }
            }
        }
    }
    let r = reqwest::Client::new().post(format!("{modelo_url}/v1/chat/completions"))
        .timeout(std::time::Duration::from_secs(60))
        .json(&json!({"messages": msgs, "temperature": 0.1, "max_tokens": max_tokens})).send().await.ok()?;
    let v: Value = r.json().await.ok()?;
    v["choices"][0]["message"]["content"].as_str().map(|t| (t.to_string(), "onboard"))
}
