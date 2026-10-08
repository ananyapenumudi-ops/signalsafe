/** Procedural scene parts for the landing page. No external assets. */
import * as THREE from 'three'

export const C = {
  night: 0x10150b,
  ground: 0x161d0f,
  olive: 0x33401f,
  olive2: 0x46562b,
  olive3: 0x5d6f3a,
  sage: 0xa6b59b,
  parch: 0xefe7cd,
  sand: 0xd9cda8,
  rust: 0xc4552b,
  brass: 0xc9a46a,
  ink: 0x20251a,
  // lamps are pushed above the bloom threshold
  red: 0xff3b2f,
  yel: 0xffb52e,
  grn: 0x4dff7a,
  off: 0x1d1f18,
  warm: 0xfff1c9,
}

export const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...extra })
export const glow = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false })

export const TRACK_START = 60
export const TRACK_END = -760
export const GAUGE = 1.5

/** Ballast, two rails and instanced sleepers along -Z at x = xOff. */
export function makeTrack(from = TRACK_START, to = TRACK_END, xOff = 0): THREE.Group {
  const g = new THREE.Group()
  const len = from - to
  const mid = (from + to) / 2
  const ballast = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, len), std(0x2a2c22, { roughness: 1 }))
  ballast.position.set(xOff, 0.05, mid)
  ballast.receiveShadow = true
  g.add(ballast)
  const railMat = std(C.brass, { metalness: 0.7, roughness: 0.35 })
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, len), railMat)
    rail.position.set(xOff + (sx * GAUGE) / 2, 0.33, mid)
    g.add(rail)
  }
  const spacing = 0.9
  const n = Math.floor(len / spacing)
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.12, 0.32), std(0x3b3226, { roughness: 1 }), n)
  const m = new THREE.Matrix4()
  for (let i = 0; i < n; i++) {
    m.makeTranslation(xOff, 0.2, from - i * spacing)
    sleepers.setMatrixAt(i, m)
  }
  g.add(sleepers)
  return g
}

export type AspectName = 'R' | 'Y' | 'YY' | 'G' | 'off'

/** Colour-light signal: lamps top→bottom are Y(upper), G, Y, R. */
export function makeSignal(height = 5.5) {
  const g = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, height, 10), std(0x8a8f80, { metalness: 0.6 }))
  mast.position.y = height / 2
  g.add(mast)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.5, 0.45), std(C.ink, { roughness: 0.5 }))
  head.position.set(0, height + 0.8, 0)
  g.add(head)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.6), std(C.ink))
  hood.position.set(0, height + 2.08, 0.1)
  g.add(hood)
  const colours = [C.yel, C.grn, C.yel, C.red]
  const lamps = colours.map((col, i) => {
    const mat = glow(C.off)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat)
    lamp.position.set(0, height + 1.75 - i * 0.6, 0.24)
    g.add(lamp)
    return { mat, col }
  })
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: C.yel, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  halo.scale.set(3, 3, 1)
  halo.position.set(0, height + 0.8, 0.5)
  g.add(halo)
  const lit: Record<AspectName, number[]> = { R: [3], Y: [2], YY: [0, 2], G: [1], off: [] }
  const haloCol: Record<AspectName, number> = { R: C.red, Y: C.yel, YY: C.yel, G: C.grn, off: C.off }
  function setAspect(a: AspectName) {
    lamps.forEach((l, i) => l.mat.color.setHex(lit[a].includes(i) ? l.col : C.off))
    halo.material.color.setHex(haloCol[a])
    halo.visible = a !== 'off'
  }
  setAspect('R')
  return { group: g, setAspect }
}

/** Kavach-fitted loco (WAP-style box body) with optional coaches. */
export function makeLoco(coaches = 2) {
  const g = new THREE.Group()
  const body = std(C.olive2, { roughness: 0.55, metalness: 0.25 })
  const len = 9
  const shell = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, len), body)
  shell.position.set(0, 1.9, 0)
  g.add(shell)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 0.9), body)
  nose.position.set(0, 1.45, -len / 2 - 0.4)
  g.add(nose)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.32, len + 0.02), std(C.rust, { roughness: 0.4 }))
  stripe.position.set(0, 1.55, 0)
  g.add(stripe)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, len - 1), std(C.brass, { metalness: 0.3, roughness: 0.7 }))
  roof.position.set(0, 3.27, 0)
  g.add(roof)
  const glass = glow(0x2c4656, 0.9) // dark glass: stays under the bloom threshold
  const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), glass)
  windscreen.position.set(0, 2.55, -len / 2 - 0.01)
  windscreen.rotation.y = Math.PI
  g.add(windscreen)
  const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), glow(C.warm))
  headlight.position.set(0, 2.05, -len / 2 - 0.86)
  headlight.rotation.y = Math.PI
  g.add(headlight)
  for (const sx of [-0.7, 0.7]) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), glow(C.warm))
    marker.position.set(sx, 1.0, -len / 2 - 0.86)
    marker.rotation.y = Math.PI
    g.add(marker)
  }
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 18)
  const wheelMat = std(0x15170f, { metalness: 0.6 })
  for (const z of [-3, -1.8, 1.8, 3]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat)
      w.rotation.z = Math.PI / 2
      w.position.set((sx * GAUGE) / 2 + sx * 0.05, 0.62, z)
      g.add(w)
    }
  }
  // Kavach roof antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9), std(0xcccccc, { metalness: 0.8 }))
  ant.position.set(0.5, 3.8, -2)
  g.add(ant)
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(C.rust))
  antTip.position.set(0.5, 4.27, -2)
  g.add(antTip)
  for (let c = 0; c < coaches; c++) {
    const coach = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.6, 10), std(c % 2 ? C.olive : 0x3d4a26, { roughness: 0.6 }))
    coach.position.set(0, 1.95, len / 2 + 0.6 + 5 + c * 10.6)
    g.add(coach)
    for (let w = 0; w < 6; w++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), glow(0xffd98a, 0.85))
      win.position.set(1.16, 2.2, coach.position.z - 3.8 + w * 1.5)
      win.rotation.y = Math.PI / 2
      g.add(win)
      const win2 = win.clone()
      win2.position.x = -1.16
      win2.rotation.y = -Math.PI / 2
      g.add(win2)
    }
  }
  return { group: g, noseOffset: -len / 2 - 0.9, headlight }
}

/** Lattice radio tower with a blinking aviation lamp. */
export function makeTower(h = 16) {
  const g = new THREE.Group()
  const mat = std(0x9aa08c, { metalness: 0.6, roughness: 0.5 })
  const base = 1.6
  const top = 0.35
  const legs: [THREE.Vector3, THREE.Vector3][] = []
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const a = new THREE.Vector3(sx * base, 0, sz * base)
    const b = new THREE.Vector3(sx * top, h, sz * top)
    legs.push([a, b])
    g.add(beam(a, b, 0.07, mat))
  }
  for (let i = 0; i < 7; i++) {
    const t0 = i / 7
    const t1 = (i + 1) / 7
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = legs[k]!
      const [a1, b1] = legs[(k + 1) % 4]!
      const p0 = a0.clone().lerp(b0, t0)
      const q1 = a1.clone().lerp(b1, t1)
      g.add(beam(p0, q1, 0.03, mat))
      g.add(beam(a0.clone().lerp(b0, t1), a1.clone().lerp(b1, t1), 0.03, mat))
    }
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), glow(C.red))
  lamp.position.y = h + 0.5
  g.add(lamp)
  const dishMat = std(C.parch, { roughness: 0.4 })
  for (const ry of [0.6, 2.4]) {
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.18, 20), dishMat)
    dish.rotation.set(Math.PI / 2, 0, ry)
    dish.position.set(Math.cos(ry) * 0.6, h - 1.5, Math.sin(ry) * 0.6)
    g.add(dish)
  }
  return { group: g, lamp, top: new THREE.Vector3(0, h + 0.5, 0) }
}

function beam(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat)
  m.position.copy(a).lerp(b, 0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

/** Station building housing the Stationary Kavach. */
export function makeStation(name: string) {
  const g = new THREE.Group()
  const walls = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 5), std(C.parch, { roughness: 0.9 }))
  walls.position.y = 2
  g.add(walls)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.2, 4, 1), std(C.rust, { roughness: 0.7 }))
  roof.rotation.y = Math.PI / 4
  roof.scale.set(1, 1, 0.62)
  roof.position.y = 5.1
  g.add(roof)
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), glow(0xffd98a, 0.9))
    w.position.set(-3.1 + i * 2.05, 2.3, 2.51)
    g.add(w)
  }
  const sign = label(name, { size: 0.8, color: '#efe7cd', bg: 'rgba(51,64,31,0.95)' })
  sign.position.set(0, 3.55, 2.8)
  g.add(sign)
  // platform
  const plat = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 3), std(0x6b6552, { roughness: 1 }))
  plat.position.set(0, 0.3, 4.5)
  g.add(plat)
  return g
}

/** RFID tag with controllable glow. */
export function makeTag() {
  const mat = glow(C.rust)
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.24), mat)
  m.position.y = 0.3
  const base = new THREE.Color(0x5a2410)
  const hot = new THREE.Color(0xff7a3a)
  return {
    mesh: m,
    set(intensity: number) {
      mat.color.copy(base).lerp(hot, Math.min(Math.max(intensity, 0), 1))
    },
  }
}

/** Brass ring with orbiting dots — the Signal Box ornament. */
export function makeOrnament(radius: number) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 8, 160), glow(C.brass, 0.9))
  g.add(ring)
  const dots = new THREE.Group()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const d = new THREE.Mesh(new THREE.SphereGeometry(i % 2 ? 0.12 : 0.22, 12, 10), glow(i % 2 ? C.brass : C.rust))
    d.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    dots.add(d)
  }
  g.add(dots)
  return { group: g, dots }
}

let halo: THREE.Texture | null = null
export function haloTexture(): THREE.Texture {
  if (halo) return halo
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = grad
  x.fillRect(0, 0, 128, 128)
  halo = new THREE.CanvasTexture(c)
  return halo
}

/** Text sprite drawn on a canvas. */
export function label(text: string, o: { size?: number; color?: string; bg?: string; font?: string } = {}) {
  const size = o.size ?? 1
  const c = document.createElement('canvas')
  const x = c.getContext('2d')!
  const font = o.font ?? '700 64px "JetBrains Mono", monospace'
  x.font = font
  const w = Math.ceil(x.measureText(text).width) + 64
  c.width = w
  c.height = 112
  x.font = font
  if (o.bg) {
    x.fillStyle = o.bg
    roundRect(x, 4, 4, w - 8, 104, 52)
    x.fill()
  }
  x.fillStyle = o.color ?? '#efe7cd'
  x.textBaseline = 'middle'
  x.fillText(text, 32, 58)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xcfcfcf, transparent: true, depthWrite: false, toneMapped: false }))
  s.scale.set((w / 112) * size, size, 1)
  return s
}

/** A report card plane with a title and pass/fail rows. */
export function makeCard(title: string, rows: { ok: boolean; text: string; ref: string }[]) {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 120 + rows.length * 74
  const x = c.getContext('2d')!
  x.fillStyle = '#f9f5e7'
  roundRect(x, 0, 0, c.width, c.height, 28)
  x.fill()
  x.fillStyle = '#33401f'
  roundRect(x, 0, 0, c.width, 70, 28)
  x.fill()
  x.fillRect(0, 40, c.width, 30)
  x.fillStyle = '#efe7cd'
  x.font = '700 30px "JetBrains Mono", monospace'
  x.fillText(title, 28, 46)
  rows.forEach((r, i) => {
    const y = 120 + i * 74
    x.fillStyle = r.ok ? '#3f8f4f' : '#c8372d'
    x.beginPath()
    x.arc(44, y - 10, 13, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#20251a'
    x.font = '500 28px Manrope, sans-serif'
    x.fillText(r.text, 74, y)
    x.fillStyle = '#9c3f1b'
    x.font = '700 24px "JetBrains Mono", monospace'
    x.fillText(r.ref, c.width - 130, y)
  })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const w = 6
  // tinted below the bloom threshold so the parchment doesn't blow out
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, (w * c.height) / c.width),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xa9a9a9, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
  )
  return mesh
}

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath()
  x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r)
  x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r)
  x.arcTo(px, py, px + w, py, r)
  x.closePath()
}
