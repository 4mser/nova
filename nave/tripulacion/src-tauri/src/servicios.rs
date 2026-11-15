//! Todo lo que la nave necesita a su lado, abierto y vigilado desde que la nave arranca (con ventana o sin ella):
//! núcleo de vuelo (F Prime + GDS), simulador de la estación, modelo de lenguaje, voz, oído, búsqueda de la biblioteca
//! y visión. Si un servicio ya está corriendo no se abre otro; si se cae, se vuelve a abrir; si falta su programa o su
//! modelo, se avisa una vez y la nave sigue sin él. Cada uno deja su registro en ~/.nova-pc/logs/<nombre>.log.
//!
//! Variables: NOVA_SIN_SERVICIOS=1 no abre nada (todo a mano) · NOVA_SIN_SIMULADOR=1 cuando está la estación real.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

enum Puerto {
    Tcp(u16),
    Udp(u16),
}

struct Servicio {
    nombre: &'static str,
    puerto: Puerto,
    programa: PathBuf,
    args: Vec<String>,
    carpeta: PathBuf,
    path_extra: Option<PathBuf>,
    requiere: Vec<PathBuf>,
}

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn casa() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default().join(".nova-pc")
}
/// un programa del PATH, o de Homebrew aunque la ventana se abra sin el PATH de la terminal
fn programa(n: &str) -> PathBuf {
    for d in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let p = PathBuf::from(d).join(n);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(n)
}
fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn lista() -> Vec<Servicio> {
    let r = raiz();
    let m = casa().join("modelos");
    let mut v = vec![
        // núcleo de vuelo: el GDS abre el binario de F Prime y deja su API REST en :5080 (la usa tierra.rs)
        Servicio {
            nombre: "núcleo de vuelo",
            puerto: Puerto::Tcp(5080),
            programa: r.join("vuelo/fprime-venv/bin/fprime-gds"),
            args: s(&["-g", "html", "--gui-port", "5080", "--skip-browser-open"]),
            carpeta: r.join("vuelo/Nova/Nave"),
            path_extra: Some(r.join("vuelo/fprime-venv/bin")),
            requiere: vec![r.join("vuelo/build-artifacts")],
        },
        Servicio {
            nombre: "modelo de lenguaje",
            puerto: Puerto::Tcp(8081),
            programa: programa("llama-server"),
            args: {
                let mut a = s(&["-m"]);
                a.push(m.join("Qwen3-4B-Instruct-2507-Q4_K_M.gguf").display().to_string());
                a.extend(s(&["--host", "127.0.0.1", "--port", "8081", "-c", "16384", "-np", "2", "-fa", "on", "-b", "2048", "-ub", "1024", "--cache-reuse", "256", "-ngl", "99", "--jinja"]));
                a
            },
            carpeta: r.clone(),
            path_extra: None,
            requiere: vec![m.join("Qwen3-4B-Instruct-2507-Q4_K_M.gguf")],
        },
        Servicio {
            nombre: "voz",
            puerto: Puerto::Tcp(8082),
            programa: r.join("voz/.venv/bin/python"),
            args: s(&["servidor.py"]),
            carpeta: r.join("voz"),
            path_extra: None,
            requiere: vec![],
        },
        Servicio {
            nombre: "oído",
            puerto: Puerto::Tcp(8083),
            programa: programa("whisper-server"),
            args: {
                let mut a = s(&["-m"]);
                a.push(m.join("ggml-large-v3-turbo-q5_0.bin").display().to_string());
                a.extend(s(&["--host", "127.0.0.1", "--port", "8083", "-l", "auto", "-t", "8", "-nt"]));
                a
            },
            carpeta: r.clone(),
            path_extra: None,
            requiere: vec![m.join("ggml-large-v3-turbo-q5_0.bin")],
        },
        Servicio {
            nombre: "búsqueda de la biblioteca",
            puerto: Puerto::Tcp(8084),
            programa: programa("llama-server"),
            args: {
                let mut a = s(&["-m"]);
                a.push(m.join("nomic-embed-text-v2-moe.Q4_K_M.gguf").display().to_string());
                a.extend(s(&["--host", "127.0.0.1", "--port", "8084", "--embedding", "-ngl", "99"]));
                a
            },
            carpeta: r.clone(),
            path_extra: None,
            requiere: vec![m.join("nomic-embed-text-v2-moe.Q4_K_M.gguf")],
        },
        Servicio {
            nombre: "visión",
            puerto: Puerto::Tcp(8792),
            programa: r.join("vision/.venv/bin/python"),
            args: s(&["servidor.py"]),
            carpeta: r.join("vision"),
            path_extra: None,
            requiere: vec![],
        },
    ];
    if std::env::var("NOVA_SIN_SIMULADOR").map(|x| x != "1").unwrap_or(true) {
        // el simulador escucha escenarios en UDP 50053: si ese puerto está tomado, ya hay uno corriendo
        v.push(Servicio {
            nombre: "simulador de la estación",
            puerto: Puerto::Udp(50053),
            programa: programa("python3"),
            args: s(&["simulador.py"]),
            carpeta: r.join("estacion/simulador"),
            path_extra: None,
            requiere: vec![],
        });
    }
    v
}

/// abre y vigila todos los servicios (cada uno en su hilo)
pub fn arrancar() {
    if std::env::var("NOVA_SIN_SERVICIOS").as_deref() == Ok("1") {
        println!("[nova] servicios a mano (NOVA_SIN_SERVICIOS=1)");
        return;
    }
    for sv in lista() {
        std::thread::spawn(move || vigilar(sv));
    }
}

fn en_uso(p: &Puerto) -> bool {
    match *p {
        Puerto::Tcp(n) => std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], n)), Duration::from_millis(300)).is_ok(),
        Puerto::Udp(n) => std::net::UdpSocket::bind(("127.0.0.1", n)).is_err() || std::net::UdpSocket::bind(("0.0.0.0", n)).is_err(),
    }
}

fn vigilar(sv: Servicio) {
    let falta: Vec<_> = std::iter::once(&sv.programa).chain(sv.requiere.iter()).filter(|p| p.is_absolute() && !p.exists()).collect();
    if !falta.is_empty() {
        eprintln!("[nova] sin {}: falta {}", sv.nombre, falta.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "));
        return;
    }
    let mut hijo: Option<Child> = None;
    let mut fallas = 0u32;
    loop {
        // un modelo que tarda en cargar no se abre dos veces: mientras su proceso viva, se espera
        let vivo = hijo.as_mut().map(|h| matches!(h.try_wait(), Ok(None))).unwrap_or(false);
        if !vivo && !en_uso(&sv.puerto) {
            if hijo.is_some() {
                fallas += 1;
            }
            hijo = abrir(&sv);
            if hijo.is_none() {
                return;
            }
        }
        // si se cae una y otra vez, se espera más entre intentos (y se ve en su registro por qué)
        std::thread::sleep(Duration::from_secs(if fallas > 3 { 30 } else { 3 }));
    }
}

fn abrir(sv: &Servicio) -> Option<Child> {
    let logs = casa().join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let archivo = logs.join(format!("{}.log", sv.nombre.split(' ').next().unwrap_or("servicio").replace('í', "i").replace('ó', "o").replace('ú', "u")));
    let f = std::fs::OpenOptions::new().create(true).append(true).open(&archivo);
    let (out, err) = match f.and_then(|f| Ok((f.try_clone()?, f))) {
        Ok((a, b)) => (Stdio::from(a), Stdio::from(b)),
        Err(_) => (Stdio::null(), Stdio::null()),
    };
    let mut c = Command::new(&sv.programa);
    c.args(&sv.args).current_dir(&sv.carpeta).stdin(Stdio::null()).stdout(out).stderr(err);
    // la ventana abierta desde el Finder no trae el PATH de la terminal
    let mut path = std::env::var("PATH").unwrap_or_default();
    for extra in sv.path_extra.iter().map(|p| p.display().to_string()).chain(["/opt/homebrew/bin".to_string(), "/usr/local/bin".to_string()]) {
        if !path.split(':').any(|x| x == extra) {
            path = format!("{extra}:{path}");
        }
    }
    c.env("PATH", path);
    match c.spawn() {
        Ok(h) => {
            println!("[nova] en marcha: {} (pid {}) · registro en {}", sv.nombre, h.id(), archivo.display());
            Some(h)
        }
        Err(e) => {
            eprintln!("[nova] no pude abrir {}: {e}", sv.nombre);
            None
        }
    }
}
