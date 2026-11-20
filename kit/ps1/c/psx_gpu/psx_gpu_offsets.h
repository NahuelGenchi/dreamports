// The kit's own: where the assembly builds of psx_gpu find its state's parts, which the kit's C build has none of. Only
// the one psx_gpu.c checks is given, as the place it is.
#ifndef PSX_GPU_OFFSETS_H
#define PSX_GPU_OFFSETS_H

#define psx_gpu_blocks_offset offsetof(psx_gpu_struct, blocks)

#endif
