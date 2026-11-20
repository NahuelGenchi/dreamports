// The process match runs the PlayStation's compiler in (match.mjs, compileFile): clang's preprocessor and GCC 2.x, two
// programs of WebAssembly, run in a process of their own that's kept running, so a file after the first takes about a
// twentieth of a second. Some runs of `npm run test:ps1-match` crashed in the process that ran them, with a segmentation
// fault of Node.js's own and not of either program (#1661), too rarely to be caught again: apart, a crash ends only this
// process, and match starts another and asks it once more.
//
// It's asked { id, file, root, includes, version, flags } and answers { id, preprocessed, assembly } with the file as the
// compiler read it, in base64, and the assembly GCC wrote, or { id, error, stage } when the preprocessor or GCC said what
// was wrong, and { id, log } for each line GCC's build says as it goes, the first time.

import { preprocess } from '../gba/match.mjs';
import { compileC } from './gcc.mjs';

process.on('message', async ({ id, file, root, includes, version, flags }) => {
  let preprocessed;
  try {
    preprocessed = await preprocess(file, root, includes);
  } catch (error) {
    process.send({ id, error: error.message, stage: 'preprocess' });
    return;
  }
  try {
    const built = await compileC(preprocessed, { version, flags, log: line => process.send({ id, log: line }) });
    process.send({ id, preprocessed: preprocessed.toString('base64'), ...built, ...(built.error ? { stage: 'gcc' } : {}) });
  } catch (error) {
    process.send({ id, error: String(error.message ?? error), stage: 'gcc' });
  }
});
// once match is done with it, it goes too
process.on('disconnect', () => process.exit(0));
