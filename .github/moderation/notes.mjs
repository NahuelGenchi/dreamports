// What a note is and what it may not hold (docs/NOTES.md): what someone found while making a Dreamport, which other
// people's coding agents read before they work. It lives here, with no packages, as the Dreamports bot checks out only
// this folder, and it reads the text of a pull request's notes as data. src/lib/notes.mjs reads the notes in a folder
// with it, for the build, `npm run check` and the proof tools. The rules are a guard, not proof: someone determined can
// word around them, which is why a note is reviewed like any other change and read as information, never as orders.
import { checkRules } from './rules.mjs';

/** A game's or a kit's notes folder and anything in it, however its capitals are written, the name a note's file has,
 *  and how much a whole note takes. */
export const NOTE_PATH = /^(?:games|kit)\/[^/]+\/notes(?:\/|$)/i;
export const NOTE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export const MOST_NOTE = 2000;

// where a note can be: directly in a notes folder, which only that spelling is
const NOTE_PLACE = /^(?:games|kit)\/[^/]+\/notes\/[^/]+$/;

const FORM = /^# (.+)\n\nAbout: (.+)\n\nProof: (.+)\n\n(\S[\s\S]*)$/;
const PROOF = /^#\d+$|^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MOST_NAME = 64, MOST_TITLE = 120, MOST_TEXT = 1500;

/** A note's parts, { title, about, proof, text }, or null when it doesn't have the note's form. */
export function parseNote(text) {
  const found = FORM.exec(String(text ?? '').replace(/\r\n/g, '\n').trim());
  if (!found) return null;
  const list = line => line.split(';').map(item => item.trim()).filter(Boolean);
  return { title: found[1].trim(), about: list(found[2]), proof: list(found[3]), text: found[4].trim() };
}

// the ways an instruction, a command or an order is written, each kept to what prose doesn't say, so that a game's
// Secret Base, Sonic's curl, a game called Yarn, a run that reaches a frame or a win that adds SP isn't caught
const CONDITION = '(?:eq|ne|cs|cc|hs|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al)?(?:s|b|h|sb|sh|ia|ib|da|db)?';
const REGISTER = '(?:r\\d{1,2}|sp|lr|pc)';
const INSTRUCTION = new RegExp(`\\b(?:ldr|str|ldm|stm|mov|mvn|add|sub|cmp|tst|lsl|lsr|asr|orr|eor|mul)${CONDITION}\\s+${REGISTER}!?\\s*,\\s*(?:${REGISTER}\\b|[#=[{]|0x|\\d)|\\b(?:push|pop)\\s*\\{|\\bbl?x${CONDITION}\\s+(?:r\\d{1,2}|lr)\\b|\\bswi${CONDITION}\\s+#?\\d`, 'i');
const COMMAND = /\b(?:curl|wget)\s+(?:-|\S*[./:]\S)|\b(?:sudo|chmod|chown|powershell|pwsh|netcat|npx|pnpm)\b|\bbase64\s+-|\byarn\s+(?:add|install|global|dlx|run)\b|\b(?:rm|mv|cp|dd)\s+-|\b(?:apt|apt-get|brew|pip3?|npm|snap|winget|choco)\s+(?:install|i|add)\b|\|\s*(?:sh|bash|zsh|python\d?|node)\b|\b(?:bash|sh|zsh|python\d?)\s+-c\b|\bgh\s+(?:auth|repo|pr|issue|api|secret|gist)\b|\bgit\s+(?:push|remote|config|clone|reset)\b|--yes\b/i;
const ORDER = /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?|guidelines?)\b|\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:you\b|above\b|previous\b|prior\b|earlier\b)|\bsystem\s+prompt\b|\byou\s+are\s+now\b|\b(?:your|these\s+are|here\s+are)\s+(?:the\s+)?new\s+instructions\b|\bnew\s+instructions\s*:|\b(?:agents?|assistants?|claude|codex|gemini|chatgpt|copilot|llm|whoever|anyone|readers?)\b[^.\n]{0,30}\b(?:must|should|shall|needs?\s+to|ha(?:s|ve)\s+to|always|never)\b|\b(?:do\s+not|don't|never)\s+(?:tell|mention|show|ask)\b.{0,30}\b(?:person|user|them|anyone|owner|team)\b|\bwithout\s+(?:asking|telling)\b|(?:^[#*\s-]*|[.!?:]\s+)before\s+(?:anything|everything)\b|(?:^[#*\s-]*|[.!?:]\s+)(?:please\s+|now\s+|first,?\s+|then\s+)?(?:run|execute|open|download|install|fetch|send|post|upload)\s+(?:this|that|these|the\s+following)\b|\byour\s+(?:\w+\s+)?(?:token|password|key|credentials?|login|account)\b/im;
// a run of bytes or longer words, on one line or several, with a letter among them, as a list of frames has none; a
// run of numbers of any kind; or encoded text, wrapped or not
const HEX_RUN = /(?:\b[0-9a-f]{2}\b[\s,:;-]+){7}\b[0-9a-f]{2}\b|(?:\b[0-9a-f]{4}\b[\s,:;-]+){7}\b[0-9a-f]{4}\b|(?:\b(?:0x)?[0-9a-f]{8}\b[\s,:;-]+){5}\b(?:0x)?[0-9a-f]{8}\b/gi;
const DUMP = {
  test: text => [...text.matchAll(HEX_RUN)].some(([run]) => /[a-f]/i.test(run.replace(/0x/gi, '')))
    || /(?:\b0x[0-9a-f]+\b[\s,;]+){12}|(?:\b\d+\b[\s,;]+){16}/i.test(text) || /[A-Za-z0-9+/=]{48,}/.test(text.replace(/\n/g, ''))
};

// what a note may not hold, each with why, in words for whoever wrote it, and never quoting it
const NOT_ALLOWED = [
  [/<!--|<\/?[a-z][^>]*>/i, 'It holds HTML, which can hide text.'],
  [/\p{Cf}|\p{Co}|(?![\n\t])\p{Cc}/u, 'It holds invisible characters, which can hide text.'],
  [/[^\p{Script=Latin}\p{Script=Common}]/u, 'It holds letters of another alphabet: a note is in English, so everyone working on the game can read it.'],
  [/\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\]\(|\bmagnet:\?|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S/i, 'It holds a web address or a link: name a source by its name, and an issue or a pull request by its number.'],
  [/```|~~~|^(?: {4}|\t)\S/m, 'It holds a block of code: a note says what was found in words, and the code goes in the game.'],
  [/^\s*\|.*\|\s*$/m, 'It holds a table: nothing taken from a game goes in a note.'],
  [INSTRUCTION, 'It holds an instruction from a game: say what the code does in words, as what `read` prints never leaves the computer.'],
  [DUMP, 'It holds a long run of numbers or encoded text: nothing taken from a game goes in a note.'],
  [COMMAND, 'It holds a command that changes the computer or someone\'s accounts: a note never asks anyone to run one.'],
  [/(?:^|[\s`'"(])(?:~\/|\/home\/|\/Users\/|\/etc\/|[A-Za-z]:\\)|\.ssh\b|\.env\b|\bauth\.json\b/m, 'It names a place on someone\'s computer: a note has no reason to.'],
  [ORDER, 'It gives orders to whoever reads it: a note says what was found, never what to do.'],
];
// what the bot's plain rules find, said before the note goes anywhere
const SHARED = { credential: 'something like a key, token or password', 'game-file': 'a link to a game file', 'rom-site': 'a site that shares game files', email: 'an email address', phone: 'a phone number' };

/** What's wrong with a note's file name, in words for whoever wrote it: nothing, when it keeps the rules. A name is
 *  printed for other people's agents like a note's text, so it can't give an order or a command either. */
export function nameProblems(name) {
  if (!NOTE_NAME.test(name) || name.length > MOST_NAME) return [`A note is a plain file named with lowercase letters, numbers and single dashes, ending in .md, in up to ${MOST_NAME} characters.`];
  const words = name.replace(/\.md$/, '').replace(/-/g, ' ');
  return ORDER.test(words) || COMMAND.test(words) ? ['Its file\'s name gives an order or a command: a name says what the note is about.'] : [];
}

/** Whether a file a pull request adds can be read as a note at all, by where it is and what it's called. */
export const canBeNote = path => NOTE_PLACE.test(path) && !nameProblems(path.split('/').at(-1)).length;

/** What's wrong with a note's text, in words for whoever wrote it: nothing, when it keeps the rules. Its length comes
 *  first, so nothing reads more than a note can hold, and a model reads every note whole. The rest reads it as the
 *  plain rules do, with letters made to look like others written as what they stand for. */
export function noteProblems(text) {
  const whole = String(text ?? '').replace(/\r\n/g, '\n');
  if (whole.length > MOST_NOTE) return [`It's ${whole.length} characters long, and a whole note takes ${MOST_NOTE}.`];
  const note = parseNote(whole);
  if (!note) return ['It needs a note\'s form: a line starting with # that says what was found, then About: and Proof: lines, then the text, each apart from the next by an empty line.'];
  const problems = [];
  if (note.title.length > MOST_TITLE) problems.push(`Its title is ${note.title.length} characters long, and the title of a note takes ${MOST_TITLE}.`);
  if (note.text.length > MOST_TEXT) problems.push(`Its text is ${note.text.length} characters long, and a note takes ${MOST_TEXT}.`);
  if (/^#{1,6}\s/m.test(note.text)) problems.push('Its text holds a heading, which can look like a note of its own or a message from someone else: a note\'s text is plain sentences.');
  if (!note.about.length) problems.push('It needs an About: line that says what it\'s about.');
  if (!note.proof.length || !note.proof.every(item => PROOF.test(item))) problems.push('Its Proof: line needs what proves it: the numbers of issues or pull requests, such as #156, or the names of recordings, with a ; between them.');
  const plain = whole.normalize('NFKC');
  for (const [pattern, why] of NOT_ALLOWED) if (pattern.test(plain)) problems.push(why);
  const { rule } = checkRules(whole, { where: 'pull-request', spam: false });
  if (SHARED[rule]) problems.push(`It holds ${SHARED[rule]}: everything in a note is public.`);
  return problems;
}

/** What the plain rules settle about a post and its notes: the verdicts they give, which can be one for its own text
 *  and one for its notes, so neither hides the other, and what's worth a model's look. The spam rule only reads the
 *  post's own text, since a game's notes can well talk about a casino and free spins. */
export function rulesFor(item, { spam }) {
  const notes = item.notes ?? [];
  const context = { author: item.author, where: item.where };
  const inText = checkRules(item.text, { ...context, spam });
  const inNotes = checkRules(notes.map(note => note.text).join('\n\n'), { ...context, spam: false });
  const verdicts = inText.key ? [{ key: inText.key, by: 'rules', rule: inText.rule }] : [];
  if (inNotes.key) {
    if (inNotes.key !== inText.key) verdicts.push({ key: inNotes.key, by: 'rules', rule: inNotes.rule });
  } else if (notes.some(note => noteProblems(note.text).length)) verdicts.push({ key: 'bad-note', by: 'rules', rule: 'note' });
  return { verdicts, hints: [...new Set([...inText.hints, ...inNotes.hints])] };
}
