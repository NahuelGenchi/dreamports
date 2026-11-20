// The kit's own: the functions psx_gpu.c calls before it defines them, which the emulator's SIMD header declares.
#ifndef PSX_GPU_SIMD_H
#define PSX_GPU_SIMD_H

void shade_blocks_textured_unmodulated_indirect(psx_gpu_struct *psx_gpu);
void shade_blocks_textured_unmodulated_direct(psx_gpu_struct *psx_gpu);

#endif
