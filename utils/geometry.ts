import * as THREE from 'three';
import { MeshType } from '../store';

type VertexModifier = (v: THREE.Vector3) => void;

// Modifiers
const sphereModifier = (radius: number): VertexModifier => (v) => {
  v.normalize().multiplyScalar(radius);
};

const cubeModifier = (size: number): VertexModifier => (v) => {
    // Default box is already a cube 1x1x1, just scale if needed
    // v is already in -0.5 to 0.5 range from BoxGeometry(1,1,1)
    // No change needed for unit cube
};

const capsuleModifier = (radius: number, height: number): VertexModifier => (v) => {
  // Capsule defined by a central segment along Y axis.
  // Segment from (0, -H/2, 0) to (0, H/2, 0)
  const halfHeight = height / 2;
  
  // Clamp point on axis segment
  const segmentY = Math.max(-halfHeight, Math.min(halfHeight, v.y * (height + radius * 2))); // Scale input Y to roughly match target size before projection
  const closestOnSegment = new THREE.Vector3(0, segmentY, 0);
  
  // Project vertex to surface: Closest point + Radius * Direction
  // However, for topology mapping from a Box, we want to ensure good distribution.
  // Simple Box -> Capsule mapping:
  
  // 1. Pretend Box is Sphere first (normalize direction)
  // 2. Map Sphere to Capsule
  
  // Optimized mapping:
  const temp = v.clone();
  
  // Naive projection causes bunching at poles if we don't adjust input box aspect ratio
  // We handle aspect ratio in the base geometry generation
  
  // Simple SDF projection
  // Point on segment:
  const pY = Math.max(-0.5, Math.min(0.5, v.y * 2)) * halfHeight; // Approximation
  const center = new THREE.Vector3(0, pY, 0);
  
  // This is tricky to get perfect distribution without a specialized base mesh.
  // Robust method: Project to line segment (-0.5, 0.5) * height
  // Then extend vector by radius.
  
  const lineP = new THREE.Vector3(0, Math.max(-halfHeight, Math.min(halfHeight, v.y * (height + 1))), 0);
  v.sub(lineP).normalize().multiplyScalar(radius).add(lineP);
};


// Factory to create geometry based on type
export const createQuadGeometry = (type: MeshType, resolution: number) => {
  let geometry: THREE.BoxGeometry;
  let modifier: VertexModifier;

  switch (type) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1, 1, 1, resolution, resolution, resolution);
      modifier = (v) => {}; // Identity
      break;
    case 'capsule':
      // Use taller box for capsule to prevent stretching faces too much
      const capsuleHeight = 1.0;
      const capsuleRadius = 0.5;
      const heightSegments = Math.floor(resolution * 1.5);
      geometry = new THREE.BoxGeometry(1, 2, 1, resolution, heightSegments, resolution);
      modifier = (v) => {
          // Project to capsule of radius 0.5, height 1.0 (between centers)
          const halfH = 0.5; // distance from center to pole center
          const axisPoint = new THREE.Vector3(0, Math.max(-halfH, Math.min(halfH, v.y * 2.5)), 0); 
          // v.y * 2.5 expands the input range slightly to ensure corners of box map to caps
          
          const dir = new THREE.Vector3().subVectors(v, axisPoint);
          dir.normalize().multiplyScalar(capsuleRadius);
          v.copy(axisPoint).add(dir);
      };
      break;
    case 'sphere':
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1, resolution, resolution, resolution);
      modifier = (v) => v.normalize().multiplyScalar(0.5); // Radius 0.5 for unit size 1
      break;
  }

  const posAttribute = geometry.attributes.position;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < posAttribute.count; i++) {
    vertex.fromBufferAttribute(posAttribute, i);
    modifier(vertex);
    posAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  geometry.computeVertexNormals();
  return geometry;
};

// Generic Wireframe Generator
export const createQuadWireframe = (type: MeshType, resolution: number) => {
  const vertices: number[] = [];
  const r = Math.floor(resolution);
  
  // Define dimensions based on type
  let rx = r, ry = r, rz = r;
  if (type === 'capsule') {
      ry = Math.floor(resolution * 1.5);
  }

  // Modifier function duplication (should be shared but for simplicity inlined for line generation)
  let modifier: VertexModifier = (v) => v.normalize().multiplyScalar(0.5); // Default Sphere
  
  if (type === 'cube') {
      modifier = (v) => {}; 
  } else if (type === 'capsule') {
      modifier = (v) => {
          const halfH = 0.5;
          const axisPoint = new THREE.Vector3(0, Math.max(-halfH, Math.min(halfH, v.y * 2.5)), 0);
          const dir = new THREE.Vector3().subVectors(v, axisPoint);
          dir.normalize().multiplyScalar(0.5);
          v.copy(axisPoint).add(dir);
      };
  }

  const pushLine = (v1: THREE.Vector3, v2: THREE.Vector3) => {
     modifier(v1);
     modifier(v2);
     vertices.push(v1.x, v1.y, v1.z);
     vertices.push(v2.x, v2.y, v2.z);
  };

  // Helper to generate grid lines for a face plane
  const generateFaceGrid = (
      uAxis: 'x'|'y'|'z', vAxis: 'x'|'y'|'z', wAxis: 'x'|'y'|'z', 
      wVal: number, 
      resU: number, resV: number
  ) => {
     // Scale factors for the box dimensions (Capsule starts as 1x2x1)
     const scale = new THREE.Vector3(1, type === 'capsule' ? 2 : 1, 1);

    // Lines along V (fixed U)
    for (let i = 0; i <= resU; i++) {
        const u = ((i / resU) - 0.5) * scale[uAxis];
        for (let j = 0; j < resV; j++) {
             const vStart = ((j / resV) - 0.5) * scale[vAxis];
             const vEnd = (((j + 1) / resV) - 0.5) * scale[vAxis];
             
             const p1 = new THREE.Vector3();
             p1[uAxis] = u; p1[vAxis] = vStart; p1[wAxis] = wVal * scale[wAxis];
             
             const p2 = new THREE.Vector3();
             p2[uAxis] = u; p2[vAxis] = vEnd; p2[wAxis] = wVal * scale[wAxis];
             
             pushLine(p1, p2);
        }
    }
    // Lines along U (fixed V)
    for (let i = 0; i <= resV; i++) {
        const v = ((i / resV) - 0.5) * scale[vAxis];
        for (let j = 0; j < resU; j++) {
             const uStart = ((j / resU) - 0.5) * scale[uAxis];
             const uEnd = (((j + 1) / resU) - 0.5) * scale[uAxis];
             
             const p1 = new THREE.Vector3();
             p1[uAxis] = uStart; p1[vAxis] = v; p1[wAxis] = wVal * scale[wAxis];
             
             const p2 = new THREE.Vector3();
             p2[uAxis] = uEnd; p2[vAxis] = v; p2[wAxis] = wVal * scale[wAxis];
             
             pushLine(p1, p2);
        }
    }
  };

  // +Z Front (vary x, y)
  generateFaceGrid('x', 'y', 'z', 0.5, rx, ry);
  // -Z Back
  generateFaceGrid('x', 'y', 'z', -0.5, rx, ry);
  // +X Right (vary z, y)
  generateFaceGrid('z', 'y', 'x', 0.5, rz, ry);
  // -X Left
  generateFaceGrid('z', 'y', 'x', -0.5, rz, ry);
  // +Y Top (vary x, z)
  generateFaceGrid('x', 'z', 'y', 0.5, rx, rz);
  // -Y Bottom
  generateFaceGrid('x', 'z', 'y', -0.5, rx, rz);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
};