// The language screen, at a first start or from the options.
#ifndef LANGUAGE_H
#define LANGUAGE_H
#include "console.h"

struct Task;

void CreateEditLanguageScreen(u8 mode);
void Task_EditLanguageScreenInit(void);
void TaskDestructor_EditLanguageScreen(struct Task *t);
void sub_806A6A8(void);
void sub_806AD44(void);

#endif
