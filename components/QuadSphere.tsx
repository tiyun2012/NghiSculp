import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, MeshNode } from '../store';
import { createQuadWireframe } from '../utils/geometry';
import { getRecursiveGeometry } from '../utils/csg';

interface QuadMeshProps {
  data: MeshNode;
}

export const QuadSphere: React.FC<QuadMeshProps> = ({ data }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Store selectors
  const resolution = useStore((state) => state.resolution);
  const showWireframe = useStore((state) => state.showWireframe);
  const selectedMeshId = useStore((state) => state.selectedMeshId);
  const selectMesh = useStore((state) => state.selectMesh);
  const transformMode = useStore((state) => state.transformMode);
  const updateMesh = useStore((state) => state.updateMesh);
  const meshes = useStore((state) => state.meshes);

  // Get direct children for rendering in the scene graph
  const children = useMemo(() => 
    meshes.filter(m => m.parentId === data.id), 
    [meshes, data.id]
  );

  const isSelected = selectedMeshId === data.id;
  
  // In "Solid" mode:
  // - If a mesh has a parent, it contributes to the parent's shape and is rendered as a "Ghost/Controller"
  // - If a mesh has no parent (Root), it renders the final Result.
  const isChildModifier = !!data.parentId;

  // 1. Compute Geometry
  // We compute the *Recursive* geometry for this node.
  // If it's a root, this includes all children contributions.
  // If it's a child, this includes its own children contributions (if any), 
  // which is then used by the parent.
  // We use the full `meshes` array to allow the recursive function to walk the tree.
  const finalGeometry = useMemo(() => {
    // Only compute solid geometry if we are a root or needed for visualization
    const geo = getRecursiveGeometry(data.id, meshes, Math.max(2, Math.floor(resolution)));
    // Provide a way to identify it in debugger if needed
    geo.name = `Procedural_${data.name || data.type}_${data.id.slice(0,4)}`;
    return geo;
  }, [data.id, meshes, resolution, data.name, data.type]);

  // Ensure disposal of geometry when it changes or component unmounts
  useEffect(() => {
    return () => {
       finalGeometry.dispose();
    }
  }, [finalGeometry]);


  // 2. Wireframe for the "base" shape (before booleans) - mainly for Ghost mode
  const wireframeGeo = useMemo(() => {
    // If custom, we don't have a procedural wireframe
    if (data.type === 'custom') return null;
    return createQuadWireframe(data.type || 'sphere', Math.max(2, Math.floor(resolution)));
  }, [data.type, resolution]);


  // 3. Manage Result Wireframe Display (for Roots)
  const [displayWireframe, setDisplayWireframe] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!showWireframe || isChildModifier) {
        setDisplayWireframe(null);
        return;
    }

    // If result matches the procedural wireframe (no ops), use optimized one
    // We estimate this by checking if children count is 0
    const hasChildren = meshes.some(m => m.parentId === data.id && m.visible !== false);
    
    if (!hasChildren && wireframeGeo && data.type !== 'custom') {
        setDisplayWireframe(wireframeGeo);
        return;
    }

    // Otherwise, generate from CSG result
    const geo = new THREE.WireframeGeometry(finalGeometry);
    setDisplayWireframe(geo);

    return () => {
        geo.dispose();
    };
  }, [showWireframe, finalGeometry, wireframeGeo, isChildModifier, meshes, data.id, data.type]);


  const [hovered, setHover] = useState(false);

  const handleTransformChange = useCallback(() => {
    if (meshRef.current) {
      updateMesh(data.id, {
        position: meshRef.current.position.toArray(),
        rotation: meshRef.current.rotation.toArray().slice(0, 3) as [number, number, number],
        scale: meshRef.current.scale.x 
      });
    }
  }, [data.id, updateMesh]);

  if (data.visible === false) return null;

  // --- RENDER LOGIC ---

  // CASE A: Modifier / Child Node
  // Render as a semi-transparent ghost with wireframe to allow selection and manipulation.
  // The actual volume is added to the parent by the parent's CSG calculation.
  if (isChildModifier) {
      let color = "#888888";
      if (data.operation === 'union') color = "#4444ff"; // Blue for Add
      if (data.operation === 'subtract') color = "#ff4444"; // Red for Sub
      if (data.operation === 'intersect') color = "#44ff44"; // Green for Intersect

      return (
        <>
            {isSelected && (
                <TransformControls 
                  object={meshRef.current} 
                  mode={transformMode} 
                  onObjectChange={handleTransformChange}
                  size={0.8}
                  space="local" // Modifiers transform in local space
                />
            )}
            <mesh
                ref={meshRef}
                position={data.position}
                rotation={data.rotation}
                scale={[data.scale, data.scale, data.scale]}
                // For the ghost, we show the calculated geometry of this subtree
                // This lets you see what this specific part looks like
                geometry={finalGeometry} 
                onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
                onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
                onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
            >
                <meshBasicMaterial 
                    color={color} 
                    wireframe 
                    transparent 
                    opacity={isSelected ? 0.4 : 0.15} 
                    depthTest={false} // Always visible through parent
                />
                
                {/* Render children recursively so they also appear as ghosts if deeper in tree */}
                {children.map(child => <QuadSphere key={child.id} data={child} />)}
            </mesh>
        </>
      );
  }

  // CASE B: Root Node / Result
  // Render the full solid CSG result.
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
        onClick={(e) => {
          e.stopPropagation();
          selectMesh(data.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHover(false);
        }}
        geometry={finalGeometry}
        userData={{ isProceduralMesh: true, id: data.id }}
      >
        <meshMatcapMaterial 
          color={data.type === 'custom' ? "#d4d4d8" : (hovered ? "#ffab91" : "#e0e0e0")} 
          matcap={null}
        />
        <meshStandardMaterial
          color={isSelected ? "#bcaaa4" : "#9e9e9e"}
          roughness={0.4}
          metalness={0.1}
          polygonOffset
          polygonOffsetFactor={1}
        />

        {showWireframe && displayWireframe && (
          <lineSegments geometry={displayWireframe}>
            <lineBasicMaterial color="#222" opacity={0.35} transparent depthTest={true} />
          </lineSegments>
        )}

        {/* Render children. They will detect they are children and render as ghosts. */}
        {children.map(child => (
          <QuadSphere key={child.id} data={child} />
        ))}
      </mesh>
    </>
  );
};