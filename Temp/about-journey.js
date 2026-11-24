/* About page — scroll-driven journey. Canvas = decoration only; all content lives in the DOM. */
(() => {
  'use strict';
  const body = document.body;
  const journey = document.querySelector('#journey');
  if (!journey) return;
  body.classList.add('ab-js');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = journey.querySelector('.ab-canvas');
  const ctx = canvas.getContext('2d');
  const chapters = [...journey.querySelectorAll('.ab-chapter')];
  const markers = chapters.map(c => c.querySelector('.ab-marker'));
  const cards = chapters.map(c => c.querySelector('.ab-card'));
  const bignums = chapters.map(c => c.querySelector('.ab-bignum'));
  const panelNum = journey.querySelector('.ab-panel-num-text');
  const panelLabel = journey.querySelector('.ab-panel-label');
  const panelTitle = journey.querySelector('.ab-panel-title');
  const panelCount = journey.querySelector('.ab-panel-count-now');
  const meterFill = journey.querySelector('.ab-meter-fill');
  const header = document.querySelector('header');
  const N = chapters.length;

  const COL = { ink: '232,228,242', forest: '156,138,235', copper: '31,199,188' };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- state ---------- */
  let W = 0, H = 0, VH = 0, dpr = 1, secTop = 0;
  let nodes = [], twigs = [], main = [], strand = [], bgPts = [], excl = [], stageTopY = 0;
  let startY = 0, endY = 0;
  let headY = 0, targetHead = 0;
  let active = -1, visited = -1;
  let running = false, rafId = 0, visible = false, lastT = 0;
  const act = new Array(N).fill(0);       // 0..1 node activation
  const activatedAt = new Array(N).fill(-1);
  let bursts = [], pulses = [], nextPulse = 0;
  const particles = Array.from({ length: 16 }, (_, i) => ({ f: i / 16, v: .05 + (i % 5) * .022, r: 1.7 + (i % 3) * .55, s: i % 3 === 0 }));
  let particleBase = 0;
  const SYMS = ['+', '×', '◇', '□', '△', '⌖', '01', '10', '//', '::'];

  /* ---------- geometry ---------- */
  function bezier(a, c1, c2, b, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
      });
    }
    return out;
  }
  function withLen(pts) {
    let L = 0;
    pts[0].l = 0;
    for (let i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      pts[i].l = L;
    }
    return pts;
  }
  // points are monotonic in y, so scroll "head" can be located by y
  function idxAtY(pts, y) {
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].y < y) lo = m + 1; else hi = m; }
    return lo;
  }
  function lenAtY(pts, y) {
    if (y <= pts[0].y) return 0;
    if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].l;
    const i = idxAtY(pts, y), a = pts[i - 1], b = pts[i];
    const t = (y - a.y) / ((b.y - a.y) || 1);
    return a.l + (b.l - a.l) * t;
  }
  function pointAtLen(pts, len) {
    len = clamp(len, 0, pts[pts.length - 1].l);
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].l < len) lo = m + 1; else hi = m; }
    if (lo === 0) return pts[0];
    const a = pts[lo - 1], b = pts[lo], t = (len - a.l) / ((b.l - a.l) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function layout() {
    const rect = journey.getBoundingClientRect();
    secTop = rect.top + window.scrollY;
    W = journey.clientWidth; H = journey.offsetHeight; VH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(VH * dpr);
    canvas.style.height = VH + 'px';

    const list = journey.querySelector('.ab-chapters');
    const lr = list.getBoundingClientRect();
    const chapLeft = lr.left - rect.left;
    stageTopY = lr.top - rect.top;
    const gutter = parseFloat(getComputedStyle(journey).getPropertyValue('--gutter')) || parseFloat(getComputedStyle(body).getPropertyValue('--gutter')) || 150;
    const cx = chapLeft + gutter / 2;
    const amp = Math.min(gutter * .28, 38) * (gutter < 100 ? .45 : 1);
    const msize = markers[0].offsetWidth || 44;

    nodes = chapters.map((li, i) => {
      const lrr = li.getBoundingClientRect();
      const card = cards[i];
      const x = cx + (i % 2 ? amp : -amp);
      const y = (lrr.top - rect.top) + card.offsetTop + Math.min(34, msize * .8);
      markers[i].style.left = (x - (lrr.left - rect.left) - msize / 2) + 'px';
      markers[i].style.top = (y - (lrr.top - rect.top) - msize / 2) + 'px';
      return { x, y, i };
    });

    // Never let the path start inside the journey header text block
    startY = Math.max(stageTopY + 12, nodes[0].y - Math.min(90, VH * .12));
    endY = nodes[N - 1].y + Math.min(320, VH * .4);
    const S = { x: cx, y: startY }, E = { x: cx, y: endY };
    const P = [S, ...nodes, E];
    const swing = gutter * .58, lo = chapLeft + 8, hi = chapLeft + gutter - 8;
    let m = [], s = [];
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1], dy = b.y - a.y;
      const dir = Math.sign(b.x - a.x) || (k % 2 ? 1 : -1);
      const seg1 = bezier(a, { x: a.x + dir * swing, y: a.y + dy * .55 }, { x: b.x - dir * swing, y: b.y - dy * .55 }, b, 44);
      const seg2 = bezier(a, { x: a.x - dir * swing * .85, y: a.y + dy * .38 }, { x: b.x + dir * swing * .85, y: b.y - dy * .38 }, b, 44);
      m = m.concat(k ? seg1.slice(1) : seg1);
      s = s.concat(k ? seg2.slice(1) : seg2);
    }
    const lim = p => { p.x = clamp(p.x, lo, hi); return p; };
    main = withLen(m.map(lim)); strand = withLen(s.map(lim));

    // Multi-branch circuit traces sprouting from each node into the gutter margin
    const tl = Math.min(gutter * .32, 44);
    twigs = nodes.map((n, i) => {
      const d = i % 2 ? -1 : 1;
      const end1 = { x: clamp(n.x - tl, lo - 4, hi + 4), y: n.y + tl * .85 };
      const end2 = { x: clamp(n.x + d * tl * .75, lo - 4, hi + 4), y: n.y - tl * .65 };
      return {
        a: n,
        c1: { x: n.x - tl * .25, y: n.y + tl * .75 }, b1: end1,
        c2: { x: n.x + d * tl * .75, y: n.y }, b2: end2,
        tag: `0${i + 1}//${['SOC', 'PHD', 'YLS', 'CSC', 'BK', 'PT'][i] || 'ND'}`
      };
    });

    // Exclusion zones so background network lines/symbols never cross over headings or cards
    const headEl = journey.querySelector('.ab-journey-head');
    const panelEl = journey.querySelector('.ab-panel-inner');
    excl = [];
    const addExcl = (el, pad) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      excl.push({
        x1: r.left - rect.left - pad,
        y1: r.top - rect.top - pad,
        x2: r.right - rect.left + pad,
        y2: r.bottom - rect.top + pad
      });
    };
    addExcl(headEl, 18);
    if (W > 900) addExcl(panelEl, 14);
    cards.forEach(c => addExcl(c, 16));

    const inExcl = (x, y) => {
      if (y < stageTopY + 8) return true; // keep journey header completely clean
      for (let k = 0; k < excl.length; k++) {
        const z = excl[k];
        if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return true;
      }
      return false;
    };

    // Ambient network + technical symbols, deterministic & placed outside text areas
    let seed = 19; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const targetCount = clamp(Math.round(W * H / 26000), 36, 130);
    bgPts = [];
    let tries = 0;
    while (bgPts.length < targetCount && tries < targetCount * 8) {
      tries++;
      const x = rnd() * W, y = stageTopY + 16 + rnd() * Math.max(100, H - stageTopY - 32);
      if (inExcl(x, y)) continue;
      bgPts.push({
        x, y,
        ax: 6 + rnd() * 14, ay: 6 + rnd() * 14,
        sp: .00016 + rnd() * .00024, ph: rnd() * 6.28,
        sym: SYMS[bgPts.length % SYMS.length],
        kind: bgPts.length % 5 // 0: cross, 1: diamond, 2: square, 3: glyph text, 4: ring node
      });
    }
    if (!headY) headY = startY;
  }

  /* ---------- drawing ---------- */
  function strokePrefix(pts, y, width, style, dash) {
    const end = idxAtY(pts, y);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < end; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (end > 0 && y > pts[0].y) {
      const a = pts[end - 1], b = pts[end], t = clamp((y - a.y) / ((b.y - a.y) || 1), 0, 1);
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
    ctx.lineWidth = width; ctx.strokeStyle = style; ctx.setLineDash(dash || []);
    ctx.stroke();
  }
  function strokeAll(pts, width, style, dash) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = width; ctx.strokeStyle = style; ctx.setLineDash(dash || []); ctx.stroke();
  }
  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  function drawSymbol(p, rgb, alpha, now) {
    const x = p.cx, y = p.cy;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1;
    if (p.kind === 0) {
      // crosshair +
      const s = 3.5;
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
      ctx.stroke();
    } else if (p.kind === 1) {
      // diamond ◇
      const s = 3.8;
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
      ctx.closePath(); ctx.stroke();
    } else if (p.kind === 2) {
      // hollow technical square □
      const s = 3;
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    } else if (p.kind === 3) {
      // monospace glyph / binary / marker
      ctx.font = '700 9px "Courier New", monospace';
      ctx.fillText(p.sym, x + 5, y + 3);
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 6.2832); ctx.fill();
    } else {
      // target ring node ⌖
      const r = 3.2 + Math.sin(now * .002 + p.ph) * .8;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.2, 0, 6.2832); ctx.fill();
    }
  }

  function drawReticle(x, y, r, rgb, a, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(${rgb},${a})`;
    ctx.lineWidth = 1.2;
    // segmented technical ring
    for (let k = 0; k < 4; k++) {
      const a0 = k * 1.5708 + .18, a1 = (k + 1) * 1.5708 - .18;
      ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    }
    // outer ticks
    const t = r + 5;
    ctx.beginPath();
    ctx.moveTo(-t, 0); ctx.lineTo(-r + 2, 0);
    ctx.moveTo(r - 2, 0); ctx.lineTo(t, 0);
    ctx.moveTo(0, -t); ctx.lineTo(0, -r + 2);
    ctx.moveTo(0, r - 2); ctx.lineTo(0, t);
    ctx.stroke();
    ctx.restore();
  }

  function draw(now, dt) {
    const motion = !reduced.matches;
    const offY = clamp(window.scrollY - secTop, 0, Math.max(0, H - VH));
    ctx.setTransform(dpr, 0, 0, dpr, 0, -offY * dpr);
    ctx.clearRect(0, offY, W, VH);

    // Clip canvas drawing to below the journey header so lines never cross title/intro text
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, Math.max(offY, stageTopY), W, VH);
    ctx.clip();

    const top = Math.max(stageTopY, offY - 160), bottom = offY + VH + 160;
    const headLen = lenAtY(main, headY);
    const hp = pointAtLen(main, headLen);
    const hs = pointAtLen(strand, lenAtY(strand, headY));

    // ambient network + symbols
    ctx.setLineDash([]);
    const vis = [];
    for (const p of bgPts) {
      const t = motion ? now * p.sp : 0;
      p.cx = p.x + Math.sin(t + p.ph) * p.ax;
      p.cy = Math.max(stageTopY + 14, p.y + Math.cos(t * 1.3 + p.ph) * p.ay);
      if (p.cy > top && p.cy < bottom) vis.push(p);
    }

    // spawn occasional signal pulses along background edges
    if (motion && vis.length > 2 && now > nextPulse) {
      nextPulse = now + 260;
      for (let tries = 0; tries < 6; tries++) {
        const a = vis[(Math.random() * vis.length) | 0];
        const b = vis[(Math.random() * vis.length) | 0];
        if (a !== b && Math.hypot(a.cx - b.cx, a.cy - b.cy) < 175) {
          pulses.push({ a, b, t: now, d: 900 + Math.random() * 500 });
          break;
        }
      }
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < vis.length; i++) {
      const a = vis[i];
      for (let j = i + 1; j < vis.length; j++) {
        const b = vis[j], d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (d < 175) {
          ctx.strokeStyle = `rgba(${COL.forest},${(1 - d / 175) * .18})`;
          ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx, b.cy); ctx.stroke();
        }
      }
      const dh = Math.hypot(a.cx - hp.x, a.cy - hp.y);
      const reach = 240;
      if (dh < reach && a.cy < headY + 60) {
        const w = 1 - dh / reach;
        ctx.strokeStyle = `rgba(${COL.copper},${w * .42})`;
        ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(a.cx, a.cy); ctx.stroke();
        drawSymbol(a, COL.copper, .35 + w * .55, now);
      } else {
        drawSymbol(a, COL.ink, .24, now);
      }
    }

    // signal packets travelling across background network links
    pulses = pulses.filter(p => now - p.t < p.d);
    for (const p of pulses) {
      const u = (now - p.t) / p.d;
      const x = p.a.cx + (p.b.cx - p.a.cx) * u;
      const y = p.a.cy + (p.b.cy - p.a.cy) * u;
      ctx.fillStyle = `rgba(${COL.copper},${Math.sin(u * 3.1416) * .85})`;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.2832); ctx.fill();
    }

    // ladder cross-rungs between main path and braided strand (network spine)
    const maxLen = main[main.length - 1].l;
    ctx.lineWidth = 1;
    for (let L = 24; L < maxLen; L += 28) {
      const pm = pointAtLen(main, L);
      if (pm.y < top || pm.y > bottom) continue;
      const ps = pointAtLen(strand, lenAtY(strand, pm.y));
      const done = pm.y <= headY;
      ctx.strokeStyle = done ? `rgba(${COL.forest},.34)` : `rgba(${COL.ink},.08)`;
      ctx.beginPath(); ctx.moveTo(pm.x, pm.y); ctx.lineTo(ps.x, ps.y); ctx.stroke();
      if (done && ((L / 28) | 0) % 3 === 0) {
        const mx = (pm.x + ps.x) * .5, my = (pm.y + ps.y) * .5;
        ctx.fillStyle = `rgba(${COL.copper},.55)`;
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }

    // the route ahead (ghost), then the travelled path
    strokeAll(main, 1.3, `rgba(${COL.ink},.2)`, [3, 7]);
    strokeAll(strand, 1, `rgba(${COL.ink},.1)`);
    strokePrefix(strand, headY, 1.5, `rgba(${COL.copper},.68)`);
    strokePrefix(main, headY, 3.2, `rgba(${COL.forest},.98)`);
    ctx.setLineDash([]);

    // twigs + nodes + technical reticles
    for (let i = 0; i < N; i++) {
      const n = nodes[i], a = act[i];
      if (a > .01) {
        const tw = twigs[i];
        // Branch 1: curved trace
        const pts1 = bezier(tw.a, tw.c1, tw.c1, tw.b1, 14), k1 = Math.max(1, Math.round(pts1.length * a));
        ctx.beginPath(); ctx.moveTo(pts1[0].x, pts1[0].y);
        for (let q = 1; q < k1; q++) ctx.lineTo(pts1[q].x, pts1[q].y);
        ctx.strokeStyle = `rgba(${COL.forest},${.8 * a})`; ctx.lineWidth = 1.5; ctx.stroke();
        // terminal diamond on branch 1
        const e1 = pts1[k1 - 1];
        ctx.fillStyle = `rgba(${COL.copper},${a})`;
        ctx.beginPath();
        ctx.moveTo(e1.x, e1.y - 3.5 * a); ctx.lineTo(e1.x + 3.5 * a, e1.y);
        ctx.lineTo(e1.x, e1.y + 3.5 * a); ctx.lineTo(e1.x - 3.5 * a, e1.y);
        ctx.closePath(); ctx.fill();

        // Branch 2: 90-degree circuit trace
        ctx.beginPath();
        ctx.moveTo(tw.a.x, tw.a.y);
        ctx.lineTo(tw.a.x + (tw.c2.x - tw.a.x) * a, tw.a.y);
        if (a > .5) {
          const a2 = (a - .5) * 2;
          ctx.lineTo(tw.c2.x, tw.c2.y + (tw.b2.y - tw.c2.y) * a2);
        }
        ctx.strokeStyle = `rgba(${COL.copper},${.65 * a})`; ctx.lineWidth = 1.2; ctx.stroke();
        if (a > .85) {
          ctx.strokeStyle = `rgba(${COL.copper},${a})`;
          ctx.strokeRect(tw.b2.x - 2.5, tw.b2.y - 2.5, 5, 5);
          ctx.font = '700 9px "Courier New", monospace';
          ctx.fillStyle = `rgba(${COL.forest},${.75 * a})`;
          ctx.fillText(tw.tag, Math.max(6, Math.min(n.x - 34, tw.b1.x - 10)), tw.b1.y + 13);
        }

        glow(n.x, n.y, 44, i === active ? COL.copper : COL.forest, .24 * a);
        drawReticle(n.x, n.y, 28, i === active ? COL.copper : COL.forest, (i === active ? .75 : .38) * a, motion ? now * .0006 * (i % 2 ? 1 : -1) : 0);
      }
      if (i === active && motion) {
        const ph = ((now - activatedAt[i]) % 2400) / 2400;
        ctx.beginPath(); ctx.arc(n.x, n.y, 24 + ph * 26, 0, 6.2832);
        ctx.strokeStyle = `rgba(${COL.copper},${(1 - ph) * .55})`; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // activation sparks (geometric crosses & particles)
    bursts = bursts.filter(b => now - b.t < 1000);
    for (const b of bursts) {
      const p = (now - b.t) / 1000, e = 1 - Math.pow(1 - p, 3);
      const bx = b.x + Math.cos(b.a) * e * 52, by = b.y + Math.sin(b.a) * e * 52;
      ctx.strokeStyle = `rgba(${COL.copper},${(1 - p) * .85})`;
      ctx.lineWidth = 1.3;
      const s = 3 * (1 - p) + 1;
      ctx.beginPath();
      ctx.moveTo(bx - s, by); ctx.lineTo(bx + s, by);
      ctx.moveTo(bx, by - s); ctx.lineTo(bx, by + s);
      ctx.stroke();
    }

    // particles travel both the main path and the braided secondary strand
    if (motion && headLen > 20) {
      const strandLen = lenAtY(strand, headY);
      particleBase += dt * .00004;
      for (const p of particles) {
        p.f = (p.f + dt * .001 * p.v) % 1;
        const pts = p.s ? strand : main;
        const hL = p.s ? strandLen : headLen;
        if (hL <= 10) continue;
        const L = p.f * hL;
        const col = p.s ? COL.forest : COL.copper;
        for (let k = 0; k < 4; k++) {
          const q = pointAtLen(pts, L - k * 7);
          ctx.fillStyle = `rgba(${col},${(.9 - k * .22) * Math.min(1, hL / 120)})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, p.r * (1 - k * .15), 0, 6.2832); ctx.fill();
        }
      }
    }

    // leading heads + target reticle
    glow(hp.x, hp.y, 26, COL.copper, .45);
    drawReticle(hp.x, hp.y, 11, COL.copper, .75, motion ? -now * .0015 : 0);
    ctx.fillStyle = `rgb(${COL.copper})`; ctx.beginPath(); ctx.arc(hp.x, hp.y, 4.5, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#191622'; ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = `rgb(${COL.forest})`; ctx.beginPath(); ctx.arc(hs.x, hs.y, 3, 0, 6.2832); ctx.fill();

    ctx.restore();
  }

  /* ---------- scroll-derived state ---------- */
  function computeTarget() {
    const center = window.scrollY + VH * .52 - secTop;
    targetHead = clamp(center, startY, endY);
  }
  function updateMeter() {
    const f = clamp((headY - startY) / ((endY - startY) || 1), 0, 1);
    meterFill.style.transform = `scaleX(${f.toFixed(4)})`;
  }
  let panelTimer = 0;
  function setPanel(i, instant) {
    const k = Math.max(i, 0), c = chapters[k];
    const apply = () => {
      panelNum.textContent = String(k + 1).padStart(2, '0');
      panelLabel.textContent = c.dataset.label;
      panelTitle.textContent = c.dataset.short;
      panelCount.textContent = String(Math.max(i + 1, 0));
    };
    clearTimeout(panelTimer);
    if (instant || reduced.matches) { apply(); return; }
    panelNum.classList.add('is-out'); panelLabel.classList.add('is-out'); panelTitle.classList.add('is-out');
    panelTimer = setTimeout(() => {
      apply();
      panelNum.classList.remove('is-out'); panelNum.classList.add('is-in');
      void panelNum.offsetWidth;
      panelNum.classList.remove('is-in'); panelLabel.classList.remove('is-out'); panelTitle.classList.remove('is-out');
    }, 320);
  }

  function updateActive() {
    const mid = window.innerHeight * .5;
    let idx = -1;
    chapters.forEach((li, i) => { if (li.getBoundingClientRect().top <= mid + 40) idx = i; });
    // also require we are inside the journey section
    const r = journey.getBoundingClientRect();
    if (r.top > mid || r.bottom < mid) idx = r.bottom < mid ? N - 1 : -1;
    if (idx === active) return;
    const prev = active; active = idx;
    visited = Math.max(visited, idx);
    chapters.forEach((li, i) => {
      li.classList.toggle('is-active', i === idx);
      li.classList.toggle('is-visited', i <= idx);
      markers[i].toggleAttribute('data-current', i === idx);
      if (i === idx) markers[i].setAttribute('aria-current', 'step'); else markers[i].removeAttribute('aria-current');
    });
    journey.dataset.theme = String(Math.max(idx, 0));
    setPanel(idx);
    if (idx >= 0 && idx !== prev) {
      activatedAt[idx] = performance.now();
      const n = nodes[idx];
      if (n && !reduced.matches) for (let k = 0; k < 8; k++) bursts.push({ x: n.x, y: n.y, a: k / 8 * 6.2832 + .3, t: performance.now() });
    }
  }

  /* ---------- loop ---------- */
  function step(now) {
    const dt = Math.min(48, now - (lastT || now)); lastT = now;
    computeTarget();
    headY += (targetHead - headY) * clamp(dt / 120, 0, 1);
    if (Math.abs(targetHead - headY) < .1) headY = targetHead;
    for (let i = 0; i < N; i++) {
      const goal = headY >= nodes[i].y - 6 ? 1 : 0;
      act[i] += (goal - act[i]) * clamp(dt / 260, 0, 1);
    }
    updateMeter();
    draw(now, dt);
    // parallax on the oversized outline numerals
    for (let i = 0; i < N; i++) {
      const r = cards[i].getBoundingClientRect();
      if (r.bottom < -100 || r.top > VH + 100) continue;
      bignums[i].style.translate = `0 ${((r.top + r.height / 2 - VH / 2) * -.07).toFixed(1)}px`;
    }
    rafId = running ? requestAnimationFrame(step) : 0;
  }
  function start() { if (running || reduced.matches) return; running = true; lastT = 0; rafId = requestAnimationFrame(step); }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  // reduced motion / not looping: render a single, static frame
  let staticQueued = false;
  function renderStatic() {
    if (staticQueued) return; staticQueued = true;
    requestAnimationFrame(t => {
      staticQueued = false;
      computeTarget(); headY = targetHead;
      for (let i = 0; i < N; i++) act[i] = headY >= nodes[i].y - 6 ? 1 : 0;
      updateMeter(); draw(t, 0);
    });
  }

  /* ---------- observers & events ---------- */
  const visIO = new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible && !document.hidden) { reduced.matches ? renderStatic() : start(); } else stop();
  }, { rootMargin: '100px 0px' });
  visIO.observe(journey);

  const seenIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-seen'); seenIO.unobserve(e.target); }
  }), { threshold: .18, rootMargin: '0px 0px -8% 0px' });
  chapters.forEach(c => reduced.matches ? c.classList.add('is-seen') : seenIO.observe(c));

  const activeIO = new IntersectionObserver(updateActive, { rootMargin: '-48% 0px -48% 0px', threshold: [0, 1] });
  chapters.forEach(c => activeIO.observe(c));
  activeIO.observe(journey);

  const onScroll = () => { if (reduced.matches && visible) renderStatic(); };
  addEventListener('scroll', onScroll, { passive: true });

  let resizeQueued = false;
  function relayout() {
    if (resizeQueued) return; resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      layout(); computeTarget(); updateActive();
      if (!running) renderStatic();
    });
  }
  const ro = new ResizeObserver(relayout);
  ro.observe(journey);
  addEventListener('resize', relayout);
  document.fonts && document.fonts.ready.then(relayout);

  // sticky header height -> CSS variable (the mobile progress bar sits beneath it)
  const hro = header && new ResizeObserver(() => {
    const h = header.getBoundingClientRect().height + 'px';
    body.style.setProperty('--hdr', h);
    journey.style.setProperty('--hdr', h);
  });
  hro && hro.observe(header);

  const onVis = () => { if (document.hidden) stop(); else if (visible) reduced.matches ? renderStatic() : start(); };
  document.addEventListener('visibilitychange', onVis);

  const onMQ = () => { stop(); if (visible) reduced.matches ? renderStatic() : start(); if (reduced.matches) chapters.forEach(c => c.classList.add('is-seen')); };
  reduced.addEventListener && reduced.addEventListener('change', onMQ);

  /* ---------- interactions ---------- */
  markers.forEach((btn, i) => btn.addEventListener('click', () => {
    const card = cards[i];
    card.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
    const h = card.querySelector('h3');
    h.setAttribute('tabindex', '-1');
    setTimeout(() => h.focus({ preventScroll: true }), reduced.matches ? 0 : 700);
  }));

  journey.querySelectorAll('.ab-more').forEach(btn => btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    document.getElementById(btn.getAttribute('aria-controls')).classList.toggle('is-open', open);
  }));

  // clean up
  addEventListener('pagehide', () => {
    stop(); visIO.disconnect(); seenIO.disconnect(); activeIO.disconnect(); ro.disconnect(); hro && hro.disconnect();
    removeEventListener('scroll', onScroll); removeEventListener('resize', relayout);
    document.removeEventListener('visibilitychange', onVis);
    reduced.removeEventListener && reduced.removeEventListener('change', onMQ);
  });

  /* ---------- init ---------- */
  layout(); computeTarget(); headY = targetHead; updateActive(); setPanel(active, true); updateMeter();
  if (reduced.matches) renderStatic();
})();
