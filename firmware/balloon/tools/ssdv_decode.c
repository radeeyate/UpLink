#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include "../ssdv.h"

#define MAX_TOTAL_PACKETS 10000
#define PACKET_SIZE (220)

typedef struct {
    uint16_t image_id;
    uint16_t packet_id;
    uint8_t data[PACKET_SIZE];
} packet_t;

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

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <directory> <output_prefix>\n", argv[0]);
        return 1;
    }

    char *dir_path = argv[1];
    char *out_prefix = argv[2];

    DIR *dir = opendir(dir_path);
    if (!dir) {
        perror("opendir");
        return 1;
    }

    packet_t *packets = malloc(sizeof(packet_t) * MAX_TOTAL_PACKETS);
    if (!packets) {
        perror("malloc packets");
        return 1;
    }
    int packet_count = 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (strstr(entry->d_name, ".ssdv")) {
            char full_path[1024];
            snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entry->d_name);

            FILE *f = fopen(full_path, "rb");
            if (!f) continue;

            if (fread(packets[packet_count].data, 1, PACKET_SIZE, f) == PACKET_SIZE) {
                ssdv_packet_info_t info;
                ssdv_dec_header(&info, packets[packet_count].data);
                packets[packet_count].image_id = info.image_id;
                packets[packet_count].packet_id = info.packet_id;
                packet_count++;
            }
            fclose(f);

            if (packet_count >= MAX_TOTAL_PACKETS) {
                fprintf(stderr, "Warning: Reached MAX_TOTAL_PACKETS (%d)\n", MAX_TOTAL_PACKETS);
                break;
            }
        }
    }
    closedir(dir);

    if (packet_count == 0) {
        fprintf(stderr, "No SSDV packets found\n");
        free(packets);
        return 1;
    }

    qsort(packets, packet_count, sizeof(packet_t), compare_packets);

    int start = 0;
    for (int i = 1; i <= packet_count; i++) {
        if (i == packet_count || packets[i].image_id != packets[start].image_id) {
            decode_image(&packets[start], i - start, out_prefix);
            start = i;
        }
    }

    free(packets);

    return 0;
}
