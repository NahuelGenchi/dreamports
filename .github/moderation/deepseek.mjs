// The Dreamports bot's paid model (docs/MODERATION.md): DeepSeek V4.1 Flash, through DeepSeek's own API, asked only
// about the posts OpenCode's free models left waiting. It's a plain request that offers no tools, in a job that never
// runs OpenCode, and the same rules and post between markers go to it, so an answer counts only if it's one key from
// the fixed list. Nothing here logs a post, an answer or the key.
import { PROMPT, messageFor } from './model.mjs';
import { parseAnswer } from './verdicts.mjs';

const API = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK = 'deepseek/deepseek-flash';
const MINUTE = 60000;
// a refusal that stays the same for every post: a key that's wrong or revoked, or a balance that ran out
const STOP = [401, 402, 403];
const AGAIN = status => status === 429 || status >= 500;

// Asks DeepSeek, twice when it fails for a moment. It stops asking for the rest of the job when it's refused for good,
// after the checks it's allowed and after the time it's given, and what it doesn't ask about keeps waiting.
export function deepSeekAsker(key, { fetcher = fetch, timeout = 2 * MINUTE, budget = 15 * MINUTE, most = 30, pause = 10000 } = {}) {
  const started = Date.now();
  const tried = new Set();
  let asked = 0, down = !key;
  return {
    tried,
    async ask(post) {
      if (down || asked >= most || Date.now() - started > budget) return null;
      asked++;
      tried.add(DEEPSEEK);
      for (let attempt = 1; attempt <= 2; attempt++) {
        let why;
        try {
          const response = await fetcher(API, {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            signal: AbortSignal.timeout(timeout),
            body: JSON.stringify({
              model: 'deepseek-flash', stream: false, max_tokens: 4000,
              messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: messageFor(post) }]
            })
          });
          if (response.ok) {
            const answer = parseAnswer((await response.json()).choices?.[0]?.message?.content);
            if (answer) return { key: answer, model: DEEPSEEK };
            console.log(`${DEEPSEEK}: no verdict, since its answer wasn't a key.`);
            return null;
          }
          why = `DeepSeek answered ${response.status}`;
          if (!AGAIN(response.status)) {
            down = STOP.includes(response.status);
            console.log(`${DEEPSEEK}: no verdict, since ${why}.`);
            return null;
          }
        } catch (error) {
          why = error.name === 'TimeoutError' ? 'it timed out' : 'it couldn\'t be reached';
        }
        console.log(`${DEEPSEEK}: no verdict, since ${why}.`);
        if (attempt === 1) await new Promise(resolve => setTimeout(resolve, pause));
      }
      return null;
    }
  };
}
