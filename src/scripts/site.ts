const root = document.documentElement;

// Phone menu
const side = document.querySelector<HTMLElement>('.side');
const menuButton = document.querySelector<HTMLButtonElement>('.menu-btn');

if (side && menuButton) {
  const setOpen = (open: boolean) => {
    side.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? 'close' : 'menu';
  };

  menuButton.addEventListener('click', () => setOpen(!side.classList.contains('is-open')));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && side.classList.contains('is-open')) {
      setOpen(false);
      menuButton.focus();
    }
  });
}

// Light and dark. Light is the default; a dark choice is remembered on this device.
document.querySelector('.theme-btn')?.addEventListener('click', () => {
  const dark = root.dataset.theme !== 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#171612' : '#fcfbf8');
  try {
    if (dark) localStorage.setItem('dreamports:theme', 'dark');
    else localStorage.removeItem('dreamports:theme');
  } catch {}
});
