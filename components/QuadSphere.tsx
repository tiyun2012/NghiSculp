import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, MeshNode } from '../store';
import { createQuadGeometry, createQuadWireframe } from '../utils/geometry';
import { computeBooleanGeometry } from '../utils/csg';

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

  // Get direct children
  const children = useMemo(() => 
    meshes.filter(m => m.parentId === data.id), 
    [meshes, data.id]
  );

  const isSelected = selectedMeshId === data.id;
  const isOperator = data.operation !== 'union';

  // 1. Generate Base Geometry (Procedural Box/Sphere/Capsule)
  const baseGeometry = useMemo(() => {
    return createQuadGeometry(data.type || 'sphere', Math.max(2, Math.floor(resolution)));
  }, [resolution, data.type]);

  // 2. Generate Base Wireframe (The nice quad grid)
  const proceduralWireframe = useMemo(() => {
    return createQuadWireframe(data.type || 'sphere', Math.max(2, Math.floor(resolution)));
  }, [resolution, data.type]);

  // 3. Compute Final Geometry via CSG
  const finalGeometry = useMemo(() => {
    // If we are a 'subtract' node, we render ourself as a ghost using base geometry.
    if (isOperator) return baseGeometry;

    // Identify operators among children
    // Filter out hidden operators so they don't affect the shape when hidden
    const activeOperators = children.filter(c => c.operation !== 'union' && c.visible !== false);
    
    if (activeOperators.length === 0) return baseGeometry;

    // Generate geoms for operators
    const opGeoms = new Map<string, THREE.BufferGeometry>();
    activeOperators.forEach(child => {
        const geo = createQuadGeometry(child.type || 'sphere', Math.max(2, Math.floor(resolution)));
        opGeoms.set(child.id, geo);
    });

    return computeBooleanGeometry(data, baseGeometry, activeOperators, opGeoms);
  }, [baseGeometry, children, resolution, isOperator, data]);

  // 4. Manage Wireframe Display
  const [displayWireframe, setDisplayWireframe] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!showWireframe) {
        setDisplayWireframe(null);
        return;
    }

    // If using the base geometry (no CSG), use the efficient procedural wireframe
    if (finalGeometry === baseGeometry) {
        setDisplayWireframe(proceduralWireframe);
        return;
    }

    // If CSG is active, generate a wireframe from the result.
    // We use WireframeGeometry to show the actual cut edges.
    const geo = new THREE.WireframeGeometry(finalGeometry);
    setDisplayWireframe(geo);

    return () => {
        geo.dispose();
    };
  }, [showWireframe, finalGeometry, baseGeometry, proceduralWireframe]);


  const [hovered, setHover] = useState(false);

  // Use useCallback to prevent thrashing
  const handleTransformChange = useCallback(() => {
    if (meshRef.current) {
      // Sync Three.js transform to Zustand store
      updateMesh(data.id, {
        position: meshRef.current.position.toArray(),
        rotation: meshRef.current.rotation.toArray().slice(0, 3) as [number, number, number],
        scale: meshRef.current.scale.x 
      });
    }
  }, [data.id, updateMesh]);

  // If hidden, render nothing
  if (data.visible === false) {
      return null;
  }

  // If this mesh is a "Subtract" operator, render it as a wireframe/ghost
  if (isOperator) {
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
                geometry={baseGeometry}
                onClick={(e) => { e.stopPropagation(); selectMesh(data.id); }}
                onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
                onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
            >
                <meshBasicMaterial 
                    color={data.operation === 'subtract' ? "#ff4444" : "#4444ff"} 
                    wireframe 
                    transparent 
                    opacity={0.3} 
                />
                 {/* Render children to support nested hierarchies */}
                {children.map(child => <QuadSphere key={child.id} data={child} />)}
            </mesh>
        </>
      );
  }

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
          color={hovered ? "#ffab91" : "#e0e0e0"} 
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
            <lineBasicMaterial color="#333" opacity={0.3} transparent depthTest={false} />
          </lineSegments>
        )}

        {children.map(child => (
          <QuadSphere key={child.id} data={child} />
        ))}
      </mesh>
    </>
  );
};