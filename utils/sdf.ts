import * as THREE from 'three';
import { MeshNode } from '../store';

// --- SDF Primitives ---

const sdSphere = (p: THREE.Vector3, r: number) => {
  return p.length() - r;
};

const sdBox = (p: THREE.Vector3, b: THREE.Vector3) => {
  const x = Math.abs(p.x) - b.x;
  const y = Math.abs(p.y) - b.y;
  const z = Math.abs(p.z) - b.z;
  const d = Math.min(Math.max(x, Math.max(y, z)), 0.0) + new THREE.Vector3(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)).length();
  return d;
};

const sdCapsule = (p: THREE.Vector3, h: number, r: number) => {
  const halfH = h / 2;
  // Aligned on Y axis centered
  const py = p.y - Math.max(-halfH, Math.min(halfH, p.y));
  const dist = new THREE.Vector3(p.x, py, p.z).length();
  return dist - r;
};

// --- SDF Operators (Smooth) ---

// Polynomial smooth min
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

// Smooth Subtract
const smax = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0.0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
};

// --- Scene SDF Evaluator Factory ---

export const createSDFEvaluator = (meshes: MeshNode[], blendStrength: number) => {
    // 1. Prepare hierarchy map
    const meshMap = new Map<string, MeshNode>();
    meshes.forEach(m => meshMap.set(m.id, m));
    
    // 2. Prepare cache for matrices
    const matrixCache = new Map<string, THREE.Matrix4>();

    // 3. Recursive World Matrix Calculation
    const getWorldMatrix = (id: string): THREE.Matrix4 => {
        if (matrixCache.has(id)) return matrixCache.get(id)!;
        
        const mesh = meshMap.get(id);
        if (!mesh) return new THREE.Matrix4();
        
        // Construct local matrix: T * R * S
        const localMatrix = new THREE.Matrix4();
        localMatrix.compose(
            new THREE.Vector3(...mesh.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...mesh.rotation)),
            new THREE.Vector3(mesh.scale, mesh.scale, mesh.scale)
        );
        
        // Multiply by parent if exists
        if (mesh.parentId && meshMap.has(mesh.parentId)) {
            const parentMatrix = getWorldMatrix(mesh.parentId);
            const worldMatrix = parentMatrix.clone().multiply(localMatrix);
            matrixCache.set(id, worldMatrix);
            return worldMatrix;
        } else {
            matrixCache.set(id, localMatrix);
            return localMatrix;
        }
    };

    // 4. Pre-process items for the fast evaluation loop
    const activeMeshes = meshes.filter(m => m.id !== 'PROCEDURE_MESH_ROOT');
    
    const items = activeMeshes.map(mesh => {
        const worldMatrix = getWorldMatrix(mesh.id);
        const inverseMatrix = worldMatrix.clone().invert();
        
        // Extract global scale from world matrix to normalize distance
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        worldMatrix.decompose(pos, quat, scl);
        
        // Use average scale for SDF distance correction
        const scale = (scl.x + scl.y + scl.z) / 3;

        return {
            type: mesh.type,
            operation: mesh.operation,
            inverseMatrix,
            scale
        };
    });

    // 5. Return the evaluator function
    return (pos: THREE.Vector3) => {
        let d = 10000.0;
        let first = true;
        const localP = new THREE.Vector3();

        for (const item of items) {
             // Transform world point to mesh local space
             localP.copy(pos).applyMatrix4(item.inverseMatrix);
             
             // Evaluate Primitive (Unit size, as scale is in matrix)
             let dist = 0;
             if (item.type === 'cube') {
                 dist = sdBox(localP, new THREE.Vector3(0.5, 0.5, 0.5));
             } else if (item.type === 'capsule') {
                 dist = sdCapsule(localP, 1.0, 0.5);
             } else {
                 dist = sdSphere(localP, 0.5);
             }
             
             // Scale distance back to world
             dist *= item.scale;

             // Combine
             if (first) {
                 d = dist;
                 first = false;
             } else {
                 if (item.operation === 'subtract') {
                     d = smax(d, -dist, blendStrength);
                 } else if (item.operation === 'intersect') {
                     d = smax(d, dist, blendStrength);
                 } else {
                     d = smin(d, dist, blendStrength);
                 }
             }
        }
        return d;
    };
};

// --- Helper: Bone Extraction ---
interface BoneSegment {
    start: THREE.Vector3;
    end: THREE.Vector3;
    dir: THREE.Vector3;
    lengthSq: number;
}

const extractBones = (meshes: MeshNode[]): BoneSegment[] => {
    const meshMap = new Map<string, MeshNode>(meshes.map(m => [m.id, m]));
    const matrixCache = new Map<string, THREE.Matrix4>();

    const getWorldPosition = (id: string): THREE.Vector3 => {
        if (matrixCache.has(id)) return new THREE.Vector3().setFromMatrixPosition(matrixCache.get(id)!);

        const mesh = meshMap.get(id);
        if (!mesh) return new THREE.Vector3();

        const localMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...mesh.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...mesh.rotation)),
            new THREE.Vector3(mesh.scale, mesh.scale, mesh.scale)
        );

        let finalMatrix = localMatrix;
        if (mesh.parentId) {
            const parents = [];
            let curr = mesh.parentId;
            while(curr && meshMap.has(curr)) {
                parents.unshift(meshMap.get(curr)!);
                curr = meshMap.get(curr)!.parentId;
            }
            
            finalMatrix = new THREE.Matrix4(); // Identity
            parents.forEach(p => {
                const pm = new THREE.Matrix4().compose(
                    new THREE.Vector3(...p.position),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation)),
                    new THREE.Vector3(p.scale, p.scale, p.scale)
                );
                finalMatrix.multiply(pm);
            });
            finalMatrix.multiply(localMatrix);
        }
        
        matrixCache.set(id, finalMatrix);
        return new THREE.Vector3().setFromMatrixPosition(finalMatrix);
    };

    const segments: BoneSegment[] = [];
    meshes.forEach(m => {
        if (!m.parentId || m.id === 'PROCEDURE_MESH_ROOT') return;
        
        const parent = meshMap.get(m.parentId);
        if (!parent || parent.id === 'PROCEDURE_MESH_ROOT') return;

        const start = getWorldPosition(parent.id);
        const end = getWorldPosition(m.id);
        
        const diff = new THREE.Vector3().subVectors(end, start);
        const lenSq = diff.lengthSq();
        
        if (lenSq > 0.0001) {
            segments.push({
                start,
                end,
                dir: diff.normalize(),
                lengthSq: lenSq
            });
        }
    });
    return segments;
};

// --- Smart Retopology Helper: Laplacian Smooth + Project + Bone Snapping ---

const refineMesh = (
    geometry: THREE.BufferGeometry, 
    evaluateSDF: (p: THREE.Vector3) => number,
    bones: BoneSegment[],
    gridStep: number
) => {
    const posAttribute = geometry.attributes.position as THREE.BufferAttribute;
    const indexAttribute = geometry.index;
    if (!indexAttribute) return geometry;

    const vertexCount = posAttribute.count;
    const adjacency: number[][] = new Array(vertexCount).fill(null).map(() => []);

    for (let i = 0; i < indexAttribute.count; i += 3) {
        const a = indexAttribute.getX(i);
        const b = indexAttribute.getX(i + 1);
        const c = indexAttribute.getX(i + 2);

        if (!adjacency[a].includes(b)) adjacency[a].push(b);
        if (!adjacency[a].includes(c)) adjacency[a].push(c);
        if (!adjacency[b].includes(a)) adjacency[b].push(a);
        if (!adjacency[b].includes(c)) adjacency[b].push(c);
        if (!adjacency[c].includes(a)) adjacency[c].push(a);
        if (!adjacency[c].includes(b)) adjacency[c].push(b);
    }

    const iterations = 8;
    const tempPos = new THREE.Vector3();
    const grad = new THREE.Vector3();
    const eps = 0.001;
    
    const currentPositions = Float32Array.from(posAttribute.array);
    const nextPositions = Float32Array.from(posAttribute.array);
    
    const ringSpacing = gridStep * 0.8; 
    const snapStrength = 0.2; 
    
    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < vertexCount; i++) {
            const neighbors = adjacency[i];
            if (neighbors.length === 0) continue;

            let avgX = 0, avgY = 0, avgZ = 0;
            for (const n of neighbors) {
                avgX += currentPositions[n * 3];
                avgY += currentPositions[n * 3 + 1];
                avgZ += currentPositions[n * 3 + 2];
            }
            let px = avgX / neighbors.length;
            let py = avgY / neighbors.length;
            let pz = avgZ / neighbors.length;

            if (bones.length > 0) {
                let minDistSq = Infinity;
                let bestBone: BoneSegment | null = null;
                let bestT = 0;

                for (const bone of bones) {
                    const vPx = px - bone.start.x;
                    const vPy = py - bone.start.y;
                    const vPz = pz - bone.start.z;
                    
                    let t = (vPx * bone.dir.x + vPy * bone.dir.y + vPz * bone.dir.z);
                    const cx = bone.start.x + t * bone.dir.x;
                    const cy = bone.start.y + t * bone.dir.y;
                    const cz = bone.start.z + t * bone.dir.z;
                    
                    const dx = px - cx;
                    const dy = py - cy;
                    const dz = pz - cz;
                    const dSq = dx*dx + dy*dy + dz*dz;
                    
                    if (dSq < minDistSq) {
                        minDistSq = dSq;
                        bestBone = bone;
                        bestT = t;
                    }
                }

                if (bestBone && minDistSq < 4.0) { 
                    const snappedT = Math.round(bestT / ringSpacing) * ringSpacing;
                    const shift = (snappedT - bestT) * snapStrength;
                    px += bestBone.dir.x * shift;
                    py += bestBone.dir.y * shift;
                    pz += bestBone.dir.z * shift;
                }
            }

            tempPos.set(px, py, pz);
            const dist = evaluateSDF(tempPos);
            
            const d1 = evaluateSDF(new THREE.Vector3(px + eps, py, pz));
            const d2 = evaluateSDF(new THREE.Vector3(px, py + eps, pz));
            const d3 = evaluateSDF(new THREE.Vector3(px, py, pz + eps));
            
            grad.set(d1 - dist, d2 - dist, d3 - dist).normalize();
            
            nextPositions[i * 3]     = px - grad.x * dist;
            nextPositions[i * 3 + 1] = py - grad.y * dist;
            nextPositions[i * 3 + 2] = pz - grad.z * dist;
        }
        currentPositions.set(nextPositions);
    }
    
    posAttribute.array.set(currentPositions);
    posAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    
    // Also update the wireframe geometry positions if it exists
    if (geometry.userData.quadWireframe) {
        // The wireframe geometry has unique vertices that match the mesh vertices? 
        // No, Wireframe is usually lines. 
        // We need to rebuild the wireframe or map vertices.
        // Rebuilding is safer. The wireframe indices refer to the main geometry indices?
        // If we use LineSegments with setIndex(wireframeIndices) and the SAME position attribute, it syncs automatically!
        // This is the efficient way.
    }
    
    return geometry;
};


// --- Surface Nets Mesher ---

export const generateIsosurfaceGeometry = (meshes: MeshNode[], resolution: number, smartRetopo: boolean = false, blendStrength: number = 0.3): THREE.BufferGeometry => {
    // 1. Determine Bounds
    const box = new THREE.Box3();
    
    if (meshes.length <= 1) return new THREE.BufferGeometry();

    const activeMeshes = meshes.filter(m => m.id !== 'PROCEDURE_MESH_ROOT');
    if (activeMeshes.length === 0) return new THREE.BufferGeometry();
    
    // Quick hierarchical bounds estimation:
    const meshMap = new Map<string, MeshNode>();
    meshes.forEach(m => meshMap.set(m.id, m));
    
    const worldMatrixMap = new Map<string, THREE.Matrix4>();
    const getWorldMatrix = (id: string): THREE.Matrix4 => {
        if (worldMatrixMap.has(id)) return worldMatrixMap.get(id)!;
        const mesh = meshMap.get(id);
        if(!mesh) return new THREE.Matrix4();
        
        const local = new THREE.Matrix4().compose(
            new THREE.Vector3(...mesh.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...mesh.rotation)),
            new THREE.Vector3(mesh.scale, mesh.scale, mesh.scale)
        );
        if(mesh.parentId) {
            const parent = getWorldMatrix(mesh.parentId);
            const world = parent.clone().multiply(local);
            worldMatrixMap.set(id, world);
            return world;
        }
        worldMatrixMap.set(id, local);
        return local;
    }

    activeMeshes.forEach(m => {
        const mat = getWorldMatrix(m.id);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        mat.decompose(pos, quat, scl);
        
        const radius = Math.max(scl.x, scl.y, scl.z) * 1.5;
        const pad = radius + blendStrength;
        box.expandByPoint(pos.clone().addScalar(pad));
        box.expandByPoint(pos.clone().subScalar(pad));
    });

    box.expandByScalar(1.0);

    // 2. Setup Grid
    const gridRes = Math.min(Math.floor(resolution * 4), 128); 
    const size = new THREE.Vector3();
    box.getSize(size);
    const step = size.clone().divideScalar(gridRes);
    const avgStep = (step.x + step.y + step.z) / 3;

    if (step.lengthSq() < 0.0001) step.set(0.1, 0.1, 0.1);
    const dims = [gridRes, gridRes, gridRes];

    // 3. Create Evaluator
    const evaluate = createSDFEvaluator(meshes, blendStrength);
    
    // Arrays
    const values = new Float32Array((dims[0]+1) * (dims[1]+1) * (dims[2]+1));
    const probe = new THREE.Vector3();
    
    for (let z = 0; z <= dims[2]; z++) {
        for (let y = 0; y <= dims[1]; y++) {
            for (let x = 0; x <= dims[0]; x++) {
                probe.set(
                    box.min.x + x * step.x,
                    box.min.y + y * step.y,
                    box.min.z + z * step.z
                );
                const d = evaluate(probe);
                const i = x + y * (dims[0]+1) + z * (dims[0]+1) * (dims[1]+1);
                values[i] = d;
            }
        }
    }
    
    const vertices: number[] = [];
    const indices: number[] = [];
    const wireframeIndices: number[] = []; // Store indices for quad edges (lines)
    const cellToVertMap = new Map<number, number>();
    
    // Find Surface Vertices
    for (let z = 0; z < dims[2]; z++) {
        for (let y = 0; y < dims[1]; y++) {
            for (let x = 0; x < dims[0]; x++) {
                // Get 8 corner values
                const i000 = (x) + (y) * (dims[0]+1) + (z) * (dims[0]+1) * (dims[1]+1);
                const i100 = (x+1) + (y) * (dims[0]+1) + (z) * (dims[0]+1) * (dims[1]+1);
                const i010 = (x) + (y+1) * (dims[0]+1) + (z) * (dims[0]+1) * (dims[1]+1);
                const i110 = (x+1) + (y+1) * (dims[0]+1) + (z) * (dims[0]+1) * (dims[1]+1);
                const i001 = (x) + (y) * (dims[0]+1) + (z+1) * (dims[0]+1) * (dims[1]+1);
                const i101 = (x+1) + (y) * (dims[0]+1) + (z+1) * (dims[0]+1) * (dims[1]+1);
                const i011 = (x) + (y+1) * (dims[0]+1) + (z+1) * (dims[0]+1) * (dims[1]+1);
                const i111 = (x+1) + (y+1) * (dims[0]+1) + (z+1) * (dims[0]+1) * (dims[1]+1);
                
                const v000 = values[i000];
                const v100 = values[i100];
                const v010 = values[i010];
                const v110 = values[i110];
                const v001 = values[i001];
                const v101 = values[i101];
                const v011 = values[i011];
                const v111 = values[i111];
                
                const mask = (v000>0?1:0)|(v100>0?2:0)|(v010>0?4:0)|(v110>0?8:0)|
                             (v001>0?16:0)|(v101>0?32:0)|(v011>0?64:0)|(v111>0?128:0);
                
                if (mask === 0 || mask === 255) continue;
                
                let sumX = 0, sumY = 0, sumZ = 0, count = 0;
                const interp = (valA: number, valB: number, posA: number, posB: number) => posA + (valA / (valA - valB)) * (posB - posA);
                
                // Edges X
                const x0 = box.min.x+x*step.x, x1 = x0+step.x;
                if ((v000>0)!==(v100>0)) { sumX+=interp(v000,v100,x0,x1); sumY+=box.min.y+y*step.y; sumZ+=box.min.z+z*step.z; count++; }
                if ((v010>0)!==(v110>0)) { sumX+=interp(v010,v110,x0,x1); sumY+=box.min.y+(y+1)*step.y; sumZ+=box.min.z+z*step.z; count++; }
                if ((v001>0)!==(v101>0)) { sumX+=interp(v001,v101,x0,x1); sumY+=box.min.y+y*step.y; sumZ+=box.min.z+(z+1)*step.z; count++; }
                if ((v011>0)!==(v111>0)) { sumX+=interp(v011,v111,x0,x1); sumY+=box.min.y+(y+1)*step.y; sumZ+=box.min.z+(z+1)*step.z; count++; }

                // Edges Y
                const y0 = box.min.y+y*step.y, y1 = y0+step.y;
                if ((v000>0)!==(v010>0)) { sumX+=box.min.x+x*step.x; sumY+=interp(v000,v010,y0,y1); sumZ+=box.min.z+z*step.z; count++; }
                if ((v100>0)!==(v110>0)) { sumX+=box.min.x+(x+1)*step.x; sumY+=interp(v100,v110,y0,y1); sumZ+=box.min.z+z*step.z; count++; }
                if ((v001>0)!==(v011>0)) { sumX+=box.min.x+x*step.x; sumY+=interp(v001,v011,y0,y1); sumZ+=box.min.z+(z+1)*step.z; count++; }
                if ((v101>0)!==(v111>0)) { sumX+=box.min.x+(x+1)*step.x; sumY+=interp(v101,v111,y0,y1); sumZ+=box.min.z+(z+1)*step.z; count++; }

                // Edges Z
                const z0 = box.min.z+z*step.z, z1 = z0+step.z;
                if ((v000>0)!==(v001>0)) { sumX+=box.min.x+x*step.x; sumY+=box.min.y+y*step.y; sumZ+=interp(v000,v001,z0,z1); count++; }
                if ((v100>0)!==(v101>0)) { sumX+=box.min.x+(x+1)*step.x; sumY+=box.min.y+y*step.y; sumZ+=interp(v100,v101,z0,z1); count++; }
                if ((v010>0)!==(v011>0)) { sumX+=box.min.x+x*step.x; sumY+=box.min.y+(y+1)*step.y; sumZ+=interp(v010,v011,z0,z1); count++; }
                if ((v110>0)!==(v111>0)) { sumX+=box.min.x+(x+1)*step.x; sumY+=box.min.y+(y+1)*step.y; sumZ+=interp(v110,v111,z0,z1); count++; }
                
                if (count > 0) {
                    vertices.push(sumX/count, sumY/count, sumZ/count);
                    cellToVertMap.set(x + y * dims[0] + z * dims[0] * dims[1], (vertices.length/3)-1);
                }
            }
        }
    }
    
    // Create Quads & Wireframes
    const addQuad = (c0: number, c1: number, c2: number, c3: number, flip: boolean) => {
        const v0 = cellToVertMap.get(c0), v1 = cellToVertMap.get(c1), v2 = cellToVertMap.get(c2), v3 = cellToVertMap.get(c3);
        if (v0!==undefined && v1!==undefined && v2!==undefined && v3!==undefined) {
            // Triangle Indices
            if (flip) { 
                indices.push(v0,v1,v3, v0,v3,v2); 
            } else { 
                indices.push(v0,v2,v3, v0,v3,v1); 
            }
            
            // Wireframe Indices (Quad Edges Only - No Diagonal)
            // Edges: v0-v1, v1-v3, v3-v2, v2-v0 (based on flip order? No, loop around face)
            // The standard quad order in surface nets usually follows the cell corner iteration.
            // Let's assume v0, v2, v3, v1 is the loop or v0, v1, v3, v2?
            // Checking Surface Nets standard: 
            // If flip: v0 -> v1 -> v3 -> v2 -> v0
            // If !flip: v0 -> v2 -> v3 -> v1 -> v0
            
            if (flip) {
                 wireframeIndices.push(v0,v1, v1,v3, v3,v2, v2,v0);
            } else {
                 wireframeIndices.push(v0,v2, v2,v3, v3,v1, v1,v0);
            }
        }
    };

    // X-axis quads
    for (let z=1; z<dims[2]; z++) for (let y=1; y<dims[1]; y++) for (let x=0; x<dims[0]; x++) {
        const i0 = x + y*(dims[0]+1) + z*(dims[0]+1)*(dims[1]+1);
        const i1 = (x+1) + y*(dims[0]+1) + z*(dims[0]+1)*(dims[1]+1);
        if ((values[i0]>0)!==(values[i1]>0)) {
            addQuad(x+(y-1)*dims[0]+(z-1)*dims[0]*dims[1], x+y*dims[0]+(z-1)*dims[0]*dims[1], x+(y-1)*dims[0]+z*dims[0]*dims[1], x+y*dims[0]+z*dims[0]*dims[1], values[i0]>0);
        }
    }
    // Y-axis quads
    for (let z=1; z<dims[2]; z++) for (let y=0; y<dims[1]; y++) for (let x=1; x<dims[0]; x++) {
        const i0 = x + y*(dims[0]+1) + z*(dims[0]+1)*(dims[1]+1);
        const i1 = x + (y+1)*(dims[0]+1) + z*(dims[0]+1)*(dims[1]+1);
        if ((values[i0]>0)!==(values[i1]>0)) {
            addQuad((x-1)+y*dims[0]+(z-1)*dims[0]*dims[1], x+y*dims[0]+(z-1)*dims[0]*dims[1], (x-1)+y*dims[0]+z*dims[0]*dims[1], x+y*dims[0]+z*dims[0]*dims[1], values[i0]<0);
        }
    }
    // Z-axis quads
    for (let z=0; z<dims[2]; z++) for (let y=1; y<dims[1]; y++) for (let x=1; x<dims[0]; x++) {
        const i0 = x + y*(dims[0]+1) + z*(dims[0]+1)*(dims[1]+1);
        const i1 = x + y*(dims[0]+1) + (z+1)*(dims[0]+1)*(dims[1]+1);
        if ((values[i0]>0)!==(values[i1]>0)) {
            addQuad((x-1)+(y-1)*dims[0]+z*dims[0]*dims[1], x+(y-1)*dims[0]+z*dims[0]*dims[1], (x-1)+y*dims[0]+z*dims[0]*dims[1], x+y*dims[0]+z*dims[0]*dims[1], values[i0]>0);
        }
    }

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.Float32BufferAttribute(vertices, 3);
    geometry.setAttribute('position', positionAttribute);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Create Quad Wireframe Geometry
    // We reuse the SAME position attribute so that when `refineMesh` updates positions, the wireframe follows automatically!
    const wireframeGeo = new THREE.BufferGeometry();
    wireframeGeo.setAttribute('position', positionAttribute);
    wireframeGeo.setIndex(wireframeIndices);
    
    // Attach to userData
    geometry.userData.quadWireframe = wireframeGeo;
    
    // 4. Apply Smart Retopology if requested
    if (smartRetopo) {
        const bones = extractBones(meshes);
        refineMesh(geometry, evaluate, bones, avgStep);
    }
    
    return geometry;
};