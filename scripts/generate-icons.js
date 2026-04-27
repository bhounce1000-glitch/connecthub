/**
 * ConnectHub icon generator — pure Node.js, no external dependencies.
 * Writes raw PNG files using a minimal hand-rolled PNG encoder.
 * Run:  node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Minimal PNG writer ──────────────────────────────────────────────────────

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = u32be(data.length);
  const crcBuf = u32be(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * pixels: Uint8Array of length w*h*4 (RGBA row-major)
 */
function encodePNG(pixels, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw scanlines (filter byte 0 = None per row)
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (1 + w * 4) + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', iend),
  ]);
}

// ─── Software rasterizer ────────────────────────────────────────────────────

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.pixels = new Uint8Array(w * h * 4);
  }

  _blend(i, r, g, b, a) {
    const fa = a / 255;
    const ba = this.pixels[i + 3] / 255;
    const oa = fa + ba * (1 - fa);
    if (oa === 0) return;
    this.pixels[i]     = Math.round((r * fa + this.pixels[i]     * ba * (1 - fa)) / oa);
    this.pixels[i + 1] = Math.round((g * fa + this.pixels[i + 1] * ba * (1 - fa)) / oa);
    this.pixels[i + 2] = Math.round((b * fa + this.pixels[i + 2] * ba * (1 - fa)) / oa);
    this.pixels[i + 3] = Math.round(oa * 255);
  }

  _setPixel(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this._blend((y * this.w + x) * 4, r, g, b, a);
  }

  // Fast solid fill (no blending needed for opaque rects)
  fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.w - 1, Math.ceil(x1)); x++)
        this._blend((y * this.w + x) * 4, r, g, b, a);
  }

  // AA circle fill
  fillCircle(cx, cy, radius, r, g, b, a = 255) {
    for (let y = Math.max(0, Math.floor(cy - radius - 1)); y <= Math.min(this.h - 1, Math.ceil(cy + radius + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius - 1)); x <= Math.min(this.w - 1, Math.ceil(cx + radius + 1)); x++) {
        const cover = Math.max(0, Math.min(1, radius + 0.5 - Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)));
        if (cover > 0) this._blend((y * this.w + x) * 4, r, g, b, Math.round(a * cover));
      }
    }
  }

  // AA circle with ring border
  strokeCircle(cx, cy, radius, thickness, r, g, b, a = 255) {
    const outer = radius + thickness / 2;
    const inner = radius - thickness / 2;
    for (let y = Math.max(0, Math.floor(cy - outer - 1)); y <= Math.min(this.h - 1, Math.ceil(cy + outer + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - outer - 1)); x <= Math.min(this.w - 1, Math.ceil(cx + outer + 1)); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const cover = Math.max(0, Math.min(1, outer + 0.5 - dist)) * Math.max(0, Math.min(1, dist - inner + 0.5));
        if (cover > 0) this._blend((y * this.w + x) * 4, r, g, b, Math.round(a * cover));
      }
    }
  }

  // Radial gradient circle
  fillCircleGrad(cx, cy, radius, [r0, g0, b0], [r1, g1, b1], a = 255) {
    for (let y = Math.max(0, Math.floor(cy - radius - 1)); y <= Math.min(this.h - 1, Math.ceil(cy + radius + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius - 1)); x <= Math.min(this.w - 1, Math.ceil(cx + radius + 1)); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const cover = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (cover <= 0) continue;
        const t = Math.min(1, dist / radius);
        this._blend((y * this.w + x) * 4,
          Math.round(r0 + (r1 - r0) * t),
          Math.round(g0 + (g1 - g0) * t),
          Math.round(b0 + (b1 - b0) * t),
          Math.round(a * cover));
      }
    }
  }

  // Linear gradient rect (vertical)
  fillRectGradV(x0, y0, x1, y1, [r0,g0,b0], [r1,g1,b1]) {
    const h = y1 - y0;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      const t = h > 0 ? (y - y0) / h : 0;
      const r = Math.round(r0 + (r1 - r0) * t);
      const g = Math.round(g0 + (g1 - g0) * t);
      const b = Math.round(b0 + (b1 - b0) * t);
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.w - 1, Math.ceil(x1)); x++)
        this._blend((y * this.w + x) * 4, r, g, b, 255);
    }
  }

  // AA rounded rect fill
  fillRoundRect(x0, y0, w, h, radius, r, g, b, a = 255) {
    this.fillRect(x0 + radius, y0, x0 + w - radius, y0 + h, r, g, b, a);
    this.fillRect(x0, y0 + radius, x0 + w, y0 + h - radius, r, g, b, a);
    this.fillCircle(x0 + radius,     y0 + radius,     radius, r, g, b, a);
    this.fillCircle(x0 + w - radius, y0 + radius,     radius, r, g, b, a);
    this.fillCircle(x0 + radius,     y0 + h - radius, radius, r, g, b, a);
    this.fillCircle(x0 + w - radius, y0 + h - radius, radius, r, g, b, a);
  }

  // AA thick line via stamped circles
  drawLine(x0, y0, x1, y1, r, g, b, thickness, a = 255) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const steps = Math.ceil(len * 1.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, thickness / 2, r, g, b, a);
    }
  }

  toPNG() { return encodePNG(this.pixels, this.w, this.h); }
}

// ─── ConnectHub v3 — Premium internet-professional design ────────────────────
//
//  Design language (Stripe / Linear / Notion tier):
//  • Near-black background #080D1A with a very subtle diagonal tint
//  • Bold cross-pattern: 1 hub + 4 cardinal nodes (N/S/E/W) — clean symmetry
//  • Thick, solid white connector bars — not lines, actual bars with rounded caps
//  • Hub: large vivid indigo circle (no ring clutter)
//  • Nodes: bright blue circles, white — clear contrast
//  • No glows. No gradients on lines. Just geometry.
//  • Generous padding — breathes like a real app icon

function drawLogo(canvas, opts = {}) {
  const {
    transparent = false,
    mono = false,
    scale = 1.0,
    offsetX = 0,
    offsetY = 0,
  } = opts;

  const W = canvas.w;
  const H = canvas.h;
  const cx = W / 2 + offsetX;
  const cy = H / 2 + offsetY;
  const sz = Math.min(W, H) * scale;

  // ── Background ──────────────────────────────────────────────────────────
  if (!transparent && !mono) {
    // Near-black with very subtle blue warmth
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = Math.round(8  + 4  * t);
      const g = Math.round(13 + 5  * t);
      const b = Math.round(26 + 14 * t);
      canvas.fillRect(0, y, W, y + 1, r, g, b, 255);
    }
    // Diagonal highlight: top-left slightly lighter (like Linear)
    for (let y = 0; y < H * 0.55; y++) {
      const fade = Math.max(0, 1 - y / (H * 0.55));
      const alpha = Math.round(18 * fade);
      canvas.fillRect(0, y, W * (1 - y / H), y + 1, 99, 102, 241, alpha);
    }
  }
  if (mono) {
    canvas.fillRect(0, 0, W, H, 255, 255, 255);
  }

  // ── Sizing constants ─────────────────────────────────────────────────────
  const HUB_R  = sz * 0.13;   // central hub radius
  const NODE_R = sz * 0.072;  // satellite node radius
  const REACH  = sz * 0.285;  // center → node center
  const BAR_W  = sz * 0.048;  // connector bar thickness (chunky = bold)
  const RING   = sz * 0.014;  // white ring on nodes

  // 4 cardinal nodes
  const DIRS = [
    { x: cx,          y: cy - REACH, rad: -Math.PI / 2 }, // N
    { x: cx + REACH,  y: cy,         rad: 0             }, // E
    { x: cx,          y: cy + REACH, rad:  Math.PI / 2  }, // S
    { x: cx - REACH,  y: cy,         rad: Math.PI       }, // W
  ];

  if (mono) {
    // ── Mono ──
    DIRS.forEach(n => {
      canvas.drawLine(
        cx + Math.cos(n.rad) * HUB_R, cy + Math.sin(n.rad) * HUB_R,
        n.x - Math.cos(n.rad) * NODE_R, n.y - Math.sin(n.rad) * NODE_R,
        0, 0, 0, BAR_W * 0.65
      );
    });
    DIRS.forEach(n => {
      canvas.fillCircle(n.x, n.y, NODE_R, 0, 0, 0);
      canvas.fillCircle(n.x, n.y, NODE_R * 0.42, 255, 255, 255);
    });
    canvas.fillCircle(cx, cy, HUB_R, 0, 0, 0);
    canvas.fillCircle(cx, cy, HUB_R * 0.38, 255, 255, 255);
    return;
  }

  // ── Connector bars (drawn first, behind nodes + hub) ──
  // Solid pure white — this is what makes it look like a pro icon set
  DIRS.forEach(n => {
    const sx = cx + Math.cos(n.rad) * (HUB_R + 2);
    const sy = cy + Math.sin(n.rad) * (HUB_R + 2);
    const ex = n.x - Math.cos(n.rad) * (NODE_R + 2);
    const ey = n.y - Math.sin(n.rad) * (NODE_R + 2);
    canvas.drawLine(sx, sy, ex, ey, 255, 255, 255, BAR_W, 255);
  });

  // ── Satellite nodes ──
  // White outer ring then vivid blue fill
  DIRS.forEach(n => {
    canvas.fillCircle(n.x, n.y, NODE_R, 255, 255, 255, 255);
    canvas.fillCircleGrad(n.x, n.y, NODE_R - RING,
      [96,  165, 250],   // #60a5fa (sky blue center)
      [37,  99,  235]    // #2563eb (electric blue edge)
    );
  });

  // ── Central hub ──
  // Vivid indigo — the boldest element, the focal point
  canvas.fillCircleGrad(cx, cy, HUB_R,
    [129, 140, 248],   // #818cf8 indigo highlight
    [79,  70,  229]    // #4f46e5 deep indigo
  );
  // Crisp white inner dot — shows "this is the center"
  canvas.fillCircle(cx, cy, HUB_R * 0.32, 255, 255, 255, 255);
}

// ─── Asset generators ────────────────────────────────────────────────────────

function makeIcon(size) {
  const c = new Canvas(size, size);
  const rr = size * 0.22;
  // Premium near-black rounded square
  c.fillRoundRect(0, 0, size, size, rr, 8, 13, 26);
  // Subtle diagonal tint (top-left lighter)
  for (let y = 0; y < size * 0.55; y++) {
    const fade = Math.max(0, 1 - y / (size * 0.55));
    const alpha = Math.round(22 * fade);
    if (alpha > 0) c.fillRect(0, y, size, y + 1, 99, 102, 241, alpha);
  }
  drawLogo(c, { transparent: true });
  return c;
}

function makeForeground(size) {
  const c = new Canvas(size, size);
  drawLogo(c, { transparent: true, scale: 0.62 });
  return c;
}

function makeBackground(size) {
  const c = new Canvas(size, size);
  c.fillRectGradV(0, 0, size, size, [8, 13, 26], [17, 24, 68]);
  return c;
}

function makeMonochrome(size) {
  const c = new Canvas(size, size);
  drawLogo(c, { mono: true, scale: 0.78 });
  return c;
}

function makeSplash(w, h) {
  const c = new Canvas(w, h);
  // Deep near-black gradient
  c.fillRectGradV(0, 0, w, h, [8, 13, 26], [12, 18, 45]);
  drawLogo(c, { transparent: true, scale: 0.35, offsetY: -h * 0.04 });
  return c;
}

function makeFavicon(size) {
  const c = new Canvas(size, size);
  c.fillRoundRect(0, 0, size, size, size * 0.22, 8, 13, 26);
  drawLogo(c, { transparent: true, scale: 0.76 });
  return c;
}

// ─── Write files ─────────────────────────────────────────────────────────────

const OUT = path.join(__dirname, '..', 'assets', 'images');

const assets = [
  { file: 'icon.png',                    gen: () => makeIcon(1024) },
  { file: 'android-icon-foreground.png', gen: () => makeForeground(1024) },
  { file: 'android-icon-background.png', gen: () => makeBackground(1024) },
  { file: 'android-icon-monochrome.png', gen: () => makeMonochrome(1024) },
  { file: 'splash-icon.png',             gen: () => makeSplash(1284, 2778) },
  { file: 'favicon.png',                 gen: () => makeFavicon(64) },
];

console.log('Generating ConnectHub icons...\n');

for (const { file, gen } of assets) {
  process.stdout.write(`  ${file.padEnd(36)}`);
  const canvas = gen();
  const png = canvas.toPNG();
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(`${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nDone! All icons saved to assets/images/');
