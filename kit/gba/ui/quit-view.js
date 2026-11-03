// Quitting the game, a view of the settings (sheet.js): the question first, in the same sheet, with Back to the game
// picked, as what isn't saved goes with the game. Quit then leaves for dreamports.net.

const pixels = (w, h, d) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
const PLAY = pixels(4, 7, 'M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z');
const LEAVE = pixels(9, 9, 'M4 1h1v1H4zM3 2h1v1H3zM2 3h1v1H2zM1 4h7v1H1zM2 5h1v1H2zM3 6h1v1H3zM4 7h1v1H4z');

/** Adds the question to `sheet` as its view 'quit', which the settings' Quit the game button goes to. */
export function createQuitView(sheet) {
  const { el, body } = sheet.view('quit', {
    title: 'Are you sure you want to quit?',
    first: () => el.querySelector('.resume'),
  });
  body.classList.add('settings-body', 'quit-body');
  body.innerHTML = `
    <div class="settings-col sheet-rise">
      <p class="quit-note" id="quit-note">We advise saving your progress in the game first, if you haven't already. Anything not saved will be lost.</p>
      <button type="button" class="resume">${PLAY}Back to the game</button>
      <button type="button" class="quit" data-leave aria-describedby="quit-note">${LEAVE}Quit the game</button>
    </div>`;
  el.querySelector('.resume').addEventListener('click', () => sheet.close());
  el.querySelector('[data-leave]').addEventListener('click', () => sheet.quit());
}
