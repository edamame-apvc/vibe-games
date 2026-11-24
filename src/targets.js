import * as THREE from 'three';
import { signTexture } from './assets.js';
import { LANES } from './world.js';

// Reactive steel targets: knock-down silhouettes, a plate rack, a moving
// silhouette on a rail, and a long-range gong that swings when hit.

const paints = {
  white: new THREE.MeshStandardMaterial({ color: 0xe2ddd2, roughness: 0.62, metalness: 0.15 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xd8641c, roughness: 0.6, metalness: 0.15 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x4d5054, roughness: 0.5, metalness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.7, metalness: 0.6 }),
};

function silhouetteShapes() {
  // Original simplified humanoid silhouette (metres). Built from three zones.
  const head = new THREE.Shape();
  head.absarc(0, 1.55, 0.11, 0, Math.PI * 2, false);
  const torso = new THREE.Shape();
  torso.moveTo(-0.08, 1.42); torso.lineTo(0.08, 1.42);
  torso.lineTo(0.24, 1.33); torso.lineTo(0.25, 1.0); torso.lineTo(0.2, 0.86);
  torso.lineTo(-0.2, 0.86); torso.lineTo(-0.25, 1.0); torso.lineTo(-0.24, 1.33);
  torso.closePath();
  const legs = new THREE.Shape();
  legs.moveTo(-0.2, 0.86); legs.lineTo(0.2, 0.86); legs.lineTo(0.18, 0.5); legs.lineTo(-0.18, 0.5);
  legs.closePath();
  return { head, torso, legs };
}

function plate(shape, mat) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 20 });
  g.translate(0, 0, -0.006);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export class Targets {
  constructor(scene, audio, effects) {
    this.scene = scene;
    this.audio = audio;
    this.effects = effects;
    this.list = [];
    this.meshes = [];
    this.root = new THREE.Group();
    scene.add(this.root);
    const shapes = silhouetteShapes();

    const lane = [
      [LANES[0], 10], [LANES[1], 20], [LANES[3], 50], [LANES[4], 75],
      [LANES[5], 100], [LANES[6], 150], [LANES[7], 200], [5.5, 35], [-11, 35], [8.5, 15],
    ];
    lane.forEach(([x, d], i) => this.addSilhouette(shapes, x, -d, i % 3 === 1 ? paints.orange : paints.white));
    this.addPlateRack(LANES[2], -25);
    this.moving = this.addSilhouette(shapes, 0, -60, paints.orange, { moving: true });
    this.addGong(0, -300);
  }

  register(mesh, target, zone) {
    mesh.userData.target = target;
    mesh.userData.zone = zone;
    mesh.userData.surface = 'steel';
    this.meshes.push(mesh);
  }

  sign(x, z, text) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.05), paints.dark);
    post.position.set(x, 0.225, z);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: signTexture(text, { font: 'bold 76px Arial' }), roughness: 0.8 }));
    s.position.set(x, 0.5, z + 0.03);
    post.castShadow = s.castShadow = true;
    this.root.add(post, s);
  }

  addSilhouette(shapes, x, z, paint, { moving = false } = {}) {
    const base = new THREE.Group();
    base.position.set(x, 0, z);
    this.root.add(base);
    // stand: base plate + two legs
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), paints.dark);
    foot.position.y = 0.02;
    foot.castShadow = foot.receiveShadow = true;
    base.add(foot);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.5, 0);
    base.add(pivot);
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.06), paints.steel);
    mount.position.set(0, -0.24, 0.03);
    mount.castShadow = true;
    base.add(mount);
    mount.position.y = 0.26;
    const body = new THREE.Group();
    body.position.y = -0.5;
    pivot.add(body);
    const t = { type: 'silhouette', base, pivot, hp: 100, down: false, fall: 0, fallVel: 0, timer: 0, wobble: 0, wobbleVel: 0, distance: -z, moving, dir: 1 };
    for (const zone of ['head', 'torso', 'legs']) {
      const m = plate(shapes[zone], paint);
      body.add(m);
      this.register(m, t, zone);
    }
    if (!moving) this.sign(x + 0.55, z + 0.4, `${Math.round(-z)} m`);
    else {
      const railMat = paints.dark;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(26, 0.06, 0.12), railMat);
      rail.position.set(0, 0.03, z);
      rail.receiveShadow = rail.castShadow = true;
      this.root.add(rail);
      this.sign(13.5, z + 0.4, `${Math.round(-z)} m`);
    }
    this.list.push(t);
    return t;
  }

  addPlateRack(x, z) {
    const base = new THREE.Group();
    base.position.set(x, 0, z);
    this.root.add(base);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.08), paints.dark);
    bar.position.y = 0.75;
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.78, 0.06), paints.dark);
      leg.position.set(sx, 0.39, 0);
      leg.castShadow = true;
      base.add(leg);
    }
    bar.castShadow = true;
    base.add(bar);
    const rack = { type: 'rack', plates: [], timer: 0, distance: -z };
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(-0.6 + i * 0.3, 0.78, 0.06);
      base.add(pivot);
      const g = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 28);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.13, 0);
      const m = new THREE.Mesh(g, paints.white);
      m.castShadow = m.receiveShadow = true;
      pivot.add(m);
      const p = { type: 'plate', pivot, down: false, fall: 0, fallVel: 0, rack, distance: -z };
      rack.plates.push(p);
      this.register(m, p, 'plate');
    }
    this.sign(x + 1.1, z + 0.4, `${Math.round(-z)} m`);
    this.list.push(rack);
  }

  addGong(x, z) {
    const base = new THREE.Group();
    base.position.set(x, 0, z);
    this.root.add(base);
    for (const sx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), paints.dark);
      post.position.set(sx, 1.2, 0);
      post.castShadow = true;
      base.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), paints.dark);
    beam.position.y = 2.35;
    beam.castShadow = true;
    base.add(beam);
    const pivot = new THREE.Group();
    pivot.position.y = 2.3;
    base.add(pivot);
    const g = new THREE.BoxGeometry(1.1, 1.1, 0.02);
    g.translate(0, -0.85, 0);
    const m = new THREE.Mesh(g, paints.white);
    m.castShadow = m.receiveShadow = true;
    pivot.add(m);
    for (const sx of [-0.4, 0.4]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), paints.steel);
      chain.position.set(sx, -0.15, 0);
      pivot.add(chain);
    }
    const t = { type: 'gong', pivot, swing: 0, swingVel: 0, distance: -z };
    this.register(m, t, 'torso');
    this.sign(x + 1.3, z + 0.5, `${Math.round(-z)} m`);
    this.list.push(t);
  }

  /** Returns { counted, killed } – counted=false if target is already down. */
  hit(target, zone, damage, distance) {
    if (target.type === 'silhouette') {
      if (target.down) return { counted: false };
      target.wobbleVel += 2.5 + damage * 0.03;
      target.hp -= damage;
      this.audio.steelPing(distance, 1);
      if (target.hp <= 0) {
        target.down = true;
        target.fallVel = 2 + damage * 0.02;
        target.timer = 2.6;
        return { counted: true, killed: true };
      }
      return { counted: true, killed: false };
    }
    if (target.type === 'plate') {
      if (target.down) return { counted: false };
      target.down = true;
      target.fallVel = 6;
      this.audio.steelPing(distance, 0.8);
      const all = target.rack.plates.every((p) => p.down);
      if (all) target.rack.timer = 2.5;
      return { counted: true, killed: true };
    }
    if (target.type === 'gong') {
      target.swingVel -= 1.2 + damage * 0.012;
      this.audio.steelPing(distance, 1.4);
      return { counted: true, killed: false };
    }
    return { counted: false };
  }

  /** Blast damage. clearLine(from, to) is true when nothing solid is in between. */
  explosion(pos, radius, clearLine, listener) {
    const out = [];
    const consider = (t, point) => {
      const d = point.distanceTo(pos);
      if (d > radius) return;
      let dmg = Math.round(180 * Math.pow(1 - d / radius, 1.3));
      if (!clearLine(pos.clone().add(new THREE.Vector3(0, 0.15, 0)), point)) dmg = Math.round(dmg * 0.25);
      if (dmg < 5) return;
      const r = this.hit(t, 'torso', dmg, listener.distanceTo(point));
      out.push({ ...r, damage: dmg, point });
    };
    for (const t of this.list) {
      if (t.type === 'silhouette' && !t.down) consider(t, t.base.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.1, 0)));
      else if (t.type === 'rack') { for (const p of t.plates) if (!p.down) consider(p, p.pivot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.13, 0))); }
      else if (t.type === 'gong') consider(t, t.pivot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.85, 0)));
    }
    return out;
  }

  update(dt) {
    for (const t of this.list) {
      if (t.type === 'silhouette') {
        if (t.moving && !t.down) {
          t.base.position.x += t.dir * 2.6 * dt;
          if (Math.abs(t.base.position.x) > 11.5) { t.base.position.x = Math.sign(t.base.position.x) * 11.5; t.dir *= -1; }
        }
        // wobble spring on hit
        t.wobbleVel += (-t.wobble * 160 - t.wobbleVel * 9) * dt;
        t.wobble += t.wobbleVel * dt;
        if (t.down) {
          t.fallVel += 14 * dt;
          t.fall = Math.min(1.45, t.fall + t.fallVel * dt);
          if (t.fall >= 1.45 && t.fallVel > 0) t.fallVel = -t.fallVel * 0.25; // bounce
          t.timer -= dt;
          if (t.timer <= 0) { t.down = false; t.hp = 100; t.fallVel = 0; }
        } else if (t.fall > 0) {
          t.fall = Math.max(0, t.fall - dt * 2.2);
        }
        t.pivot.rotation.x = -t.fall - t.wobble * 0.04;
      } else if (t.type === 'rack') {
        for (const p of t.plates) {
          if (p.down) {
            p.fallVel += 20 * dt;
            p.fall = Math.min(1.5, p.fall + p.fallVel * dt);
          } else p.fall = Math.max(0, p.fall - dt * 3);
          p.pivot.rotation.x = -p.fall;
        }
        if (t.timer > 0) {
          t.timer -= dt;
          if (t.timer <= 0) for (const p of t.plates) { p.down = false; p.fallVel = 0; }
        }
      } else if (t.type === 'gong') {
        t.swingVel += (-t.swing * 9 - t.swingVel * 0.6) * dt;
        t.swing += t.swingVel * dt;
        t.pivot.rotation.x = t.swing;
      }
    }
  }
}
