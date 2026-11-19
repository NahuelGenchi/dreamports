/* The test's small values, which the program reaches through $gp when it's built with -G8. */
int gSmall;

/* Bump, 0x80010400 */
int Bump(int by) {
  gSmall += by;
  return gSmall;
}
