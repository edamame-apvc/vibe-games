// 2D (top-down) collision world with height ranges: wall segments and round
// posts, stored in a spatial hash so queries only look at nearby geometry.
// Used for the player, bots and the bot navigation grid.

export class CollisionWorld {
  constructor(cell = 8) {
    this.cell = cell;
    this.grid = new Map();
    this.count = 0;
    this._stamp = 0;
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  _insert(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this._key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(item);
      }
    }
    this.count++;
  }

  addSegment(ax, az, bx, bz, y0 = 0, y1 = 100) {
    const s = { t: 0, ax, az, bx, bz, y0, y1, _s: 0 };
    this._insert(s, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  }

  addCircle(x, z, r, y0 = 0, y1 = 100) {
    const c = { t: 1, x, z, r, y0, y1, _s: 0 };
    this._insert(c, x - r, z - r, x + r, z + r);
  }

  addPolygon(pts, y0 = 0, y1 = 100) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.addSegment(a[0], a[1], b[0], b[1], y0, y1);
    }
  }

  /** Oriented rectangle (centre, half sizes, rotation around Y). */
  addBox(cx, cz, hw, hd, rot, y0 = 0, y1 = 100) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
    this.addPolygon(pts, y0, y1);
  }

  query(x, z, r, fn) {
    const c = this.cell;
    const stamp = ++this._stamp;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const it of list) {
          if (it._s === stamp) continue;
          it._s = stamp;
          fn(it);
        }
      }
    }
  }

  /** Push a circle (feet position p, radius, height) out of walls. Returns true if it touched anything. */
  resolve(p, radius, height, stepHeight = 0.4) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(p.x, p.z, radius + 0.5, (it) => {
        if (it.y1 <= p.y + stepHeight || it.y0 >= p.y + height) return;
        if (it.t === 0) {
          const dx = it.bx - it.ax, dz = it.bz - it.az;
          const len2 = dx * dx + dz * dz || 1e-6;
          let t = ((p.x - it.ax) * dx + (p.z - it.az) * dz) / len2;
          t = Math.max(0, Math.min(1, t));
          const cx = it.ax + dx * t, cz = it.az + dz * t;
          const ex = p.x - cx, ez = p.z - cz;
          const d = Math.hypot(ex, ez);
          if (d < radius) {
            const nx = d > 1e-5 ? ex / d : -dz, nz = d > 1e-5 ? ez / d : dx;
            const nl = Math.hypot(nx, nz) || 1;
            p.x += (nx / nl) * (radius - d);
            p.z += (nz / nl) * (radius - d);
            moved = hit = true;
          }
        } else {
          const ex = p.x - it.x, ez = p.z - it.z;
          const d = Math.hypot(ex, ez), min = radius + it.r;
          if (d < min && d > 1e-5) {
            p.x += (ex / d) * (min - d);
            p.z += (ez / d) * (min - d);
            moved = hit = true;
          }
        }
      });
      if (!moved) break;
    }
    return hit;
  }

  /** Is a circle at (x,z) overlapping anything in the height band? */
  blocked(x, z, r, y0 = 0.3, y1 = 1.8) {
    let b = false;
    this.query(x, z, r + 0.5, (it) => {
      if (b || it.y1 <= y0 || it.y0 >= y1) return;
      if (it.t === 0) {
        const dx = it.bx - it.ax, dz = it.bz - it.az;
        const len2 = dx * dx + dz * dz || 1e-6;
        let t = ((x - it.ax) * dx + (z - it.az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - (it.ax + dx * t), z - (it.az + dz * t)) < r) b = true;
      } else if (Math.hypot(x - it.x, z - it.z) < r + it.r) b = true;
    });
    return b;
  }
}

export function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
