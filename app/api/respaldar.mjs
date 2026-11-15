/* Respaldo de la API de NOVA fuera de Fly (a este Mac): copia consistente de la base (VACUUM INTO en el servidor) y
   las fotos y avatares que falten (incremental: solo baja lo nuevo o lo que cambió de tamaño).
     ~/Respaldos/nova/base/nova-AAAA-MM-DD.db   (se guardan las últimas 30)
     ~/Respaldos/nova/fotos/…  ~/Respaldos/nova/avatares/…
   Usa la clave de administrador de ~/.nova-api. Lo corre launchd cada día (api/respaldo-diario.sh instala el agente).
   Uso a mano: node api/respaldar.mjs   [API=http://localhost:8140 ADMIN=a DESTINO=/tmp/x para probar] */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const API = (process.env.API ?? 'https://nova-bn-api.fly.dev').replace(/\/$/, '');
const DESTINO = process.env.DESTINO ?? join(homedir(), 'Respaldos', 'nova');
const ADMIN = process.env.ADMIN ?? readFileSync(join(homedir(), '.nova-api'), 'utf8').match(/NOVA_API_ADMIN=(\S+)/)?.[1];
if (!ADMIN) throw new Error('Falta la clave de administrador (~/.nova-api)');
const cab = { 'x-admin': ADMIN };

async function bajar(ruta) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${ruta}`, { headers: cab });
      if (!r.ok) throw new Error(`${r.status} ${ruta}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i >= 3) throw e; await new Promise(res => setTimeout(res, 2000 * (i + 1))); } // la máquina de Fly puede estar despertando
  }
}

const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const dirBase = join(DESTINO, 'base');
mkdirSync(dirBase, { recursive: true });

// 1 · la base
const base = await bajar('/v1/admin/respaldo/base');
if (base.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('la base descargada no es SQLite');
writeFileSync(join(dirBase, `nova-${hoy}.db`), base);
const copias = readdirSync(dirBase).filter(n => /^nova-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();
for (const n of copias.slice(0, -30)) rmSync(join(dirBase, n));

// 2 · fotos y avatares nuevos
const lista = JSON.parse((await bajar('/v1/admin/respaldo/archivos')).toString());
let nuevos = 0, bytes = 0;
for (const a of lista) {
  const f = join(DESTINO, a.ruta);
  if (existsSync(f) && statSync(f).size === a.tam) continue;
  const b = await bajar(`/v1/admin/respaldo/archivo?ruta=${encodeURIComponent(a.ruta)}`);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, b);
  nuevos++; bytes += b.length;
}
const linea = `${new Date().toISOString()} base ${(base.length / 1024).toFixed(0)} KB · ${lista.length} archivos (${nuevos} nuevos, ${(bytes / 1048576).toFixed(1)} MB)`;
writeFileSync(join(DESTINO, 'ultimo.txt'), linea + '\n');
console.log(linea);
