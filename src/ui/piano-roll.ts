import { Midi } from '@tonejs/midi';

export class PianoRoll {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    midi: Midi | null = null;

    // Viewport
    pixelsPerSecond = 50;
    // pixelsPerNote = 4; // Not used really, we use noteHeight
    noteHeight = 4;

    // State for redraw
    lastDrawTime = 0;
    activeNotesCache: Map<number, number> | undefined;

    // Colors
    colors = [
        '#FF5733', '#33FF57', '#3357FF', '#FF33A1',
        '#33FFF5', '#F5FF33', '#FF8C33', '#8C33FF',
        '#FF3333', '#33FF33', '#3333FF', '#FFFF33',
        '#33FFFF', '#FF33FF', '#CCCCCC', '#FFFFFF'
    ];

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;
        this.canvas = document.createElement('canvas');
        this.canvas.width = container.clientWidth;
        this.canvas.height = 128 * this.noteHeight; // 128 notes
        this.canvas.style.background = '#111';
        this.canvas.style.width = '100%';
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d')!;

        // Handle Resize
        const resizeObserver = new ResizeObserver(() => {
            this.canvas.width = container.clientWidth;
            this.draw(this.lastDrawTime, this.activeNotesCache);
        });
        resizeObserver.observe(container);
    }

    setMidi(midi: Midi) {
        this.midi = midi;
        this.draw(0);
    }

    setNoteHeight(h: number) {
        this.noteHeight = Math.max(4, Math.min(50, h));
        this.canvas.height = 128 * this.noteHeight;
        this.draw(this.lastDrawTime, this.activeNotesCache);
    }

    zoomIn() {
        this.setNoteHeight(this.noteHeight + 4);
    }

    zoomOut() {
        this.setNoteHeight(this.noteHeight - 4);
    }

    draw(currentTime: number, activeNotes?: Map<number, number>) {
        this.lastDrawTime = currentTime;
        if (activeNotes) this.activeNotesCache = activeNotes;
        else if (activeNotes === undefined && this.activeNotesCache) activeNotes = this.activeNotesCache;

        if (!this.midi) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = '#444';
            this.ctx.textAlign = 'center';
            this.ctx.font = '16px sans-serif';
            this.ctx.fillText("No MIDI Loaded", this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const keyWidth = 60; // Piano keys width

        this.ctx.clearRect(0, 0, w, h);

        // --- Draw Notes Area ---
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(keyWidth, 0, w - keyWidth, h);
        this.ctx.clip();

        // Calculate scroll offset (Center currentTime)
        // Adjust for note area width
        const noteAreaWidth = w - keyWidth;
        const offsetX = currentTime * this.pixelsPerSecond - (noteAreaWidth * 0.2);

        // Draw Notes
        this.midi.tracks.forEach((track, i) => {
            const color = this.colors[i % this.colors.length] || '#888';
            this.ctx.fillStyle = color;

            track.notes.forEach(note => {
                const x = note.time * this.pixelsPerSecond - offsetX + keyWidth;
                const noteW = note.duration * this.pixelsPerSecond;

                // Visibility Check
                if (x + noteW < keyWidth || x > w) return;

                const y = (127 - note.midi) * this.noteHeight;

                this.ctx.fillRect(x, y, noteW, this.noteHeight - 1);
            });
        });

        // Draw Playhead
        // Playhead x is relative to note area
        const playheadX = keyWidth + noteAreaWidth * 0.2;
        this.ctx.strokeStyle = '#FFF';
        this.ctx.beginPath();
        this.ctx.moveTo(playheadX, 0);
        this.ctx.lineTo(playheadX, h);
        this.ctx.stroke();

        this.ctx.restore(); // End clipping

        // --- Draw Piano Keyboard (Left) ---
        // Background for keyboard area
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, 0, keyWidth, h);

        for (let m = 0; m <= 127; m++) {
            const y = (127 - m) * this.noteHeight;
            const noteInOctave = m % 12;
            const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);

            // Base Color
            let fill = isBlack ? '#444' : '#EEE';
            let width = isBlack ? keyWidth * 0.6 : keyWidth;

            // Active Highlight
            const vel = activeNotes?.get(m);
            if (vel !== undefined && vel > 0) {
                // Red highlight active
                fill = `rgba(255, 100, 100, ${0.4 + vel * 0.6})`;
                width = keyWidth; // Expand active blocks
            }

            this.ctx.fillStyle = fill;
            if (isBlack) {
                this.ctx.fillRect(0, y, width, this.noteHeight - 1);
            } else {
                this.ctx.fillRect(0, y, width, this.noteHeight - 1);
            }

            // Octave Labels
            if (noteInOctave === 0 && m % 12 === 0) {
                this.ctx.fillStyle = '#888';
                this.ctx.font = '10px monospace';
                this.ctx.textAlign = 'right';
                const label = `C${m / 12 - 1}`;
                this.ctx.fillText(label, keyWidth - 2, y + this.noteHeight * 0.7);
            }
        }

        // Time Text
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(currentTime.toFixed(2) + 's', playheadX + 5, 10);
    }
}
