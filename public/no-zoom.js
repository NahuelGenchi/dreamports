// Dreamports is a launcher, not a page, so nothing here zooms. Every page of the site and of the games loads this. With
// the viewport tag, which Safari can ignore, and `touch-action` in the styles, it stops every way of zooming that a page
// can stop. A browser's own menu and a device's zoom for low vision stay out of any page's reach.
(() => {
  const stop = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  const options = { capture: true, passive: false };
  // a pinch in Safari
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(type, stop, options);
  // a pinch on a touch screen: a second finger, which the games' touch buttons hear as pointers all the same
  for (const type of ['touchstart', 'touchmove']) {
    addEventListener(type, (e) => {
      if (e.touches.length > 1) stop(e);
    }, options);
  }
  // a pinch on a trackpad, and Ctrl or Cmd with the wheel
  addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) stop(e);
  }, options);
  // Ctrl or Cmd with plus, minus or zero
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['+', '=', '-', '_', '0'].includes(e.key)) stop(e);
  }, options);
})();
