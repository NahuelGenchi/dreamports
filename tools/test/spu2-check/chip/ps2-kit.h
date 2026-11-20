// What the kit's sound chip (kit/ps2/c/spu2.c) needs of the kit, for the check to build it on its own.

#ifndef SPU2_CHECK_KIT_H
#define SPU2_CHECK_KIT_H

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#define SPU2_IN_REFERENCE 1

static inline void *kit_alloc(size_t size) { return calloc(1, size ? size : 1); }

void spu2_write(uint32_t address, uint32_t value);
uint32_t spu2_read(uint32_t address);
uint32_t spu2_dma(int core, uint8_t *buffer, uint32_t block_size, uint32_t blocks, uint32_t direction);
void spu2_block(void);
int spu2_irq(void);
void spu2_list_start(void);
uint32_t spu2_list_hash(void);
uint32_t spu2_list_count(void);
const uint8_t *spu2_list_bytes(uint32_t *size);
const int16_t *spu2_heard(uint32_t *pairs);
void spu2_power(uint8_t *ram);
uint32_t spu2_state_size(void);
void spu2_state_save(uint8_t *to);
void spu2_state_load(const uint8_t *from);
void spu2_transfer(int core, uint32_t *mode, uint32_t *control);

#endif
