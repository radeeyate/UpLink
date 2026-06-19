#include <RadioLib.h>
#include <SPI.h>
#include <WiFi.h>
#include <SparkFun_u-blox_GNSS_Arduino_Library.h>
#include <esp_task_wdt.h>

#include "FS.h"
#include "MCP_ADC.h"
#include "SD.h"
#include "esp_camera.h"
#include "ssdv.h"
#define CAMERA_MODEL_XIAO_ESP32S3
#include "camera_pins.h"

bool camera_sign = false;
bool sd_sign = false;

struct __attribute__((packed)) DataPacket {
  int32_t lat;
  int32_t lon;
  uint32_t altitude;     // meters
  uint16_t groundSpeed;  // dm/s
  int16_t climbRate;     // dm/s
  int32_t timestamp;
  uint8_t satelliteFixes;
  int16_t mcuTemp;
  int16_t foamingPLATemp;
  int16_t plaTemp;
  int16_t outsideTemp;
  uint32_t mcuFreeMem;
  uint8_t batteryVoltage;
  uint8_t sysFlags;
};

SFE_UBLOX_GNSS gnss;
MCP3204 adc;

#define GPS_TX_PIN 43  // d6
#define GPS_RX_PIN 44  // d7
#define GPS_BAUD 9600

#define STATE_PAD 0
#define STATE_FLIGHT 1
#define STATE_LANDED 2

#define SD_CARD_FLAG 0
#define CAMERA_FLAG 1
#define GPS_FIX_FLAG 2

uint8_t flightState = STATE_PAD;
uint16_t image_id = 1;

const int SD_CS = 21;       // SD card chip select
const int SX1262_NSS = 4;   // radio chip select
const int SX1262_DIO1 = 5;  // hardware interrupt
const int SX1262_RST = 6;   // reset
const int SX1262_BUSY = 2;  // busy
const int ADC_CS = 1;       // adc chip select

// Shared SPI bus pins
const int SPI_SCK = 7;
const int SPI_MOSI = 9;
const int SPI_MISO = 8;

esp_task_wdt_config_t wdtConfig = {
  .timeout_ms = 20000,
  .idle_core_mask = (1 << 1),
  .trigger_panic = true
};

SX1262 radio = new Module(SX1262_NSS, SX1262_DIO1, SX1262_RST, SX1262_BUSY);

bool sdCardError = false;
bool cameraError = false;

void checkState(int16_t state) {
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[LORA] configuration failed with code %d\n", state);
  }
}

void writeToLog(fs::FS &fs, const String &message) {
  File file = fs.open("/telemetry.csv", FILE_APPEND);
  if (!file) {
    Serial.println("Failed to open telemetry for writing");
    sdCardError = true;
    return;
  }

  if (file.println(message)) {
    Serial.println("Telemetry written");
    sdCardError = false;
  } else {
    Serial.println("Telemetry write failed");
    sdCardError = true;
  }
  file.close();
}

void writeFile(fs::FS &fs, const char *path, uint8_t *data, size_t len) {
  Serial.printf("Writing file: %s\n", path);

  File file = fs.open(path, FILE_WRITE);
  if (!file) {
    Serial.println("Failed to open image for writing");
    sdCardError = true;
    return;
  }

  if (file.write(data, len) == len) {
    Serial.println("File written");
    sdCardError = false;
  } else {
    Serial.println("Write failed");
    sdCardError = true;
  }
  file.close();
}

int16_t getTemperature(uint8_t channel) {
  int rawADC = adc.read(channel);
  float voltage = (rawADC * 2.5) / 4095.0;
  float temperatureC = (voltage - 0.5) / 0.01;

  int16_t normalizedTemperature = round(temperatureC * 100);
  return normalizedTemperature;
}

uint16_t loadSSDVState(fs::FS &fs) {
  File file = fs.open("/.ssdv_state", FILE_READ);
  if (file) {
    uint16_t startingState = (uint16_t)file.parseInt();
    file.close();

    if (startingState == 0) {
      Serial.println("Failed to fetch SSDV state");
      return 1;
    }

    // we want the what the new image id should be
    return startingState + 1;
  } else {
    file = fs.open("/.ssdv_state", FILE_WRITE);
    if (file) {
      file.print("1");
      file.close();

      Serial.println("Created .ssdv_state file and initialized at 1");
      return 1;
    } else {
      Serial.println("Failed to create .ssdv_state file");
    }
    return 1;
  }
}

void saveSSDVState(fs::FS &fs, uint16_t ssdvState) {
  File file = fs.open("/.ssdv_state", FILE_WRITE);
  if (!file) {
    Serial.println("Failed to open .ssdv_state for writing");
    sdCardError = true;
    return;
  }

  if (file.printf("%d\n", ssdvState)) {
    Serial.println("Saved SSDV state on disk");
    sdCardError = false;
  } else {
    Serial.println("Failed to save SSDV state to disk");
    sdCardError = true;
  }
  file.close();
}

bool loadAssistedGPS(fs::FS &fs, const char *path) {
  Serial.printf("Opening A-GPS file: %s\n", path);
  File file = fs.open(path, FILE_READ);
  if (!file) {
    Serial.println("A-GPS data file not found on SD card.");
    return false;
  }

  size_t fileSize = file.size();
  Serial.printf("A-GPS file found. Size: %d bytes. Uploading...\n", fileSize);

  uint8_t buffer[64];
  size_t totalBytesSent = 0;

  while (file.available()) {
    esp_task_wdt_reset();

    int bytesRead = file.read(buffer, sizeof(buffer));
    if (bytesRead > 0) {
      Serial1.write(buffer, bytesRead);
      totalBytesSent += bytesRead;
    }
  }
  file.close();
  Serial.printf("Finished transferring %d bytes to GNSS module.\n", totalBytesSent);

  delay(500);

  Serial.println("Verifying A-GPS ingestion status...");

  bool connected = gnss.checkUblox();

  if (connected) {
    Serial.println("GNSS online post-ingestion. Packet parsing verification OK.");
    return true;
  } else {
    Serial.println("Warning: GNSS failed tracking response check after ingestion.");
    return false;
  }
}

void sendTelemetry() {
  gnss.checkUblox();
  bool isFixOK = gnss.getGnssFixOk();
  uint8_t SIV = gnss.getSIV();
  long rawLatitude = gnss.getLatitude();
  long rawLongitude = gnss.getLongitude();
  long rawAltitude = gnss.getAltitude();
  long rawSpeed = gnss.getGroundSpeed();
  long velocityDown = gnss.getNedDownVel();
  long timestamp = gnss.getUnixEpoch();
  float mcuTemp = temperatureRead();

  float actualBatteryVoltage = ((adc.read(2) * 2.5) / 4095.0) * 2.5;
  uint8_t batteryVoltage = constrain(round(actualBatteryVoltage * 50), 0, 255);

  int16_t formattedFoamingPLATemp = getTemperature(0);
  int16_t formattedOutsideTemp = getTemperature(1);
  int16_t formattedPLATemp = getTemperature(3);

  uint32_t espFreeHeap = ESP.getFreeHeap();
  float mcuTemperature = temperatureRead();

  if (!(SIV >= 4 && isFixOK)) {
    Serial.printf("Waiting for fix... Satellites in view: %d\n", SIV);
  }

  DataPacket telem;
  double altitudeMeters = rawAltitude / 1000.0;
  uint16_t speed = rawSpeed / 100;
  int16_t climbRate = (int16_t)((velocityDown * -1) / 100);

  // the gps module will sometimes get valid coordinates
  // even when it doesn't have a fix. we want to always
  // report this in case it can't get a fix but we need
  // to find it
  telem.lat = rawLatitude;
  telem.lon = rawLongitude;
  telem.altitude = (uint32_t)round(altitudeMeters * 100);
  telem.groundSpeed = (uint16_t)speed;
  telem.climbRate = climbRate;
  telem.timestamp = timestamp;
  telem.satelliteFixes = SIV;

  telem.mcuTemp = (int16_t)round(mcuTemperature * 100);
  telem.foamingPLATemp = formattedFoamingPLATemp;
  telem.outsideTemp = formattedOutsideTemp;
  telem.plaTemp = formattedPLATemp;

  telem.mcuFreeMem = espFreeHeap;
  telem.batteryVoltage = batteryVoltage;

  telem.sysFlags = 0;
  if (!sdCardError) telem.sysFlags |= (1 << SD_CARD_FLAG);
  if (!cameraError) telem.sysFlags |= (1 << CAMERA_FLAG);
  if (gnss.getGnssFixOk()) telem.sysFlags |= (1 << GPS_FIX_FLAG);

  char csvData[256];
  int n = snprintf(csvData, sizeof(csvData), "%.7f,%.7f,%.2f,%.2f,%.2f,%u,%u,%.1f,%.2f,%.2f,%.2f,%u,%.2f,%d,%d,%d",
                   rawLatitude / 10000000.0,
                   rawLongitude / 10000000.0,
                   rawAltitude / 1000.0,
                   rawSpeed / 1000.0,
                   (velocityDown * -1) / 1000.0,
                   timestamp,
                   SIV,
                   mcuTemperature,
                   formattedFoamingPLATemp / 100.0,
                   formattedPLATemp / 100.0,
                   formattedOutsideTemp / 100.0,
                   espFreeHeap,
                   (float)batteryVoltage / 50.0,
                   !sdCardError ? 1 : 0,
                   !cameraError ? 1 : 0,
                   gnss.getGnssFixOk() ? 1 : 0);

  if (n < 0 || n >= (int)sizeof(csvData)) {
    Serial.print("CSV Truncated. Size: ");
    Serial.println(n);
  }
  Serial.println(csvData);
  writeToLog(SD, csvData);

  uint8_t telem_packet[36];
  memcpy(telem_packet, &telem, sizeof(telem));
  int state = radio.transmit((uint8_t *)telem_packet, sizeof(telem));
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println(F("Telemetry transmission success!"));
  } else {
    Serial.printf("Transmission failed, code %d\n", state);
  }

  radio.sleep();
}

void setup() {
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(SX1262_NSS, OUTPUT);
  digitalWrite(SX1262_NSS, HIGH);
  pinMode(ADC_CS, OUTPUT);
  digitalWrite(ADC_CS, HIGH);

  Serial.begin(115200);
  while (!Serial) {
    if (millis() > 5000) {
      break;
    }
  };

  // initialize watchdog timer
  esp_task_wdt_init(&wdtConfig);
  esp_task_wdt_add(NULL);

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);

  Serial.println(F("Mounting SD Card..."));
  if (!SD.begin(SD_CS)) {
    Serial.println("Card Mount Failed");
    sdCardError = true;
  } else {
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
      Serial.println("No SD card attached");
      sdCardError = true;
    } else {
      sd_sign = true;
      sdCardError = false;

      // initialize telemetry file
      writeToLog(SD, "lat,lng,alt,ground_speed,climb_rate,timestamp,siv,mcu_temp,foam_pla_temp,pla_temp,out_temp,ram,batt_v,sd_ok,camera_ok,gps_fix_ok");

      Serial.println("SD Card mounted successfully!");
    }
  }

  uint16_t ssdvState = loadSSDVState(SD);
  image_id = ssdvState;
  Serial.printf("Loaded initial SSDV image ID as: %d\n", ssdvState);

  Serial1.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  if (gnss.begin(Serial1) == false) {
    Serial.println(F("SAM M10Q not detected on Serial1"));
  }

  if (sd_sign) {
    loadAssistedGPS(SD, "/offline.ubx");
  } else {
    Serial.println("Skipped loading A-GPS data; SD card isn't inserted")
  }

  gnss.setUART1Output(COM_TYPE_UBX);
  if (gnss.setDynamicModel(DYN_MODEL_AIRBORNE1g) == false) {
    Serial.println(F("Failed to set dynamic model to flight mode"));
  } else {
    Serial.println(F("Successfully enabled flight mode"));
  }

  gnss.setNavigationFrequency(5);
  gnss.saveConfigSelective(VAL_CFG_SUBSEC_IOPORT | VAL_CFG_SUBSEC_NAVCONF);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  WiFi.setAutoReconnect(false);
  btStop();

  Serial.println(F("[LORA] Initialising ... "));
  checkState(radio.begin(915.0, 125.0, 9, 5, 0x12, 22, 8, 1.6, true));
  radio.setFrequency(915.0, false);
  radio.setCurrentLimit(140);
  radio.setOutputPower(22);
  radio.setCRC(true);
  Serial.println(F("[LORA] Initialised successfully!"));

  adc.begin(ADC_CS);
  adc.setSPIspeed(100000);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 15000000;
  config.frame_size = FRAMESIZE_QSXGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 10;
  config.fb_count = 1;

  if (config.pixel_format == PIXFORMAT_JPEG) {
    if (psramFound()) {
      config.frame_size = FRAMESIZE_QSXGA;
      config.grab_mode = CAMERA_GRAB_LATEST;
      config.fb_count = 1;
    } else {
      config.frame_size = FRAMESIZE_QSXGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  } else {
    config.frame_size = FRAMESIZE_240X240;
#if CONFIG_IDF_TARGET_ESP32S3
    config.fb_count = 1;
#endif
  }

  // even if camera init fails we MUST get into loop() as
  // telemetry tranmission is critical
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    cameraError = true;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_hmirror(s, 1);

    if (s->id.PID == OV5640_PID) {
      Serial.println("OV5640 detected, setting focus to infinity...");
      if (s->af_init) s->af_init(s, 2000);
      if (s->af_set_mode) s->af_set_mode(s, 1);
      if (s->af_set_manual_position)
        s->af_set_manual_position(s, 0);
    }
  }

  camera_sign = true;
  cameraError = false;
  Serial.println("Setup complete!");

  esp_task_wdt_reset();
}

void loop() {
  esp_task_wdt_reset();
  sendTelemetry();

  char filename[1024];
  snprintf(filename, sizeof(filename), "/image_%05u.jpg", image_id);

  sensor_t *s = esp_camera_sensor_get();

  if (s) {
    s->set_framesize(s, FRAMESIZE_QSXGA);
    s->set_quality(s, 10);
  }

  delay(250);

  // full-res capture (QSXGA)
  camera_fb_t *fb_full = nullptr;
  for (int i = 0; i < 4; i++) {
    fb_full = esp_camera_fb_get();
    if (fb_full) {
      if (fb_full->width > 2000) {
        break;  // valid QSXGA frame
      } else {
        Serial.println("STALE IMAGE (full-res)");
      }
      esp_camera_fb_return(fb_full);
      fb_full = nullptr;
    }
    delay(30);
  }

  if (!fb_full) {
    Serial.println("Full-res capture failed, retrying once more...");
    delay(200);
    fb_full = esp_camera_fb_get();
  }

  if (fb_full) {
    if (fb_full->width > 2000) {
      cameraError = false;
      if (sd_sign) {
        writeFile(SD, filename, fb_full->buf, fb_full->len);
      }
    } else {
      // even the retry gave a stale frame
      Serial.printf("Dropped stale full-res frame: %dx%d\n", fb_full->width, fb_full->height);
      cameraError = true;  // can’t get a usable full-res image
    }
    esp_camera_fb_return(fb_full);
    fb_full = nullptr;
  } else {
    Serial.println("CRITICAL: No full-res frame buffer");
    cameraError = true;
  }

  // QVGA capture for SSDV
  if (s) {
    s->set_framesize(s, FRAMESIZE_QVGA);
    s->set_quality(s, 30);
  }

  camera_fb_t *fb_ssdv = nullptr;
  for (int i = 0; i < 5; i++) {
    fb_ssdv = esp_camera_fb_get();
    if (!fb_ssdv) {
      delay(100);
      continue;
    }

    if (fb_ssdv->width == 320 && fb_ssdv->len < 50000) {
      Serial.printf("Confirmed QVGA: %dx%d, %u bytes\n", fb_ssdv->width, fb_ssdv->height, fb_ssdv->len);
      break;
    }

    Serial.printf("Discarding stale/large QVGA frame: %dx%d, %u bytes\n", fb_ssdv->width, fb_ssdv->height, fb_ssdv->len);
    esp_camera_fb_return(fb_ssdv);
    fb_ssdv = nullptr;
    delay(100);
  }

  if (!fb_ssdv) {
    Serial.println("Failed to get a valid QVGA frame buffer");
    cameraError = true;
  } else {
    ssdv_t ssdv;
    uint8_t packet[256];

    if (ssdv_enc_init(&ssdv, SSDV_TYPE_NOFEC, image_id, 3, SSDV_PKT_SIZE) != SSDV_OK) {
      Serial.println("SSDV Init Failed");
      esp_camera_fb_return(fb_ssdv);
    } else {
      ssdv_enc_set_buffer(&ssdv, packet);
      ssdv_enc_feed(&ssdv, fb_ssdv->buf, fb_ssdv->len);

      if (fb_ssdv->buf[0] != 0xFF || fb_ssdv->buf[1] != 0xD8) {
        Serial.println("Warning: QVGA frame does not start with JPEG SOI");
      }

      while (ssdv_enc_get_packet(&ssdv) == SSDV_HAVE_PACKET) {
        esp_task_wdt_reset();
        sendTelemetry();
        delay(15);

        int state = radio.transmit((uint8_t *)packet, SSDV_PKT_SIZE);
        if (state == RADIOLIB_ERR_NONE) {
          Serial.printf("SSDV transmission success!");
        } else {
          Serial.printf("Transmission failed, code %d\n", state);
        }

        radio.sleep();
      }

      image_id++;
      saveSSDVState(SD, image_id);
    }
    esp_camera_fb_return(fb_ssdv);
  }
}