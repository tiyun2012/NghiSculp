import { create } from 'zustand';
import * as THREE from 'three';

export type MeshType = 'sphere' | 'cube' | 'capsule';
export type MeshOperation = 'union' | 'subtract' | 'intersect';

export interface MeshNode {
  id: string;
  type: MeshType;
  operation: MeshOperation;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  parentId: string | null;
  visible: boolean;
}

interface AppState {
  // Global Settings
  resolution: number;
  setResolution: (res: number) => void;
  
  // Interaction Modes
  transformMode: 'translate' | 'rotate' | 'scale';
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  
  showWireframe: boolean;
  setShowWireframe: (show: boolean) => void;

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

export const useStore = create<AppState>((set, get) => ({
  resolution: 8,
  setResolution: (resolution) => set({ resolution }),
  
  transformMode: 'translate',
  setTransformMode: (transformMode) => set({ transformMode }),
  
  showWireframe: true,
  setShowWireframe: (showWireframe) => set({ showWireframe }),

  meshes: [], 
  selectedMeshId: null,

  addMesh: (mesh) => set((state) => ({ 
    meshes: [...state.meshes, mesh],
    selectedMeshId: mesh.id 
  })),

  removeMesh: (id) => set((state) => {
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

    // 2. Cycle Detection: Walk up from new parent. If we hit child, it's a cycle.
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
    meshes: [],
    selectedMeshId: null
  })
}));