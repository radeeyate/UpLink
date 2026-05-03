import zmq
import pmt
import struct
import os

context = zmq.Context()
socket = context.socket(zmq.SUB)
socket.connect("tcp://127.0.0.1:5555")
socket.setsockopt(zmq.SUBSCRIBE, b"")

print("Listening for LoRa frames from GNU Radio...")
message_counter = 0

while True:
    message_bytes = socket.recv()
    
    try:
        p = pmt.deserialize_str(message_bytes)
        
        if pmt.is_u8vector(p):
            payload_list = pmt.u8vector_elements(p)
            raw_data = bytes(payload_list)
            
            if len(raw_data) < 18:
                continue

            gr_metadata_header = raw_data[:18]
            full_lora_frame = raw_data[18:]
            
            expected_length = gr_metadata_header[15]
            
            has_mac_crc = (gr_metadata_header[16] >> 4) & 1
            crc_size = 2 if has_mac_crc else 0
            
            if len(full_lora_frame) != (expected_length + crc_size):
                print(f"[X] Dropped packet: Length mismatch (Expected {expected_length}+{crc_size}, got {len(full_lora_frame)})")
                continue
            
            # slice off 4 bytes from front (RadioHead headers: To, From, ID, Flags)
            # and 2 bytes from back (LoRa CRC)
            if len(full_lora_frame) < 6:
                continue
                
            ssdv_data = full_lora_frame[4:-crc_size if crc_size else None]
            
            if len(ssdv_data) < 2 or ssdv_data[0] != 0x55 or ssdv_data[1] not in (0x66, 0x67):
                print(f"[X] Dropped packet: Missing SSDV Sync Word (Got {ssdv_data[:2].hex()})")
                continue
                
            # if it passes both checks, it's a pristine packet!
            open(f"01_{message_counter:05}.ssdv", "wb").write(ssdv_data)
            message_counter += 1
            
            print(f"[+] Saved pristine SSDV packet {message_counter} ({len(ssdv_data)} bytes)")
            os.system("../../firmware/balloon/tools/ssdv_decode ./ image2.jpg")
        else:
            print("Received PMT, but it wasn't a u8vector.")
            
    except Exception as e:
        print(f"Error processing packet: {e}")
