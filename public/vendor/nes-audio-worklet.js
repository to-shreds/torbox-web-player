// TorBox Games audio output. The emulator and this worklet are self-hosted.
class NesAudioOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 8192;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.readAt = 0;
    this.writeAt = 0;
    this.count = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'clear') { this.count = 0; this.readAt = this.writeAt; return; }
      if (data.type !== 'samples') return;
      const length = Math.min(data.left.length, data.right.length, this.capacity);
      const overflow = Math.max(0, this.count + length - this.capacity);
      this.readAt = (this.readAt + overflow) % this.capacity;
      this.count -= overflow;
      for (let i = 0; i < length; i++) {
        this.left[this.writeAt] = data.left[i];
        this.right[this.writeAt] = data.right[i];
        this.writeAt = (this.writeAt + 1) % this.capacity;
      }
      this.count += length;
    };
  }
  process(_, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      const available = this.count > 0;
      channels[0][i] = available ? this.left[this.readAt] : 0;
      if (channels[1]) channels[1][i] = available ? this.right[this.readAt] : 0;
      if (available) { this.readAt = (this.readAt + 1) % this.capacity; this.count--; }
    }
    return true;
  }
}
registerProcessor('torbox-nes-audio', NesAudioOutput);
