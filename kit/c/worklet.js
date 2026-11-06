// The sound of a game in C on a console with no kit in C of its own (game.js), on its own audio thread: the samples each
// of the game's frames made, played as they come, at the console's rate. Where the browser plays at another rate, each
// sample is found on a straight line between the two nearest. A game that stalls leaves silence, and one that catches up
// in a hurry has what it made beyond a fifth of a second dropped, so the sound never falls behind the picture.

class DreamportsCSound extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];      // [left, right] lists of samples, oldest first
    this.at = 0;          // where the oldest has got to, in its own samples
    this.queued = 0;      // how many samples are waiting, the oldest's played ones too
    this.step = 1;        // the game's samples to a sample of the output
    this.gain = 0;
    this.port.onmessage = ({ data }) => {
      try { this.message(data); } catch (err) { this.port.postMessage({ type: 'error', message: String(err?.stack ?? err) }); }
    };
  }

  message(data) {
    if (data.type === 'start') {
      this.step = data.rate / sampleRate;
      this.most = Math.ceil(data.rate / 5);
      this.gain = data.gain;
    } else if (data.type === 'samples') {
      if (!data.left.length) return;
      this.queue.push([data.left, data.right]);
      this.queued += data.left.length;
      while (this.queued - this.at > this.most && this.queue.length > 1) {
        this.queued -= this.queue.shift()[0].length;
        this.at = 0;
      }
    } else if (data.type === 'gain') this.gain = data.value;
  }

  // the game's sample `index` samples on from the oldest's first, on side `side`: the last there is past the end
  sample(index, side) {
    for (const part of this.queue) {
      if (index < part[side].length) return part[side][index];
      index -= part[side].length;
    }
    const last = this.queue.at(-1)[side];
    return last[last.length - 1];
  }

  process(inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (!this.queue.length) { left[i] = right[i] = 0; continue; }
      const whole = Math.floor(this.at), part = this.at - whole;
      const l = this.sample(whole, 0), r = this.sample(whole, 1);
      left[i] = (l + (this.sample(whole + 1, 0) - l) * part) * this.gain;
      right[i] = (r + (this.sample(whole + 1, 1) - r) * part) * this.gain;
      this.at += this.step;
      while (this.queue.length && this.at >= this.queue[0][0].length) {
        const done = this.queue.shift()[0].length;
        this.at -= done;
        this.queued -= done;
      }
    }
    return true;
  }
}

registerProcessor('dp-c-sound', DreamportsCSound);
