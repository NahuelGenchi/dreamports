/* A count two functions share, which the file keeps to itself. */
static int sLevel;

/* Up, 0x80010500 */
int Up(void) {
  return ++sLevel;
}

/* Down, 0x80010600 */
int Down(void) {
  return --sLevel;
}
