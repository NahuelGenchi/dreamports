/* A second file of the made-up program, built with -G8, so its small value is reached through $gp. */
int gSmall = 5;

/* Bump, @Bump: adds to a small value */
int Bump(int x) {
  gSmall += x;
  return gSmall;
}
