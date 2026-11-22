// Walkability grid + A* path finding for bots.

export class NavGrid {
  constructor(bounds, walkable, cell = 1.5) {
    this.b = bounds;
    this.cell = cell;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.open = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.center(i, j);
        this.open[j * this.w + i] = walkable(x, z, 0.5) ? 1 : 0;
      }
    }
    // scratch buffers for A*
    const n = this.w * this.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.openCells = [];
    for (let k = 0; k < n; k++) if (this.open[k]) this.openCells.push(k);
  }

  center(i, j) { return [this.b.minX + (i + 0.5) * this.cell, this.b.minZ + (j + 0.5) * this.cell]; }
  cellOf(x, z) {
    return [Math.floor((x - this.b.minX) / this.cell), Math.floor((z - this.b.minZ) / this.cell)];
  }
  isOpen(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.open[j * this.w + i] === 1; }
  walkableAt(x, z) { const [i, j] = this.cellOf(x, z); return this.isOpen(i, j); }

  nearestOpen(x, z, maxR = 12) {
    const [ci, cj] = this.cellOf(x, z);
    for (let r = 0; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.isOpen(ci + di, cj + dj)) return [ci + di, cj + dj];
        }
      }
    }
    return null;
  }

  randomPoint(rand) {
    const k = this.openCells[Math.floor(rand() * this.openCells.length)];
    return this.center(k % this.w, Math.floor(k / this.w));
  }

  /** Straight walkable line between two points (grid DDA). */
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkableAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* from world point to world point. Returns [[x,z],…] or null. */
  findPath(ax, az, bx, bz, maxNodes = 12000) {
    const s = this.nearestOpen(ax, az, 4), t = this.nearestOpen(bx, bz, 8);
    if (!s || !t) return null;
    const W = this.w;
    const start = s[1] * W + s[0], goal = t[1] * W + t[0];
    const stamp = ++this.stamp;
    const heap = new MinHeap();
    const hfn = (k) => {
      const dx = Math.abs((k % W) - t[0]), dz = Math.abs(Math.floor(k / W) - t[1]);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz));
    };
    this.g[start] = 0; this.seen[start] = stamp; this.came[start] = -1;
    heap.push(start, hfn(start));
    let expanded = 0, found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      if (++expanded > maxNodes) break;
      const ci = cur % W, cj = Math.floor(cur / W);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.isOpen(ni, nj)) continue;
          if (di && dj && (!this.isOpen(ci + di, cj) || !this.isOpen(ci, cj + dj))) continue; // no corner cutting
          const nk = nj * W + ni;
          if (this.closed[nk] === stamp) continue;
          const ng = this.g[cur] + (di && dj ? Math.SQRT2 : 1);
          if (this.seen[nk] !== stamp || ng < this.g[nk]) {
            this.seen[nk] = stamp; this.g[nk] = ng; this.came[nk] = cur;
            heap.push(nk, ng + hfn(nk));
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = this.came[k]) cells.push(this.center(k % W, Math.floor(k / W)));
    cells.reverse();
    cells[cells.length - 1] = [bx, bz].every(Number.isFinite) && this.walkableAt(bx, bz) ? [bx, bz] : cells[cells.length - 1];
    // string-pulling: skip intermediate points while the straight line stays walkable
    const out = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      const a = cells[anchor], c = cells[i];
      if (!this.clearLine(a[0], a[1], c[0], c[1])) { out.push(cells[i - 1]); anchor = i - 1; }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[par], k[i]] = [k[i], k[par]]; [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
