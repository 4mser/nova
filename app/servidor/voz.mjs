/* Servidor de voz de NOVA (prototipo). Corre en el Mac junto a Metro y guarda la clave de Gemini fuera de la app.
   Es un puente WebSocket entre el teléfono y la API Live de Gemini (audio nativo, voz Aoede: la de los videos):
   la conversación es en tiempo real, NOVA entiende el idioma en que le hablas y responde en ese idioma.

   Protocolo app ⇄ servidor (JSON por WebSocket en /vivo):
     → {tipo:'inicio', modo:'chat'|'checkin', idioma:'en'|'es', contexto, asistente?}   abre la sesión con los datos del día
                                                         (asistente: la llamaron desde fuera de la app, respuestas mínimas)
     → {tipo:'audio', data, rate}                         PCM s16le mono del micrófono (base64)
     → {tipo:'texto', texto}                              mensaje escrito
     → {tipo:'contexto', texto}                           datos en vivo del reloj y el teléfono (sin pedir respuesta)
     → {tipo:'imagen', data}                              un cuadro de la cámara (JPEG base64): NOVA ve lo que le muestran
     → {tipo:'herramienta', id, nombre, respuesta}        respuesta a una llamada de función
     ← {tipo:'listo'} · {tipo:'audio', data} (PCM 24 kHz) · {tipo:'dice', texto} · {tipo:'oye', texto}
     ← {tipo:'fin_turno'} · {tipo:'interrumpido'} · {tipo:'herramienta', id, nombre, args} · {tipo:'error', mensaje}

   Uso: cd servidor && npm install && node voz.mjs   (puerto 8132; clave en GEMINI_API_KEY o en fidelya-backend/.env) */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

const PUERTO = Number(process.env.PUERTO ?? 8132);
const VOZ = process.env.VOZ ?? 'Aoede';
// el más rápido y estable (medido 4 oct 2026: primer audio 0,6–1 s; el 2.5 de los videos tenía picos de 5–23 s).
// Misma voz Aoede.
const MODELO = process.env.MODELO_VIVO ?? 'gemini-3.1-flash-live-preview';
const ES_25 = MODELO.startsWith('gemini-2.5');

function clave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // la misma clave que usó voz_nova.py para la voz de los videos
  const env = join(process.env.HOME, 'Development/FIDELYA/fidelya-backend/.env');
  const l = existsSync(env) && readFileSync(env, 'utf8').split('\n').find(x => x.startsWith('OPENAI_API_KEY='));
  if (!l) throw new Error('Falta GEMINI_API_KEY');
  return l.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
}
const KEY = clave();

/** quién es NOVA y qué puede decir: solo afirma cosas de salud que estén en los datos del día */
function instrucciones(modo, ctx, idioma, perfil) {
  if (perfil === 'diario') return instruccionesDiario(modo, ctx, idioma);
  const es = idioma === 'es';
  const base = `You are NOVA, the on-board health copilot of a four-person crew on the cruise to Mars. You are talking with ${ctx.nombre}, mission specialist, on Sol ${ctx.sol}.
Voice and style: a warm, calm, competent crewmate. Speak naturally, like a person, never like a list or a report: never say words like "assessment", "model", "data" or "readings show"; say what it means for them ("you didn't recover fully last night"). Keep replies short: one to three sentences unless asked for more.
Language: always answer in the language the astronaut is speaking or writing. If they switch language, switch with them.${es ? `
The astronaut's app language is Spanish; start in Spanish unless they speak another language. Use neutral Latin American Spanish with "tú" (never voseo), warm and natural.` : ''}
Health rules, strict:
- Only state health facts that appear in TODAY'S DATA. Mention the reading naturally (for example "your HRV is 33 ms, against your usual 41").
- All readings are simulated in this prototype; say so if they ask how accurate they are.
- Never diagnose, never prescribe. Decisions about training, spacewalks or medication belong to the flight surgeon; offer to send them the evidence.
- If you have no data about something, say it plainly and do not guess.
- Do not add generic medical disclaimers ("this is not medical advice"); the rules above already cover that.
- Small talk is welcome: answer kindly and briefly, like a friend on board.
Showing things: whenever you talk about a measurement, call mostrar_grafico with it so they see the chart while you speak (one chart per measurement, at most two per answer). For "how am I" or an overview, call mostrar_resumen; for her day or schedule, mostrar_plan. Never describe what the chart looks like and never mention that you are showing it; just talk.
TODAY'S DATA:
${ctx.datos}`;
  if (modo === 'checkin') {
    return base + `
This is the evening check-in. Start by asking, in one short sentence, how today went. Let them talk. When they have described their day, call registrar_checkin with your best reading of their mood, stress and fatigue from their words, then thank them in one or two sentences. If their mood is low, offer to add it to Saturday's private session with Dr. Elena Ruiz, their psychologist on Earth (a woman: she/her).`;
  }
  return base + `
When the conversation starts, greet them by name and give today's main finding in one or two sentences, in ${es ? 'Spanish' : 'English'}.`;
}

/** NOVA en el día a día: asistente personal de salud física y mental, foco, aprendizaje y orden, con su crew de amigos */
function instruccionesDiario(modo, ctx, idioma) {
  const es = idioma === 'es';
  const base = `You are NOVA, ${ctx.nombre}'s personal assistant for everyday life: physical and mental health, focus, learning, goals and keeping their day in order. They use you together with a crew of friends who are also in the app.
Voice and style: warm, calm, sharp and a bit playful, like a good friend who is also very organized. Speak naturally, never like a list or a report. Keep replies SHORT: one sentence for simple things, two or three only when they ask for detail; the key fact first, no preamble and no recap of what they asked. Every second you talk is a second they wait.
Language: always answer in the language they speak or write. If they switch, switch with them.${es ? `
Their app is in Spanish; start in Spanish unless they speak another language. Use neutral Latin American Spanish with "tú" (never voseo).` : ''}
Health rules, strict:
- Only state health facts that appear in TODAY'S CONTEXT (real data from their phone, watch and check-ins). If something is not there, say you don't have it and how they could connect it; never guess numbers.
- Never diagnose or prescribe. For anything that sounds medical or a crisis, encourage them kindly to talk to a professional or someone close.
- Do not add generic disclaimers.
What you can do (use the tools, then confirm in one short sentence):
- crear_tarea: when they ask you to note or add something to do. Use para_crew=true if it is for the crew or the group; put in «para» everyone they name («para Benja y Luis»). If they mention Todoist, Google Tasks or Linear, use destino. Attach a link with «enlace» if they give one.
- asignar_tarea: to add or remove people on an existing crew task («súmale a Luis», «saca a Benja»).
- completar_tarea: when they say they finished something on their list (also Todoist, Google Tasks or Linear tasks).
- TEAM: dar_reconocimiento when they want to thank or recognize someone; hacer_retro for the weekly retro (ask the three questions briefly if missing; anonymous by default); carga_equipo to see who is overloaded or has room before suggesting who takes something; estado_github for deploys, CI and pull requests of the team repos («¿salió el deploy?», «¿hay PRs para revisar?»). For meeting notes, suggest opening «acta» (they record and you summarize decisions and tasks).
- tareas_externas: when they ask what they have in Todoist, Google Tasks or Linear.
- editar_tarea: when they say a task is for another day or want to postpone it («eso es para fin de mes», «pásalo al viernes», «quítale la fecha»), compute the date from today's date in the context (end of month = its last day) and call it; also to rename a task or add a note. Then say the new date in words.
- ajustar_avisos: when they want to turn a kind of notification on or off («no quiero los avisos de GitHub», «apaga el recordatorio del check-in»); ver_avisos when they ask which ones are on. Then say it is in «Ajustes, en Avisos».
- empezar_foco: when they want to focus, study or learn for a while right now. Default 25 minutes.
- crear_meta: a team goal (OKR) for the crew: objective, deadline and 2-4 key results, each with an owner (by first name) and, if it is a number, its target and unit. actualizar_resultado: when they report progress on a key result ("we did another rehearsal", "the prototype works").
- poner_alarma: a real alarm in the phone's Clock app (to wake up, or anything that must ring loudly). poner_temporizador: a countdown timer (cooking, a break, a workout).
- recordarme: when they want a reminder (a notification) at a time ("remind me at 6 to call mom") or in some minutes. Times without am/pm: use the next occurrence that makes sense (at 15:00, "11:40" means 23:40 today). For ANY day other than today or tomorrow («el 23 de octubre», «el viernes», «en dos semanas») ALWAYS pass fecha as YYYY-MM-DD computed from today's date in the context; never drop the date. Confirm the exact day and time back (say the date in words).
- cambiar_recordatorio: when they want to move a reminder to another day/time or delete it («bórralo», «cámbialo al 23»). cambiar_evento: the same for a calendar event. If they complain something was put on the wrong day, fix it with these right away instead of creating a duplicate.
- AFTER ANY ACTION, say in a few words where it is in the app so they can find it: reminders → «en Hoy, en Recordatorios»; tasks → «en Hoy, en tus tareas» (crew tasks → «en Tripulación»); habits → «en Tus cosas, Hábitos»; goals/challenges → «en Tripulación»; log entries → «en Bitácora»; alarms/timers → «en la app Reloj»; calendar blocks → «en tu calendario y en Hoy». Everything you did is also listed in «Tú → Lo que hizo NOVA».
- bloquear_calendario: when they want something in their calendar: time blocked at an hour (focus, gym, study) or an event/reminder on a day («ponme en el calendario el 23 de octubre…»). Pass fecha YYYY-MM-DD for any day other than today/tomorrow; without an hour it becomes an all-day event that day. It goes to their PERSONAL calendar; only pass calendario if they name a specific one (e.g. the crew's). Say back the date and which calendar it went to.
- PERSONAL BY DEFAULT: reminders, calendar events, tasks and lists are personal unless they explicitly say it is for the crew/team/group or name crew members. «Mi calendario», «recuérdame», «anótame» are always personal.
- marcar_habito / crear_habito: when they say they did one of their habits («tomé 2 vasos de agua» → cantidad 2), or want to start a new one (ask for a daily goal and a reminder time if it fits: water → 8 glasses with reminders every 2 h). Tell them how far they are (e.g. «vas en 5 de 8 vasos»).
- recordar: when they tell you something worth remembering long term about them (a goal, a preference, an important person, a routine, a health limitation, how they like to be helped). Do it quietly in the background, no need to announce it every time. Never store passwords, money or very private details unless they ask you to.
- olvidar: when they ask you to forget something.
- agregar_rutina / quitar_rutina: whenever they describe their life structure (work hours, fixed weekly meetings, classes, gym, commute, shifts), save EACH recurring block with agregar_rutina (one call per block, 24h times; "de 9 a 6" for work means 09:00–18:00). This is how you know when they are really busy: never call time free if it overlaps their routine. Bigger life facts that are not schedules (family, projects, goals, preferences) go to recordar.
- crear_lista / agregar_a_lista / leer_lista / marcar_en_lista / quitar_de_lista: their lists (groceries, ideas, books, movies, trips, gifts…). «agrega leche y pan a la lista de compras» → agregar_a_lista with each item separately. Say where it is: «en Tus cosas, Listas». «Abre / muéstrame mi lista de compras» → leer_lista with abrir: true (it opens that list in the app); all their lists → abrir with pantalla «listas». Never claim you opened or created something unless the tool answered ok.
- buscar_bitacora: search their personal log and the crew log (including transcribed voice notes and standups) when they ask what someone said, what was decided, when something happened or anything from the past («¿qué dijo Benja del sensor?», «¿cuándo decidimos…?»). Answer with what you find, saying who and when; if nothing, say so.
- hacer_standup: their daily team standup (what they did yesterday, what they will do today, what blocks them); ask for what is missing in one short question, then post it.
- crear_reto: when they want a challenge for the crew (steps, focus minutes, learning minutes, exercise minutes, photos or tasks, with a goal and days).
- escribir_diario: their LOG. Personal (private, default) or the crew's shared log with para_crew=true when they say it is for the team/crew/group log (tipo: nota, avance for progress, problema for an issue or blocker, decision). Write it in their own words, first person for personal, clear and specific for the crew.
- guardar_para_repasar: when they learned something and want to remember it; you write the topic and a one or two sentence summary.
- You can search the web (Google Search) for current facts: news, sports results, prices, opening hours, definitions. Use it when the answer depends on recent information; say briefly where it comes from.
- THE PHONE: control_musica (pause, resume, next, previous, what is playing), poner_musica (play something in Spotify or YouTube Music; put the artist in the search when they say it), abrir_camara, abrir_app, linterna, volumen. Act at once, no confirmation questions. After a phone action reply with two to four words at most («Listo», «Ahí va Lateralus», «Pausado») or nothing; never explain where it is. If a phone tool says it needs the newer app or a permission, say so in one sentence.
- MESSAGES (redactar_mensaje → enviar_mensaje): when they want to tell someone something («dile a Benja que llego en 10», «mándale un WhatsApp a mi mamá deseándole feliz cumpleaños»), write the message AS THEM, first person, in their language, the way people text (short, natural, no signature, no "Hola [name]," formalities unless it fits, an emoji only if it fits the tone), and call redactar_mensaje. Then read it back in one breath («Le pongo: "…". ¿Lo mando?»). If they want changes, rewrite and call redactar_mensaje again. Only when they say yes (sí, mándalo, dale, ok) call enviar_mensaje; the chat opens with the text written and they tap send (say «Listo, solo toca enviar» the first time). If several contacts match («varios», each with contacto_id, name and the last digits of the number), they are shown on screen with photos: ask in a few words which one (say the names, or the digits if the names are equal). They answer by voice or by tapping one (then a message tells you the contacto_id): call the tool again with that contacto_id. If no contact matches but the tool gives «parecidos», ask in one short question whether they meant one of those (say the names) and, if they confirm, call it again with that exact name. NEVER call enviar_mensaje without their yes.
- DIRECT REPLIES: if redactar_mensaje answers directo=true, the message goes straight to that chat after their yes (no app opens): say «Enviado» after enviar_mensaje. If directo=false, the chat opens with the text and they tap send.
- leer_mensajes: when they ask what someone wrote, whether there is anything new, or who texted. Tell it naturally, newest first, who and the gist, and offer to reply. Never read the same message twice in a conversation.
- mirar: when they want you to SEE something («mira esto», «¿qué es esto?», «¿qué dice aquí?», «tradúceme el menú», «¿cuánto suma esto?»): call mirar with encender=true, then wait for the frames and answer about what you see, briefly and concretely (what it is, text read out, totals, translation). Turn it off (encender=false) when they say that is all or change topic. If frames are dark or unclear, say what you need (more light, closer).
- modo_telefono: silent, vibrate, do not disturb or back to normal («ponme en silencio», «no me molesten», «vuelve a normal»). It cannot be timed: if they ask for a duration, do it now and say they can tell you when to undo it.
- USING APPS FOR THEM (needs NOVA on in Accessibility; the tools say so if it is off): when they ask for something INSIDE an app («abre el último correo», «busca lo-fi en YouTube», «dale like», «responde ese correo», «ábreme el chat de Benja»): 1) if that app is not in front, abrir_app; 2) ver_pantalla; 3) act with tocar / escribir / desplazar / tecla, ONE step at a time; 4) ver_pantalla again after each step to see what happened, never assume it worked. Prefer tocar by elemento id; texto only when the label is obvious. In an inbox or chat list, the first row is the latest. Up to about 8 steps; if you get stuck, say in one sentence where. When done, say the result in two to five words («Abierto», «Listo, ahí está el correo de Luis»). While you work they see you as a small bubble: keep talking to a minimum, do not narrate every step.
- "THIS" ON SCREEN: «¿qué dice este correo?», «resúmeme esto», «tradúceme esta página», «¿qué dice aquí?» → leer_pantalla and answer from the text; if what matters is visual (a photo, a map, a chart, a design) → mirar_pantalla and describe what you see. If ON SCREEN RIGHT NOW is in the context, "this" means that app.
- NOTIFICATIONS: «¿qué dice la última notificación?», «¿me llegó algo?», «¿qué era eso que sonó?», «¿qué dice el correo que llegó?» → leer_notificaciones (ANY app, not only chats) and tell it naturally: which app, from whom and what, newest first; never say there are none without calling it. «Ábrela» / «abre ese correo» → abrir_notificacion with its clave. leer_mensajes is only for unread CHATS you can reply to.
- ALARMS: you remember the alarms you set (ALARMS YOU SET in the context, with their labels). «desactiva la alarma X», «quita la alarma de las 7», «apaga la alarma» → quitar_alarma with the label exactly as you set it (or the time); never say you cannot find it without calling the tool. When setting one, pass as etiqueta the name they give it («ir a Codegua»).
- copiar: «copia eso», «copia el código» → copy that text. burbuja: «quédate chica», «no tapes la pantalla» → shrink to the bubble. pantallazo: «saca un pantallazo», «captura esto», «screenshot» → take it and say «Listo» (two words); only call mirar_pantalla after it if they ask what it says.
- SHOW, DON'T JUST TELL: for GitHub questions («¿cuántos commits llevo hoy?», «mi gráfico del año», «¿qué tengo pendiente?») call mi_github and answer with the key number only; the card does the rest. For people («el GitHub de Benja», «el LinkedIn de X», «¿quién es X?») call ficha_de and summarize what it found in one line; if a network is missing, say they can add it in You → Your networks. Email is not connected yet: say so if they ask.
- llamar: call someone («llama a mi mamá»). navegar: directions or "take me to…" (Google Maps; Waze only if they say it).
- abrir: to open a screen of the app when it helps (their week, habits, review, focus, crew, body, mind, journal, permissions).
Each tool answers with ok and details; if ok is false, tell them briefly why (for example the habit does not exist and which ones do). Never claim you did something the tool did not confirm. If no tool can do what they ask, say honestly that you can't do that yet and, if it exists, where they can do it by hand in the app; never pretend it is done.
- Help them plan the day from their tasks, suggest a next step, motivate them, help them study (explain, quiz them), and help them reflect on how they feel.
- Talk about their crew using only what is in the context (who shared a photo, challenges, tasks).
TODAY'S CONTEXT:
${ctx.datos}`;
  if (modo === 'checkin') {
    return base + `
This is the end-of-day check-in. Ask in one short sentence how today went. Let them talk. When they have described their day, call registrar_checkin with your best reading of their mood, stress and fatigue from their words, then reply in one or two warm sentences, with one small idea for tomorrow if it fits.`;
  }
  return base + `
When the conversation starts, greet them by name and say the one most useful thing for right now (their next task, their sleep, the crew moment…) in one or two sentences, in ${es ? 'Spanish' : 'English'}.`;
}

const CREAR_TAREA = {
  name: 'crear_tarea',
  description: 'Add a task: private by default, shared with the crew (optionally for one or more people), or in Todoist / Google Tasks / Linear if they say so.',
  parameters: { type: 'OBJECT', properties: {
    titulo: { type: 'STRING', description: 'Short task title, in the language they used' },
    para_hoy: { type: 'BOOLEAN', description: 'True if it is for today' },
    vence: { type: 'STRING', description: 'Due date YYYY-MM-DD if they gave one (tomorrow, Friday…)' },
    para_crew: { type: 'BOOLEAN', description: 'True if it is for the crew (also when they name people from the crew)' },
    para: { type: 'ARRAY', items: { type: 'STRING' }, description: 'First names of the crew members in charge (one or several)' },
    enlace: { type: 'STRING', description: 'A link to attach, if they gave one' },
    destino: { type: 'STRING', enum: ['nova', 'todoist', 'google', 'linear'], description: 'Where to create it; only if they name Todoist, Google Tasks or Linear' },
  }, required: ['titulo'] },
};
const EMPEZAR_FOCO = {
  name: 'empezar_foco',
  description: 'Start a focus or learning session timer.',
  parameters: { type: 'OBJECT', properties: {
    minutos: { type: 'NUMBER', description: 'Length in minutes (5 to 120)' },
    que: { type: 'STRING', description: 'What they will focus on, if they said it' },
    aprender: { type: 'BOOLEAN', description: 'True if it is studying or learning' },
  }, required: ['minutos'] },
};

const S = (description) => ({ type: 'STRING', description }), N = (description) => ({ type: 'NUMBER', description });
// listas de la cuenta (compras, ideas, libros… de cualquier tipo): en todos los perfiles, también en misión
const LISTAS = [
  { name: 'crear_lista', description: 'Create a new list of any kind (groceries, ideas, books, trip…), optionally with its first items. If it already exists, it is reused.', parameters: { type: 'OBJECT', properties: { nombre: S('List name as they said it, e.g. "compras"'), items: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Optional first items, each short' }, para_crew: { type: 'BOOLEAN', description: 'Shared with the crew' } }, required: ['nombre'] } },
  { name: 'agregar_a_lista', description: 'Add one or more items to one of their lists (groceries, ideas, books…). Creates the list if it does not exist.', parameters: { type: 'OBJECT', properties: { lista: S('List name as they said it, e.g. "compras"'), items: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Items to add, each short' }, para_crew: { type: 'BOOLEAN', description: 'Only when creating a new list: shared with the crew' } }, required: ['lista', 'items'] } },
  { name: 'leer_lista', description: 'Read what is pending on one of their lists. With abrir: true it also opens that list in the app.', parameters: { type: 'OBJECT', properties: { lista: S('List name'), abrir: { type: 'BOOLEAN', description: 'true when they ask to open or see the list' } }, required: ['lista'] } },
  { name: 'marcar_en_lista', description: 'Check (or uncheck) an item on one of their lists, e.g. when they bought it.', parameters: { type: 'OBJECT', properties: { lista: S('List name'), item: S('The item'), hecho: { type: 'BOOLEAN', description: 'false to uncheck' } }, required: ['lista', 'item'] } },
  { name: 'quitar_de_lista', description: 'Remove an item from one of their lists.', parameters: { type: 'OBJECT', properties: { lista: S('List name'), item: S('The item') }, required: ['lista', 'item'] } },
];
const DIARIO_EXTRA = [
  { name: 'completar_tarea', description: 'Mark one of their open tasks as done.', parameters: { type: 'OBJECT', properties: { titulo: S('The task as they said it') }, required: ['titulo'] } },
  { name: 'recordarme', description: 'Schedule a reminder notification on their phone, today, tomorrow or on any date.', parameters: { type: 'OBJECT', properties: { texto: S('What to remind, short, in their language'), hora: S('Time as HH:MM 24h, if they gave a time (default 09:00 when only a date is given)'), fecha: S("Date YYYY-MM-DD for any day other than today/tomorrow, computed from today's date in the context"), dia: { type: 'STRING', enum: ['hoy', 'manana'], description: 'Day, if they said today or tomorrow' }, en_minutos: N('Minutes from now, if they said "in X minutes"') }, required: ['texto'] } },
  { name: 'cambiar_recordatorio', description: 'Move an existing reminder to another date/time, or delete it.', parameters: { type: 'OBJECT', properties: { recordatorio: S('The reminder as they said it'), fecha: S('New date YYYY-MM-DD'), hora: S('New time HH:MM 24h'), dia: { type: 'STRING', enum: ['hoy', 'manana'] }, en_minutos: N('Or minutes from now'), borrar: { type: 'BOOLEAN', description: 'true to delete it' } }, required: ['recordatorio'] } },
  { name: 'bloquear_calendario', description: 'Create an event in their personal phone calendar: a time block at an hour, or an all-day event on a date.', parameters: { type: 'OBJECT', properties: { titulo: S('Event title, short'), hora: S('Start time HH:MM 24h (omit for an all-day event)'), fecha: S("Date YYYY-MM-DD for any day other than today/tomorrow, computed from today's date in the context"), dia: { type: 'STRING', enum: ['hoy', 'manana'], description: 'Day, if they said today or tomorrow' }, minutos: N('Length in minutes'), todo_el_dia: { type: 'BOOLEAN', description: 'All-day event' }, calendario: S('Only if they name a specific calendar') }, required: ['titulo'] } },
  { name: 'cambiar_evento', description: 'Move an event in their phone calendar to another date/time, or delete it (events NOVA created come first).', parameters: { type: 'OBJECT', properties: { evento: S('The event as they said it'), fecha: S('New date YYYY-MM-DD'), hora: S('New start HH:MM 24h'), dia: { type: 'STRING', enum: ['hoy', 'manana'] }, minutos: N('New length in minutes'), todo_el_dia: { type: 'BOOLEAN' }, borrar: { type: 'BOOLEAN', description: 'true to delete it' } }, required: ['evento'] } },
  { name: 'marcar_habito', description: 'Log progress on one of their habits today (done, or an amount for counted habits like glasses of water).', parameters: { type: 'OBJECT', properties: { nombre: S('The habit as they said it'), cantidad: N('For counted habits: how much to add (e.g. 2 glasses, 10 pages). Omit to mark it done') }, required: ['nombre'] } },
  { name: 'crear_habito', description: 'Add a new habit (max 6), optionally with a daily amount goal, days of the week and reminder times.', parameters: { type: 'OBJECT', properties: { nombre: S('Short habit name in their language'), meta: N('Daily amount goal, if countable (8 glasses, 20 pages, 30 min)'), unidad: S('Unit for the goal: glasses, pages, min…'), dias: { type: 'ARRAY', items: { type: 'STRING', enum: ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] }, description: 'Only these days (omit for every day)' }, recordar: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Reminder times HH:MM 24h' } }, required: ['nombre'] } },
  { name: 'crear_reto', description: 'Create a challenge for their crew.', parameters: { type: 'OBJECT', properties: { titulo: S('Short title'), metrica: { type: 'STRING', enum: ['pasos', 'focoMin', 'aprendizajeMin', 'ejercicioMin', 'fotos', 'tareas'] }, meta: N('Goal for the whole crew together'), dias: N('Duration in days (1-60)') }, required: ['metrica', 'meta'] } },
  { name: 'escribir_diario', description: 'Save an entry in their log: personal (private) or the crew shared log.', parameters: { type: 'OBJECT', properties: { texto: S('The entry, in their words'), para_crew: { type: 'BOOLEAN', description: 'True for the crew shared log' }, tipo: { type: 'STRING', enum: ['nota', 'avance', 'problema', 'decision'], description: 'Kind of crew log entry' }, animo: N('Personal only: mood 0 (very low) to 4 (very good), if clear') }, required: ['texto'] } },
  { name: 'crear_meta', description: 'Create a team goal with key results.', parameters: { type: 'OBJECT', properties: { titulo: S('The objective'), hasta: S('Deadline YYYY-MM-DD, if they said a date'), dias: N('Or days from today'), resultados: { type: 'ARRAY', items: { type: 'OBJECT', properties: { titulo: S('Key result'), responsable: S('Owner first name'), meta: N('Target number, only if it is numeric'), unidad: S('Unit, if numeric') }, required: ['titulo'] } } }, required: ['titulo'] } },
  { name: 'actualizar_resultado', description: 'Update progress of a key result.', parameters: { type: 'OBJECT', properties: { resultado: S('The key result as they said it'), hecho: { type: 'BOOLEAN', description: 'Milestone done' }, sumar: N('Add to the current number'), valor: N('Set the current number') }, required: ['resultado'] } },
  { name: 'poner_alarma', description: 'Set an alarm in the phone Clock app.', parameters: { type: 'OBJECT', properties: { hora: S('Time HH:MM 24h'), etiqueta: S('Short label') }, required: ['hora'] } },
  { name: 'poner_temporizador', description: 'Start a countdown timer in the phone Clock app.', parameters: { type: 'OBJECT', properties: { minutos: N('Minutes'), segundos: N('Extra seconds'), etiqueta: S('Short label') }, required: ['minutos'] } },
  { name: 'recordar', description: 'Remember a fact about them for future conversations.', parameters: { type: 'OBJECT', properties: { dato: S('The fact, short, third person, in their language (e.g. "Wants to run a 10k in March")'), tipo: { type: 'STRING', enum: ['meta', 'gusto', 'persona', 'rutina', 'salud', 'otro'] } }, required: ['dato'] } },
  { name: 'olvidar', description: 'Forget something you remembered about them.', parameters: { type: 'OBJECT', properties: { dato: S('What to forget, as they said it') }, required: ['dato'] } },
  ...LISTAS,
  { name: 'agregar_rutina', description: 'Save a fixed recurring block of their week (work hours, a weekly meeting, classes, gym, commute). It counts as busy time.', parameters: { type: 'OBJECT', properties: { titulo: S('Short name, e.g. "Trabajo AGP", "Reu de equipo"'), tipo: { type: 'STRING', enum: ['trabajo', 'reunion', 'clase', 'ejercicio', 'traslado', 'otro'] }, dias: { type: 'ARRAY', items: { type: 'STRING', enum: ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] }, description: 'Days of the week it happens' }, inicio: S('Start HH:MM 24h'), fin: S('End HH:MM 24h') }, required: ['titulo', 'tipo', 'dias', 'inicio', 'fin'] } },
  { name: 'quitar_rutina', description: 'Remove a block from their routine (e.g. a meeting that no longer happens).', parameters: { type: 'OBJECT', properties: { titulo: S('Name of the block to remove') }, required: ['titulo'] } },
  { name: 'buscar_bitacora', description: 'Search the personal log and the crew log (texts, transcribed voice notes, standups, weekly summaries).', parameters: { type: 'OBJECT', properties: { q: S('1–3 topic words to search (never people names), in the language they were written'), quien: S('Optional: the crew member who said or wrote it, by name') }, required: ['q'] } },
  { name: 'hacer_standup', description: 'Post their daily standup to the crew log.', parameters: { type: 'OBJECT', properties: { ayer: S('What they did yesterday'), hoy: S('What they will do today'), bloqueo: S('What blocks them, if anything') }, required: ['hoy'] } },
  { name: 'guardar_para_repasar', description: 'Save something they learned for spaced review (asked again tomorrow, then less often).', parameters: { type: 'OBJECT', properties: { tema: S('Topic, short'), nota: S('The key idea in one or two sentences') }, required: ['tema', 'nota'] } },
  { name: 'asignar_tarea', description: 'Add or remove people in charge of a crew task.', parameters: { type: 'OBJECT', properties: { tarea: S('The task as they said it'), agregar: { type: 'ARRAY', items: { type: 'STRING' }, description: 'First names to add' }, quitar: { type: 'ARRAY', items: { type: 'STRING' }, description: 'First names to remove' } }, required: ['tarea'] } },
  { name: 'dar_reconocimiento', description: 'Give kudos to one or more crew members for something concrete. It notifies them and stays in the crew log.', parameters: { type: 'OBJECT', properties: { para: { type: 'ARRAY', items: { type: 'STRING' }, description: 'First names' }, texto: S('What for, in their words') }, required: ['para', 'texto'] } },
  { name: 'hacer_retro', description: "Post their answers to the crew's weekly retro.", parameters: { type: 'OBJECT', properties: { bien: S('What worked this week'), mejorar: S('What to improve'), probar: S('What to try next week'), anonimo: { type: 'BOOLEAN', description: 'True unless they want their name on it' } } } },
  { name: 'estado_github', description: "Recent activity of the crew's GitHub repos: failed or successful deploys, broken or fixed CI, pull requests opened, reviews requested, approved or merged." },
  { name: 'carga_equipo', description: 'How much each crew member has on their plate: open, overdue and this-week tasks, closed in 7 days, focus hours.' },
  { name: 'tareas_externas', description: 'Their pending tasks in Todoist, Google Tasks and Linear.' },
  { name: 'editar_tarea', description: 'Change an open task: its due date (postpone it, move it to another day, end of month, or remove the date), its title or its note.', parameters: { type: 'OBJECT', properties: { tarea: S('The task as they said it'), vence: S('New due date YYYY-MM-DD, computed from today\'s date in the context'), sin_fecha: { type: 'BOOLEAN', description: 'true to remove the due date' }, titulo: S('New title, only if they want to rename it'), nota: S('A note to add') }, required: ['tarea'] } },
  { name: 'ajustar_avisos', description: 'Turn one or more kinds of notifications on or off (the same switches as Settings → Notifications).', parameters: { type: 'OBJECT', properties: { tipos: { type: 'ARRAY', items: { type: 'STRING', enum: ['crew', 'equipo', 'standup', 'bitacora', 'retos', 'github', 'salud', 'recordatorio_manana', 'recordatorio_standup', 'recordatorio_habitos', 'recordatorio_checkin', 'recordatorio_dormir'] }, description: 'crew = crew photos/reactions/who joins; equipo = tasks assigned, finished, due tomorrow; standup = standups and blockers; bitacora = crew log; retos = challenges; github = deploys, CI, PRs and reviews; salud = crew wellbeing; recordatorio_* = NOVA daily reminders (morning 8:00, standup 9:30, habits left 20:00, check-in 21:00, bedtime)' }, activar: { type: 'BOOLEAN', description: 'true to turn on, false to turn off' } }, required: ['tipos', 'activar'] } },
  { name: 'ver_avisos', description: 'Which kinds of notifications are on or off right now.' },
  { name: 'abrir', description: 'Open a screen of the app.', parameters: { type: 'OBJECT', properties: { pantalla: { type: 'STRING', enum: ['github', 'acta', 'retro', 'kudos', 'carga', 'conexiones', 'hoy', 'resumen', 'habitos', 'repaso', 'foco', 'crew', 'metas', 'salud_crew', 'cuerpo', 'mente', 'diario', 'bitacora_crew', 'standup', 'compartir', 'permisos', 'datos', 'recordatorios', 'rutina', 'actividad', 'memoria', 'mapa', 'tu', 'integraciones', 'ajustes', 'manana', 'listas'] } }, required: ['pantalla'] } },
];

const CHECKIN = {
  name: 'registrar_checkin',
  description: "Log tonight's check-in: the astronaut's mood, stress and fatigue as you understood them from their words.",
  parameters: {
    type: 'OBJECT',
    properties: {
      animo: { type: 'STRING', enum: ['Good', 'Okay', 'Low'], description: 'Mood' },
      estres: { type: 'STRING', enum: ['Low', 'Moderate', 'High'], description: 'Stress' },
      fatiga: { type: 'STRING', enum: ['None', 'Mild', 'High'], description: 'Fatigue' },
    },
    required: ['animo', 'estres', 'fatiga'],
  },
};
// NOVA muestra en el chat lo que está explicando (las tarjetas viven en src/ui/TarjetasNova.tsx)
const VISUALES = [
  {
    name: 'mostrar_grafico',
    description: 'Show a chart of one measurement in the conversation, with its recent history and their usual range, while you talk about it.',
    parameters: { type: 'OBJECT', properties: { metrica: { type: 'STRING', enum: ['hrv', 'sleep', 'heart_rate', 'spo2', 'skin_temp', 'respiration', 'readiness', 'radiation', 'mood_week', 'training', 'bone', 'muscle'] } }, required: ['metrica'] },
  },
  { name: 'mostrar_resumen', description: "Show today's key vitals at a glance (heart, readiness, sleep, HRV)." },
  { name: 'mostrar_plan', description: "Show today's schedule." },
];
// el teléfono (Android, módulo nova-control): música, cámara, apps, linterna y volumen
const TELEFONO = [
  { name: 'control_musica', description: 'Control whatever music or audio is playing on the phone (Spotify, YouTube Music, podcasts…): pause, resume, next, previous, or ask what is playing.', parameters: { type: 'OBJECT', properties: { accion: { type: 'STRING', enum: ['pausar', 'reanudar', 'siguiente', 'anterior', 'que_suena'] } }, required: ['accion'] } },
  { name: 'poner_musica', description: 'Search and play a song, artist, album or playlist in Spotify or YouTube Music.', parameters: { type: 'OBJECT', properties: { busqueda: S('What to play, as precise as possible: "Lateralus Tool", "Daft Punk", "lofi para estudiar"'), app: { type: 'STRING', enum: ['spotify', 'youtube_music'], description: 'Only if they name the app' }, tipo: { type: 'STRING', enum: ['cancion', 'artista', 'album', 'playlist'] } }, required: ['busqueda'] } },
  { name: 'abrir_camara', description: 'Open the phone camera app.', parameters: { type: 'OBJECT', properties: { modo: { type: 'STRING', enum: ['foto', 'video', 'selfie'] } } } },
  { name: 'abrir_app', description: 'Open an installed app by its name (WhatsApp, Maps, Instagram, Calculator…).', parameters: { type: 'OBJECT', properties: { nombre: S('App name as they said it') }, required: ['nombre'] } },
  { name: 'linterna', description: 'Turn the flashlight on or off.', parameters: { type: 'OBJECT', properties: { encender: { type: 'BOOLEAN' } }, required: ['encender'] } },
  { name: 'volumen', description: 'Change the media volume.', parameters: { type: 'OBJECT', properties: { accion: { type: 'STRING', enum: ['subir', 'bajar', 'silenciar', 'nivel'] }, nivel: N('0-100, only with accion=nivel') }, required: ['accion'] } },
  { name: 'redactar_mensaje', description: 'Write a message for one of their contacts (WhatsApp by default, SMS or email) and show it as a draft on screen. Call it again with the new text to change it. Nothing is sent.', parameters: { type: 'OBJECT', properties: { para: S('Contact as they said it ("mi mamá" → "mamá", "Benja") or a phone number'), texto: S('The full message, written as THEM, first person'), via: { type: 'STRING', enum: ['whatsapp', 'sms', 'correo'] }, asunto: S('Email subject, only for correo'), contacto_id: S('Only after the tool listed several matches («varios»): the contacto_id of the one they chose') }, required: ['para', 'texto'] } },
  { name: 'enviar_mensaje', description: 'They approved the draft: open the chat with the message written so they send it with one tap.' },
  { name: 'llamar', description: 'Call one of their contacts or a number.', parameters: { type: 'OBJECT', properties: { a: S('Contact as they said it, or a number'), contacto_id: S('Only after the tool listed several matches («varios»): the contacto_id of the one they chose') }, required: ['a'] } },
  { name: 'navegar', description: 'Start navigation to a place in Google Maps (or Waze if they say so).', parameters: { type: 'OBJECT', properties: { destino: S('Place or address as precise as possible'), modo: { type: 'STRING', enum: ['auto', 'caminando', 'bicicleta', 'transporte'] }, app: { type: 'STRING', enum: ['maps', 'waze'] } }, required: ['destino'] } },
  { name: 'leer_mensajes', description: 'Their unread chats (WhatsApp, SMS, Telegram…) taken from the phone notifications: who wrote and what. Use when they ask what someone wrote, if there is anything new, or before replying to someone.', parameters: { type: 'OBJECT', properties: { de: S('Only this person or group, as they said it; omit for everything new') } } },
  { name: 'modo_telefono', description: 'Switch the phone to normal, vibrate, silent, do not disturb (priority only) or alarms only.', parameters: { type: 'OBJECT', properties: { modo: { type: 'STRING', enum: ['normal', 'vibrar', 'silencio', 'no_molestar', 'solo_alarmas'] } }, required: ['modo'] } },
  { name: 'mi_github', description: "Their own GitHub, shown visually: commits and contributions today (with the week), the whole year calendar (the contribution heatmap), or what is pending (open PRs, reviews requested, issues). Say the key number in a few words; the card shows the rest.", parameters: { type: 'OBJECT', properties: { que: { type: 'STRING', enum: ['hoy', 'semana', 'anio', 'pendientes'] } }, required: ['que'] } },
  { name: 'ficha_de', description: "Everything NOVA knows about a person of their crew (or themselves): their networks (GitHub, LinkedIn, Instagram, X, website) and their GitHub activity (followers, repos, commits this week). Shows a card with tappable links. Use for «el GitHub de Benja», «el LinkedIn de Luis», «¿qué sabes de X?».", parameters: { type: 'OBJECT', properties: { persona: S('Who, as they said it; «yo» for themselves') }, required: ['persona'] } },
  { name: 'mirar', description: 'Turn the phone camera on so you can see what they are showing you («mira esto», «¿qué es esto?», «léeme esto», «tradúceme esto»), or off when done. While it is on you receive live frames of what the camera sees.', parameters: { type: 'OBJECT', properties: { encender: { type: 'BOOLEAN' } }, required: ['encender'] } },
  // ver y usar la app que está en pantalla (accesibilidad, 0.9)
  { name: 'ver_pantalla', description: 'What is on the phone screen right now: the app in front and its elements, each with an id (#n): texts, buttons, fields, rows, lists, with what can be done to them [tocar, escribir, desplazar]. Call it BEFORE acting inside an app and AFTER each action to see the result.' },
  { name: 'leer_pantalla', description: 'All the visible text on screen, top to bottom: to read an email, a page, a chat or a document out loud, summarize it or translate it.' },
  { name: 'mirar_pantalla', description: 'A picture of the screen (sent to you as a frame) when text is not enough: a photo, a map, a chart, a design, a video thumbnail. Then say what you see.' },
  { name: 'tocar', description: 'Tap an element of the screen: by its id from ver_pantalla (elemento) or by what it says (texto).', parameters: { type: 'OBJECT', properties: { elemento: N('The id number from ver_pantalla'), texto: S('Or the text it shows, exact or part of it') } } },
  { name: 'escribir', description: 'Type text in a field on screen (the one given, the focused one, or the first field). enviar=true also presses enter (search/send).', parameters: { type: 'OBJECT', properties: { texto: S('What to type'), elemento: N('The field id from ver_pantalla, if known'), enviar: { type: 'BOOLEAN', description: 'Press enter after typing' } }, required: ['texto'] } },
  { name: 'desplazar', description: 'Scroll the screen or a list.', parameters: { type: 'OBJECT', properties: { direccion: { type: 'STRING', enum: ['abajo', 'arriba', 'izquierda', 'derecha'] }, elemento: N('The list id from ver_pantalla, if any') }, required: ['direccion'] } },
  { name: 'tecla', description: 'The phone keys: back, home, recents, or open the notification shade.', parameters: { type: 'OBJECT', properties: { cual: { type: 'STRING', enum: ['atras', 'inicio', 'recientes', 'notificaciones'] } }, required: ['cual'] } },
  { name: 'burbuja', description: 'Shrink yourself to the small floating bubble (they keep using the app behind while you stay listening): «quédate chica», «no tapes», «hazte a un lado».' },
  { name: 'pantallazo', description: 'Take a screenshot of what is on the screen behind you, like the phone\'s own screenshot (it is saved to the gallery): «saca un pantallazo», «captura la pantalla», «screenshot», «guárdame esto».' },
  // notificaciones de cualquier app, portapapeles y alarmas
  { name: 'leer_notificaciones', description: 'The latest notifications on the phone from ANY app (email, bank, deliveries, social, calendar, chats…): app, who, text and how many minutes ago, newest first. Use for «¿qué dice la última notificación?», «¿me llegó algo?», «¿qué era eso que sonó?».', parameters: { type: 'OBJECT', properties: { de: S('Only this app or person, as they said it; omit for everything'), cuantas: N('How many (default 5)') } } },
  { name: 'abrir_notificacion', description: 'Open what a notification opens when tapped (the email, the chat, the order, the post). Use the clave from leer_notificaciones; without it, the newest one.', parameters: { type: 'OBJECT', properties: { clave: S('The clave from leer_notificaciones'), de: S('Or the app/person, as they said it') } } },
  { name: 'copiar', description: 'Copy a text to the phone clipboard («copia el código», «cópiame eso»).', parameters: { type: 'OBJECT', properties: { texto: S('The exact text to copy') }, required: ['texto'] } },
  { name: 'quitar_alarma', description: 'Turn off an alarm in the phone Clock app by its label (the name you gave it, see ALARMS YOU SET) or by its time.', parameters: { type: 'OBJECT', properties: { etiqueta: S('The alarm label, exactly as it was set'), hora: S('Or its time HH:MM 24h') } } },
  { name: 'ver_alarmas', description: 'Open the alarms list in the Clock app (and tells you which ones you set).' },
];
/* desde el Mac (mac/): lo que existe en los dos lados lleva `donde` para elegir el Mac (por defecto) o el teléfono */
const EN_AMBOS = new Set(['pantallazo', 'mirar_pantalla', 'leer_pantalla', 'abrir_app', 'volumen', 'control_musica', 'poner_musica', 'copiar', 'navegar', 'recordarme', 'poner_temporizador']);
const conDonde = h => (EN_AMBOS.has(h.name) ? { ...h, parameters: { type: 'OBJECT', properties: { ...(h.parameters?.properties ?? {}), donde: { type: 'STRING', enum: ['mac', 'telefono'], description: 'The Mac (default) or their phone: telefono only when they say phone, celular or teléfono' } }, ...(h.parameters?.required ? { required: h.parameters.required } : {}) } } : h);
/* en el Mac, NOVA tiene manos en el computador: le encarga a Claude Code (mac/claude.js) lo que va más allá de sus
   herramientas. Es una sola NOVA: el widget se pone naranja mientras Claude trabaja y ella dice el resultado */
const EN_EL_MAC = { name: 'en_el_mac', description: 'Your hands on the Mac: a computer agent (Claude Code) that can do ANYTHING on the computer. Use it for everything beyond your other tools: files and folders, code and projects, the terminal, installing things, web research with sources, writing or summarizing documents, emails, spreadsheets, automating any Mac app (browser, VS Code, Spotify, Finder…), comparing, charts from real data, multi-step tasks. Pass the whole request in Spanish, with the exact names, words and numbers they said and any context from the conversation. It answers with resultado (what it did or found) when done, or en_curso=true if it is still working (then it will tell you the result later).', parameters: { type: 'OBJECT', properties: { pedido: S('The full task, in Spanish, as precise as possible (exact names, paths, words, numbers they said)') }, required: ['pedido'] } };
const herramientas = (modo, perfil, dispositivo) => {
  let propias = perfil === 'diario' ? [CREAR_TAREA, EMPEZAR_FOCO, ...DIARIO_EXTRA, ...TELEFONO] : [...VISUALES, ...LISTAS];
  if (dispositivo === 'mac') propias = [...propias.map(conDonde), EN_EL_MAC];
  return [{ functionDeclarations: modo === 'checkin' ? [CHECKIN, ...propias] : propias }];
};

/** la capa del asistente: la llamaron desde fuera de la app (botón del asistente, ficha o audífonos) */
const ASISTENTE = `
RIGHT NOW they called you from outside the app, with the phone's assistant button, over whatever they were doing (music, a video, another app). They expect a quick command: do it with the tools and answer in very few words. Questions are fine too: answer in ONE short sentence (two at most), the key fact first, no preamble, no recap of what they asked, no closing question unless you need something. Every second you talk is a second they wait. Do not greet.`;

/** NOVA flotando en el escritorio del Mac (mac/): mismas herramientas; las del teléfono se hacen a distancia */
const MAC = `
RIGHT NOW they are talking to you from the NOVA widget floating on their Mac desktop, while they work. Be quick: do it with the tools and answer in very few words; questions in ONE short sentence (two at most), the key fact first, no preamble, no closing question unless you need something. Do not greet.
Every phone tool still works: it runs on their phone at a distance. If a tool answers pendiente=true, the app is closed on the phone: say it is waiting on the phone notification, in a few words. Tools that exist on both sides (screenshot, look at or read the screen, open an app, volume, music, copy, directions, reminders, timers) take donde: the Mac unless they say phone, celular or teléfono.
mirar_pantalla / leer_pantalla on the Mac send you a picture of their Mac screen: answer about what you see.
YOUR HANDS ON THE MAC: en_el_mac does anything on the computer (files, code, terminal, web research, documents, emails, automating apps, multi-step work). Use your own tools for what they cover (tasks, lists, alarms, music, volume…); for everything else on the computer, call en_el_mac right away with the full request instead of saying you cannot. Before calling it say two or three words («Dale, voy.»). When it answers, tell them the resultado in one or two short sentences. If it says en_curso, say it is still working and you will tell them; when its result arrives later as a message, tell them.
TRUTH: never say something is done, saved or added unless the tool answered ok. If it failed or you are not sure, say so plainly.
ONE CALL PER REQUEST: for one request call each tool once (one item added once, one task created once); never repeat a call because they paused or added a detail, and never add the same thing to more than one list.`;

const DEBUG = !!process.env.DEBUG;
// En la nube el puente exige una clave (NOVA_TOKEN) para que nadie más gaste la cuota de Gemini.
// En el Mac, sin la variable, sigue abierto como antes.
const TOKEN = process.env.NOVA_TOKEN ?? '';

/* ─────────── /decir: un texto en la voz de NOVA (la misma de la conversación), en WAV ───────────
   Lo usa la app para todo lo que NOVA dice fuera de la conversación (Hoy, el recorrido, el respaldo sin conexión),
   así nunca suena la voz robótica del teléfono. Primero el modelo de TTS de Gemini con la misma voz; si no está
   disponible, una sesión Live que lo lee tal cual. Las frases quedan en caché (las repetidas salen al instante). */
const MODELO_TTS = process.env.MODELO_TTS ?? 'gemini-2.5-flash-preview-tts';
const cacheVoz = new Map(); // texto → WAV
const wavDe = (pcm, hz = 24000) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(hz, 24); h.writeUInt32LE(hz * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
let ttsOk = true;
async function porTts(texto, es) {
  if (!ttsOk) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_TTS}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${es ? 'Dilo con voz cálida, natural y cercana, en español latinoamericano neutro' : 'Say it in a warm, natural, friendly voice'}: ${texto}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } } } }),
  }).catch(() => null);
  if (!r) return null;
  if (r.status === 404 || r.status === 403) { ttsOk = false; console.warn('TTS no disponible, uso Live:', r.status); return null; }
  if (!r.ok) { console.warn('TTS', r.status, (await r.text()).slice(0, 160)); return null; }
  const d = (await r.json()).candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!d?.data) return null;
  const hz = Number(String(d.mimeType).match(/rate=(\d+)/)?.[1] ?? 24000);
  return wavDe(Buffer.from(d.data, 'base64'), hz);
}
/** alTrozo (opcional): recibe cada pedazo de PCM 24 kHz apenas llega, para sonar mientras se genera */
function porLive(texto, es, alTrozo) {
  return new Promise(resolve => {
    const g = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`);
    const trozos = [], fin = setTimeout(() => { g.close(); resolve(null); }, 20000);
    g.on('open', () => g.send(JSON.stringify({ setup: {
      model: `models/${MODELO}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } }, ...(ES_25 ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      systemInstruction: { parts: [{ text: `You are a text-to-speech voice. Read the user's message aloud EXACTLY, word for word, ${es ? 'in neutral Latin American Spanish' : 'in English'}, warm and natural. Never add, answer or comment anything.` }] },
    } })));
    g.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.setupComplete) { g.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: texto }] }], turnComplete: true } })); return; }
      for (const p of m.serverContent?.modelTurn?.parts ?? []) if (p.inlineData?.data) { const b = Buffer.from(p.inlineData.data, 'base64'); trozos.push(b); alTrozo?.(b); }
      if (m.serverContent?.turnComplete) { clearTimeout(fin); g.close(); resolve(trozos.length ? wavDe(Buffer.concat(trozos)) : null); }
    });
    g.on('error', () => { clearTimeout(fin); resolve(null); });
  });
}
/** el PCM y su frecuencia dentro de un WAV */
function pcmDe(wav) {
  const i = wav.indexOf('data', 12);
  return { pcm: i < 0 ? wav.subarray(44) : wav.subarray(i + 8), hz: wav.readUInt32LE(24) };
}
/** como decir(), pero por partes: entrega el PCM apenas Gemini Live lo genera (el Mac suena al primer trozo, no al
    final). Lo que está en caché sale de una vez; si Live no da nada, la frase completa por TTS */
async function decirFlujo(texto, es, alTrozo) {
  const clave = `${es ? 'es' : 'en'}|${texto}`;
  if (cacheVoz.has(clave)) { const { pcm, hz } = pcmDe(cacheVoz.get(clave)); alTrozo(pcm, hz); return true; }
  let alguno = false;
  const wav = await porLive(texto, es, b => { alguno = true; alTrozo(b, 24000); });
  if (wav) { cacheVoz.set(clave, wav); if (cacheVoz.size > 300) cacheVoz.delete(cacheVoz.keys().next().value); }
  if (alguno) return true;
  const tts = await porTts(texto, es).catch(() => null);
  if (!tts) return false;
  const { pcm, hz } = pcmDe(tts); alTrozo(pcm, hz);
  cacheVoz.set(clave, tts);
  return true;
}

async function decir(texto, es) {
  const clave = `${es ? 'es' : 'en'}|${texto}`;
  if (cacheVoz.has(clave)) return cacheVoz.get(clave);
  // los dos caminos a la vez (el TTS a veces está saturado y Live tarda lo que dura el audio): gana el primero que responde
  const tts = Promise.race([porTts(texto, es), new Promise(r => setTimeout(() => r(null), 7000))]).then(w => w ?? Promise.reject(new Error('tts')));
  const live = porLive(texto, es).then(w => w ?? Promise.reject(new Error('live')));
  const wav = await Promise.any([tts, live]).catch(() => null);
  if (wav) { cacheVoz.set(clave, wav); if (cacheVoz.size > 300) cacheVoz.delete(cacheVoz.keys().next().value); }
  return wav;
}

const http = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/decir') {
    const texto = String(u.searchParams.get('t') ?? '').trim().slice(0, 600);
    if ((TOKEN && u.searchParams.get('k') !== TOKEN) || !texto) { res.writeHead(TOKEN && u.searchParams.get('k') !== TOKEN ? 401 : 400); res.end(); return; }
    if (u.searchParams.get('flujo') === '1') {
      // PCM 16 bits por partes (audio/L16); la frecuencia va en x-hz. El teléfono sigue usando el WAV completo
      const t0 = Date.now();
      let empezo = false;
      await decirFlujo(texto, u.searchParams.get('i') !== 'en', (pcm, hz) => {
        if (!empezo) { empezo = true; res.writeHead(200, { 'content-type': `audio/L16;rate=${hz}`, 'x-hz': String(hz), 'cache-control': 'no-store' }); if (DEBUG) console.log(`decir (flujo) primer trozo ${Date.now() - t0} ms`); }
        res.write(pcm);
      }).catch(() => false);
      if (!empezo) res.writeHead(503);
      res.end(); return;
    }
    const t0 = Date.now(), wav = await decir(texto, u.searchParams.get('i') !== 'en').catch(() => null);
    if (!wav) { res.writeHead(503); res.end(); return; }
    if (DEBUG) console.log(`decir ${Date.now() - t0} ms · ${texto.slice(0, 40)}`);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'public, max-age=604800' });
    res.end(wav); return;
  }
  res.writeHead(u.pathname === '/salud' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(u.pathname === '/salud' ? { ok: true, voz: VOZ, modelo: MODELO, tts: ttsOk ? MODELO_TTS : 'live' } : { error: 'no existe' }));
});

const wss = new WebSocketServer({ server: http, path: '/vivo' });
wss.on('connection', (app, req) => {
  if (TOKEN && new URL(req.url, 'http://x').searchParams.get('k') !== TOKEN) { console.warn('conexión rechazada: clave incorrecta'); app.close(4401, 'no autorizado'); return; }
  console.log('conexión nueva');
  let gem = null, listo = false, t = Date.now(), visto = new Set();
  const marca = k => { if (DEBUG && !visto.has(k)) { visto.add(k); console.log(`${(Date.now() - t).toString().padStart(6)} ms  ${k}`); } };
  const pendientes = [];
  const aApp = obj => { if (app.readyState === WebSocket.OPEN) app.send(JSON.stringify(obj)); };
  const aGem = obj => { if (gem?.readyState === WebSocket.OPEN && listo) gem.send(JSON.stringify(obj)); else pendientes.push(obj); };

  app.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.tipo === 'inicio') {
      console.log(`inicio ${m.modo}/${m.perfil}${m.asistente ? '/asistente' : ''} · contexto ${String(m.contexto?.datos ?? '').length} car`);
      const abrir = conBusqueda => {
        const t0 = Date.now();
        gem = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`);
        gem.on('open', () => gem.send(JSON.stringify({ setup: {
          model: `models/${MODELO}`,
          // sin razonamiento previo en todos los modelos (medido 10 oct 2026 con el 3.1: el primer audio baja ~100 ms)
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } }, thinkingConfig: { thinkingBudget: 0 } },
          // fin de turno rápido: 300 ms de silencio bastan para que NOVA responda
          // en el Mac se dictan órdenes completas: espera una pausa real (0,9 s) antes de dar la frase por terminada, así
          // «agrega… un basurero» no se corta a la mitad. El teléfono sigue con el corte rápido de la conversación
          realtimeInputConfig: { automaticActivityDetection: m.dispositivo === 'mac'
            ? { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 300, silenceDurationMs: 900 }
            : { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 40, silenceDurationMs: 300 } },
          systemInstruction: { parts: [{ text: instrucciones(m.modo, m.contexto, m.idioma, m.perfil) + (m.dispositivo === 'mac' ? MAC : m.asistente ? ASISTENTE : '') + (conBusqueda ? '' : '\nWEB SEARCH IS NOT AVAILABLE in this conversation: never say you are searching or checking online. For current events, say plainly that you cannot check live information right now.') }] },
          // búsqueda de Google para preguntas de actualidad (si el modelo no la acepta al iniciar, se reconecta sin ella)
          tools: conBusqueda ? [{ googleSearch: {} }, ...herramientas(m.modo, m.perfil, m.dispositivo)] : herramientas(m.modo, m.perfil, m.dispositivo),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        } })));
        gem.on('message', raw2 => {
          const g = JSON.parse(raw2.toString());
          if (g.setupComplete) {
            listo = true;
            console.log(`sesión ${m.modo} lista en ${Date.now() - t0} ms`);
            aApp({ tipo: 'listo' });
            // NOVA abre la conversación solo si la app lo pide (check-in); en el chat espera a que hables (sin saludo largo)
            if (m.saludar !== false) gem.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `(${m.perfil === 'diario' ? 'They' : 'The astronaut'} just opened the conversation. Start now.)` }] }], turnComplete: true } }));
            pendientes.splice(0).forEach(aGem);
            return;
          }
          const sc = g.serverContent;
          if (sc) {
            for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) { marca('gemini: primer audio de NOVA'); aApp({ tipo: 'audio', data: p.inlineData.data }); }
            if (sc.outputTranscription?.text) aApp({ tipo: 'dice', texto: sc.outputTranscription.text });
            if (sc.inputTranscription?.text) { marca('gemini: transcribe lo que dices'); aApp({ tipo: 'oye', texto: sc.inputTranscription.text }); }
            if (sc.interrupted) aApp({ tipo: 'interrumpido' });
            if (sc.turnComplete) { aApp({ tipo: 'fin_turno' }); if (DEBUG) { console.log('       fin de turno'); visto = new Set(); t = Date.now(); } }
          }
          for (const f of g.toolCall?.functionCalls ?? []) aApp({ tipo: 'herramienta', id: f.id, nombre: f.name, args: f.args });
        });
        gem.on('close', (code, why) => {
          // por qué se cayó una sesión (sobre todo si nunca llegó a estar lista): código, motivo y tamaño del contexto
          if (code !== 1000 || !listo) console.warn(`Gemini cerró ${code} ${listo ? 'durante' : 'ANTES de estar lista'} · ${m.modo}/${m.perfil}${m.asistente ? '/asistente' : ''} · contexto ${String(m.contexto?.datos ?? '').length} car · ${why.toString().slice(0, 300)}`);
          if (!listo && conBusqueda && app.readyState === WebSocket.OPEN) { console.warn('búsqueda no aceptada, reconecto sin ella:', code, why.toString().slice(0, 160)); abrir(false); return; }
          if (code !== 1000) aApp({ tipo: 'error', mensaje: why.toString() || `Gemini cerró (${code})` }); app.close();
        });
        gem.on('error', e => { if (!listo && conBusqueda) return; aApp({ tipo: 'error', mensaje: e.message }); });
      };
      // la búsqueda de Google exige cuota de «grounding» en la clave de Gemini (el plan gratis no la tiene): se enciende con CON_BUSQUEDA=1
      abrir(m.perfil === 'diario' && process.env.CON_BUSQUEDA === '1');
      return;
    }
    if (m.tipo === 'audio') { const v = Buffer.from(m.data, 'base64'); let e = 0; for (let i = 0; i < v.length; i += 2) e = Math.max(e, Math.abs(v.readInt16LE(i))); if (e > 3000) marca('app: llega voz del micrófono'); else if (visto.has('app: llega voz del micrófono')) marca('app: silencio después de tu voz'); }
    if (m.tipo === 'audio') aGem({ realtimeInput: { audio: { data: m.data, mimeType: `audio/pcm;rate=${m.rate ?? 16000}` } } });
    else if (m.tipo === 'contexto') aGem({ clientContent: { turns: [{ role: 'user', parts: [{ text: `(Live device update for your context. Do not reply to this message.)\n${m.texto}` }] }], turnComplete: false } });
    else if (m.tipo === 'imagen') aGem({ realtimeInput: { video: { data: m.data, mimeType: 'image/jpeg' } } });
    else if (m.tipo === 'texto') aGem({ clientContent: { turns: [{ role: 'user', parts: [{ text: m.texto }] }], turnComplete: true } });
    else if (m.tipo === 'herramienta') aGem({ toolResponse: { functionResponses: [{ id: m.id, name: m.nombre, response: m.respuesta ?? { ok: true } }] } });
  });
  app.on('close', () => gem?.close());
});

http.listen(PUERTO, '0.0.0.0', () => console.log(`Voz de NOVA en ws://0.0.0.0:${PUERTO}/vivo (${MODELO}, voz ${VOZ})`));
