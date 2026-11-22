import * as THREE from 'three';
import { DataUtils } from 'three';

/**
 * Sky + image-based lighting from the HDRI, and a directional "sun" placed
 * exactly where the sun is in the photo, so real-time shadows match the sky.
 */
export function setupSky(scene, renderer, hdr) {
  const texSun = findSunInHdr(hdr);

  // Rotate the sky so the sun sits behind-right of the shooter (player looks down -Z):
  // targets get front light and long shadows fall down-range.
  const desiredAzimuth = Math.atan2(0.82, 0.57);
  const texAzimuth = Math.atan2(texSun.z, texSun.x);
  const rot = new THREE.Euler(0, texAzimuth - desiredAzimuth, 0);

  scene.background = hdr;
  scene.backgroundRotation.copy(rot);
  scene.backgroundIntensity = 1.0;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(hdr);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentRotation.copy(rot);
  scene.environmentIntensity = 0.55;

  const sunDir = texSun.clone().applyEuler(rot).normalize();

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  return { sun, sunDir, envTexture: envRT.texture, rotation: rot };
}

function findSunInHdr(hdr) {
  const { data, width, height } = hdr.image;
  const half = data instanceof Uint16Array;
  const read = (i) => (half ? DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  // Only the upper half of the image can contain the sun.
  for (let y = 0; y < height / 2; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const lum = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (lum > best) { best = lum; bx = x; by = y; }
    }
  }
  const u = (bx + 0.5) / width;
  const v = 1 - (by + 0.5) / height; // HDR rows are stored top-first; texture is flipY'd
  const lat = (v - 0.5) * Math.PI;
  const lon = (u - 0.5) * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));
  if (dir.y < 0.05) dir.y = Math.abs(dir.y) + 0.3; // safety net
  return dir.normalize();
}

/** Keeps the shadow camera centred ahead of the player, snapped to texels to avoid shimmering. */
export function updateSunShadow(sun, sunDir, playerPos, forward, preset) {
  const range = preset.shadowRange;
  const center = new THREE.Vector3(playerPos.x + forward.x * range * 0.35, 0, playerPos.z + forward.z * range * 0.35);

  const cam = sun.shadow.camera;
  if (cam.right !== range / 2 || sun.shadow.mapSize.x !== preset.shadowSize) {
    cam.left = cam.bottom = -range / 2;
    cam.right = cam.top = range / 2;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== preset.shadowSize) {
      sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }
  sun.shadow.radius = preset.shadowRadius;

  // Texel snapping in light space.
  const texel = range / preset.shadowSize;
  const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
  const inv = lightRot.clone().invert();
  const ls = center.clone().applyMatrix4(inv);
  ls.x = Math.round(ls.x / texel) * texel;
  ls.y = Math.round(ls.y / texel) * texel;
  center.copy(ls.applyMatrix4(lightRot));

  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDir, 200);
  sun.target.updateMatrixWorld();
}

/** Average colour of the sky just above the horizon (linear HDR) – used as fog colour so distance haze matches the sky. */
export function horizonColor(hdr) {
  const { data, width, height } = hdr.image;
  const half = data instanceof Uint16Array;
  const read = (i) => (half ? DataUtils.fromHalfFloat(data[i]) : data[i]);
  const rows = [Math.floor(height * 0.47), Math.floor(height * 0.45)];
  let r = 0, g = 0, b = 0, n = 0;
  for (const y of rows) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      r += read(i); g += read(i + 1); b += read(i + 2); n++;
    }
  }
  return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.LinearSRGBColorSpace);
}
