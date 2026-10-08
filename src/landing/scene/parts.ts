/** Procedural scene parts for the landing page. No external assets. */
import * as THREE from 'three'

export const C = {
  night: 0x7d7250, // dusk haze: fog and horizon share this so the ground melts into the sky
  ground: 0x2b3421,
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
  const railMat = std(0xa08a62, { metalness: 0.35, roughness: 0.55 })
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

/** Contact-wire height of the overhead line (OHE). */
export const WIRE_Y = 5.6

export interface Loco {
  group: THREE.Group
  /** Local z of the nose (negative: the model faces -z). */
  noseOffset: number
  /** +1 if the nose points toward +z in the world, -1 toward -z. */
  facing: 1 | -1
  /** Place the nose at world z and animate from the movement since the last call. */
  moveTo(noseZ: number, dt: number, t: number): void
  /** Current speed in m/s (smoothed), for labels. */
  readonly speed: number
}

/**
 * Kavach-fitted electric loco (WAP-style box body) with coaches.
 * Animated: wheels turn with distance, body and coaches sway with speed,
 * pantograph arcs now and then, brake shoes glow under hard braking.
 */
export function makeLoco(coaches = 2, facing: 1 | -1 = -1): Loco {
  const g = new THREE.Group()
  if (facing === 1) g.rotation.y = Math.PI
  const len = 9
  const bodyMat = std(C.olive2, { roughness: 0.5, metalness: 0.25 })
  const wheels: THREE.Mesh[] = []
  const shoes: THREE.MeshBasicMaterial[] = []
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 18)
  const wheelMat = std(0x15170f, { metalness: 0.6 })
  const spokeMat = std(C.brass, { metalness: 0.6, roughness: 0.4 })

  function bogie(parent: THREE.Object3D, z: number) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 2.6), std(0x1d2016, { metalness: 0.5 }))
    frame.position.set(0, 0.75, z)
    parent.add(frame)
    for (const dz of [-0.75, 0.75]) {
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat)
        w.rotation.z = Math.PI / 2
        w.position.set((sx * GAUGE) / 2 + sx * 0.05, 0.62, z + dz)
        // a brass spoke so rotation reads
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.07), spokeMat)
        spoke.position.y = sx * 0.1
        w.add(spoke)
        parent.add(w)
        wheels.push(w)
        const shoeMat = glow(0x2a1a10)
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.18), shoeMat)
        shoe.position.set((sx * GAUGE) / 2 + sx * 0.18, 0.62, z + dz + 0.46)
        parent.add(shoe)
        shoes.push(shoeMat)
      }
    }
  }

  // body sits on a sprung group so it can bob without moving the wheels
  const body = new THREE.Group()
  g.add(body)
  const shell = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, len), bodyMat)
  shell.position.set(0, 1.95, 0)
  body.add(shell)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 0.9), bodyMat)
  nose.position.set(0, 1.5, -len / 2 - 0.4)
  body.add(nose)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.32, len + 0.02), std(C.rust, { roughness: 0.4 }))
  stripe.position.set(0, 1.6, 0)
  body.add(stripe)
  const cream = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.12, len + 0.02), std(C.parch, { roughness: 0.6 }))
  cream.position.set(0, 1.84, 0)
  body.add(cream)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, len - 1), std(0x6f6a55, { metalness: 0.3, roughness: 0.7 }))
  roof.position.set(0, 3.32, 0)
  body.add(roof)
  const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), glow(0x2c4656, 0.9))
  windscreen.position.set(0, 2.6, -len / 2 - 0.01)
  windscreen.rotation.y = Math.PI
  body.add(windscreen)
  const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), glow(C.warm))
  headlight.position.set(0, 2.1, -len / 2 - 0.86)
  headlight.rotation.y = Math.PI
  body.add(headlight)
  for (const sx of [-0.7, 0.7]) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), glow(C.warm))
    marker.position.set(sx, 1.05, -len / 2 - 0.86)
    marker.rotation.y = Math.PI
    body.add(marker)
  }
  const tail = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), glow(C.red))
  tail.position.set(0, 1.2, len / 2 + 0.01)
  body.add(tail)
  // Kavach roof antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9), std(0xcccccc, { metalness: 0.8 }))
  ant.position.set(0.6, 3.85, -2.6)
  body.add(ant)
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(C.rust))
  antTip.position.set(0.6, 4.32, -2.6)
  body.add(antTip)

  // pantograph: diamond frame up to the contact wire
  const panMat = std(0xb9bcae, { metalness: 0.8, roughness: 0.3 })
  const panZ = 2.2
  const baseY = 3.45
  const kneeY = (baseY + WIRE_Y) / 2
  const pa = new THREE.Vector3(0, baseY, panZ - 0.7)
  const pb = new THREE.Vector3(0, kneeY, panZ + 0.5)
  const pc = new THREE.Vector3(0, WIRE_Y - 0.05, panZ)
  for (const sx of [-0.45, 0.45]) {
    body.add(beamBetween(pa.clone().setX(sx), pb.clone().setX(sx), 0.035, panMat))
    body.add(beamBetween(pb.clone().setX(sx), pc.clone().setX(sx * 0.6), 0.035, panMat))
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.14), panMat)
  head.position.copy(pc)
  body.add(head)
  const arc = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0x9fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  arc.position.set(0, WIRE_Y, panZ)
  arc.scale.setScalar(1.6)
  arc.visible = false
  body.add(arc)

  bogie(g, -2.6)
  bogie(g, 2.6)

  const coachBodies: THREE.Group[] = []
  for (let c = 0; c < coaches; c++) {
    const cz = len / 2 + 0.6 + 5 + c * 10.6
    const cb = new THREE.Group()
    cb.position.z = cz
    g.add(cb)
    const shellC = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.6, 10), std(c % 2 ? C.olive : 0x3d4a26, { roughness: 0.55 }))
    shellC.position.y = 2.0
    cb.add(shellC)
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.14, 10.02), std(C.parch, { roughness: 0.6 }))
    band.position.y = 1.35
    cb.add(band)
    for (let w = 0; w < 6; w++) {
      for (const sx of [1, -1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), glow(0xffd98a, 0.85))
        win.position.set(sx * 1.16, 2.25, -3.8 + w * 1.5)
        win.rotation.y = (sx * Math.PI) / 2
        cb.add(win)
      }
    }
    coachBodies.push(cb)
    bogie(g, cz - 3.5)
    bogie(g, cz + 3.5)
  }

  // brake sparks: a small particle pool that sprays from the shoes
  const nSparks = 60
  const sparkPos = new Float32Array(nSparks * 3)
  const sparkVel = new Float32Array(nSparks * 3)
  const sparkLife = new Float32Array(nSparks)
  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sparks.frustumCulled = false
  g.add(sparks)
  let nextSpark = 0

  let prevZ: number | null = null
  let speed = 0
  let prevSpeed = 0
  let decel = 0
  const noseOffset = -len / 2 - 0.9

  const loco: Loco = {
    group: g,
    noseOffset,
    facing,
    get speed() {
      return speed
    },
    moveTo(noseZ, dt, t) {
      g.position.z = noseZ + facing * noseOffset
      const z = g.position.z
      if (prevZ !== null && dt > 0) {
        const dz = z - prevZ
        // ignore the jump when a vignette loops back to its start
        const v = Math.abs(dz) > 6 ? 0 : Math.abs(dz) / dt
        speed += (v - speed) * Math.min(dt * 6, 1)
        if (Math.abs(dz) <= 6) for (const w of wheels) w.rotation.x += (facing * dz) / 0.42
      }
      prevZ = z
      const a = dt > 0 ? (speed - prevSpeed) / dt : 0
      prevSpeed = speed
      decel += (Math.max(-a, 0) - decel) * Math.min(dt * 4, 1)
      // sprung body: bob and roll grow with speed
      const s = Math.min(speed / 20, 1)
      body.position.y = Math.sin(t * 9.5) * 0.025 * s + Math.sin(t * 3.1) * 0.012 * s
      body.rotation.z = Math.sin(t * 2.3) * 0.008 * s
      coachBodies.forEach((cb, i) => {
        cb.position.y = Math.sin(t * 8.7 + i * 1.3) * 0.03 * s
        cb.rotation.z = Math.sin(t * 2.1 + i) * 0.012 * s
      })
      // pantograph arcing, more often at speed
      arc.visible = speed > 3 && Math.random() < 0.025 + 0.05 * s
      if (arc.visible) arc.scale.setScalar(0.8 + Math.random() * 1.6)
      // brakes: shoes heat up and spark under hard deceleration
      const heat = Math.min(Math.max((decel - 0.25) / 0.6, 0), 1) * (speed > 0.5 ? 1 : 0)
      for (const m of shoes) m.color.setRGB(0.16 + heat * 0.84, 0.1 + heat * 0.32, 0.06)
      if (heat > 0.2) {
        for (let k = 0; k < 3; k++) {
          const i = nextSpark++ % nSparks
          const w = wheels[(Math.random() * wheels.length) | 0]!
          sparkPos[i * 3] = w.position.x
          sparkPos[i * 3 + 1] = 0.35
          sparkPos[i * 3 + 2] = w.position.z
          sparkVel[i * 3] = (Math.random() - 0.5) * 2
          sparkVel[i * 3 + 1] = 1 + Math.random() * 2
          sparkVel[i * 3 + 2] = 2 + Math.random() * 3
          sparkLife[i] = 0.5
        }
      }
      for (let i = 0; i < nSparks; i++) {
        if (sparkLife[i]! <= 0) {
          sparkPos[i * 3 + 1] = -50
          continue
        }
        sparkLife[i] = sparkLife[i]! - dt
        sparkVel[i * 3 + 1] = sparkVel[i * 3 + 1]! - 9.8 * dt
        sparkPos[i * 3] = sparkPos[i * 3]! + sparkVel[i * 3]! * dt
        sparkPos[i * 3 + 1] = Math.max(sparkPos[i * 3 + 1]! + sparkVel[i * 3 + 1]! * dt, 0.3)
        sparkPos[i * 3 + 2] = sparkPos[i * 3 + 2]! + sparkVel[i * 3 + 2]! * dt
      }
      sparkGeo.attributes.position!.needsUpdate = true
    },
  }
  return loco
}

function beamBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat)
  m.position.copy(a).lerp(b, 0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

/** Overhead line: masts with cantilevers on the left of the track, contact + catenary wire. */
export function makeCatenary(from: number, to: number, spacing = 45) {
  const g = new THREE.Group()
  const mastMat = std(0x7c8070, { metalness: 0.5, roughness: 0.5 })
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x8c8a78 })
  for (let z = from; z > to; z -= spacing) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.4, 0.28), mastMat)
    mast.position.set(-3.4, 3.7, z)
    g.add(mast)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.1), mastMat)
    arm.position.set(-1.6, 6.5, z)
    g.add(arm)
    const brace = beamBetween(new THREE.Vector3(-3.3, 5.4, z), new THREE.Vector3(-0.4, 6.45, z), 0.04, mastMat)
    g.add(brace)
    const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 8), std(0x9b5a3c))
    insulator.rotation.z = Math.PI / 2
    insulator.position.set(-3.05, 6.5, z)
    g.add(insulator)
  }
  const len = from - to
  const contact = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), wireMat)
  contact.position.set(0, WIRE_Y + 0.02, (from + to) / 2)
  g.add(contact)
  const catenary = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), wireMat)
  catenary.position.set(0, 6.45, (from + to) / 2)
  g.add(catenary)
  return g
}

/** Dusk sky dome: deep olive overhead, warm amber at the horizon (no fog). */
export function makeSky() {
  const geo = new THREE.SphereGeometry(700, 32, 16)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x1f2d27) },
      mid: { value: new THREE.Color(0x4a5a3a) },
      horizon: { value: new THREE.Color(0xd9925a) },
      haze: { value: new THREE.Color(C.night) },
      below: { value: new THREE.Color(0x232b19) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 haze; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        // warmer toward the far end of the line (-z), where the sun has set
        float sunward = smoothstep(-0.2, -1.0, vDir.z);
        vec3 hz = mix(haze, horizon, sunward * 0.8);
        vec3 c = h > 0.0 ? mix(hz, mix(mid, top, smoothstep(0.1, 0.6, h)), smoothstep(0.02, 0.2, h)) : haze;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const m = new THREE.Mesh(geo, mat)
  m.renderOrder = -1
  return m
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
