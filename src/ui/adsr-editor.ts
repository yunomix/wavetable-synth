
interface ADSR {
    a: number;
    d: number;
    s: number;
    r: number;
}

export class ADSREditor {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    values: ADSR;
    onChange: (values: ADSR) => void;

    // Scale
    timeScale: number = 50; // pixels per second
    msgScale: number = 100; // pixels per unit gain

    // Drag state
    draggingPoint: number | null = null; // 1 (A), 2 (D,S), 3 (R end)

    constructor(containerId: string, onChange: (v: ADSR) => void) {
        this.container = document.getElementById(containerId) as HTMLElement;
        this.onChange = onChange;
        this.values = { a: 0.1, d: 0.2, s: 0.5, r: 0.5 }; // Defaults

        this.canvas = document.createElement('canvas');
        this.canvas.width = 400; // 8 seconds max view
        this.canvas.height = 150;
        this.container.appendChild(this.canvas);

        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Could not get canvas context");
        this.ctx = context;

        this.initEvents();
        this.draw();
    }

    getPoints() {
        const { a, d, s, r } = this.values;
        const h = this.canvas.height;
        const padBot = 20;
        const zeroY = h - padBot;
        const oneY = zeroY - this.msgScale;

        // P0: 0,0
        const p0 = { x: 0, y: zeroY };

        // P1: A, 1.0
        const p1 = { x: a * this.timeScale, y: oneY };

        // P2: A+D, S
        // S is 0-1.
        const sY = zeroY - (s * this.msgScale);
        const p2 = { x: (a + d) * this.timeScale, y: sY };

        // P3: A+D+SustainHold(fixed 1s), S
        // Visual gap for sustain
        const sustainVisual = 1.0;
        const p3 = { x: (a + d + sustainVisual) * this.timeScale, y: sY };

        // P4: End of R
        const p4 = { x: (a + d + sustainVisual + r) * this.timeScale, y: zeroY };

        return [p0, p1, p2, p3, p4];
    }

    updateFromPoints(p1: { x: number, y: number }, p2: { x: number, y: number }, p4: { x: number, y: number }) {
        // Reverse map pixels to values
        const h = this.canvas.height;
        const padBot = 20;
        const zeroY = h - padBot;
        const sustainVisual = 1.0;

        // A
        let newA = p1.x / this.timeScale;
        newA = Math.max(0.01, newA); // min 10ms

        // D
        let newD = (p2.x / this.timeScale) - newA;
        newD = Math.max(0.01, newD);

        // S
        // y = zeroY - s*scale => s = (zeroY - y)/scale
        let newS = (zeroY - p2.y) / this.msgScale;
        newS = Math.max(0, Math.min(1, newS));

        // R
        // p4.x = (A+D+Sus+R)*scale
        // R = (p4.x/scale) - A - D - Sus
        const currentTotal = newA + newD + sustainVisual;
        let newR = (p4.x / this.timeScale) - currentTotal;
        newR = Math.max(0.01, newR);

        this.values = { a: newA, d: newD, s: newS, r: newR };
        this.onChange(this.values);
        this.draw();
    }

    initEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const pts = this.getPoints();

            // Hit test check (simple radius)
            const r = 10;
            if (this.dist(mouseX, mouseY, pts[1].x, pts[1].y) < r) {
                this.draggingPoint = 1;
            } else if (this.dist(mouseX, mouseY, pts[2].x, pts[2].y) < r) {
                this.draggingPoint = 2;
            } else if (this.dist(mouseX, mouseY, pts[4].x, pts[4].y) < r) {
                this.draggingPoint = 4;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.draggingPoint === null) return;
            const rect = this.canvas.getBoundingClientRect();
            // Allow dragging outside? better Clamp.
            const mouseX = Math.max(0, e.clientX - rect.left);
            const mouseY = Math.max(0, e.clientY - rect.top);

            const pts = this.getPoints();
            // We reconstruct current positions to be safe, but actually we need 'proposed' positions
            // based on what we are dragging.

            let p1 = pts[1];
            let p2 = pts[2];
            let p4 = pts[4];

            if (this.draggingPoint === 1) {
                // Dragging A (Time only, Y fixed at 1.0)
                p1 = { x: mouseX, y: p1.y };
                // Constraint: A < A+D (P2). 
                // Actually if we move A, D duration shifts or maintain D?
                // Logic: Move A, P2 moves too? 
                // Standard: changing A changes the start time of the next segment.
                // Let's implement: X position defines ABSOLUTE time of the point.
                // So if I move P1 right, A increases. P2 stays? Then D decreases.
                // If A > P2.x, then P2 gets pushed?
                // Simpler: Recalculate based on specific logic.
                // Preferred UX: Dragging A changes A duration. D duration stays same -> P2 shifts right.
                // But here I'm converting X to value directly.
                // Let's use the 'Recalculate A,D,S,R' strategy.
            }

            // Re-calc logic helper
            // We update specific value based on delta or pos
            // Let's modify 'values' directly based on mouse pos and re-draw

            const sustainVisual = 1.0;
            const msgScale = this.msgScale;
            const timeScale = this.timeScale;
            const zeroY = this.canvas.height - 20;

            if (this.draggingPoint === 1) {
                // Dragging A
                // X = A * scale
                let newA = mouseX / timeScale;
                this.values.a = Math.max(0.01, newA);
            } else if (this.draggingPoint === 2) {
                // Dragging D/S point
                // X = (A+D) * scale -> D = (X/scale) - A
                let newD = (mouseX / timeScale) - this.values.a;
                this.values.d = Math.max(0.01, newD);

                // Y = zeroY - S*scale
                let newS = (zeroY - mouseY) / msgScale;
                this.values.s = Math.max(0, Math.min(1, newS));
            } else if (this.draggingPoint === 4) {
                // Dragging R end point
                // X = (A+D+Sus+R)*scale
                let startR = (this.values.a + this.values.d + sustainVisual);
                let newR = (mouseX / timeScale) - startR;
                this.values.r = Math.max(0.01, newR);
            }

            this.onChange(this.values);
            this.draw();
        });

        window.addEventListener('mouseup', () => {
            this.draggingPoint = null;
        });
    }

    dist(x1: number, y1: number, x2: number, y2: number) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    setValues(v: ADSR) {
        this.values = { ...v };
        this.draw();
        // Notice: Don't trigger onChange here to avoid loops if driven from outside
    }

    draw() {
        this.ctx.fillStyle = '#1e1e1e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const pts = this.getPoints();

        // Draw Lines
        this.ctx.strokeStyle = '#646cff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            this.ctx.lineTo(pts[i].x, pts[i].y);
        }
        this.ctx.stroke();

        // Draw Points
        this.ctx.fillStyle = '#fff';
        const drawPt = (idx: number) => {
            this.ctx.beginPath();
            this.ctx.arc(pts[idx].x, pts[idx].y, 5, 0, Math.PI * 2);
            this.ctx.fill();
        }
        drawPt(1);
        drawPt(2);
        drawPt(4);

        // Dashed line for Sustain
        this.ctx.strokeStyle = '#888';
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(pts[2].x, pts[2].y);
        this.ctx.lineTo(pts[3].x, pts[3].y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // Labels
        this.ctx.fillStyle = '#aaa';
        this.ctx.font = '10px monospace';
        this.ctx.fillText(`A: ${this.values.a.toFixed(2)}s`, 10, 10);
        this.ctx.fillText(`D: ${this.values.d.toFixed(2)}s`, 10, 22);
        this.ctx.fillText(`S: ${this.values.s.toFixed(2)}`, 10, 34);
        this.ctx.fillText(`R: ${this.values.r.toFixed(2)}s`, 10, 46);
    }
}
