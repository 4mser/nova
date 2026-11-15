# NOVA Station NFC reader · contract v1

The NOVA Station tablet is shared by the whole crew. Each astronaut has an NFC card (or tag); when they bring it to
the reader, the ship opens their personal space on the tablet. The reader is an external module (PN532, RC522,
ACR122U or another) and only needs to tell the ship **which UID it read and on which reader**.

## Option A · the reader talks to the ship over the network (recommended)

A board with networking (ESP32, Raspberry Pi Pico W, etc.) sends one POST per read:

```
POST http://<ship>:8750/v1/nfc
content-type: application/json
x-nova-token: <only if the ship sets NOVA_TOKEN>

{"uid": "04:A1:B2:C3", "lector": "station"}
```

- `uid`: the card UID in hexadecimal. The format does not matter (`04:a1:b2:c3`, `04 A1 B2 C3`, `04a1b2c3`): the ship
  normalizes it to `04A1B2C3`.
- `lector`: the reader name (letters, digits and hyphens). It is the same name set in the settings of the tablet next
  to it. Default `station`.
- Responses: `{"ok":true,"sesion":"abierta","trip":"T1"}` (session opened), `{"ok":true,"sesion":"cerrada","trip":"T1"}`
  (session closed), `{"ok":true,"nueva":true}` (card without an owner: the tablet asks whose it is) or
  `{"ok":true,"repetida":true}` (repeat).
- The board may send the same card many times while it is near: the ship ignores repeats of the same UID on that reader
  for 2.5 s. No filtering is needed on the board.

Minimal example with ESP32 + PN532 (Arduino, Adafruit_PN532 library):

```cpp
uint8_t uid[7], largo;
if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &largo, 100)) {
  String hex; for (int i = 0; i < largo; i++) { if (uid[i] < 16) hex += "0"; hex += String(uid[i], HEX); }
  HTTPClient http; http.begin("http://192.168.1.20:8750/v1/nfc");
  http.addHeader("content-type", "application/json");
  http.POST("{\"uid\":\"" + hex + "\",\"lector\":\"station\"}");
  http.end();
}
```

The NOVA Station prototype uses a third path: an RC522 on an Arduino Uno over USB, with a small bridge on a PC that
posts to `/v1/nfc`. See [`hardware/`](../../hardware).

## Option B · the reader types like a keyboard

USB or Bluetooth readers that "type" the UID followed by Enter (keyboard mode, HID) work when connected to the tablet:
the NOVA Station page recognizes a burst of hexadecimal digits followed by Enter and sends it to `/v1/nfc` itself,
with its own reader name.

## What happens on the ship

| Read | Result |
|---|---|
| Known card, nobody on the tablet | that person's session opens |
| Known card, someone else on the tablet | switches to the new person |
| The same card again | the session closes |
| Unknown card | the tablet asks whose it is; it is stored in `~/.nova-pc/tarjetas.json` |
| 2 minutes without touching the tablet | the session closes on its own |

Every opening, closing and action is written to the ship's history (`~/.nova-pc/historia/sesiones-<day>.ndjson`) for
the flight surgeon. Anything written while a session is open (check-in, measurements, replies home, kit withdrawals)
always goes under the name of the card holder: the tablet cannot write on behalf of someone else.

## Testing without a reader

```sh
curl -X POST http://127.0.0.1:8750/v1/nfc -H 'content-type: application/json' -d '{"uid":"04A1B2C3","lector":"station"}'
```

or open `http://<ship>:8750/station.html?demo`, which shows demo card buttons.
