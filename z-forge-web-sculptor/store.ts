import { create } from 'zustand';
import * as THREE from 'three';

export type MeshType = 'sphere' | 'cube' | 'capsule' | 'custom';
export type MeshOperation = 'union' | 'subtract' | 'intersect';

export const PROCEDURE_MESH_ID = 'PROCEDURE_MESH_ROOT';

export interface MeshNode {
  id: string;
  name?: string;
  type: MeshType;
  operation: MeshOperation;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  parentId: string | null;
  visible: boolean;
  locked?: boolean; // For the procedure mesh
  // For baked meshes
  geometryData?: {
    position: number[];
    index?: number[];
    normal?: number[];
  };
}

interface AppState {
  // Global Settings
  resolution: number;
  setResolution: (res: number) => void;
  
  smartRetopology: boolean;
  setSmartRetopology: (enabled: boolean) => void;

  blendStrength: number;
  setBlendStrength: (strength: number) => void;
  
  // Interaction Modes
  transformMode: 'translate' | 'rotate' | 'scale';
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  
  showWireframe: boolean;
  setShowWireframe: (show: boolean) => void;

  xrayMode: boolean;
  setXrayMode: (enabled: boolean) => void;

  // Mesh Data
  meshes: MeshNode[];
  selectedMeshId: string | null;
  addMesh: (mesh: MeshNode) => void;
  removeMesh: (id: string) => void;
  selectMesh: (id: string | null) => void;
  updateMesh: (id: string, updates: Partial<MeshNode>) => void;
  toggleVisibility: (id: string) => void;
  setParent: (childId: string, parentId: string | null) => void;
  resetScene: () => void;
}

// Helper to recursively find all descendants
const getDescendants = (meshes: MeshNode[], id: string): string[] => {
  const children = meshes.filter(m => m.parentId === id);
  let ids = children.map(c => c.id);
  children.forEach(c => {
    ids = [...ids, ...getDescendants(meshes, c.id)];
  });
  return ids;
};

const DEFAULT_PROCEDURE_MESH: MeshNode = {
    id: PROCEDURE_MESH_ID,
    name: 'Procedure Mesh',
    type: 'custom',
    operation: 'union',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    parentId: null,
    visible: true,
    locked: true
};

export const useStore = create<AppState>((set, get) => ({
  resolution: 8,
  setResolution: (resolution) => set({ resolution }),
  
  smartRetopology: false,
  setSmartRetopology: (smartRetopology) => set({ smartRetopology }),

  blendStrength: 0.5,
  setBlendStrength: (blendStrength) => set({ blendStrength }),
  
  transformMode: 'translate',
  setTransformMode: (transformMode) => set({ transformMode }),
  
  showWireframe: true,
  setShowWireframe: (showWireframe) => set({ showWireframe }),

  xrayMode: false,
  setXrayMode: (xrayMode) => set({ xrayMode }),

  meshes: [DEFAULT_PROCEDURE_MESH], 
  selectedMeshId: null,

  addMesh: (mesh) => set((state) => ({ 
    meshes: [...state.meshes, mesh],
    selectedMeshId: mesh.id 
  })),

  removeMesh: (id) => set((state) => {
    if (id === PROCEDURE_MESH_ID) return state; // Prevent deleting the main procedure mesh

    const idsToRemove = [id, ...getDescendants(state.meshes, id)];
    return {
      meshes: state.meshes.filter(m => !idsToRemove.includes(m.id)),
      selectedMeshId: state.selectedMeshId && idsToRemove.includes(state.selectedMeshId) ? null : state.selectedMeshId
    };
  }),
  
  selectMesh: (selectedMeshId) => set({ selectedMeshId }),
  
  updateMesh: (id, updates) => set((state) => ({
    meshes: state.meshes.map((m) => (m.id === id ? { ...m, ...updates } : m)),
  })),

  toggleVisibility: (id) => set((state) => ({
    meshes: state.meshes.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
  })),

  setParent: (childId, parentId) => set((state) => {
    // 1. Cannot parent to self
    if (childId === parentId) return state;

    // 2. Cannot parent to the locked Procedure Mesh
    if (parentId === PROCEDURE_MESH_ID) {
        console.warn("Cannot parent items to the Procedure Mesh container.");
        return state;
    }

    // 3. Cycle Detection
    let current = parentId;
    while (current) {
        if (current === childId) {
            console.warn("Cycle detected in hierarchy, aborting parent change.");
            return state;
        }
        const parent = state.meshes.find(m => m.id === current);
        current = parent ? parent.parentId : null;
    }

    return {
        meshes: state.meshes.map(m => m.id === childId ? { ...m, parentId } : m)
    };
  }),
  
  resetScene: () => set({
    meshes: [DEFAULT_PROCEDURE_MESH],
    selectedMeshId: null
  })
}));