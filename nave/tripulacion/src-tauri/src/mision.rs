//! La misión y su geometría: día de misión, posición de la nave en una transferencia de Hohmann Tierra → Marte,
//! distancia real a la Tierra, retraso de la luz y conjunción solar.
//!
//! Tierra y Marte con los elementos orbitales medios de J2000 y sus tasas por siglo (Standish, JPL, «Keplerian
//! Elements for Approximate Positions of the Major Planets»), en el plano de la eclíptica. La nave sale desde la
//! posición real de la Tierra el día del lanzamiento y sigue la elipse de transferencia hasta la órbita de Marte.

use serde_json::{json, Value};
use std::f64::consts::PI;

const KM_POR_UA: f64 = 149_597_870.7;
const SEG_LUZ_POR_UA: f64 = 499.004_784;
const DIA_J2000_UNIX: f64 = 10_957.5; // 2000-01-01 12:00 TT ≈ días Unix

/// Configuración de la misión (se puede cambiar con variables de entorno)
pub struct Mision {
    pub lanzamiento: f64, // segundos Unix
    pub estadia_dias: f64,
}

impl Mision {
    pub fn desde_entorno() -> Mision {
        // Por defecto: lanzamiento el 8 de abril de 2026 (día 214 el 8 de noviembre), 500 días en Marte
        let lanzamiento = std::env::var("NOVA_LANZAMIENTO").ok().and_then(|s| s.parse().ok()).unwrap_or(1_775_606_400.0);
        let estadia_dias = std::env::var("NOVA_ESTADIA_DIAS").ok().and_then(|s| s.parse().ok()).unwrap_or(500.0);
        Mision { lanzamiento, estadia_dias }
    }
}

struct Elementos {
    a: (f64, f64),
    e: (f64, f64),
    l: (f64, f64),
    peri: (f64, f64),
}
const TIERRA: Elementos = Elementos { a: (1.000_002_61, 0.000_005_62), e: (0.016_711_23, -0.000_043_92), l: (100.464_571_66, 35_999.372_449_81), peri: (102.937_681_93, 0.323_273_64) };
const MARTE: Elementos = Elementos { a: (1.523_710_34, 0.000_018_47), e: (0.093_394_10, 0.000_078_82), l: (-4.553_432_05, 19_140.302_684_99), peri: (-23.943_629_59, 0.444_410_88) };

fn kepler(m: f64, e: f64) -> f64 {
    let mut ex = m + e * m.sin();
    for _ in 0..30 {
        let d = (ex - e * ex.sin() - m) / (1.0 - e * ex.cos());
        ex -= d;
        if d.abs() < 1e-12 {
            break;
        }
    }
    ex
}

/// Posición heliocéntrica (UA) en la eclíptica
fn posicion(p: &Elementos, unix: f64) -> (f64, f64) {
    let siglos = (unix / 86400.0 - DIA_J2000_UNIX) / 36525.0;
    let a = p.a.0 + p.a.1 * siglos;
    let e = p.e.0 + p.e.1 * siglos;
    let l = (p.l.0 + p.l.1 * siglos).to_radians();
    let w = (p.peri.0 + p.peri.1 * siglos).to_radians();
    let m = (l - w).rem_euclid(2.0 * PI);
    let ex = kepler(m, e);
    let x = a * (ex.cos() - e);
    let y = a * (1.0 - e * e).sqrt() * ex.sin();
    let (s, c) = w.sin_cos();
    (x * c - y * s, x * s + y * c)
}

pub fn estado(m: &Mision, ahora: f64) -> Value {
    let dia = ((ahora - m.lanzamiento) / 86400.0).max(0.0);
    let tierra0 = posicion(&TIERRA, m.lanzamiento);
    let r1 = (tierra0.0.powi(2) + tierra0.1.powi(2)).sqrt();
    let th0 = tierra0.1.atan2(tierra0.0);
    let r2 = MARTE.a.0;
    let at = (r1 + r2) / 2.0;
    let et = (r2 - r1) / (r2 + r1);
    let periodo_dias = at.powf(1.5) * 365.256_363;
    let transferencia = periodo_dias / 2.0;

    let (fase, nave) = if dia < transferencia {
        let mm = 2.0 * PI * dia / periodo_dias;
        let ex = kepler(mm, et);
        let r = at * (1.0 - et * ex.cos());
        let nu = 2.0 * (((1.0 + et) / (1.0 - et)).sqrt() * (ex / 2.0).tan()).atan();
        ("cruise", (r * (th0 + nu).cos(), r * (th0 + nu).sin()))
    } else if dia < transferencia + m.estadia_dias {
        ("mars", posicion(&MARTE, ahora))
    } else {
        ("return", posicion(&MARTE, ahora))
    };

    let tierra = posicion(&TIERRA, ahora);
    let (dx, dy) = (nave.0 - tierra.0, nave.1 - tierra.1);
    let dist = (dx * dx + dy * dy).sqrt();
    // elongación: ángulo Sol–Tierra–nave visto desde la Tierra (menos de ~2° = conjunción, se suspenden los comandos)
    let (sx, sy) = (-tierra.0, -tierra.1);
    let coseno = (dx * sx + dy * sy) / (dist * (sx * sx + sy * sy).sqrt());
    let elongacion = coseno.clamp(-1.0, 1.0).acos().to_degrees();
    let total = transferencia + m.estadia_dias + transferencia;
    let marte = posicion(&MARTE, ahora);

    json!({
        "dia": dia.floor() as u64,
        "dia_exacto": dia,
        "fase": fase,
        "transferencia_dias": transferencia.round(),
        "llegada_en_dias": (transferencia - dia).max(0.0).ceil(),
        "total_dias": total.round(),
        "distancia_km": (dist * KM_POR_UA).round(),
        "distancia_ua": dist,
        "luz_seg": dist * SEG_LUZ_POR_UA,
        "elongacion_grados": elongacion,
        "conjuncion": elongacion < 2.0,
        "nave_ua": [nave.0, nave.1],
        "tierra_ua": [tierra.0, tierra.1],
        "marte_ua": [marte.0, marte.1],
    })
}
