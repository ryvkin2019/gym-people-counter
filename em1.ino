#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

// ===== WiFi + URL =====
const char* WIFI_SSID = "Evgeny";
const char* WIFI_PASS = "orlandop";
const char* GOOGLE_SCRIPT_URL ="https://script.google.com/macros/s/AKfycby-d3j_5msz9NjzXXQIcm6m3DhbDXhKqJc_d6clNSZ2MBFVBWjpOdr9rO2eun72lo33bA/exec";
// ===== Pins =====
const int PIN_A = 27;
const int PIN_B = 26;

// ===== Counter =====
int people = 0;
const unsigned long TIMEOUT_MS = 2000;
const unsigned long STABLE_MS  = 40;

// ===== Event queue =====
struct Event {
  String ts;
  String dir;
  int people;
};

const int QMAX = 50;
Event q[QMAX];
volatile int qHead = 0, qTail = 0, qCount = 0; // volatile because used from task + loop

// ===== Prototypes (важно!) =====
String nowTimestamp();
void enqueueEvent(const char* direction);
bool dequeueEvent(Event &out);
bool sendOneEvent(const Event &ev);
void senderTask(void *param);
void connectWiFi();

// ===== Time =====
String nowTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return "1970-01-01 00:00:00";
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buf);
}

// ===== Queue ops =====
void enqueueEvent(const char* direction) {
  // если переполнилось — выкинем самое старое
  if (qCount >= QMAX) {
    qHead = (qHead + 1) % QMAX;
    qCount--;
  }

  q[qTail].ts = nowTimestamp();
  q[qTail].dir = String(direction);
  q[qTail].people = people;

  qTail = (qTail + 1) % QMAX;
  qCount++;
}

bool dequeueEvent(Event &out) {
  if (qCount <= 0) return false;
  out = q[qHead];
  qHead = (qHead + 1) % QMAX;
  qCount--;
  return true;
}

// ===== Sensors logic =====
enum State { IDLE, WAIT_B, WAIT_A, WAIT_CLEAR };
State state = IDLE;

unsigned long t0 = 0;
unsigned long aLowSince = 0;
unsigned long bLowSince = 0;

bool stableTriggered(int pin, unsigned long &lowSince) {
  bool low = (digitalRead(pin) == LOW);
  unsigned long now = millis();

  if (low) {
    if (lowSince == 0) lowSince = now;
    if (now - lowSince >= STABLE_MS) return true;
  } else {
    lowSince = 0;
  }
  return false;
}

// ===== WiFi =====
void connectWiFi() {
  Serial.println("WiFi begin...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FAILED (counting works, sending later)");
  }
}

// ===== Send one event =====
bool sendOneEvent(const Event &ev) {
  if (WiFi.status() != WL_CONNECTED) return false;

  // URL encode пробелы в timestamp (заменим на %20)
  String ts = ev.ts;
  ts.replace(" ", "%20");
  ts.replace(":", "%3A");

  String url = String(GOOGLE_SCRIPT_URL);
  url += "?timestamp=" + ts;
  url += "&direction=" + ev.dir;
  url += "&people=" + String(ev.people);

  HTTPClient http;
  http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.begin(url);

  http.addHeader("User-Agent", "ESP32");
  int code = http.GET();
  String body = http.getString();
  http.end();

  if (code == 200) return true;

  Serial.print("❌ Send failed code=");
  Serial.print(code);
  Serial.print(" body=");
  Serial.println(body);
  return false;
}

// ===== Sender task (runs separately) =====
void senderTask(void *param) {
  while (true) {
    if (WiFi.status() == WL_CONNECTED && qCount > 0) {
      Event ev;
      if (dequeueEvent(ev)) {
        bool ok = sendOneEvent(ev);
        if (ok) {
          Serial.println("✅ Sent 1 event");
          delay(1200);
        } else {
          // вернуть обратно в очередь
          if (qCount < QMAX) {
            q[qTail] = ev;
            qTail = (qTail + 1) % QMAX;
            qCount++;
          }
          delay(8000);
        }
      }
    }
    delay(200);
  }
}

// ===== Setup/Loop =====
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("Booting...");

  pinMode(PIN_A, INPUT_PULLUP);
  pinMode(PIN_B, INPUT_PULLUP);

  connectWiFi();

  configTime(2 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Ready: A->B=IN, B->A=OUT (sender task)");

  // отправщик на другом ядре
  xTaskCreatePinnedToCore(senderTask, "sender", 8192, NULL, 1, NULL, 0);
}

void loop() {
  static unsigned long lastPrint = 0;
  unsigned long now = millis();

  if (now - lastPrint >= 300) {
    Serial.print("A=");
    Serial.print(digitalRead(PIN_A));
    Serial.print("  B=");
    Serial.println(digitalRead(PIN_B));
    lastPrint = now;
  }

  bool A = stableTriggered(PIN_A, aLowSince);
  bool B = stableTriggered(PIN_B, bLowSince);

  switch (state) {
    case IDLE:
      if (A && !B) { state = WAIT_B; t0 = now; }
      else if (B && !A) { state = WAIT_A; t0 = now; }
      break;

    case WAIT_B:
      if (now - t0 > TIMEOUT_MS) state = IDLE;
      else if (B) {
        people++;
        Serial.print("✅ IN   Total=");
        Serial.println(people);
        enqueueEvent("IN");
        state = WAIT_CLEAR;
      }
      break;

    case WAIT_A:
      if (now - t0 > TIMEOUT_MS) state = IDLE;
      else if (A) {
        if (people > 0) people--;
        Serial.print("✅ OUT  Total=");
        Serial.println(people);
        enqueueEvent("OUT");
        state = WAIT_CLEAR;
      }
      break;

    case WAIT_CLEAR:
      if (digitalRead(PIN_A) == HIGH && digitalRead(PIN_B) == HIGH) {
        aLowSince = 0;
        bLowSince = 0;
        state = IDLE;
      }
      break;
  }

  sendYield(); // маленькая уступка системе (опционально)
  delay(2);
}

void sendYield() { delay(0); }