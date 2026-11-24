// ============================================================================
// MUMAX0 — Motor de Visualização Elucidativa (.ovf + table.txt)
// Parser OVF 2.0/1.0 (Binary 4, Binary 8, Text), Renderização Editorial HD,
// Roda de Cores HSL, Colorbar Divergente, Símbolos ⊙/⊗, Comparação e FFT.
// ============================================================================

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ==========================================================================
  // 1. PARSER OVF 2.0 / 1.0 (Binary 4, Binary 8, Text)
  // ==========================================================================
  function parseOVF(arrayBuffer, filename = "campo.ovf") {
    const bytes = new Uint8Array(arrayBuffer);
    // Decode first 16 KB safely as latin1 to locate header & data marker
    const headerScanLen = Math.min(bytes.length, 16384);
    let headerStr = "";
    for (let i = 0; i < headerScanLen; i++) {
      headerStr += String.fromCharCode(bytes[i]);
    }

    const beginDataRe = /#\s*Begin:\s*Data\s+(Binary\s+4|Binary\s+8|Text)\s*\r?\n/i;
    const match = beginDataRe.exec(headerStr);
    if (!match) {
      throw new Error(`Cabeçalho OVF inválido em ${filename}: marcador "Begin: Data" não encontrado.`);
    }

    const dataMode = match[1].toLowerCase().replace(/\s+/g, " ");
    const dataOffset = match.index + match[0].length;
    const headerText = headerStr.slice(0, match.index);

    const meta = {
      filename,
      title: "m",
      xnodes: 1,
      ynodes: 1,
      znodes: 1,
      xstepsize: 1e-9,
      ystepsize: 1e-9,
      zstepsize: 1e-9,
      valuedim: 3,
      timeS: null
    };

    headerText.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line.startsWith("#")) return;
      const body = line.slice(1).trim();
      const colonIdx = body.indexOf(":");
      if (colonIdx < 0) return;
      const key = body.slice(0, colonIdx).trim().toLowerCase();
      const val = body.slice(colonIdx + 1).trim();

      if (key === "title") meta.title = val;
      else if (key === "xnodes") meta.xnodes = parseInt(val, 10) || 1;
      else if (key === "ynodes") meta.ynodes = parseInt(val, 10) || 1;
      else if (key === "znodes") meta.znodes = parseInt(val, 10) || 1;
      else if (key === "xstepsize") meta.xstepsize = parseFloat(val) || 1e-9;
      else if (key === "ystepsize") meta.ystepsize = parseFloat(val) || 1e-9;
      else if (key === "zstepsize") meta.zstepsize = parseFloat(val) || 1e-9;
      else if (key === "valuedim") meta.valuedim = parseInt(val, 10) || 3;
      else if (key === "desc") {
        const tm = /total\s+simulation\s+time:\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(val);
        if (tm) meta.timeS = parseFloat(tm[1]);
      }
    });

    const totalCells = meta.xnodes * meta.ynodes * meta.znodes;
    const totalFloats = totalCells * meta.valuedim;
    const data = new Float32Array(totalFloats);

    if (dataMode === "binary 4") {
      const view = new DataView(arrayBuffer, dataOffset);
      if (view.byteLength < 4 + totalFloats * 4) {
        throw new Error(`Arquivo OVF truncado (${filename}).`);
      }
      const testLE = view.getFloat32(0, true);
      const testBE = view.getFloat32(0, false);
      const littleEndian = Math.abs(testLE - 1234567.0) < Math.abs(testBE - 1234567.0);
      let pos = 4;
      for (let i = 0; i < totalFloats; i++, pos += 4) {
        data[i] = view.getFloat32(pos, littleEndian);
      }
    } else if (dataMode === "binary 8") {
      const view = new DataView(arrayBuffer, dataOffset);
      if (view.byteLength < 8 + totalFloats * 8) {
        throw new Error(`Arquivo OVF Binary 8 truncado (${filename}).`);
      }
      const magic = 123456789012345.0;
      const testLE = view.getFloat64(0, true);
      const testBE = view.getFloat64(0, false);
      const littleEndian = Math.abs(testLE - magic) < Math.abs(testBE - magic);
      let pos = 8;
      for (let i = 0; i < totalFloats; i++, pos += 8) {
        data[i] = view.getFloat64(pos, littleEndian);
      }
    } else {
      // Data Text
      const decoder = new TextDecoder("latin1");
      const textBody = decoder.decode(bytes.subarray(dataOffset));
      const lines = textBody.split(/\r?\n/);
      let idx = 0;
      for (let li = 0; li < lines.length && idx < totalFloats; li++) {
        const ln = lines[li].trim();
        if (!ln || ln.startsWith("#")) continue;
        const parts = ln.split(/\s+/);
        for (let p = 0; p < parts.length && idx < totalFloats; p++) {
          data[idx++] = parseFloat(parts[p]) || 0;
        }
      }
    }

    const stats = computeSliceStats(meta, data, 0);
    return {
      ...meta,
      lxNm: meta.xnodes * meta.xstepsize * 1e9,
      lyNm: meta.ynodes * meta.ystepsize * 1e9,
      lzNm: meta.znodes * meta.zstepsize * 1e9,
      data,
      stats
    };
  }

  function computeSliceStats(meta, data, zSlice) {
    const nx = meta.xnodes;
    const ny = meta.ynodes;
    const vdim = meta.valuedim;
    const z = Math.max(0, Math.min(meta.znodes - 1, zSlice));
    const zOff = z * nx * ny;

    let active = 0;
    let sx = 0, sy = 0, sz = 0;
    const activeMask = new Uint8Array(nx * ny);

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = (zOff + j * nx + i) * vdim;
        const mx = data[idx] || 0;
        const my = vdim > 1 ? data[idx + 1] || 0 : 0;
        const mz = vdim > 2 ? data[idx + 2] || 0 : 0;
        const mag = Math.hypot(mx, my, mz);
        if (mag > 1e-3) {
          activeMask[j * nx + i] = 1;
          active++;
          sx += mx;
          sy += my;
          sz += mz;
        }
      }
    }

    // Berg & Lüscher lattice topological charge Q on slice z
    let qSum = 0;
    if (vdim >= 3 && active > 4) {
      const getVec = (i, j) => {
        const idx = (zOff + j * nx + i) * vdim;
        const x = data[idx], y = data[idx + 1], zc = data[idx + 2];
        const m = Math.hypot(x, y, zc) || 1;
        return [x / m, y / m, zc / m];
      };
      const triSolidAngle = (a, b, c) => {
        const num =
          a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0]);
        const den =
          1 +
          (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) +
          (b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) +
          (c[0] * a[0] + c[1] * a[1] + c[2] * a[2]);
        return 2 * Math.atan2(num, den);
      };

      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const m00 = activeMask[j * nx + i];
          const m10 = activeMask[j * nx + i + 1];
          const m01 = activeMask[(j + 1) * nx + i];
          const m11 = activeMask[(j + 1) * nx + i + 1];
          if (!(m00 && m10 && m01 && m11)) continue;
          const v00 = getVec(i, j);
          const v10 = getVec(i + 1, j);
          const v01 = getVec(i, j + 1);
          const v11 = getVec(i + 1, j + 1);
          qSum += triSolidAngle(v00, v10, v11) + triSolidAngle(v00, v11, v01);
        }
      }
    }

    const denom = Math.max(1, active);
    return {
      activeCells: active,
      fillFrac: active / (nx * ny),
      mxAvg: sx / denom,
      myAvg: sy / denom,
      mzAvg: sz / denom,
      qTop: qSum / (4 * Math.PI),
      activeMask
    };
  }

  // ==========================================================================
  // 2. COLORMAPS CIENTÍFICOS (HSL MuMax, Divergente RdBu, Inferno)
  // ==========================================================================
  function hslToRgb(hDeg, s, l) {
    const h = ((hDeg % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  // Diverging Blue (-1) -> White (0) -> Red (+1) (ColorBrewer RdBu inspired)
  function divergingRdBu(val) {
    const v = Math.max(-1, Math.min(1, val));
    if (v >= 0) {
      // White (248, 250, 252) -> Crimson (185, 28, 28)
      const t = v;
      const r = Math.round(248 - t * (248 - 185));
      const g = Math.round(250 - t * (250 - 28));
      const b = Math.round(252 - t * (252 - 28));
      return [r, g, b];
    } else {
      // White (248, 250, 252) -> Deep Blue (29, 78, 216)
      const t = -v;
      const r = Math.round(248 - t * (248 - 29));
      const g = Math.round(250 - t * (250 - 78));
      const b = Math.round(252 - t * (252 - 216));
      return [r, g, b];
    }
  }

  // Inferno-like sequential map for gradient |∇m| in [0, 1]
  function infernoMap(tRaw) {
    const t = Math.max(0, Math.min(1, tRaw));
    const stops = [
      [0.0, 20, 11, 52],
      [0.25, 101, 21, 110],
      [0.5, 188, 55, 84],
      [0.75, 249, 142, 9],
      [1.0, 252, 255, 164]
    ];
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k], b = stops[k + 1];
      if (t <= b[0]) {
        const f = (t - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1] + f * (b[1] - a[1])),
          Math.round(a[2] + f * (b[2] - a[2])),
          Math.round(a[3] + f * (b[3] - a[3]))
        ];
      }
    }
    return [252, 255, 164];
  }

  function mapCellColor(mode, mx, my, mz, gradNorm) {
    if (mode === "hsl") {
      const phi = (Math.atan2(my, mx) * 180) / Math.PI;
      const l = 0.5 + 0.46 * Math.max(-1, Math.min(1, mz));
      const s = 0.92 * (1 - 0.15 * Math.abs(mz));
      return hslToRgb(phi, s, l);
    }
    if (mode === "angle") {
      const phi = (Math.atan2(my, mx) * 180) / Math.PI;
      return hslToRgb(phi, 0.9, 0.5);
    }
    if (mode === "mz") return divergingRdBu(mz);
    if (mode === "mx") return divergingRdBu(mx);
    if (mode === "my") return divergingRdBu(my);
    if (mode === "grad") return infernoMap(gradNorm);
    return [200, 200, 200];
  }

  // ==========================================================================
  // 3. RENDERIZADOR EDITORIAL DE ALTA CLAREZA (1 ou 2 painéis lado a lado)
  // ==========================================================================
  function niceStep(range, targetTicks = 4) {
    if (range <= 0) return 1;
    const raw = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    if (norm < 1.5) return 1 * mag;
    if (norm < 3.5) return 2 * mag;
    if (norm < 7.5) return 5 * mag;
    return 10 * mag;
  }

  function drawColorWheel(ctx, cx, cy, radius, includeZBar) {
    // Draw pixel-accurate color wheel onto offscreen canvas for crispness
    const size = Math.ceil(radius * 2 + 4);
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    const img = octx.createImageData(size, size);
    const half = size / 2;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - half;
        const dy = -(py - half); // +y is up
        const r = Math.hypot(dx, dy);
        if (r <= radius) {
          const phi = (Math.atan2(dy, dx) * 180) / Math.PI;
          const frac = r / radius;
          const [R, G, B] = hslToRgb(phi, 0.92, 0.5 + (1 - frac) * 0.45 * 0);
          // Ring style or full disk: full hue disk with white center for +z feel
          const [Rf, Gf, Bf] = includeZBar
            ? hslToRgb(phi, 0.92, 0.5)
            : hslToRgb(phi, 0.92, 0.5);
          const p = (py * size + px) * 4;
          img.data[p] = Rf;
          img.data[p + 1] = Gf;
          img.data[p + 2] = Bf;
          img.data[p + 3] = 255;
        }
      }
    }
    octx.putImageData(img, 0, 0);

    // Punch clean center hole so wheel looks modern & crisp
    octx.globalCompositeOperation = "destination-out";
    octx.beginPath();
    octx.arc(half, half, radius * 0.34, 0, Math.PI * 2);
    octx.fill();
    octx.globalCompositeOperation = "source-over";

    ctx.drawImage(off, cx - half, cy - half);

    // Outline rings
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.34, 0, Math.PI * 2);
    ctx.stroke();

    // Direction labels (+x, +y, -x, -y)
    ctx.fillStyle = "#1e293b";
    ctx.font = "700 10.5px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+x", cx + radius + 12, cy);
    ctx.fillText("−x", cx - radius - 13, cy);
    ctx.fillText("+y", cx, cy - radius - 10);
    ctx.fillText("−y", cx, cy + radius + 11);

    // Small arrows inside/around wheel
    ctx.fillStyle = "#475569";
    ctx.font = "600 9.5px Segoe UI, sans-serif";
    ctx.fillText("φ", cx, cy);

    // Optional mz luminance strip below wheel
    if (includeZBar) {
      const bw = radius * 1.9;
      const bh = 11;
      const bx = cx - bw / 2;
      const by = cy + radius + 28;
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, "#0b0f19");
      grad.addColorStop(0.5, "#94a3b8");
      grad.addColorStop(1, "#ffffff");
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = "#334155";
      ctx.font = "600 9.5px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("−z", bx, by + bh + 9);
      ctx.textAlign = "center";
      ctx.fillText("mz = 0", cx, by + bh + 9);
      ctx.textAlign = "right";
      ctx.fillText("+z", bx + bw, by + bh + 9);
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function drawColorbar(ctx, x, y, w, h, mode) {
    const steps = Math.max(40, Math.round(h));
    for (let k = 0; k < steps; k++) {
      const frac = 1 - k / (steps - 1); // top = 1, bottom = 0
      const rgb = mode === "grad" ? infernoMap(frac) : divergingRdBu(frac * 2 - 1);
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(x, y + (k / steps) * h, w, h / steps + 1);
    }
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    const ticks = mode === "grad" ? [1, 0.5, 0] : [1, 0.5, 0, -0.5, -1];
    ctx.fillStyle = "#1e293b";
    ctx.font = "600 10px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ticks.forEach((tv) => {
      const frac = mode === "grad" ? 1 - tv : (1 - tv) / 2;
      const ty = y + frac * h;
      ctx.beginPath();
      ctx.moveTo(x + w, ty);
      ctx.lineTo(x + w + 4, ty);
      ctx.stroke();
      const label = mode === "grad" ? (tv === 1 ? "Alto" : tv === 0 ? "0" : "Méd") : (tv > 0 ? `+${tv.toFixed(1)}` : tv.toFixed(1));
      ctx.fillText(label, x + w + 6, ty);
    });

    const titleMap = { mz: "m_z", mx: "m_x", my: "m_y", grad: "|∇m|" };
    ctx.font = "700 11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(titleMap[mode] || mode, x + w / 2, y - 12);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function drawVectorArrow(ctx, x1, y1, x2, y2, headLen, isDarkBg) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const halo = isDarkBg ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.78)";
    const main = isDarkBg ? "#f8fafc" : "#0f172a";

    // Halo stroke for guaranteed legibility
    ctx.lineCap = "round";
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Shaft
    ctx.strokeStyle = main;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrowhead
    ctx.fillStyle = main;
    ctx.strokeStyle = halo;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function renderSinglePanel(ctx, ovf, rect, opts, showLegend) {
    const { x: rx, y: ry, w: rw, h: rh } = rect;
    const zSlice = Math.max(0, Math.min(ovf.znodes - 1, opts.zSlice || 0));
    const stats = zSlice === 0 ? ovf.stats : computeSliceStats(ovf, ovf.data, zSlice);
    const nx = ovf.xnodes;
    const ny = ovf.ynodes;
    const vdim = ovf.valuedim;
    const zOff = zSlice * nx * ny;

    const padTop = 34;
    const padBottom = opts.showSummary ? 56 : 36;
    const padLeft = opts.showAxes ? 48 : 14;
    const padRight = showLegend && opts.showLegend ? 108 : 16;

    const availW = Math.max(60, rw - padLeft - padRight);
    const availH = Math.max(60, rh - padTop - padBottom);
    const aspect = ovf.lxNm / Math.max(1e-6, ovf.lyNm);

    let drawW = availW;
    let drawH = drawW / aspect;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * aspect;
    }
    const ox = rx + padLeft + (availW - drawW) / 2;
    const oy = ry + padTop + (availH - drawH) / 2;

    // 1. Precompute |∇m| if needed
    let gradArr = null;
    let maxGrad = 1e-6;
    if (opts.colorMode === "grad") {
      gradArr = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (!stats.activeMask[j * nx + i]) continue;
          const cIdx = (zOff + j * nx + i) * vdim;
          const ip = Math.min(nx - 1, i + 1), im = Math.max(0, i - 1);
          const jp = Math.min(ny - 1, j + 1), jm = Math.max(0, j - 1);
          const ixp = stats.activeMask[j * nx + ip] ? (zOff + j * nx + ip) * vdim : cIdx;
          const ixm = stats.activeMask[j * nx + im] ? (zOff + j * nx + im) * vdim : cIdx;
          const iyp = stats.activeMask[jp * nx + i] ? (zOff + jp * nx + i) * vdim : cIdx;
          const iym = stats.activeMask[jm * nx + i] ? (zOff + jm * nx + i) * vdim : cIdx;

          let g2 = 0;
          for (let c = 0; c < Math.min(3, vdim); c++) {
            const dx = (ovf.data[ixp + c] - ovf.data[ixm + c]) * 0.5;
            const dy = (ovf.data[iyp + c] - ovf.data[iym + c]) * 0.5;
            g2 += dx * dx + dy * dy;
          }
          const g = Math.sqrt(g2);
          gradArr[j * nx + i] = g;
          if (g > maxGrad) maxGrad = g;
        }
      }
    }

    // 2. Render full-resolution field image onto offscreen pixel canvas (y=0 at bottom!)
    const fieldCanvas = document.createElement("canvas");
    fieldCanvas.width = nx;
    fieldCanvas.height = ny;
    const fctx = fieldCanvas.getContext("2d");
    const imgData = fctx.createImageData(nx, ny);
    const lumGrid = new Float32Array(nx * ny);

    for (let j = 0; j < ny; j++) {
      const py = ny - 1 - j; // OVF y=0 is bottom
      for (let i = 0; i < nx; i++) {
        const p = (py * nx + i) * 4;
        if (!stats.activeMask[j * nx + i]) {
          // Clean neutral vacuum color (distinct from black -mz!)
          imgData.data[p] = 237;
          imgData.data[p + 1] = 241;
          imgData.data[p + 2] = 247;
          imgData.data[p + 3] = 255;
          lumGrid[j * nx + i] = 0.94;
          continue;
        }
        const idx = (zOff + j * nx + i) * vdim;
        const mx = ovf.data[idx] || 0;
        const my = vdim > 1 ? ovf.data[idx + 1] || 0 : 0;
        const mz = vdim > 2 ? ovf.data[idx + 2] || 0 : 0;
        const gNorm = gradArr ? Math.pow(gradArr[j * nx + i] / maxGrad, 0.7) : 0;
        const [R, G, B] = mapCellColor(opts.colorMode, mx, my, mz, gNorm);
        imgData.data[p] = R;
        imgData.data[p + 1] = G;
        imgData.data[p + 2] = B;
        imgData.data[p + 3] = 255;
        lumGrid[j * nx + i] = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      }
    }
    fctx.putImageData(imgData, 0, 0);

    // Draw scaled crisp image
    ctx.save();
    ctx.imageSmoothingEnabled = opts.smoothPixels;
    ctx.drawImage(fieldCanvas, ox, oy, drawW, drawH);
    ctx.restore();

    // 3. Draw crisp sample boundary contour (vacuum vs active material)
    const cellPxX = drawW / nx;
    const cellPxY = drawH / ny;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let j = 0; j < ny; j++) {
      const yTop = oy + (ny - 1 - j) * cellPxY;
      for (let i = 0; i < nx; i++) {
        if (!stats.activeMask[j * nx + i]) continue;
        const xLeft = ox + i * cellPxX;
        if (i === 0 || !stats.activeMask[j * nx + i - 1]) {
          ctx.moveTo(xLeft, yTop);
          ctx.lineTo(xLeft, yTop + cellPxY);
        }
        if (i === nx - 1 || !stats.activeMask[j * nx + i + 1]) {
          ctx.moveTo(xLeft + cellPxX, yTop);
          ctx.lineTo(xLeft + cellPxX, yTop + cellPxY);
        }
        if (j === ny - 1 || !stats.activeMask[(j + 1) * nx + i]) {
          ctx.moveTo(xLeft, yTop);
          ctx.lineTo(xLeft + cellPxX, yTop);
        }
        if (j === 0 || !stats.activeMask[(j - 1) * nx + i]) {
          ctx.moveTo(xLeft, yTop + cellPxY);
          ctx.lineTo(xLeft + cellPxX, yTop + cellPxY);
        }
      }
    }
    ctx.stroke();

    // 4. Optional iso-contour overlay (mz = 0 walls & |mz| = 0.5 core boundaries)
    if (opts.showContours && vdim >= 3) {
      ctx.strokeStyle = "rgba(15, 23, 42, 0.72)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let j = 0; j < ny - 1; j++) {
        const yMid = oy + (ny - 1 - j) * cellPxY;
        for (let i = 0; i < nx - 1; i++) {
          if (!stats.activeMask[j * nx + i]) continue;
          const mz0 = ovf.data[(zOff + j * nx + i) * vdim + 2];
          if (stats.activeMask[j * nx + i + 1]) {
            const mzR = ovf.data[(zOff + j * nx + i + 1) * vdim + 2];
            if ((mz0 - 0.5) * (mzR - 0.5) <= 0 || (mz0 + 0.5) * (mzR + 0.5) <= 0) {
              const xEdge = ox + (i + 1) * cellPxX;
              ctx.moveTo(xEdge, yMid);
              ctx.lineTo(xEdge, yMid + cellPxY);
            }
          }
          if (stats.activeMask[(j + 1) * nx + i]) {
            const mzU = ovf.data[(zOff + (j + 1) * nx + i) * vdim + 2];
            if ((mz0 - 0.5) * (mzU - 0.5) <= 0 || (mz0 + 0.5) * (mzU + 0.5) <= 0) {
              const xLeft = ox + i * cellPxX;
              ctx.moveTo(xLeft, yMid);
              ctx.lineTo(xLeft + cellPxX, yMid);
            }
          }
        }
      }
      ctx.stroke();
    }

    // 5. Smart High-Contrast Vector Arrows + Out-of-Plane ⊙ / ⊗ Markers
    if (opts.showVectors && vdim >= 2) {
      const targetMaxArrows = opts.arrowDensity || 18;
      const stride = Math.max(1, Math.round(Math.max(nx, ny) / targetMaxArrows));
      const baseLen = Math.min(stride * cellPxX, stride * cellPxY) * 0.44 * (opts.arrowScale || 1.0);
      const headLen = Math.max(3.5, Math.min(8, baseLen * 0.55));
      const startOff = Math.floor(stride / 2);

      for (let j = startOff; j < ny; j += stride) {
        for (let i = startOff; i < nx; i += stride) {
          if (!stats.activeMask[j * nx + i]) continue;
          const idx = (zOff + j * nx + i) * vdim;
          const mx = ovf.data[idx] || 0;
          const my = ovf.data[idx + 1] || 0;
          const mz = vdim > 2 ? ovf.data[idx + 2] || 0 : 0;
          const mag = Math.hypot(mx, my, mz) || 1;
          const ux = mx / mag, uy = my / mag, uz = mz / mag;
          const inPlane = Math.hypot(ux, uy);

          const cx = ox + (i + 0.5) * cellPxX;
          const cy = oy + (ny - 1 - j + 0.5) * cellPxY;
          const isDark = lumGrid[j * nx + i] < 0.48;

          if (Math.abs(uz) > 0.82 || inPlane < 0.18) {
            // Draw unmistakable physics out-of-plane marker: ⊙ (+z) or ⊗ (-z)
            const r = Math.max(3.6, Math.min(7.5, baseLen * 0.52));
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = uz >= 0 ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.9)";
            ctx.fill();
            ctx.strokeStyle = uz >= 0 ? "#b91c1c" : "#60a5fa";
            ctx.lineWidth = 1.6;
            ctx.stroke();

            if (uz >= 0) {
              ctx.beginPath();
              ctx.arc(cx, cy, Math.max(1.5, r * 0.34), 0, Math.PI * 2);
              ctx.fillStyle = "#b91c1c";
              ctx.fill();
            } else {
              const d = r * 0.52;
              ctx.beginPath();
              ctx.moveTo(cx - d, cy - d);
              ctx.lineTo(cx + d, cy + d);
              ctx.moveTo(cx + d, cy - d);
              ctx.lineTo(cx - d, cy + d);
              ctx.stroke();
            }
          } else {
            const len = baseLen * Math.max(0.55, inPlane);
            const dx = (ux / inPlane) * len;
            const dy = -(uy / inPlane) * len;
            drawVectorArrow(ctx, cx - dx * 0.65, cy - dy * 0.65, cx + dx * 0.85, cy + dy * 0.85, headLen, isDark);
          }
        }
      }
    }

    // 6. Outer frame, Physical Axes (nm) and Scale Bar
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, drawW, drawH);

    if (opts.showAxes) {
      ctx.fillStyle = "#334155";
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      ctx.font = "600 10px Consolas, monospace";

      // X ticks
      const xStep = niceStep(ovf.lxNm, 4);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let xNm = 0; xNm <= ovf.lxNm + 1e-6; xNm += xStep) {
        const px = ox + (xNm / ovf.lxNm) * drawW;
        ctx.beginPath();
        ctx.moveTo(px, oy + drawH);
        ctx.lineTo(px, oy + drawH + 4);
        ctx.stroke();
        ctx.fillText(`${Math.round(xNm)}`, px, oy + drawH + 6);
      }
      ctx.font = "700 10.5px Segoe UI, sans-serif";
      ctx.fillText("x (nm)", ox + drawW / 2, oy + drawH + 19);

      // Y ticks
      const yStep = niceStep(ovf.lyNm, 4);
      ctx.font = "600 10px Consolas, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let yNm = 0; yNm <= ovf.lyNm + 1e-6; yNm += yStep) {
        const py = oy + drawH - (yNm / ovf.lyNm) * drawH;
        ctx.beginPath();
        ctx.moveTo(ox - 4, py);
        ctx.lineTo(ox, py);
        ctx.stroke();
        ctx.fillText(`${Math.round(yNm)}`, ox - 6, py);
      }

      ctx.save();
      ctx.translate(ox - 36, oy + drawH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = "700 10.5px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("y (nm)", 0, 0);
      ctx.restore();

      // Scale bar inside lower-left corner
      const barNm = niceStep(ovf.lxNm * 0.28, 1);
      const barPx = (barNm / ovf.lxNm) * drawW;
      if (barPx >= 26 && barPx <= drawW * 0.45) {
        const bx = ox + 10;
        const by = oy + drawH - 22;
        ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
        ctx.fillRect(bx - 4, by - 4, barPx + 8, 18);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(bx, by + 7, barPx, 3.5);
        ctx.font = "700 9.5px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${barNm} nm`, bx + barPx / 2, by - 3);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    // 7. Title & Time Header
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 12.5px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    const timeStr = ovf.timeS !== null ? `  ·  t = ${(ovf.timeS * 1e9).toFixed(3)} ns` : "";
    const zStr = ovf.znodes > 1 ? `  ·  z = ${zSlice}/${ovf.znodes - 1}` : "";
    ctx.fillText(`${ovf.filename}${timeStr}${zStr}`, ox, ry + 20);

    // 8. Legend (Color Wheel or Colorbar)
    if (showLegend && opts.showLegend) {
      const legX = ox + drawW + 18;
      if (opts.colorMode === "hsl" || opts.colorMode === "angle") {
        const radius = Math.min(34, Math.max(22, drawH * 0.16));
        drawColorWheel(ctx, legX + radius + 16, oy + drawH * 0.42, radius, opts.colorMode === "hsl");
      } else {
        const barH = Math.min(200, Math.max(90, drawH * 0.72));
        drawColorbar(ctx, legX + 12, oy + (drawH - barH) / 2, 16, barH, opts.colorMode);
      }
    }

    // 9. Summary Metrics Footer
    if (opts.showSummary) {
      const sy = ry + rh - 10;
      ctx.fillStyle = "#475569";
      ctx.font = "600 10.5px Consolas, monospace";
      ctx.textAlign = "center";
      const qTxt = Number.isFinite(stats.qTop) ? `  |  Q = ${stats.qTop >= 0 ? "+" : ""}${stats.qTop.toFixed(2)}` : "";
      const summary = `⟨mx⟩=${stats.mxAvg.toFixed(3)}  ⟨my⟩=${stats.myAvg.toFixed(3)}  ⟨mz⟩=${stats.mzAvg.toFixed(3)}${qTxt}`;
      ctx.fillText(summary, ox + drawW / 2, sy);
      ctx.textAlign = "start";
    }

    // Return hit-test box for interactive mouse probe
    return { ox, oy, drawW, drawH, ovf, zSlice, stats };
  }

  // ==========================================================================
  // 4. PARSER E PLOTTER DE table.txt (Séries, Histerese, Órbita, Energia, FFT)
  // ==========================================================================
  function parseTableTxt(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return null;
    const headerLine = lines[0].replace(/^#\s*/, "").trim();
    const columns = headerLine.split(/\t+/).map((c) => c.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith("#")) continue;
      const vals = lines[i].trim().split(/\s+/).map(Number);
      if (vals.length >= 2 && Number.isFinite(vals[0])) {
        rows.push(vals);
      }
    }
    if (rows.length === 0) return null;
    return { columns, rows };
  }

  function findCol(table, regex) {
    return table.columns.findIndex((c) => regex.test(c));
  }

  // Simple Radix-2 / DFT power spectrum on uniformly resampled signal (Hann window)
  function computeFFT(timesS, signal) {
    const Norig = Math.min(timesS.length, signal.length);
    if (Norig < 8) return null;
    const t0 = timesS[0];
    const tEnd = timesS[Norig - 1];
    const span = tEnd - t0;
    if (span <= 0) return null;

    // Resample uniformly to power of 2 (up to 512 for instant speed in JS)
    let N = 1;
    while (N < Norig && N < 512) N <<= 1;
    if (N < 16) N = 16;
    const dt = span / (N - 1);

    const y = new Float64Array(N);
    let mean = 0;
    let srcIdx = 0;
    for (let i = 0; i < N; i++) {
      const ti = t0 + i * dt;
      while (srcIdx < Norig - 2 && timesS[srcIdx + 1] < ti) srcIdx++;
      const tA = timesS[srcIdx], tB = timesS[srcIdx + 1];
      const frac = tB > tA ? (ti - tA) / (tB - tA) : 0;
      const val = signal[srcIdx] + frac * (signal[srcIdx + 1] - signal[srcIdx]);
      y[i] = val;
      mean += val;
    }
    mean /= N;

    // Remove DC and apply Hann window
    for (let i = 0; i < N; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      y[i] = (y[i] - mean) * w;
    }

    const half = Math.floor(N / 2);
    const freqsGHz = new Float64Array(half);
    const amps = new Float64Array(half);
    let maxAmp = 0;
    let peakFreq = 0;

    for (let k = 1; k < half; k++) {
      let re = 0, im = 0;
      const angStep = (-2 * Math.PI * k) / N;
      for (let n = 0; n < N; n++) {
        const ang = angStep * n;
        re += y[n] * Math.cos(ang);
        im += y[n] * Math.sin(ang);
      }
      const amp = Math.hypot(re, im) / N;
      const fGHz = k / (N * dt) / 1e9;
      freqsGHz[k] = fGHz;
      amps[k] = amp;
      if (amp > maxAmp) {
        maxAmp = amp;
        peakFreq = fGHz;
      }
    }

    return { freqsGHz, amps, maxAmp: maxAmp || 1, peakFreq };
  }

  function renderTablePlot(canvas, table, chartType, currentTimeS) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 720;
    const cssH = canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    if (!table || table.rows.length < 2) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 12.5px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Carregue uma pasta .out com table.txt (ou selecione um arquivo) para visualizar os gráficos.", cssW / 2, cssH / 2);
      ctx.textAlign = "start";
      return;
    }

    const iT = 0;
    const iMx = findCol(table, /^mx\b/i);
    const iMy = findCol(table, /^my\b/i);
    const iMz = findCol(table, /^mz\b/i);
    const iBx = findCol(table, /^B_extx\b/i);
    const iBy = findCol(table, /^B_exty\b/i);
    const iBz = findCol(table, /^B_extz\b/i);

    const series = [];
    let xLabel = "t (ns)";
    let yLabel = "⟨m⟩";
    let title = "Evolução Temporal da Magnetização";
    let cursorX = null;

    const colArr = (idx, scale = 1) => table.rows.map((r) => (r[idx] || 0) * scale);

    if (chartType === "m_time") {
      const xs = colArr(iT, 1e9);
      if (iMx >= 0) series.push({ label: "⟨mx⟩", color: "#ea580c", x: xs, y: colArr(iMx) });
      if (iMy >= 0) series.push({ label: "⟨my⟩", color: "#059669", x: xs, y: colArr(iMy) });
      if (iMz >= 0) series.push({ label: "⟨mz⟩", color: "#4f46e5", x: xs, y: colArr(iMz) });
      if (currentTimeS !== null) cursorX = currentTimeS * 1e9;
    } else if (chartType === "hysteresis") {
      title = "Curva de Histerese — ⟨m⟩ vs. B_ext";
      // Pick B component with largest span
      const cand = [
        { idx: iBx, name: "Bx" },
        { idx: iBy, name: "By" },
        { idx: iBz, name: "Bz" }
      ].filter((c) => c.idx >= 0);

      if (cand.length === 0) {
        ctx.fillStyle = "#b45309";
        ctx.font = "600 12px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText("Coluna B_ext não encontrada em table.txt (adicione TableAdd(B_ext)).", cssW / 2, cssH / 2);
        return;
      }
      let best = cand[0], bestSpan = -1;
      cand.forEach((c) => {
        const arr = colArr(c.idx, 1e3);
        const sp = Math.max(...arr) - Math.min(...arr);
        if (sp > bestSpan) { bestSpan = sp; best = c; }
      });
      const xs = colArr(best.idx, 1e3);
      xLabel = `B_ext (${best.name}, mT)`;
      if (iMx >= 0) series.push({ label: "⟨mx⟩", color: "#ea580c", x: xs, y: colArr(iMx) });
      if (iMy >= 0) series.push({ label: "⟨my⟩", color: "#059669", x: xs, y: colArr(iMy) });
      if (iMz >= 0) series.push({ label: "⟨mz⟩", color: "#4f46e5", x: xs, y: colArr(iMz) });
    } else if (chartType === "orbit") {
      title = "Trajetória no Plano — ⟨my⟩ vs. ⟨mx⟩";
      xLabel = "⟨mx⟩";
      yLabel = "⟨my⟩";
      if (iMx >= 0 && iMy >= 0) {
        series.push({ label: "Órbita", color: "#6366f1", x: colArr(iMx), y: colArr(iMy), showEndpoints: true });
      }
    } else if (chartType === "energy") {
      title = "Energia Magnética (aJ = 10⁻¹⁸ J)";
      xLabel = "t (ns)";
      yLabel = "E (aJ)";
      const xs = colArr(iT, 1e9);
      const palette = ["#4f46e5", "#ea580c", "#059669", "#dc2626", "#0284c7", "#9333ea"];
      let ci = 0;
      table.columns.forEach((col, idx) => {
        if (/^E_/i.test(col)) {
          series.push({ label: col.split(" ")[0], color: palette[ci++ % palette.length], x: xs, y: colArr(idx, 1e18) });
        }
      });
      if (series.length === 0) {
        ctx.fillStyle = "#b45309";
        ctx.font = "600 12px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText("Nenhuma coluna E_* encontrada em table.txt (adicione TableAdd(E_total)).", cssW / 2, cssH / 2);
        return;
      }
      if (currentTimeS !== null) cursorX = currentTimeS * 1e9;
    } else if (chartType === "fft") {
      const ts = colArr(iT, 1);
      // Choose component with highest variance for FFT
      const comps = [
        { idx: iMx, label: "FFT(⟨mx⟩)", color: "#ea580c" },
        { idx: iMy, label: "FFT(⟨my⟩)", color: "#059669" },
        { idx: iMz, label: "FFT(⟨mz⟩)", color: "#4f46e5" }
      ].filter((c) => c.idx >= 0);

      let peakTxt = "";
      comps.forEach((c) => {
        const res = computeFFT(ts, colArr(c.idx));
        if (!res) return;
        series.push({
          label: `${c.label} (pico ${res.peakFreq.toFixed(2)} GHz)`,
          color: c.color,
          x: Array.from(res.freqsGHz.slice(1)),
          y: Array.from(res.amps.slice(1)).map((v) => v / res.maxAmp)
        });
        if (!peakTxt) peakTxt = ` · Pico: ${res.peakFreq.toFixed(2)} GHz`;
      });
      title = `Espectro de Frequências — FFT${peakTxt}`;
      xLabel = "Frequência (GHz)";
      yLabel = "Amplitude norm.";
    }

    if (series.length === 0) return;

    // Bounds
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    series.forEach((s) => {
      for (let i = 0; i < s.x.length; i++) {
        if (s.x[i] < xMin) xMin = s.x[i];
        if (s.x[i] > xMax) xMax = s.x[i];
        if (s.y[i] < yMin) yMin = s.y[i];
        if (s.y[i] > yMax) yMax = s.y[i];
      }
    });
    if (xMax === xMin) { xMin -= 1; xMax += 1; }
    if (yMax === yMin) { yMin -= 0.1; yMax += 0.1; }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad;
    yMax += yPad;

    const padL = 56, padR = 16, padT = 28, padB = 34;
    const pw = cssW - padL - padR;
    const ph = cssH - padT - padB;
    const mapX = (x) => padL + ((x - xMin) / (xMax - xMin)) * pw;
    const mapY = (y) => padT + ph - ((y - yMin) / (yMax - yMin)) * ph;

    // Grid
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    const xTickStep = niceStep(xMax - xMin, 6);
    const yTickStep = niceStep(yMax - yMin, 4);

    ctx.fillStyle = "#475569";
    ctx.font = "600 9.5px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let xv = Math.ceil(xMin / xTickStep) * xTickStep; xv <= xMax + 1e-9; xv += xTickStep) {
      const px = mapX(xv);
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + ph);
      ctx.stroke();
      ctx.fillText(Number(xv.toPrecision(3)).toString(), px, padT + ph + 4);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let yv = Math.ceil(yMin / yTickStep) * yTickStep; yv <= yMax + 1e-9; yv += yTickStep) {
      const py = mapY(yv);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(padL + pw, py);
      ctx.stroke();
      ctx.fillText(Number(yv.toPrecision(3)).toString(), padL - 6, py);
    }

    // Zero axes if in range
    ctx.strokeStyle = "#cbd5e1";
    if (yMin < 0 && yMax > 0) {
      const py0 = mapY(0);
      ctx.beginPath(); ctx.moveTo(padL, py0); ctx.lineTo(padL + pw, py0); ctx.stroke();
    }
    if (xMin < 0 && xMax > 0) {
      const px0 = mapX(0);
      ctx.beginPath(); ctx.moveTo(px0, padT); ctx.lineTo(px0, padT + ph); ctx.stroke();
    }

    // Plot curves
    series.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < s.x.length; i++) {
        const px = mapX(s.x[i]);
        const py = mapY(s.y[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      if (s.showEndpoints && s.x.length >= 2) {
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(mapX(s.x[0]), mapY(s.y[0]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(mapX(s.x[s.x.length - 1]), mapY(s.y[s.y.length - 1]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Current .ovf frame timestamp marker
    if (cursorX !== null && cursorX >= xMin && cursorX <= xMax) {
      const cx = mapX(cursorX);
      ctx.save();
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + ph);
      ctx.stroke();
      ctx.restore();
    }

    // Frame border
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, pw, ph);

    // Title & Legend
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 11.5px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, padL, 17);

    // Inline legend top-right
    let lx = cssW - padR;
    ctx.font = "600 10.5px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    for (let i = series.length - 1; i >= 0; i--) {
      const s = series[i];
      ctx.fillStyle = "#334155";
      ctx.fillText(s.label, lx, 17);
      const tw = ctx.measureText(s.label).width;
      ctx.fillStyle = s.color;
      ctx.fillRect(lx - tw - 14, 11, 10, 4);
      lx -= tw + 24;
    }

    // Axis labels
    ctx.fillStyle = "#334155";
    ctx.font = "700 10.5px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, padL + pw / 2, cssH - 4);

    ctx.save();
    ctx.translate(14, padT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    ctx.textAlign = "start";
  }

  // ==========================================================================
  // 5. CONTROLADOR DA ABA 2 (Estado, Carregamento, Playback, Comparação, Export)
  // ==========================================================================
  const viewer = {
    folders: [],
    activeDir: "",
    ovfList: [],
    localOvfs: [],
    currentIndex: 0,
    ovfA: null,
    ovfB: null,
    compareMode: false,
    table: null,
    ovfCache: new Map(),
    hitBoxes: [],
    playTimer: null,
    playing: false
  };

  function getRenderOptions() {
    return {
      colorMode: $("v-colormap") ? $("v-colormap").value : "hsl",
      showVectors: $("v-show-vectors") ? $("v-show-vectors").checked : true,
      arrowDensity: $("v-arrow-density") ? parseInt($("v-arrow-density").value, 10) : 18,
      arrowScale: $("v-arrow-scale") ? parseFloat($("v-arrow-scale").value) : 1.0,
      showContours: $("v-show-contours") ? $("v-show-contours").checked : false,
      showAxes: $("v-show-axes") ? $("v-show-axes").checked : true,
      showLegend: $("v-show-legend") ? $("v-show-legend").checked : true,
      showSummary: $("v-show-summary") ? $("v-show-summary").checked : true,
      smoothPixels: $("v-smooth-pixels") ? $("v-smooth-pixels").checked : false,
      zSlice: $("v-zslice") ? parseInt($("v-zslice").value, 10) || 0 : 0
    };
  }

  function redrawFieldCanvas(targetCanvas = null, scaleOverride = null) {
    const canvas = targetCanvas || $("viewer-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = scaleOverride || (window.devicePixelRatio || 1);
    const cssW = targetCanvas ? targetCanvas.width / dpr : (canvas.clientWidth || 780);
    const cssH = targetCanvas ? targetCanvas.height / dpr : (canvas.clientHeight || 420);

    if (!targetCanvas) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    if (!viewer.ovfA) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 13.5px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Selecione uma pasta .out ou carregue um arquivo .ovf para visualizar.", cssW / 2, cssH / 2 - 8);
      ctx.font = "400 12px Segoe UI, sans-serif";
      ctx.fillText("Visualização com roda de cores HSL / colorbar, barra de escala em nm, vetores nítidos e marcadores ⊙ / ⊗.", cssW / 2, cssH / 2 + 16);
      ctx.textAlign = "start";
      viewer.hitBoxes = [];
      return;
    }

    const opts = getRenderOptions();
    const boxes = [];
    if (viewer.compareMode && viewer.ovfB) {
      const halfW = Math.floor(cssW / 2);
      boxes.push(renderSinglePanel(ctx, viewer.ovfA, { x: 0, y: 0, w: halfW, h: cssH }, opts, false));
      // Subtle divider between panels
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 12);
      ctx.lineTo(halfW, cssH - 12);
      ctx.stroke();
      boxes.push(renderSinglePanel(ctx, viewer.ovfB, { x: halfW, y: 0, w: cssW - halfW, h: cssH }, opts, true));
    } else {
      boxes.push(renderSinglePanel(ctx, viewer.ovfA, { x: 0, y: 0, w: cssW, h: cssH }, opts, true));
    }

    if (!targetCanvas) {
      viewer.hitBoxes = boxes;
      redrawTable();
    }
  }

  function redrawTable() {
    const canvas = $("table-canvas");
    if (!canvas) return;
    const chartType = $("v-chart-type") ? $("v-chart-type").value : "m_time";
    const curTime = viewer.ovfA ? viewer.ovfA.timeS : null;
    renderTablePlot(canvas, viewer.table, chartType, curTime);
  }

  async function fetchOvfCached(dir, file) {
    const key = `${dir}||${file}`;
    if (viewer.ovfCache.has(key)) return viewer.ovfCache.get(key);
    const url = `/api/ovf?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Erro ao carregar ${file} (${resp.status})`);
    const buf = await resp.arrayBuffer();
    const parsed = parseOVF(buf, file);
    // Keep cache bounded to 40 frames for smooth playback without memory bloat
    if (viewer.ovfCache.size >= 40) {
      const firstKey = viewer.ovfCache.keys().next().value;
      viewer.ovfCache.delete(firstKey);
    }
    viewer.ovfCache.set(key, parsed);
    return parsed;
  }

  function syncZSliceControl(ovf) {
    const wrap = $("v-zslice-wrap");
    const inp = $("v-zslice");
    if (!wrap || !inp || !ovf) return;
    const maxZ = Math.max(0, ovf.znodes - 1);
    inp.max = String(maxZ);
    if (parseInt(inp.value, 10) > maxZ) inp.value = "0";
    wrap.classList.toggle("hidden", maxZ === 0);
  }

  function updateFrameLabel() {
    const lbl = $("v-frame-info");
    if (!lbl) return;
    if (!viewer.ovfA) {
      lbl.textContent = "—";
      return;
    }
    const idxTxt = viewer.ovfList.length > 0 ? `${viewer.currentIndex + 1} / ${viewer.ovfList.length}` : "Local";
    const tTxt = viewer.ovfA.timeS !== null ? ` · t = ${(viewer.ovfA.timeS * 1e9).toFixed(3)} ns` : "";
    lbl.textContent = `${idxTxt} · ${viewer.ovfA.filename}${tTxt}`;
  }

  async function loadFrameByIndex(idx) {
    // Support local multi-file animation in online/GitHub Pages mode
    if (viewer.localOvfs.length > 0 && !viewer.activeDir) {
      const clamped = Math.max(0, Math.min(viewer.localOvfs.length - 1, idx));
      viewer.currentIndex = clamped;
      viewer.ovfA = viewer.localOvfs[clamped];
      if ($("v-frame-slider")) $("v-frame-slider").value = String(clamped);
      if ($("v-ovf-select")) $("v-ovf-select").value = viewer.ovfA.filename;
      syncZSliceControl(viewer.ovfA);
      updateFrameLabel();
      redrawFieldCanvas();
      return;
    }

    if (!viewer.activeDir || viewer.ovfList.length === 0) return;
    const clamped = Math.max(0, Math.min(viewer.ovfList.length - 1, idx));
    viewer.currentIndex = clamped;
    const file = viewer.ovfList[clamped];

    const slider = $("v-frame-slider");
    if (slider) slider.value = String(clamped);
    const sel = $("v-ovf-select");
    if (sel) sel.value = file;

    try {
      viewer.ovfA = await fetchOvfCached(viewer.activeDir, file);
      syncZSliceControl(viewer.ovfA);
      updateFrameLabel();
      redrawFieldCanvas();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCompareFrame() {
    const selDir = $("v-cmp-folder");
    const selFile = $("v-cmp-file");
    if (!selDir || !selFile || !selDir.value || !selFile.value) return;
    try {
      viewer.ovfB = await fetchOvfCached(selDir.value, selFile.value);
      redrawFieldCanvas();
    } catch (err) {
      console.error(err);
    }
  }

  async function selectOutFolder(dirPath) {
    stopPlayback();
    viewer.activeDir = dirPath;
    viewer.ovfCache.clear();
    const folder = viewer.folders.find((f) => f.path === dirPath);
    viewer.ovfList = folder ? folder.ovfFiles : [];
    viewer.currentIndex = 0;

    // Populate frame dropdown & slider
    const sel = $("v-ovf-select");
    sel.innerHTML = viewer.ovfList
      .map((f) => `<option value="${f}">${f}</option>`)
      .join("");

    const slider = $("v-frame-slider");
    slider.min = "0";
    slider.max = String(Math.max(0, viewer.ovfList.length - 1));
    slider.value = "0";
    slider.disabled = viewer.ovfList.length <= 1;

    // Populate compare file dropdown when matching folder
    syncCompareFileList();

    // Load table.txt if present
    viewer.table = null;
    if (folder && folder.hasTable) {
      try {
        const resp = await fetch(`/api/table?dir=${encodeURIComponent(dirPath)}`, { cache: "no-store" });
        if (resp.ok) {
          viewer.table = parseTableTxt(await resp.text());
        }
      } catch (_) {}
    }

    if (viewer.ovfList.length > 0) {
      await loadFrameByIndex(0);
    } else {
      viewer.ovfA = null;
      updateFrameLabel();
      redrawFieldCanvas();
    }
  }

  function syncCompareFileList() {
    const cmpFolderSel = $("v-cmp-folder");
    const cmpFileSel = $("v-cmp-file");
    if (!cmpFolderSel || !cmpFileSel) return;
    const f = viewer.folders.find((x) => x.path === cmpFolderSel.value);
    const files = f ? f.ovfFiles : [];
    cmpFileSel.innerHTML = files.map((fn) => `<option value="${fn}">${fn}</option>`).join("");
    if (files.length > 0) {
      // Pick last file by default when comparing inside same folder (e.g., initial vs final)
      cmpFileSel.value = files.length > 1 ? files[files.length - 1] : files[0];
      if (viewer.compareMode) loadCompareFrame();
    }
  }

  async function refreshOutputs(preferredDir = "") {
    const folderSel = $("v-folder-select");
    const cmpFolderSel = $("v-cmp-folder");
    const setOfflineLabels = () => {
      const opt = `<option value="">Modo web — arraste ou abra .ovf/.txt abaixo</option>`;
      if (folderSel && !folderSel.value) folderSel.innerHTML = opt;
      if (cmpFolderSel && !cmpFolderSel.value) cmpFolderSel.innerHTML = opt;
    };

    if (window.location.protocol === "file:") {
      setOfflineLabels();
      return;
    }
    try {
      const resp = await fetch("/api/outputs", { cache: "no-store" });
      if (!resp.ok) {
        setOfflineLabels();
        return;
      }
      const data = await resp.json();
      viewer.folders = data.folders || [];

      const optsHtml = viewer.folders.length
        ? viewer.folders
            .map((f) => `<option value="${f.path}">${f.name} (${f.ovfFiles.length} .ovf)</option>`)
            .join("")
        : `<option value="">Nenhuma pasta .out encontrada</option>`;

      folderSel.innerHTML = optsHtml;
      cmpFolderSel.innerHTML = optsHtml;

      const target =
        (preferredDir && viewer.folders.some((f) => f.path === preferredDir) && preferredDir) ||
        (viewer.activeDir && viewer.folders.some((f) => f.path === viewer.activeDir) && viewer.activeDir) ||
        (data.lastOutDir && viewer.folders.some((f) => f.path === data.lastOutDir) && data.lastOutDir) ||
        (viewer.folders[0] ? viewer.folders[0].path : "");

      if (target) {
        folderSel.value = target;
        cmpFolderSel.value = target;
        await selectOutFolder(target);
      } else {
        viewer.ovfA = null;
        viewer.table = null;
        redrawFieldCanvas();
      }
    } catch (err) {
      setOfflineLabels();
      console.warn("Viewer offline:", err.message);
    }
  }

  function stopPlayback() {
    viewer.playing = false;
    if (viewer.playTimer) {
      clearInterval(viewer.playTimer);
      viewer.playTimer = null;
    }
    const btn = $("v-btn-play");
    if (btn) btn.textContent = "▶ Play";
  }

  function togglePlayback() {
    if (viewer.playing) {
      stopPlayback();
      return;
    }
    if (viewer.ovfList.length <= 1) return;
    viewer.playing = true;
    $("v-btn-play").textContent = "⏸ Pause";
    const fps = parseInt($("v-fps").value, 10) || 8;
    viewer.playTimer = setInterval(async () => {
      if (!viewer.playing) return;
      const next = (viewer.currentIndex + 1) % viewer.ovfList.length;
      await loadFrameByIndex(next);
    }, Math.max(40, Math.round(1000 / fps)));
  }

  function exportDidacticPng() {
    if (!viewer.ovfA) return;
    const scale = 2.2;
    const baseW = viewer.compareMode && viewer.ovfB ? 1160 : 760;
    const baseH = 540;
    const off = document.createElement("canvas");
    off.width = Math.round(baseW * scale);
    off.height = Math.round(baseH * scale);
    redrawFieldCanvas(off, scale);

    const a = document.createElement("a");
    const base = viewer.ovfA.filename.replace(/\.ovf$/i, "");
    a.download = viewer.compareMode && viewer.ovfB ? `${base}_comparacao.png` : `${base}_didatico.png`;
    a.href = off.toDataURL("image/png");
    a.click();
  }

  function exportTablePng() {
    const canvas = $("table-canvas");
    if (!canvas || !viewer.table) return;
    const a = document.createElement("a");
    a.download = `grafico_${$("v-chart-type").value}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  // ---------- Interactive Hover Probe ----------
  function handleCanvasMouseMove(e) {
    const probe = $("v-probe-bar");
    if (!probe || viewer.hitBoxes.length === 0) return;
    const canvas = $("viewer-canvas");
    const rect = canvas.getBoundingClientRect();
    const mxPx = e.clientX - rect.left;
    const myPx = e.clientY - rect.top;

    for (const box of viewer.hitBoxes) {
      if (mxPx >= box.ox && mxPx <= box.ox + box.drawW && myPx >= box.oy && myPx <= box.oy + box.drawH) {
        const fx = (mxPx - box.ox) / box.drawW;
        const fy = 1 - (myPx - box.oy) / box.drawH;
        const i = Math.max(0, Math.min(box.ovf.xnodes - 1, Math.floor(fx * box.ovf.xnodes)));
        const j = Math.max(0, Math.min(box.ovf.ynodes - 1, Math.floor(fy * box.ovf.ynodes)));
        const xNm = (i + 0.5) * box.ovf.xstepsize * 1e9;
        const yNm = (j + 0.5) * box.ovf.ystepsize * 1e9;

        if (!box.stats.activeMask[j * box.ovf.xnodes + i]) {
          probe.textContent = `${box.ovf.filename}  |  (${xNm.toFixed(1)}, ${yNm.toFixed(1)}) nm  |  Célula (${i}, ${j})  |  Vácuo (sem material magnético)`;
          return;
        }
        const zOff = box.zSlice * box.ovf.xnodes * box.ovf.ynodes;
        const idx = (zOff + j * box.ovf.xnodes + i) * box.ovf.valuedim;
        const vx = box.ovf.data[idx] || 0;
        const vy = box.ovf.valuedim > 1 ? box.ovf.data[idx + 1] || 0 : 0;
        const vz = box.ovf.valuedim > 2 ? box.ovf.data[idx + 2] || 0 : 0;
        const phi = ((Math.atan2(vy, vx) * 180) / Math.PI).toFixed(1);
        probe.textContent = `${box.ovf.filename}  |  (${xNm.toFixed(1)}, ${yNm.toFixed(1)}) nm  |  Célula (${i}, ${j})  |  m = (${vx.toFixed(3)}, ${vy.toFixed(3)}, ${vz.toFixed(3)})  |  φ = ${phi}°`;
        return;
      }
    }
    probe.textContent = "Passe o mouse sobre a amostra para inspecionar (x, y) em nm e o vetor m(r).";
  }

  // ---------- Local File Drop / Picker (also works offline!) ----------
  async function handleLocalFiles(fileList) {
    const files = Array.from(fileList || []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    const loadedOvfs = [];
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".ovf")) {
        const buf = await f.arrayBuffer();
        loadedOvfs.push(parseOVF(buf, f.name));
      } else if (lower.endsWith(".txt")) {
        viewer.table = parseTableTxt(await f.text());
        redrawTable();
      }
    }
    if (loadedOvfs.length > 0) {
      stopPlayback();
      viewer.activeDir = "";
      viewer.localOvfs = loadedOvfs;
      viewer.ovfList = loadedOvfs.map((o) => o.filename);
      viewer.currentIndex = 0;

      const sel = $("v-ovf-select");
      if (sel) sel.innerHTML = viewer.ovfList.map((n) => `<option value="${n}">${n}</option>`).join("");
      const slider = $("v-frame-slider");
      if (slider) {
        slider.min = "0";
        slider.max = String(Math.max(0, loadedOvfs.length - 1));
        slider.value = "0";
        slider.disabled = loadedOvfs.length <= 1;
      }
      await loadFrameByIndex(0);
    }
  }

  // ---------- Init Viewer ----------
  function initViewer() {
    if (!$("viewer-canvas")) return;

    $("v-btn-refresh").addEventListener("click", () => refreshOutputs());
    $("v-folder-select").addEventListener("change", (e) => selectOutFolder(e.target.value));
    $("v-ovf-select").addEventListener("change", (e) => {
      const idx = viewer.ovfList.indexOf(e.target.value);
      if (idx >= 0) loadFrameByIndex(idx);
    });

    $("v-frame-slider").addEventListener("input", (e) => {
      stopPlayback();
      loadFrameByIndex(parseInt(e.target.value, 10) || 0);
    });
    $("v-btn-prev").addEventListener("click", () => {
      stopPlayback();
      loadFrameByIndex(viewer.currentIndex - 1);
    });
    $("v-btn-next").addEventListener("click", () => {
      stopPlayback();
      loadFrameByIndex(viewer.currentIndex + 1);
    });
    $("v-btn-play").addEventListener("click", togglePlayback);
    $("v-fps").addEventListener("change", () => {
      if (viewer.playing) {
        stopPlayback();
        togglePlayback();
      }
    });

    // Visual option controls
    [
      "v-colormap", "v-show-vectors", "v-arrow-density", "v-arrow-scale",
      "v-show-contours", "v-show-axes", "v-show-legend", "v-show-summary",
      "v-smooth-pixels", "v-zslice"
    ].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", () => redrawFieldCanvas());
      el.addEventListener("change", () => redrawFieldCanvas());
    });

    // Compare mode
    $("v-chk-compare").addEventListener("change", (e) => {
      viewer.compareMode = e.target.checked;
      $("v-compare-controls").classList.toggle("hidden", !viewer.compareMode);
      if (viewer.compareMode) {
        loadCompareFrame();
      } else {
        redrawFieldCanvas();
      }
    });
    $("v-cmp-folder").addEventListener("change", syncCompareFileList);
    $("v-cmp-file").addEventListener("change", loadCompareFrame);

    // Chart controls & exports
    $("v-chart-type").addEventListener("change", redrawTable);
    $("v-btn-export-png").addEventListener("click", exportDidacticPng);
    $("v-btn-export-chart").addEventListener("click", exportTablePng);

    // Local file picker (supports multiple .ovf + table.txt; enables slider if multiple .ovf loaded)
    $("v-btn-local-files").addEventListener("click", () => $("v-local-file-input").click());
    $("v-local-file-input").addEventListener("change", (e) => {
      handleLocalFiles(e.target.files);
      e.target.value = "";
    });

    // Local file B picker (for side-by-side comparison in online / static mode)
    if ($("v-btn-local-b")) {
      $("v-btn-local-b").addEventListener("click", () => $("v-local-b-input").click());
      $("v-local-b-input").addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const buf = await f.arrayBuffer();
          viewer.ovfB = parseOVF(buf, f.name);
          viewer.compareMode = true;
          $("v-chk-compare").checked = true;
          redrawFieldCanvas();
        } catch (err) {
          alert("Erro ao ler arquivo B (.ovf): " + err.message);
        }
        e.target.value = "";
      });
    }

    // Drag & Drop .ovf / table.txt directly onto the viewer workspace
    const viewerTab = $("tab-viewer");
    if (viewerTab) {
      viewerTab.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });
      viewerTab.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleLocalFiles(e.dataTransfer.files);
        }
      });
    }

    // Probe
    $("viewer-canvas").addEventListener("mousemove", handleCanvasMouseMove);

    // Resize responsiveness
    window.addEventListener("resize", () => {
      if (!$("tab-viewer").classList.contains("hidden")) {
        redrawFieldCanvas();
      }
    });

    // Public hook for app.js (switching tabs & opening results right after calculation)
    window.MUMAX0_VIEWER = {
      refreshOutputs,
      redraw: () => redrawFieldCanvas(),
      parseOVF,
      parseTableTxt
    };
  }

  document.addEventListener("DOMContentLoaded", initViewer);
})();
