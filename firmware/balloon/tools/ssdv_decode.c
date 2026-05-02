#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include "../ssdv.h"

#define MAX_PACKETS 1000
#define PACKET_SIZE 220

typedef struct {
    uint16_t id;
    uint8_t data[PACKET_SIZE];
} packet_t;

int compare_packets(const void *a, const void *b) {
    return ((packet_t *)a)->id - ((packet_t *)b)->id;
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <directory> <output_file.jpg>\n", argv[0]);
        return 1;
    }

    char *dir_path = argv[1];
    char *out_path = argv[2];

    DIR *dir = opendir(dir_path);
    if (!dir) {
        perror("opendir");
        return 1;
    }

    packet_t *packets = malloc(sizeof(packet_t) * MAX_PACKETS);
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
                packets[packet_count].id = info.packet_id;
                packet_count++;
            }
            fclose(f);

            if (packet_count >= MAX_PACKETS) break;
        }
    }
    closedir(dir);

    if (packet_count == 0) {
        fprintf(stderr, "No SSDV packets found\n");
        free(packets);
        return 1;
    }

    qsort(packets, packet_count, sizeof(packet_t), compare_packets);

    ssdv_t ssdv;
    ssdv_dec_init(&ssdv, PACKET_SIZE);

    size_t out_size = 1024 * 1024; // 1MB buffer
    uint8_t *out_buf = malloc(out_size);
    ssdv_dec_set_buffer(&ssdv, out_buf, out_size);

    for (int i = 0; i < packet_count; i++) {
        ssdv_dec_feed(&ssdv, packets[i].data);
    }

    uint8_t *jpeg;
    size_t jpeg_len;
    ssdv_dec_get_jpeg(&ssdv, &jpeg, &jpeg_len);

    FILE *out = fopen(out_path, "wb");
    if (out) {
        fwrite(jpeg, 1, jpeg_len, out);
        fclose(out);
        printf("Decoded %d packets into %s (%zu bytes)\n", packet_count, out_path, jpeg_len);
    } else {
        perror("fopen output");
    }

    free(packets);
    free(out_buf);

    return 0;
}
