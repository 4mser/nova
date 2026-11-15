//! Radiación de la nave: el detector activo que diseñó Luis González (neutrones ⁶LiF/ZnS:Ag en esfera de Bonner,
//! telescopio ΔE-E, espectrómetro de LET y canal rápido de alerta de partículas solares; propuesta en
//! equipo/luis-gonzalez/radiacion) manda su lectura a POST /v1/radiacion. Mientras no esté a bordo, la tasa se
//! simula con lo que midió MSL RAD camino a Marte y en su superficie (crucero ~1,84 mSv/día, Zeitlin et al. 2013;
//! superficie ~0,64 mSv/día, Hassler et al. 2014) y se dice que es simulada.
//! · Tormenta solar (SPE): la declara el canal rápido del detector (alerta_spe) o una tasa ≥ 500 µSv/h sostenida
//!   30 s; termina tras 5 min bajo 200 µSv/h. Se avisa a todas las pantallas por el flujo y queda en la bitácora.
//! · Límites (NASA-STD-3001 Vol. 1, OCHMO Technical Brief Radiation Protection p. 1 y 4): 600 mSv en la carrera y
//!   250 mSv por evento solar. El protocolo «tormenta_solar» lleva a la tripulación al refugio (p. 2 y 10).
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const CRUCERO_MSV_DIA: f64 = 1.84;
const MARTE_MSV_DIA: f64 = 0.64;
const UMBRAL_SPE: f64 = 500.0; // µSv/h
const FIN_SPE: f64 = 200.0;
const LIMITE_CARRERA: f64 = 600.0;
const LIMITE_EVENTO: f64 = 250.0;

#[derive(Default)]
struct Estado {
    det_t: u64,                 // última lectura real del detector (ms)
    det: Value,                 // esa lectura
    tasa: f64,                  // µSv/h ahora
    simulada: bool,
    medido_msv: f64,            // dosis integrada con el detector real desde que llegó
    serie: VecDeque<(u64, f64)>, // (s, µSv/h) cada minuto, 24 h
    spe: bool,
    spe_desde: u64,
    spe_pico: f64,
    spe_msv: f64,
    spe_demo: Option<u64>,      // inicio del escenario de demostración (ms)
    sobre: u64,                 // desde cuándo la tasa supera el umbral (ms)
    bajo: u64,                  // desde cuándo está bajo el fin (ms)
    t_ult: u64,
}

fn estado() -> &'static Mutex<Estado> {
    static E: OnceLock<Mutex<Estado>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(Estado::default()))
}

/// tasa simulada de fondo (rayos cósmicos) según la fase, con una variación lenta; y el perfil de la tormenta de demo
fn tasa_modelo(fase: &str, ahora: u64, demo: Option<u64>) -> f64 {
    let base = if fase == "mars" { MARTE_MSV_DIA } else { CRUCERO_MSV_DIA } * 1000.0 / 24.0;
    let s = ahora as f64 / 1000.0;
    let mut v = base * (1.0 + 0.04 * (s / 900.0).sin() + 0.02 * (s / 97.0).sin());
    if let Some(t0) = demo {
        // demo: sube en 40 s a ~4 mSv/h, se mantiene 60 s y baja en 120 s (comprimido; un evento real dura horas o días)
        let x = (ahora.saturating_sub(t0)) as f64 / 1000.0;
        let pico = 4000.0;
        let f = if x < 40.0 { x / 40.0 } else if x < 100.0 { 1.0 } else if x < 220.0 { 1.0 - (x - 100.0) / 120.0 } else { 0.0 };
        v += pico * f.max(0.0).powf(1.5);
    }
    v
}

fn dosis_mision(m: &Value) -> (f64, f64) {
    let dia = m["dia_exacto"].as_f64().unwrap_or(0.0);
    let tr = m["transferencia_dias"].as_f64().unwrap_or(259.0);
    let total = m["total_dias"].as_f64().unwrap_or(1018.0);
    let sup = total - 2.0 * tr;
    let crucero = dia.min(tr) + (dia - tr - sup).max(0.0);
    let marte = (dia - tr).clamp(0.0, sup);
    (crucero * CRUCERO_MSV_DIA + marte * MARTE_MSV_DIA, if dia < tr || dia > tr + sup { CRUCERO_MSV_DIA } else { MARTE_MSV_DIA })
}

fn avisar(nave: &crate::Nave, e: &Estado) {
    let _ = nave.tx.send(json!({"tipo": "radiacion", "spe": e.spe, "tasa": e.tasa, "simulada": e.simulada, "desde": e.spe_desde}).to_string());
}

/// cada 2 s: la tasa (real o simulada), la integración, la serie de 24 h y la detección de la tormenta
pub async fn vigilar(nave: crate::Nave) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let ahora = crate::ahora_ms();
        let m = crate::mision::estado(&nave.mision, ahora as f64 / 1000.0);
        let fase = m["fase"].as_str().unwrap_or("cruise").to_string();
        let mut evento: Option<(bool, f64, f64)> = None;
        {
            let Ok(mut g) = estado().lock() else { continue };
            let e = &mut *g;   // préstamos por campo
            let real = ahora.saturating_sub(e.det_t) < 120_000;
            if let Some(t0) = e.spe_demo { if ahora.saturating_sub(t0) > 240_000 { e.spe_demo = None; } }
            let demo = e.spe_demo;
            e.simulada = !real;
            e.tasa = if real { e.det["tasa_usv_h"].as_f64().unwrap_or(0.0) } else { tasa_modelo(&fase, ahora, demo) };
            let dt_h = if e.t_ult > 0 { (ahora - e.t_ult) as f64 / 3_600_000.0 } else { 0.0 };
            e.t_ult = ahora;
            if real { e.medido_msv += e.tasa * dt_h / 1000.0; }
            if e.spe { e.spe_msv += e.tasa * dt_h / 1000.0; e.spe_pico = e.spe_pico.max(e.tasa); }
            let minuto = ahora / 60_000 * 60;
            if e.serie.back().map(|p| p.0) != Some(minuto) { let t = e.tasa; e.serie.push_back((minuto, t)); if e.serie.len() > 1440 { e.serie.pop_front(); } }
            else if let Some(p) = e.serie.back_mut() { p.1 = p.1.max(e.tasa); }
            // la tormenta: el canal rápido del detector manda; si no, la tasa
            let alerta_det = real && e.det["alerta_spe"].as_bool().unwrap_or(false);
            if e.tasa >= UMBRAL_SPE { if e.sobre == 0 { e.sobre = ahora; } } else { e.sobre = 0; }
            if e.tasa < FIN_SPE { if e.bajo == 0 { e.bajo = ahora; } } else { e.bajo = 0; }
            let fin_espera = if demo.is_some() || e.simulada { 20_000 } else { 300_000 };
            if !e.spe && (alerta_det || (e.sobre > 0 && ahora - e.sobre >= 30_000) || (demo.is_some() && e.tasa >= UMBRAL_SPE)) {
                e.spe = true; e.spe_desde = ahora; e.spe_pico = e.tasa; e.spe_msv = 0.0;
                evento = Some((true, e.tasa, 0.0));
            } else if e.spe && !alerta_det && e.bajo > 0 && ahora - e.bajo >= fin_espera {
                e.spe = false;
                evento = Some((false, e.spe_pico, e.spe_msv));
            }
            if evento.is_some() { avisar(&nave, e); }
        }
        if let Some((inicio, pico, msv)) = evento {
            if let Ok(h) = nave.historia.lock() {
                h.registrar("radiacion", crate::ahora_seg(), &json!({"t": crate::ahora_seg(), "evento": if inicio { "spe_inicio" } else { "spe_fin" }, "pico_usv_h": pico, "dosis_evento_msv": msv}));
            }
        }
    }
}

/// POST /v1/radiacion: la lectura del detector {"tasa_usv_h":…, "alerta_spe":false, "let_kev_um":…, "neutrones_usv_h":…, "protones_cm2_s":…, "est":"radiacion-1"}
pub async fn leer(State(nave): State<crate::Nave>, h: HeaderMap, Json(c): Json<Value>) -> Response {
    if !nave.autorizado(&h) {
        return (StatusCode::UNAUTHORIZED, "token de la nave inválido").into_response();
    }
    let Some(t) = c["tasa_usv_h"].as_f64().filter(|v| (0.0..=1.0e6).contains(v)) else {
        return (StatusCode::BAD_REQUEST, "falta tasa_usv_h (µSv/h, 0 a 1e6)").into_response();
    };
    if c.to_string().len() > 4_000 { return (StatusCode::PAYLOAD_TOO_LARGE, "lectura muy grande").into_response(); }
    let Ok(mut e) = estado().lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    e.det_t = crate::ahora_ms();
    e.det = c.clone();
    e.tasa = t;
    Json(json!({"ok": true})).into_response()
}

/// POST /v1/radiacion/demo {"spe":true|false}: tormenta solar de demostración (simulada y marcada como tal)
pub async fn demo(State(nave): State<crate::Nave>, Json(c): Json<Value>) -> Response {
    let fin = {
        let Ok(mut e) = estado().lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
        if c["spe"].as_bool().unwrap_or(true) { e.spe_demo = Some(crate::ahora_ms()); None }
        else {
            e.spe_demo = None;
            if e.spe { e.spe = false; avisar(&nave, &e); Some((e.spe_pico, e.spe_msv)) } else { None }
        }
    };
    // cortarla a mano también deja el final en la bitácora, con su pico y su dosis
    if let Some((pico, msv)) = fin {
        if let Ok(h) = nave.historia.lock() {
            h.registrar("radiacion", crate::ahora_seg(), &json!({"t": crate::ahora_seg(), "evento": "spe_fin", "pico_usv_h": pico, "dosis_evento_msv": msv, "demo": true}));
        }
    }
    Json(json!({"ok": true})).into_response()
}

/// GET /v1/radiacion: tasa de ahora, de dónde viene, dosis de la misión frente a los límites, tormenta y serie de 24 h
pub async fn ver(State(nave): State<crate::Nave>) -> Response {
    let ahora = crate::ahora_ms();
    let m = crate::mision::estado(&nave.mision, ahora as f64 / 1000.0);
    let (msv, por_dia) = dosis_mision(&m);
    let Ok(e) = estado().lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    let paso = (e.serie.len() / 144).max(1);
    let serie: Vec<Value> = e.serie.iter().step_by(paso).map(|(t, v)| json!([t, (v * 10.0).round() / 10.0])).collect();
    Json(json!({
        "tasa_usv_h": (e.tasa * 10.0).round() / 10.0,
        "fuente": if e.simulada { "simulado (MSL RAD)" } else { "detector" },
        "simulada": e.simulada,
        "detector": if e.simulada { Value::Null } else { e.det.clone() },
        "medido_msv": e.medido_msv,
        "mision": {"msv": msv, "msv_dia": por_dia, "limite_msv": LIMITE_CARRERA, "fraccion": msv / LIMITE_CARRERA, "metodo": "MSL RAD rates × mission days"},
        "spe": {"activa": e.spe, "desde": e.spe_desde, "pico_usv_h": e.spe_pico, "dosis_msv": e.spe_msv, "limite_evento_msv": LIMITE_EVENTO, "demo": e.spe_demo.is_some()},
        "serie": serie,
    })).into_response()
}

/// para el contexto de NOVA
pub fn resumen(m: &Value) -> String {
    let (msv, _) = dosis_mision(m);
    let Ok(e) = estado().lock() else { return String::new() };
    let mut s = format!(
        "Radiation: {:.0} µSv/h now ({}); mission dose about {:.0} mSv of the 600 mSv career limit (estimated from MSL RAD rates).",
        e.tasa, if e.simulada { "simulated until the onboard detector is installed" } else { "onboard detector" }, msv
    );
    if e.spe {
        s += &format!(" SOLAR PARTICLE EVENT IN PROGRESS since {} min ago, peak {:.0} µSv/h: the whole crew must stay in the storm shelter (crew quarters, extra water shielding) until it ends.", (crate::ahora_ms().saturating_sub(e.spe_desde)) / 60_000, e.spe_pico);
    }
    s
}
