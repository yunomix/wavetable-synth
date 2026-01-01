
export class WavetableEditor {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    waveform: Float32Array;
    onChange: (waveform: Float32Array) => void;

    constructor(containerId: string, onChange: (wf: Float32Array) => void) {
        this.container = document.getElementById(containerId) as HTMLElement;
        this.onChange = onChange;
        this.waveform = new Float32Array(32);

        // Default Sine
        for (let i = 0; i < 32; i++) {
            this.waveform[i] = Math.sin((i / 32) * 2 * Math.PI);
        }

        this.canvas = document.createElement('canvas');
        this.canvas.width = 320;
        this.canvas.height = 150;
        this.container.appendChild(this.canvas);

        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Could not get canvas context");
        this.ctx = context;

        this.initEvents();
        this.draw();
    }

    initEvents() {
        let isDrawing = false;

        const handleDraw = (e: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Map x (0-320) to index (0-31)
            const index = Math.min(31, Math.max(0, Math.floor(x / 10)));

            // Map y (0-150) to value (1 to -1)
            // 0 -> 1, 75 -> 0, 150 -> -1
            const value = 1 - (y / 75);

            this.waveform[index] = Math.max(-1, Math.min(1, value));
            this.draw();
            this.onChange(this.waveform);
        };

        this.canvas.addEventListener('mousedown', (e) => {
            isDrawing = true;
            handleDraw(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            // Need relative coordinates even if mouse leaves canvas, 
            // but for simplicity let's stick to canvas-bound or use simple logic
            const rect = this.canvas.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                handleDraw(e as MouseEvent);
            }
        });

        window.addEventListener('mouseup', () => {
            isDrawing = false;
        });
    }

    setWaveform(newWaveform: Float32Array) {
        if (newWaveform.length !== 32) return;
        this.waveform.set(newWaveform);
        this.draw();
        this.onChange(this.waveform);
    }

    getWaveform() {
        return this.waveform;
    }

    draw() {
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 75);
        this.ctx.lineTo(320, 75);
        this.ctx.stroke();

        // Bars
        this.ctx.fillStyle = '#4a90e2';
        for (let i = 0; i < 32; i++) {
            const val = this.waveform[i];
            const height = val * -75; // -1 -> 75, 1 -> -75
            // base is 75
            this.ctx.fillRect(i * 10 + 1, 75, 8, height);
        }
    }
}
