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

// Polynomial smooth min (k = 0.1 is good smoothness)
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

const SMOOTH_FACTOR = 0.3; // How "metaball-like" the blends are

export const createSDFEvaluator = (meshes: MeshNode[]) => {
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
                     d = smax(d, -dist, SMOOTH_FACTOR);
                 } else if (item.operation === 'intersect') {
                     d = smax(d, dist, SMOOTH_FACTOR);
                 } else {
                     d = smin(d, dist, SMOOTH_FACTOR);
                 }
             }
        }
        return d;
    };
};

// --- Surface Nets Mesher ---

export const generateIsosurfaceGeometry = (meshes: MeshNode[], resolution: number): THREE.BufferGeometry => {
    // 1. Determine Bounds
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    
    if (meshes.length <= 1) return new THREE.BufferGeometry();

    const activeMeshes = meshes.filter(m => m.id !== 'PROCEDURE_MESH_ROOT');
    if (activeMeshes.length === 0) return new THREE.BufferGeometry();
    
    // We need to use computed world positions for bounds
    // Temporary matrix calc for bounds (simplified, not caching)
    // Actually, createSDFEvaluator does matrix calc, but we need bounds first.
    // Let's reuse the logic or accept slightly loose bounds.
    // Ideally, we traverse hierarchically. 
    
    // Quick hierarchical bounds estimation:
    const meshMap = new Map<string, MeshNode>();
    meshes.forEach(m => meshMap.set(m.id, m));
    
    const getWorldPosScale = (id: string): { pos: THREE.Vector3, scale: number } => {
        const mesh = meshMap.get(id);
        if (!mesh) return { pos: new THREE.Vector3(), scale: 1 };
        
        let parentPos = new THREE.Vector3();
        let parentScale = 1;
        let parentQuat = new THREE.Quaternion();
        
        if (mesh.parentId) {
            // This is recursive and slow if deep, but depth is low.
            // For proper bounds we should use matrices like the evaluator.
            // Let's implement a quick matrix build similar to evaluator.
             // (Omitted full matrix re-impl for brevity, using simple accumulation approximation 
             // or just relying on evaluator logic if we move evaluator creation up)
        }
        return { pos: new THREE.Vector3(...mesh.position), scale: mesh.scale };
    };

    // Better approach: Just create the evaluator first, it computes matrices!
    // But evaluator creates 'items' which are internal.
    // Let's just create the evaluator and trust loose bounds for now based on root positions + large padding,
    // OR create the evaluator and iterate a coarse grid to find bounds? Too slow.
    // Let's just iterate meshes and accumulate world matrices to find bounds.
    
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
        box.expandByPoint(pos.clone().addScalar(radius));
        box.expandByPoint(pos.clone().subScalar(radius));
    });

    // Expand bounds for padding
    box.expandByScalar(1.5);

    // 2. Setup Grid
    const gridRes = Math.min(Math.floor(resolution * 4), 128); 
    const size = new THREE.Vector3();
    box.getSize(size);
    const step = size.clone().divideScalar(gridRes);
    if (step.lengthSq() < 0.0001) step.set(0.1, 0.1, 0.1);
    const dims = [gridRes, gridRes, gridRes];

    // 3. Create Evaluator
    const evaluate = createSDFEvaluator(meshes);
    
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
    
    // ... (Rest of Surface Nets implementation remains identical) ...
    // Since the previous implementation was standard Surface Nets, I'll condense the rest for brevity
    // but ensure it outputs the full geometry logic.
    
    const vertices: number[] = [];
    const indices: number[] = [];
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
                
                const v000 = values[i000]; const v100 = values[i100];
                const v010 = values[i010]; const v110 = values[i110];
                const v001 = values[i001]; const v101 = values[i101];
                const v011 = values[i011]; const v111 = values[i111];
                
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
    
    // Create Quads
    const addQuad = (c0: number, c1: number, c2: number, c3: number, flip: boolean) => {
        const v0 = cellToVertMap.get(c0), v1 = cellToVertMap.get(c1), v2 = cellToVertMap.get(c2), v3 = cellToVertMap.get(c3);
        if (v0!==undefined && v1!==undefined && v2!==undefined && v3!==undefined) {
            if (flip) { indices.push(v0,v1,v3, v0,v3,v2); } else { indices.push(v0,v2,v3, v0,v3,v1); }
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
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    
    return geometry;
};
