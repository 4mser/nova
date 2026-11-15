// Estación NOVA · Arduino Uno: lector RFID RC522 + electrocardiograma AD8232.
// Lo lee lector_nova.py en el PC (por USB) y lo manda a la nave.
//
// Cambios respecto de la versión anterior:
//  · 115200 baudios: a 9600 no caben más de ~190 muestras por segundo.
//  · El ECG se mide a 250 Hz parejos (cada 4 ms con micros()), no «cuando alcanza».
//  · El lector RFID se revisa cada 100 ms, para no frenar el ECG.
//  · Cada muestra sale como «E:512»; si un electrodo se suelta (pines LO+ y LO- del AD8232), sale «E:!».
//
// Conexiones del AD8232: OUTPUT → A0, LO+ → D2, LO- → D3, 3.3V y GND.
// (Si no conectas LO+ y LO-, deja USAR_LO en 0: el PC igual detecta el electrodo suelto por la señal.)
// RC522: SDA(SS) → D10, SCK → D13, MOSI → D11, MISO → D12, RST → D9, 3.3V y GND (como ya lo tienes).

#include <SPI.h>
#include <MFRC522.h>

#define RST_PIN 9
#define SS_PIN 10
#define ECG_PIN A0
#define LO_MAS 2
#define LO_MENOS 3
#define USAR_LO 1

MFRC522 mfrc522(SS_PIN, RST_PIN);

const unsigned long PERIODO_ECG_US = 4000;  // 250 Hz
const unsigned long PERIODO_RFID_MS = 100;
unsigned long proximaMuestra = 0;
unsigned long ultimaRevisionRfid = 0;

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();
#if USAR_LO
  pinMode(LO_MAS, INPUT);
  pinMode(LO_MENOS, INPUT);
#endif
  proximaMuestra = micros();
}

void leerTarjeta() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) return;
  Serial.print("Card UID:");
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    Serial.print(mfrc522.uid.uidByte[i] < 0x10 ? " 0" : " ");
    Serial.print(mfrc522.uid.uidByte[i], HEX);
  }
  Serial.println();
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}

void loop() {
  // ECG a ritmo fijo
  if ((long)(micros() - proximaMuestra) >= 0) {
    proximaMuestra += PERIODO_ECG_US;
#if USAR_LO
    if (digitalRead(LO_MAS) == HIGH || digitalRead(LO_MENOS) == HIGH) {
      Serial.println("E:!");
    } else
#endif
    {
      Serial.print("E:");
      Serial.println(analogRead(ECG_PIN));
    }
  }

  // RFID cada 100 ms
  if (millis() - ultimaRevisionRfid >= PERIODO_RFID_MS) {
    ultimaRevisionRfid = millis();
    leerTarjeta();
  }
}
