// The Dreamports bot's plain rules (docs/MODERATION.md). They settle what they can without the model: a post with
// a credential, a game file, a link to a site that shares game files, obvious spam or someone's private details, and
// a post with nothing in it to look at twice. Whatever they leave goes to the model, with hints of what they noticed.
// They only read the post's text, as data.
import { readFileSync } from 'node:fs';

// the sites that share game files, one domain per line in rom-sites.txt
export const ROM_SITES = readFileSync(new URL('./rom-sites.txt', import.meta.url), 'utf8')
  .split('\n').map(line => line.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean);

// sites whose links need no second look: GitHub, dreamports.net, and the references people making Dreamports use
const KNOWN_SITES = [
  'github.com', 'githubusercontent.com', 'githubassets.com', 'github.blog', 'dreamports.net', 'npmjs.com', 'nodejs.org',
  'developer.mozilla.org', 'wikipedia.org', 'youtube.com', 'youtu.be', 'cloudflare.com', 'mgba.io', 'opencode.ai',
  'astro.build', 'typescriptlang.org', 'w3.org', 'web.dev', 'caniuse.com', 'stackoverflow.com', 'shields.io', 'tcrf.net',
  'sonicretro.org', 'decomp.me', 'problemkaputt.de', 'gbadev.net', 'coranac.com', 'example.com', 'example.org', 'example.net'
];

// the endings of game files: ROMs, disc images, saves and save states. Endings other files share, such as .bin, .md
// or .img, are left to the model.
const GAME_ENDINGS = new Set([
  'gba', 'gb', 'gbc', 'nds', 'dsi', '3ds', 'cia', 'nes', 'fds', 'sfc', 'smc', 'n64', 'z64', 'v64', 'ndd', 'gcm', 'gcz',
  'rvz', 'wbfs', 'wad', 'wud', 'wux', 'nsp', 'nsz', 'xci', 'xcz', 'gen', 'smd', '32x', 'gg', 'sms', 'cdi', 'gdi', 'chd',
  'iso', 'cso', 'pbp', 'cue', 'mds', 'mdf', 'nrg', 'ccd', 'a26', 'a78', 'lnx', 'j64', 'pce', 'ngp', 'rom', 'sav', 'srm',
  'dsv', 'mcr'
]);
const ARCHIVE_ENDINGS = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'xz', 'bz2']);
// how ROM sets name their files, such as "Sonic Battle (USA)", "(En,Fr,De)", "(Rev 1)" or "[!]", or the word rom
const ROM_NAME = /\((?:usa|europe|japan|world|u|e|j|ue|ju|eu|en(?:,[a-z]{2})+|rev ?\d+|unl|proto|beta)\)|\[(?:!|[abfhot]\d*)\]|(?:^|[^a-z])(?:roms?|romsets?|no-?intro|redump)(?:[^a-z]|$)/i;

// web addresses, written as links, pictures, attachments or bare www. addresses. They may hold brackets, as in
// "Sonic Battle (USA).zip", so a closing bracket that opens nowhere in the address ends it, as in [text](address).
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"'`[\]{}|\\^]+/gi;

const CREDENTIALS = [
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:proj-|ant-(?:api\d\d-)?)?[A-Za-z0-9_-]{32,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\b[rs]k_live_[A-Za-z0-9]{20,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bhf_[A-Za-z0-9]{30,}\b/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/,
  /discord(?:app)?\.com\/api\/webhooks\/\d{5,}\/[A-Za-z0-9_-]{20,}/
];

// phrases that only spam uses. One alone isn't enough: it takes two, or one with a phone number or a link to an
// unknown site.
const SPAM = [
  /\bcustomer\s+(?:service|support|care)\s+(?:number|phone|helpline|line)\b/i,
  /\bhelp ?line\s+(?:number|no\b)/i,
  /\btoll[\s-]?free\b/i,
  /\b(?:quickbooks|expedia|cash\s?app|coinbase|binance|metamask|trust\s?wallet)\b.{0,40}\b(?:support|helpline|number|refund|recovery)\b/i,
  /\b(?:airlines?|flights?)\s+(?:reservations?|booking|tickets?)\s+(?:number|phone|desk)\b/i,
  /\bonline\s+casino\b|\bcasino\s+(?:bonus|online)\b|\bfree\s+spins\b|\bsports?\s+betting\b|\bbetting\s+(?:tips|sites?)\b/i,
  /\bslot\s+(?:gacor|online|deposit)\b|\bsitus\s+slot\b|\btogel\b|\bjudi\s+online\b|\blink\s+alternatif\b/i,
  /\b(?:viagra|cialis|levitra)\b/i,
  /\b(?:escort|call\s?girls?)\s+(?:service|agency)\b/i,
  /\bonlyfans\b/i,
  /\b(?:crypto|bitcoin|btc|usdt)\s+(?:giveaway|doubling|investment\s+plan|recovery|mining\s+pool)\b/i,
  /\bforex\s+(?:signals|trading\s+account)\b/i,
  /\bbuy\s+(?:(?:instagram|youtube|tiktok|twitter)\s+)?(?:followers|likes|subscribers|views)\b/i,
  /\bseo\s+services?\b|\bbacklinks?\s+(?:service|package)s?\b/i,
  /\bessay\s+writing\s+service\b|\bwrite\s+my\s+essay\b/i,
  /\bfree\s+(?:robux|v-?bucks|gift\s+cards?)\b|\bgift\s+card\s+generator\b/i,
  /\bhack\s+(?:any\s+)?(?:instagram|facebook|whatsapp|snapchat|tiktok)\s+accounts?\b/i,
  /\bmake\s+money\s+(?:online|fast)\b|\bearn\s+\$?\d+k?\s+(?:per|a)\s+(?:day|week)\b/i,
  /\bwork\s+from\s+home\s+(?:jobs?|opportunit)/i,
  /\bpayday\s+loans?\b|\binstant\s+loans?\b/i,
  /\bweight\s+loss\s+(?:pills|supplements?)\b|\bketo\s+(?:pills|gummies)\b|\bcbd\s+gummies\b/i,
  /\bmod\s+apk\b|\bapk\s+(?:download|free)\b/i
];

// words that don't break a rule on their own, but are worth a second look, each with the hint it gives the model
const HINTS = [
  ['getting-games', /\b(?:download|get|find|share|send|upload)\w*\s+(?:me\s+)?(?:the\s+|a\s+|your\s+|this\s+)?(?:roms?|isos?|game\s+files?|dumps?)\b|\broms?\s+(?:download|link|site|file)s?\b|\bwhere\s+(?:can|do|could|did)\s+(?:i|we|you)\s+(?:get|find|download)\b|\b(?:anyone|somebody|someone)\s+(?:have|has|got)\s+(?:the|a)\s+(?:rom|copy|iso|dump)\b/i],
  ['getting-games', /\b(?:descarg|baj)\w*\s+(?:el\s+|la\s+|los\s+)?(?:roms?|isos?|juegos?)\b|\bd[oó]nde\s+(?:puedo\s+|se\s+puede\s+)?(?:conseguir|descargar|bajar|encontrar)\b|\bp[aá]s[ae]me\s+(?:el\s+|la\s+)?(?:rom|iso|juego)\b/i],
  ['file-hosts', /\b(?:torrent|magnet:\?|mega\.nz|mediafire|1fichier|rapidgator|zippyshare|gofile\.io|pixeldrain|krakenfiles|drive\.google\.com|dropbox\.com|wetransfer|anonfiles)\b/i],
  ['piracy', /\b(?:pirat(?:e|ed|es|ing)|warez|cracked|keygen|prod\.keys|title\.keys|bios\s+(?:download|file|link))\b/i],
  ['abuse', /\b(?:kill\s+yourself|kys|retard(?:ed|s)?|fag(?:got)?s?|n[i1]gg(?:er|a)s?|tranny|whore|cunt|puta|puto|maric[oó]n|pendejo|subnormal)\b/i],
  ['talks-to-the-bot', /\bignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)\b|\bsystem\s+prompt\b|\bjailbreak|\b(?:dreamports|moderation)\s+bot\b|\byou\s+are\s+now\b|\bnew\s+instructions\b|\bdisregard\s+(?:all|your|the)\b/i],
  ['private-details', /\b(?:my|his|her|their)\s+(?:home\s+)?address\s+is\b|\bpassport\b|\bsocial\s+security\b|\b(?:ssn|dni|cpf|curp)\b|\bdate\s+of\s+birth\b|\bcredit\s+card\b/i],
  ['secret', /\b(?:password|passwd|api[_-]?key|secret|token|client[_-]?secret)\s*[:=]\s*["']?(?![$<{*]|x{4}|your|process\.env|secrets\.)[^\s"'<>]{8,}/i],
  ['rights', /\b(?:dmca|takedown|cease\s+and\s+desist|copyright\s+(?:infringement|holder|owner)|rights?\s+holders?|infring\w*|legal\s+action)\b/i]
];

const under = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const decode = path => { try { return decodeURIComponent(path); } catch { return path; } };

// undoes the usual disguises: full-width letters, invisible characters, "[.]", "(dot)", "[at]" and hxxp://
export function normalize(text) {
  return String(text ?? '').normalize('NFKC')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/gi, '.')
    .replace(/\s*[[({]\s*(?:@|at)\s*[\])}]\s*/gi, '@')
    .replace(/(?<=[a-z0-9])\s+dot\s+(?=[a-z]{2,}\b)/gi, '.')
    .replace(/\bhxxp(s?):\/\//gi, 'http$1://');
}

// every web address in a post, with its site and its path
export function linksIn(text) {
  const links = [];
  for (const [raw] of text.matchAll(ADDRESS)) {
    let href = raw;
    for (let end = null; end !== href;) {
      end = href;
      href = href.replace(/[.,;:!?*_~]+$/, '');
      if (href.endsWith(')') && href.split(')').length > href.split('(').length) href = href.slice(0, -1);
    }
    try {
      const url = new URL(/^www\./i.test(href) ? `https://${href}` : href);
      links.push({ host: url.hostname.toLowerCase().replace(/\.$/, ''), path: decode(url.pathname) });
    } catch {
      // not an address after all
    }
  }
  return links;
}

const fileNameOf = link => link.path.split('/').filter(Boolean).pop() ?? '';

// a game file's name: a ROM, disc image or save, or an archive named like one, such as "Sonic Battle (USA).zip"
export function isGameFile(name) {
  const parts = name.toLowerCase().split('.');
  if (parts.length < 2) return false;
  const ending = parts.at(-1);
  if (GAME_ENDINGS.has(ending) || /^ss\d$/.test(ending)) return true;
  if (!ARCHIVE_ENDINGS.has(ending)) return false;
  return parts.slice(1, -1).some(part => GAME_ENDINGS.has(part)) || ROM_NAME.test(parts.slice(0, -1).join('.'));
}

// a file someone attached to a post on GitHub, and a picture or video
const isAttachment = link => link.host === 'github.com' && /^\/(?:user-attachments\/files|[^/]+\/[^/]+\/files)\/\d+\//.test(link.path);
const isMedia = link => (link.host === 'github.com' && link.path.startsWith('/user-attachments/assets/'))
  || /(?:^|\.)user-images\.githubusercontent\.com$/.test(link.host) || /\.(?:png|jpe?g|gif|webp|mp4|webm|mov)$/i.test(link.path);
// a path about ROMs on a known site, such as a repository named gba-roms, except in a fork of Dreamports
const isRomish = link => !/^\/[^/]+\/dreamports(?:\/|$)/i.test(link.path)
  && /(?:^|[^a-z])(?:roms?|romsets?|no-?intro|redump|isos)(?:[^a-z]|$)/i.test(link.path);

const SITE_PATTERNS = new Map(ROM_SITES.map(site => [site, new RegExp(`(?<![a-z0-9-])${site.replace(/[.]/g, '\\.')}(?![a-z0-9-])`, 'i')]));
// a site that shares game files, linked or written out, such as "romsfun.com/sonic"
function romSiteIn(text, links) {
  for (const link of links) if (ROM_SITES.some(site => under(link.host, site))) return true;
  for (const pattern of SITE_PATTERNS.values()) if (pattern.test(text)) return true;
  return false;
}

const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.[a-z]{2,24}(?![a-z0-9-])/gi;
// an address that isn't anyone's private one: GitHub's noreply ones, the project's own, examples, git's SSH user, and
// file names such as icon@2x.png
function isPublicAddress(address) {
  const [user, domain] = address.toLowerCase().split('@');
  return under(domain, 'noreply.github.com') || under(domain, 'dreamports.net') || /^(?:no-?reply|do-?not-?reply)$/.test(user)
    || ['example.com', 'example.org', 'example.net'].some(d => under(domain, d)) || /\.(?:example|test|invalid|localhost)$/.test(domain)
    || (user === 'git' && /^(?:github\.com|gitlab\.com|bitbucket\.org)$/.test(domain))
    || /\.(?:png|jpe?g|gif|svg|webp|avif|js|mjs|cjs|ts|json|md|css|html?|txt|mp4|webm|zip|gz|tgz)$/.test(domain);
}
export const emailsIn = text => [...text.matchAll(EMAIL)].map(m => m[0]).filter(address => !isPublicAddress(address));

const digits = number => number.replace(/\D/g, '').length;
// phone numbers written to be called: with a country code, toll-free, or next to a word such as phone or WhatsApp,
// but not a date
export function phonesIn(text) {
  const found = [];
  for (const [n] of text.matchAll(/(?<![\w+/.=-])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,6}(?![\w/-]|\.\w)/g)) if (digits(n) >= 8 && digits(n) <= 15) found.push(n);
  for (const [n] of text.matchAll(/(?<![\w.-])(?:\+?1[ .-]?)?\(?8(?:00|33|44|55|66|77|88)\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d|[.-]\d)/g)) found.push(n);
  for (const m of text.matchAll(/\b(?:phone|tel|telephone|whats\s?app|mobile|cell(?:phone)?|call\s+me|text\s+me|celular|tel[eé]fono|m[oó]vil)\b\D{0,15}?(\+?\d[\d ().-]{6,20}\d)/gi)) {
    if (digits(m[1]) >= 7 && digits(m[1]) <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(m[1].trim())) found.push(m[1]);
  }
  return found;
}

// a key, token or password in a known format, but not a placeholder such as ghp_xxxx
export function credentialIn(text) {
  for (const pattern of CREDENTIALS) {
    const found = pattern.exec(text)?.[0];
    if (found && !/x{6}|0{8}|\*{4}|\.{3}|your|example|redacted/i.test(found) && new Set(found).size >= 10
      && (/\d/.test(found) || found.startsWith('-----'))) return true;
  }
  return false;
}

// What the plain rules make of a post. key is the verdict when a rule settles it, with rule naming the rule; with no
// key, hints lists what's worth the model's look, and a post with no hints keeps the rules. context gives the post's
// author, whose own previews on GitHub Pages need no second look, where it is (issue, pull-request, discussion or
// progress-thread), and spam: false to leave out the spam rule, for the repository's own people.
export function checkRules(text, context = {}) {
  const plain = normalize(String(text ?? '').slice(0, 100000));
  const links = linksIn(plain);
  const settled = (key, rule) => ({ key, rule, hints: [] });
  if (credentialIn(plain)) return settled('credential', 'credential');
  if (links.some(link => isGameFile(fileNameOf(link)))) return settled('game-files', 'game-file');
  if (romSiteIn(plain, links)) return settled('rom-site', 'rom-site');

  const own = context.author ? `${context.author.toLowerCase()}.github.io` : null;
  const unknown = [...new Set(links.filter(link => link.host !== own && !KNOWN_SITES.some(site => under(link.host, site))).map(link => link.host))];
  const phones = phonesIn(plain), emails = emailsIn(plain);
  const spam = SPAM.filter(pattern => pattern.test(plain)).length;
  if (context.spam !== false && (spam >= 2 || (spam && (phones.length || unknown.length)))) return settled('spam', 'spam');
  if (emails.length) return settled('personal-data', 'email');
  if (phones.length) return settled('personal-data', 'phone');

  const hints = unknown.slice(0, 5).map(host => `link:${host}`);
  for (const link of links) if (!unknown.includes(link.host) && link.host !== own && isRomish(link)) hints.push(`rom-path:${link.host}`);
  if (links.some(link => isAttachment(link))) hints.push('attachment');
  if (links.some(isMedia) && /\boriginal\b/i.test(plain) && (context.where === 'issue' || context.where === 'discussion')) hints.push('picture-and-original');
  if (spam) hints.push('spam-words');
  for (const [hint, pattern] of HINTS) if (pattern.test(plain)) hints.push(hint);
  if (new Set(plain.match(/(?<![\w@])@[a-z0-9][a-z0-9-]{0,38}/gi)).size >= 5) hints.push('mentions');
  return { key: null, rule: null, hints: [...new Set(hints)] };
}
