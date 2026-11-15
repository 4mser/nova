# Lector NFC de NOVA Station · contrato v1

La tablet de NOVA Station es común a toda la tripulación. Cada astronauta tiene una tarjeta (o tag) NFC; al acercarla
al lector, la nave abre su espacio personal en la tablet. El lector es un módulo externo (PN532, RC522, ACR122U u otro)
y solo necesita contarle a la nave **qué UID leyó y en qué lector**.

## Opción A · el lector habla con la nave por la red (recomendada)

Una placa con red (ESP32, Raspberry Pi Pico W, etc.) manda un POST por cada lectura:

```
POST http://<nave>:8750/v1/nfc
content-type: application/json
x-nova-token: <solo si la nave define NOVA_TOKEN>

{"uid": "04:A1:B2:C3", "lector": "station"}
```

- `uid`: el UID de la tarjeta en hexadecimal. Da igual el formato (`04:a1:b2:c3`, `04 A1 B2 C3`, `04a1b2c3`): la nave
  lo normaliza a `04A1B2C3`.
- `lector`: el nombre del lector (letras, números y guiones). Es el mismo nombre que se pone en los ajustes de la tablet
  que está al lado. Por defecto `station`.
- Respuestas: `{"ok":true,"sesion":"abierta","trip":"T1"}`, `{"ok":true,"sesion":"cerrada","trip":"T1"}`,
  `{"ok":true,"nueva":true}` (tarjeta sin dueño: la tablet pregunta de quién es) o `{"ok":true,"repetida":true}`.
- La placa puede mandar la misma tarjeta muchas veces mientras está cerca: la nave ignora repeticiones del mismo UID en
  ese lector durante 2,5 s. No hace falta filtrar en la placa.

Ejemplo mínimo con ESP32 + PN532 (Arduino, librería Adafruit_PN532):

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

## Opción B · el lector escribe como un teclado

Los lectores USB o Bluetooth que «escriben» el UID y un Enter (modo teclado, HID) funcionan conectados a la tablet: la
página de NOVA Station reconoce una ráfaga de dígitos hexadecimales seguida de Enter y la manda ella misma a
`/v1/nfc` con el nombre de su lector.

## Qué pasa en la nave

| Lectura | Resultado |
|---|---|
| Tarjeta conocida, nadie en la tablet | se abre la sesión de esa persona |
| Tarjeta conocida, otra persona en la tablet | cambia a la nueva persona |
| La misma tarjeta otra vez | se cierra la sesión |
| Tarjeta desconocida | la tablet pregunta de quién es; queda guardada en `~/.nova-pc/tarjetas.json` |
| 2 minutos sin tocar la tablet | la sesión se cierra sola |

Cada apertura, cierre y acción queda en la historia de la nave (`~/.nova-pc/historia/sesiones-<día>.ndjson`) para el
cirujano de vuelo. Lo que se escribe con la sesión abierta (check-in, mediciones, respuestas a casa, retiros del kit)
va siempre a nombre de quien tiene la tarjeta: la tablet no puede escribir a nombre de otro.

## Probar sin lector

```sh
curl -X POST http://127.0.0.1:8750/v1/nfc -H 'content-type: application/json' -d '{"uid":"04A1B2C3","lector":"station"}'
```

o abre `http://<nave>:8750/station.html?demo`, que muestra botones de tarjetas de demostración.
