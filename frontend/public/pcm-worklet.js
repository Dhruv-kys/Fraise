class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 1024;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
      while (this._buf.length >= this._target) {
        const slice = this._buf.splice(0, this._target);
        const pcm = new Int16Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          const s = Math.max(-1, Math.min(1, slice[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm, [pcm.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
