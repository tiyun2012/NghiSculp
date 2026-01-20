import * as THREE from 'three';
import { MeshType } from '../store';

type VertexModifier = (v: THREE.Vector3) => void;

// Modifiers
const sphereModifier = (radius: number): VertexModifier => (v) => {
  v.normalize().multiplyScalar(radius);
};

const cubeModifier = (size: number): VertexModifier => (v) => {
    // Default box is already a cube 1x1x1, just scale if needed
};

const capsuleModifier = (radius: number, height: number): VertexModifier => (v) => {
  const halfHeight = height / 2;
  const segmentY = Math.max(-halfHeight, Math.min(halfHeight, v.y * (height + radius * 2))); 
  const closestOnSegment = new THREE.Vector3(0, segmentY, 0);
  
  const halfH = 0.5; 
  const axisPoint = new THREE.Vector3(0, Math.max(-halfH, Math.min(halfH, v.y * 2.5)), 0); 
  
  const dir = new THREE.Vector3().subVectors(v, axisPoint);
  dir.normalize().multiplyScalar(radius);
  v.copy(axisPoint).add(dir);
};


// Factory to create geometry based on type
export const createQuadGeometry = (type: MeshType, resolution: number) => {
  if (type === 'custom') {
      return new THREE.BoxGeometry(1,1,1); // Fallback if called incorrectly
  }

  let geometry: THREE.BoxGeometry;
  let modifier: VertexModifier;

  switch (type) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1, 1, 1, resolution, resolution, resolution);
      modifier = (v) => {}; // Identity
      break;
    case 'capsule':
      const heightSegments = Math.floor(resolution * 1.5);
      geometry = new THREE.BoxGeometry(1, 2, 1, resolution, heightSegments, resolution);
      modifier = (v) => {
          const halfH = 0.5;
          const axisPoint = new THREE.Vector3(0, Math.max(-halfH, Math.min(halfH, v.y * 2.5)), 0); 
          const dir = new THREE.Vector3().subVectors(v, axisPoint);
          dir.normalize().multiplyScalar(0.5); // radius 0.5
          v.copy(axisPoint).add(dir);
      };
      break;
    case 'sphere':
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1, resolution, resolution, resolution);
      modifier = (v) => v.normalize().multiplyScalar(0.5); 
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

// Reconstruct geometry from saved data
export const rebuildGeometry = (data: { position: number[], index?: number[], normal?: number[] }) => {
    const geometry = new THREE.BufferGeometry();
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    
    if (data.normal && data.normal.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
    } else {
        geometry.computeVertexNormals();
    }
    
    if (data.index && data.index.length > 0) {
        geometry.setIndex(data.index);
    }
    
    return geometry;
};

// Serialize geometry for storage
export const serializeGeometry = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.attributes.position.array;
    const norm = geometry.attributes.normal?.array;
    const idx = geometry.index?.array;

    return {
        position: Array.from(pos),
        normal: norm ? Array.from(norm) : [],
        index: idx ? Array.from(idx) : []
    };
};

// Generic Wireframe Generator
export const createQuadWireframe = (type: MeshType, resolution: number) => {
  if (type === 'custom') return new THREE.BufferGeometry();

  const vertices: number[] = [];
  const r = Math.floor(resolution);
  
  let rx = r, ry = r, rz = r;
  if (type === 'capsule') {
      ry = Math.floor(resolution * 1.5);
  }

  let modifier: VertexModifier = (v) => v.normalize().multiplyScalar(0.5); 
  
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

  const generateFaceGrid = (
      uAxis: 'x'|'y'|'z', vAxis: 'x'|'y'|'z', wAxis: 'x'|'y'|'z', 
      wVal: number, 
      resU: number, resV: number
  ) => {
     const scale = new THREE.Vector3(1, type === 'capsule' ? 2 : 1, 1);

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

  generateFaceGrid('x', 'y', 'z', 0.5, rx, ry);
  generateFaceGrid('x', 'y', 'z', -0.5, rx, ry);
  generateFaceGrid('z', 'y', 'x', 0.5, rz, ry);
  generateFaceGrid('z', 'y', 'x', -0.5, rz, ry);
  generateFaceGrid('x', 'z', 'y', 0.5, rx, rz);
  generateFaceGrid('x', 'z', 'y', -0.5, rx, rz);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
};