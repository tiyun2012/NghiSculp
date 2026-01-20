import { useEffect } from 'react';
import { useStore, MeshType, MeshOperation } from '../store';
import { v4 as uuidv4 } from 'uuid';

declare global {
  interface Window {
    zforge: any;
    ProceDureMeshAPI: any;
  }
}

export const ConsoleBridge = () => {
  useEffect(() => {
    // Defines the procedural API interface
    const api = {
      // Create a mesh with a specific boolean operation
      create: (type: MeshType, operation: MeshOperation = 'union', parentId?: string) => {
         const id = uuidv4();
         const newMesh = {
            id,
            name: 'Procedure Mesh',
            type,
            operation,
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: 1,
            parentId: parentId || null,
            visible: true
         };
         useStore.getState().addMesh(newMesh);
         console.log(`Created ${type} mesh: ${id}`);
         return id;
      },
      
      // Update the operation type of an existing mesh
      setOperation: (id: string, operation: MeshOperation) => {
         useStore.getState().updateMesh(id, { operation });
         console.log(`Mesh ${id} operation set to ${operation}`);
      },
      
      // Delete a mesh by ID
      delete: (id: string) => {
        useStore.getState().removeMesh(id);
        console.log(`Deleted mesh ${id}`);
      },

      hide: (id: string) => {
        useStore.getState().updateMesh(id, { visible: false });
        console.log(`Hidden mesh ${id}`);
      },

      show: (id: string) => {
        useStore.getState().updateMesh(id, { visible: true });
        console.log(`Shown mesh ${id}`);
      },

      toggle: (id: string) => {
        useStore.getState().toggleVisibility(id);
        const mesh = useStore.getState().meshes.find(m => m.id === id);
        console.log(`Toggled mesh ${id} visibility to ${mesh?.visible}`);
      },

      // Force a recalculation (handled by React state, but exposed for semantic API compliance)
      recalculate: (id: string) => {
         // In this reactive architecture, triggering a shallow update forces re-render
         const mesh = useStore.getState().meshes.find(m => m.id === id);
         if(mesh) {
             useStore.getState().updateMesh(id, { ...mesh });
             console.log(`Triggered recalculation for ${id}`);
         }
      },

      // Helper to setup a boolean subtraction quickly
      booleanSubtract: (targetId: string, cutterId: string) => {
         useStore.getState().setParent(cutterId, targetId);
         useStore.getState().updateMesh(cutterId, { operation: 'subtract' });
         console.log(`${cutterId} is now cutting ${targetId}`);
      },

      // Standard tools implementation
      move: (id: string, x: number, y: number, z: number) => {
          useStore.getState().updateMesh(id, { position: [x, y, z] });
          console.log(`Moved ${id} to ${x}, ${y}, ${z}`);
      },

      list: () => {
          const meshes = useStore.getState().meshes;
          console.table(meshes.map(m => ({ 
              id: m.id, 
              type: m.type, 
              op: m.operation, 
              parent: m.parentId,
              visible: m.visible !== false // Handle undefined as true
          })));
      }
    };

    window.ProceDureMeshAPI = api;

    // Initialize zforge object safely
    window.zforge = {
      // Map standard commands
      add: (type: MeshType = 'sphere', parentId?: string) => api.create(type, 'union', parentId),
      move: api.move,
      list: api.list,
      delete: api.delete,
      hide: api.hide,
      show: api.show,
      toggle: api.toggle,
      
      // Advanced/Alias commands
      setOp: api.setOperation,
      cut: api.booleanSubtract,
      
      help: () => {
        console.group('🛠️ Z-Forge API Help');
        console.log('--- Standard ---');
        console.log('zforge.add(type?, parentId?) -> id');
        console.log('zforge.move(id, x, y, z)');
        console.log('zforge.delete(id)');
        console.log('zforge.hide(id)');
        console.log('zforge.show(id)');
        console.log('zforge.toggle(id)');
        console.log('zforge.list()');
        console.log('--- Advanced / Boolean ---');
        console.log('zforge.setOp(id, op) - op: "union" | "subtract" | "intersect"');
        console.log('zforge.cut(targetId, cutterId)');
        console.groupEnd();
      }
    };
    
    return () => {
      // @ts-ignore
      delete window.zforge;
      // @ts-ignore
      delete window.ProceDureMeshAPI;
    };
  }, []);

  return null;
};