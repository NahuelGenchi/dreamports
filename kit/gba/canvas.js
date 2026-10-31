// Every 2D canvas the game makes keeps its pixels in memory, not on the GPU (willReadFrequently). A game that
// reads its screen back for effects it works out pixel by pixel, such as fades, makes the browser move that canvas
// to memory, and from then on every tile and sprite drawn onto it from a canvas still on the GPU is read back from
// the GPU on its own: a frame takes far longer than a 60th of a second. With every canvas in memory nothing is
// read back from the GPU, and the pixels are the same. The game's page imports it before anything else makes a
// canvas.

const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  return getContext.call(this, type, type === '2d' ? { willReadFrequently: true, ...options } : options);
};
