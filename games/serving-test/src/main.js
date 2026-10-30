// Marks each check on the page as passed or failed, with what it found.
function mark(check, passed, found) {
  const item = document.querySelector(`[data-check="${check}"]`);
  item.dataset.state = passed ? 'passed' : 'failed';
  if (found) item.append(`: ${found}`);
}

mark('style', getComputedStyle(document.documentElement).getPropertyValue('--served').trim() === 'yes');
mark('script', true);

const site = globalThis.dreamports;
mark('dreamports', typeof site?.unlock === 'function' && typeof site?.earned === 'function');
if (site) {
  const earned = await site.earned();
  mark('earned', earned !== null && typeof earned === 'object', JSON.stringify(earned));
} else {
  mark('earned', false);
}

try {
  const response = await fetch('/api/me');
  const answer = await response.json();
  if (!response.ok) mark('profile', false, answer.error ?? `status ${response.status}`);
  else mark('profile', true, answer.player ? `signed in as ${answer.player.name}` : 'nobody is signed in on this browser');
} catch {
  mark('profile', false, 'no answer, as with npm run preview, which has no profiles');
}
