#include "esp_camera.h"
#include "FS.h"
#include "SD.h"
#include "SPI.h"
#include "ssdv.h"
#include <cmath>

#define CAMERA_MODEL_XIAO_ESP32S3

#include "camera_pins.h"

bool camera_sign = false;
bool sd_sign = false;

// 28 bytes
struct __attribute__((packed)) DataPacket {
  int32_t lat;
  int32_t lon;
  uint32_t altitude; // meters
  int32_t timestamp;
  uint8_t satelliteFixes;
  int16_t mcuTemp;
  int16_t insideTemp;
  int16_t outsideTemp;
  uint32_t mcuFreeMem;
  uint8_t batteryVoltage;
};

void photo_save(const char * fileName) {
    sensor_t * s = esp_camera_sensor_get();
    
    // capture full resolution (qsxvga)
    if (s) s->set_framesize(s, FRAMESIZE_QSXGA);
    
    camera_fb_t *fb_full = esp_camera_fb_get();
    if (!fb_full) {
      Serial.println("Failed to get full-res frame buffer");
      return;
    }

    writeFile(SD, fileName, fb_full->buf, fb_full->len);
    esp_camera_fb_return(fb_full);

    // capture qvga for ssdv
    Serial.println("Switching to QVGA...");
    if (s) s->set_framesize(s, FRAMESIZE_QVGA);
    
    camera_fb_t *fb_ssdv = NULL;
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
        
        Serial.printf("Discarding stale/large frame: %dx%d, %u bytes\n", fb_ssdv->width, fb_ssdv->height, fb_ssdv->len);
        esp_camera_fb_return(fb_ssdv);
        fb_ssdv = NULL;
        delay(100);
    }

    if (!fb_ssdv) {
      Serial.println("Failed to get a valid QVGA frame buffer");
      return;
    }

    ssdv_t ssdv;
    uint8_t packet[256];
    uint8_t image_id = 1;

    if (ssdv_enc_init(&ssdv, SSDV_TYPE_NOFEC, image_id, 3, 220) != SSDV_OK) {
        Serial.println("SSDV Init Failed");
        esp_camera_fb_return(fb_ssdv);
        return;
    }
    ssdv_enc_set_buffer(&ssdv, packet);
    ssdv_enc_feed(&ssdv, fb_ssdv->buf, fb_ssdv->len);

    if (fb_ssdv->buf[0] != 0xFF || fb_ssdv->buf[1] != 0xD8) {
        Serial.println("Warning: FB does not start with JPEG SOI");
    }

    while (ssdv_enc_get_packet(&ssdv) == SSDV_HAVE_PACKET) {
      char packetName[20];
      ssdv_packet_info_t info;
      ssdv_dec_header(&info, packet);
      snprintf(packetName, sizeof(packetName), "/%02X_%05u.ssdv", info.image_id, info.packet_id);

      DataPacket telem = {
        (int32_t)round(***REMOVED****1000000), // lat
        (int32_t)round(***REMOVED****1000000), // lon
        (uint32_t)round(10000), // altitude
        1234, // timestamp
        20, // satellite fixes
        12, // mcu temp; TODO: fetch
        (int16_t)round(-20.54*100), // inside temp
        (int16_t)round(-40.54*100), // outside temp
        (uint32_t)ESP.getFreePsram(), // free memory
        (uint8_t)round(4.5*10) // battery voltage
      };

      memcpy(packet + 220, &telem, sizeof(telem));

      writeFile(SD, packetName, packet, 220 + sizeof(telem));
      Serial.printf("Saving: %s\n", packetName);

      ssdv_enc_set_buffer(&ssdv, packet);
    }

    esp_camera_fb_return(fb_ssdv);
    Serial.println("Photo and SSDV packets saved");
}

void writeFile(fs::FS &fs, const char * path, uint8_t * data, size_t len) {
  Serial.printf("Writing file: %s\n", path);

    File file = fs.open(path, FILE_WRITE);
    if (!file) {
      Serial.println("Failed to open file for writing");
      return;
    }

    if (file.write(data, len) == len) {
      Serial.println("File written");
    } else {
      Serial.println("Write failed");
    }
    file.close();
}

void setup() {
  Serial.begin(115200);
  while(!Serial);

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
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_QSXGA;
  config.pixel_format = PIXFORMAT_JPEG; // for streaming
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 5;
  config.fb_count = 1;

  if (config.pixel_format == PIXFORMAT_JPEG) {
    if (psramFound()) {
      config.jpeg_quality = 10;
      config.fb_count = 2;
      config.grab_mode = CAMERA_GRAB_LATEST;  
    } else {
      config.frame_size = FRAMESIZE_QSXGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  } else {
    config.frame_size = FRAMESIZE_240X240;
    #if CONFIG_IDF_TARGET_ESP32S3
    config.fb_count = 2;
    #endif
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  if (s) {
    s->set_hmirror(s, 1);
    
    // Set OV5640 to Infinity Focus
    if (s->id.PID == OV5640_PID) {
      Serial.println("OV5640 detected, setting focus to infinity...");
      s->set_reg(s, 0x3008, 0xff, 0x01); // Wake up AF MCU
      if (s->af_init) s->af_init(s, 2000);
      if (s->af_set_mode) s->af_set_mode(s, 1); // 1 = Manual
      if (s->af_set_manual_position) s->af_set_manual_position(s, 0); // 0 = Infinity
    }
  }

  camera_sign = true;

  if (!SD.begin(21)) {
    Serial.println("Card Mount Failed");
    return;  
  }

  uint8_t cardType = SD.cardType();

  if (cardType == CARD_NONE) {
    Serial.println("No SD card");
    return;
  }

  Serial.print("SD Card Type: ");
  if(cardType == CARD_MMC){
    Serial.println("MMC");
  } else if(cardType == CARD_SD){
    Serial.println("SDSC");
  } else if(cardType == CARD_SDHC){
    Serial.println("SDHC");
  } else {
    Serial.println("UNKNOWN");
  }

  sd_sign = true;

  Serial.println("wahoo photos");

}

bool done = false;

void loop() {
  if (!done) {
    char filename[] = "/image.jpg";
    photo_save(filename);
    done = true;
  }
}
