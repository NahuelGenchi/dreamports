// A preview's stand-in for dreamports.net's /dreamports.js (public/dreamports.js), put there by
// `npm run dp -- share` (tools/README.md). A preview runs on its author's own GitHub Pages address, never on
// dreamports.net, so there's no profile to save achievements to: unlock(id) and earned() answer as they do on
// dreamports.net for a player who isn't signed in, and the game keeps what this device earned, here only. It also
// says, at the top of every page, that the preview hasn't been reviewed, until the player closes the notice.
(() => {
  const PREVIEW = {};   // share fills in { author, page }: who made the preview, and its own page

  globalThis.dreamports = Object.freeze({
    unlock: async () => false,
    earned: async () => ({}),
  });

  function show() {
    const host = document.createElement('div');
    // in a shadow root of its own, so the game's styles don't change it
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483647; top: 8px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 16px)); }
      aside { display: flex; gap: 10px; align-items: flex-start; box-sizing: border-box; padding: 9px 10px 9px 12px; border: 2px solid #8a6a00; border-radius: 4px;
        background: #fff3c4; color: #2a1f00; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
      p { margin: 0; flex: 1; }
      a { color: inherit; font-weight: 600; }
      button { flex: none; width: 26px; height: 26px; margin: -3px -4px 0 0; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; font: 20px/1 system-ui, sans-serif; cursor: pointer; }
      button:hover, button:focus-visible { background: rgba(42, 31, 0, 0.12); }
    </style><aside role="note" aria-label="Unreviewed preview"><p></p><button type="button" aria-label="Close" title="Close">×</button></aside>`;
    const text = root.querySelector('p');
    text.append(`A preview by ${PREVIEW.author}, not reviewed by the Dreamports team. Play it only if you trust ${PREVIEW.author}. `);
    const more = document.createElement('a');
    more.href = PREVIEW.page;
    more.textContent = 'About this preview';
    text.append(more);
    root.querySelector('button').addEventListener('click', () => host.remove());
    document.body.append(host);
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show, { once: true });
})();
