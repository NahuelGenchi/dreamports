// PCSX2's GS runner, the strict reference the PlayStation 2 kit's drawing is proven against where Play! can't draw
// exactly (kit/ps2/c/README.md). It replays a GS dump, everything a GS was given, with PCSX2's software renderer, the GS
// emulation every other free one measures itself against, and saves each frame's framebuffer as the GS left it in its
// memory. It's built here from its makers' source at a fixed commit, with every library it needs that a computer may not
// have built beside it, once, on Linux: nothing is installed on the computer. PCSX2 is GPL-3.0-or-later and runs only
// here, as a tool: none of its code is in the kit.
//
// It shows what it replays through Vulkan, so it needs a graphics card with a Vulkan driver, even with no window: on
// Mesa's llvmpipe alone it falls back to OpenGL, which it can't open without a window on Linux.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { buildJobs } from '../lib/jobs.mjs';

const FOLDER = join(LOCAL, 'pcsx2');
const DOWNLOADS = join(FOLDER, 'downloads'), LIBRARIES = join(FOLDER, 'libraries'), WORK = join(FOLDER, 'work');
const SOURCE = join(FOLDER, 'source'), BUILD = join(FOLDER, 'build');
const PCSX2 = { source: 'https://github.com/PCSX2/pcsx2.git', commit: '057b8c3c6eaa84153b7bc22ddc41729607fd5fcf' };
export const RUNNER = join(BUILD, 'bin', 'pcsx2-gsrunner');

// what it's built from: PCSX2's own scripts' versions and checksums for its libraries (.github/workflows/scripts/linux),
// and three tools the packet library's build needs
const github = (repo, path) => `https://github.com/${repo}/${path}`;
const ARCHIVES = {
  m4: ['https://ftp.gnu.org/gnu/m4/m4-1.4.21.tar.xz', 'f25c6ab51548a73a75558742fb031e0625d6485fe5f9155949d6486a2408ab66'],
  bison: ['https://ftp.gnu.org/gnu/bison/bison-3.8.2.tar.xz', '9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2'],
  flex: [github('westes/flex', 'releases/download/v2.7.2/flex-2.7.2.tar.gz'), '365b86feb4a63f9a1743b789f360a796d82fe7344eae7facc95e065c84d8e284'],
  libbacktrace: [github('ianlancetaylor/libbacktrace', 'archive/ad106d5fdd5d960bd33fae1c48a351af567fd075/libbacktrace-ad106d5fdd5d960bd33fae1c48a351af567fd075.tar.gz'), '96e5c2d7f2c482a60d5804da48a2eb9a0db0719b2c65dcc169fbfdcf37f3a45d'],
  jpeg: [github('libjpeg-turbo/libjpeg-turbo', 'releases/download/3.2.0/libjpeg-turbo-3.2.0.tar.gz'), '6f30092cef9fb839779646608f4ee14ae3cbac989c47fa05e841b0841f09878e'],
  lz4: [github('lz4/lz4', 'releases/download/v1.10.0/lz4-1.10.0.tar.gz'), '537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b'],
  zstd: [github('facebook/zstd', 'releases/download/v1.5.7/zstd-1.5.7.tar.gz'), 'eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3'],
  webp: ['https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz', 'e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564'],
  sdl: ['https://libsdl.org/release/SDL3-3.2.26.tar.gz', 'dad488474a51a0b01d547cd2834893d6299328d2e30f479a3564088b5476bae2'],
  plutovg: [github('sammycage/plutovg', 'archive/v1.3.2/plutovg-1.3.2.tar.gz'), '7bd4e79ce18b1d47517e7e91fbb7cf19d4f01942804a519bc7c0bf32b6325dd5'],
  plutosvg: [github('sammycage/plutosvg', 'archive/v0.0.7/plutosvg-0.0.7.tar.gz'), '78561b571ac224030cdc450ca2986b4de915c2ba7616004a6d71a379bffd15f3'],
  ryml: [github('biojppm/rapidyaml', 'releases/download/v0.12.1/rapidyaml-0.12.1-src.tgz'), 'e9efcdd17f86287748793cf21d106e461fcad8d103a3e5a23632afe93828660d'],
  curl: ['https://curl.se/download/curl-8.23.0.tar.xz', '8dadd7d2536a314f982ad05a651b713f426bf7d02cc2c76cffb9796f2218e6c5'],
  pcap: ['https://www.tcpdump.org/release/libpcap-1.11.0.tar.xz', '9237f5bae9dcf3a91823d9963ec43b7c0e2e3374ef2ad57d92c8cd39530f4723'],
  ffmpeg: ['https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz', 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'],
  shaderc: [github('google/shaderc', 'archive/v2025.4/shaderc-2025.4.tar.gz'), '8a89fb6612ace8954470aae004623374a8fc8b7a34a4277bee5527173b064faf'],
  glslang: [github('KhronosGroup/glslang', 'archive/7a47e2531cb334982b2a2dd8513dca0a3de4373d/shaderc-glslang-7a47e2531cb334982b2a2dd8513dca0a3de4373d.tar.gz'), '272d2725b140e09e85b96eecdc59c2e00c1a14cda2301767e1bf3c363a44b931'],
  spirvHeaders: [github('KhronosGroup/SPIRV-Headers', 'archive/b824a462d4256d720bebb40e78b9eb8f78bbb305/shaderc-spirv-headers-b824a462d4256d720bebb40e78b9eb8f78bbb305.tar.gz'), 'c693867f10a7760ef1bcf85419d51783586768cc2c601d03841bc6a8b2554b9c'],
  spirvTools: [github('KhronosGroup/SPIRV-Tools', 'archive/971a7b6e8d7740035bbff089bbbf9f42951ecfd5/shaderc-spirv-tools-971a7b6e8d7740035bbff089bbbf9f42951ecfd5.tar.gz'), '06b0a042f2e121e954badb4fd78c9e2d4bc7ed6087eceb26ab559c23cf94334f'],
};

// built in a folder of its own, as some of them have a folder called build already
const cmake = (...settings) => [
  ['cmake', ['-B', 'dreamports-build', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_PREFIX_PATH=${LIBRARIES}`, `-DCMAKE_INSTALL_PREFIX=${LIBRARIES}`, '-DCMAKE_INSTALL_LIBDIR=lib', ...settings]],
  ['cmake', ['--build', 'dreamports-build']], ['cmake', ['--install', 'dreamports-build']],
];
const configure = (prefix, ...settings) => [['./configure', [`--prefix=${prefix}`, ...settings]], ['make', [`-j${buildJobs()}`]], ['make', ['install']]];
const TOOLS = join(LIBRARIES, 'tools');
// each library: its archive, the folder it unpacks to, and how it's built, in the order they need each other
const STEPS = [
  { name: 'm4', folder: 'm4-1.4.21', build: () => configure(TOOLS) },
  { name: 'bison', folder: 'bison-3.8.2', build: () => configure(TOOLS, '--disable-nls'), env: { CFLAGS: '-O2 -std=gnu17' } },
  { name: 'flex', folder: 'flex-2.7.2', build: () => configure(TOOLS, '--disable-nls') },
  { name: 'libbacktrace', folder: 'libbacktrace-ad106d5fdd5d960bd33fae1c48a351af567fd075', build: () => configure(LIBRARIES, '--with-pic') },
  { name: 'jpeg', folder: 'libjpeg-turbo-3.2.0', build: () => cmake('-DENABLE_STATIC=OFF', '-DENABLE_SHARED=ON', '-DCMAKE_POSITION_INDEPENDENT_CODE=1', '-DWITH_SIMD=OFF') },
  { name: 'lz4', folder: 'lz4-1.10.0', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DLZ4_BUILD_CLI=OFF', '-DLZ4_BUILD_LEGACY_LZ4C=OFF', '-S', 'build/cmake') },
  { name: 'zstd', folder: 'zstd-1.5.7', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DZSTD_BUILD_SHARED=ON', '-DZSTD_BUILD_STATIC=OFF', '-DZSTD_BUILD_PROGRAMS=OFF', '-S', 'build/cmake') },
  { name: 'webp', folder: 'libwebp-1.6.0', build: () => cmake('-DBUILD_SHARED_LIBS=ON', ...['ANIM_UTILS', 'CWEBP', 'DWEBP', 'GIF2WEBP', 'IMG2WEBP', 'VWEBP', 'WEBPINFO', 'WEBPMUX', 'EXTRAS'].map(part => `-DWEBP_BUILD_${part}=OFF`)) },
  { name: 'sdl', folder: 'SDL3-3.2.26', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DSDL_SHARED=ON', '-DSDL_STATIC=OFF', '-DSDL_VIDEO=OFF', '-DSDL_POWER=OFF', '-DSDL_SENSOR=OFF', '-DSDL_DIALOG=OFF', '-DSDL_TRAY=OFF', '-DSDL_TEST_LIBRARY=OFF', '-DSDL_UNIX_CONSOLE_BUILD=ON') },
  { name: 'plutovg', folder: 'plutovg-1.3.2', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DPLUTOVG_BUILD_EXAMPLES=OFF') },
  { name: 'plutosvg', folder: 'plutosvg-0.0.7', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DPLUTOSVG_ENABLE_FREETYPE=ON', '-DPLUTOSVG_BUILD_EXAMPLES=OFF') },
  { name: 'ryml', folder: 'rapidyaml-0.12.1-src', build: () => cmake('-DBUILD_SHARED_LIBS=ON') },
  {
    name: 'curl', folder: 'curl-8.23.0',
    build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DBUILD_STATIC_LIBS=OFF', '-DBUILD_CURL_EXE=OFF', '-DBUILD_TESTING=OFF', '-DBUILD_EXAMPLES=OFF', '-DBUILD_LIBCURL_DOCS=OFF', '-DBUILD_MISC_DOCS=OFF', '-DENABLE_CURL_MANUAL=OFF', '-DCURL_ENABLE_SSL=OFF', '-DCURL_USE_OPENSSL=OFF', '-DCURL_USE_LIBPSL=OFF', '-DCURL_USE_LIBSSH2=OFF', '-DCURL_USE_LIBSSH=OFF', '-DCURL_USE_GSSAPI=OFF', '-DUSE_LIBIDN2=OFF', '-DUSE_NGHTTP2=OFF', '-DUSE_NGHTTP3=OFF', '-DUSE_LIBRTMP=OFF', '-DCURL_BROTLI=OFF', '-DCURL_ZSTD=OFF', '-DCURL_DISABLE_LDAP=ON', '-DCURL_DISABLE_LDAPS=ON', '-DENABLE_ARES=OFF'),
  },
  { name: 'pcap', folder: 'libpcap-1.11.0', build: () => cmake('-DBUILD_SHARED_LIBS=ON', '-DENABLE_REMOTE=OFF', '-DDISABLE_DBUS=ON', '-DDISABLE_RDMA=ON', '-DDISABLE_BLUETOOTH=ON', '-DDISABLE_NETMAP=ON', '-DDISABLE_DPDK=ON', '-DDISABLE_LINUX_USBMON=ON', '-DBUILD_WITH_LIBNL=OFF') },
  {
    // only for recording video, which the runner never does, so as small as it builds
    name: 'ffmpeg', folder: 'ffmpeg-9.0.1',
    build: () => configure(LIBRARIES, '--disable-all', '--disable-autodetect', '--disable-static', '--enable-shared', '--disable-x86asm', '--disable-doc', '--enable-avcodec', '--enable-avformat', '--enable-avutil', '--enable-swresample', '--enable-swscale', '--enable-encoder=ffv1,qtrle,aac,flac,pcm_s16be,pcm_s16le', '--enable-muxer=avi,matroska,mov,mp4,wav', '--enable-protocol=file'),
  },
  {
    // for Vulkan, which shows what the runner replays, with its three parts unpacked into it and PCSX2's change to it
    name: 'shaderc', folder: 'shaderc-2025.4', parts: { glslang: 'glslang', spirvHeaders: 'spirv-headers', spirvTools: 'spirv-tools' },
    patch: join(SOURCE, '.github', 'workflows', 'scripts', 'common', 'shaderc-changes.patch'),
    build: () => cmake('-DSHADERC_SKIP_TESTS=ON', '-DSHADERC_SKIP_EXAMPLES=ON', '-DSHADERC_SKIP_COPYRIGHT_CHECK=ON'),
  },
];

function run(what, program, args, cwd, env) {
  const result = spawnSync(program, args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (result.error?.code === 'ENOENT') throw new Error(`${what} needs ${program}, which isn't installed.`);
  if (result.status !== 0) throw new Error(`${what} failed:\n${`${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-20).join('\n')}`);
}

// an archive, fetched once and checked against the checksum its makers give
async function archive(name) {
  const [url, sha256] = ARCHIVES[name], file = join(DOWNLOADS, url.split('/').at(-1));
  if (!existsSync(file)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Getting ${url} failed: ${response.status}.`);
    mkdirSync(DOWNLOADS, { recursive: true });
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256) {
    rmSync(file, { force: true });
    throw new Error(`${url} isn't what PCSX2's makers checked: it was taken away, and the next build fetches it again.`);
  }
  return file;
}

const environment = extra => ({
  ...process.env, ...extra,
  PATH: [join(TOOLS, 'bin'), process.env.PATH].join(delimiter),
  PKG_CONFIG_PATH: [join(LIBRARIES, 'lib', 'pkgconfig'), join(LIBRARIES, 'share', 'pkgconfig'), process.env.PKG_CONFIG_PATH].filter(Boolean).join(delimiter),
  CMAKE_BUILD_PARALLEL_LEVEL: String(buildJobs()),
});

/** Builds the GS runner, once, saying so with `log`. */
export async function buildPcsx2(log) {
  if (process.platform !== 'linux') throw new Error("PCSX2's GS runner is only built on Linux so far.");
  if (existsSync(RUNNER)) return;
  log("Building PCSX2's GS runner and its libraries from their makers' source, once, which takes several minutes…");
  // PCSX2 at its commit, whose own files say how shaderc is changed
  if (!existsSync(join(SOURCE, '.git'))) {
    mkdirSync(SOURCE, { recursive: true });
    run('Getting PCSX2', 'git', ['init', '-q'], SOURCE);
    run('Getting PCSX2', 'git', ['remote', 'add', 'origin', PCSX2.source], SOURCE);
  }
  run('Getting PCSX2', 'git', ['fetch', '-q', '--depth', '1', 'origin', PCSX2.commit], SOURCE);
  run('Getting PCSX2', 'git', ['checkout', '-q', '--force', 'FETCH_HEAD'], SOURCE);
  for (const step of STEPS) {
    const done = join(LIBRARIES, '.built', step.folder);
    if (existsSync(done)) continue;
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
    const what = `Building ${step.name} for PCSX2's GS runner`, here = join(WORK, step.folder);
    run(what, 'tar', ['xf', await archive(step.name)], WORK);
    for (const [part, into] of Object.entries(step.parts ?? {})) {
      const third = join(here, 'third_party');
      run(what, 'tar', ['xf', await archive(part)], third);
      const unpacked = readdirSync(third).find(name => name.toLowerCase().startsWith(part === 'glslang' ? 'glslang-' : part === 'spirvHeaders' ? 'spirv-headers-' : 'spirv-tools-'));
      run(what, 'mv', [unpacked, into], third);
    }
    if (step.patch) run(what, 'patch', ['-p1', '-i', step.patch], here);
    for (const [program, args] of step.build()) run(what, program, args, here, environment(step.env));
    mkdirSync(join(LIBRARIES, '.built'), { recursive: true });
    writeFileSync(done, '');
  }
  rmSync(WORK, { recursive: true, force: true });
  // the runner alone, with no window of its own, its software renderer showing through Vulkan
  const settings = [
    '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_COMPILER=clang', '-DCMAKE_CXX_COMPILER=clang++', `-DCMAKE_PREFIX_PATH=${LIBRARIES}`,
    '-DENABLE_QT_UI=OFF', '-DENABLE_GSRUNNER=ON', '-DENABLE_TESTS=OFF', '-DUSE_OPENGL=ON', '-DUSE_VULKAN=ON', '-DWAYLAND_API=OFF',
    // every instruction set in the one program, as PCSX2's own releases are built, so the replay can ask for one by name
    '-DDISABLE_ADVANCE_SIMD=ON',
  ];
  run("Building PCSX2's GS runner", 'cmake', ['-S', SOURCE, '-B', BUILD, ...settings], FOLDER, environment());
  run("Building PCSX2's GS runner", 'cmake', ['--build', BUILD, '--target', 'pcsx2-gsrunner'], FOLDER, environment());
  // what it reads as it starts, beside it, and the word that keeps its settings beside it rather than in the home folder
  const bin = join(BUILD, 'bin');
  if (!existsSync(join(bin, 'resources'))) symlinkSync(join(SOURCE, 'bin', 'resources'), join(bin, 'resources'));
  writeFileSync(join(bin, 'portable.txt'), '');
}

/** Replays the GS dump `dump` with the software renderer, on one thread, and saves each frame's framebuffer, as each read
 *  circuit shows it, with its alpha, in `out`: <n>_f<frame>_fr<circuit>_….png, the frame counted from the dump's first
 *  V-blank, and its alpha in a file of its own beside it. Gives the files, sorted. `instructions` names the processor's
 *  instructions the renderer is to use, 'sse4', 'avx' or 'avx2', where it would take the most this computer has: it
 *  draws what varies across a shape a little differently with each, so only what all of them draw the same is exact. */
export function replayGsDump(dump, out, { instructions } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const ini = join(out, 'gs.ini');
  writeFileSync(ini, '[EmuCore/GS]\nSaveAlpha = true\n');
  // every draw's frame, where it would stop saving after its first 5,000 draws
  run("PCSX2's GS runner", RUNNER, ['-renderer', 'sw', '-surfaceless', '-swthreads', '0', '-loop', '1', '-ini', ini, '-dump', 'f', '-dumprange', '0,-1,1', '-dumpdir', out, dump], undefined, instructions ? { ...process.env, OVERRIDE_VECTOR_ISA: instructions } : undefined);
  return readdirSync(out).filter(name => name.endsWith('.png')).sort();
}
