
// We need to declare the AudioWorkletProcessor abstract class as it's not in the DOM lib by default in all contexts, 
// though 'lib': ['AudioWorklet'] in tsconfig helps.
// To be safe and clean, we assume the environment provides it.

interface ADSR {
    a: number; // Attack time (seconds)
    d: number; // Decay time (seconds)
    s: number; // Sustain level (0-1)
    r: number; // Release time (seconds)
}

interface Voice {
    active: boolean;
    note: number;
    phase: number; // Phase in the wavetable (0-31.99)
    phaseStep: number; // How much to increment phase per sample

    // Envelope state
    envState: 'IDLE' | 'ATTACK' | 'DECAY' | 'SUSTAIN' | 'RELEASE';
    envTime: number; // Time spent in current state (samples)
    envLevel: number; // Current envelope level
    releaseStartLevel: number; // Level when release was triggered
    velocity: number; // 0-1
}

const WAVETABLE_SIZE = 32;

class WavetableProcessor extends AudioWorkletProcessor {
    wavetable: Float32Array;
    adsr: ADSR;
    voices: Voice[];
    sampleRateVal: number;

    constructor() {
        super();
        this.wavetable = new Float32Array(WAVETABLE_SIZE);
        // Default Sine-ish
        for (let i = 0; i < WAVETABLE_SIZE; i++) {
            this.wavetable[i] = Math.sin((i / WAVETABLE_SIZE) * 2 * Math.PI);
        }

        this.adsr = { a: 0.1, d: 0.1, s: 0.5, r: 0.2 };

        this.voices = [];
        for (let i = 0; i < 6; i++) {
            this.voices.push({
                active: false,
                note: 0,
                phase: 0,
                phaseStep: 0,
                envState: 'IDLE',
                envTime: 0,
                envLevel: 0,
                releaseStartLevel: 0,
                velocity: 0
            });
        }

        this.sampleRateVal = sampleRate; // Global sampleRate

        this.port.onmessage = this.handleMessage.bind(this);
    }

    handleMessage(event: MessageEvent) {
        const { type, payload } = event.data;
        if (type === 'NOTE_ON') {
            this.triggerAttack(payload.note, payload.velocity);
        } else if (type === 'NOTE_OFF') {
            this.triggerRelease(payload.note);
        } else if (type === 'SET_WAVETABLE') {
            if (payload.length === WAVETABLE_SIZE) {
                this.wavetable.set(payload);
            }
        } else if (type === 'SET_ADSR') {
            this.adsr = payload;
        } else if (type === 'STOP_ALL') {
            this.voices.forEach(v => {
                v.active = false;
                v.envState = 'IDLE';
                v.envLevel = 0;
            });
        }
    }

    triggerAttack(note: number, velocity: number) {
        // Find free voice or steal
        // Prioritize: IDLE > RELEASE > Oldest (not tracking age, so just pick first RELEASE or just first)
        let voice = this.voices.find(v => v.envState === 'IDLE');
        if (!voice) {
            voice = this.voices.find(v => v.envState === 'RELEASE');
        }
        if (!voice) {
            // Steal the first one arbitrarily if all busy
            voice = this.voices[0];
        }

        voice.active = true;
        voice.note = note;
        // Frequency calculation: 440 * 2^((note - 69)/12)
        const freq = 440 * Math.pow(2, (note - 69) / 12);
        // Phase step: (Freq / SampleRate) * WavetableSize
        voice.phaseStep = (freq / this.sampleRateVal) * WAVETABLE_SIZE;
        voice.phase = 0;
        voice.velocity = velocity / 127;

        voice.envState = 'ATTACK';
        voice.envTime = 0;
        voice.envLevel = 0;
    }

    triggerRelease(note: number) {
        // Trigger release for ALL voices playing this note (in case of unison or bugs, though usually one)
        this.voices.forEach(v => {
            if (v.active && v.note === note && v.envState !== 'RELEASE' && v.envState !== 'IDLE') {
                v.envState = 'RELEASE';
                v.envTime = 0;
                v.releaseStartLevel = v.envLevel;
            }
        });
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        const channelData = output[0]; // Mono output
        const bufferLength = channelData.length;

        for (let i = 0; i < bufferLength; i++) {
            let sampleSum = 0;

            for (const voice of this.voices) {
                if (!voice.active) continue;

                // --- Envelope Logic ---
                let targetLevel = 0;
                let stepSize = 0;

                switch (voice.envState) {
                    case 'ATTACK':
                        const aSamples = this.adsr.a * this.sampleRateVal;
                        if (aSamples <= 0) {
                            voice.envLevel = 1;
                            voice.envState = 'DECAY';
                            voice.envTime = 0;
                        } else {
                            stepSize = 1.0 / aSamples;
                            voice.envLevel += stepSize;
                            if (voice.envLevel >= 1.0) {
                                voice.envLevel = 1.0;
                                voice.envState = 'DECAY';
                                voice.envTime = 0;
                            }
                        }
                        break;
                    case 'DECAY':
                        const dSamples = this.adsr.d * this.sampleRateVal;
                        if (dSamples <= 0) {
                            voice.envLevel = this.adsr.s;
                            voice.envState = 'SUSTAIN';
                        } else {
                            // Linear decay to Sustain
                            stepSize = (1.0 - this.adsr.s) / dSamples;
                            voice.envLevel -= stepSize;
                            if (voice.envLevel <= this.adsr.s) {
                                voice.envLevel = this.adsr.s;
                                voice.envState = 'SUSTAIN';
                            }
                        }
                        break;
                    case 'SUSTAIN':
                        voice.envLevel = this.adsr.s;
                        break;
                    case 'RELEASE':
                        const rSamples = this.adsr.r * this.sampleRateVal;
                        if (rSamples <= 0) {
                            voice.envLevel = 0;
                            voice.active = false;
                            voice.envState = 'IDLE';
                        } else {
                            stepSize = voice.releaseStartLevel / rSamples;
                            voice.envLevel -= stepSize;
                            if (voice.envLevel <= 0) {
                                voice.envLevel = 0;
                                voice.active = false;
                                voice.envState = 'IDLE';
                            }
                        }
                        break;
                }

                // Apply velocity to envelope
                const currentGain = voice.envLevel * voice.velocity;

                // --- Wavetable Logic ---
                if (currentGain > 0.0001) {
                    // Linear Interpolation
                    const index = voice.phase;
                    const i = Math.floor(index);
                    const frac = index - i;
                    const nextI = (i + 1) % WAVETABLE_SIZE;

                    const val = this.wavetable[i] * (1 - frac) + this.wavetable[nextI] * frac;

                    sampleSum += val * currentGain;

                    // Increment phase
                    voice.phase += voice.phaseStep;
                    if (voice.phase >= WAVETABLE_SIZE) {
                        voice.phase -= WAVETABLE_SIZE;
                    }
                }
            }

            // Normalize / Limiter mechanism could be here, but simple division is safer for now.
            // 6 voices sum. To avoid clipping, maybe divide by 3 (assuming not all 6 play full volume at once usually)
            // or use a gentle tanh.
            // Let's divide by 6 for guaranteed safety, but might be quiet. Divide by 3 is a good compromise.
            channelData[i] = sampleSum / 4.0;
        }

        // Copy to other channels (stereo)
        for (let ch = 1; ch < output.length; ch++) {
            output[ch].set(channelData);
        }

        return true;
    }
}

registerProcessor('wavetable-processor', WavetableProcessor);
