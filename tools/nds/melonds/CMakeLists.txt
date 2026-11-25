# The tools' own front for melonDS (libretro.cpp), built with melonDS's console from its makers' source: the Nintendo
# DS's reference emulator, as tools/libretro/host.c loads it (docs/CONSOLES.md).
add_library(melonds_dreamports_libretro SHARED libretro.cpp)
target_link_libraries(melonds_dreamports_libretro PRIVATE core)
set_target_properties(melonds_dreamports_libretro PROPERTIES PREFIX "" CXX_VISIBILITY_PRESET hidden
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}" RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
if (WIN32)
    # the compiler's own libraries inside it, so it loads on a computer with no compiler
    target_link_options(melonds_dreamports_libretro PRIVATE -static -static-libgcc -static-libstdc++)
endif()

# The program that runs one function of a game in melonDS's own processors, for the function check (tools/nds/call.cpp,
# which tools/nds/original.mjs puts beside this file when it builds it): the same console, with no front
if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/call.cpp")
    add_executable(dreamports_nds_call call.cpp)
    target_link_libraries(dreamports_nds_call PRIVATE core)
    set_target_properties(dreamports_nds_call PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
    if (WIN32)
        target_link_options(dreamports_nds_call PRIVATE -static -static-libgcc -static-libstdc++)
    endif()
endif()
