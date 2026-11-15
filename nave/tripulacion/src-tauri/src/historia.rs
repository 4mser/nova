//! Historia a bordo: cada serie (tripulante · sensor) se guarda segundo a segundo por 6 h y en resúmenes por minuto
//! por 30 días. Los minutos y las alertas se escriben en disco (NDJSON, un archivo por día) y se recargan al arrancar,
//! así un reinicio de la pantalla no borra nada.

use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

const SEG_CRUDO: usize = 6 * 3600; // 6 h a 1 Hz
const MIN_GUARDADOS: usize = 30 * 24 * 60; // 30 días
const MAX_ALERTAS: usize = 500;

/// Sensores que se guardan por tripulante (nombres del contrato)
pub const SERIES: [&str; 13] = [
    "pulso", "spo2", "pa_sis", "pa_dia", "temp", "fr", "glucosa", "vfc", "sueno_h", "animo", "energia", "pasos", "fc_reposo",
];
const TRIPS: [&str; 4] = ["T1", "T2", "T3", "T4"];

#[derive(Default)]
struct Serie {
    crudo: VecDeque<(u64, f32)>,
    minutos: VecDeque<(u64, f32, f32, f32)>, // (inicio del minuto, media, mínimo, máximo)
    // minuto en curso
    min_t: u64,
    suma: f64,
    n: u32,
    lo: f32,
    hi: f32,
}

pub struct Historia {
    series: HashMap<String, Serie>,
    alertas: VecDeque<Value>,
    carpeta: PathBuf,
}

fn dia_de(t: u64) -> String {
    // fecha UTC AAAA-MM-DD sin dependencias (algoritmo civil de Howard Hinnant)
    let z = (t / 86400) as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

impl Historia {
    pub fn nueva() -> Historia {
        let carpeta = std::env::var("NOVA_DATOS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".nova-pc/historia"));
        let _ = fs::create_dir_all(&carpeta);
        let mut h = Historia { series: HashMap::new(), alertas: VecDeque::new(), carpeta };
        h.cargar();
        h
    }

    fn cargar(&mut self) {
        let Ok(dir) = fs::read_dir(&self.carpeta) else { return };
        let mut archivos: Vec<PathBuf> = dir.filter_map(|e| e.ok().map(|e| e.path())).collect();
        archivos.sort();
        let ultimos: Vec<&PathBuf> = archivos.iter().rev().take(31).collect();
        for ruta in ultimos.into_iter().rev() {
            let Ok(f) = fs::File::open(ruta) else { continue };
            let nombre = ruta.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let alertas = nombre.starts_with("alertas");
            if !alertas && !nombre.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                continue; // bitácoras y otros archivos
            }
            for linea in BufReader::new(f).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&linea) else { continue };
                if alertas {
                    self.alertas.push_back(v);
                    if self.alertas.len() > MAX_ALERTAS {
                        self.alertas.pop_front();
                    }
                } else if let (Some(s), Some(t), Some(m), Some(lo), Some(hi)) =
                    (v["s"].as_str(), v["t"].as_u64(), v["m"].as_f64(), v["lo"].as_f64(), v["hi"].as_f64())
                {
                    let serie = self.series.entry(s.to_string()).or_default();
                    serie.minutos.push_back((t, m as f32, lo as f32, hi as f32));
                    if serie.minutos.len() > MIN_GUARDADOS {
                        serie.minutos.pop_front();
                    }
                }
            }
        }
    }

    /// Bitácora de a bordo (conversaciones con NOVA, ingresos manuales): un archivo por día
    pub fn registrar(&self, tipo: &str, t: u64, linea: &Value) {
        self.escribir(&format!("{tipo}-{}.ndjson", dia_de(t)), linea);
    }

    fn escribir(&self, archivo: &str, linea: &Value) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(self.carpeta.join(archivo)) {
            let _ = writeln!(f, "{linea}");
        }
    }

    fn punto(&mut self, clave: &str, t: u64, v: f32) {
        let serie = self.series.entry(clave.to_string()).or_default();
        if serie.crudo.back().map(|p| p.0) == Some(t) {
            return; // ya está este segundo
        }
        serie.crudo.push_back((t, v));
        if serie.crudo.len() > SEG_CRUDO {
            serie.crudo.pop_front();
        }
        let minuto = t - t % 60;
        let mut cerrado = None;
        if serie.n > 0 && minuto != serie.min_t {
            let media = (serie.suma / serie.n as f64) as f32;
            serie.minutos.push_back((serie.min_t, media, serie.lo, serie.hi));
            if serie.minutos.len() > MIN_GUARDADOS {
                serie.minutos.pop_front();
            }
            cerrado = Some(json!({"s": clave, "t": serie.min_t, "m": media, "lo": serie.lo, "hi": serie.hi}));
            serie.n = 0;
        }
        if serie.n == 0 {
            serie.min_t = minuto;
            serie.suma = 0.0;
            serie.lo = v;
            serie.hi = v;
        }
        serie.suma += v as f64;
        serie.n += 1;
        serie.lo = serie.lo.min(v);
        serie.hi = serie.hi.max(v);
        if let Some(l) = cerrado {
            self.escribir(&format!("{}.ndjson", dia_de(minuto)), &l);
        }
    }

    /// Guarda los valores recién medidos de un mensaje de estado del núcleo
    pub fn estado(&mut self, m: &Value) {
        let Some(t) = m["t"].as_u64() else { return };
        if let Some(trips) = m["trip"].as_array() {
            for (i, tr) in trips.iter().enumerate().take(TRIPS.len()) {
                for k in SERIES {
                    let edad = tr["edades"][k].as_u64().unwrap_or(0);
                    // solo lo recién medido (edad 1-2 s); el instante real es t - edad + 1
                    if (1..=2).contains(&edad) {
                        if let Some(v) = tr[k].as_f64() {
                            self.punto(&format!("{}.{}", TRIPS[i], k), t + 1 - edad, v as f32);
                        }
                    }
                }
            }
        }
        for (k, nombre) in [("co2", "co2_cabina"), ("o2", "o2_cabina"), ("temp", "temp_cabina")] {
            if let Some(v) = m["cabina"][k].as_f64() {
                if v > 0.0 {
                    self.punto(&format!("CABINA.{nombre}"), t, v as f32);
                }
            }
        }
    }

    pub fn alerta(&mut self, m: &Value) {
        self.alertas.push_back(m.clone());
        if self.alertas.len() > MAX_ALERTAS {
            self.alertas.pop_front();
        }
        let dia = m["t"].as_u64().map(dia_de).unwrap_or_default();
        self.escribir(&format!("alertas-{dia}.ndjson"), m);
    }

    /// Bitácoras de los últimos `dias` días (emergencias, conversaciones, privado-cirujano…), lo más nuevo primero
    pub fn bitacora(&self, tipo: &str, dias: u64, ahora: u64, n: usize) -> Vec<Value> {
        let mut out = vec![];
        for d in 0..dias {
            let archivo = self.carpeta.join(format!("{tipo}-{}.ndjson", dia_de(ahora.saturating_sub(d * 86400))));
            if let Ok(t) = fs::read_to_string(archivo) {
                out.extend(t.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()));
            }
        }
        let clave = |v: &Value| v["t"].as_u64().map(|t| if t > 10_000_000_000 { t / 1000 } else { t }).unwrap_or(0);
        out.sort_by_key(|v| std::cmp::Reverse(clave(v)));
        out.truncate(n);
        out
    }

    pub fn alertas_desde(&self, desde: u64) -> Vec<Value> {
        self.alertas.iter().filter(|a| a["t"].as_u64().unwrap_or(0) >= desde).cloned().collect()
    }

    pub fn ultimas_alertas(&self, n: usize) -> Vec<Value> {
        self.alertas.iter().rev().take(n).rev().cloned().collect()
    }

    /// Serie para graficar: hasta `puntos` puntos de los últimos `seg` segundos (media, mínimo y máximo por tramo)
    pub fn consulta(&self, clave: &str, seg: u64, ahora: u64, puntos: usize) -> Value {
        let Some(s) = self.series.get(clave) else { return json!({"t": [], "v": [], "lo": [], "hi": []}) };
        let desde = ahora.saturating_sub(seg);
        let crudo: Vec<(u64, f32, f32, f32)> = if seg <= SEG_CRUDO as u64 {
            s.crudo.iter().filter(|p| p.0 >= desde).map(|p| (p.0, p.1, p.1, p.1)).collect()
        } else {
            s.minutos.iter().filter(|p| p.0 >= desde).cloned().collect()
        };
        let paso = (seg as f64 / puntos.max(1) as f64).max(1.0);
        let (mut t, mut v, mut lo, mut hi) = (vec![], vec![], vec![], vec![]);
        let mut i = 0;
        while i < crudo.len() {
            let tramo = desde as f64 + ((crudo[i].0 - desde) as f64 / paso).floor() * paso;
            let (mut suma, mut n, mut mn, mut mx) = (0.0f64, 0u32, f32::MAX, f32::MIN);
            while i < crudo.len() && (crudo[i].0 as f64) < tramo + paso {
                suma += crudo[i].1 as f64;
                n += 1;
                mn = mn.min(crudo[i].2);
                mx = mx.max(crudo[i].3);
                i += 1;
            }
            t.push(tramo as u64);
            v.push((suma / n as f64) as f32);
            lo.push(mn);
            hi.push(mx);
        }
        json!({"t": t, "v": v, "lo": lo, "hi": hi})
    }

    /// Resumen de una serie en una ventana (para NOVA y la vista de cada astronauta)
    pub fn resumen(&self, clave: &str, seg: u64, ahora: u64) -> Option<(f32, f32, f32, usize)> {
        let s = self.series.get(clave)?;
        let desde = ahora.saturating_sub(seg);
        let vals: Vec<f32> = if seg <= SEG_CRUDO as u64 {
            s.crudo.iter().filter(|p| p.0 >= desde && p.0 <= ahora).map(|p| p.1).collect()
        } else {
            s.minutos.iter().filter(|p| p.0 >= desde && p.0 <= ahora).map(|p| p.1).collect()
        };
        if vals.is_empty() {
            return None;
        }
        let media = vals.iter().sum::<f32>() / vals.len() as f32;
        let mn = vals.iter().cloned().fold(f32::MAX, f32::min);
        let mx = vals.iter().cloned().fold(f32::MIN, f32::max);
        Some((media, mn, mx, vals.len()))
    }
}
