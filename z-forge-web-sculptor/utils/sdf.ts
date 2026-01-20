import * as THREE from 'three';
import { MeshNode } from '../store';

// --- SDF Primitives ---

const sdSphere = (p: THREE.Vector3, r: number) => p.length() - r;

const sdBox = (p: THREE.Vector3, b: THREE.Vector3) => {
  const x = Math.abs(p.x) - b.x;
  const y = Math.abs(p.y) - b.y;
  const z = Math.abs(p.z) - b.z;
  const outside = new THREE.Vector3(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0));
  return Math.min(Math.max(x, Math.max(y, z)), 0.0) + outside.length();
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

// Smooth Subtract / Max
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
      scale,
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
  dir: THREE.Vector3; // normalized
  length: number;
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
      const parents: MeshNode[] = [];
      let curr = mesh.parentId;
      while (curr && meshMap.has(curr)) {
        parents.unshift(meshMap.get(curr)!);
        curr = meshMap.get(curr)!.parentId;
      }

      finalMatrix = new THREE.Matrix4();
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
      const length = Math.sqrt(lenSq);
      segments.push({
        start,
        end,
        dir: diff.clone().multiplyScalar(1 / length),
        length,
        lengthSq: lenSq,
      });
    }
  });

  return segments;
};

// --- Smart Retopology Helper: Tangent Laplacian + Project + Bone Snapping ---

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

  // Build adjacency using sets (faster + no duplicates)
  const adjacency = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let i = 0; i < indexAttribute.count; i += 3) {
    const a = indexAttribute.getX(i);
    const b = indexAttribute.getX(i + 1);
    const c = indexAttribute.getX(i + 2);
    adjacency[a].add(b);
    adjacency[a].add(c);
    adjacency[b].add(a);
    adjacency[b].add(c);
    adjacency[c].add(a);
    adjacency[c].add(b);
  }

  const iterations = 10;
  const lambda = 0.55; // tangential smoothing strength

  // Gradient/projection parameters
  const eps = Math.max(gridStep * 0.5, 1e-4);
  const inv2eps = 1.0 / (2.0 * eps);

  // Bone snapping parameters
  const ringSpacing = Math.max(gridStep * 1.6, 1e-3);
  const snapStrength = 0.35;
  const snapRadius = Math.max(gridStep * 6.0, 0.25);
  const snapRadiusSq = snapRadius * snapRadius;

  const currentPositions = new Float32Array(posAttribute.array.length);
  currentPositions.set(posAttribute.array as ArrayLike<number>);
  const nextPositions = new Float32Array(currentPositions.length);
  nextPositions.set(currentPositions);

  // Reuse temp objects to avoid allocations in tight loops
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const grad = new THREE.Vector3();
  const probe = new THREE.Vector3();

  const sdfGradient = (x: number, y: number, z: number, out: THREE.Vector3) => {
    // Central differences
    probe.set(x + eps, y, z);
    const dx1 = evaluateSDF(probe);
    probe.set(x - eps, y, z);
    const dx0 = evaluateSDF(probe);

    probe.set(x, y + eps, z);
    const dy1 = evaluateSDF(probe);
    probe.set(x, y - eps, z);
    const dy0 = evaluateSDF(probe);

    probe.set(x, y, z + eps);
    const dz1 = evaluateSDF(probe);
    probe.set(x, y, z - eps);
    const dz0 = evaluateSDF(probe);

    out.set((dx1 - dx0) * inv2eps, (dy1 - dy0) * inv2eps, (dz1 - dz0) * inv2eps);
    return out;
  };

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < vertexCount; i++) {
      const neighbors = adjacency[i];
      if (neighbors.size === 0) continue;

      const ix = i * 3;
      const cx = currentPositions[ix];
      const cy = currentPositions[ix + 1];
      const cz = currentPositions[ix + 2];

      // Laplacian avg
      let avgX = 0,
        avgY = 0,
        avgZ = 0;
      let k = 0;
      for (const nb of neighbors) {
        const jx = nb * 3;
        avgX += currentPositions[jx];
        avgY += currentPositions[jx + 1];
        avgZ += currentPositions[jx + 2];
        k++;
      }

      avgX /= k;
      avgY /= k;
      avgZ /= k;

      // Tangent smoothing (avoid shrinking along normal)
      sdfGradient(cx, cy, cz, grad);
      const gLenSq = grad.lengthSq();
      if (gLenSq > 1e-12) n.copy(grad).multiplyScalar(1 / Math.sqrt(gLenSq));
      else n.set(0, 1, 0);

      const dx = avgX - cx;
      const dy = avgY - cy;
      const dz = avgZ - cz;
      const dotN = dx * n.x + dy * n.y + dz * n.z;
      const tdx = dx - n.x * dotN;
      const tdy = dy - n.y * dotN;
      const tdz = dz - n.z * dotN;

      let px = cx + tdx * lambda;
      let py = cy + tdy * lambda;
      let pz = cz + tdz * lambda;

      // Bone ring snapping (align edge flow along hierarchy)
      if (bones.length > 0) {
        let best: BoneSegment | null = null;
        let bestT = 0;
        let minDistSq = Infinity;

        for (const bone of bones) {
          // Project to SEGMENT (clamped)
          const vx = px - bone.start.x;
          const vy = py - bone.start.y;
          const vz = pz - bone.start.z;
          let t = vx * bone.dir.x + vy * bone.dir.y + vz * bone.dir.z;
          t = Math.max(0, Math.min(bone.length, t));

          const cx2 = bone.start.x + t * bone.dir.x;
          const cy2 = bone.start.y + t * bone.dir.y;
          const cz2 = bone.start.z + t * bone.dir.z;

          const ex = px - cx2;
          const ey = py - cy2;
          const ez = pz - cz2;
          const dSq = ex * ex + ey * ey + ez * ez;

          if (dSq < minDistSq) {
            minDistSq = dSq;
            best = bone;
            bestT = t;
          }
        }

        if (best && minDistSq < snapRadiusSq) {
          const snappedT = Math.round(bestT / ringSpacing) * ringSpacing;
          const shift = (snappedT - bestT) * snapStrength;
          px += best.dir.x * shift;
          py += best.dir.y * shift;
          pz += best.dir.z * shift;
        }
      }

      // Project to surface with a Newton step: p -= grad * sdf(p) / |grad|^2
      p.set(px, py, pz);
      const dist = evaluateSDF(p);
      sdfGradient(px, py, pz, grad);
      const denom = grad.lengthSq() + 1e-12;
      px -= (grad.x * dist) / denom;
      py -= (grad.y * dist) / denom;
      pz -= (grad.z * dist) / denom;

      nextPositions[ix] = px;
      nextPositions[ix + 1] = py;
      nextPositions[ix + 2] = pz;
    }

    currentPositions.set(nextPositions);
  }

  (posAttribute.array as Float32Array).set(currentPositions);
  posAttribute.needsUpdate = true;
  geometry.computeVertexNormals();

  // Wireframe geometry shares the SAME position attribute.
  // When positions change, it automatically follows.
  return geometry;
};

// --- Surface Nets Mesher ---

export const generateIsosurfaceGeometry = (
  meshes: MeshNode[],
  resolution: number,
  smartRetopo: boolean = false,
  blendStrength: number = 0.3
): THREE.BufferGeometry => {
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
    if (!mesh) return new THREE.Matrix4();

    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...mesh.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...mesh.rotation)),
      new THREE.Vector3(mesh.scale, mesh.scale, mesh.scale)
    );
    if (mesh.parentId) {
      const parent = getWorldMatrix(mesh.parentId);
      const world = parent.clone().multiply(local);
      worldMatrixMap.set(id, world);
      return world;
    }
    worldMatrixMap.set(id, local);
    return local;
  };

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
  const dims = [gridRes, gridRes, gridRes] as const;

  // 3. Create Evaluator
  const evaluate = createSDFEvaluator(meshes, blendStrength);

  // Arrays
  const values = new Float32Array((dims[0] + 1) * (dims[1] + 1) * (dims[2] + 1));
  const probe = new THREE.Vector3();

  for (let z = 0; z <= dims[2]; z++) {
    for (let y = 0; y <= dims[1]; y++) {
      for (let x = 0; x <= dims[0]; x++) {
        probe.set(box.min.x + x * step.x, box.min.y + y * step.y, box.min.z + z * step.z);
        const d = evaluate(probe);
        const i = x + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        values[i] = d;
      }
    }
  }

  const vertices: number[] = [];
  const indices: number[] = [];
  const quads: number[] = []; // (v0,v1,v2,v3) loop order

  // Wireframe (quad edges only, deduped)
  const edgeSet = new Set<string>();
  const wireframeIndices: number[] = [];
  const addEdge = (a: number, b: number) => {
    const i0 = Math.min(a, b);
    const i1 = Math.max(a, b);
    const key = `${i0},${i1}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    wireframeIndices.push(i0, i1);
  };

  const cellToVertMap = new Map<number, number>();

  // Find Surface Vertices (Surface Nets)
  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        // Get 8 corner values
        const i000 = x + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i100 = x + 1 + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i010 = x + (y + 1) * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i110 = x + 1 + (y + 1) * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i001 = x + y * (dims[0] + 1) + (z + 1) * (dims[0] + 1) * (dims[1] + 1);
        const i101 = x + 1 + y * (dims[0] + 1) + (z + 1) * (dims[0] + 1) * (dims[1] + 1);
        const i011 = x + (y + 1) * (dims[0] + 1) + (z + 1) * (dims[0] + 1) * (dims[1] + 1);
        const i111 = x + 1 + (y + 1) * (dims[0] + 1) + (z + 1) * (dims[0] + 1) * (dims[1] + 1);

        const v000 = values[i000];
        const v100 = values[i100];
        const v010 = values[i010];
        const v110 = values[i110];
        const v001 = values[i001];
        const v101 = values[i101];
        const v011 = values[i011];
        const v111 = values[i111];

        const mask =
          (v000 > 0 ? 1 : 0) |
          (v100 > 0 ? 2 : 0) |
          (v010 > 0 ? 4 : 0) |
          (v110 > 0 ? 8 : 0) |
          (v001 > 0 ? 16 : 0) |
          (v101 > 0 ? 32 : 0) |
          (v011 > 0 ? 64 : 0) |
          (v111 > 0 ? 128 : 0);

        if (mask === 0 || mask === 255) continue;

        let sumX = 0,
          sumY = 0,
          sumZ = 0,
          count = 0;

        const interp = (valA: number, valB: number, posA: number, posB: number) =>
          posA + (valA / (valA - valB)) * (posB - posA);

        // Edges X
        const x0 = box.min.x + x * step.x;
        const x1 = x0 + step.x;
        if ((v000 > 0) !== (v100 > 0)) {
          sumX += interp(v000, v100, x0, x1);
          sumY += box.min.y + y * step.y;
          sumZ += box.min.z + z * step.z;
          count++;
        }
        if ((v010 > 0) !== (v110 > 0)) {
          sumX += interp(v010, v110, x0, x1);
          sumY += box.min.y + (y + 1) * step.y;
          sumZ += box.min.z + z * step.z;
          count++;
        }
        if ((v001 > 0) !== (v101 > 0)) {
          sumX += interp(v001, v101, x0, x1);
          sumY += box.min.y + y * step.y;
          sumZ += box.min.z + (z + 1) * step.z;
          count++;
        }
        if ((v011 > 0) !== (v111 > 0)) {
          sumX += interp(v011, v111, x0, x1);
          sumY += box.min.y + (y + 1) * step.y;
          sumZ += box.min.z + (z + 1) * step.z;
          count++;
        }

        // Edges Y
        const y0 = box.min.y + y * step.y;
        const y1 = y0 + step.y;
        if ((v000 > 0) !== (v010 > 0)) {
          sumX += box.min.x + x * step.x;
          sumY += interp(v000, v010, y0, y1);
          sumZ += box.min.z + z * step.z;
          count++;
        }
        if ((v100 > 0) !== (v110 > 0)) {
          sumX += box.min.x + (x + 1) * step.x;
          sumY += interp(v100, v110, y0, y1);
          sumZ += box.min.z + z * step.z;
          count++;
        }
        if ((v001 > 0) !== (v011 > 0)) {
          sumX += box.min.x + x * step.x;
          sumY += interp(v001, v011, y0, y1);
          sumZ += box.min.z + (z + 1) * step.z;
          count++;
        }
        if ((v101 > 0) !== (v111 > 0)) {
          sumX += box.min.x + (x + 1) * step.x;
          sumY += interp(v101, v111, y0, y1);
          sumZ += box.min.z + (z + 1) * step.z;
          count++;
        }

        // Edges Z
        const z0 = box.min.z + z * step.z;
        const z1 = z0 + step.z;
        if ((v000 > 0) !== (v001 > 0)) {
          sumX += box.min.x + x * step.x;
          sumY += box.min.y + y * step.y;
          sumZ += interp(v000, v001, z0, z1);
          count++;
        }
        if ((v100 > 0) !== (v101 > 0)) {
          sumX += box.min.x + (x + 1) * step.x;
          sumY += box.min.y + y * step.y;
          sumZ += interp(v100, v101, z0, z1);
          count++;
        }
        if ((v010 > 0) !== (v011 > 0)) {
          sumX += box.min.x + x * step.x;
          sumY += box.min.y + (y + 1) * step.y;
          sumZ += interp(v010, v011, z0, z1);
          count++;
        }
        if ((v110 > 0) !== (v111 > 0)) {
          sumX += box.min.x + (x + 1) * step.x;
          sumY += box.min.y + (y + 1) * step.y;
          sumZ += interp(v110, v111, z0, z1);
          count++;
        }

        if (count > 0) {
          vertices.push(sumX / count, sumY / count, sumZ / count);
          cellToVertMap.set(x + y * dims[0] + z * dims[0] * dims[1], vertices.length / 3 - 1);
        }
      }
    }
  }

  // For winding correction (cheap + robust for boolean blends)
  const normalEps = Math.max(avgStep * 0.35, 1e-4);
  const inv2nEps = 1.0 / (2.0 * normalEps);
  const nProbe = new THREE.Vector3();
  const nGrad = new THREE.Vector3();
  const center = new THREE.Vector3();
  const sdfNormal = (x: number, y: number, z: number, out: THREE.Vector3) => {
    nProbe.set(x + normalEps, y, z);
    const dx1 = evaluate(nProbe);
    nProbe.set(x - normalEps, y, z);
    const dx0 = evaluate(nProbe);

    nProbe.set(x, y + normalEps, z);
    const dy1 = evaluate(nProbe);
    nProbe.set(x, y - normalEps, z);
    const dy0 = evaluate(nProbe);

    nProbe.set(x, y, z + normalEps);
    const dz1 = evaluate(nProbe);
    nProbe.set(x, y, z - normalEps);
    const dz0 = evaluate(nProbe);

    out.set((dx1 - dx0) * inv2nEps, (dy1 - dy0) * inv2nEps, (dz1 - dz0) * inv2nEps);
    const len = out.length();
    if (len > 1e-12) out.multiplyScalar(1 / len);
    return out;
  };

  // Create quads & wireframes
  const addQuad = (c0: number, c1: number, c2: number, c3: number, flipHint: boolean) => {
    const v0 = cellToVertMap.get(c0);
    const v1 = cellToVertMap.get(c1);
    const v2 = cellToVertMap.get(c2);
    const v3 = cellToVertMap.get(c3);
    if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) return;

    // Surface nets standard loop order depends on axis/sign. We'll start from the previous behavior.
    // - If flipHint: v0 -> v1 -> v3 -> v2
    // - Else:      v0 -> v2 -> v3 -> v1
    let q0 = v0,
      q1 = flipHint ? v1 : v2,
      q2 = v3,
      q3 = flipHint ? v2 : v1;

    // Winding correction using SDF gradient at quad center.
    // This prevents occasional inside-out faces when blending/booleans are complex.
    const ax = vertices[q0 * 3],
      ay = vertices[q0 * 3 + 1],
      az = vertices[q0 * 3 + 2];
    const bx = vertices[q1 * 3],
      by = vertices[q1 * 3 + 1],
      bz = vertices[q1 * 3 + 2];
    const cx = vertices[q2 * 3],
      cy = vertices[q2 * 3 + 1],
      cz = vertices[q2 * 3 + 2];
    const dx = vertices[q3 * 3],
      dy = vertices[q3 * 3 + 1],
      dz = vertices[q3 * 3 + 2];

    center.set((ax + bx + cx + dx) * 0.25, (ay + by + cy + dy) * 0.25, (az + bz + cz + dz) * 0.25);
    sdfNormal(center.x, center.y, center.z, nGrad);

    // Triangle normal for (q0,q1,q2)
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    if (fnx * nGrad.x + fny * nGrad.y + fnz * nGrad.z < 0) {
      // Reverse loop: q0 -> q3 -> q2 -> q1
      const t = q1;
      q1 = q3;
      q3 = t;
    }

    // Store quad loop
    quads.push(q0, q1, q2, q3);

    // Triangulate (two triangles, diagonal q0-q2)
    indices.push(q0, q1, q2, q0, q2, q3);

    // Quad wireframe edges (no diagonals)
    addEdge(q0, q1);
    addEdge(q1, q2);
    addEdge(q2, q3);
    addEdge(q3, q0);
  };

  // X-axis quads
  for (let z = 1; z < dims[2]; z++)
    for (let y = 1; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const i0 = x + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i1 = x + 1 + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        if ((values[i0] > 0) !== (values[i1] > 0)) {
          addQuad(
            x + (y - 1) * dims[0] + (z - 1) * dims[0] * dims[1],
            x + y * dims[0] + (z - 1) * dims[0] * dims[1],
            x + (y - 1) * dims[0] + z * dims[0] * dims[1],
            x + y * dims[0] + z * dims[0] * dims[1],
            values[i0] > 0
          );
        }
      }

  // Y-axis quads
  for (let z = 1; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 1; x < dims[0]; x++) {
        const i0 = x + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i1 = x + (y + 1) * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        if ((values[i0] > 0) !== (values[i1] > 0)) {
          // Note: we keep the original flip hint behavior but fix winding with sdfNormal anyway.
          addQuad(
            x - 1 + y * dims[0] + (z - 1) * dims[0] * dims[1],
            x + y * dims[0] + (z - 1) * dims[0] * dims[1],
            x - 1 + y * dims[0] + z * dims[0] * dims[1],
            x + y * dims[0] + z * dims[0] * dims[1],
            values[i0] < 0
          );
        }
      }

  // Z-axis quads
  for (let z = 0; z < dims[2]; z++)
    for (let y = 1; y < dims[1]; y++)
      for (let x = 1; x < dims[0]; x++) {
        const i0 = x + y * (dims[0] + 1) + z * (dims[0] + 1) * (dims[1] + 1);
        const i1 = x + y * (dims[0] + 1) + (z + 1) * (dims[0] + 1) * (dims[1] + 1);
        if ((values[i0] > 0) !== (values[i1] > 0)) {
          addQuad(
            x - 1 + (y - 1) * dims[0] + z * dims[0] * dims[1],
            x + (y - 1) * dims[0] + z * dims[0] * dims[1],
            x - 1 + y * dims[0] + z * dims[0] * dims[1],
            x + y * dims[0] + z * dims[0] * dims[1],
            values[i0] > 0
          );
        }
      }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.Float32BufferAttribute(vertices, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Quad wireframe uses the SAME position attribute so it follows refineMesh updates automatically.
  const wireframeGeo = new THREE.BufferGeometry();
  wireframeGeo.setAttribute('position', positionAttribute);
  wireframeGeo.setIndex(wireframeIndices);

  geometry.userData.quadWireframe = wireframeGeo;
  geometry.userData.quads = quads; // loop indices (4 per quad)

  // 4. Apply Smart Retopology if requested
  if (smartRetopo) {
    const bones = extractBones(meshes);
    refineMesh(geometry, evaluate, bones, avgStep);
  }

  return geometry;
};
