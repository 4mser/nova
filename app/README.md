# NOVA — astronaut app

The phone app the crew carries. NOVA floats over every screen; tap it to talk.

**Stage 1 (this build):** full interface with simulated data. Every reading is labeled `SIMULATED`, `LIVE` or `PROTOTYPE`.
**Stage 2:** Polar H10 chest strap over Bluetooth (needs a development build, not Expo Go).

## Run it

```bash
npm install
npx expo start      # scan the QR with Expo Go
npx expo start --web
```

## Map

- `src/app/` routes: `(tabs)/` Today, Body, Mind, You · `nova` chat sheet · `evidencia` the "Why?" sheet
- `src/nova/` NOVA in Skia (`forma.ts` silhouette, eyes and orbs as worklets; `NovaOrb.tsx`; `Flotante.tsx`)
- `src/engine/` contracts (Evidence → Inference → NovaResponse), personal baseline with robust z-score, abstention below 0.6 signal quality, rule-based conversation
- `src/ui/` theme, ECG trace, rings, constellation

Rule from the spec: NOVA only makes a health statement when it has evidence refs. Not a medical device.

## Voice

Nova talks in real time, in the language you speak, with her own voice (Aoede, the same as in the presentation
video). A small bridge on the Mac keeps the Gemini key out of the app and connects the phone to the Gemini Live API
(`gemini-3.1-flash-live-preview`: Nova starts answering ~1.3 s after you stop talking):

```bash
cd servidor && npm install && node voz.mjs     # ws://<mac>:8132/vivo, next to Metro (8131)
```

The app finds it on the same host as Metro (or `EXPO_PUBLIC_VOZ_URL`). The microphone streams PCM while the voice
conversation is open; Nova's audio arrives in pieces, is queued in a playlist and drives her body and light from the
real amplitude. Nova gets today's data as context and follows the same rules as the rest of the app: health
statements only from that data, no diagnosis, decisions belong to the flight surgeon. The evening check-in is logged
with a function call. Without the bridge, Nova falls back to the on-board rules and the phone's voice.
