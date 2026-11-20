// The kit's own: psx_gpu_parse.c counts how long each command takes the console's GPU, for an emulator's timing, which
// the kit doesn't time a frame by. It's counted as nothing.
#ifndef GPU_TIMING_H
#define GPU_TIMING_H

#define gput_fill(w, h) 0
#define gput_copy(w, h) 0
#define gput_poly_base() 0
#define gput_poly_base_t() 0
#define gput_poly_base_g() 0
#define gput_poly_base_gt() 0
#define gput_quad_base() 0
#define gput_quad_base_t() 0
#define gput_quad_base_g() 0
#define gput_quad_base_gt() 0
#define gput_line(k) 0
#define gput_sprite(w, h) 0
#define gput_sum(sum, cnt, new_cycles) do { sum += cnt; cnt = new_cycles; } while (0)

#endif
