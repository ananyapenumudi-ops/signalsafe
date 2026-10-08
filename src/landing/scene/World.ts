/**
 * The landing-page world: one long night railway with a vignette per chapter.
 * Scroll position sets a fractional chapter index; the camera eases along a
 * keyframed path between vignettes. Each vignette animates on its own clock.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { C, GAUGE, TRACK_END, TRACK_START, glow, haloTexture, label, makeCard, makeCatenary, makeLoco, makeOrnament, makeSignal, makeSky, makeStation, makeTag, makeTower, makeTrack, std } from './parts'

type Updater = (t: number, dt: number, focus: number) => void

/**
 * Camera keyframe per chapter: where the camera sits, what it should show
 * (the vignette's centre), and which side of the screen the text card covers.
 * The aim point is offset so the vignette lands in the free part of the screen.
 * Chapter i lives around z = -80·i.
 */
interface Key {
  pos: THREE.Vector3Tuple
  focus: THREE.Vector3Tuple
  card: 'left' | 'right' | 'none'
}
const KEYS: Key[] = [
  { pos: [5, 3.2, 32], focus: [0, 4.2, -16], card: 'left' }, // 0 hero
  { pos: [9, 13, -50], focus: [-8, 4, -86], card: 'right' }, // 1 kavach
  { pos: [-15, 13, -138], focus: [0, 1.5, -167], card: 'left' }, // 2 tags
  { pos: [15, 12, -206], focus: [-6, 7, -244], card: 'right' }, // 3 radio
  { pos: [-22, 14, -280], focus: [0, 2.5, -322], card: 'left' }, // 4 MA + curve
  { pos: [15, 10, -372], focus: [-4, 4, -404], card: 'right' }, // 5 faults
  { pos: [-6, 7, -456], focus: [3, 4.6, -485], card: 'left' }, // 6 evaluation
  { pos: [12, 11, -533], focus: [0, 4, -563], card: 'right' }, // 7 architecture
  { pos: [-3, 6, -608], focus: [1.8, 5.2, -634], card: 'left' }, // 8 determinism
  { pos: [0, 14, -650], focus: [0, 7, -724], card: 'none' }, // 9 CTA
]
export const CHAPTERS = KEYS.length

const smooth = (x: number) => x * x * (3 - 2 * x)

export class World {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 900)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly updaters: Updater[] = []
  private readonly clock = new THREE.Clock()
  private readonly camPos = new THREE.Vector3()
  private readonly camTarget = new THREE.Vector3()
  private readonly wantPos = new THREE.Vector3()
  private readonly wantTarget = new THREE.Vector3()
  private chapter = 0
  private raf = 0
  private time = 0
  private readonly reduced: boolean
  private pointer = { x: 0, y: 0 }
  /** Per-key aim points, recomputed on resize for the current aspect ratio. */
  private aims: THREE.Vector3[] = []

  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }) {
    this.canvas = canvas
    this.reduced = opts.reducedMotion
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.45
    this.scene.background = new THREE.Color(C.night)
    this.scene.fog = new THREE.FogExp2(C.night, 0.0085)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.78)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.buildWorld()
    this.place(0, true)
    this.resize()
  }

  // ── public API ────────────────────────────────────────────
  setChapter(f: number) {
    this.chapter = Math.min(Math.max(f, 0), CHAPTERS - 1)
    if (this.reduced) {
      this.place(this.chapter, true)
      this.render(0)
    }
  }

  setPointer(x: number, y: number) {
    this.pointer = { x, y }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.setSize(w / 2, h / 2)
    this.camera.aspect = w / h
    // keep vignettes framed on tall phones
    this.camera.fov = w / h < 0.8 ? 64 : 48
    this.camera.updateProjectionMatrix()
    this.computeAims()
    if (this.reduced) this.render(0)
  }

  start() {
    if (this.reduced) {
      this.render(0)
      return
    }
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      if (document.hidden) return
      const dt = Math.min(this.clock.getDelta(), 0.05)
      this.time += dt
      this.place(this.chapter, false, dt)
      this.render(dt)
    }
    loop()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => m.dispose())
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
  }

  // ── camera ────────────────────────────────────────────────
  /** Offset each aim point so the vignette sits beside (or, on phones, above) the card. */
  private computeAims() {
    const up = new THREE.Vector3(0, 1, 0)
    const aspect = this.camera.aspect
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2)
    const hHalf = Math.atan(Math.tan(vHalf) * aspect)
    this.aims = KEYS.map((key) => {
      const pos = new THREE.Vector3().fromArray(key.pos)
      const focus = new THREE.Vector3().fromArray(key.focus)
      const dist = pos.distanceTo(focus)
      if (key.card === 'none') return focus
      if (aspect < 0.8) return focus.clone().addScaledVector(up, -dist * Math.tan(vHalf) * 0.32) // card sits low: show the vignette high
      const dir = focus.clone().sub(pos).normalize()
      const right = dir.clone().cross(up).normalize()
      const sign = key.card === 'right' ? 1 : -1
      return focus.clone().addScaledVector(right, sign * dist * Math.tan(hHalf) * 0.4)
    })
  }

  private place(f: number, snap: boolean, dt = 0) {
    const i = Math.min(Math.floor(f), CHAPTERS - 2)
    const k = smooth(Math.min(Math.max(f - i, 0), 1))
    if (!this.aims.length) this.computeAims()
    this.wantPos.fromArray(KEYS[i]!.pos).lerp(new THREE.Vector3().fromArray(KEYS[i + 1]!.pos), k)
    this.wantTarget.copy(this.aims[i]!).lerp(this.aims[i + 1]!, k)
    // gentle parallax from the pointer
    this.wantPos.x += this.pointer.x * 0.8
    this.wantPos.y += -this.pointer.y * 0.5
    if (snap) {
      this.camPos.copy(this.wantPos)
      this.camTarget.copy(this.wantTarget)
    } else {
      const a = 1 - Math.exp(-dt * 3.2)
      this.camPos.lerp(this.wantPos, a)
      this.camTarget.lerp(this.wantTarget, a)
    }
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camTarget)
  }

  private render(dt: number) {
    for (const u of this.updaters) u(this.time, dt, this.chapter)
    this.composer.render()
  }

  // ── world ─────────────────────────────────────────────────
  private buildWorld() {
    const s = this.scene
    // dusk: bright sky fill, a low warm sun at the far end of the line, a cool fill from behind
    s.add(new THREE.HemisphereLight(0xdfe3c8, 0x3a3a22, 1.9))
    const sun = new THREE.DirectionalLight(0xffb878, 1.7)
    sun.position.set(20, 14, -120)
    s.add(sun)
    s.add(sun.target)
    sun.target.position.set(0, 0, 0)
    const fill = new THREE.DirectionalLight(0xc8d6ff, 0.8)
    fill.position.set(-30, 40, 60)
    s.add(fill)
    s.add(makeSky())

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), std(C.ground, { roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.z = -350
    s.add(ground)
    const grid = new THREE.GridHelper(1100, 275, 0x46553a, 0x354229)
    grid.position.set(0, 0.01, -350)
    s.add(grid)
    s.add(makeTrack())
    s.add(makeCatenary(TRACK_START, TRACK_END))

    this.stars()
    this.hero()
    this.kavach()
    this.tags()
    this.radio()
    this.authority()
    this.faults()
    this.evaluation()
    this.architecture()
    this.determinism()
    this.finale()
  }

  private stars() {
    const n = 1400
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 700
      pos[i * 3 + 1] = 40 + Math.random() * 160
      pos[i * 3 + 2] = 80 - Math.random() * 950
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: C.parch, size: 0.7, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.45 }))
    this.scene.add(pts)
    // drifting fireflies near the track
    const m = 260
    const fp = new Float32Array(m * 3)
    const seed = Array.from({ length: m }, () => Math.random() * Math.PI * 2)
    for (let i = 0; i < m; i++) {
      fp[i * 3] = (Math.random() - 0.5) * 60
      fp[i * 3 + 1] = 0.5 + Math.random() * 8
      fp[i * 3 + 2] = 40 - Math.random() * 760
    }
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3))
    const flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: C.brass, size: 0.16, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: haloTexture() }))
    this.scene.add(flies)
    const base = fp.slice()
    this.updaters.push((t) => {
      const a = fg.attributes.position!.array as Float32Array
      for (let i = 0; i < m; i++) {
        a[i * 3 + 1] = base[i * 3 + 1]! + Math.sin(t * 0.6 + seed[i]!) * 0.6
        a[i * 3] = base[i * 3]! + Math.cos(t * 0.4 + seed[i]!) * 0.4
      }
      fg.attributes.position!.needsUpdate = true
    })
  }

  /** 0 · Hero: a signal cycling aspects, a loco approaching out of the fog, the ornament. */
  private hero() {
    const sig = makeSignal(6)
    sig.group.position.set(3, 0, 6)
    this.scene.add(sig.group)
    const cycle = ['R', 'Y', 'YY', 'G'] as const
    this.updaters.push((t) => sig.setAspect(cycle[Math.floor(t / 1.6) % 4]!))

    const orn = makeOrnament(10)
    orn.group.position.set(-1.5, 7, -22)
    this.scene.add(orn.group)
    for (const sx of [-1, 1]) {
      const small = makeOrnament(3.2)
      small.group.position.set(-1.5 + sx * 16.5, 7, -22)
      this.scene.add(small.group)
      this.updaters.push((t) => (small.dots.rotation.z = -t * 0.3 * sx))
    }
    this.updaters.push((t) => (orn.dots.rotation.z = t * 0.12))

    const loco = makeLoco(2, 1) // facing the camera
    this.scene.add(loco.group)
    const beamCone = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 26, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: C.warm, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    )
    beamCone.rotation.x = -Math.PI / 2
    beamCone.position.set(0, 2.1, loco.noseOffset - 13)
    loco.group.add(beamCone)
    // approaches from z -150 to z -5 and slows to a stand before the signal, then repeats
    this.updaters.push((t, dt) => {
      const T = 16
      const k = (t % T) / T
      const e = 1 - Math.pow(1 - Math.min(k / 0.85, 1), 2.2)
      loco.moveTo(-160 + e * 120, dt, t)
      beamCone.material.opacity = 0.07 * (k < 0.9 ? 1 : (1 - k) * 10)
    })
  }

  /** 1 · Kavach in one breath: station (SVK), tower, loco (OVK), tags. */
  private kavach() {
    const z = -84
    const st = makeStation('SVK · STATION A')
    st.position.set(-10, 0, z)
    this.scene.add(st)
    const tower = makeTower(17)
    tower.group.position.set(-18, 0, z - 7)
    this.scene.add(tower.group)
    const loco = makeLoco(0)
    loco.group.position.set(0, 0, z + 2)
    this.scene.add(loco.group)
    const tagMeshes = [z - 9, z - 9.7, z - 15, z - 15.7].map((tz) => {
      const tg = makeTag()
      tg.mesh.position.z = tz
      this.scene.add(tg.mesh)
      return tg
    })
    const labels: [string, THREE.Vector3Tuple][] = [
      ['STATIONARY KAVACH', [-10, 7.6, z + 2.6]],
      ['UHF TOWER', [-18, 19.5, z - 7]],
      ['ONBOARD KAVACH', [0, 5.4, z - 2]],
      ['RFID TAG PAIRS', [0, 1.5, z - 12.5]],
    ]
    for (const [text, p] of labels) {
      const l = label(text, { size: 0.75, color: '#20251a', bg: 'rgba(239,231,205,0.92)' })
      l.position.fromArray(p)
      this.scene.add(l)
    }
    const link = this.dashedArc(tower.top.clone().add(tower.group.position), new THREE.Vector3(0.5, 4.3, z), C.rust)
    this.updaters.push((t) => {
      tower.lamp.visible = Math.sin(t * 4) > 0
      ;(link.material as THREE.LineDashedMaterial).dashSize = 0.6
      link.position.y = 0
      ;(link.material as THREE.LineDashedMaterial).opacity = 0.5 + 0.5 * Math.sin(t * 3)
      tagMeshes.forEach((tg, i) => tg.set(0.5 + 0.5 * Math.sin(t * 2.4 - i * 0.6)))
    })
  }

  /** 2 · Tags tell the train where it is: the belief bar grows, then snaps at each tag. */
  private tags() {
    const zs = [-152, -162, -172, -182]
    const tags = zs.flatMap((z) => [z, z - 0.7]).map((z) => {
      const tg = makeTag()
      tg.mesh.position.z = z
      this.scene.add(tg.mesh)
      return { ...tg, z, heat: 0 }
    })
    const loco = makeLoco(0)
    this.scene.add(loco.group)
    const belief = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1), glow(C.sage, 0.45))
    belief.position.y = 4.4
    this.scene.add(belief)
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), glow(C.parch))
    this.scene.add(tick)
    const l = label('OVK BELIEF  ±(5 m + 5%)', { size: 0.62, color: '#efe7cd', bg: 'rgba(51,64,31,0.9)' })
    this.scene.add(l)
    let lastTagZ = -138
    let prevNose = -138
    this.updaters.push((t, dt) => {
      const T = 9
      const k = (t % T) / T
      const nose = -138 - k * 54
      if (nose > prevNose) lastTagZ = -138 // wrapped
      prevNose = nose
      loco.moveTo(nose, dt, t)
      for (const tg of tags) {
        if (tg.z <= -138 && nose <= tg.z && nose > tg.z - 1.5) {
          tg.heat = 1
          lastTagZ = Math.min(lastTagZ, tg.z)
        }
        tg.heat = Math.max(tg.heat - dt * 1.2, 0)
        tg.set(0.15 + tg.heat)
      }
      const since = lastTagZ - nose
      const width = 0.6 + since * 0.22
      belief.scale.z = width
      belief.position.z = nose - 0.8
      tick.position.set(0, 4.4, nose - 0.8)
      l.position.set(0, 5.4, nose - 0.8)
    })
  }

  /** 3 · Every two seconds, a conversation: rings from the tower, packets both ways. */
  private radio() {
    const z = -244
    const tower = makeTower(18)
    tower.group.position.set(-13, 0, z - 3)
    this.scene.add(tower.group)
    const top = tower.top.clone().add(tower.group.position)
    const loco = makeLoco(0)
    loco.group.position.set(0, 0, z + 4)
    this.scene.add(loco.group)
    const roof = new THREE.Vector3(0.5, 4.3, z + 4 + loco.noseOffset + 2.5)
    const rings = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 96), glow(C.rust, 0.75))
      m.rotation.x = Math.PI / 2
      m.position.copy(top)
      this.scene.add(m)
      return m
    })
    const curve = new THREE.QuadraticBezierCurve3(top, top.clone().lerp(roof, 0.5).add(new THREE.Vector3(0, 7, 0)), roof)
    const path = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.03, 6), glow(C.brass, 0.4))
    this.scene.add(path)
    const pkt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), glow(C.rust))
    this.scene.add(pkt)
    const pktLabel = label('MA', { size: 0.6, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
    this.scene.add(pktLabel)
    const clockRing = label('EVERY 2 s', { size: 0.8, color: '#efe7cd', bg: 'rgba(196,85,43,0.95)' })
    clockRing.position.set(top.x, top.y + 2.4, top.z)
    this.scene.add(clockRing)
    this.updaters.push((t) => {
      tower.lamp.visible = Math.sin(t * 4) > 0
      rings.forEach((r, i) => {
        const k = ((t + (i * 2) / 3) % 2) / 2
        r.scale.setScalar(0.5 + k * 11)
        ;(r.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k)
      })
      // odd second: location report OVK → SVK; even: MA SVK → OVK
      const sec = Math.floor(t)
      const k = smooth(t - sec)
      const up = sec % 2 === 1
      const p = curve.getPoint(up ? 1 - k : k)
      pkt.position.copy(p)
      pkt.rotation.set(t * 2, t * 3, 0)
      ;(pkt.material as THREE.MeshBasicMaterial).color.setHex(up ? C.sage : C.rust)
      pktLabel.position.copy(p).add(new THREE.Vector3(0, 0.9, 0))
      const want = up ? 'LOCATION' : 'MA'
      if (pktLabel.userData.text !== want) {
        const tex = label(want, { size: 0.6, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
        pktLabel.material.map?.dispose()
        pktLabel.material.map = tex.material.map
        pktLabel.scale.copy(tex.scale)
        pktLabel.userData.text = want
      }
    })
  }

  /** 4 · Movement authority and the braking curve that guards it. */
  private authority() {
    const z0 = -300
    const eoa = -338
    const sig = makeSignal(5.5)
    sig.group.position.set(2.6, 0, eoa - 0.5)
    sig.setAspect('R')
    this.scene.add(sig.group)
    const loco = makeLoco(0)
    this.scene.add(loco.group)
    // permitted-speed curve: v ∝ √(distance to EOA), drawn as height above the track
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 60; i++) {
      const zz = z0 + ((eoa - z0) * i) / 60
      const d = (zz - eoa) / (z0 - eoa)
      pts.push(new THREE.Vector3(-2.2, 0.4 + 5 * Math.sqrt(Math.max(d, 0)), zz))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.09, 8), glow(C.rust))
    this.scene.add(ribbon)
    // curtain under the curve
    const curtainGeo = new THREE.BufferGeometry()
    const verts: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      verts.push(a.x, 0.35, a.z, a.x, a.y, a.z, b.x, b.y, b.z, a.x, 0.35, a.z, b.x, b.y, b.z, b.x, 0.35, b.z)
    }
    curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    const curtain = new THREE.Mesh(curtainGeo, new THREE.MeshBasicMaterial({ color: C.rust, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }))
    this.scene.add(curtain)
    const maLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 1), glow(C.rust))
    maLine.position.set(0, 0.45, 0)
    this.scene.add(maLine)
    const eoaPost = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), glow(C.red))
    eoaPost.position.set(0, 0.5, eoa)
    this.scene.add(eoaPost)
    const eoaLabel = label('EOA', { size: 0.8, color: '#fff', bg: 'rgba(200,55,45,0.95)' })
    eoaLabel.position.set(0, 1.6, eoa)
    this.scene.add(eoaLabel)
    const speedLabel = label('80 km/h', { size: 0.7, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
    this.scene.add(speedLabel)
    const curveLabel = label('PERMITTED SPEED', { size: 0.6, color: '#efe7cd', bg: 'rgba(196,85,43,0.9)' })
    curveLabel.position.set(-2.2, 6.4, z0 - 2)
    this.scene.add(curveLabel)
    let shown = ''
    this.updaters.push((t, dt) => {
      const T = 10
      const k = (t % T) / T
      // cruise, then a Kavach full-service brake application down the curve
      const travel = Math.min(k / 0.8, 1)
      const nose = z0 + (eoa + 4 - z0) * (1 - Math.pow(1 - travel, 2))
      loco.moveTo(nose, dt, t)
      const remaining = Math.max(nose - eoa, 0)
      maLine.scale.z = remaining
      maLine.position.z = nose - remaining / 2
      const v = Math.round(80 * Math.sqrt(Math.max(1 - travel, 0)))
      speedLabel.position.set(0, 5.6, nose)
      const txt = v === 0 ? 'STOPPED' : `${v} km/h`
      if (txt !== shown) {
        shown = txt
        const fresh = label(txt, { size: 0.7, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
        speedLabel.material.map?.dispose()
        speedLabel.material.map = fresh.material.map
        speedLabel.scale.copy(fresh.scale)
      }
      eoaPost.visible = Math.sin(t * 6) > -0.3
    })
  }

  /** 5 · Break it on purpose: a shattering radio ring, a dead tag, a chattering signal. */
  private faults() {
    const z = -404
    const tower = makeTower(14)
    tower.group.position.set(-11, 0, z - 6)
    this.scene.add(tower.group)
    const top = tower.top.clone().add(tower.group.position)
    const shards = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2
      const m = new THREE.Mesh(new THREE.TorusGeometry(3, 0.07, 6, 12, (Math.PI * 2) / 16), glow(C.red))
      m.rotation.set(Math.PI / 2, 0, a)
      m.position.copy(top)
      this.scene.add(m)
      return { m, a }
    })
    const sig = makeSignal(5)
    sig.group.position.set(2.6, 0, z + 2)
    this.scene.add(sig.group)
    const dead = makeTag()
    dead.mesh.position.z = z - 2
    this.scene.add(dead.mesh)
    const x = label('✕ TAG WITHHELD', { size: 0.6, color: '#fff', bg: 'rgba(200,55,45,0.95)' })
    x.position.set(0, 1.4, z - 2)
    this.scene.add(x)
    const f1 = label('RADIO LOSS', { size: 0.7, color: '#fff', bg: 'rgba(200,55,45,0.95)' })
    f1.position.set(top.x, top.y + 2.2, top.z)
    this.scene.add(f1)
    const f2 = label('SIGNAL FLICKER', { size: 0.7, color: '#fff', bg: 'rgba(200,55,45,0.95)' })
    f2.position.set(2.6, 8.6, z + 2)
    this.scene.add(f2)
    const loco = makeLoco(0)
    loco.group.position.set(0, 0, z + 8)
    this.scene.add(loco.group)
    // glitch particles
    const n = 160
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -6 + Math.random() * 12
      pos[i * 3 + 1] = Math.random() * 9
      pos[i * 3 + 2] = z - 8 + Math.random() * 16
    }
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: C.red, size: 0.12, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.scene.add(sparks)
    this.updaters.push((t) => {
      const k = (t % 3) / 3
      shards.forEach(({ m, a }) => {
        const r = k < 0.35 ? 0 : (k - 0.35) * 9
        m.position.set(top.x + Math.cos(a) * r, top.y - r * 0.3, top.z + Math.sin(a) * r)
        m.scale.setScalar(0.4 + k * 1.6)
        ;(m.material as THREE.MeshBasicMaterial).opacity = 1 - k
        ;(m.material as THREE.MeshBasicMaterial).transparent = true
      })
      sig.setAspect(Math.floor(t * 5) % 3 === 0 ? 'R' : 'G')
      dead.set(Math.random() < 0.08 ? 0.6 : 0)
      x.visible = Math.sin(t * 5) > -0.6
      sparks.rotation.y = Math.sin(t * 11) * 0.01
      sparks.position.x = Math.random() < 0.1 ? (Math.random() - 0.5) * 0.4 : 0
    })
  }

  /** 6 · Judged clause by clause: report cards and a causal chain. */
  private evaluation() {
    const z = -486
    const cards = [
      makeCard('S05 · RADIO GOES SILENT', [
        { ok: true, text: 'Aspect blank at 6.0 s', ref: '20.1.2' },
        { ok: true, text: 'FS retained after blank', ref: '20.1.2' },
        { ok: true, text: 'Radio failure at 30.0 s', ref: '20.1.1' },
        { ok: false, text: 'FSB at 21.4 s (want 15)', ref: '20.1.3' },
      ]),
      makeCard('S01 · STOP SHORT OF A RED', [
        { ok: true, text: 'Stopped 3.8 m before S1', ref: '3.5.7.1' },
        { ok: true, text: '≤ 5 m in 94% of runs', ref: '3.5.7.1' },
      ]),
      makeCard('S10 · SIGNAL FLICKER', [
        { ok: true, text: 'MA held while unstable', ref: '18.8' },
        { ok: true, text: 'Never longer than ON state', ref: '12.1' },
      ]),
    ]
    cards.forEach((c, i) => {
      c.position.set(3 + (i - 1) * 6.6, 5 + (i === 1 ? 0.9 : 0), z - Math.abs(i - 1) * 1.6)
      c.rotation.y = (1 - i) * 0.32
      this.scene.add(c)
    })
    // causal chain
    const nodes = [
      ['FAULT', C.red],
      ['6 s SILENT', C.brass],
      ['RADIO FAIL', C.brass],
      ['ACK?', C.brass],
      ['FSB', C.rust],
    ] as const
    const chain = new THREE.Group()
    const nodePos = nodes.map((_, i) => new THREE.Vector3(-6 + i * 3.2, 1.2 + Math.sin(i) * 0.3, 0))
    nodes.forEach(([text, col], i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 14), glow(col))
      ball.position.copy(nodePos[i]!)
      chain.add(ball)
      const l = label(text, { size: 0.5, color: '#efe7cd', bg: 'rgba(32,37,26,0.9)' })
      l.position.copy(nodePos[i]!).add(new THREE.Vector3(0, 0.85, 0))
      chain.add(l)
    })
    const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(nodePos), 80, 0.035, 6), glow(C.brass, 0.6))
    chain.add(line)
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), glow(C.warm))
    chain.add(pulse)
    chain.position.set(3, 0.6, z + 4)
    this.scene.add(chain)
    const chainCurve = new THREE.CatmullRomCurve3(nodePos)
    this.updaters.push((t) => {
      cards.forEach((c, i) => (c.position.y = 5 + (i === 1 ? 0.9 : 0) + Math.sin(t * 0.9 + i) * 0.18))
      pulse.position.copy(chainCurve.getPoint((t * 0.35) % 1))
    })
  }

  /** 7 · Built like the RDSO bench: four exploding layers. */
  private architecture() {
    const z = -563
    const layers = [
      ['BENCH · TSE · TBC · DIS · TET', C.parch, ['TSE', 'TBC', 'DIS', 'SMOCIP-S', 'TET']],
      ['SIMULATION · YARD · SS · RFID-S · RMS', C.sage, ['YARD', 'SS', 'RFID-S', 'RMS', 'BIU-S', 'TSL']],
      ['ADAPTERS · THE GENERIC CONTRACT', C.sand, ['GPS-A', 'DMI-A', 'BIU-A', 'ODO-A', 'RCU-A', 'EVL-A']],
      ['EQUIPMENT UNDER TEST · REF-OVK · REF-SVK', C.olive3, ['REF-OVK', 'REF-SVK', 'SVK×n']],
    ] as const
    const group = new THREE.Group()
    group.position.set(0, 0, z)
    this.scene.add(group)
    const slabs = layers.map(([name, col, mods], i) => {
      const g = new THREE.Group()
      const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.22, 6), std(col, { roughness: 0.6, transparent: true, opacity: 0.92 }))
      g.add(slab)
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: C.brass }))
      g.add(edge)
      mods.forEach((m, j) => {
        const chip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 0.9), std(i === 3 ? C.rust : C.olive, { roughness: 0.4 }))
        chip.position.set(-4 + (j % 6) * 1.6, 0.3, -1.2 + Math.floor(j / 6) * 1.2)
        g.add(chip)
        const l = label(m, { size: 0.42, color: '#efe7cd' })
        l.position.set(chip.position.x, 0.75, chip.position.z)
        g.add(l)
      })
      const l = label(name, { size: 0.62, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
      l.position.set(0, 0.7, 2.8)
      g.add(l)
      group.add(g)
      return g
    })
    // message beams between layers
    const beams = Array.from({ length: 6 }, (_, i) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), glow(i % 2 ? C.rust : C.brass, 0.85))
      group.add(b)
      return { b, x: -3.5 + i * 1.4, phase: i * 0.37 }
    })
    this.updaters.push((t, _dt, focus) => {
      const near = Math.max(0, 1 - Math.abs(focus - 7))
      const gap = 1.3 + near * 1.0 + Math.sin(t * 0.8) * 0.25
      slabs.forEach((g, i) => {
        g.position.y = 7.5 - i * gap
        g.rotation.y = Math.sin(t * 0.25) * 0.08
      })
      beams.forEach(({ b, x, phase }) => {
        const k = (t * 0.6 + phase) % 1
        const yTop = 7.5
        const yBot = 7.5 - 3 * gap
        b.position.set(x, yTop - (yTop - yBot) * k, 0.4)
        b.scale.y = 0.9
      })
    })
  }

  /** 8 · Deterministic to the byte: 20 ticks make a 2 s frame. */
  private determinism() {
    const z = -634
    const g = new THREE.Group()
    g.position.set(1.8, 5.2, z)
    this.scene.add(g)
    const ticks = Array.from({ length: 20 }, (_, i) => {
      const a = Math.PI / 2 - (i / 20) * Math.PI * 2
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.22), glow(C.olive3))
      m.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0)
      m.rotation.z = a
      g.add(m)
      return m
    })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.04, 8, 160), glow(C.brass, 0.8))
    g.add(ring)
    const pulse = new THREE.Mesh(new THREE.TorusGeometry(5, 0.08, 8, 160), glow(C.rust, 0.9))
    g.add(pulse)
    const centre = label('100 ms × 20 = 2 s', { size: 0.85, color: '#efe7cd', bg: 'rgba(51,64,31,0.95)' })
    g.add(centre)
    const seed = label('SEED 7731 → SAME LOG, EVERY RUN', { size: 0.5, color: '#20251a', bg: 'rgba(239,231,205,0.95)' })
    seed.position.set(0, -1.3, 0)
    g.add(seed)
    this.updaters.push((t) => {
      const k = (t % 2) / 2
      const lit = Math.floor(k * 20)
      ticks.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.setHex(i <= lit ? (i === lit ? C.warm : C.brass) : C.olive3))
      pulse.scale.setScalar(1 + k * 0.35)
      ;(pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
      g.rotation.y = Math.sin(t * 0.3) * 0.25
    })
  }

  /** 9 · Finale: buffer stop and the big ring. */
  private finale() {
    const z = -712
    const stop = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(GAUGE + 1.2, 1.2, 0.6), std(C.rust))
    frame.position.y = 1
    stop.add(frame)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), glow(C.red))
    lamp.position.set(0, 2, 0)
    stop.add(lamp)
    stop.position.set(0, 0, z + 4)
    this.scene.add(stop)
    const orn = makeOrnament(14)
    orn.group.position.set(0, 9, z - 12)
    this.scene.add(orn.group)
    const inner = makeOrnament(10)
    inner.group.position.set(0, 9, z - 12)
    this.scene.add(inner.group)
    this.updaters.push((t) => {
      orn.dots.rotation.z = t * 0.15
      inner.dots.rotation.z = -t * 0.22
      lamp.visible = Math.sin(t * 3) > 0
    })
  }

  private dashedArc(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 5, 0))
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(60))
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, transparent: true }))
    line.computeLineDistances()
    this.scene.add(line)
    return line
  }
}
