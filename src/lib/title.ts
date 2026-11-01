// A game's title as the site shows it: the word Dreamport in it stands out as a tag, a mark of what the game is.

/** The title's text and tags, taking turns: "Sonic Advance Dreamport" is "Sonic Advance ", "Dreamport" and "". */
export const titleParts = (title: string) => title.split(/\b(Dreamport)\b/);

/** Shows a game's title in `el`, for a title that's only known once the page runs. GameTitle.astro does the rest. */
export function showTitle(el: HTMLElement, title: string) {
  el.replaceChildren(
    ...titleParts(title).map((part, i) => (i % 2 ? Object.assign(document.createElement('span'), { className: 'dp-tag', textContent: part }) : part)),
  );
}
