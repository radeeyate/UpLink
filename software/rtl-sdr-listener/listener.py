import zmq
import pmt
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
        raw_payload = None

        if pmt.is_pair(p):
            data_vector = pmt.cdr(p)
            if pmt.is_u8vector(data_vector):
                raw_payload = bytes(pmt.u8vector_elements(data_vector))
        
        elif pmt.is_u8vector(p):
            all_bytes = bytes(pmt.u8vector_elements(p))
            
            sync_index = -1
            for i in range(len(all_bytes) - 5):
                if all_bytes[i+4] == 0x55 and all_bytes[i+5] in (0x66, 0x67):
                    sync_index = i
                    break
            
            if sync_index != -1:
                raw_payload = all_bytes[sync_index:]
            else:
                print(f"[X] Dropped packet: Could not find RadioHead/SSDV signature in raw vector of length {len(all_bytes)}")
                continue

        if raw_payload:
            if len(raw_payload) < 6:
                continue
            
            ssdv_data = raw_payload[4:]
            
            if ssdv_data[0] != 0x55 or ssdv_data[1] not in (0x66, 0x67):
                print(f"[X] Alignment error: Expected SSDV sync word, got {ssdv_data[:2].hex()}")
                continue
                
            filename = f"01_{message_counter:05}.ssdv"
            with open(filename, "wb") as f:
                f.write(ssdv_data)
                
            message_counter += 1
            print(f"[+] Saved pristine SSDV packet {message_counter} ({len(ssdv_data)} bytes)")
            
            os.system("../../firmware/balloon/tools/ssdv_decode ./ image2.jpg")
            
    except Exception as e:
        print(f"Error processing packet: {e}")
