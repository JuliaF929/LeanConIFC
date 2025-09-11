import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as THREE from 'three'

// ----------------- Types from backend -----------------
type ElementRec = {
  x: number | null
  y: number | null
  z_relative_to_level: number | null
  real_world_z: number | null
  level_name: string | null
  level_elevation: number
  type: string
  unit: string | null
}

type BackendResponse = {
  elements: ElementRec[]
  summary?: { type: string; unit: string | null; count: number }[]
}

// ----------------- Fetch -----------------
async function fetchElements(): Promise<BackendResponse> {
  const res = await fetch('http://localhost:8000/api/elements')
  if (!res.ok) throw new Error(`Failed to load elements: ${res.status}`)
  return res.json()
}

// ----------------- Helpers -----------------
function unitToMeters(unit: string | null): number {
  if (!unit) return 1
  const u = unit.toLowerCase()
  if (u.includes('milli')) return 0.001
  if (u.includes('centi')) return 0.01
  if (u.includes('deci')) return 0.1
  if (u.includes('micro')) return 1e-6
  if (u.includes('foot') || u.includes('feet')) return 0.3048
  if (u.includes('inch')) return 0.0254
  // default METRE
  return 1
}

function materialForType(t: string): THREE.Material {
  const map: Record<string, number> = {
    IfcWall: 0xbcbcbc,
    IfcSlab: 0x9a9a9a,
    IfcBeam: 0x8b4513,
    IfcColumn: 0x666666,
    IfcDoor: 0x8b5a2b,
    IfcWindow: 0x87ceeb,
    IfcStair: 0x777777,
  }
  return new THREE.MeshLambertMaterial({ color: map[t] ?? 0xff5555 })
}

function geometryForType(t: string): THREE.BufferGeometry {
  switch (t) {
    case 'IfcWall':   return new THREE.BoxGeometry(4, 3, 0.3)
    case 'IfcSlab':   return new THREE.BoxGeometry(8, 0.3, 8)
    case 'IfcBeam':   return new THREE.BoxGeometry(6, 0.4, 0.4)
    case 'IfcColumn': return new THREE.BoxGeometry(0.5, 3.5, 0.5)
    case 'IfcDoor':   return new THREE.BoxGeometry(1.2, 2.2, 0.2)
    case 'IfcWindow': return new THREE.BoxGeometry(1.5, 1.2, 0.15)
    case 'IfcStair':  return new THREE.BoxGeometry(3, 1.5, 2)
    default:          return new THREE.BoxGeometry(1, 1, 1)
  }
}

// ----------------- Component -----------------
function App() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)

  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = mountRef.current!
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf0f2f5)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000)
    camera.position.set(20, 15, 20)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lights + grid
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(10, 10, 10)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    scene.add(new THREE.GridHelper(50, 50))

    // Controls (lazy import)
    import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }: any) => {
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enablePan = true
      controls.screenSpacePanning = true
      controls.target.set(0, 0, 0)
      controls.update()

      const animate = () => {
        requestAnimationFrame(animate)
        renderer.render(scene, camera)
      }
      animate()
    })

    // Resize
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = w / h
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(w, h)
      }
    }
    window.addEventListener('resize', handleResize)

    // -------- Load from backend on mount --------
    const loadFromBackend = async () => {
      try {
        setLoading('Loading elements from backend...')
        setError(null)

        // Clear previous model group
        if (modelRef.current) {
          scene.remove(modelRef.current)
          modelRef.current = null
        }

        const { elements } = await fetchElements()
        if (!elements || elements.length === 0) {
          setError('No elements returned from backend')
          setLoading(null)
          return
        }

        // Figure out unit scale (meters) from the first element
        const scale = unitToMeters(elements[0].unit ?? 'METRE')

        // Group by level to keep scene tidy
        const root = new THREE.Group()
        root.name = 'IFC_from_backend'
        const levelGroups = new Map<string, THREE.Group>()

        const ensureLevelGroup = (name: string | null, elevation: number) => {
          const key = name ?? '(no level)'
          if (levelGroups.has(key)) return levelGroups.get(key)!
          const g = new THREE.Group()
          g.name = key
          // Place the group at the storey elevation (meters)
          g.position.y = (elevation ?? 0) * scale
          root.add(g)
          levelGroups.set(key, g)
          return g
        }

        // Create meshes
        for (const el of elements) {
          // Need at least x & y & z_rel to place
          if (el.x == null || el.y == null || el.z_relative_to_level == null) continue

          const g = ensureLevelGroup(el.level_name, el.level_elevation ?? 0)

          const geom = geometryForType(el.type)
          const mat = materialForType(el.type)
          const mesh = new THREE.Mesh(geom, mat)

          // IFC (X, Y, Z-up) -> Three (X, Z, Y-up)
          // Put element inside its level group: local y = z_relative_to_level
          mesh.position.set(
            el.x * scale,                      // X -> X
            (el.z_relative_to_level ?? 0) * scale, // Z_ifc(rel) -> Y_three
            el.y * scale                       // Y_ifc -> Z_three
          )
          mesh.userData = {
            type: el.type,
            level: el.level_name,
            unit: el.unit,
            worldY: el.real_world_z != null ? el.real_world_z * scale : undefined
          }
          g.add(mesh)
        }

        // Add to scene
        modelRef.current = root
        scene.add(root)

        // Fit camera to content
        const box = new THREE.Box3().setFromObject(root)
        if (box.isEmpty() === false) {
          const size = box.getSize(new THREE.Vector3())
          const center = box.getCenter(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const fitDist = maxDim * 1.5
          camera.position.copy(center.clone().add(new THREE.Vector3(fitDist, fitDist, fitDist)))
          camera.lookAt(center)
        }
      } catch (e: any) {
        console.error(e)
        setError(e?.message || 'Failed to load elements')
      } finally {
        setLoading(null)
      }
    }

    loadFromBackend()

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      if (rendererRef.current) {
        rendererRef.current.dispose()
        container.removeChild(rendererRef.current.domElement)
      }
    }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', background: '#f0f0f0' }}>
        {loading && <span>{loading}</span>}
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>
      <div ref={mountRef} style={{ flex: 1 }} />
    </div>
  )
}

export default App
