import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { TransformControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, MeshNode, PROCEDURE_MESH_ID } from '../store';
import { createQuadWireframe, createQuadGeometry, rebuildGeometry } from '../utils/geometry';
import { generateIsosurfaceGeometry } from '../utils/sdf';

interface QuadMeshProps {
  data: MeshNode;
}

export const QuadSphere: React.FC<QuadMeshProps> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Store selectors
  const resolution = useStore((state) => state.resolution);
  const smartRetopology = useStore((state) => state.smartRetopology);
  const blendStrength = useStore((state) => state.blendStrength);
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
  const guideRoot = useMemo(() => {
    if (!isProcedureMesh) return null;
    return meshes.find(m => !m.parentId && m.id !== PROCEDURE_MESH_ID);
  }, [meshes, isProcedureMesh]);

  const children = useMemo(() => meshes.filter(m => m.parentId === data.id), [meshes, data.id]);

  // -- LOGIC FOR GEOMETRY CALCULATION --
  const finalGeometry = useMemo(() => {
    if (isProcedureMesh) {
        if (!guideRoot) return new THREE.BufferGeometry();
        
        const geo = generateIsosurfaceGeometry(
            meshes, 
            Math.max(2, Math.floor(resolution)), 
            smartRetopology,
            blendStrength
        );
        geo.name = "Procedure_Metaball_Geo";
        return geo;
    }

    if (data.type === 'custom' && data.geometryData) {
       return rebuildGeometry(data.geometryData);
    }
    
    // Feature: Use global resolution for standard primitives
    return createQuadGeometry(data.type, resolution);

  }, [
      isProcedureMesh,
      data.type, 
      data.geometryData, 
      resolution, // Now updates when resolution changes
      isProcedureMesh ? meshes : null,
      isProcedureMesh ? guideRoot : null,
      isProcedureMesh ? smartRetopology : null,
      isProcedureMesh ? blendStrength : null
  ]);

  // Dispose geometry on unmount or change
  useEffect(() => {
    return () => { finalGeometry.dispose(); }
  }, [finalGeometry]);


  // -- WIREFRAME LOGIC --
  const wireframeGeo = useMemo(() => {
    if (data.type === 'custom') return null;
    return createQuadWireframe(data.type || 'sphere', resolution);
  }, [data.type, resolution]);
  
  const [displayWireframe, setDisplayWireframe] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
     if (isProcedureMesh) {
         if (!showWireframe || !finalGeometry.getAttribute('position')) {
            setDisplayWireframe(null);
            return;
         }
         
         // USE THE CUSTOM QUAD WIREFRAME FROM SDF GENERATOR IF AVAILABLE
         if (finalGeometry.userData.quadWireframe) {
             setDisplayWireframe(finalGeometry.userData.quadWireframe);
         } else {
             // Fallback
             try {
                const geo = new THREE.WireframeGeometry(finalGeometry);
                setDisplayWireframe(geo);
                return () => geo.dispose();
             } catch (e) {
                console.warn("Failed to generate wireframe", e);
                setDisplayWireframe(null);
             }
         }
     } 
  }, [showWireframe, finalGeometry, isProcedureMesh]);


  // -- TRANSFORM SYNC --
  const renderPosition: [number,number,number] = isProcedureMesh ? [0,0,0] : data.position;
  const renderRotation: [number,number,number] = isProcedureMesh ? [0,0,0] : data.rotation;
  const renderScale = isProcedureMesh ? 1 : data.scale;


  // -- INTERACTION --
  const handleTransformChange = useCallback(() => {
    if (meshRef.current && !isProcedureMesh) {
      const pos = meshRef.current.position.toArray();
      const rot = meshRef.current.rotation.toArray().slice(0, 3) as [number, number, number];
      const scale = meshRef.current.scale.x;

      updateMesh(data.id, {
        position: pos,
        rotation: rot,
        scale: scale 
      });
    }
  }, [data.id, updateMesh, isProcedureMesh]);

  const [hovered, setHover] = useState(false);

  // -- RENDER --
  // We no longer return null if !visible. We render the mesh invisibly to allow Gizmo interaction.
  
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
            visible={data.visible}
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
                    <lineBasicMaterial color="#111" opacity={0.3} transparent depthTest={true} />
                </lineSegments>
            )}
        </mesh>
      );
  }

  // CASE 2: GUIDE MESH (INPUT)
  let color = "#888888"; 
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
                object={meshRef.current as THREE.Object3D}
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
            visible={data.visible}
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
            
            {/* RENDER CHILDREN */}
            {children.map(child => (
                <group key={child.id}>
                    <Line 
                        points={[[0, 0, 0], child.position]} 
                        color="gray" 
                        opacity={0.5} 
                        transparent 
                        lineWidth={1} 
                    />
                    <QuadSphere data={child} />
                </group>
            ))}
        </mesh>
    </>
  );
};