/* Modo Claude: NOVA como ejecutora de Claude Code (Agent SDK), con tu propia sesión de Claude Code.
   · lo que dices se transcribe en el Mac (escucha.js); la respuesta hablada es UNA frase
   · una sola sesión viva (entrada continua): no relanza Claude en cada pedido, la caché queda caliente (más rápido y
     ~5-10× más barato que en frío) y se puede interrumpir al instante. Tras 30 min sin uso empieza una sesión nueva
     para que el contexto no crezca sin control
   · ejecutor puro: esfuerzo bajo, sin narrar, lo mínimo de herramientas, detalles al panel con mostrar
   · permisos: leer, buscar, abrir, editar tus proyectos y automatizar la UI pasan solos (también encadenados con | y &&);
     lo demás pide un «sí». «Siempre» recuerda ese comando (p. ej. `npm test`) para no volver a preguntar; lo
     destructivo (rm, sudo, git push, despliegues…) pregunta siempre */
const { homedir } = require('node:os');
const { resolve, sep, extname } = require('node:path');
const { readFile, stat } = require('node:fs/promises');
const { z } = require('zod');

const HOME = homedir();
const SDK = import('@anthropic-ai/claude-agent-sdk');
const INACTIVA = 30 * 60e3;

const INSTRUCCIONES = `
You are NOVA's executor on Nico's Mac (his AGP work computer), driven by VOICE from the floating widget. Requests are transcribed locally.
LITERAL TERMS: search queries, names, titles, file names and URLs must be used EXACTLY as transcribed. Never "correct" them to something more famous or common (if he says "barf simmons", search "barf simmons", not "bart simpsons"). Only fix a word when the transcription is clearly broken AND the intent is unambiguous; for searches, never.
EXECUTE, DON'T CONVERSE: do the task right away with the fewest tool calls. No plans, no narration, no offers, no "would you like…". Ask a question only when the request is genuinely ambiguous AND a wrong guess would be destructive.
Your FINAL message is spoken aloud: ONE short plain sentence in neutral Spanish (tú), at most ~15 words, saying what you did or the answer. No markdown, paths or code in it. Anything longer goes to the panel with mcp__nova__mostrar.

These run WITHOUT asking, so prefer them and keep each Bash call simple (no loops, no $(…), no backticks, no redirects except 2>/dev/null): open <file|folder|URL|-a App|-R path>, code, ls, find, mdfind, mdls, cat, head, tail, grep, rg, stat, du, wc, sort, git status/log/diff/show/branch, osascript (UI automation), pbcopy, pbpaste, screencapture, cd, and pipes/&& between them. Anything else (npm, python, curl, installs, git writes…) asks Nico first: use it only when really needed.
Find files and folders fast with Spotlight: mdfind -name "<name>" (whole Mac) or mdfind -onlyin ~/<dir> "<query>" — not a slow find over ~. Then open the result (open "<folder>" shows it in Finder; open -R "<file>" reveals it).

Mac recipes:
- Web: open "https://…" (default browser) · YouTube: open "https://www.youtube.com/results?search_query=<encoded exact words>" · Google (no autocorrect): open "https://www.google.com/search?q=<encoded exact words>&nfpr=1"
- Chrome without keystrokes: osascript -e 'tell application "Google Chrome" to reload active tab of front window' · URL/title of the front tab: osascript -e 'tell application "Google Chrome" to get URL of active tab of front window'
- Apps: open -a "<App>" · VS Code: code "<folder>" / code -g "<file>:<line>"
- New VS Code terminal running Claude: osascript -e 'tell application "Visual Studio Code" to activate' -e 'delay 0.3' -e 'tell application "System Events" to keystroke "p" using {command down, shift down}' -e 'delay 0.4' -e 'tell application "System Events" to keystroke "Terminal: Create New Terminal"' -e 'delay 0.4' -e 'tell application "System Events" to key code 36' -e 'delay 0.9' -e 'tell application "System Events" to keystroke "claude"' -e 'tell application "System Events" to key code 36'
- Music: osascript -e 'tell application "Spotify" to playpause' (next track / previous track / play track "spotify:…") · Volume: osascript -e 'set volume output volume 40'
- Notification: osascript -e 'display notification "…" with title "NOVA"' · Dark mode: osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'
- Screenshot: screencapture -x ~/Desktop/<name>.png · Clipboard: pbpaste / echo "…" | pbcopy
- Running dev servers: lsof -iTCP -sTCP:LISTEN -n -P
Keystrokes (System Events) need Accessibility permission for Electron: if it fails, say so in one sentence.
Never deploy, push, touch production, or delete unless Nico asked for exactly that in this conversation.

SHOW, DON'T TELL: mcp__nova__mostrar puts things in the panel under NOVA. Use it whenever a visual helps:
- search results or links → "tarjetas" (items: titulo, url, resumen, imagen when the page has one, fuente)
- numbers over time or a comparison → "grafico" (forma barras / barras_h / lineas / area, etiquetas, series [{nombre, valores}], unidad). One measure per chart, never two scales.
- a few key numbers → "metricas" (etiqueta, valor, unidad, cambio as a signed number, bueno:false when going up is bad)
- pictures (web URLs or local paths) → "imagenes"; rows → "tabla"; a checklist → "lista"; a snippet → "codigo"; notes → "texto" (markdown).
Real data only, never invented numbers.

LISTS: "agrega X a la lista de compras", "crea una lista de…", "qué tengo en mi lista…" → mcp__nova__listas (his NOVA account lists, synced with the phone). Never Apple Reminders or Notes for this.`;

/* ── mostrar: lo que Claude quiere que se VEA en el panel del widget ── */
const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
/** una imagen local → data URL (solo imágenes, máx. 8 MB); las web pasan tal cual */
async function fuenteImagen(src) {
  const s = String(src ?? '').trim();
  if (/^(https?:|data:image\/)/.test(s)) return s;
  const ruta = resolve(s.replace(/^file:\/\//, '').replace(/^~(?=\/|$)/, HOME)), tipo = IMG[extname(ruta).toLowerCase()];
  if (!tipo) return null;
  const st = await stat(ruta).catch(() => null);
  if (!st?.isFile() || st.size > 8 * 2 ** 20) return null;
  return `data:${tipo};base64,${(await readFile(ruta)).toString('base64')}`;
}
const ESQUEMA_LISTAS = {
  accion: z.enum(['ver', 'leer', 'crear', 'agregar', 'marcar', 'quitar']),
  lista: z.string().optional().describe('List name as he said it, e.g. "compras" (not needed for ver)'),
  items: z.array(z.string()).optional().describe('agregar/crear: each item separately, short · marcar/quitar: the one item'),
  hecho: z.boolean().optional().describe('marcar: false to uncheck'),
  para_crew: z.boolean().optional().describe('crear: shared with his crew'),
};
const ESQUEMA_MOSTRAR = {
  tipo: z.enum(['grafico', 'metricas', 'tarjetas', 'imagenes', 'tabla', 'lista', 'codigo', 'texto']).describe('What kind of block to show'),
  titulo: z.string().optional().describe('Short title above the block'),
  subtitulo: z.string().optional(),
  fuente: z.string().optional().describe('Where the data comes from (shown small under the block)'),
  forma: z.enum(['barras', 'barras_h', 'lineas', 'area']).optional().describe('grafico: bars for comparing categories (barras_h when labels are long), lines/area for change over time'),
  etiquetas: z.array(z.string()).optional().describe('grafico: category or time labels (x axis)'),
  series: z.array(z.object({ nombre: z.string(), valores: z.array(z.number()) })).max(8).optional().describe('grafico: one entry per series, values aligned with etiquetas'),
  unidad: z.string().optional().describe('grafico: unit of the values, e.g. "USD", "ms", "%"'),
  apilado: z.boolean().optional().describe('grafico barras: stack the series'),
  items: z.array(z.record(z.string(), z.any())).optional().describe('metricas: {etiqueta, valor, unidad?, cambio?, bueno?} · tarjetas: {titulo, url?, resumen?, imagen?, fuente?} · imagenes: {src (https URL or local path), titulo?} · lista: {texto, hecho?, detalle?}'),
  columnas: z.array(z.string()).optional().describe('tabla: column headers'),
  filas: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).optional().describe('tabla: rows'),
  codigo: z.string().optional(), lenguaje: z.string().optional(), archivo: z.string().optional(),
  markdown: z.string().optional().describe('texto: markdown content'),
};

/* ── permisos ── */
const SIEMPRE = new Set(['mcp__nova__mostrar', 'mcp__nova__listas','Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Agent', 'ToolSearch', 'Skill', 'NotebookRead', 'BashOutput']);
const EDICION = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SENSIBLE = /^(\.|Library$|Library\/)/; // dotfiles, ~/.ssh, ~/.aws, ~/.claude, ~/Library…
/** comandos de solo lectura o de abrir/mostrar */
const LEER = /^(ls|pwd|cat|head|tail|wc|which|date|whoami|rg|grep|egrep|tree|file|du|df|lsof|ps|stat|mdfind|mdls|sort|uniq|cut|tr|basename|dirname|realpath|readlink|jq|pbcopy|pbpaste|echo|printf|true|sw_vers|uname|hostname|code|screencapture|cd)\b|^defaults read\b|^git (status|log|diff|show|branch|remote|ls-files|rev-parse|blame)\b|^find\b(?!.*-(delete|exec|ok|fprint))|^sed\b(?!.*\s-i)/;
/** open ejecuta lo que abre si es un programa o script: esos piden permiso */
const EJECUTABLE = /\.(app|command|sh|bash|zsh|tool|terminal|workflow|scpt|applescript|pkg|mpkg|dmg|jar|py|rb|pl|action|scptd)\/?["']?$/i;
/** lo que nunca se recuerda con «Siempre» */
const PELIGROSO = /(^|[\s;|&])(sudo|rm|rmdir|mv|dd|mkfs|kill|killall|pkill|chmod|chown|shutdown|reboot|launchctl|diskutil|curl|wget)\b|git\s+(push|reset|clean|rebase|checkout|restore|branch\s+-D|stash\s+drop)|npm\s+publish|deploy|flyctl|fly\s|eas\s|kubectl|az\s|drop\s+(table|database)/i;

function archivoSeguro(ruta) {
  if (typeof ruta !== 'string') return false;
  const abs = resolve(ruta.replace(/^~(?=\/|$)/, HOME));
  if (!abs.startsWith(HOME + sep)) return false;
  return !SENSIBLE.test(abs.slice(HOME.length + 1));
}

/** parte un comando en segmentos (|, ||, &&, ;) respetando comillas; null si trae sustitución o va al fondo */
function segmentos(cmd) {
  const out = []; let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === '\\' && q === '"') cur += cmd[++i] ?? ''; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '`' || (c === '$' && cmd[i + 1] === '(') || (c === '<' && cmd[i + 1] === '(')) return null;
    if (c === '\n' || c === ';' || c === '|' || (c === '&' && cmd[i + 1] === '&')) { out.push(cur); cur = ''; if ((c === '|' || c === '&') && cmd[i + 1] === c) i++; continue; }
    if (c === '&' && cmd[i - 1] !== '>' && cmd[i + 1] !== '>') return null; // proceso al fondo
    cur += c;
  }
  if (q) return null;
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
const LEER_EXEC = /^(du|stat|ls|wc|head|tail|file|grep|rg|md5|shasum|basename|dirname|cat|mdls)$/;
/** quita lo que no cambia el riesgo: `git -C <ruta>`, `xargs [opciones]`, `find … -exec <lectura> {} +` */
function normalizar(seg) {
  let s = seg.replace(/^git\s+-C\s+("[^"]+"|'[^']+'|\S+)\s+/, 'git ');
  const x = s.match(/^xargs((?:\s+-(?:[0IJLnPs])\s*(?:\{\}|\S+)?|\s+-[0rtx]+)*)\s+(.*)$/);
  if (x) s = x[2];
  if (/^find\b/.test(s)) {
    let ok = true;
    s = s.replace(/\s-(exec|execdir|ok|okdir)\s+(\S+)[^;+]*?(\\;|;|\+)/g, (_, _t, cmd) => { if (!LEER_EXEC.test(cmd)) ok = false; return ''; });
    if (!ok) return null;
  }
  return s;
}
/** un segmento pasa solo si es de lectura/apertura o coincide con una regla «Siempre» */
function segmentoSeguro(seg, reglas) {
  const s = normalizar(seg.replace(/\s*(?:[12]?>|&>)\s*\/dev\/null/g, '').replace(/\s*2>&1/g, '').trim());
  if (s == null) return false;
  if (/[<>]/.test(s.replace(/'[^']*'|"[^"]*"/g, ''))) return false; // escribe a un archivo
  if (/^osascript\b/.test(s)) return !/do shell script/i.test(s);
  if (/^open\b/.test(s)) return !EJECUTABLE.test(s) && !/\s-(b|n)\b/.test(s);
  if (LEER.test(s)) return true;
  // una regla «Siempre» nunca cubre lo destructivo (p. ej. «find» no permite find -delete)
  if (PELIGROSO.test(s) || /\s-delete\b/.test(s)) return false;
  return [...reglas].some(r => s === r || s.startsWith(`${r} `));
}
function comandoSeguro(cmd, reglas = new Set()) {
  const segs = segmentos(String(cmd ?? ''));
  return !!segs?.length && segs.every(x => segmentoSeguro(x, reglas));
}
/** qué recordar con «Siempre» para este comando: `npm test`, `npm run dev`, `python3`… (null si es peligroso) */
function claveRegla(cmd, reglas = new Set()) {
  if (PELIGROSO.test(cmd)) return null;
  const segs = segmentos(cmd);
  const pendientes = segs?.filter(x => !segmentoSeguro(x, reglas)) ?? [];
  if (pendientes.length !== 1) return null;
  const t = (normalizar(pendientes[0]) ?? pendientes[0]).replace(/\s*(?:[12]?>|&>)\s*\/dev\/null/g, '').split(/\s+/);
  // familias de lectura (find, xargs…) no se recuerdan enteras: pedirían permiso para su variante peligrosa
  if (/^(find|xargs|git|sed|open|osascript)$/.test(t[0])) return t[0] === 'git' && t[1] && /^[a-z]+$/.test(t[1]) && !PELIGROSO.test(`git ${t[1]}`) ? `git ${t[1]}` : null;
  if (/[<>]/.test(pendientes[0].replace(/\s*(?:[12]?>|&>)\s*\/dev\/null/g, ''))) return null;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(t[0]) && t[1] === 'run' && t[2]) return t.slice(0, 3).join(' ');
  // intérpretes: solo ese script exacto (no «cualquier python»); npx/bunx: el comando completo
  if (/^(python3?|node|ruby|perl|bash|sh|zsh|deno|tsx|ts-node)$/.test(t[0])) return t[1] && !t[1].startsWith('-') ? t.slice(0, 2).join(' ') : null;
  if (['npx', 'bunx', 'pnpx'].includes(t[0])) return t[2] && !t[2].startsWith('-') ? t.slice(0, 3).join(' ') : t.slice(0, 2).join(' ');
  if (t[1] && /^[a-z][\w:.-]*$/i.test(t[1]) && !t[1].includes('/')) return t.slice(0, 2).join(' ');
  return t[0];
}

/** ¿pasa sin preguntar? */
function permitido(h, input, reglas = new Set()) {
  if (SIEMPRE.has(h) || reglas.has(h)) return true;
  if (EDICION.has(h)) return archivoSeguro(input.file_path ?? input.notebook_path);
  if (h === 'Bash') return comandoSeguro(input.command, reglas);
  // conectores (ClickUp, Fireflies…): leer sí; escribir pregunta (o «Siempre»)
  if (h.startsWith('mcp__')) return /(^|_)(get|search|list|filter|fetch|read|query|find|resolve)(_|$)/.test(h.split('__').pop());
  return false;
}

/** lo que se muestra en la tarjeta o en la lista de pasos */
function describir(h, i) {
  const corto = s => String(s ?? '').replace(HOME, '~');
  const nombre = r => corto(r).split('/').slice(-2).join('/');
  switch (h) {
    case 'Read': return { icono: 'leer', texto: `Leyendo ${nombre(i.file_path)}` };
    case 'Glob': case 'Grep': case 'LS': return { icono: 'buscar', texto: `Buscando ${i.pattern ?? i.path ?? ''}`.trim() };
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return { icono: 'editar', texto: `${h === 'Write' ? 'Escribiendo' : 'Editando'} ${nombre(i.file_path ?? i.notebook_path)}`, detalle: corto(i.file_path ?? i.notebook_path) };
    case 'Bash': return { icono: 'consola', texto: i.description || 'Comando en la consola', detalle: corto(i.command) };
    case 'WebSearch': return { icono: 'web', texto: `Buscando en la web: ${i.query}` };
    case 'WebFetch': return { icono: 'web', texto: `Abriendo ${corto(i.url)}` };
    case 'Task': case 'Agent': return { icono: 'agente', texto: i.description || 'Un agente trabaja en paralelo' };
    case 'TodoWrite': return { icono: 'plan', texto: 'Ordenando los pasos' };
    case 'mcp__nova__mostrar': return { icono: 'web', texto: `Mostrando ${i.titulo ?? i.tipo}` };
    default: return { icono: h.startsWith('mcp__') ? 'conector' : 'herramienta', texto: h.startsWith('mcp__') ? h.split('__').slice(1).join(' · ').replace(/_/g, ' ') : h, detalle: JSON.stringify(i).slice(0, 240) };
  }
}

class Claude {
  /** emitir(evento) hacia la página: paso · paso_listo · nota · pregunta · respondida · visual · fin · error
      reglas: Set de comandos/herramientas «Siempre»; guardarReglas(lista) las persiste */
  constructor(emitir, { reglas = [], guardarReglas = () => {}, cuenta = async () => ({ ok: false, motivo: 'no NOVA account' }) } = {}) {
    this.emitir = emitir;
    this.cuenta = cuenta;
    this.reglas = new Set(reglas);
    this.guardarReglas = guardarReglas;
    this.sesion = null; this.q = null; this.cola = []; this.despertar = null;
    this.corriendo = false; this.cancelando = false; this.ultimo = 0;
    this.preguntas = new Map(); this.n = 0; this.servidor = null; this.abriendo = null;
    // sin uso por mucho rato: cambia a una sesión nueva en segundo plano, así el próximo pedido no espera el arranque
    this.vigia = setInterval(() => { if (this.ultimo && !this.corriendo && Date.now() - this.ultimo > INACTIVA) { this.nueva(); this.preparar(); } }, 60e3);
    this.vigia.unref?.();
  }

  /** deja el proceso de Claude Code arrancado y esperando (no gasta tokens hasta el primer pedido) */
  preparar() {
    if (this.q || this.abriendo) return this.abriendo;
    this.abriendo = this.abrirSesion().catch(e => console.warn('claude:', e.message)).finally(() => { this.abriendo = null; });
    return this.abriendo;
  }

  /** la entrada continua de la sesión: entrega cada pedido cuando llega */
  async *entrada() {
    while (true) {
      while (!this.cola.length) await new Promise(r => { this.despertar = r; });
      yield this.cola.shift();
    }
  }

  async abrirSesion() {
    const { query, tool, createSdkMcpServer } = await SDK;
    this.servidor ??= createSdkMcpServer({
      name: 'nova', version: '1.0.0', alwaysLoad: true,
      tools: [tool('mostrar', 'Show a visual block (chart, metrics, search result cards, images, table, list, code or formatted text) in the NOVA widget panel on the Mac screen.', ESQUEMA_MOSTRAR, async bloque => {
        try {
          if (bloque.tipo === 'imagenes') bloque.items = (await Promise.all((bloque.items ?? []).map(async i => ({ ...i, src: await fuenteImagen(i.src) })))).filter(i => i.src);
          if (bloque.tipo === 'tarjetas') bloque.items = await Promise.all((bloque.items ?? []).map(async i => (i.imagen ? { ...i, imagen: await fuenteImagen(i.imagen) } : i)));
          this.emitir({ tipo: 'visual', bloque });
          return { content: [{ type: 'text', text: 'Shown in the widget panel.' }] };
        } catch (e) { return { content: [{ type: 'text', text: `Could not show it: ${e.message}` }], isError: true }; }
      }, { annotations: { readOnlyHint: true } }),
      // las listas de la cuenta de NOVA (las mismas del teléfono): compras, ideas, libros… de cualquier tipo
      tool('listas', 'Nico\'s NOVA lists (same account as the phone app: groceries, ideas, books, anything). accion: ver (all lists with items) · leer · crear (new list, optional items) · agregar (items; creates the list if missing) · marcar · quitar. Only say it was done when the result says ok.', ESQUEMA_LISTAS, async a => {
        const nombre = { ver: 'ver_listas', leer: 'leer_lista', crear: 'crear_lista', agregar: 'agregar_a_lista', marcar: 'marcar_en_lista', quitar: 'quitar_de_lista' }[a.accion];
        const r = await this.cuenta(nombre, { ...a, nombre: a.lista, item: a.items?.[0] });
        if (r?.ok && r.lista) this.emitir({ tipo: 'visual', bloque: { tipo: 'lista', titulo: r.lista, items: (r.pendientes ?? r.agregados ?? []).map(texto => ({ texto })) } });
        return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r?.ok };
      })],
    });
    this.cola = [];
    const q = (this.q = query({
      prompt: this.entrada(),
      options: {
        cwd: HOME,
        resume: this.sesion ?? undefined,
        effort: 'low',
        permissionMode: 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: INSTRUCCIONES },
        mcpServers: { nova: this.servidor },
        allowedTools: ['mcp__nova__mostrar', 'mcp__nova__listas'],
        canUseTool: (h, input, op) => this.permiso(h, input, op),
      },
    }));
    this.leer(q);
  }

  /** lee la sesión mientras viva; cada «result» cierra un pedido */
  async leer(q) {
    try {
      for await (const m of q) {
        if (m.session_id) this.sesion = m.session_id;
        if (m.type === 'assistant' && !m.parent_tool_use_id) {
          for (const b of m.message.content) {
            if (b.type === 'tool_use') this.emitir({ tipo: 'paso', id: b.id, ...describir(b.name, b.input ?? {}) });
            else if (b.type === 'text' && b.text.trim()) this.emitir({ tipo: 'nota', texto: b.text.trim() });
          }
        } else if (m.type === 'user' && !m.parent_tool_use_id) {
          for (const b of Array.isArray(m.message?.content) ? m.message.content : []) if (b.type === 'tool_result') this.emitir({ tipo: 'paso_listo', id: b.tool_use_id, error: !!b.is_error });
        } else if (m.type === 'result') {
          const cancelado = this.cancelando;
          this.corriendo = false; this.cancelando = false; this.ultimo = Date.now();
          this.emitir(cancelado ? { tipo: 'fin', texto: 'Cancelado.', cancelado: true } : { tipo: 'fin', texto: m.result ?? '', error: !!m.is_error, ms: m.duration_ms, usd: m.total_cost_usd });
        }
      }
    } catch (e) {
      if (this.q === q && this.corriendo) this.emitir({ tipo: 'error', texto: e.message });
    } finally {
      if (this.q === q) { this.q = null; this.corriendo = false; this.cancelando = false; }
    }
  }

  async permiso(h, input, { signal } = {}) {
    if (permitido(h, input, this.reglas)) return { behavior: 'allow', updatedInput: input };
    const id = `p${++this.n}`;
    const siempre = h === 'Bash' ? claveRegla(String(input.command ?? ''), this.reglas) : h.startsWith('mcp__') ? h : null;
    // primero queda esperando la respuesta, después se muestra la tarjeta (así ninguna respuesta se pierde)
    const espera = new Promise(res => {
      this.preguntas.set(id, res);
      signal?.addEventListener('abort', () => { this.preguntas.delete(id); res(false); });
      setTimeout(() => { if (this.preguntas.delete(id)) res(false); }, 120e3);
    });
    this.emitir({ tipo: 'pregunta', id, siempre, ...describir(h, input) });
    const r = await espera;
    if (r === 'siempre' && siempre) { this.reglas.add(siempre); this.guardarReglas([...this.reglas]); }
    this.emitir({ tipo: 'respondida', id, si: !!r });
    return r ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Nico said no (or did not answer in time). Do not retry it; say so in one short sentence.' };
  }

  /** respuesta de la tarjeta: true, false o 'siempre' */
  responder(id, r) { const f = this.preguntas.get(id); if (f) { this.preguntas.delete(id); f(r === 'siempre' ? 'siempre' : !!r); } }

  async pedir(texto) {
    // mucho rato sin uso: sesión nueva (contexto chico, menos tokens)
    if (this.ultimo && Date.now() - this.ultimo > INACTIVA) this.nueva();
    if (this.corriendo) await this.cancelar();
    if (!this.q) await this.preparar();
    if (!this.q) await this.abrirSesion();
    this.corriendo = true; this.cancelando = false;
    this.cola.push({ type: 'user', message: { role: 'user', content: texto }, parent_tool_use_id: null });
    this.despertar?.(); this.despertar = null;
  }

  async cancelar() {
    for (const f of this.preguntas.values()) f(false);
    this.preguntas.clear();
    if (!this.corriendo || !this.q) return;
    this.cancelando = true;
    try { await this.q.interrupt(); } catch { this.q?.close(); }
  }

  nueva() {
    for (const f of this.preguntas.values()) f(false);
    this.preguntas.clear();
    try { this.q?.close(); } catch {}
    this.q = null; this.sesion = null; this.corriendo = false; this.ultimo = 0;
  }

  cerrar() { clearInterval(this.vigia); try { this.q?.close(); } catch {} this.q = null; }
}

module.exports = { Claude, permitido, comandoSeguro, claveRegla, segmentos };
