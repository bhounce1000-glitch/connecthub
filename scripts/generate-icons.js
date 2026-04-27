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
    this.pixels = new Uint8Array(w * h * 4); // all transparent black
  }

  _setPixel(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    // Alpha composite over existing
    const fa = a / 255;
    const ba = this.pixels[i + 3] / 255;
    const oa = fa + ba * (1 - fa);
    if (oa === 0) return;
    this.pixels[i]     = Math.round((r * fa + this.pixels[i]     * ba * (1 - fa)) / oa);
    this.pixels[i + 1] = Math.round((g * fa + this.pixels[i + 1] * ba * (1 - fa)) / oa);
    this.pixels[i + 2] = Math.round((b * fa + this.pixels[i + 2] * ba * (1 - fa)) / oa);
    this.pixels[i + 3] = Math.round(oa * 255);
  }

  fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.w - 1, Math.ceil(x1)); x++) {
        this._setPixel(x, y, r, g, b, a);
      }
    }
  }

  /** Filled circle with anti-aliased edge */
  fillCircle(cx, cy, radius, r, g, b, a = 255) {
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const cover = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (cover > 0) this._setPixel(x, y, r, g, b, Math.round(a * cover));
      }
    }
  }

  /** Anti-aliased thick line */
  drawLine(x0, y0, x1, y1, r, g, b, thickness = 1, a = 255) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      this.fillCircle(cx, cy, thickness / 2, r, g, b, a);
    }
  }

  /** Rounded rectangle */
  fillRoundRect(x0, y0, w, h, radius, r, g, b, a = 255) {
    // Fill inner rects
    this.fillRect(x0 + radius, y0, x0 + w - radius, y0 + h, r, g, b, a);
    this.fillRect(x0, y0 + radius, x0 + radius, y0 + h - radius, r, g, b, a);
    this.fillRect(x0 + w - radius, y0 + radius, x0 + w, y0 + h - radius, r, g, b, a);
    // Corner circles
    this.fillCircle(x0 + radius,     y0 + radius,     radius, r, g, b, a);
    this.fillCircle(x0 + w - radius, y0 + radius,     radius, r, g, b, a);
    this.fillCircle(x0 + radius,     y0 + h - radius, radius, r, g, b, a);
    this.fillCircle(x0 + w - radius, y0 + h - radius, radius, r, g, b, a);
  }

  /** Radial gradient fill over a circle — simplified with concentric rings */
  fillCircleGradient(cx, cy, radius, innerRGB, outerRGB, a = 255) {
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist > radius + 0.5) continue;
        const t = Math.min(1, dist / radius);
        const cover = Math.max(0, Math.min(1, radius + 0.5 - dist));
        const r = Math.round(innerRGB[0] * (1 - t) + outerRGB[0] * t);
        const g = Math.round(innerRGB[1] * (1 - t) + outerRGB[1] * t);
        const b = Math.round(innerRGB[2] * (1 - t) + outerRGB[2] * t);
        this._setPixel(x, y, r, g, b, Math.round(a * cover));
      }
    }
  }

  toPNG() {
    return encodePNG(this.pixels, this.w, this.h);
  }
}

// ─── ConnectHub logo drawing ─────────────────────────────────────────────────

const ANGLES_DEG = [-70, 10, 90, 170];

function drawConnectHub(canvas, opts = {}) {
  const {
    bg = true,           // draw background
    bgColor = null,      // override background [r,g,b]
    transparent = false, // no background at all
    mono = false,        // monochrome (black on white)
    scale = 1.0,
    offsetX = 0,
    offsetY = 0,
  } = opts;

  const W = canvas.w;
  const H = canvas.h;
  const cx = W / 2 + offsetX;
  const cy = H / 2 + offsetY;
  const sz = Math.min(W, H) * scale;

  // Background
  if (!transparent && !mono) {
    if (bgColor) {
      canvas.fillRect(0, 0, W, H, ...bgColor);
    } else {
      // Dark navy background with rounded rect
      const rr = W * 0.18;
      canvas.fillRoundRect(0, 0, W, H, rr, 15, 23, 42); // #0f172a base
      // Subtle blue radial glow in center
      canvas.fillCircleGradient(cx, cy * 0.85, sz * 0.55, [30, 58, 138, 140], [15, 23, 42, 0], 255);
    }
  }
  if (mono) {
    canvas.fillRect(0, 0, W, H, 255, 255, 255);
  }

  const hubR     = sz * 0.13;
  const nodeR    = sz * 0.075;
  const spokeLen = sz * 0.28;
  const lineW    = sz * 0.028;

  const nodes = ANGLES_DEG.map(deg => {
    const rad = (deg * Math.PI) / 180;
    return {
      x: cx + Math.cos(rad) * spokeLen,
      y: cy + Math.sin(rad) * spokeLen,
      rad,
    };
  });

  if (mono) {
    // Spokes
    nodes.forEach(n => {
      canvas.drawLine(
        cx + Math.cos(n.rad) * hubR, cy + Math.sin(n.rad) * hubR,
        n.x - Math.cos(n.rad) * nodeR, n.y - Math.sin(n.rad) * nodeR,
        0, 0, 0, lineW
      );
    });
    // Satellite nodes
    nodes.forEach(n => canvas.fillCircle(n.x, n.y, nodeR, 0, 0, 0));
    // Hub
    canvas.fillCircle(cx, cy, hubR, 0, 0, 0);
    canvas.fillCircle(cx, cy, hubR * 0.42, 255, 255, 255);
  } else {
    // Spokes — semi-transparent blue
    nodes.forEach(n => {
      canvas.drawLine(
        cx + Math.cos(n.rad) * hubR, cy + Math.sin(n.rad) * hubR,
        n.x - Math.cos(n.rad) * nodeR, n.y - Math.sin(n.rad) * nodeR,
        147, 197, 253, lineW, 110
      );
    });

    // Satellite nodes — gradient blue
    nodes.forEach(n => {
      // Soft glow halo
      canvas.fillCircleGradient(n.x, n.y, nodeR * 2.2, [96, 165, 250, 60], [96, 165, 250, 0], 255);
      // Node
      canvas.fillCircleGradient(n.x, n.y, nodeR, [147, 197, 253], [59, 130, 246]);
    });

    // Hub glow halo
    canvas.fillCircleGradient(cx, cy, hubR * 2.5, [59, 130, 246, 100], [59, 130, 246, 0], 255);

    // Hub — gradient center
    canvas.fillCircleGradient(cx, cy, hubR, [219, 234, 254], [37, 99, 235]);

    // Hub inner dot
    canvas.fillCircle(cx, cy, hubR * 0.36, 255, 255, 255);
  }
}

// ─── Asset generators ────────────────────────────────────────────────────────

function makeIcon(size) {
  const c = new Canvas(size, size);
  drawConnectHub(c);
  return c;
}

function makeForeground(size) {
  const c = new Canvas(size, size);
  drawConnectHub(c, { transparent: true, scale: 0.62 });
  return c;
}

function makeBackground(size) {
  const c = new Canvas(size, size);
  c.fillRect(0, 0, size, size, 30, 58, 138); // #1e3a8a
  return c;
}

function makeMonochrome(size) {
  const c = new Canvas(size, size);
  drawConnectHub(c, { mono: true });
  return c;
}

function makeSplash(w, h) {
  const c = new Canvas(w, h);
  // Navy gradient background
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = Math.round(15 * (1 - t) + 30 * t);
    const g = Math.round(23 * (1 - t) + 58 * t);
    const b = Math.round(42 * (1 - t) + 138 * t);
    c.fillRect(0, y, w, y + 1, r, g, b);
  }
  drawConnectHub(c, { bg: false, scale: 0.32, offsetY: -h * 0.06 });
  return c;
}

function makeFavicon(size) {
  const c = new Canvas(size, size);
  // Blue rounded square background
  const rr = size * 0.18;
  c.fillRoundRect(0, 0, size, size, rr, 37, 99, 235);
  drawConnectHub(c, { bg: false, scale: 0.72 });
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
