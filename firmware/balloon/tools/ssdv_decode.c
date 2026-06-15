#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include "../ssdv.h"

#define MAX_TOTAL_PACKETS 10000
#define PACKET_SIZE (128)

#define STATE_FILE ".ssdv_state"
#define CACHE_FILE ".ssdv_cache"

typedef struct {
    uint16_t image_id;
    uint16_t packet_id;
    uint8_t data[PACKET_SIZE];
} packet_t;

typedef struct {
    int last_idx;
    uint16_t image_id;
    int packet_count;
} state_t;

int compare_packets(const void *a, const void *b) {
    packet_t *pa = (packet_t *)a;
    packet_t *pb = (packet_t *)b;
    if (pa->image_id != pb->image_id) {
        return pa->image_id - pb->image_id;
    }
    return pa->packet_id - pb->packet_id;
}

void decode_image(packet_t *packets, int count, const char *out_prefix) {
    if (count == 0) return;

    uint16_t image_id = packets[0].image_id;
    char out_path[1024];
    snprintf(out_path, sizeof(out_path), "%s_%05u.jpg", out_prefix, image_id);

    ssdv_t ssdv;
    ssdv_dec_init(&ssdv, PACKET_SIZE);

    size_t out_size = 1024 * 1024; // 1MB buffer
    uint8_t *out_buf = malloc(out_size);
    ssdv_dec_set_buffer(&ssdv, out_buf, out_size);

    for (int i = 0; i < count; i++) {
        int errors = 0;
        int res = ssdv_dec_is_packet(packets[i].data, PACKET_SIZE, &errors);

        if (res < 0) {
            fprintf(stderr, "Warning: Image %04X Packet %d failed FEC/Sanity check (uncorrectable)\n", image_id, packets[i].packet_id);
        } else if (errors > 0) {
            printf("Fixed %d errors in image %04X packet %d\n", errors, image_id, packets[i].packet_id);
        }

        ssdv_dec_feed(&ssdv, packets[i].data);
    }

    uint8_t *jpeg;
    size_t jpeg_len;
    ssdv_dec_get_jpeg(&ssdv, &jpeg, &jpeg_len);

    FILE *out = fopen(out_path, "wb");
    if (out) {
        fwrite(jpeg, 1, jpeg_len, out);
        fclose(out);
        printf("Decoded %d packets into %s (%zu bytes)\n", count, out_path, jpeg_len);
    } else {
        perror("fopen output");
    }

    free(out_buf);
}

void save_state(const char *dir_path, state_t *state) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir_path, STATE_FILE);
    FILE *f = fopen(path, "w");
    if (f) {
        fprintf(f, "%d\n%u\n%d\n", state->last_idx, state->image_id, state->packet_count);
        fclose(f);
    }
}

void save_cache(const char *dir_path, packet_t *packets, int count) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir_path, CACHE_FILE);
    FILE *f = fopen(path, "wb");
    if (f) {
        fwrite(packets, sizeof(packet_t), count, f);
        fclose(f);
    }
}

int load_cache(const char *dir_path, packet_t *packets, int max_count) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir_path, CACHE_FILE);
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    int count = 0;
    while (count < max_count && fread(&packets[count], sizeof(packet_t), 1, f) == 1) {
        count++;
    }
    fclose(f);
    return count;
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <directory> <output_prefix>\n", argv[0]);
        return 1;
    }

    char *dir_path = argv[1];
    char *out_prefix = argv[2];

    // Load persistent state
    state_t state = { .last_idx = -1, .image_id = 0, .packet_count = 0 };
    {
        char state_path[1024];
        snprintf(state_path, sizeof(state_path), "%s/%s", dir_path, STATE_FILE);
        FILE *f = fopen(state_path, "r");
        if (f) {
            fscanf(f, "%d\n%hu\n%d", &state.last_idx, &state.image_id, &state.packet_count);
            fclose(f);
        }
    }

    packet_t *packets = malloc(sizeof(packet_t) * MAX_TOTAL_PACKETS);
    if (!packets) {
        perror("malloc packets");
        return 1;
    }
    int packet_count = 0;

    // Load previously cached packets for the in-progress image
    int cached_count = load_cache(dir_path, packets, MAX_TOTAL_PACKETS);
    packet_count = cached_count;

    // Scan directory for NEW .ssdv files (index > last_idx)
    DIR *dir = opendir(dir_path);
    if (!dir) {
        perror("opendir");
        free(packets);
        return 1;
    }

    int max_new_idx = state.last_idx;
    int new_file_count = 0;
    uint16_t newest_seen_id = state.image_id;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (!strstr(entry->d_name, ".ssdv")) continue;

        int pkt_idx = -1;
        if (sscanf(entry->d_name, "%*d_%d", &pkt_idx) < 1) continue;
        if (pkt_idx <= state.last_idx) continue;

        if (pkt_idx > max_new_idx) max_new_idx = pkt_idx;

        char full_path[1024];
        snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entry->d_name);

        FILE *f = fopen(full_path, "rb");
        if (!f) continue;

        if (packet_count >= MAX_TOTAL_PACKETS) {
            fclose(f);
            break;
        }

        packet_t *pkt = &packets[packet_count];
        if (fread(pkt->data, 1, PACKET_SIZE, f) == PACKET_SIZE) {
            ssdv_packet_info_t info;
            ssdv_dec_header(&info, pkt->data);
            pkt->image_id = info.image_id;
            pkt->packet_id = info.packet_id;
            packet_count++;
            new_file_count++;

            if (info.image_id > newest_seen_id) {
                newest_seen_id = info.image_id;
            }
        }
        fclose(f);
    }
    closedir(dir);

    // If a new image has started, discard old cached packets
    if (newest_seen_id > state.image_id && state.image_id != 0) {
        int kept = 0;
        for (int i = cached_count; i < packet_count; i++) {
            packets[kept++] = packets[i];
        }
        packet_count = kept;
    }

    if (packet_count == 0) {
        printf("No new SSDV packets to decode\n");
        free(packets);
        return 0;
    }

    // Find newest image_id in working set
    uint16_t target_id = 0;
    for (int i = 0; i < packet_count; i++) {
        if (packets[i].image_id > target_id) {
            target_id = packets[i].image_id;
        }
    }

    // Collect only packets for the newest image
    packet_t *target_packets = malloc(sizeof(packet_t) * packet_count);
    int target_count = 0;
    for (int i = 0; i < packet_count; i++) {
        if (packets[i].image_id == target_id) {
            target_packets[target_count++] = packets[i];
        }
    }

    // Sort and decode
    qsort(target_packets, target_count, sizeof(packet_t), compare_packets);
    decode_image(target_packets, target_count, out_prefix);

    // Persist state so next run is incremental
    state.last_idx = max_new_idx;
    state.image_id = target_id;
    state.packet_count = target_count;
    save_state(dir_path, &state);
    save_cache(dir_path, target_packets, target_count);

    free(target_packets);
    free(packets);

    return 0;
}
