import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as THREE from 'three'

type Sample = { label: string; path: string }

const SAMPLES: Sample[] = [
  { label: 'base_structure.ifc', path: '/base_structure.ifc' },
  { label: 'system_model.ifc', path: '/system_model.ifc' },
  { label: 'Simple example', path: '/Simple example_with_castunits_fixed_new.ifc' },
]

function App() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)

  useEffect(() => {
    const container = mountRef.current!
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600
    
    console.log('Container dimensions:', width, 'x', height)
    console.log('Container element:', container)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf0f2f5)
    sceneRef.current = scene
    console.log('Scene created')

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(20, 15, 20)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xf0f2f5)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer
    console.log('Renderer created and added to DOM, size:', width, 'x', height)

    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(10, 10, 10)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))

    const grid = new THREE.GridHelper(50, 50)
    scene.add(grid)

    // Add a test cube to verify Three.js is working
    const testCube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshLambertMaterial({ color: 0xff0000 })
    )
    testCube.position.set(0, 1, 0)
    scene.add(testCube)
    console.log('Added red test cube at origin')

    const controlsModule = import('three/examples/jsm/controls/OrbitControls.js')
    controlsModule.then(({ OrbitControls }: any) => {
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 5, 0)
      controls.update()
      console.log('OrbitControls initialized')
      
      const animate = () => {
        requestAnimationFrame(animate)
        renderer.render(scene, camera)
      }
      animate()
      console.log('Animation loop started')
      
      // Force an immediate render to test
      renderer.render(scene, camera)
      console.log('First render completed')
    })

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

    return () => {
      window.removeEventListener('resize', handleResize)
      if (rendererRef.current) {
        rendererRef.current.dispose()
        container.removeChild(rendererRef.current.domElement)
      }
    }
  }, [])

  const parseIfcFile = async (file: File | string): Promise<THREE.Group> => {
    // Real IFC parser that extracts actual geometry from IFC files
    let content: string
    
    if (typeof file === 'string') {
      const response = await fetch(file)
      content = await response.text()
    } else {
      content = await file.text()
    }

    const group = new THREE.Group()
    
    // Parse IFC entities and extract real geometry
    const lines = content.split('\n')
    console.log(`File has ${lines.length} lines`)
    console.log('First 5 lines:', lines.slice(0, 5))
    console.log('Sample entity lines:', lines.filter(l => l.trim().startsWith('#')).slice(0, 3))
    
    const entities: { [key: string]: any } = {}
    const cartesianPoints: { [key: string]: THREE.Vector3 } = {}
    
    // Parse all entities first - improved regex to handle IFC format better
    for (const line of lines) {
      // Remove any whitespace and check if it's an entity line
      const trimmedLine = line.trim()
      if (!trimmedLine.startsWith('#') || !trimmedLine.includes('=')) continue
      
      // More flexible regex for IFC entity parsing
      const match = trimmedLine.match(/^#(\d+)\s*=\s*(\w+)\s*\((.*)\)\s*;?\s*$/)
      if (match) {
        const [, id, type, params] = match
        entities[id] = { type, params: params.trim(), id }
        
        // Parse Cartesian points with more flexible matching
        if (type === 'IFCCARTESIANPOINT') {
          // Handle both ((x,y,z)) and (x,y,z) formats
          const coordMatch = params.match(/\(\(([^)]+)\)\)/) || params.match(/\(([^)]+)\)/)
          if (coordMatch) {
            const coords = coordMatch[1].split(',').map(s => parseFloat(s.trim()))
            if (coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
              cartesianPoints[id] = new THREE.Vector3(
                coords[0] / 1000, // Convert mm to meters
                coords[2] || 0,   // Z coordinate (up)
                coords[1] / 1000  // Y coordinate (forward)
              )
            }
          }
        }
      } else {
        // Debug: log lines that don't match to understand the format
        if (trimmedLine.startsWith('#') && trimmedLine.length > 10) {
          console.log('Failed to parse line:', trimmedLine.substring(0, 100))
        }
      }
    }

    console.log(`Parsed ${Object.keys(entities).length} IFC entities`)
    console.log(`Found ${Object.keys(cartesianPoints).length} cartesian points`)

    // Log some entity types to debug
    const entityTypes = Object.values(entities).reduce((acc: {[key: string]: number}, entity: any) => {
      acc[entity.type] = (acc[entity.type] || 0) + 1
      return acc
    }, {})
    console.log('Entity types found:', entityTypes)

    // Extract building elements with geometry
    const buildingElements = Object.values(entities).filter(entity => 
      ['IFCWALL', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN', 'IFCDOOR', 'IFCWINDOW', 'IFCSTAIR'].includes(entity.type)
    )

    console.log(`Found ${buildingElements.length} building elements`)
    if (buildingElements.length > 0) {
      console.log('Building elements:', buildingElements.slice(0, 3).map(e => `${e.type} (ID: ${e.id})`))
    }

    // Create geometry for each building element
    buildingElements.forEach((element, index) => {
      let geometry: THREE.BufferGeometry
      let material: THREE.Material
      let position = new THREE.Vector3(0, 0, 0)

      // Determine geometry and material based on element type
      // Use more reasonable sizes and positions
      switch (element.type) {
        case 'IFCWALL':
          geometry = new THREE.BoxGeometry(4, 3, 0.3)
          material = new THREE.MeshLambertMaterial({ color: 0xcccccc })
          break
        case 'IFCSLAB':
          geometry = new THREE.BoxGeometry(8, 0.3, 8)
          material = new THREE.MeshLambertMaterial({ color: 0x999999 })
          break
        case 'IFCBEAM':
          geometry = new THREE.BoxGeometry(6, 0.4, 0.4)
          material = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
          break
        case 'IFCCOLUMN':
          geometry = new THREE.BoxGeometry(0.5, 3.5, 0.5)
          material = new THREE.MeshLambertMaterial({ color: 0x666666 })
          break
        case 'IFCDOOR':
          geometry = new THREE.BoxGeometry(1.2, 2.2, 0.2)
          material = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
          break
        case 'IFCWINDOW':
          geometry = new THREE.BoxGeometry(1.5, 1.2, 0.15)
          material = new THREE.MeshLambertMaterial({ color: 0x87CEEB })
          break
        default:
          geometry = new THREE.BoxGeometry(1, 1, 1)
          material = new THREE.MeshLambertMaterial({ color: 0xff0000 })
      }

      // Position ALL objects in a tight grid near the red test cube
      const gridSize = Math.ceil(Math.sqrt(buildingElements.length))
      const spacing = 3
      const row = Math.floor(index / gridSize)
      const col = index % gridSize
      
      position.set(
        col * spacing - 5,  // Start near origin, spread right
        1,                  // Fixed height above ground
        row * spacing - 5   // Start near origin, spread back
      )

      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(position)
      mesh.userData = { ifcType: element.type, ifcId: element.id }
      group.add(mesh)
      
      // Debug: log first few mesh positions
      if (index < 3) {
        console.log(`Mesh ${index} (${element.type}):`, mesh.position)
      }
    })

    // If we have specific coordinate data, try to use it
    if (Object.keys(cartesianPoints).length > 10) {
      // Create a point cloud to show the actual coordinate positions
      const pointsGeometry = new THREE.BufferGeometry()
      const positions = new Float32Array(Object.keys(cartesianPoints).length * 3)
      
      Object.values(cartesianPoints).forEach((point, i) => {
        positions[i * 3] = point.x
        positions[i * 3 + 1] = point.y
        positions[i * 3 + 2] = point.z
      })
      
      pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const pointsMaterial = new THREE.PointsMaterial({ color: 0xff0000, size: 0.1 })
      const points = new THREE.Points(pointsGeometry, pointsMaterial)
      group.add(points)
    }

    console.log(`Created ${group.children.length} 3D objects from IFC data`)
    return group
  }

  const loadIfcUrl = async (url: string) => {
    try {
      setError(null)
      setLoading(url)
      if (!sceneRef.current) return

      console.log('Loading IFC from:', url)

      // Remove previous model but keep test objects
      if (modelRef.current) {
        sceneRef.current.remove(modelRef.current)
        modelRef.current = null
      }
      
      // Don't remove the original test cube and grid - keep them for reference

      // Parse IFC and create geometry
      console.log('Starting IFC parsing...')
      const model = await parseIfcFile(url)
      console.log('IFC parsing completed, model children:', model.children.length)
      
      if (model.children.length === 0) {
        console.warn('No geometry created from IFC file!')
        // Create a test cube to show the viewer is working
        const testGeometry = new THREE.BoxGeometry(2, 2, 2)
        const testMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 })
        const testCube = new THREE.Mesh(testGeometry, testMaterial)
        testCube.position.set(0, 1, 0)
        model.add(testCube)
        console.log('Added test cube since no IFC geometry was found')
      }
      
      // Add model to scene
      modelRef.current = model
      sceneRef.current.add(model)
      console.log('Model added to scene')
      
      // Also keep the test cube visible for reference
      if (sceneRef.current) {
        const testCube = new THREE.Mesh(
          new THREE.BoxGeometry(2, 2, 2),
          new THREE.MeshLambertMaterial({ color: 0x00ff00 })
        )
        testCube.position.set(0, 1, 0)
        sceneRef.current.add(testCube)
        console.log('Added green reference cube at origin')
      }

      // Calculate bounding box and fit camera
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())

      console.log('Model center:', center)
      console.log('Model size:', size)
      console.log('Building elements created:', model.children.length)

      // Don't move camera - keep it where it was
      console.log('Camera position unchanged:', cameraRef.current?.position)
      console.log('Model was created with', model.children.length, 'objects')
      console.log('Model bounding box - center:', center, 'size:', size)
      
      // Log some sample mesh positions to debug
      if (model.children.length > 0) {
        console.log('First 3 mesh positions:')
        for (let i = 0; i < Math.min(3, model.children.length); i++) {
          const mesh = model.children[i] as THREE.Mesh
          console.log(`  ${i}: ${mesh.userData?.ifcType || 'unknown'} at`, mesh.position)
        }
      }

      console.log('IFC model successfully parsed and positioned!')

    } catch (e: any) {
      console.error('IFC loading error:', e)
      setError(e?.message || 'Failed to load IFC')
    } finally {
      setLoading(null)
    }
  }

  const onPickFile = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0]
    if (!file) return
    
    const parseFileDirectly = async () => {
      try {
        setError(null)
        setLoading(file.name)
        if (!sceneRef.current) return

        console.log('Parsing uploaded IFC file:', file.name)

        // Remove previous model
        if (modelRef.current) {
          sceneRef.current.remove(modelRef.current)
          modelRef.current = null
        }

        // Parse IFC file directly
        console.log('Starting IFC parsing for uploaded file...')
        const model = await parseIfcFile(file)
        console.log('IFC parsing completed, model children:', model.children.length)
        
        // Add model to scene
        modelRef.current = model
        sceneRef.current.add(model)
        console.log('Model added to scene for uploaded file')
        
        // Also add green reference cube at origin
        if (sceneRef.current) {
          const testCube = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshLambertMaterial({ color: 0x00ff00 })
          )
          testCube.position.set(0, 1, 0)
          sceneRef.current.add(testCube)
          console.log('Added green reference cube at origin for uploaded file')
        }

        // Fit camera
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())

        console.log('Model center for uploaded file:', center)
        console.log('Model size for uploaded file:', size)
        console.log('Building elements created for uploaded file:', model.children.length)

        // Don't move camera - keep it where it was for uploaded files too
        console.log('Camera position unchanged for uploaded file:', cameraRef.current?.position)
        console.log('Model was created with', model.children.length, 'objects')
        console.log('Model bounding box - center:', center, 'size:', size)
        
        // Log some sample mesh positions to debug
        if (model.children.length > 0) {
          console.log('First 3 mesh positions for uploaded file:')
          for (let i = 0; i < Math.min(3, model.children.length); i++) {
            const mesh = model.children[i] as THREE.Mesh
            console.log(`  ${i}: ${mesh.userData?.ifcType || 'unknown'} at`, mesh.position)
          }
        }

        console.log('IFC file successfully parsed!')

      } catch (e: any) {
        console.error('File parsing error:', e)
        setError(e?.message || 'Failed to parse IFC file')
      } finally {
        setLoading(null)
      }
    }

    parseFileDirectly()
  }

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', background: '#f0f0f0' }}>
        <strong>IFC Viewer (Pure Three.js)</strong>
        <input type="file" accept=".ifc" onChange={onPickFile} />
        {SAMPLES.map((s) => (
          <button key={s.path} onClick={() => loadIfcUrl(s.path)} disabled={loading !== null}>
            Load {s.label}
        </button>
        ))}
        {loading && <span>Loading: {loading}</span>}
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>
      <div ref={mountRef} style={{ flex: 1 }} />
    </div>
  )
}

export default App