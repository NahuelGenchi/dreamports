// The act's terrain and the sensors that read it for Sonic, translated from the JavaScript version's engine/terrain.js
// and engine/sensors.js.

#ifndef SA_TERRAIN_H
#define SA_TERRAIN_H

#include "player.h"

enum { IGNORE_PLATFORMS = 0x80 };   // added to a layer: jump-through tiles count as empty
enum { PROBE_FLOOR, PROBE_WALL };   // a scan along a column, or along a row

typedef struct { int d, rot, hasRot; } Scan;

/** sub_801E4E4, the original's terrain scan: the distance from `p0` to the last free pixel along `step` (+8 or -8),
 *  and the surface's angle, if it found a surface. `p1` is the other coordinate. */
Scan terrain_scan(int probe, int p0, int p1, int layer, int step);

/** The one-tile floor probe (sub_801F100): the distance from (x, y) to the floor within the tile holding y, 0 or less at or
 *  inside it. An empty tile sends it on to the next one along `step` (+8 or -8), a full one to the tile before. */
int terrain_tile_floor(int x, int y, int layer, int step);
/** The same probe along either axis (the JavaScript version's tileScan): `kind` and the coordinates as terrain_scan takes them. */
int terrain_tile_scan(int kind, int p0, int p1, int layer, int step);
/** The same probe with the angle of the tile it read (sub_801F07C's rotation out, the JavaScript version's probeTile); the
 *  angle is only there (hasRot) when that tile isn't empty. */
Scan terrain_tile_probe(int kind, int p0, int p1, int layer, int step);
/** The surface angle of the tile at (px, py), 0-255 a turn, mirrored for flipped tiles. */
int terrain_angle(int px, int py, int layer);

/** sub_8022D6C: keeps a grounded Sonic on the surface, follows its angle, or lets him fall off. */
void sensors_ground(Player *p);
/** sub_8023128 walking and rolling, and sub_80231C0 in the B-button combo: stops Sonic at a wall ahead one frame early.
 *  True when a wall to his side pushed him back; the walking check also starts a push. */
int sensors_wall_push(Player *p, int rolling);
/** sub_8022190: the collision of Sonic in the air, touching him down on the ground. */
void sensors_air(Player *p);
/** His angle in the act's own terms: turned over when gravity is flipped. */
int sensors_act_angle(const Player *p);
/** sub_8022F58: the room above Sonic, or beyond him, in the act's direction `angle`. */
int sensors_clearance(const Player *p, int angle);
/** What a pair of sensors finds: the nearer distance, its surface's angle (0 for none or an odd one), and the other's. */
typedef struct { int d, rot, out; } SensorPair;
/** His floor under him (sub_8029B88), and the act's floor and ceiling whichever way gravity pulls (sub_8029B0C,
 *  sub_8029AC0). */
SensorPair sensors_floor_under(const Player *p);
SensorPair sensors_act_floor(const Player *p);
SensorPair sensors_act_ceiling(const Player *p);
/** The wall to his left (dir -1) or right, with its sensors at his top and bottom (sub_8029A28, sub_8029A74). */
SensorPair sensors_wall_beside(const Player *p, int dir);
/** sub_8022838: the collision of Knuckles' glide, his drop from it and his slide after it. Walls stop him and set
 *  GLIDE_WALL in his glideFlags, and the ground, as standing on an object, clears GLIDE_UP. */
void sensors_glide(Player *p);
/** Player_HandleSpriteYOffsetChange: moves his centre so his feet stay put when the offset changes. */
void sensors_set_offset_y(Player *p, int offsetY);

#endif
