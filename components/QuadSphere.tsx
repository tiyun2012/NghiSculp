import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, MeshNode, PROCEDURE_MESH_ID } from '../store';
import { createQuadWireframe, createQuadGeometry } from '../utils/geometry';
import { generateIsosurfaceGeometry } from '../utils/sdf';

interface QuadMeshProps {
  data: MeshNode;
}

export const QuadSphere: React.FC<QuadMeshProps> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Store selectors
  const resolution = useStore((state) => state.resolution);
  const showWireframe = useStore((state) => state.showWireframe);
  const xrayMode = useStore((state) => state.xrayMode);
  const selectedMeshId = useStore((state) => state.selectedMeshId);
  const selectMesh = useStore((state) => state.selectMesh);
  const transformMode = useStore((state) => state.transformMode);
  const updateMesh = useStore((state) => state.updateMesh);
  const meshes = useStore((state) => state.meshes);

  const isProcedureMesh = data.id === PROCEDURE_MESH_ID;
  const isSelected = selectedMeshId === data.id;

  // -- LOGIC FOR PROCEDURE MESH --
  // It finds the first "Guide Root" and adopts its geometry and transform.
  const guideRoot = useMemo(() => {
    if (!isProcedureMesh) return null;
    // Find the first root that is NOT the procedure mesh itself
    return meshes.find(m => !m.parentId && m.id !== PROCEDURE_MESH_ID);
  }, [meshes, isProcedureMesh]);

  // Check if the hierarchy is simple (just the root) to optimize wireframe
  const isSimpleHierarchy = useMemo(() => {
     if (!guideRoot) return false;
     // Check if guideRoot has any children in the meshes list
     return !meshes.some(m => m.parentId === guideRoot.id);
  }, [meshes, guideRoot]);

  // -- LOGIC FOR GEOMETRY CALCULATION --
  const finalGeometry = useMemo(() => {
    // 1. If this is the Procedure Mesh, calculate geometry using Metaballs (SDF Surface Nets)
    if (isProcedureMesh) {
        if (!guideRoot) return new THREE.BufferGeometry(); // Empty if no inputs
        
        // Generate Metaball Mesh
        // This process uses the global resolution slider to control quality.
        const geo = generateIsosurfaceGeometry(meshes, Math.max(2, Math.floor(resolution)));
        geo.name = "Procedure_Metaball_Geo";
        return geo;
    }

    // 2. If this is a Guide Mesh (Sphere/Cube/etc)
    if (data.type === 'custom' && data.geometryData) {
       return new THREE.BoxGeometry(1,1,1);
    }
    
    // Just create the primitive for the guide. 
    // FIXED: Use a low constant resolution (4) for guide meshes so they are lightweight 
    // and don't reconstruct when the procedure resolution changes.
    return createQuadGeometry(data.type, 4);

  }, [data.id, data.type, data.geometryData, meshes, resolution, isProcedureMesh, guideRoot]);

  // Dispose geometry cleanup
  useEffect(() => {
    return () => { finalGeometry.dispose(); }
  }, [finalGeometry]);


  // -- WIREFRAME LOGIC --
  const wireframeGeo = useMemo(() => {
    if (data.type === 'custom') return null;
    // FIXED: Use low constant resolution for guide wireframes as well
    return createQuadWireframe(data.type || 'sphere', 4);
  }, [data.type]);
  
  const [displayWireframe, setDisplayWireframe] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
     // For Procedure Mesh: Use showWireframe toggle to generate wireframe from the complex geometry
     if (isProcedureMesh) {
         if (!showWireframe || !finalGeometry.getAttribute('position')) {
            setDisplayWireframe(null);
            return;
         }
         
         try {
            const geo = new THREE.EdgesGeometry(finalGeometry, 20); // 20 degree threshold
            setDisplayWireframe(geo);
            return () => geo.dispose();
         } catch (e) {
            console.warn("Failed to generate wireframe for procedure mesh", e);
            setDisplayWireframe(null);
         }
     } 
     // For Guide Mesh: We rely on the memoized wireframeGeo in render, no state needed.
  }, [showWireframe, finalGeometry, isProcedureMesh, isSimpleHierarchy, guideRoot, resolution]);


  // -- TRANSFORM SYNC FOR PROCEDURE MESH --
  // Procedure Mesh is world-aligned usually (0,0,0) because SDF is computed in world space.
  const renderPosition: [number,number,number] = isProcedureMesh ? [0,0,0] : data.position;
  const renderRotation: [number,number,number] = isProcedureMesh ? [0,0,0] : data.rotation;
  const renderScale = isProcedureMesh ? 1 : data.scale;


  // -- INTERACTION HANDLERS --
  const handleTransformChange = useCallback(() => {
    if (meshRef.current && !isProcedureMesh) {
      // With nested children, the matrix update of the parent handles visual movement of children.
      // We just need to update the parent's store state.
      updateMesh(data.id, {
        position: meshRef.current.position.toArray(),
        rotation: meshRef.current.rotation.toArray().slice(0, 3) as [number, number, number],
        scale: meshRef.current.scale.x 
      });
    }
  }, [data.id, updateMesh, isProcedureMesh]);

  const [hovered, setHover] = useState(false);

  // -- RENDER --
  
  if (data.visible === false) return null;

  // CASE 1: PROCEDURE MESH (OUTPUT)
  if (isProcedureMesh) {
      if (!guideRoot || !finalGeometry.getAttribute('position')) return null;

      return (
        <mesh
            position={renderPosition}
            rotation={renderRotation}
            scale={[renderScale, renderScale, renderScale]}
            geometry={finalGeometry}
            onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
        >
             <meshMatcapMaterial 
                color="#e0e0e0" 
                matcap={null}
            />
            <meshStandardMaterial
                color="#9e9e9e"
                roughness={0.4}
                metalness={0.1}
                polygonOffset
                polygonOffsetFactor={1}
            />
             {showWireframe && displayWireframe && (
                <lineSegments geometry={displayWireframe}>
                    <lineBasicMaterial color="#222" opacity={0.3} transparent depthTest={true} />
                </lineSegments>
            )}
        </mesh>
      );
  }

  // CASE 2: GUIDE MESH (INPUT)
  let color = "#888888"; // Default
  if (data.operation === 'subtract') color = "#ff4444"; 
  if (data.operation === 'intersect') color = "#44ff44";
  if (data.operation === 'union' && data.parentId) color = "#4444ff";

  const isGuideRoot = !data.parentId;
  if (isGuideRoot) color = "#ffffff";

  const shouldShowWireframe = (showWireframe || isSelected) && wireframeGeo;

  return (
    <>
        {isSelected && (
            <TransformControls 
                object={meshRef.current} 
                mode={transformMode} 
                onObjectChange={handleTransformChange}
                size={0.8}
            />
        )}
        <mesh
            ref={meshRef}
            position={data.position}
            rotation={data.rotation}
            scale={[data.scale, data.scale, data.scale]}
            geometry={finalGeometry} 
            onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
            onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
            onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
        >
            <meshStandardMaterial
                color={color} 
                roughness={0.5}
                metalness={0.1}
                transparent={xrayMode}
                opacity={xrayMode ? 0.3 : 1.0}
                depthWrite={!xrayMode}
                polygonOffset={xrayMode}
                polygonOffsetFactor={-1}
            />
            
            {shouldShowWireframe && (
                 <lineSegments geometry={wireframeGeo!}>
                    <lineBasicMaterial 
                        color={isSelected ? "#ffffff" : "#000000"} 
                        transparent 
                        opacity={isSelected ? 0.8 : 0.2} 
                        depthTest={false} 
                    />
                 </lineSegments>
            )}
            
            {/* RENDER CHILDREN INSIDE THE MESH TO INHERIT TRANSFORM */}
            {meshes.filter(m => m.parentId === data.id).map(child => (
                <QuadSphere key={child.id} data={child} />
            ))}
        </mesh>
    </>
  );
};