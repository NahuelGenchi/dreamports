// The kit's own: psx_gpu.c ends by taking in the emulator's drawing at four times the console's size, which the kit
// never asks for, as it draws what the console draws. Only what psx_gpu_parse.c's enhanced parser names is here, and
// it draws nothing.

void render_sprite_4x(psx_gpu_struct *psx_gpu, s32 x, s32 y, u32 u, u32 v, s32 width, s32 height, u32 flags, u32 color) {}
