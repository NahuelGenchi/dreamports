// What melonDS asks of the computer it runs on, for the tools' two programs built from it: its front (libretro.cpp) and
// the program that runs one function of a game (../call.cpp). Each includes this once, after melonDS's own Platform.h.
// The console is given nothing of it: no files, no network, no camera, no
// microphone and no clock, so nothing outside the program and its presses can change a frame.
namespace melonDS::Platform {

void SignalStop(StopReason, void*) {}

struct FileHandle { FILE* file; };
std::string GetLocalFilePath(const std::string& filename) { return filename; }
FileHandle* OpenFile(const std::string&, FileMode) { return nullptr; }
FileHandle* OpenLocalFile(const std::string&, FileMode) { return nullptr; }
bool FileExists(const std::string&) { return false; }
bool LocalFileExists(const std::string&) { return false; }
bool CheckFileWritable(const std::string&) { return false; }
bool CheckLocalFileWritable(const std::string&) { return false; }
bool CloseFile(FileHandle*) { return true; }
bool IsEndOfFile(FileHandle*) { return true; }
bool FileReadLine(char*, int, FileHandle*) { return false; }
u64 FilePosition(FileHandle*) { return 0; }
bool FileSeek(FileHandle*, s64, FileSeekOrigin) { return false; }
void FileRewind(FileHandle*) {}
u64 FileRead(void*, u64, u64, FileHandle*) { return 0; }
bool FileFlush(FileHandle*) { return true; }
u64 FileWrite(const void*, u64, u64, FileHandle*) { return 0; }
u64 FileWriteFormatted(FileHandle*, const char*, ...) { return 0; }
u64 FileLength(FileHandle*) { return 0; }

void Log(LogLevel, const char*, ...) {}

// nothing here runs on a thread of its own: the software renderer is asked for none, and a lock held by the one thread
// there is does nothing
struct Thread {};
Thread* Thread_Create(std::function<void()>) { return new Thread; }
void Thread_Free(Thread* thread) { delete thread; }
void Thread_Wait(Thread*) {}

struct Semaphore { int count; };
Semaphore* Semaphore_Create() { return new Semaphore { 0 }; }
void Semaphore_Free(Semaphore* semaphore) { delete semaphore; }
void Semaphore_Reset(Semaphore* semaphore) { semaphore->count = 0; }
void Semaphore_Wait(Semaphore* semaphore) { if (semaphore->count > 0) semaphore->count--; }
bool Semaphore_TryWait(Semaphore* semaphore, int) { if (semaphore->count <= 0) return false; semaphore->count--; return true; }
void Semaphore_Post(Semaphore* semaphore, int count) { semaphore->count += count; }

struct Mutex {};
Mutex* Mutex_Create() { return new Mutex; }
void Mutex_Free(Mutex* mutex) { delete mutex; }
void Mutex_Lock(Mutex*) {}
void Mutex_Unlock(Mutex*) {}
bool Mutex_TryLock(Mutex*) { return true; }

void Sleep(u64) {}
u64 GetMSCount() { return 0; }
u64 GetUSCount() { return 0; }

void WriteNDSSave(const u8*, u32, u32, u32, void*) {}
void WriteGBASave(const u8*, u32, u32, u32, void*) {}
void WriteFirmware(const Firmware&, u32, u32, void*) {}
void WriteDateTime(int, int, int, int, int, int, void*) {}

void MP_Begin(void*) {}
void MP_End(void*) {}
int MP_SendPacket(u8*, int, u64, void*) { return 0; }
int MP_RecvPacket(u8*, u64*, void*) { return 0; }
int MP_SendCmd(u8*, int, u64, void*) { return 0; }
int MP_SendReply(u8*, int, u64, u16, void*) { return 0; }
int MP_SendAck(u8*, int, u64, void*) { return 0; }
int MP_RecvHostPacket(u8*, u64*, void*) { return 0; }
u16 MP_RecvReplies(u8*, u64, u16, void*) { return 0; }

int Net_SendPacket(u8*, int, void*) { return 0; }
int Net_RecvPacket(u8*, void*) { return 0; }

void Camera_Start(int, void*) {}
void Camera_Stop(int, void*) {}
void Camera_CaptureFrame(int, u32*, int, int, bool, void*) {}

void Mic_Start(void*) {}
void Mic_Stop(void*) {}
int Mic_ReadInput(s16*, int, void*) { return 0; }

AACDecoder* AAC_Init() { return nullptr; }
void AAC_DeInit(AACDecoder*) {}
bool AAC_Configure(AACDecoder*, int, int) { return false; }
bool AAC_DecodeFrame(AACDecoder*, const void*, int, void*, int) { return false; }

bool Addon_KeyDown(KeyType, void*) { return false; }
void Addon_RumbleStart(u32, void*) {}
void Addon_RumbleStop(void*) {}
float Addon_MotionQuery(MotionQueryType, void*) { return 0.0f; }

DynamicLibrary* DynamicLibrary_Load(const char*) { return nullptr; }
void DynamicLibrary_Unload(DynamicLibrary*) {}
void* DynamicLibrary_LoadFunction(DynamicLibrary*, const char*) { return nullptr; }

}
