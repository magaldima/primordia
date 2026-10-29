export interface Series {
  label: string;
  color: string;
  values: number[];
}

/**
 * Small canvas time-series chart. "line" draws each series; "stack" draws stacked areas.
 * Hovering shows a crosshair and a tooltip listing every series at that tick.
 */
export class TimeChart {
  private ctx: CanvasRenderingContext2D;
  private ticks: number[] = [];
  private series: Series[] = [];
  private hoverX: number | null = null;
  private tooltip: HTMLDivElement;
  private legend: HTMLDivElement;
  private pad = { l: 34, r: 8, t: 8, b: 18 };

  constructor(
    private canvas: HTMLCanvasElement,
    private mode: "line" | "stack",
    private opts: { yMax?: number; format?: (v: number) => string } = {},
  ) {
    this.ctx = canvas.getContext("2d")!;
    const wrap = canvas.parentElement!;
    this.tooltip = document.createElement("div");
    this.tooltip.className = "chart-tip";
    wrap.appendChild(this.tooltip);
    this.legend = document.createElement("div");
    this.legend.className = "chart-legend";
    wrap.insertBefore(this.legend, canvas);
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.draw();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.style.display = "none";
      this.draw();
    });
  }

  set(ticks: number[], series: Series[]) {
    this.ticks = ticks;
    this.series = series;
    const key = series.map((s) => s.label + s.color).join("|");
    if (this.legend.dataset.key !== key) {
      this.legend.dataset.key = key;
      this.legend.innerHTML = series
        .map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`)
        .join("");
    }
    this.draw();
  }

  private draw() {
    const { canvas, ctx, pad } = this;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.floor(W * dpr)) {
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const n = this.ticks.length;
    if (n < 2) return;
    const fmt = this.opts.format ?? ((v: number) => String(Math.round(v)));

    const stacked = this.mode === "stack" ? cumulative(this.series, n) : this.series.map((s) => s.values);
    let yMax = this.opts.yMax ?? 0;
    if (!this.opts.yMax) for (const v of stacked) for (const x of v) yMax = Math.max(yMax, x);
    yMax = niceCeil(yMax || 1);
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const X = (i: number) => pad.l + (i / (n - 1)) * pw;
    const Y = (v: number) => pad.t + ph - (v / yMax) * ph;

    // Recessive grid and axes.
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#8d8c86";
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(fmt(v), pad.l - 4, y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillText(`t${this.ticks[0]}`, pad.l, H - 4);
    ctx.textAlign = "right";
    ctx.fillText(`t${this.ticks[n - 1]}`, W - pad.r, H - 4);

    if (this.mode === "stack") {
      for (let s = stacked.length - 1; s >= 0; s--) {
        const top = stacked[s];
        const bottom = s > 0 ? stacked[s - 1] : null;
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(top[i]));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(bottom ? bottom[i] : 0));
        ctx.closePath();
        ctx.fillStyle = this.series[s].color;
        ctx.fill();
        // Surface gap between bands.
        ctx.strokeStyle = "#16161a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(top[i]));
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      for (let s = 0; s < stacked.length; s++) {
        ctx.strokeStyle = this.series[s].color;
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(stacked[s][i]));
        ctx.stroke();
      }
    }

    if (this.hoverX !== null && this.hoverX >= pad.l) {
      const i = Math.max(0, Math.min(n - 1, Math.round(((this.hoverX - pad.l) / pw) * (n - 1))));
      const x = X(i);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ph);
      ctx.stroke();
      for (let s = 0; s < stacked.length; s++) {
        ctx.beginPath();
        ctx.arc(x, Y(stacked[s][i]), 4, 0, Math.PI * 2);
        ctx.fillStyle = this.series[s].color;
        ctx.fill();
        ctx.strokeStyle = "#16161a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const rows = this.series
        .map((s) => ({ s, v: s.values[i] ?? 0 }))
        .filter((r) => this.mode === "line" || r.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 8)
        .map((r) => `<div><i style="background:${r.s.color}"></i>${escapeHtml(r.s.label)}<b>${fmt(r.v)}</b></div>`)
        .join("");
      this.tooltip.innerHTML = `<div class="tip-head">Tick ${this.ticks[i]}</div>${rows}`;
      this.tooltip.style.display = "block";
      const left = x + 12 + 160 > W ? x - 172 : x + 12;
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${pad.t + 18}px`;
    }
  }
}

function cumulative(series: Series[], n: number): number[][] {
  const out: number[][] = [];
  let prev = new Array(n).fill(0);
  for (const s of series) {
    const cur = prev.map((p, i) => p + (s.values[i] ?? 0));
    out.push(cur);
    prev = cur;
  }
  return out;
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
