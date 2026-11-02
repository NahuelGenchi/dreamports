// The browser shows a link's address in a bubble while the pointer is over it, which has no place on a launcher's own
// controls (#213). So once this runs, every way around the site keeps its address in data-href instead of href, and
// goes on working as a link: pressed, with Enter, or in a new tab with a modifier or the middle button. A link that
// leaves the site keeps its href and its bubble, which shows where it goes, and without JavaScript they're all plain links.
const CONTROLS = 'a.slot, a[href^="/"]:not([download]), a[href^="#"]';

/** Where a control or a link goes. */
export const hrefOf = (a: Element) => a.getAttribute('data-href') ?? a.getAttribute('href');

/** Makes `a` a control that goes to `href`. */
export function control(a: HTMLElement, href: string) {
  a.removeAttribute('href');
  a.dataset.href = href;
  if (!a.hasAttribute('role')) a.setAttribute('role', 'link');
  if (!a.hasAttribute('tabindex')) a.tabIndex = 0;
}

for (const root of [document, ...[...document.querySelectorAll('template')].map((template) => template.content)]) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(CONTROLS)) control(a, a.getAttribute('href')!);
}

const controlOf = (e: Event) => (e.target as Element).closest?.<HTMLElement>('a[data-href]');

// What a link does by itself when it's pressed, unless the launcher has already taken care of the press. These listen
// on the window, so they hear it last.
addEventListener('click', (e) => {
  const a = controlOf(e);
  if (!a || e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(a.dataset.href, '_blank');
  else location.assign(a.dataset.href!);
});
addEventListener('auxclick', (e) => {
  const a = controlOf(e);
  if (a && e.button === 1 && !e.defaultPrevented) window.open(a.dataset.href, '_blank');
});
addEventListener('keydown', (e) => {
  const a = controlOf(e);
  if (!a || e.key !== 'Enter' || e.repeat || e.defaultPrevented) return;
  e.preventDefault();
  a.click();
});
