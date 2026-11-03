// Whether a Dreamport's cards show the two numbers its proof/ folder makes (docs/LIVE-SITE.md): its card in the
// Dreamports row, at /dreamports/<id>/, its card in the Make row, at /make/<game>/, and its place in that row, at
// /make/. The build reads its own pages with this (src/integrations/live-site.mjs), and .github/live-site/watch.mjs
// reads dreamports.net's, so what's checked is what a visitor gets.
import { hasCode, isBeingMade, numbersText, pageOf, shortPercent } from './entries.mjs';

const CODE = 'Code ported', GAMEPLAY = 'Gameplay proven';
const METER = /<span class="meter-head">\s*<span>([^<]+)<\/span>\s*<span class="meter-num">([^<]+)<\/span>\s*<\/span>\s*<span class="meter-bar"[^>]*>\s*<i style="width: ?([\d.]+)%/g;

// a card's meters by their names, each with what it says and how far its bar fills, or nothing when there's no such card
function metersIn(html, card) {
  const found = new RegExp(`<dialog\\b[^>]*\\bid="${card}"[^]*?</dialog>`).exec(html)?.[0];
  return found && new Map([...found.matchAll(METER)].map(([, label, text, width]) => [label, { text, width: Number(width) }]));
}

// what's wrong with one of a card's two numbers
function meterProblem(meters, label, percent) {
  const meter = meters.get(label);
  if (!meter) return `has no ${label}`;
  const text = shortPercent(percent) ?? 'Not measured yet';
  if (meter.text !== text || meter.width !== (percent ?? 0)) return `shows ${label} ${meter.text} with its bar at ${meter.width}%, and its proof makes ${text} (${percent ?? 0}%)`;
  return null;
}

/**
 * Everything wrong with what the pages show, as sentences, none when they show what each Dreamport's proof makes.
 * `dreamports` is [{ game, entry, proof }], as tools/readme.mjs reads them, and `read` gives a page's text from its
 * address, or null when there's no such page.
 */
export async function problemsWith(dreamports, read) {
  const pages = new Map();
  const page = path => {
    if (!pages.has(path)) pages.set(path, read(path));
    return pages.get(path);
  };
  const problems = [];
  for (const { game, entry, proof } of dreamports) {
    const id = pageOf(game);
    const making = isBeingMade(entry, proof);
    const cards = [
      ...(hasCode(proof) ? [{ path: `/dreamports/${id}/`, card: `inspect-${id}`, where: 'in the Dreamports row' }] : []),
      ...(making ? [{ path: `/make/${game}/`, card: `make-${id}`, where: 'in the Make row' }] : []),
    ];
    for (const { path, card, where } of cards) {
      const html = await page(path);
      const meters = html && metersIn(html, card);
      const wrong = !html ? ['has no page']
        : !meters ? ['isn\'t on its page']
          : [meterProblem(meters, CODE, proof?.ported?.percent), meterProblem(meters, GAMEPLAY, proof?.gameplay?.percent)].filter(Boolean);
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
