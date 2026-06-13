import zmq
import pmt
import os
import struct
import csv
from datetime import datetime

TELEMETRY_FORMAT = "<iiIHhiBhhhhIBB"
TELEMETRY_SIZE = struct.calcsize(TELEMETRY_FORMAT)
SSDV_PACKET_SIZE = 220

CSV_FILENAME = "../telemetry-dashboard/public/data/telemetry.csv"
CSV_HEADERS = [
    "timestamp_received", "lat", "lng", "alt", "ground_speed", 
    "climb_rate", "timestamp", "satellite_fixes", "mcu_temp", 
    "foam_pla_temp", "pla_temp", "out_temp", "ram", "batt_v",
    "sd_card_ok", "camera_ok", "gps_fix_ok", "image_name"
]

def init_csv():
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
        "ground_speed": vals[3]/100,
        "climb_rate": vals[4]/100,
        "timestamp": vals[5],
        "satellite_fixes": vals[6],
        "mcu_temp": vals[7] / 100.0,
        "foam_pla_temp": vals[8] / 100.0,
        "pla_temp": vals[9] / 100.0,
        "out_temp": vals[10] / 100.0,
        "ram": vals[11],
        "batt_v": vals[12] / 10.0,
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
        f for f in os.listdir(directory)
        if f.lower().endswith(".jpg") and os.path.isfile(os.path.join(directory, f))
    ]
    if not jpg_files:
        return ""
    newest = max(jpg_files, key=lambda f: os.path.getmtime(os.path.join(directory, f)))
    return newest

def is_ssdv_packet(data):
    """Check if data starts with the SSDV sync word (0x55 0x66 or 0x55 0x67)."""
    return len(data) >= 2 and data[0] == 0x55 and data[1] in (0x66, 0x67)

context = zmq.Context()
socket = context.socket(zmq.SUB)
socket.connect("tcp://127.0.0.1:5555")
socket.setsockopt(zmq.SUBSCRIBE, b"")

print("Listening for LoRa frames from GNU Radio...")
message_counter = 0
init_csv()

while True:
    message_bytes = socket.recv()
    
    try:
        p = pmt.deserialize_str(message_bytes)
        raw_payload = None

        if pmt.is_pair(p):
            data_vector = pmt.cdr(p)
            if pmt.is_u8vector(data_vector):
                raw_payload = bytes(pmt.u8vector_elements(data_vector))
        
        elif pmt.is_u8vector(p):
            all_bytes = bytes(pmt.u8vector_elements(p))
            
            sync_index = -1
            for i in range(len(all_bytes) - 5):
                if all_bytes[i] == 0x55 and all_bytes[i+1] in (0x66, 0x67):
                    sync_index = i
                    break
            
            if sync_index != -1:
                raw_payload = all_bytes[sync_index:]
            elif len(all_bytes) >= TELEMETRY_SIZE:
                # No SSDV sync — likely a telemetry-only packet
                raw_payload = all_bytes
            else:
                print(f"[X] Dropped packet: No SSDV signature and not telemetry size ({len(all_bytes)} bytes)")
                continue

        if raw_payload:
            if len(raw_payload) < 6:
                continue

            # Telemetry-only packet (no SSDV sync word)
            if not is_ssdv_packet(raw_payload):
                # gr-lora prepends 18 bytes of metadata; struct is at offset 18
                if len(raw_payload) < 18 + TELEMETRY_SIZE:
                    continue
                telem_raw = raw_payload[18:18 + TELEMETRY_SIZE]
                telemetry = decode_telemetry(telem_raw)
                if telemetry:
                    telemetry["image_name"] = get_newest_image_name(".")
                    save_to_csv(telemetry)
                    print(f"[+] Telemetry: Lat={telemetry['lat']:.6f}, Lon={telemetry['lng']:.6f}, Alt={telemetry['alt']:.2f}m")
                continue

            # SSDV packet — no header from GNU Radio
            ssdv_data = raw_payload
            
            if ssdv_data[0] != 0x55 or ssdv_data[1] not in (0x66, 0x67):
                print(f"[X] Alignment error: Expected SSDV sync word, got {ssdv_data[:2].hex()}")
                continue
                
            filename = f"01_{message_counter:05}.ssdv"
            with open(filename, "wb") as f:
                f.write(ssdv_data)
                
            message_counter += 1
            print(f"[+] Saved SSDV packet {message_counter} ({len(ssdv_data)} bytes)")
            
            os.system("../../firmware/balloon/tools/ssdv_decode ./ image")
            
    except Exception as e:
        print(f"Error processing packet: {e}")