/* Escritorios (Spaces) del Mac: lanza el ayudante espacios.swift (lo compila con swiftc la primera vez o cuando cambia)
   y entrega su estado: { visibles: [escritorios que se ven ahora, uno por pantalla], ventana: [escritorios de NOVA] }.
   Si no hay swiftc o falla, todo sigue funcionando como una ventana normal (consultar() devuelve null). */
const { spawn, execFile } = require('node:child_process');
const { statSync } = require('node:fs');
const { join } = require('node:path');

function crearEspacios(dirDatos, ventana, alCambiar) {
  const fuente = join(__dirname, 'espacios.swift'), bin = join(dirDatos, 'espacios-bin');
  let proc = null, pendientes = [], buffer = '';

  const viejo = () => { try { return statSync(bin).mtimeMs < statSync(fuente).mtimeMs; } catch { return true; } };
  const compilar = () => new Promise((ok, mal) => execFile('swiftc', ['-O', fuente, '-o', bin], { timeout: 180e3 }, e => (e ? mal(e) : ok())));

  const listo = (async () => {
    if (viejo()) await compilar();
    proc = spawn(bin, [String(ventana)], { stdio: ['pipe', 'pipe', 'ignore'] });
    proc.on('exit', () => { proc = null; for (const r of pendientes) r(null); pendientes = []; });
    proc.stdout.on('data', d => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linea = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let e; try { e = JSON.parse(linea); } catch { continue; }
        if (e.motivo === 'pregunta') pendientes.shift()?.(e);
        else alCambiar(e);
      }
    });
  })();
  listo.catch(e => console.warn('espacios:', e.message));

  /** el estado ahora mismo (o null si el ayudante no está) */
  async function consultar() {
    try { await listo; } catch { return null; }
    if (!proc) return null;
    return new Promise(r => {
      const t = setTimeout(() => { pendientes = pendientes.filter(x => x !== fin); r(null); }, 800);
      const fin = e => { clearTimeout(t); r(e); };
      pendientes.push(fin);
      proc.stdin.write('?\n');
    });
  }

  return { consultar, cerrar: () => proc?.kill() };
}

module.exports = { crearEspacios };
