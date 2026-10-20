/**
 * Audio worklet: the manual sensitivity ("Sensibilidade manual"). Below the threshold the mic goes
 * silent; it opens fast, stays open a moment after the voice drops (so word endings aren't cut) and
 * closes with a short fade (no clicks). With no threshold it lets everything through.
 *
 * On request it also reports the level it receives (before gating), for the meter in Configurações.
 * Messages in: { threshold: linear RMS, 0 = always open } and { report: boolean }.
 * Messages out: { level: peak RMS since the last report, open: boolean }, about 20 times a second.
 *
 * Plain JS: worklets load as a separate file (see micProcessor.ts).
 */

const HOLD_S = 0.3
const ATTACK_S = 0.005
const RELEASE_S = 0.05
const REPORT_EVERY_S = 0.05

class VoiceGate extends AudioWorkletProcessor {
  constructor() {
    super()
    this.threshold = 0
    this.report = false
    this.gain = 1
    this.holdLeft = HOLD_S
    this.peak = 0
    this.sinceReport = 0
    this.port.onmessage = ({ data }) => {
      if (typeof data.threshold === 'number') this.threshold = data.threshold
      if (typeof data.report === 'boolean') this.report = data.report
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0][0]
    if (!input || !output) return true

    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    const blockS = input.length / sampleRate

    if (this.threshold <= 0 || rms >= this.threshold) this.holdLeft = HOLD_S
    else this.holdLeft = Math.max(0, this.holdLeft - blockS)
    const open = this.holdLeft > 0
    const target = open ? 1 : 0
    const step = 1 / ((target > this.gain ? ATTACK_S : RELEASE_S) * sampleRate)
    for (let i = 0; i < input.length; i++) {
      this.gain = target > this.gain ? Math.min(target, this.gain + step) : Math.max(target, this.gain - step)
      output[i] = input[i] * this.gain
    }

    if (this.report) {
      this.peak = Math.max(this.peak, rms)
      this.sinceReport += blockS
      if (this.sinceReport >= REPORT_EVERY_S) {
        this.port.postMessage({ level: this.peak, open })
        this.peak = 0
        this.sinceReport = 0
      }
    }
    return true
  }
}

registerProcessor('aureum-voice-gate', VoiceGate)
