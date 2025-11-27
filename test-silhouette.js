import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OUTPUT_BOTH, SilhouetteGenerator } from './src/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const io = new NodeIO()
    .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
    })

const _translation = new Vector3()
const _scale = new Vector3()
const _rotation = new Quaternion()

const composeNodeMatrix = (node) => {
    const matrix = node.getMatrix()
    if (matrix) {
        return new Matrix4().fromArray(matrix)
    }

    _translation.fromArray(node.getTranslation() ?? [0, 0, 0])
    _rotation.fromArray(node.getRotation() ?? [0, 0, 0, 1])
    _scale.fromArray(node.getScale() ?? [1, 1, 1])
    return new Matrix4().compose(_translation, _rotation, _scale)
}

const toBufferGeometry = (primitive) => {
    const positionAttr = primitive.getAttribute('POSITION')
    if (!positionAttr) {
        return null
    }

    const geometry = new BufferGeometry()
    const count = positionAttr.getCount()
    const positions = new Float32Array(count * 3)
    const element = [0, 0, 0]

    for (let i = 0; i < count; i++) {
        positionAttr.getElement(i, element)
        positions[i * 3] = element[0]
        positions[i * 3 + 1] = element[1]
        positions[i * 3 + 2] = element[2]
    }

    geometry.setAttribute('position', new BufferAttribute(positions, 3, false))

    const indexAttr = primitive.getIndices()
    if (indexAttr) {
        const indices = indexAttr.getArray()
        if (indices && indices.length > 0) {
            const indicesArray = new Uint32Array(indices.length)
            indicesArray.set(indices)
            geometry.setIndex(new BufferAttribute(indicesArray, 1))
        }
    }

    return geometry
}

const traverseNode = (node, parentMatrix, target) => {
    const localMatrix = composeNodeMatrix(node)
    const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, localMatrix)

    const mesh = node.getMesh()
    if (mesh) {
        mesh.listPrimitives().forEach((primitive) => {
            const geometry = toBufferGeometry(primitive)
            if (geometry) {
                geometry.applyMatrix4(worldMatrix)
                target.push(geometry)
            }
        })
    }

    node.listChildren().forEach((child) => traverseNode(child, worldMatrix, target))
}

const loadMergedGeometry = async (glbPath) => {
    console.log(`📦 Loading GLB from ${glbPath}...`)
    const loadStartTime = performance.now()

    const buffer = await readFile(glbPath)
    const document = await io.read(glbPath)
    const root = document.getRoot()
    const scenes = root.listScenes()
    const geometries = []

    if (scenes.length === 0) {
        throw new Error('GLB does not contain any scenes to process')
    }

    scenes.forEach((scene) => {
        scene.listChildren().forEach((child) => {
            traverseNode(child, new Matrix4(), geometries)
        })
    })

    if (geometries.length === 0) {
        throw new Error('No mesh primitives with POSITION attributes were found')
    }

    const merged = mergeGeometries(geometries, false)
    geometries.forEach((g) => g.dispose())

    const loadEndTime = performance.now()
    const triCount = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3
    console.log(`✓ Loaded and merged ${geometries.length} geometries into ${triCount.toFixed(0)} triangles`)
    console.log(`  ⏱️  Load time: ${(loadEndTime - loadStartTime).toFixed(2)}ms`)

    return merged
}

const generateSilhouette = (geometry, options = {}) => {
    const startTime = performance.now()
    const generator = new SilhouetteGenerator()
    generator.output = OUTPUT_BOTH
    generator.sortTriangles = options.sortTriangles ?? true
    generator.iterationTime = options.iterationTime ?? 1000
    generator.simplifyTolerance = options.simplifyTolerance ?? null

    let lastProgress = -1
    const taskStartTime = performance.now()
    const task = generator.generate(geometry, {
        onProgress: options.verbose
            ? (progress) => {
                const percent = Math.floor(progress * 100)
                if (percent !== lastProgress) {
                    process.stdout.write(`\r🌀 Union progress: ${percent}%`)
                    lastProgress = percent
                }
            }
            : undefined,
    })

    let result = task.next()
    let iterationCount = 0
    const iterationTimes = []
    let lastIterationTime = performance.now()

    while (!result.done) {
        const iterationStart = performance.now()
        result = task.next()
        const iterationEnd = performance.now()
        iterationTimes.push(iterationEnd - iterationStart)
        iterationCount++
        lastIterationTime = iterationEnd
    }
    const taskEndTime = performance.now()

    if (options.verbose && lastProgress >= 0) {
        process.stdout.write('\n')
    }

    const extractStartTime = performance.now()
    const resultValue = result.value
    const [mesh, outline] = Array.isArray(resultValue) ? resultValue : [resultValue, resultValue]
    const paths = mesh?.userData?.silhouettePaths ?? outline?.userData?.silhouettePaths ?? null
    const extractEndTime = performance.now()

    const endTime = performance.now()

    if (options.verbose) {
        console.log(`  ⏱️  Generator loop: ${(taskEndTime - taskStartTime).toFixed(2)}ms (${iterationCount} iterations)`)
        if (iterationTimes.length > 0) {
            const avgTime = iterationTimes.reduce((a, b) => a + b, 0) / iterationTimes.length
            const minTime = Math.min(...iterationTimes)
            const maxTime = Math.max(...iterationTimes)
            const first10Avg = iterationTimes.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, iterationTimes.length)
            const last10Avg = iterationTimes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, iterationTimes.length)
            console.log(`     - Iteration timing: avg ${avgTime.toFixed(2)}ms, min ${minTime.toFixed(2)}ms, max ${maxTime.toFixed(2)}ms`)
            console.log(`     - First 10 avg: ${first10Avg.toFixed(2)}ms, Last 10 avg: ${last10Avg.toFixed(2)}ms`)
            if (last10Avg > first10Avg * 1.5) {
                console.log(`     ⚠️  Iterations are getting slower (likely Clipper union complexity growing)`)
            }
        }
        console.log(`  ⏱️  Path extraction: ${(extractEndTime - extractStartTime).toFixed(2)}ms`)
    }

    const meshTriCount = mesh?.index ? mesh.index.count / 3 : 0
    const outlinePointCount = outline?.attributes?.position?.count ?? 0

    console.log(`✓ Generated silhouette`)
    console.log(`  ⏱️  Total silhouette generation: ${(endTime - startTime).toFixed(2)}ms`)
    console.log(`  📊 Result: ${meshTriCount.toFixed(0)} triangles in mesh, ${outlinePointCount} points in outline`)
    if (paths) {
        const pathCount = paths.length
        const totalPoints = paths.reduce((sum, path) => sum + path.length, 0)
        console.log(`  📊 Paths: ${pathCount} paths with ${totalPoints} total points`)
    }

    return {
        mesh,
        outline,
        paths,
    }
}

async function main() {
    const glbPath = join(__dirname, 'test', 'Potted_Tree.glb')

    console.log('🌳 Generating top silhouette for Potted_Tree.glb\n')

    try {
        // Load and merge geometry
        const geometry = await loadMergedGeometry(glbPath)
        console.log('')

        // Generate silhouette
        const result = generateSilhouette(geometry, {
            verbose: true,
            sortTriangles: true,
            iterationTime: 1000,
            simplifyTolerance: 0.001, // RDP simplification tolerance in native units
        })

        console.log('\n✅ Silhouette generation complete!')

        // Cleanup
        geometry.dispose()
        if (result.mesh) result.mesh.dispose()
        if (result.outline) result.outline.dispose()

    } catch (err) {
        console.error('❌ Error:', err)
        process.exit(1)
    }
}

main().catch(console.error)

