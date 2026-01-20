import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { TransformControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, MeshNode, PROCEDURE_MESH_ID } from '../store';
import { createQuadWireframe, createQuadGeometry, rebuildGeometry } from '../utils/geometry';
import { generateIsosurfaceGeometry } from '../utils/sdf';

interface QuadMeshProps {
  data: MeshNode;
}

export const QuadSphere: React.FC<QuadMeshProps> = ({ data }) => {
  // We use a Group for the transform hierarchy to ensure children remain visible 
  // even if the visual geometry of this node is hidden.
  const [groupElement, setGroupElement] = useState<THREE.Group | null>(null);
  const [meshElement, setMeshElement] = useState<THREE.Mesh | null>(null);
  
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

  // -- HIERARCHY HELPERS --
  const children = useMemo(() => meshes.filter(m => m.parentId === data.id), [meshes, data.id]);
  
  const guideRoot = useMemo(() => {
    if (!isProcedureMesh) return null;
    return meshes.find(m => !m.parentId && m.id !== PROCEDURE_MESH_ID);
  }, [meshes, isProcedureMesh]);

  // -- GEOMETRY CALCULATION --
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
    
    return createQuadGeometry(data.type, resolution);

  }, [
      isProcedureMesh,
      data.type, 
      data.geometryData, 
      resolution, 
      isProcedureMesh ? meshes : null,
      isProcedureMesh ? guideRoot : null,
      isProcedureMesh ? smartRetopology : null,
      isProcedureMesh ? blendStrength : null
  ]);

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
         if (finalGeometry.userData.quadWireframe) {
             setDisplayWireframe(finalGeometry.userData.quadWireframe);
         } else {
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
  }, [showWireframe, finalGeometry, isProcedureMesh, resolution]);


  // -- TRANSFORM SYNC --
  const handleTransformChange = useCallback(() => {
    // If Procedure Mesh, we track the meshElement (it has no group usually)
    // If Guide Mesh, we track the groupElement (the hierarchy anchor)
    const target = isProcedureMesh ? meshElement : groupElement;

    if (target && !isProcedureMesh) {
      const pos = target.position.toArray();
      const rot = target.rotation.toArray().slice(0, 3) as [number, number, number];
      const scale = target.scale.x;

      updateMesh(data.id, {
        position: pos,
        rotation: rot,
        scale: scale 
      });
    }
  }, [data.id, updateMesh, isProcedureMesh, groupElement, meshElement]);

  // -- VISIBILITY LOGIC --
  const isHidden = data.visible === false;
  
  // "Ghost Mode": If selected but hidden, show it as transparent so we can see what we edit.
  // Otherwise, obey isHidden.
  const showVisuals = !isHidden || isSelected;

  // Material settings
  const opacity = isHidden ? 0.15 : (xrayMode ? 0.3 : 1.0);
  const transparent = isHidden || xrayMode;
  const depthWrite = !isHidden && !xrayMode; // Don't write depth if hidden/xray to see through

  // -- RENDER: PROCEDURE MESH (SPECIAL CASE) --
  if (isProcedureMesh) {
      if (!guideRoot || !finalGeometry.getAttribute('position')) return null;

      // If strictly hidden and not selected, don't render.
      // But usually procedure mesh is the "result", so we might want to respect visible=false strictly?
      // Let's allow ghosting here too for consistency.
      if (!showVisuals) return null;

      return (
        <mesh
            ref={setMeshElement}
            position={[0,0,0]} // Procedure mesh is always at origin of scene
            rotation={[0,0,0]}
            scale={[1,1,1]}
            geometry={finalGeometry}
            onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
            visible={true} 
        >
             <meshMatcapMaterial 
                color="#e0e0e0" 
                matcap={null}
                opacity={opacity}
                transparent={transparent}
            />
            <meshStandardMaterial
                color="#9e9e9e"
                roughness={0.4}
                metalness={0.1}
                polygonOffset
                polygonOffsetFactor={1}
                opacity={opacity}
                transparent={transparent}
            />
             {showWireframe && displayWireframe && !isHidden && (
                <lineSegments geometry={displayWireframe}>
                    <lineBasicMaterial color="#111" opacity={0.3} transparent depthTest={true} />
                </lineSegments>
            )}
        </mesh>
      );
  }

  // -- RENDER: GUIDE MESH (HIERARCHY NODE) --
  let color = "#888888"; 
  if (data.operation === 'subtract') color = "#ff4444"; 
  if (data.operation === 'intersect') color = "#44ff44";
  if (data.operation === 'union' && data.parentId) color = "#4444ff";
  const isGuideRoot = !data.parentId;
  if (isGuideRoot) color = "#ffffff";

  const shouldShowWireframe = (showWireframe || isSelected) && wireframeGeo;

  return (
    <>
        {/* GIZMO ATTACHES TO THE GROUP (TRANSFORM NODE) */}
        {isSelected && groupElement && (
            <TransformControls 
                object={groupElement}
                mode={transformMode} 
                onObjectChange={handleTransformChange}
                size={0.8}
            />
        )}
        
        {/* GROUP: TRANSFORM HIERARCHY (ALWAYS VISIBLE) */}
        <group
            ref={setGroupElement}
            position={data.position}
            rotation={data.rotation}
            scale={[data.scale, data.scale, data.scale]}
            visible={true} 
        >
            {/* VISUAL GEOMETRY (CAN BE GHOSTED) */}
            <mesh
                geometry={finalGeometry} 
                onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
                // We keep threejs 'visible' true so raycast works, but use opacity for visual hiding
                visible={showVisuals}
            >
                <meshStandardMaterial
                    color={color} 
                    roughness={0.5}
                    metalness={0.1}
                    transparent={transparent}
                    opacity={opacity}
                    depthWrite={depthWrite}
                    polygonOffset={xrayMode}
                    polygonOffsetFactor={-1}
                />
                
                {shouldShowWireframe && (
                     <lineSegments geometry={wireframeGeo!}>
                        <lineBasicMaterial 
                            color={isSelected ? "#ffffff" : "#000000"} 
                            transparent 
                            opacity={isHidden ? 0.2 : (isSelected ? 0.8 : 0.2)} 
                            depthTest={false} 
                        />
                     </lineSegments>
                )}
            </mesh>
            
            {/* CHILDREN (Always rendered inside group to inherit transform) */}
            {children.map(child => (
                <QuadSphere key={child.id} data={child} />
            ))}

            {/* CONNECTION LINES (Visual aid for hierarchy) */}
            {children.map(child => (
                 <Line 
                    key={`line-${child.id}`}
                    points={[[0, 0, 0], child.position]} 
                    color="gray" 
                    opacity={0.3} 
                    transparent 
                    lineWidth={1} 
                />
            ))}
        </group>
    </>
  );
};