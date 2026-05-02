import time
import busio
from digitalio import DigitalInOut, Direction
import board
import adafruit_rfm9x
import base64
import requests
import datapacker
import csv
import os
from datetime import datetime

# --- Configuration ---
CS = DigitalInOut(board.CE1)
RESET = DigitalInOut(board.D25)
spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)
CSV_FILENAME = "transmissions.csv"

# Initialize the CSV with headers if it doesn't already exist
if not os.path.exists(CSV_FILENAME):
    with open(CSV_FILENAME, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(["timestamp", "packet_type", "payload", "rssi", "snr"])

def log_to_csv(packet_type, payload, rssi, snr):
    """Writes the transmission object to the CSV file."""
    with open(CSV_FILENAME, mode='a', newline='') as file:
        writer = csv.writer(file)
        timestamp = datetime.now().isoformat()
        writer.writerow([timestamp, packet_type, payload, rssi, snr])

try:
    rfm9x = adafruit_rfm9x.RFM9x(spi, CS, RESET, 910.0)
    print("RFM9x: Detected and configured.")
except RuntimeError as error:
    print("RFM9x Error: ", error)
    print("Please ensure the RFM9x module is correctly wired and powered.")
    exit(1)

rfm9x.tx_power = 23
rfm9x.spreading_factor = 7
rfm9x.frequency_mhz = 910.0
rfm9x.coding_rate = 6
rfm9x.low_datarate_optimize = True
rfm9x.enable_crc = True

CONVERSION_FACTOR_RED_UW_CM2 = 15.5 / 5435  # 0.002851886


print("Starting LoRa reception loop...")
print("Waiting for messages...")

while True:
    packet = rfm9x.receive()

    if packet is not None:
        rssi = rfm9x.last_rssi
        snr = rfm9x.snr if rfm9x.snr is not None else ""
        
        try:
            packet_text = str(packet, "utf-8")
            
            
            print("Received telemetry!")
            unpackedData = datapacker.unpack(decodedText)
            data = unpackedData[7] * CONVERSION_FACTOR_RED_UW_CM2
            log_to_csv("telemBundle", packet_text, rssi, snr)
            

            print(f"  RSSI: {rssi} dB")
            if snr:
                print(f"  SNR: {snr} dB")

        except UnicodeDecodeError:
            print(f"Received non-UTF-8 packet.")
            # Safely encode raw bytes to Base64 so they don't break the CSV
            raw_b64 = base64.b64encode(packet).decode('utf-8')
            log_to_csv("unknown", raw_b64, rssi, snr)
            
            print(f"  RSSI: {rssi} dB")
            if snr:
                print(f"  SNR: {snr} dB")
    
    time.sleep(0.1)