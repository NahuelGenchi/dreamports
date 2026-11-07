// Dreamports is a launcher, not a page, so the stage and canvas don't zoom.
// Open modal dialogs remain pinch-zoomable for accessibility (WCAG 1.4.4).
(() => {
  const isZoomableTextSurface = (target) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('dialog[open], .view, .card-about, .card-profile, .card-inspect, .card-make')
    );
  };

  const stop = (e) => {
    if (isZoomableTextSurface(e.target)) return;
    if (e.cancelable) e.preventDefault();
  };

  const options = { capture: true, passive: false };
  // a pinch in Safari
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(type, stop, options);
  // a pinch on a touch screen: a second finger, which the games' touch controls don't use
  for (const type of ['touchstart', 'touchmove']) {
    addEventListener(
      type,
      (e) => {
        if (e.touches && e.touches.length > 1) stop(e);
      },
      options
    );
  }
  // a pinch on a trackpad, and Ctrl or Cmd with the wheel
  addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) stop(e);
    },
    options
  );
  // Ctrl or Cmd with plus, minus or zero
  addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['+', '=', '-', '_', '0'].includes(e.key))
        stop(e);
    },
    options
  );

  // Sync .has-gamepad on #launcher so touch devices hide keycap badges until a controller connects
  const syncGamepadState = () => {
    const launcher = document.getElementById('launcher');
    if (!launcher || typeof navigator.getGamepads !== 'function') return;
    const pads = Array.from(navigator.getGamepads()).filter(Boolean);
    launcher.classList.toggle('has-gamepad', pads.length > 0);
  };
  addEventListener('gamepadconnected', syncGamepadState);
  addEventListener('gamepaddisconnected', syncGamepadState);
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', syncGamepadState, { once: true });
  } else {
    syncGamepadState();
  }
})();
