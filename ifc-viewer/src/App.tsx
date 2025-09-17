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

type SummaryItem = { 
  type: string; 
  unit: string | null; 
  count: number; 
  totals?: Record<string, number>  // <-- NEW: totals per level
}

type BackendResponse = {
  elements: ElementRec[]
  summary?: SummaryItem[]
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

// Fallback: compute summary client-side if BE didn't send it
function computeSummary(elements: ElementRec[]): SummaryItem[] {
  const map = new Map<string, { count: number; unit: string | null }>()
  for (const el of elements) {
    const key = el.type || '(unknown)'
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
      // keep the first non-null unit we see
      if (!prev.unit && el.unit) prev.unit = el.unit
    } else {
      map.set(key, { count: 1, unit: el.unit ?? null })
    }
  }
  return Array.from(map.entries())
    .map(([type, v]) => ({ type, unit: v.unit, count: v.count }))
    .sort((a, b) => b.count - a.count)
}

// ----------------- Component -----------------
function App() {
  // Layout states for splitter
  const [topHeightPct, setTopHeightPct] = useState(60) // % height for top pane
  const isDraggingRef = useRef(false)

  // Three.js refs
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)

  // ----------------- NEW: meshes reference -----------------
  const meshesRef = useRef<THREE.Mesh[]>([])

  // Data/UI
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elements, setElements] = useState<ElementRec[]>([])
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [numLevels, setNumLevels] = useState<number>(0) // number of levels from backend
  const [levelNames, setLevelNames] = useState<string[]>([]) // <-- added (derived from elements)

  // ----------------- Splitter handlers -----------------
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const app = document.getElementById('app-root')
      if (!app) return
      const rect = app.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.min(85, Math.max(15, (y / rect.height) * 100))
      setTopHeightPct(pct)
      // also update renderer size for top pane
      const container = mountRef.current
      if (container && rendererRef.current && cameraRef.current) {
        const w = container.clientWidth
        const h = container.clientHeight
        cameraRef.current.aspect = w / h
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(w, h)
      }
    }
    const onMouseUp = () => { isDraggingRef.current = false }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // ----------------- Three.js scene setup -----------------
  useEffect(() => {
    const container = mountRef.current!
    const width = container.clientWidth || 800
    const height = container.clientHeight || 400

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

    // Resize (on window; splitter adjusts explicitly elsewhere)
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

        const { elements, summary, num_levels } = await fetchElements()
        setElements(elements || [])
        const summaryData = summary && summary.length > 0 ? summary : computeSummary(elements || [])
        setSummary(summaryData)
        setNumLevels(num_levels || 0)

        // derive real level names from elements (sorted by elevation desc)
        const levelMap = new Map<string, number>()
        for (const el of elements || []) {
          if (el.level_name != null) {
            const elev = typeof el.level_elevation === 'number' ? el.level_elevation : 0
            if (!levelMap.has(el.level_name)) levelMap.set(el.level_name, elev)
          }
        }
        const names = Array.from(levelMap.entries())
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .map(([n]) => n)
        setLevelNames(names)

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

        meshesRef.current = [] // reset meshes list

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

        // Create meshes (placeholder geometry)
        for (const el of elements) {
          if (el.x == null || el.y == null || el.z_relative_to_level == null) continue

          const g = ensureLevelGroup(el.level_name, el.level_elevation ?? 0)

          const geom = geometryForType(el.type)
          const mat = materialForType(el.type)
          const mesh = new THREE.Mesh(geom, mat)

          // IFC (X, Y, Z-up) -> Three (X, Z, Y-up)
          mesh.position.set(
            el.x * scale,                              // X -> X
            (el.z_relative_to_level ?? 0) * scale,     // Z_ifc(rel) -> Y_three
            el.y * scale                               // Y_ifc -> Z_three
          )
          mesh.userData = {
            type: el.type,
            level: el.level_name,
            unit: el.unit,
            baseColor: (mat as THREE.MeshLambertMaterial).color.clone() // store original color
          }
          g.add(mesh)
          meshesRef.current.push(mesh) // keep reference
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

  // ----------------- NEW: highlight function -----------------
  const highlightLevel = (level: string) => {
    meshesRef.current.forEach(mesh => {
      const mat = mesh.material as THREE.MeshLambertMaterial
      const baseColor = mesh.userData.baseColor as THREE.Color
      if (mesh.userData.level === level) {
        mat.color = new THREE.Color(0xff0000) // highlight red
      } else {
        mat.color = baseColor.clone()
      }
    })
  }

  const highlightType = (type: string) => {
    meshesRef.current.forEach(mesh => {
      const mat = mesh.material as THREE.MeshLambertMaterial
      const baseColor = mesh.userData.baseColor as THREE.Color
      if (mesh.userData.type === type) {
        mat.color = new THREE.Color(0x0000ff) // highlight blue
      } else {
        mat.color = baseColor.clone()
      }
    })
  }

  // ----------------- Table handlers -----------------
  const handleColumnHeaderClick = (columnKey: string) => {
    // If header is a level name -> highlight all elements of that level
    if (levelNames.includes(columnKey)) {
      highlightLevel(columnKey)
    } else {
      console.log(`Column header clicked: ${columnKey}`)
      alert(`Column header clicked: ${columnKey}`)
    }
  }

  const handleRowHeaderClick = (rowKey: string) => {
    highlightType(rowKey)
  }

  // Compose table data (keep it simple for now)
  const columns: { key: keyof ElementRec | 'index'; label: string }[] = [
    { key: 'index',               label: '#' },
    { key: 'type',                label: 'Type' },
    { key: 'level_name',          label: 'Level' },
    { key: 'x',                   label: 'X' },
    { key: 'y',                   label: 'Y' },
    { key: 'z_relative_to_level', label: 'Z (relative)' },
    { key: 'real_world_z',        label: 'Z (world)' },
    { key: 'unit',                label: 'Unit' },
  ]

  return (
    <div id="app-root" style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      {/* Top status bar */}
      <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', background: '#f0f0f0' }}>
        {loading && <span>{loading}</span>}
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>

      {/* Split panes */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Top (3D) */}
        <div
          style={{
            height: `${topHeightPct}%`,
            minHeight: 100,
            borderBottom: '1px solid #ddd',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
        </div>

        {/* Separator */}
        <div
          onMouseDown={() => (isDraggingRef.current = true)}
          style={{
            height: 6,
            cursor: 'row-resize',
            background: 'linear-gradient(#eaeaea, #d5d5d5)',
            borderTop: '1px solid #cfcfcf',
            borderBottom: '1px solid #cfcfcf',
            userSelect: 'none'
          }}
          title="Drag to resize"
        />

        {/* Bottom (Summary Table) */}
        <div style={{ flex: 1, minHeight: 100, overflow: 'auto', padding: 8, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  { key: 'type', label: 'Element type' },
                  { key: 'unit', label: 'Unit of measure' },
                  { key: 'count', label: 'Total elements (model)' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleColumnHeaderClick(col.label)}
                    style={{
                      position: 'sticky',
                      top: 0,
                      background: '#fafafa',
                      textAlign: 'center',
                      padding: '4px 6px',  // reduced padding
                      borderBottom: '1px solid #ddd',
                      cursor: 'pointer',
                      width: 'calc(100%/12)' // approx smaller by 1/3
                    }}
                  >
                    {col.label}
                  </th>
                ))}
                {levelNames.map((lvl, idx) => (
                  <th
                    key={`lvl-${idx}`}
                    onClick={() => handleColumnHeaderClick(lvl)}
                    style={{
                      position: 'sticky',
                      top: 0,
                      background: '#fafafa',
                      textAlign: 'center',
                      padding: '4px 6px', // reduced padding
                      borderBottom: '1px solid #ddd',
                      cursor: 'pointer',
                      width: 'calc(100%/12)'
                    }}
                  >
                    {lvl}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.type} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {/* Row header = first column (Element type) */}
                  <th
                    scope="row"
                    onClick={() => handleRowHeaderClick(row.type)}
                    style={{
                      background: '#fcfcfc',
                      padding: '4px 6px', // reduced padding
                      borderRight: '1px solid #f5f5f5',
                      cursor: 'pointer',
                      fontWeight: 600,
                      width: 'calc(100%/12)'
                    }}
                    title="Click row header"
                  >
                    {row.type}
                  </th>
                  <td style={{ padding: '4px 6px', width: 'calc(100%/12)' }}>{row.unit ?? ''}</td>
                  <td style={{ padding: '4px 6px', width: 'calc(100%/12)' }}>{row.count}</td>
                  {levelNames.map((lvl, idx) => {
                    console.log('row.totals?', row.type, row.totals, 'checking level:', lvl)
                    return (
                      <td 
                        key={`cell-${row.type}-${idx}`} 
                        style={{ padding: '4px 6px', textAlign: 'center', width: 'calc(100%/12)' }}
                      >
                        {row.totals && row.totals[lvl] ? row.totals[lvl].toFixed(2) : ''}
                      </td>
                    )
                  })}

                </tr>
              ))}
              {summary.length === 0 && (
                <tr><td colSpan={3 + levelNames.length} style={{ padding: 8, color: '#888' }}>No summary data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default App
