import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, ContactShadows, Grid, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { QuadSphere } from './QuadSphere';
import { useStore } from '../store';

// Helper component to expose scene interaction to the UI logic
const SceneContent = () => {
  const meshes = useStore((state) => state.meshes);
  
  // Find roots: nodes with no parent OR nodes whose parent doesn't exist in the current list
  const roots = meshes.filter(m => 
    !m.parentId || !meshes.find(p => p.id === m.parentId)
  );

  return (
    <group>
      {roots.map((mesh) => (
        <QuadSphere key={mesh.id} data={mesh} />
      ))}
    </group>
  );
};

// GLOBAL GIZMO MANAGER
// This component lives at the scene root and attaches the gizmo to the selected object
// by finding it in the scene graph by name (ID). This avoids nesting issues.
const GizmoManager = () => {
    const selectedMeshId = useStore(state => state.selectedMeshId);
    const transformMode = useStore(state => state.transformMode);
    const updateMesh = useStore(state => state.updateMesh);
    const { scene } = useThree();
    const [target, setTarget] = useState<THREE.Object3D | null>(null);

    // Watch selection and find corresponding THREE object
    useEffect(() => {
        if (!selectedMeshId) {
            setTarget(null);
            return;
        }

        // Try finding it immediately
        let obj = scene.getObjectByName(selectedMeshId);
        
        if (obj) {
            setTarget(obj);
        } else {
            // If not found (React render lag), retry briefly
            const interval = setInterval(() => {
                obj = scene.getObjectByName(selectedMeshId);
                if (obj) {
                    setTarget(obj);
                    clearInterval(interval);
                }
            }, 50);
            
            // Timeout to stop looking
            const timeout = setTimeout(() => clearInterval(interval), 1000);
            return () => { clearInterval(interval); clearTimeout(timeout); }
        }
    }, [selectedMeshId, scene]);

    const handleTransformChange = useCallback(() => {
        if (target) {
            // For groups (guides), 'target' is the group.
            // For procedure mesh, 'target' is the mesh.
            // In both cases, we read the local transform which is what we store.
            
            const pos = target.position.toArray();
            const rot = target.rotation.toArray().slice(0, 3) as [number, number, number];
            const scale = target.scale.x; // Uniform scale assumption

            updateMesh(target.name, {
                position: pos,
                rotation: rot,
                scale: scale
            });
        }
    }, [target, updateMesh]);

    // If we have a target, render controls attached to it
    // We attach to 'target' but the controls themselves are rendered here (Scene root)
    return target ? (
        <TransformControls
            object={target}
            mode={transformMode}
            onObjectChange={handleTransformChange}
            size={0.8}
            space="local" // Local space usually feels better for hierarchical editing
        />
    ) : null;
};

export const Scene = () => {
  const selectMesh = useStore((state) => state.selectMesh);

  return (
    <Canvas 
      shadows 
      className="bg-zinc-900"
      onPointerMissed={(e) => {
        if (e.type === 'click') {
          selectMesh(null);
        }
      }}
    >
      <PerspectiveCamera makeDefault position={[4, 2, 5]} fov={50} />
      <OrbitControls makeDefault minDistance={2} maxDistance={20} />
      
      {/* Lighting to simulate a studio environment */}
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="teal" />
      
      {/* Environment reflection */}
      <Environment preset="city" />

      <SceneContent />
      
      {/* Gizmo is rendered at root level to ensure correct pivot alignment regardless of nesting */}
      <GizmoManager />

      {/* Floor and Shadows */}
      <Grid 
        infiniteGrid 
        fadeDistance={30} 
        sectionColor="#444" 
        cellColor="#222" 
        position={[0, -2, 0]} 
      />
      <ContactShadows 
        position={[0, -2, 0]} 
        opacity={0.5} 
        scale={20} 
        blur={2} 
        far={4.5} 
      />
    </Canvas>
  );
};