import csv
import os
import glob
import subprocess
import shutil
import struct
import time
from datetime import datetime

import adafruit_rfm9x
import board
import busio
from digitalio import DigitalInOut

TELEMETRY_FORMAT = "<iiIHhiBhhhhIBB"
TELEMETRY_SIZE = struct.calcsize(TELEMETRY_FORMAT)  # 35 bytes
SSDV_PACKET_SIZE = 128  # 128 bytes

CSV_FILENAME = "../telemetry-dashboard/standalone/public/data/telemetry.csv"
IMAGE_DEST_DIR = "../telemetry-dashboard/standalone/public/data/images/"
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
    "sd_card_ok",
    "camera_ok",
    "gps_fix_ok",
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
rfm9x.coding_rate = 5
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
        "lat": vals[0] / 10000000.0,
        "lng": vals[1] / 10000000.0,
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
        "batt_v": vals[12] / 50.0,
        "sd_card_ok": bool(vals[13] & (1 << 0)),
        "camera_ok": bool(vals[13] & (1 << 1)),
        "gps_fix_ok": bool(vals[13] & (1 << 2)),
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


def is_ssdv_packet(data):
    """Check if data starts with the SSDV sync word (0x55 0x66 or 0x55 0x67)."""
    return len(data) >= 2 and data[0] == 0x55 and data[1] in (0x66, 0x67)


def get_next_message_counter():
    """Scans the current directory for 01_XXXXX.ssdv files and returns the next index."""
    existing_files = glob.glob("01_*.ssdv")
    if not existing_files:
        return 0

    indices = []
    for f in existing_files:
        try:
            parts = f.split('_')
            if len(parts) > 1:
                idx = int(parts[1].split('.')[0])
                indices.append(idx)
        except ValueError:
            continue

    return max(indices) + 1 if indices else 0


print("Starting Physical LoRa Receiver...")
init_csv()

# Smart resume: Find the latest counter so we don't overwrite older data
message_counter = get_next_message_counter()
print(f"Next SSDV packet index will be: {message_counter}")

# Background worker tracker
decode_process = None

while True:
    packet = rfm9x.receive(with_header=True)

    if packet is not None:
        rssi = rfm9x.last_rssi
        snr = rfm9x.snr if rfm9x.snr is not None else ""

        try:
            # Telemetry-only packet (no SSDV sync word)
            if not is_ssdv_packet(packet):
                telem_raw = packet[:TELEMETRY_SIZE]
                telemetry = decode_telemetry(telem_raw)
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
                        f"[+] Telemetry: Lat={telemetry['lat']:.6f}, Lon={telemetry['lng']:.6f}, Alt={telemetry['alt']:.2f}m"
                    )
                continue

            # SSDV packet
            ssdv_packet = packet[:SSDV_PACKET_SIZE]

            filename = f"01_{message_counter:05}.ssdv"
            with open(filename, "wb") as f:
                f.write(ssdv_packet)

            print(
                f"[+] Saved SSDV packet {message_counter} ({len(ssdv_packet)} bytes) | RSSI: {rssi} dB"
            )
            message_counter += 1

            if decode_process is None or decode_process.poll() is not None:
                decode_process = subprocess.Popen("../../firmware/balloon/tools/ssdv_decode ./ image", shell=True)
            else:
                pass

        except Exception as e:
            print(f"Error processing packet: {e}")

    time.sleep(0.01)