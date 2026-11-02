// What original.c and read.c need on Windows, and nothing anywhere else. Windows gives main() its arguments in the
// computer's old code page, where a file called Pokémon wouldn't survive, and mGBA reads a path as UTF-8. And it turns
// each newline written to stdout into two bytes, and reads two as one on stdin, unless told not to.
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <fcntl.h>
#include <io.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

static void onWindows(char*** argv) {
	_setmode(_fileno(stdout), _O_BINARY);
	_setmode(_fileno(stdin), _O_BINARY);
	int count;
	LPWSTR* wide = CommandLineToArgvW(GetCommandLineW(), &count);
	char** utf8 = calloc(count + 1, sizeof(char*));
	for (int i = 0; i < count; ++i) {
		int size = WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, NULL, 0, NULL, NULL);
		utf8[i] = malloc(size);
		WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, utf8[i], size, NULL, NULL);
	}
	*argv = utf8;
}
#else
#define onWindows(argv)
#endif
