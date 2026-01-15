import React, { useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, ContactShadows, Grid } from '@react-three/drei';
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