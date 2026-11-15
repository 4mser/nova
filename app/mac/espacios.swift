// Escritorios (Spaces) de macOS para el widget: en qué escritorio está la ventana de NOVA y cuáles se ven ahora.
// Electron no expone esto. Lo compila espacios.js con swiftc la primera vez.
// Uso: espacios <CGWindowID>. Imprime una línea JSON {"motivo","visibles":[ids],"ventana":[ids],"escritorios":[ids],"aqui":id,"activa":id}
// (escritorios: los normales, no los de apps a pantalla completa; aqui: el escritorio que se ve en la pantalla de NOVA)
// al arrancar, cada vez que cambia el escritorio activo y cada vez que recibe una línea por stdin.
// Usa funciones privadas de SkyLight (CGS*), solo de lectura.
import AppKit
import CoreGraphics

typealias Conexion = Int32
@_silgen_name("CGSMainConnectionID") func CGSMainConnectionID() -> Conexion
@_silgen_name("CGSGetActiveSpace") func CGSGetActiveSpace(_ c: Conexion) -> Int
@_silgen_name("CGSCopyManagedDisplaySpaces") func CGSCopyManagedDisplaySpaces(_ c: Conexion) -> CFArray
@_silgen_name("CGSCopySpacesForWindows") func CGSCopySpacesForWindows(_ c: Conexion, _ mask: Int32, _ wids: CFArray) -> CFArray

let conexion = CGSMainConnectionID()
let ventana = Int(CommandLine.arguments.dropFirst().first ?? "0") ?? 0

/// la pantalla (su identificador de Spaces) donde está el centro de la ventana
func pantallaDeVentana() -> String? {
  guard let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(ventana)) as? [[String: Any]])?.first,
        let b = info[kCGWindowBounds as String] as? [String: Double] else { return nil }
  let centro = CGPoint(x: b["X"]! + b["Width"]! / 2, y: b["Y"]! + b["Height"]! / 2)
  var ids = [CGDirectDisplayID](repeating: 0, count: 16), n: UInt32 = 0
  CGGetActiveDisplayList(16, &ids, &n)
  for id in ids.prefix(Int(n)) where CGDisplayBounds(id).contains(centro) {
    if let u = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() { return CFUUIDCreateString(nil, u) as String }
  }
  return nil
}

func estado(_ motivo: String) {
  var visibles: [Int] = [], escritorios: [Int] = [], aqui: Any = NSNull()
  let pantalla = pantallaDeVentana()
  let lista = CGSCopyManagedDisplaySpaces(conexion) as? [[String: Any]] ?? []
  for d in lista {
    let actual = (d["Current Space"] as? [String: Any])?["ManagedSpaceID"] as? Int
    if let a = actual { visibles.append(a) }
    // type 0 = escritorio normal; 4 = app a pantalla completa
    for e in d["Spaces"] as? [[String: Any]] ?? [] where (e["type"] as? Int) == 0 { if let id = e["ManagedSpaceID"] as? Int { escritorios.append(id) } }
    let ident = d["Display Identifier"] as? String
    if let a = actual, lista.count == 1 || ident == "Main" || ident?.caseInsensitiveCompare(pantalla ?? "") == .orderedSame { aqui = a }
  }
  let suyos = (CGSCopySpacesForWindows(conexion, 7, [ventana] as CFArray) as? [Int]) ?? []
  let json: [String: Any] = ["motivo": motivo, "visibles": visibles, "ventana": suyos, "escritorios": escritorios, "aqui": aqui, "activa": CGSGetActiveSpace(conexion)]
  if let datos = try? JSONSerialization.data(withJSONObject: json), let linea = String(data: datos, encoding: .utf8) {
    print(linea)
    fflush(stdout)
  }
}

NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
  estado("cambio")
}
FileHandle.standardInput.readabilityHandler = { h in
  if h.availableData.isEmpty { exit(0) } // Electron se cerró
  DispatchQueue.main.async { estado("pregunta") }
}
estado("inicio")
RunLoop.main.run()
