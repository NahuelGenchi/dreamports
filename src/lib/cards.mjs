// Whether a Dreamport's cards show the two numbers its proof/ folder makes, and each of its versions in other languages
// theirs (src/lib/languages.mjs) (docs/LIVE-SITE.md): its card in the Dreamports row, at /dreamports/<id>/, which shows
// a version at a time, the one Play opens, each in a block of its own under the numbers' plain names; its card in the
// Make row, at /make/<game>/, which shows them all, each in a block of its own under its language's name, the one Play
// opens first and the others folded under it (#1241); and its place in that row, at /make/. The build reads its own pages with this (src/integrations/live-site.mjs), and
// .github/live-site/watch.mjs reads dreamports.net's, so what's checked is what a visitor gets.
import { hasCode, isBeingMade, numbersText, pageOf, shortPercent } from './entries.mjs';
import { LANGUAGES, playOrder } from './languages.mjs';

const CODE = 'Code ported', GAMEPLAY = 'Gameplay proven';
const METER = /<span class="meter-head">\s*<span>([^<]+)<\/span>\s*<span class="meter-num">([^<]+)<\/span>\s*<\/span>\s*<span class="meter-bar"[^>]*>\s*<i style="width: ?([\d.]+)%/g;
// a version's block on a card, which holds no <div> of its own (src/components/InspectCard.astro, LanguageProgress.astro)
const BLOCK = /<div\b([^>]*\bdata-language="[^"]*"[^>]*)>([^]*?)<\/div>/g;

// a card as its page has it, or nothing when there's no such card
const cardIn = (html, card) => new RegExp(`<dialog\\b[^>]*\\bid="${card}"[^]*?</dialog>`).exec(html)?.[0];

// the meters in some of a page by their names, each with what it says and how far its bar fills
const metersIn = html => new Map([...html.matchAll(METER)].map(([, label, text, width]) => [label, { text, width: Number(width) }]));

// what's wrong with one of a card's two numbers
function meterProblem(meters, label, percent) {
  const meter = meters.get(label);
  if (!meter) return `has no ${label}`;
  const text = shortPercent(percent) ?? 'Not measured yet';
  if (meter.text !== text || meter.width !== (percent ?? 0)) return `shows ${label} ${meter.text} with its bar at ${meter.width}%, and its proof makes ${text} (${percent ?? 0}%)`;
  return null;
}

// a card's blocks, one per version, in the order the page has them, each with its language, whether it's hidden and its meters
const blocksIn = card => [...card.matchAll(BLOCK)].map(([, attributes, html]) => ({
  language: /\bdata-language="([^"]*)"/.exec(attributes)?.[1],
  hidden: /\shidden\b/.test(attributes),
  meters: metersIn(html),
}));

// what's wrong with a version's numbers in its own block, under their plain names, and with `also`, what else is wrong
// with the block
function blockProblems(blocks, versions, also = () => []) {
  return versions.flatMap(({ language, proof }) => {
    const block = blocks.find(block => block.language === language), name = LANGUAGES[language].name;
    if (!block) return [`has no numbers for its version in ${name}`];
    const wrong = [meterProblem(block.meters, CODE, proof?.ported?.percent), meterProblem(block.meters, GAMEPLAY, proof?.gameplay?.percent)]
      .filter(Boolean).map(what => (versions.length > 1 ? `${what}, for its version in ${name}` : what));
    return [...wrong, ...also(block, language)];
  });
}

// what's wrong with a card in the Make row, which shows every version's numbers, the one Play opens first and the
// others folded under it
function makeProblems(card, versions) {
  const blocks = blocksIn(card);
  const first = playOrder(versions.map(version => version.language))[0];
  const wrong = blockProblems(blocks, versions);
  const shown = blocks[0]?.language;
  if (shown && shown !== first && versions.some(version => version.language === shown)) {
    wrong.push(`shows the numbers of its version in ${LANGUAGES[shown].name} first, and Play opens the one in ${LANGUAGES[first].name}`);
  }
  return wrong;
}

// what's wrong with a card that shows a version at a time: each version's numbers in a block of its own, and only the
// block of the version Play opens first not hidden
function apartProblems(card, versions) {
  const first = playOrder(versions.map(version => version.language))[0];
  return blockProblems(blocksIn(card), versions, (block, language) => {
    const name = LANGUAGES[language].name;
    if (block.hidden && language === first) return [`hides the numbers of its version in ${name}, the one Play opens`];
    if (!block.hidden && language !== first) return [`shows the numbers of its version in ${name} at first, and Play opens the one in ${LANGUAGES[first].name}`];
    return [];
  });
}

/**
 * Everything wrong with what the pages show, as sentences, none when they show what each Dreamport's proof makes.
 * `dreamports` is [{ game, entry, language, proof, versions }], as tools/readme.mjs reads them, with `language` and `proof` its main
 * version's and `versions` as [{ language, proof }], and `read` gives a page's text from its
 * address, or null when there's no such page.
 */
export async function problemsWith(dreamports, read) {
  const pages = new Map();
  const page = path => {
    if (!pages.has(path)) pages.set(path, read(path));
    return pages.get(path);
  };
  const problems = [];
  for (const { game, entry, language = 'js', proof, versions = [] } of dreamports) {
    const id = pageOf(game);
    const making = isBeingMade(entry, proof);
    const all = [{ language, proof }, ...versions];
    const cards = [
      ...(hasCode(proof) ? [{ path: `/dreamports/${id}/`, card: `inspect-${id}`, where: 'in the Dreamports row', problemsOf: apartProblems }] : []),
      ...(making ? [{ path: `/make/${game}/`, card: `make-${id}`, where: 'in the Make row', problemsOf: makeProblems }] : []),
    ];
    for (const { path, card, where, problemsOf } of cards) {
      const html = await page(path);
      const found = html && cardIn(html, card);
      const wrong = !html ? ['has no page'] : !found ? ['isn\'t on its page'] : problemsOf(found, all).filter(Boolean);
      problems.push(...wrong.map(what => `${path}: ${entry.title}'s card ${where} ${what}.`));
    }
    if (making) {
      const row = await page('/make/');
      const shown = row ? [...row.matchAll(new RegExp(`<a\\b[^>]*\\bdata-card="make-${id}"[^>]*\\bdata-numbers="([^"]*)"`, 'g'))].map(match => match[1]) : [];
      const numbers = numbersText(proof);
      if (!shown.length) problems.push(`/make/: ${entry.title} has no numbers in the Make row.`);
      for (const text of new Set(shown)) {
        if (text !== numbers) problems.push(`/make/: ${entry.title}'s place in the Make row says "${text}", and its proof makes "${numbers}".`);
      }
    }
  }
  return problems;
}
