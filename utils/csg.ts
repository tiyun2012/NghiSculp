import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { MeshNode } from '../store';
import { createQuadGeometry } from './geometry';

// Re-export Evaluator for reuse if needed, though we primarily use computeBoolean
export const evaluator = new Evaluator();
evaluator.useGroups = false;

// Compute the boolean result for a parent and its influencing children
export const computeBooleanGeometry = (
  parentData: MeshNode, 
  baseGeometry: THREE.BufferGeometry,
  children: MeshNode[],
  childGeometries: Map<string, THREE.BufferGeometry>
): THREE.BufferGeometry => {
  
  // Filter children that are operators
  const operators = children.filter(c => c.operation !== 'union');
  
  // If no subtractors/intersecters, return base
  if (operators.length === 0) return baseGeometry;

  // 1. Setup Parent Brush
  const rootBrush = new Brush(baseGeometry);
  rootBrush.updateMatrixWorld(); // Local identity

  // 2. Apply operations
  let resultBrush = rootBrush;

  for (const child of operators) {
     const childGeo = childGeometries.get(child.id);
     if (!childGeo) continue;

     const childBrush = new Brush(childGeo);
     
     // Position the child brush relative to the parent
     // Since child.position is local to parent, we can just apply it directly
     childBrush.position.set(...child.position);
     childBrush.rotation.set(...child.rotation);
     const s = child.scale;
     childBrush.scale.set(s, s, s);
     childBrush.updateMatrixWorld();

     let op = SUBTRACTION;
     if (child.operation === 'intersect') op = INTERSECTION;
     
     // Perform CSG
     const result = evaluator.evaluate(resultBrush, childBrush, op);
     resultBrush = result;
  }

  return resultBrush.geometry;
};