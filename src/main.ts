
import { Midi } from '@tonejs/midi';
import { SynthEngine } from './audio/synth';
import { WavetableEditor } from './ui/wavetable-editor';
import { ADSREditor } from './ui/adsr-editor';
import './style.css';

// --- State ---
let midi: Midi | null = null;
let isPlaying = false;
let startTime = 0;
let playbackLookahead = 0.1; // 100ms
let scheduledTill = 0;
let toneTransportId: number;

const selectedChannels = new Set([0]); // Default Channel 1 (0-indexed in code?) tonejs/midi uses 0-indexed channel numbers usually, but let's check. 
// Actually tonejs/midi: note.channel is number.

// --- Components ---
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="synth-container">
    <h1>Wavetable Synth</h1>
    
    <div class="card control-panel">
       <button id="btn-load" class="file-upload-btn">Load MIDI File</button>
       <input type="file" id="file-input" accept=".mid,.midi" />
       
       <button id="btn-play">Play</button>
       <button id="btn-stop">Stop</button>
       
       <div style="font-family:monospace; margin-left: 20px;">
         BPM: <span id="bpm-display">--</span>
       </div>
    </div>
    
    <div class="card">
      <h3>Active MIDI Channels</h3>
      <div class="channel-selector" id="channel-selector"></div>
      <small>Select channels to play (Max 6 recommeded)</small>
    </div>

    <div class="visualizers">
       <div class="editor-section">
           <h3>Wavetable</h3>
           <div class="preset-buttons">
              <button id="wt-rect">Rect</button>
              <button id="wt-tri">Tri</button>
              <button id="wt-saw">Saw</button>
              <button id="wt-rand">Rnd</button>
           </div>
           <div id="wt-editor"></div>
       </div>
       
       <div class="editor-section">
           <h3>ADSR Envelope</h3>
           <div class="preset-buttons">
              <button id="adsr-pluck">Pluck</button>
              <button id="adsr-pad">Pad</button>
              <button id="adsr-lead">Lead</button>
           </div>
           <div id="adsr-editor"></div>
       </div>
    </div>
  </div>
`;

// --- Initialization ---
const synth = new SynthEngine();
const wtEditor = new WavetableEditor('wt-editor', (wf) => synth.setWavetable(wf));
const adsrEditor = new ADSREditor('adsr-editor', (adsr) => synth.setADSR(adsr));

// Channel UI
const channelContainer = document.getElementById('channel-selector')!;
for (let i = 1; i <= 16; i++) {
    const label = document.createElement('label');
    label.className = 'channel-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = (i - 1).toString();
    if (i === 1) cb.checked = true;
    cb.onchange = (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        if ((e.target as HTMLInputElement).checked) selectedChannels.add(val);
        else selectedChannels.delete(val);
    };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(`CH ${i}`));
    channelContainer.appendChild(label);
}

// File Loading
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-load')?.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    midi = new Midi(arrayBuffer);

    // Update BPM
    const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
    document.getElementById('bpm-display')!.innerText = Math.round(bpm).toString();

    console.log("MIDI Loaded", midi);
});

// Playback Logic
async function startPlayback() {
    if (!midi) {
        alert("Please load a MIDI file first.");
        return;
    }
    await synth.init();

    if (isPlaying) stopPlayback();

    isPlaying = true;
    startTime = synth.context.currentTime;
    scheduledTill = 0; // Relative to 0 start

    // Reset Voices?
    synth.stopAll();

    loop();
}

function stopPlayback() {
    isPlaying = false;
    synth.stopAll();
    cancelAnimationFrame(toneTransportId);
}

// Simple scheduling loop
function loop() {
    if (!isPlaying || !midi) return;

    const now = synth.context.currentTime;
    const timeElapsed = now - startTime;
    const lookaheadLim = timeElapsed + playbackLookahead;

    // Find events between scheduledTill and lookaheadLim
    // Iterate all tracks
    midi.tracks.forEach(track => {
        // Check Channel
        if (!selectedChannels.has(track.channel)) return; // Note: track.channel might be unreliable in some Midi parsers, better check note.channel or assume track -> channel mapping? 
        // @tonejs/midi: track objects have `channel`. 

        track.notes.forEach(note => {
            if (note.time >= scheduledTill && note.time < lookaheadLim) {
                // Schedule Note On
                // We calculate precise delay
                const playTime = startTime + note.time;
                const delay = Math.max(0, playTime - now);

                // For this simple engine, we use setTimeout to trigger the message at the right time
                // Or send it immediately if delay is small.
                // Since our engine doesn't support 'scheduled' messages, we use setTimeout in JS.

                setTimeout(() => {
                    if (!isPlaying) return;
                    synth.noteOn(note.midi, note.velocity * 127);
                }, delay * 1000);

                // Schedule Note Off
                const offTime = startTime + note.time + note.duration;
                const offDelay = Math.max(0, offTime - now);
                setTimeout(() => {
                    if (!isPlaying) return;
                    synth.noteOff(note.midi);
                }, offDelay * 1000);
            }
        });
    });

    scheduledTill = lookaheadLim;
    toneTransportId = requestAnimationFrame(loop);
}

document.getElementById('btn-play')?.addEventListener('click', startPlayback);
document.getElementById('btn-stop')?.addEventListener('click', stopPlayback);


// Presets Logic

const WT_SIZE = 32;
function generateWt(type: 'rect' | 'tri' | 'saw' | 'rand') {
    const arr = new Float32Array(WT_SIZE);
    for (let i = 0; i < WT_SIZE; i++) {
        const ph = i / WT_SIZE; // 0-1
        let val = 0;
        if (type === 'rect') val = ph < 0.5 ? 1 : -1;
        else if (type === 'tri') val = ph < 0.5 ? 4 * ph - 1 : 1 - 4 * (ph - 0.5); // Simplified
        else if (type === 'saw') val = 2 * ph - 1;
        else if (type === 'rand') val = Math.random() * 2 - 1;
        arr[i] = val;
    }
    return arr;
}
document.getElementById('wt-rect')?.addEventListener('click', () => wtEditor.setWaveform(generateWt('rect')));
document.getElementById('wt-tri')?.addEventListener('click', () => wtEditor.setWaveform(generateWt('tri')));
document.getElementById('wt-saw')?.addEventListener('click', () => wtEditor.setWaveform(generateWt('saw')));
document.getElementById('wt-rand')?.addEventListener('click', () => wtEditor.setWaveform(generateWt('rand')));

document.getElementById('adsr-pluck')?.addEventListener('click', () => adsrEditor.setValues({ a: 0.01, d: 0.1, s: 0, r: 0.1 }));
document.getElementById('adsr-pad')?.addEventListener('click', () => adsrEditor.setValues({ a: 1.0, d: 1.0, s: 0.8, r: 2.0 }));
document.getElementById('adsr-lead')?.addEventListener('click', () => adsrEditor.setValues({ a: 0.05, d: 0.2, s: 0.5, r: 0.3 }));

