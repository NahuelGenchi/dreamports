# Sources

The twins in this folder were written from these sources:

- Xeeynamo/sotn-decomp at 396086f (https://github.com/Xeeynamo/sotn-decomp): `src/main/psxsdk/libetc/` (`pad.c`, `vsync.c`, `intr.c`, `intr_vb.c`, `intr_dma.c` and `vmode.c`), each under the MIT License as its first line says, which each file here keeps, taken as that decompilation writes them, with names of their own for the values it named by where they are in its game, every function's `static` left out so it can be a twin, and a typedef for the type `startIntrVSync` gives back; and `include/psxsdk/libetc.h` with `src/main/psxsdk/libapi/libapi_internal.h`, for the table of callbacks and `jmp_buf` in `libetc_internal.h`. The functions' names and sizes in `library.json` come from its `config/splat.us.main.yaml` and `config/symbols.us.txt`.
- mkst/maspsx at 4ffa8b5 (https://github.com/mkst/maspsx), under the MIT License, whose rules for Sony's assembler `match` builds these files with, carried into JavaScript in `tools/ps1/maspsx.mjs`; and GNU's GCC 2.7.2, built on the contributor's computer and not kept here.
