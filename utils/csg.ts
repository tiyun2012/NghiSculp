import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { MeshNode } from '../store';
import { createQuadGeometry, rebuildGeometry } from './geometry';

// Re-export Evaluator for reuse
export const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];

// Recursively compute geometry for a mesh and its children
export const getRecursiveGeometry = (
    meshId: string, 
    meshes: MeshNode[], 
    resolution: number
): THREE.BufferGeometry => {
    const mesh = meshes.find(m => m.id === meshId);
    if (!mesh) return new THREE.BufferGeometry();

    // 1. Generate Base Geometry for the current node
    let geo: THREE.BufferGeometry;
    if (mesh.type === 'custom' && mesh.geometryData) {
        geo = rebuildGeometry(mesh.geometryData);
    } else {
        geo = createQuadGeometry(mesh.type, resolution);
    }

    // 2. Find Direct Children (active operators)
    const children = meshes.filter(m => m.parentId === meshId && m.visible !== false);
    
    // If no children, return the base geometry directly
    if (children.length === 0) return geo;

    // 3. Setup Parent Brush
    let rootBrush = new Brush(geo);
    rootBrush.updateMatrixWorld();

    // 4. Apply operations from children recursively
    for (const child of children) {
        // Recursively calculate the child's geometry (it might have its own booleans)
        const childGeo = getRecursiveGeometry(child.id, meshes, resolution);
        
        const childBrush = new Brush(childGeo);
        
        // Transform the child brush to be relative to the parent.
        // The geometry from getRecursiveGeometry is in the child's local space (centered).
        // We apply the child's transform relative to the parent.
        childBrush.position.set(...child.position);
        childBrush.rotation.set(...child.rotation);
        const s = child.scale;
        childBrush.scale.set(s, s, s);
        childBrush.updateMatrixWorld();

        // Map operation to CSG type
        let op = ADDITION; // Default 'union' to Addition (Solid Combine)
        if (child.operation === 'subtract') op = SUBTRACTION;
        else if (child.operation === 'intersect') op = INTERSECTION;

        // Perform CSG evaluation
        const previousGeometry = rootBrush.geometry;
        const result = evaluator.evaluate(rootBrush, childBrush, op);
        
        // Memory Cleanup:
        // 1. Dispose the child geometry recursively generated (we don't need it after bake)
        childGeo.dispose();
        
        // 2. Dispose the previous root geometry (whether it was the base 'geo' or a previous CSG result)
        // because 'result' is a new geometry that replaces it.
        previousGeometry.dispose();

        rootBrush = result;
    }
    
    console.log(`[CSG] Calculated procedure mesh for ${mesh.name || mesh.id} (${children.length} ops)`);

    return rootBrush.geometry;
};

// Kept for backward compatibility if needed, but wrapped to use the recursive one partially or simplified
export const computeBooleanGeometry = (
  parentData: MeshNode, 
  baseGeometry: THREE.BufferGeometry,
  children: MeshNode[],
  childGeometries: Map<string, THREE.BufferGeometry>
): THREE.BufferGeometry => {
    // This is a shallow version used previously. 
    // We map it to the new logic but manually reconstructing the context is hard without the full list.
    // Ideally, consumers should switch to getRecursiveGeometry.
    // For now, let's replicate the shallow logic using Brushes directly to support legacy calls if any.
    
    let rootBrush = new Brush(baseGeometry);
    rootBrush.updateMatrixWorld();

    for (const child of children) {
         const childGeo = childGeometries.get(child.id);
         if (!childGeo) continue;

         const childBrush = new Brush(childGeo);
         childBrush.position.set(...child.position);
         childBrush.rotation.set(...child.rotation);
         const s = child.scale;
         childBrush.scale.set(s, s, s);
         childBrush.updateMatrixWorld();

         let op = ADDITION;
         if (child.operation === 'subtract') op = SUBTRACTION;
         else if (child.operation === 'intersect') op = INTERSECTION;
         
         rootBrush = evaluator.evaluate(rootBrush, childBrush, op);
    }
    return rootBrush.geometry;
};