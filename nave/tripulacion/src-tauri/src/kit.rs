//! Kit médico a bordo: inventario en vivo de cada insumo (cantidad, dónde está, cuándo vence y para qué protocolo
//! sirve). Parte de ui/kit/inicial.json (packs al estilo del botiquín de la Estación Espacial) y se guarda en
//! ~/.nova-pc/kit.json cada vez que la tripulación registra un uso o corrige una cantidad. NOVA lo lee antes de nombrar
//! un insumo: dice dónde está y cuántos quedan, y avisa de lo que vence antes del regreso.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub struct Kit {
    ruta: PathBuf,
    pub datos: Value,
}

fn ruta_estado() -> PathBuf {
    std::env::var("NOVA_KIT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".nova-pc/kit.json"))
}

impl Kit {
    pub fn cargar(ui: &Path) -> Kit {
        let ruta = ruta_estado();
        let datos = fs::read_to_string(&ruta)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .or_else(|| fs::read_to_string(ui.join("kit/inicial.json")).ok().and_then(|t| serde_json::from_str(&t).ok()))
            .unwrap_or_else(|| json!({"packs": [], "items": []}));
        Kit { ruta, datos }
    }

    fn guardar(&self) {
        if let Some(c) = self.ruta.parent() {
            let _ = fs::create_dir_all(c);
        }
        let _ = fs::write(&self.ruta, serde_json::to_string_pretty(&self.datos).unwrap_or_default());
    }

    fn pack(&self, id: &str) -> Value {
        self.datos["packs"].as_array().and_then(|l| l.iter().find(|p| p["id"] == id).cloned()).unwrap_or(Value::Null)
    }

    /// Inventario con lo calculado para hoy: estado de cada ítem y cuándo vence respecto de Marte y del regreso
    pub fn vista(&self, dia: f64, llegada_marte: f64, total: f64) -> Value {
        let mut d = self.datos.clone();
        let (mut bajos, mut agotados, mut vencidos, mut antes_regreso, mut antes_marte) = (0, 0, 0, 0, 0);
        if let Some(items) = d["items"].as_array_mut() {
            for it in items.iter_mut() {
                let cant = it["cantidad"].as_f64().unwrap_or(0.0);
                let min = it["minimo"].as_f64().unwrap_or(0.0);
                let estado = if cant <= 0.0 { agotados += 1; "agotado" } else if cant < min { bajos += 1; "bajo" } else { "ok" };
                it["estado"] = json!(estado);
                if let Some(v) = it["vence_dia"].as_f64() {
                    let en = v - dia;
                    it["vence_en_dias"] = json!(en.round());
                    let cuando = if en <= 0.0 {
                        vencidos += 1;
                        "vencido"
                    } else if v < llegada_marte {
                        antes_marte += 1;
                        antes_regreso += 1;
                        "antes_de_marte"
                    } else if v < total {
                        antes_regreso += 1;
                        "antes_del_regreso"
                    } else {
                        "dura_la_mision"
                    };
                    it["vence_cuando"] = json!(cuando);
                }
            }
        }
        d["resumen"] = json!({"items": d["items"].as_array().map(|l| l.len()).unwrap_or(0), "bajos": bajos, "agotados": agotados,
            "vencidos": vencidos, "vencen_antes_del_regreso": antes_regreso, "vencen_antes_de_marte": antes_marte,
            "dia": dia.floor(), "llegada_marte": llegada_marte.round(), "total": total});
        d
    }

    /// Registrar un uso (resta) o corregir la cantidad contada (fija). Devuelve el ítem actualizado.
    pub fn cambiar(&mut self, id: &str, usar: Option<f64>, fijar: Option<f64>) -> Option<Value> {
        let it = self.datos["items"].as_array_mut()?.iter_mut().find(|x| x["id"] == id)?;
        let cant = it["cantidad"].as_f64().unwrap_or(0.0);
        let nueva = match (usar, fijar) {
            (_, Some(f)) => f.max(0.0),
            (Some(u), None) => (cant - u).max(0.0),
            _ => cant,
        };
        it["cantidad"] = json!(nueva);
        let out = it.clone();
        self.guardar();
        Some(out)
    }

    /// Texto compacto para NOVA: qué hay, cuánto y dónde
    pub fn texto(&self, dia: f64, total: f64) -> String {
        let mut t = String::new();
        for p in self.datos["packs"].as_array().cloned().unwrap_or_default() {
            t += &format!("* {} — {}\n", p["n"].as_str().unwrap_or(""), p["donde"].as_str().unwrap_or(""));
            for it in self.datos["items"].as_array().cloned().unwrap_or_default().iter().filter(|i| i["pack"] == p["id"]) {
                let cant = it["cantidad"].as_f64().unwrap_or(0.0);
                let mut extra = String::new();
                if cant <= 0.0 {
                    extra += " — NONE LEFT";
                } else if cant < it["minimo"].as_f64().unwrap_or(0.0) {
                    extra += " — low";
                }
                if let Some(v) = it["vence_dia"].as_f64() {
                    if v <= dia {
                        extra += " — EXPIRED";
                    } else if v < total {
                        extra += &format!(" — expires mission day {v:.0}, before the return");
                    }
                }
                t += &format!("  - {}: {} {}{extra}\n", it["n"].as_str().unwrap_or(""), cant, it["unidad"].as_str().unwrap_or(""));
            }
        }
        t
    }

    /// Para una emergencia: los insumos de ese protocolo, con dónde están y cuántos quedan
    pub fn para_protocolo(&self, protocolo: &str, es: bool) -> String {
        let mut l = vec![];
        for it in self.datos["items"].as_array().cloned().unwrap_or_default() {
            if !it["protocolos"].as_array().map(|p| p.iter().any(|x| x == protocolo)).unwrap_or(false) {
                continue;
            }
            let p = self.pack(it["pack"].as_str().unwrap_or(""));
            let cant = it["cantidad"].as_f64().unwrap_or(0.0);
            l.push(if cant <= 0.0 {
                format!("{} — {}", it["n"].as_str().unwrap_or(""), if es { "NO QUEDA" } else { "NONE LEFT" })
            } else {
                format!("{} ({cant} {}) — {}", it["n"].as_str().unwrap_or(""), if es { "quedan" } else { "left" }, p["donde"].as_str().unwrap_or(""))
            });
        }
        if l.is_empty() {
            return String::new();
        }
        format!("\n{}\n{}", if es { "Del kit médico:" } else { "From the medical kit:" }, l.iter().map(|x| format!("· {x}")).collect::<Vec<_>>().join("\n"))
    }
}
