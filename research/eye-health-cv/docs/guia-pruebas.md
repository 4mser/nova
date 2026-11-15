# Test guide: what to do, in order

Paste each command into Claude Code (with `!` at the start). A window opens with your camera.
`q` or ESC abort without saving anything. Images and video are never saved.

## Before starting (once only)
- Desk lighting, no glasses, monitor at about 50 cm.
- Head supported (against the high back of the chair or the wall; NEVER with your hand on your face).
- **Relaxed eyebrows** during all recordings (no frowning or raising), except in the control test.
- When the window opens, **move it to the top edge of the screen, right next to the camera**. That way the red dot is at eye level.

## Where to rest your head
- **Best:** against the high back of the chair, a headrest or the wall (sitting close to it).
- **Alternative:** back supported, elbows on the table and head upright, without resting it on anything.
- **Do not put your hand on your face, temple or forehead:** it can cover the eyebrows or the edge of the eyes, which is exactly what we measure. Do not rest your chin on your hand either (it moves the cheeks, which the filter uses as a reference).
- It is not mandatory: the goal is to stay still. If the traffic light is green and you are not moving, it is fine.

## Step 1. Check the eyebrow points (1 minute, records nothing)
Command: `--brow-check`
- Look at the window: **upper eyebrow in green, lower in red**. They should follow the edge of your eyebrows.
- The **n** key numbers the points.
- If the lines do not fall where they should, **stop and tell me** before continuing.
- Exit with **q**.

## Step 2. Three noise-floor sessions (sessions 5, 6 and 7)
Each session is 3 blocks of 20 seconds. It takes about 2 to 3 minutes (plus processing).

**In each block:**
1. 15 s countdown at the start and 5 s between blocks: settle in and look at the **red dot**.
2. "Waiting for stillness": do not move your head or talk. It starts only when the indicators are green.
3. **1 beep = recording.** Look at the red dot the whole time, still, without talking. **Blink normally**, without holding back. Relaxed eyebrows.
4. **2 beeps = block finished.** During the 5 s pause, relax your neck.
5. **3 beeps = you moved.** The block repeats automatically (up to 2 times).

**Between one session and the next (important):**
1. **Get up from the chair** and walk for about 20 to 30 seconds.
2. **Sit back down as you normally would.** Do not try to end up the same or different: that natural variation is what is being measured.
3. Rest your head again and keep your eyebrows relaxed.
4. Launch the next session with another `--session-id` (6, then 7).

**Why you have to get up:** an astronaut's baseline is measured one day and compared with another. Nobody sits exactly the same way two days in a row. If you stay seated, the minimum detectable change comes out too optimistic. At the end of each session, the program reminds you in the console and with 3 beeps.

## Step 3. Eyebrow control test (1 minute)
Command: `--brow-control`. Do it **after** the 3 sessions.
- 10 s with a neutral face, 10 s with **raised eyebrows**, 4 s of rest and 10 s **frowning**.
- It confirms that the expression filter works and that the change in pupil-eyebrow distance exceeds 3 times the noise.

## Step 4. Final report
Command: `--noise-floor-report --exclude-sessions 1,2,3,4`
- Excludes the old sessions, which did not measure the eyebrow.
- Requires nothing from you. It prints the report and saves it in `docs/spike-resultados.md`.

## If something goes wrong
- **It never turns green:** support your head better and breathe calmly; after 30 s it starts anyway and leaves the capture flagged.
- **"TE MOVISTE" (you moved) repeatedly:** the message says which criterion failed (for example "IOD 70 %"). Send it to me.
- **The window does not open:** add `--no-view` to the command.
- **The eyebrow points do not fall correctly (step 1):** tell me before measuring.
