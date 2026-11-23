// The two logos the game opens with: SEGA's, then Sonic Team's.
#ifndef LOGOS_H
#define LOGOS_H
#include "console.h"

void CreateSegaLogo(void);
void Task_SegaLogoInit(void);
void Task_800D11C(void);
void CreateSonicTeamLogo(void);
void Task_800D268(void);
void sub_800D364(void);
void Task_SetSegaLogoTask(void);
void sub_800D3E0(void);
void SwitchToSonicTeamLogo(void);
void Task_SonicTeamLogoInit(void);
void Task_800D450(void);
void sub_800D498(void);
void Task_800D4B0(void);

#endif
