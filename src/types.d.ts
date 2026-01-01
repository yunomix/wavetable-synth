// Type definitions for AudioWorklet
declare class AudioWorkletProcessor {
    constructor(options?: AudioWorkletNodeOptions);
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: (new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor)): void;

declare const sampleRate: number;
