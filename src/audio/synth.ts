
// Processor URL needs to be resolved. In Vite we can use import.meta.url or ?url
// But AudioWorklet addModule expects a path readable by the browser. 
// We will use a small hack or just assume 'src/audio/processor.ts' is served if dev server loops back,
// but browsers can't load TS directly.
// Vite specific: import processorUrl from './processor.ts?url' -> gives /src/audio/processor.ts (processed by vite)
// Actually in vanilla Vite TS, we might need 'processor.js?url' or allow vite to handle it.
// Let's try the standard Vite worker way.
import processorUrl from './processor.ts?worker&url';
// Note: ?worker&url might Bundle it. If we use ?url it might serve TS which fails. 
// Safe bet: ?worker&url.

export class SynthEngine {
    context: AudioContext;
    workletNode: AudioWorkletNode | null = null;
    isReady: boolean = false;

    constructor() {
        this.context = new AudioContext();
    }

    async init() {
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }

        try {
            // Note: In some environments 'processorUrl' might need checking
            await this.context.audioWorklet.addModule(processorUrl);

            this.workletNode = new AudioWorkletNode(this.context, 'wavetable-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2] // Stereo out
            });

            // --- Reverb Setup ---
            const convolver = this.context.createConvolver();
            const reverbGain = this.context.createGain();

            // Generate Impulse Response (Simple Exponential Decay Noise)
            const duration = 2.0;
            const rate = this.context.sampleRate;
            const length = rate * duration;
            const impulse = this.context.createBuffer(2, length, rate);
            const left = impulse.getChannelData(0);
            const right = impulse.getChannelData(1);

            for (let i = 0; i < length; i++) {
                // Exponential decay
                const decay = Math.pow(1 - (i / length), 4.0);
                // Noise * decay
                left[i] = (Math.random() * 2 - 1) * decay;
                right[i] = (Math.random() * 2 - 1) * decay;
            }
            convolver.buffer = impulse;

            // Default: ON
            reverbGain.gain.value = 0.5;
            this.reverbGainNode = reverbGain;

            // Routing
            // Dry
            this.workletNode.connect(this.context.destination);
            // Wet
            this.workletNode.connect(convolver);
            convolver.connect(reverbGain);
            reverbGain.connect(this.context.destination);

            this.isReady = true;
            console.log("Audio Engine Initialized");
        } catch (e) {
            console.error("Failed to initialize audio worklet", e);
        }
    }

    // API

    reverbGainNode: GainNode | null = null;

    setReverb(enabled: boolean) {
        if (this.reverbGainNode) {
            // Smooth transition
            const now = this.context.currentTime;
            this.reverbGainNode.gain.cancelScheduledValues(now);
            this.reverbGainNode.gain.linearRampToValueAtTime(enabled ? 0.5 : 0, now + 0.1);
        }
    }

    noteOn(note: number, velocity: number, channel: number) {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'NOTE_ON',
            payload: { note, velocity, channel }
        });
    }

    noteOff(note: number, channel: number) {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'NOTE_OFF',
            payload: { note, channel }
        });
    }

    setChannelWavetable(channel: number, wavetable: Float32Array) {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'SET_CHANNEL_WAVETABLE',
            payload: { channel, wavetable }
        });
    }

    setChannelADSR(channel: number, adsr: { a: number, d: number, s: number, r: number }) {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'SET_CHANNEL_ADSR',
            payload: { channel, adsr }
        });
    }

    stopAll() {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'STOP_ALL' });
    }
}
