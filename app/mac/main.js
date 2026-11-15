/* NOVA en el Mac: una ventana sin bordes, transparente y siempre encima, con NOVA flotando.
   · ⌥Espacio: NOVA personal (puente de voz con Gemini) · ⌥⇧Espacio: Claude Code, con voz 100 % local
   · ⌥⇧N la muestra o la esconde; NOVA sigue el cursor por toda la pantalla
   · arrastrarla la mueve (recuerda dónde quedó); clic derecho abre el menú
   · la API y las herramientas corren aquí (proceso principal): el token de la cuenta nunca llega a la página y queda
     cifrado con el Llavero del Mac (safeStorage)
   La voz va directo al puente de Fly (servidor/voz.mjs): la clave de Gemini nunca está en este Mac. */
const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, safeStorage, screen, session, shell, systemPreferences } = require('electron');
const { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { crearApi } = require('./api');
const { ejecutar } = require('./herramientas');
const { Claude } = require('./claude');
const { crearEscucha } = require('./escucha');
const { crearEspacios } = require('./espacios');

/* ── configuración: mac/.env (VOZ_URL, VOZ_TOKEN, API_URL) ── */
function leerEnv() {
  const env = {}, ruta = join(__dirname, '.env');
  if (existsSync(ruta)) for (const l of readFileSync(ruta, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return {
    vozUrl: (process.env.VOZ_URL ?? env.VOZ_URL ?? 'https://nova-voz.fly.dev').replace(/\/$/, ''),
    vozToken: process.env.VOZ_TOKEN ?? env.VOZ_TOKEN ?? '',
    apiUrl: (process.env.API_URL ?? env.API_URL ?? 'https://nova-bn-api.fly.dev').replace(/\/$/, ''),
    vozMac: process.env.VOZ_MAC ?? env.VOZ_MAC ?? 'Paulina',
  };
}
const CONFIG = leerEnv();

/* ── estado guardado en la carpeta de la app: posición de la ventana y la sesión cifrada ── */
const DIR = app.getPath('userData');
mkdirSync(DIR, { recursive: true });
const RUTA_PREF = join(DIR, 'preferencias.json'), RUTA_SESION = join(DIR, 'sesion.bin');
const leerPref = () => { try { return JSON.parse(readFileSync(RUTA_PREF, 'utf8')); } catch { return {}; } };
const guardarPref = p => { try { writeFileSync(RUTA_PREF, JSON.stringify({ ...leerPref(), ...p })); } catch {} };

const sesion = {
  leer() {
    try { return existsSync(RUTA_SESION) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(readFileSync(RUTA_SESION)) : null; } catch { return null; }
  },
  guardar(t) {
    if (!t) { try { unlinkSync(RUTA_SESION); } catch {} return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El Llavero del Mac no está disponible para guardar la sesión');
    writeFileSync(RUTA_SESION, safeStorage.encryptString(t));
  },
};
const api = crearApi(CONFIG.apiUrl, sesion);
const escucha = crearEscucha(DIR, { voz: CONFIG.vozMac, puente: { url: CONFIG.vozUrl, token: CONFIG.vozToken } });
const claude = new Claude(ev => win?.webContents.send('claude', ev), { reglas: leerPref().siempre ?? [], guardarReglas: siempre => guardarPref({ siempre }),
  cuenta: (nombre, args) => ejecutar(nombre, args, { api, win }).catch(e => ({ ok: false, motivo: e.message })) });

/* ── ventana ── */
// NOVA (#escena, 210 px) va pegada a un borde de la ventana: arriba si está en la mitad de arriba de la pantalla (el
// panel se abre hacia abajo) y abajo si está en la mitad de abajo (el panel se abre hacia arriba). Así la ventana
// siempre cabe en la pantalla, esté NOVA donde esté
const ANCHO = 480, MEDIA = 105;
let win = null, tray = null, abajo = false;

/** la ventana para NOVA con su centro en (ax, ay) */
function marco(ax, ay) {
  const wa = screen.getDisplayNearestPoint({ x: Math.round(ax), y: Math.round(ay) }).workArea;
  const alto = Math.min(900, wa.height - 16), bajo = ay > wa.y + wa.height / 2;
  return { bajo, b: { x: Math.round(ax - ANCHO / 2), y: Math.round(bajo ? ay + MEDIA - alto : ay - MEDIA), width: ANCHO, height: alto } };
}
/** el centro de NOVA en la pantalla */
function centro() { const b = win.getBounds(); return { x: b.x + ANCHO / 2, y: abajo ? b.y + b.height - MEDIA : b.y + MEDIA }; }
/** pone a NOVA con su centro en (ax, ay), da vuelta el panel si cambió de mitad y lo recuerda */
function ubicar(ax, ay) {
  const { bajo, b } = marco(ax, ay);
  if (bajo !== abajo) { abajo = bajo; win.webContents.send('lado', abajo); }
  win.setBounds(b);
  guardarPref({ nova: { x: Math.round(ax), y: Math.round(ay) } });
}
function esquina() { const a = screen.getPrimaryDisplay().workArea; return { x: a.x + a.width - ANCHO / 2 - 24, y: a.y + a.height - MEDIA - 12 }; }

function centroInicial() {
  const pref = leerPref();
  // `pos` (versiones anteriores) era la esquina de la ventana con NOVA arriba
  const p = pref.nova ?? (pref.pos && { x: pref.pos.x + ANCHO / 2, y: pref.pos.y + MEDIA });
  const visible = p && screen.getAllDisplays().some(d => p.x >= d.bounds.x && p.x <= d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y <= d.bounds.y + d.bounds.height);
  return visible ? p : esquina();
}

function crearVentana() {
  const c = centroInicial(), { bajo, b } = marco(c.x, c.y);
  abajo = bajo;
  win = new BrowserWindow({
    // enableLargerThanScreen: sin esto macOS «corrige» la ventana cuando cruza de una pantalla a otra o toca la barra de
    // menú (la empuja de vuelta) y NOVA se separa del cursor al arrastrarla
    ...b, frame: false, transparent: true, hasShadow: false, resizable: false, maximizable: false, enableLargerThanScreen: true,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // vive en SU escritorio (no en todos ni en las apps a pantalla completa); si la llamas desde otro, va de visita
  win.setAlwaysOnTop(true, 'floating');
  // lo transparente deja pasar el ratón a lo de abajo; la página avisa cuando el ratón está sobre NOVA o un control
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(join(__dirname, 'pagina', 'index.html'), { query: abajo ? { abajo: '1' } : {} });
  win.on('blur', () => soltar());
  const wid = Number(win.getMediaSourceId().split(':')[1]);
  espacios = crearEspacios(DIR, wid, alCambiarEspacio);
  if (process.argv.includes('--captura')) capturar();
  seguirCursor();
}

/* arrastre: lo hace este proceso con la posición real del cursor (no con deltas de la página, que se desfasan
   mientras la ventana se mueve). La página solo avisa cuándo empieza y cuándo termina */
let arrastre = null;
function arrastrar() {
  soltar(false);
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  arrastre = { dx: c.x - b.x, dy: c.y - b.y, w: b.width, h: b.height, antes: c };
  arrastre.t = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (p.x === arrastre.antes.x && p.y === arrastre.antes.y) return;
    arrastre.antes = p;
    win.setBounds({ x: p.x - arrastre.dx, y: p.y - arrastre.dy, width: arrastre.w, height: arrastre.h });
  }, 8);
}
function soltar(ubicarAlFinal = true) {
  if (!arrastre) return;
  clearInterval(arrastre.t); arrastre = null;
  if (ubicarAlFinal && win && !win.isDestroyed()) { const c = centro(); ubicar(c.x, c.y); }
}

/** el cursor en coordenadas de la ventana, ~25 veces por segundo mientras NOVA se ve (para que lo mire y reaccione) */
function seguirCursor() {
  let antes = null;
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const c = screen.getCursorScreenPoint(), [x, y] = win.getPosition();
    if (antes && antes.x === c.x && antes.y === c.y) return;
    antes = c;
    win.webContents.send('cursor', c.x - x, c.y - y);
  }, 40);
}

/* ── lienzo: un bloque visual en grande, en su propia ventana ── */
let lienzo = null, pendiente = null;
function ampliar(bloque) {
  if (lienzo && !lienzo.isDestroyed()) { lienzo.webContents.send('lienzo', bloque); lienzo.show(); lienzo.focus(); return; }
  pendiente = bloque;
  lienzo = new BrowserWindow({
    width: 980, height: 700, minWidth: 560, minHeight: 420, title: 'NOVA', backgroundColor: '#08141b', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  lienzo.loadFile(join(__dirname, 'pagina', 'lienzo.html'));
  lienzo.webContents.once('did-finish-load', () => { lienzo.webContents.send('lienzo', pendiente); pendiente = null; });
  lienzo.on('closed', () => { lienzo = null; });
}

/** --captura: guarda un PNG de la ventana a los 3 s (para revisar cómo se ve sin abrir la app a mano) */
function capturar() {
  const demo = process.argv.find(a => a.startsWith('--demo='))?.slice(7);
  win.webContents.on('console-message', (_e, _n, msg) => console.log('[página]', msg));
  if (demo) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.executeJavaScript(`window.__demo?.(${JSON.stringify(demo)})`), 600));
  setTimeout(async () => {
    const img = await win.webContents.capturePage();
    const ruta = join(__dirname, `captura${demo ? `-${demo}` : ''}.png`);
    writeFileSync(ruta, img.toPNG());
    console.log(`captura: ${ruta}`);
    app.quit();
  }, 3000);
}

function alternarVisible() {
  if (!win) return;
  if (win.isVisible()) { win.hide(); escondidaPorVisita = false; } else invocar();
}

/* ── escritorios: NOVA vive en uno («casa»). Llamada desde otro (atajo, «Oye Nova», menú) llega de visita a ese
   escritorio, también sobre apps a pantalla completa, con una entrada animada. Cuando la conversación termina, se va:
   si su casa no se ve, se esconde y reaparece sola al volver a su escritorio ── */
let espacios = null, casa = null, visita = false, escondidaPorVisita = false;
const esEscritorio = (e, id) => id != null && e.escritorios.includes(id);
/** el escritorio que tienes delante en la pantalla de NOVA, si es uno normal (no una app a pantalla completa) */
const escritorioDelante = e => (esEscritorio(e, e.aqui) && e.activa === e.aqui ? e.aqui : null);
function mostrarEnCasa() { escondidaPorVisita = false; win.webContents.send('visita', 'vuelve'); win.showInactive(); }
function alCambiarEspacio(e) {
  if (!win || win.isDestroyed() || visita) return;
  if (!escondidaPorVisita && win.isVisible() && e.ventana.length === 1) {
    // su casa es el escritorio normal donde está (también si la mueves con Mission Control); si quedó dentro de una app
    // a pantalla completa (p. ej. se abrió estando ahí), se esconde y espera un escritorio normal
    if (esEscritorio(e, e.ventana[0])) casa = e.ventana[0];
    else { win.hide(); escondidaPorVisita = true; }
  }
  const delante = escritorioDelante(e);
  if (escondidaPorVisita && delante != null && (casa == null || delante === casa || !esEscritorio(e, casa))) { casa = delante; mostrarEnCasa(); }
}
/** que se vea en el escritorio actual: si está en casa, nada especial; si no, de visita */
async function invocar() {
  if (!win || win.isDestroyed()) return;
  const e = await espacios?.consultar();
  if (!e) { if (!win.isVisible()) win.showInactive(); return; }
  const delante = escritorioDelante(e);
  const enCasa = casa != null && esEscritorio(e, casa) ? e.visibles.includes(casa) : delante != null;
  if (enCasa && !visita) {
    if (casa == null || !esEscritorio(e, casa)) casa = delante;
    if (escondidaPorVisita) mostrarEnCasa(); else if (!win.isVisible()) win.showInactive();
    return;
  }
  if (!visita) {
    visita = true; escondidaPorVisita = false;
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.webContents.send('visita', 'llega');
  }
  win.showInactive();
}
/** la página avisa que la conversación terminó: si estaba de visita, se va */
async function terminarVisita() {
  if (!visita || !win || win.isDestroyed()) return;
  win.webContents.send('visita', 'sale');
  await new Promise(r => setTimeout(r, 380)); // la animación de salida
  visita = false;
  win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
  const e = await espacios?.consultar();
  // se queda a la vista solo si sigue (únicamente) en su casa y su casa se ve; si no, se esconde hasta volver a ella
  if (e && !(e.ventana.length === 1 && e.ventana[0] === casa && e.visibles.includes(casa))) { win.hide(); escondidaPorVisita = true; }
  else win.webContents.send('visita', 'vuelve');
}

function menu() {
  const conectado = !!sesion.leer();
  return Menu.buildFromTemplate([
    { label: 'Hablar con NOVA', accelerator: 'Alt+Space', click: () => { invocar(); win?.webContents.send('atajo', 'hablar'); } },
    { label: 'Claude empieza de cero (tareas en el Mac)', click: () => { claude.nueva(); claude.preparar(); win?.webContents.send('atajo', 'claude-nueva'); } },
    { label: `Olvidar permisos «Siempre» (${(leerPref().siempre ?? []).length})`, enabled: (leerPref().siempre ?? []).length > 0, click: () => { guardarPref({ siempre: [] }); claude.reglas.clear(); } },
    { label: 'Micrófono apagado', type: 'checkbox', checked: leerPref().mic === false, click: i => { guardarPref({ mic: !i.checked }); win?.webContents.send('atajo', i.checked ? 'mic-off' : 'mic-on'); } },
    { label: 'Escuchar «Oye Nova»', type: 'checkbox', checked: leerPref().vigia === true, click: i => { guardarPref({ vigia: i.checked }); win?.webContents.send('atajo', i.checked ? 'vigia-on' : 'vigia-off'); } },
    { label: win?.isVisible() ? 'Esconder' : 'Mostrar', accelerator: 'Alt+Shift+N', click: alternarVisible },
    { type: 'separator' },
    { label: 'Volver a la esquina', click: () => { if (win) { const e = esquina(); ubicar(e.x, e.y); } } },
    { label: 'Abrir al iniciar sesión en el Mac', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Cerrar sesión de NOVA', enabled: conectado, click: () => { sesion.guardar(null); api.invalidar(); win?.webContents.send('atajo', 'sesion') } },
    { type: 'separator' },
    { label: 'Salir', accelerator: 'Cmd+Q', click: () => app.quit() },
  ]);
}

/* ── puente con la página ── */
ipcMain.handle('config', () => ({ vozUrl: CONFIG.vozUrl, vozToken: CONFIG.vozToken }));
ipcMain.handle('sesion', async () => {
  if (!sesion.leer()) return null;
  try { return await api.yo(); } catch (e) { return e.estado === 401 ? null : { sinConexion: true }; }
});
ipcMain.handle('entrar', async (_e, email, clave) => {
  try { const r = { ok: true, ...(await api.entrar(email, clave)) }; api.precargar(); return r; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('contexto', () => api.contexto());
ipcMain.handle('herramienta', async (_e, nombre, args) => {
  try { return await ejecutar(nombre, args ?? {}, { api, win }); } catch (e) { return { ok: false, motivo: e.message }; }
  finally { api.invalidar(); } // pudo cambiar tareas o listas
});
// el ratón sobre NOVA anuncia que viene un pedido: se refrescan las tareas por si acaso
ipcMain.on('raton', (_e, sobre) => { win?.setIgnoreMouseEvents(!sobre, { forward: true }); if (sobre) api.precargar(); });
ipcMain.on('invocar', () => invocar());
ipcMain.on('reposo', () => terminarVisita());
ipcMain.on('arrastrar', (_e, si) => { if (!win) return; if (si) arrastrar(); else soltar(); });
ipcMain.on('menu', () => menu().popup({ window: win }));
// enlaces de los visuales: solo web, en el navegador predeterminado
ipcMain.on('abrir-url', (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); });
ipcMain.on('ampliar', (_e, bloque) => ampliar(bloque));
// modo Claude: voz local + Claude Code
ipcMain.handle('transcribir', async (_e, wav, pista) => { try { return { texto: await escucha.transcribir(Buffer.from(wav), pista) }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('pref', (_e, clave) => leerPref()[clave]);
ipcMain.on('guardar-pref', (_e, clave, valor) => { if (['mic', 'vigia'].includes(clave)) guardarPref({ [clave]: valor }); });
ipcMain.handle('decir', async (_e, texto) => { try { return await escucha.decir(texto); } catch { return null; } });
// la voz por partes: cada trozo va a la página apenas llega (id distingue una frase de la siguiente)
ipcMain.handle('decir-flujo', async (e, id, texto) => { try { return await escucha.decirFlujo(texto, (pcm, hz) => { if (!e.sender.isDestroyed()) e.sender.send('voz-trozo', id, pcm, hz); }); } catch { return false; } });
ipcMain.on('claude:pedir', (_e, texto) => { claude.pedir(texto); });
ipcMain.on('claude:responder', (_e, id, si) => claude.responder(id, si));
ipcMain.on('claude:cancelar', () => claude.cancelar());
ipcMain.on('claude:nueva', () => { claude.nueva(); claude.preparar(); });

app.whenReady().then(async () => {
  app.dock?.hide();
  // el micrófono: lo pide macOS una vez; la página solo puede usarlo, nada más
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, cb) => cb(permiso === 'media'));
  if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  crearVentana();
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('◉ NOVA');
  tray.setToolTip('NOVA · ⌥Espacio para hablar');
  tray.on('click', () => tray.popUpContextMenu(menu()));
  globalShortcut.register('Alt+Space', () => { invocar(); win.webContents.send('atajo', 'hablar'); });
  globalShortcut.register('Alt+Shift+Space', () => { invocar(); win.webContents.send('atajo', 'hablar'); }); // una sola NOVA
  globalShortcut.register('Alt+Shift+N', alternarVisible);
  escucha.arrancar().catch(e => console.warn('whisper:', e.message));
  escucha.precargar(['¿Lo hago?', 'Listo, empezamos una conversación nueva.', '¡Chao!', '¡Hasta luego!']);
  // lo que hace esperar al primer pedido, listo de antemano: Claude Code arrancado y las tareas cargadas
  setTimeout(() => claude.preparar(), 1500);
  api.precargar();
  setInterval(() => api.precargar(), 4 * 60e3).unref?.();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); claude.cerrar(); escucha.cerrar(); espacios?.cerrar(); });
app.on('window-all-closed', () => app.quit());
