/**
 * Audio worklet: turns the mic into one channel by PICKING a channel, never by mixing them.
 *
 * Some headset mics (Realtek chips among them) send two channels with one of them inverted or
 * nearly silent; summing them, as a plain downmix does, cancels part of the voice and leaves it
 * thin, "in a tunnel". This keeps the louder channel (smoothed energy, so it doesn't flip on every
 * syllable) and switches only when the other one is clearly louder for a while.
 *
 * Plain JS: worklets load as a separate file (see micProcessor.ts).
 */

/** Per 128-frame block (~2.7 ms at 48 kHz): ~0.3 s of memory. */
const SMOOTHING = 0.01
/** The other channel must be this many times stronger (energy, ~3 dB) to take over. */
const SWITCH_RATIO = 2

class ChannelPicker extends AudioWorkletProcessor {
  constructor() {
    super()
    this.energy = [0, 0]
    this.channel = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0][0]
    if (!input || input.length === 0 || !output) return true
    if (input.length > 1) {
      for (let c = 0; c < 2; c++) {
        const samples = input[c]
        let sum = 0
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
        this.energy[c] += SMOOTHING * (sum / samples.length - this.energy[c])
      }
      const other = 1 - this.channel
      if (this.energy[other] > this.energy[this.channel] * SWITCH_RATIO) this.channel = other
    }
    output.set(input[input.length > 1 ? this.channel : 0])
    return true
  }
}

registerProcessor('aureum-channel-picker', ChannelPicker)
