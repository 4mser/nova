/* lo único que la página puede pedirle al Mac */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mac', {
  config: () => ipcRenderer.invoke('config'),
  sesion: () => ipcRenderer.invoke('sesion'),
  entrar: (email, clave) => ipcRenderer.invoke('entrar', email, clave),
  contexto: () => ipcRenderer.invoke('contexto'),
  herramienta: (nombre, args) => ipcRenderer.invoke('herramienta', nombre, args),
  raton: sobre => ipcRenderer.send('raton', sobre),
  arrastrar: si => ipcRenderer.send('arrastrar', si),
  alLado: f => ipcRenderer.on('lado', (_e, abajo) => f(abajo)),
  // escritorios: llamarla al escritorio actual, avisar que terminó, y la entrada/salida animada
  invocar: () => ipcRenderer.send('invocar'),
  reposo: () => ipcRenderer.send('reposo'),
  alVisita: f => ipcRenderer.on('visita', (_e, que) => f(que)),
  menu: () => ipcRenderer.send('menu'),
  alAtajo: f => ipcRenderer.on('atajo', (_e, cual) => f(cual)),
  alCursor: f => ipcRenderer.on('cursor', (_e, x, y) => f(x, y)),
  abrirUrl: url => ipcRenderer.send('abrir-url', url),
  ampliar: bloque => ipcRenderer.send('ampliar', bloque),
  alLienzo: f => ipcRenderer.on('lienzo', (_e, bloque) => f(bloque)),
  // modo Claude (voz local)
  transcribir: (wav, pista) => ipcRenderer.invoke('transcribir', wav, pista),
  pref: clave => ipcRenderer.invoke('pref', clave),
  guardarPref: (clave, valor) => ipcRenderer.send('guardar-pref', clave, valor),
  decir: texto => ipcRenderer.invoke('decir', texto),
  decirFlujo: (id, texto) => ipcRenderer.invoke('decir-flujo', id, texto),
  alTrozoVoz: f => { const h = (_e, id, pcm, hz) => f(id, pcm, hz); ipcRenderer.on('voz-trozo', h); return () => ipcRenderer.removeListener('voz-trozo', h); },
  claude: {
    pedir: texto => ipcRenderer.send('claude:pedir', texto),
    responder: (id, si) => ipcRenderer.send('claude:responder', id, si),
    cancelar: () => ipcRenderer.send('claude:cancelar'),
    nueva: () => ipcRenderer.send('claude:nueva'),
    alEvento: f => ipcRenderer.on('claude', (_e, ev) => f(ev)),
  },
});
