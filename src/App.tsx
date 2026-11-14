import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'motion/react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  baseSize: number
  hue: number
  saturation: number
  brightness: number
  age: number
  maxAge: number
  type: 'core' | 'drift' | 'pulse' | 'dream'
  angle: number
  angularVel: number
  orbitRadius: number
  orbitSpeed: number
  orbitCenterX: number
  orbitCenterY: number
  energy: number
  memory: number
}

interface AudioState {
  context: AudioContext | null
  masterGain: GainNode | null
  oscillators: Map<number, OscillatorNode>
  gainNodes: Map<number, GainNode>
  filters: Map<number, BiquadFilterNode>
  reverb: ConvolverNode | null
  reverbGain: GainNode | null
  lastNoteTime: number
  currentChord: number[]
}

const COLORS = {
  core: { h: 165, s: 100, b: 85 },      // cyan-teal
  drift: { h: 185, s: 80, b: 70 },      // softer cyan
  pulse: { h: 25, s: 95, b: 75 },       // warm orange
  dream: { h: 280, s: 60, b: 60 },      // purple dream
}

const CHORDS = [
  [261.63, 329.63, 392.00, 523.25], // C major
  [293.66, 369.99, 440.00, 587.33], // D major
  [329.63, 415.30, 493.88, 659.25], // E major
  [349.23, 440.00, 523.25, 698.46], // F major
  [392.00, 493.88, 587.33, 783.99], // G major
  [440.00, 554.37, 659.25, 880.00], // A major
]

function createReverbBuffer(context: AudioContext, duration = 3, decay = 2): AudioBuffer {
  // defaults handled
  const sampleRate = context.sampleRate
  const length = sampleRate * duration
  const buffer = context.createBuffer(2, length, sampleRate)
  
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, decay)
    }
  }
  return buffer
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k), -1)
  }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | undefined>(undefined)
  const audioRef = useRef<AudioState>({
    context: null,
    masterGain: null,
    oscillators: new Map<number, OscillatorNode>(),
    gainNodes: new Map<number, GainNode>(),
    filters: new Map<number, BiquadFilterNode>(),
    reverb: null,
    reverbGain: null,
    lastNoteTime: 0,
    currentChord: CHORDS[0],
  })
  
  const particlesRef = useRef<Particle[]>([])
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [interactionCount, setInteractionCount] = useState(0)
  const [showHint, setShowHint] = useState(true)
  const [hintText, setHintText] = useState('touch the organism')
  const [isDreaming, setIsDreaming] = useState(false)
  const [dreamIntensity, setDreamIntensity] = useState(0)
  const lastInteractionRef = useRef<number>(Date.now())
  const dreamTimeoutRef = useRef<number>(0)
  const reducedMotion = useRef(false)
  const chordIndexRef = useRef(0)
  const mouseRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, down: false })
  const prevMouseRef = useRef({ x: 0, y: 0 })
  
  // Initialize audio context
  const initAudio = useCallback(async () => {
    const state = audioRef.current
    if (state.context) return
    
    try {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioContextConstructor()
      state.context = ctx
      
      const masterGain = ctx.createGain()
      masterGain.gain.value = 0.3
      masterGain.connect(ctx.destination)
      state.masterGain = masterGain
      
      // Create reverb
      const reverb = ctx.createConvolver()
      reverb.buffer = createReverbBuffer(ctx)
      const reverbGain = ctx.createGain()
      reverbGain.gain.value = 0.15
      reverb.connect(reverbGain)
      reverbGain.connect(masterGain)
      state.reverb = reverb
      state.reverbGain = reverbGain
      
      // Resume if suspended
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
    } catch (e) {
      console.warn('Web Audio not available:', e)
    }
  }, [])
  
  // Play a note
  const playNote = useCallback((freq: number, type: 'sine' | 'triangle' = 'sine', duration = 0.8, delay = 0) => {
    const state = audioRef.current
    if (!state.context || !state.masterGain) return
    
    const now = state.context.currentTime + delay
    const osc = state.context.createOscillator()
    const gain = state.context.createGain()
    const filter = state.context.createBiquadFilter()
    
    osc.type = type
    osc.frequency.value = freq
    filter.type = 'lowpass'
    filter.frequency.value = 2000
    filter.Q.value = 1
    
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(state.masterGain)
    if (state.reverb) filter.connect(state.reverb)
    
    osc.start(now)
    osc.stop(now + duration + 0.1)
    
    const id = Date.now() + Math.random()
    state.oscillators.set(id, osc)
    state.gainNodes.set(id, gain)
    state.filters.set(id, filter)
    
    setTimeout(() => {
      state.oscillators.delete(id)
      state.gainNodes.delete(id)
      state.filters.delete(id)
    }, (duration + 0.2) * 1000)
  }, [])
  
  // Play chord on significant interaction
  const playChord = useCallback((intensity: number) => {
    const state = audioRef.current
    if (!state.context) return
    
    const chord = CHORDS[chordIndexRef.current % CHORDS.length]
    chordIndexRef.current++
    state.currentChord = chord
    
    chord.forEach((freq, i) => {
      const delay = i * 0.08
      const dur = 1.2 + intensity * 0.8
      playNote(freq * (0.98 + Math.random() * 0.04), 'triangle', dur, delay)
    })
    
    // Bass note
    setTimeout(() => playNote(chord[0] * 0.5, 'sine', 2, 0), 50)
  }, [playNote])
  
  // Initialize particles
  const initParticles = useCallback((w: number, h: number) => {
    const centerX = w / 2
    const centerY = h / 2
    const maxDim = Math.max(w, h)
    const count = Math.min(3000, Math.floor(maxDim * 2.5))
    
    const particles: Particle[] = []
    
    for (let i = 0; i < count; i++) {
      const typeRoll = Math.random()
      let type: Particle['type']
      let orbitRadius = 0
      let orbitSpeed = 0
      
      if (typeRoll < 0.35) {
        type = 'core'
        orbitRadius = 20 + Math.random() * 120
        orbitSpeed = (0.0005 + Math.random() * 0.002) * (Math.random() > 0.5 ? 1 : -1)
      } else if (typeRoll < 0.6) {
        type = 'drift'
        orbitRadius = 100 + Math.random() * 250
        orbitSpeed = (0.0002 + Math.random() * 0.001) * (Math.random() > 0.5 ? 1 : -1)
      } else if (typeRoll < 0.85) {
        type = 'pulse'
        orbitRadius = 150 + Math.random() * 300
        orbitSpeed = (0.0003 + Math.random() * 0.0015) * (Math.random() > 0.5 ? 1 : -1)
      } else {
        type = 'dream'
        orbitRadius = 200 + Math.random() * 400
        orbitSpeed = (0.0001 + Math.random() * 0.0005) * (Math.random() > 0.5 ? 1 : -1)
      }
      
      const angle = Math.random() * Math.PI * 2
      const baseSize = type === 'core' ? 2 + Math.random() * 3 : 
                       type === 'drift' ? 1 + Math.random() * 2 :
                       type === 'pulse' ? 1.5 + Math.random() * 2.5 : 0.5 + Math.random() * 1.5
      
      particles.push({
        x: centerX + Math.cos(angle) * orbitRadius,
        y: centerY + Math.sin(angle) * orbitRadius,
        vx: 0,
        vy: 0,
        size: baseSize,
        baseSize,
        hue: COLORS[type].h,
        saturation: COLORS[type].s,
        brightness: COLORS[type].b,
        age: 0,
        maxAge: 10000 + Math.random() * 20000,
        type,
        angle,
        angularVel: orbitSpeed,
        orbitRadius,
        orbitSpeed,
        orbitCenterX: centerX,
        orbitCenterY: centerY,
        energy: 0,
        memory: 0,
      })
    }
    
    particlesRef.current = particles
  }, [])
  
  // Update particles
  const updateParticles = useCallback((dt: number, w: number, h: number) => {
    const particles = particlesRef.current
    const centerX = w / 2
    const centerY = h / 2
    const mx = mouseRef.current.x
    const my = mouseRef.current.y
    const mvx = mouseRef.current.vx
    const mvy = mouseRef.current.vy
    const isDown = mouseRef.current.down
    const dreamFactor = isDreaming ? dreamIntensity : 0
    const time = Date.now() * 0.001
    
    // Update orbit centers with subtle breathing
    const breathX = centerX + Math.sin(time * 0.3) * 15 * (1 + dreamFactor)
    const breathY = centerY + Math.cos(time * 0.25) * 10 * (1 + dreamFactor)
    
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.age++
      
      // Dream state: particles wander and create new patterns
      if (dreamFactor > 0) {
        const dreamNoise = Math.sin(p.age * 0.001 + p.orbitRadius * 0.01) * 0.5 + 
                          Math.cos(p.age * 0.0007 + p.orbitRadius * 0.015) * 0.5
        p.orbitCenterX = breathX + dreamNoise * 100 * dreamFactor
        p.orbitCenterY = breathY + dreamNoise * 80 * dreamFactor
        p.orbitRadius += (200 + Math.sin(p.age * 0.002) * 150 - p.orbitRadius) * 0.001 * dreamFactor
        p.orbitSpeed *= 0.9995
      } else {
        p.orbitCenterX += (breathX - p.orbitCenterX) * 0.002
        p.orbitCenterY += (breathY - p.orbitCenterY) * 0.002
      }
      
      // Orbital motion
      p.angle += p.orbitSpeed * dt * 60
      const targetX = p.orbitCenterX + Math.cos(p.angle) * p.orbitRadius
      const targetY = p.orbitCenterY + Math.sin(p.angle) * p.orbitRadius
      
      // Spring to orbit position
      const k = 0.02 + (p.type === 'core' ? 0.03 : 0)
      p.vx += (targetX - p.x) * k
      p.vy += (targetY - p.y) * k
      
      // Mouse interaction
      if (!reducedMotion.current) {
        const dx = mx - p.x
        const dy = my - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = 200 + p.orbitRadius * 0.5
        
        if (dist < maxDist && dist > 1) {
          const force = (1 - dist / maxDist) * (isDown ? 0.8 : 0.3)
          const fx = (dx / dist) * force * (p.type === 'core' ? 1.5 : 1)
          const fy = (dy / dist) * force * (p.type === 'core' ? 1.5 : 1)
          
          p.vx -= fx
          p.vy -= fy
          
          // Transfer mouse velocity
          p.vx += mvx * 0.3 * (1 - dist / maxDist)
          p.vy += mvy * 0.3 * (1 - dist / maxDist)
          
          // Energy buildup
          p.energy = Math.min(1, p.energy + 0.02)
          p.memory = Math.min(1, p.memory + 0.005)
          
          // Color shift on interaction
          if (p.type === 'core' || p.type === 'pulse') {
            p.hue = 25 + p.energy * 40
            p.saturation = 95
            p.brightness = 75 + p.energy * 25
          }
        } else {
          // Decay energy
          p.energy *= 0.995
          // Return to base color
          const base = COLORS[p.type]
          p.hue += (base.h - p.hue) * 0.01
          p.saturation += (base.s - p.saturation) * 0.01
          p.brightness += (base.b - p.brightness) * 0.01
        }
      }
      
      // Velocity damping
      p.vx *= 0.92
      p.vy *= 0.92
      
      // Update position
      p.x += p.vx * dt * 60
      p.y += p.vy * dt * 60
      
      // Boundary wrap with soft edges
      const margin = 100
      if (p.x < -margin) p.x = w + margin
      if (p.x > w + margin) p.x = -margin
      if (p.y < -margin) p.y = h + margin
      if (p.y > h + margin) p.y = -margin
      
      // Size breathing
      const breathe = Math.sin(time * 2 + p.age * 0.01) * 0.15 + 1
      p.size = p.baseSize * breathe * (1 + p.energy * 0.5)
      
      // Dream particles: occasional burst
      if (dreamFactor > 0.5 && p.type === 'dream' && Math.random() < 0.0002 * dreamFactor) {
        p.vx += (Math.random() - 0.5) * 20
        p.vy += (Math.random() - 0.5) * 20
        p.hue = 280 + Math.random() * 60
        p.saturation = 70
        p.brightness = 80
      }
    }
  }, [isDreaming, dreamIntensity])
  
  // Render particles
  const renderParticles = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const particles = particlesRef.current
    const time = Date.now() * 0.001 // used for glow pulse
    
    // Clear with trail effect
    ctx.fillStyle = 'rgba(10, 10, 15, 0.15)'
    ctx.fillRect(0, 0, w, h)
    
    // Sort by type for layering
    const order = ['dream', 'drift', 'pulse', 'core']
    const sorted = [...particles].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    
    for (const p of sorted) {
      const alpha = p.type === 'dream' ? 0.3 : p.type === 'drift' ? 0.5 : 0.8
      const finalAlpha = alpha * (0.5 + p.energy * 0.5)
      
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2)
      
      const [r, g, b] = hslToRgb(p.hue, p.saturation, p.brightness)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha})`
      ctx.fill()
      
      // Core particles get a glow
      if (p.type === 'core' && p.energy > 0.3) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
        const glowAlpha = p.energy * 0.1 * (0.8 + Math.sin(time * 3) * 0.2)
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${glowAlpha})`
        ctx.fill()
      }
    }
    
    // Connection lines for core particles (subtle web)
    if (!reducedMotion.current) {
      const cores = particles.filter(p => p.type === 'core')
      ctx.strokeStyle = 'rgba(0, 255, 200, 0.03)'
      ctx.lineWidth = 0.5
      
      for (let i = 0; i < cores.length; i += 3) {
        for (let j = i + 1; j < cores.length; j += 3) {
          const dx = cores[i].x - cores[j].x
          const dy = cores[i].y - cores[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(cores[i].x, cores[i].y)
            ctx.lineTo(cores[j].x, cores[j].y)
            ctx.stroke()
          }
        }
      }
    }
  }, [])
  
  // Animation loop
  const animate = useCallback((_timestamp: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const w = canvas.width
    const h = canvas.height
    const dt = 1 / 60
    
    updateParticles(dt, w, h)
    renderParticles(ctx, w, h)
    
    animationRef.current = requestAnimationFrame(animate)
  }, [updateParticles, renderParticles])
  
  // Handle resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)
    
    setWidth(w)
    setHeight(h)
    initParticles(w, h)
  }, [initParticles])
  
  // Mouse/touch handlers
  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    const now = Date.now()
    const dt = (now - lastInteractionRef.current) / 1000
    lastInteractionRef.current = now
    
    prevMouseRef.current.x = mouseRef.current.x
    prevMouseRef.current.y = mouseRef.current.y
    mouseRef.current.x = clientX
    mouseRef.current.y = clientY
    
    if (dt > 0 && dt < 0.1) {
      mouseRef.current.vx = (clientX - prevMouseRef.current.x) / dt * 0.01
      mouseRef.current.vy = (clientY - prevMouseRef.current.y) / dt * 0.01
    }
    
    // Cancel dream mode
    if (isDreaming) {
      setIsDreaming(false)
      setDreamIntensity(0)
    }
    
    if (dreamTimeoutRef.current) {
      clearTimeout(dreamTimeoutRef.current)
    }
    
    dreamTimeoutRef.current = window.setTimeout(() => {
      setIsDreaming(true)
      setDreamIntensity(0)
      // Animate dream intensity
      const start = Date.now()
      const animateDream = () => {
        const elapsed = (Date.now() - start) / 1000
        setDreamIntensity(Math.min(1, elapsed / 8))
        if (isDreaming && elapsed < 8) {
          requestAnimationFrame(animateDream)
        }
      }
      animateDream()
    }, 10000)
  }, [isDreaming])
  
  const handlePointerDown = useCallback((clientX: number, clientY: number) => {
    mouseRef.current.down = true
    handlePointerMove(clientX, clientY)
    
    // Haptic feedback via audio
    initAudio()
    playNote(200 + Math.random() * 400, 'sine', 0.3)
    
    setInteractionCount(c => c + 1)
    if (interactionCount === 0) {
      setHintText('drag to pull it closer')
    } else if (interactionCount === 2) {
      setHintText('hold to hear it sing')
    } else if (interactionCount === 5) {
      setHintText('leave it alone... it dreams')
    }
  }, [initAudio, playNote, interactionCount, handlePointerMove])
  
  const handlePointerUp = useCallback(() => {
    mouseRef.current.down = false
    mouseRef.current.vx = 0
    mouseRef.current.vy = 0
    
    // Play chord on release after sustained interaction
    if (interactionCount > 3) {
      playChord(0.5)
    }
  }, [interactionCount, playChord])
  
  // Canvas handlers (React events)
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePointerMove(e.clientX, e.clientY)
  }, [handlePointerMove])
  
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    handlePointerDown(e.clientX, e.clientY)
  }, [handlePointerDown])
  
  const onMouseUp = useCallback(() => {
    handlePointerUp()
  }, [handlePointerUp])
  
  const onTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const touch = e.touches[0]
    handlePointerMove(touch.clientX, touch.clientY)
  }, [handlePointerMove])
  
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const touch = e.touches[0]
    handlePointerDown(touch.clientX, touch.clientY)
  }, [handlePointerDown])
  
  const onTouchEnd = useCallback(() => {
    handlePointerUp()
  }, [handlePointerUp])
  
  // Window handlers (native events)
  const onWindowMouseMove = useCallback((e: MouseEvent) => {
    handlePointerMove(e.clientX, e.clientY)
  }, [handlePointerMove])
  
  const onWindowMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault()
    handlePointerDown(e.clientX, e.clientY)
  }, [handlePointerDown])
  
  const onWindowMouseUp = useCallback(() => {
    handlePointerUp()
  }, [handlePointerUp])
  
  const onWindowTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    handlePointerMove(touch.clientX, touch.clientY)
  }, [handlePointerMove])
  
  const onWindowTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    handlePointerDown(touch.clientX, touch.clientY)
  }, [handlePointerDown])
  
  const onWindowTouchEnd = useCallback(() => {
    handlePointerUp()
  }, [handlePointerUp])
  
  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault()
        initAudio()
        const centerX = width / 2
        const centerY = height / 2
        const offset = 100
        let x = centerX, y = centerY
        
        switch (e.key) {
          case 'ArrowUp': y = centerY - offset; break
          case 'ArrowDown': y = centerY + offset; break
          case 'ArrowLeft': x = centerX - offset; break
          case 'ArrowRight': x = centerX + offset; break
          case ' ':
          case 'Enter':
            x = centerX + (Math.random() - 0.5) * 200
            y = centerY + (Math.random() - 0.5) * 200
            playChord(0.7)
            break
        }
        handlePointerDown(x, y)
        setTimeout(handlePointerUp, 150)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [width, height, initAudio, playChord, handlePointerDown, handlePointerUp])
  
  // Check reduced motion
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.current = mediaQuery.matches
    
    const handleChange = (e: MediaQueryListEvent) => {
      reducedMotion.current = e.matches
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])
  
  // Hide hint after delay
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 8000)
    return () => clearTimeout(timer)
  }, [])
  
  // Cleanup
  useEffect(() => {
    const audioState = audioRef.current
    handleResize()
    animationRef.current = requestAnimationFrame(animate)
    
    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mousedown', onWindowMouseDown)
    window.addEventListener('mouseup', onWindowMouseUp)
    window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
    window.addEventListener('touchstart', onWindowTouchStart, { passive: false })
    window.addEventListener('touchend', onWindowTouchEnd)
    
    // Initialize dream timer
    dreamTimeoutRef.current = window.setTimeout(() => {
      setIsDreaming(true)
      setDreamIntensity(0)
      const start = Date.now()
      const animateDream = () => {
        const elapsed = (Date.now() - start) / 1000
        setDreamIntensity(Math.min(1, elapsed / 8))
        if (isDreaming && elapsed < 8) {
          requestAnimationFrame(animateDream)
        }
      }
      animateDream()
    }, 10000)
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mousedown', onWindowMouseDown)
      window.removeEventListener('mouseup', onWindowMouseUp)
      window.removeEventListener('touchmove', onWindowTouchMove)
      window.removeEventListener('touchstart', onWindowTouchStart)
      window.removeEventListener('touchend', onWindowTouchEnd)
      if (dreamTimeoutRef.current) clearTimeout(dreamTimeoutRef.current)
      
      // Cleanup audio
      const state = audioState
      if (state?.context) {
        state.oscillators.forEach(osc => {
          try { osc.stop() } catch { /* ignore */ }
        })
        state.context.close()
      }
    }
  }, [animate, handleResize, onWindowMouseMove, onWindowMouseDown, onWindowMouseUp, onWindowTouchMove, onWindowTouchStart, onWindowTouchEnd, isDreaming])
  
  return (
    <>
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-label="Interactive living organism - touch or click to interact"
        role="img"
      />
      
      <motion.div
        className="hidden-delight flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: showHint ? 1 : 0 }}
        transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ pointerEvents: 'none' }}
      >
        <motion.p
          className="hint-text text-center px-6"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {hintText}
        </motion.p>
      </motion.div>
      
      {/* Breath indicator - subtle UI element */}
      <motion.div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 breath-indicator"
        style={{ pointerEvents: 'none', zIndex: 5 }}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)', opacity: 0.6 }} />
        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)', opacity: 0.3 }} />
      </motion.div>
      
      {/* Hidden delight: credits/easter egg on long press */}
      <motion.div
        className="fixed bottom-4 right-4 text-xs opacity-0 pointer-events-none"
        style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-fg)' }}
        animate={{ opacity: interactionCount > 20 ? 0.3 : 0 }}
        transition={{ duration: 2 }}
      >
        made with curiosity · no tracking · no data leaves your browser
      </motion.div>
    </>
  )
}