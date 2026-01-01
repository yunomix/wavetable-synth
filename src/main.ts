
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
let duration = 0;

// State needed for Seek Bar
let pauseTime = 0; // If we pause, we need to track this

// Active Channels (Play enabled)
const activePlayChannels = new Set([0]);

// Selected Editing Channel
let editingChannel = 0;

// Note Display State (per channel)
const activeNotes: Set<number>[] = [];
for (let i = 0; i < 16; i++) activeNotes.push(new Set());

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
       
       <input type="range" id="seek-bar" min="0" max="100" value="0" style="width: 300px;" disabled>
       <span id="time-display">0:00 / 0:00</span>
       
       <div style="font-family:monospace; margin-left: 20px;">
         BPM: <span id="bpm-display">--</span>
       </div>
    </div>
    
    <div class="card">
      <h3>Channels</h3>
      <div class="channel-list" id="channel-list"></div>
    </div>

    <div class="visualizers">
       <div class="editor-section">
           <h3>Wavetable (CH <span id="wt-ch-label">1</span>)</h3>
           <div class="preset-buttons">
              <button id="wt-rect">Rect</button>
              <button id="wt-tri">Tri</button>
              <button id="wt-saw">Saw</button>
              <button id="wt-rand">Rnd</button>
           </div>
           <div id="wt-editor"></div>
       </div>
       
       <div class="editor-section">
           <h3>ADSR (CH <span id="adsr-ch-label">1</span>)</h3>
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

// Helper: Note Number to Name
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function getNoteName(midiVal: number) {
    const note = NOTE_NAMES[midiVal % 12];
    const octave = Math.floor(midiVal / 12) - 1;
    return `${note}${octave}`;
}

// --- Initialization ---
const synth = new SynthEngine();

// Editors need to know they are updating 'editingChannel'
const wtEditor = new WavetableEditor('wt-editor', (wf) => {
    synth.setChannelWavetable(editingChannel, wf);
    // TODO: persist this waveform for this channel in UI state if we want to retain it visually when switching channels
    // For now, simpler: we just send to synth. 
    // Ideally we store state here in JS too.
    channelStates[editingChannel].wavetable.set(wf);
});

const adsrEditor = new ADSREditor('adsr-editor', (adsr) => {
    synth.setChannelADSR(editingChannel, adsr);
    channelStates[editingChannel].adsr = { ...adsr };
});

// Channel State Storage for UI switching
const channelStates: { wavetable: Float32Array, adsr: { a: number, d: number, s: number, r: number } }[] = [];
for (let i = 0; i < 16; i++) {
    const wt = new Float32Array(32);
    for (let k = 0; k < 32; k++) wt[k] = Math.sin((k / 32) * 2 * Math.PI);
    channelStates.push({
        wavetable: wt,
        adsr: { a: 0.1, d: 0.1, s: 0.5, r: 0.2 }
    });
}

function updateEditorLabels() {
    document.getElementById('wt-ch-label')!.innerText = (editingChannel + 1).toString();
    document.getElementById('adsr-ch-label')!.innerText = (editingChannel + 1).toString();

    // Refresh editors
    wtEditor.setWaveform(channelStates[editingChannel].wavetable);
    adsrEditor.setValues(channelStates[editingChannel].adsr);
}

// Channel UI Generation
const channelList = document.getElementById('channel-list')!;
// Grid layout for 16 channels? Or list? Let's do a compact list or grid.
// Style injection for this specific block if needed, or inline.
channelList.style.display = 'grid';
channelList.style.gridTemplateColumns = 'repeat(4, 1fr)';
channelList.style.gap = '10px';

const channelUIUpdateFuncs: (() => void)[] = [];

for (let i = 0; i < 16; i++) {
    const div = document.createElement('div');
    div.className = 'channel-item';
    div.style.padding = '5px';
    div.style.border = '1px solid #555';
    div.style.borderRadius = '4px';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.background = '#222';

    // Header: CH X | Play Checkbox | Edit Radio
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '5px';

    const label = document.createElement('span');
    label.innerText = `CH ${i + 1}`;

    const controls = document.createElement('div');

    // Edit Radio (Select this channel to edit)
    const editRadio = document.createElement('input');
    editRadio.type = 'radio';
    editRadio.name = 'edit-channel';
    editRadio.checked = (i === 0);
    editRadio.onchange = () => {
        if (editRadio.checked) {
            editingChannel = i;
            updateEditorLabels();
            // Update visual style of active editing card
            updateChannelStyles();
        }
    };

    // Play Checkbox
    const playCheck = document.createElement('input');
    playCheck.type = 'checkbox';
    playCheck.checked = (i === 0);
    playCheck.onchange = () => {
        if (playCheck.checked) activePlayChannels.add(i);
        else activePlayChannels.delete(i);
    };

    controls.appendChild(document.createTextNode('Edit '));
    controls.appendChild(editRadio);
    controls.appendChild(document.createTextNode(' Play '));
    controls.appendChild(playCheck);

    header.appendChild(label);
    header.appendChild(controls);

    // Note Display
    const noteDisplay = document.createElement('div');
    noteDisplay.className = 'note-display';
    noteDisplay.style.height = '20px';
    noteDisplay.style.fontSize = '12px';
    noteDisplay.style.color = '#8f8';
    noteDisplay.innerText = '-';

    div.appendChild(header);
    div.appendChild(noteDisplay);
    channelList.appendChild(div);

    const updateFunc = () => {
        // Update Note Display
        if (activeNotes[i].size === 0) {
            noteDisplay.innerText = '-';
        } else {
            const arr = Array.from(activeNotes[i]).sort((a, b) => a - b);
            noteDisplay.innerText = arr.map(n => getNoteName(n)).join(' ');
        }

        // Update selection style
        if (editingChannel === i) {
            div.style.borderColor = '#646cff';
            div.style.background = '#333';
        } else {
            div.style.borderColor = '#555';
            div.style.background = '#222';
        }
    };
    channelUIUpdateFuncs.push(updateFunc);
}

function updateChannelStyles() {
    channelUIUpdateFuncs.forEach(f => f());
}

// Seek Bar
const seekBar = document.getElementById('seek-bar') as HTMLInputElement;
const timeDisplay = document.getElementById('time-display')!;

seekBar.addEventListener('input', () => {
    // Determine user seek logic
    // Usually pause, seek, resume
    // Or just set time
    if (!midi) return;
    const seekTime = (parseInt(seekBar.value) / 100) * midi.duration;

    // To implement seek properly:
    // 1. Calculate time offset.
    // 2. Reset scheduler logic.
    // 3. Stop all current notes.
    // 4. Update startTime so that (now - startTime) = seekTime

    const wasPlaying = isPlaying;
    if (wasPlaying) stopPlayback();

    // Set internal state for resume
    // We basically treat it as a new start with offset
    // Wait, simple loop logic uses startTime = currentTime. 
    // To support starting mid-way, loop needs (currentTime - globalStart).
    // Let's adjust startTime. 
    // If we want playback to be at 'seekTime', then (now - startTime) must equal seekTime.
    // So startTime = now - seekTime.

    // But we are stopped. 
    // We update UI only.
    updateTimeDisplay(seekTime);

    // If we were playing, we restart immediately for seamless seek? 
    // Or wait for 'change' event? 'input' fires continuously.
    // Let's just update UI on input, and logic on 'change'? 
    // Actually 'change' is better for logic.
});

seekBar.addEventListener('change', () => {
    if (!midi) return;
    const seekTime = (parseInt(seekBar.value) / 100) * midi.duration;

    // Restart if it was playing or just set state
    startTime = synth.context.currentTime - seekTime;
    scheduledTill = seekTime;

    // Clear notes
    synth.stopAll();
    activeNotes.forEach(s => s.clear());
    updateChannelStyles();

    if (isPlaying) {
        // It was stopped by 'input' logic? NO, I didn't stop it in input yet.
        // Let's simplify: simple seek bar = jump.
        // In 'input', pause updates. In 'change' (mouse up), apply jump.
    } else {
        // Just pre-set start time for when Play is clicked
        // Actually startPlayback resets startTime. We need to handle 'resume from offset'.
        pauseTime = seekTime;
    }
});


// File Loading
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-load')?.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    midi = new Midi(arrayBuffer);

    duration = midi.duration;

    // Reset Seek Bar
    seekBar.disabled = false;
    seekBar.value = '0';
    updateTimeDisplay(0);

    // Update BPM
    const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
    document.getElementById('bpm-display')!.innerText = Math.round(bpm).toString();

    console.log("MIDI Loaded", midi);
});

function updateTimeDisplay(vals: number) {
    const min = Math.floor(vals / 60);
    const sec = Math.floor(vals % 60).toString().padStart(2, '0');

    const dMin = Math.floor(duration / 60);
    const dSec = Math.floor(duration % 60).toString().padStart(2, '0');

    timeDisplay.innerText = `${min}:${sec} / ${dMin}:${dSec}`;
}


// Playback Logic
async function startPlayback() {
    if (!midi) {
        alert("Please load a MIDI file first.");
        return;
    }
    await synth.init();

    if (isPlaying) {
        // Pause behavior
        stopPlayback();
        pauseTime = synth.context.currentTime - startTime;
        return;
    }

    isPlaying = true;
    document.getElementById('btn-play')!.innerText = "Pause";

    // Resume from pauseTime (0 if fresh)
    startTime = synth.context.currentTime - pauseTime;
    scheduledTill = pauseTime;

    // Reset Voices? Only if fresh start, but safest to stop all hanging notes
    synth.stopAll();

    // Clear display notes
    activeNotes.forEach(s => s.clear());

    loop();
}

function stopPlayback() {
    isPlaying = false;
    document.getElementById('btn-play')!.innerText = "Play";
    synth.stopAll();
    cancelAnimationFrame(toneTransportId);
    activeNotes.forEach(s => s.clear());
    updateChannelStyles();
}

// Loop
function loop() {
    if (!isPlaying || !midi) return;

    const now = synth.context.currentTime;
    const timeElapsed = now - startTime;

    if (timeElapsed > duration) {
        stopPlayback();
        pauseTime = 0;
        seekBar.value = '0';
        updateTimeDisplay(0);
        return;
    }

    // Update Seek Bar (throttled? every frame is fine for simple UI)
    const pct = (timeElapsed / duration) * 100;
    if (Math.abs(parseFloat(seekBar.value) - pct) > 0.5) { // Avoid fighting with user drag? User drag will prevent update if we don't bind carefully.
        // Actually standard: only update if not dragging.
        // Simple check: document.activeElement !== seekBar
        if (document.activeElement !== seekBar) {
            seekBar.value = pct.toString();
            updateTimeDisplay(timeElapsed);
        }
    }

    const lookaheadLim = timeElapsed + playbackLookahead;

    midi.tracks.forEach(track => {
        // Assuming track.channel matches MIDI channel. 
        // @tonejs/midi map track to channel via instruments?
        // Note object has `channel`. We rely on Note channel.


        // Iterate notes
        // Optimization: track.notes is sorted. We can keep an index per track? 
        // For simple short MIDI, iteration is fine. For long, index needed.
        // Let's rely on simple iteration for now but adding a 'scheduled' flag or checking window 
        // Window check: note.time >= scheduledTill && note.time < lookaheadLim

        // Wait, track.channel is sometimes undefined if it's a format 0 without channel info on track level?
        // Let's use note.channel inside.

        track.notes.forEach(note => {
            const ch = track.channel ?? 0;
            if (!activePlayChannels.has(ch)) return;

            if (note.time >= scheduledTill && note.time < lookaheadLim) {
                const triggerTime = startTime + note.time;
                const delay = triggerTime - now;
                const delayMs = Math.max(0, delay * 1000);
                const durMs = note.duration * 1000;

                // Note On
                setTimeout(() => {
                    if (!isPlaying) return;
                    synth.noteOn(note.midi, note.velocity * 127, ch);

                    // Display Update
                    activeNotes[ch].add(note.midi);
                    updateChannelStyles(); // This might be heavy per note? optimize via requestAnimationFrame loop logic?
                    // Actually let's put updateChannelStyles() at end of main loop

                }, delayMs);

                // Note Off
                setTimeout(() => {
                    if (!isPlaying) return;
                    synth.noteOff(note.midi, ch);

                    // Display Update
                    activeNotes[ch].delete(note.midi);
                    // updateChannelStyles(); // defer to loop
                }, delayMs + durMs);
            }
        });
    });

    scheduledTill = lookaheadLim;

    // UI Update Loop for Display
    // We update channel styles every frame? Or just set a flag.
    updateChannelStyles();

    toneTransportId = requestAnimationFrame(loop);
}

document.getElementById('btn-play')?.addEventListener('click', startPlayback);
document.getElementById('btn-stop')?.addEventListener('click', () => {
    stopPlayback();
    pauseTime = 0;
    seekBar.value = '0';
    updateTimeDisplay(0);
});


// Presets Logic
const WT_SIZE = 32;
function generateWt(type: 'rect' | 'tri' | 'saw' | 'rand') {
    const arr = new Float32Array(WT_SIZE);
    for (let i = 0; i < WT_SIZE; i++) {
        const ph = i / WT_SIZE;
        let val = 0;
        if (type === 'rect') val = ph < 0.5 ? 1 : -1;
        else if (type === 'tri') val = ph < 0.5 ? 4 * ph - 1 : 1 - 4 * (ph - 0.5);
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

// Init first render
updateChannelStyles();
