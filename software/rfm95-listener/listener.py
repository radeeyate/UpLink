import csv
import os
import shutil
import struct
import time
from datetime import datetime

import adafruit_rfm9x
import board
import busio
from digitalio import DigitalInOut

TELEMETRY_FORMAT = "<iiIHhiBhhhhIB"
TELEMETRY_SIZE = struct.calcsize(TELEMETRY_FORMAT)  # 34 bytes
SSDV_PACKET_SIZE = 220  # 220 bytes

CSV_FILENAME = "../telemetry-dashboard/.next/standalone/public/data/telemetry.csv"
IMAGE_DEST_DIR = "../telemetry-dashboard/.next/standalone/public/data/images/"
CSV_HEADERS = [
    "timestamp_received",
    "lat",
    "lng",
    "alt",
    "ground_speed",
    "climb_rate",
    "timestamp",
    "satellite_fixes",
    "mcu_temp",
    "foam_pla_temp",
    "pla_temp",
    "out_temp",
    "ram",
    "batt_v",
    "image_name",
]

CS = DigitalInOut(board.CE1)
RESET = DigitalInOut(board.D25)
spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)

try:
    rfm9x = adafruit_rfm9x.RFM9x(spi, CS, RESET, 915.0)
    print("RFM9x: Detected and configured.")
except RuntimeError as error:
    print("RFM9x Error: ", error)
    print("Please ensure the RFM9x module is correctly wired and powered.")
    exit(1)

rfm9x.spreading_factor = 9
rfm9x.frequency_mhz = 915.0
rfm9x.coding_rate = 8
rfm9x.low_datarate_optimize = False
rfm9x.enable_crc = True


def init_csv():
    os.makedirs(os.path.dirname(CSV_FILENAME), exist_ok=True)
    if not os.path.exists(CSV_FILENAME):
        with open(CSV_FILENAME, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)


def decode_telemetry(data):
    if len(data) < TELEMETRY_SIZE:
        return None

    vals = struct.unpack(TELEMETRY_FORMAT, data)

    return {
        "timestamp_received": datetime.now().isoformat(),
        "lat": vals[0] / 1000000.0,
        "lng": vals[1] / 1000000.0,
        "alt": vals[2] / 100.0,
        "ground_speed": vals[3] / 100.0,
        "climb_rate": vals[4] / 100.0,
        "timestamp": vals[5],
        "satellite_fixes": vals[6],
        "mcu_temp": vals[7] / 100.0,
        "foam_pla_temp": vals[8] / 100.0,
        "pla_temp": vals[9] / 100.0,
        "out_temp": vals[10] / 100.0,
        "ram": vals[11],
        "batt_v": vals[12] / 10.0,
    }


def save_to_csv(telemetry):
    with open(CSV_FILENAME, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writerow(telemetry)


def get_newest_image_name(directory="."):
    jpg_files = [
        f
        for f in os.listdir(directory)
        if f.lower().endswith(".jpg") and os.path.isfile(os.path.join(directory, f))
    ]
    if not jpg_files:
        return ""
    newest = max(jpg_files, key=lambda f: os.path.getmtime(os.path.join(directory, f)))
    return newest


print("Starting Physical LoRa Receiver...")
init_csv()
message_counter = 0

while True:
    packet = rfm9x.receive(with_header=True)

    if packet is not None:
        rssi = rfm9x.last_rssi
        snr = rfm9x.snr if rfm9x.snr is not None else ""

        try:
            ssdv_packet = packet[:SSDV_PACKET_SIZE]
            telem_raw = packet[SSDV_PACKET_SIZE : SSDV_PACKET_SIZE + TELEMETRY_SIZE]

            telemetry = decode_telemetry(telem_raw)

            filename = f"01_{message_counter:05}.ssdv"
            with open(filename, "wb") as f:
                f.write(ssdv_packet)

            print(
                f"[+] Saved pristine SSDV packet {message_counter} ({len(ssdv_packet)} bytes) | RSSI: {rssi} dB"
            )
            message_counter += 1

            os.system("../../firmware/balloon/tools/ssdv_decode ./ image")

            if telemetry:
                newest_image = get_newest_image_name(".")
                telemetry["image_name"] = newest_image
                if newest_image:
                    os.makedirs(IMAGE_DEST_DIR, exist_ok=True)
                    try:
                        shutil.copy(
                            newest_image, os.path.join(IMAGE_DEST_DIR, newest_image)
                        )
                    except Exception as e:
                        print(f"    ↳ Failed to copy image: {e}")
                save_to_csv(telemetry)
                print(
                    f"    ↳ Telemetry Processed: Lat={telemetry['lat']:.6f}, Lon={telemetry['lng']:.6f}, Alt={telemetry['alt']:.2f}m"
                )

        except Exception as e:
            print(f"Error processing packet: {e}")

    time.sleep(0.1)
