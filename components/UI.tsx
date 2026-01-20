import React, { useState } from 'react';
import { useStore, MeshNode, MeshType, MeshOperation, PROCEDURE_MESH_ID } from '../store';
import { 
  Move, 
  RotateCw, 
  Maximize, 
  Trash2, 
  Zap, 
  Layers, 
  GitMerge,
  Box as BoxIcon,
  Circle,
  Cylinder,
  Scissors,
  Combine,
  Crosshair,
  Save,
  Scan
} from 'lucide-react';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { SceneGraph } from './SceneGraph';
import { generateIsosurfaceGeometry } from '../utils/sdf';
import { serializeGeometry } from '../utils/geometry';

export const UI = () => {
  const resolution = useStore(state => state.resolution);
  const setResolution = useStore(state => state.setResolution);
  const transformMode = useStore(state => state.transformMode);
  const setTransformMode = useStore(state => state.setTransformMode);
  const showWireframe = useStore(state => state.showWireframe);
  const setShowWireframe = useStore(state => state.setShowWireframe);
  const xrayMode = useStore(state => state.xrayMode);
  const setXrayMode = useStore(state => state.setXrayMode);
  const meshes = useStore(state => state.meshes);
  const addMesh = useStore(state => state.addMesh);
  const removeMesh = useStore(state => state.removeMesh);
  const updateMesh = useStore(state => state.updateMesh);
  const resetScene = useStore(state => state.resetScene);
  const selectedMeshId = useStore(state => state.selectedMeshId);

  const selectedMesh = meshes.find(m => m.id === selectedMeshId);

  const [isGenerating, setIsGenerating] = useState(false);

  // Generic add mesh function
  const handleAddMesh = (type: MeshType) => {
    // Determine parent. If selected is ProcedureMesh, force null (new root).
    // If selected is a Guide, parent to it.
    let targetParentId = selectedMeshId;
    if (targetParentId === PROCEDURE_MESH_ID) {
        targetParentId = null;
    }

    const newMesh: MeshNode = {
      id: uuidv4(),
      name: 'Guide Mesh',
      type: type,
      operation: 'union',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      parentId: targetParentId || null, 
      visible: true
    };
    addMesh(newMesh);
  };

  const handleDeleteSelected = () => {
    if (selectedMeshId && selectedMeshId !== PROCEDURE_MESH_ID) {
      removeMesh(selectedMeshId);
    }
  };

  const handleSetOperation = (op: MeshOperation) => {
      if (selectedMeshId && selectedMeshId !== PROCEDURE_MESH_ID) {
          updateMesh(selectedMeshId, { operation: op });
      }
  };

  const handleGrow = () => {
    // Only grow on Guide meshes
    if (meshes.length <= 1) return; // Only procedure mesh exists

    setIsGenerating(true);
    
    // Target the selected mesh, or fallback to the first GUIDE mesh
    let parentId = selectedMeshId;
    if (!parentId || parentId === PROCEDURE_MESH_ID) {
        const firstGuide = meshes.find(m => m.id !== PROCEDURE_MESH_ID);
        if (firstGuide) parentId = firstGuide.id;
        else {
            setIsGenerating(false);
            return;
        }
    }
    
    // Find parent object to calculate surface
    // Simplified: Just add a child with random offset
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    
    const normal = new THREE.Vector3(x, y, z);
    const localPos = normal.clone().multiplyScalar(0.5);
    const localScale = 0.15 + Math.random() * 0.25;
    
    const newMesh: MeshNode = {
      id: uuidv4(),
      name: 'Procedural Bump',
      type: 'sphere',
      operation: 'union',
      position: localPos.toArray() as [number, number, number],
      rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
      scale: localScale,
      parentId: parentId,
      visible: true
    };

    addMesh(newMesh);
    setTimeout(() => setIsGenerating(false), 100);
  };

  const handleRingGen = () => {
    if (meshes.length <= 1) return;
    
    let parentId = selectedMeshId;
    if (!parentId || parentId === PROCEDURE_MESH_ID) {
        const firstGuide = meshes.find(m => m.id !== PROCEDURE_MESH_ID);
        if (firstGuide) parentId = firstGuide.id;
        else return;
    }

    const count = 6;
    const radiusOffset = 0.5; 
    
    for(let i=0; i<count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = Math.cos(angle) * radiusOffset;
        const z = Math.sin(angle) * radiusOffset;
        const localPos = new THREE.Vector3(x, 0, z);

        addMesh({
            id: uuidv4(),
            name: `Ring Cutter ${i+1}`,
            type: 'cube',
            operation: 'subtract',
            position: localPos.toArray() as [number, number, number],
            rotation: [0, Math.random() * Math.PI, 0],
            scale: 0.2,
            parentId: parentId,
            visible: true
        });
    }
  };

  const handleBake = () => {
      // Bake the Procedure Mesh Result into a new separate static mesh
      const guideRoot = meshes.find(m => !m.parentId && m.id !== PROCEDURE_MESH_ID);
      if (!guideRoot) return;

      setIsGenerating(true);
      
      requestAnimationFrame(() => {
          // Use the SDF generator for baking to match the visual
          const geo = generateIsosurfaceGeometry(meshes, Math.max(2, Math.floor(resolution)));
          const data = serializeGeometry(geo);
          
          const bakeId = uuidv4();
          addMesh({
              id: bakeId,
              name: 'Baked Metaball',
              type: 'custom',
              operation: 'union',
              position: [0,0,0], // SDF result is world-space
              rotation: [0,0,0],
              scale: 1,
              parentId: null, 
              visible: true,
              geometryData: data
          });
          
          geo.dispose();
          setIsGenerating(false);
      });
  };

  const isGuideSelected = selectedMeshId && selectedMeshId !== PROCEDURE_MESH_ID;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      {/* Top Header */}
      <div className="pointer-events-auto bg-zinc-900/90 backdrop-blur border border-zinc-800 p-4 rounded-xl shadow-2xl flex items-center gap-6 w-fit z-50">
        <div>
          <h1 className="text-zinc-100 font-bold text-lg tracking-tight">Z-Forge</h1>
          <p className="text-zinc-500 text-xs">Procedural Sculptor</p>
        </div>
        
        <div className="h-8 w-px bg-zinc-700 mx-2"></div>

        <div className="flex items-center gap-2">
           <button 
             onClick={() => setTransformMode('translate')}
             className={`p-2 rounded-lg transition-colors ${transformMode === 'translate' ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
             title="Translate"
           >
             <Move size={18} />
           </button>
           <button 
             onClick={() => setTransformMode('rotate')}
             className={`p-2 rounded-lg transition-colors ${transformMode === 'rotate' ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
             title="Rotate"
           >
             <RotateCw size={18} />
           </button>
           <button 
             onClick={() => setTransformMode('scale')}
             className={`p-2 rounded-lg transition-colors ${transformMode === 'scale' ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
             title="Scale"
           >
             <Maximize size={18} />
           </button>
        </div>

        <div className="h-8 w-px bg-zinc-700 mx-2"></div>

        <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider">Resolution</label>
                <input 
                    type="range" 
                    min="2" 
                    max="32" 
                    step="1"
                    value={resolution}
                    onChange={(e) => setResolution(parseInt(e.target.value))}
                    className="w-32 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
            </div>
            <button 
                onClick={() => setShowWireframe(!showWireframe)}
                className={`p-2 rounded-lg border transition-all ${showWireframe ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                title="Toggle Wireframe"
            >
                <Layers size={18} />
            </button>
            <button 
                onClick={() => setXrayMode(!xrayMode)}
                className={`p-2 rounded-lg border transition-all ${xrayMode ? 'border-teal-500 bg-teal-500/10 text-teal-400' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                title="Toggle X-Ray"
            >
                <Scan size={18} />
            </button>
        </div>

        <div className="h-8 w-px bg-zinc-700 mx-2"></div>

        <button 
           onClick={handleDeleteSelected}
           disabled={!isGuideSelected}
           className="p-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
           title="Delete Selected"
        >
           <Trash2 size={18} />
        </button>
      </div>

      {/* Left Sidebar: Scene Graph */}
      <div className="pointer-events-auto absolute left-4 top-24 bottom-24 flex flex-col gap-3">
         <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 p-3 rounded-xl shadow-2xl w-64 h-full flex flex-col">
             <SceneGraph />
         </div>
      </div>

      {/* Right Sidebar: Tools */}
      <div className="pointer-events-auto absolute right-4 top-24 flex flex-col gap-3">
         <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 p-3 rounded-xl shadow-2xl flex flex-col gap-3 w-48">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Add Primitives</h2>
            
            <button onClick={() => handleAddMesh('sphere')} className="tool-btn">
                <div className="icon-box"><Circle size={16} className="text-blue-400" /></div>
                <span>Sphere</span>
            </button>
            
            <button onClick={() => handleAddMesh('cube')} className="tool-btn">
                <div className="icon-box"><BoxIcon size={16} className="text-blue-400" /></div>
                <span>Cube</span>
            </button>
            
            <button onClick={() => handleAddMesh('capsule')} className="tool-btn">
                <div className="icon-box"><Cylinder size={16} className="text-blue-400" /></div>
                <span>Capsule</span>
            </button>

            {selectedMesh && !selectedMesh.locked && (
            <>
                <div className="h-px bg-zinc-700 my-1"></div>
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Boolean Op</h2>
                
                <div className="flex gap-2">
                    <button 
                        onClick={() => handleSetOperation('union')} 
                        className={`flex-1 p-2 rounded-md flex justify-center ${selectedMesh.operation === 'union' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                        title="Union (Merge)"
                    >
                        <Combine size={16} />
                    </button>
                    <button 
                        onClick={() => handleSetOperation('subtract')} 
                        className={`flex-1 p-2 rounded-md flex justify-center ${selectedMesh.operation === 'subtract' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                         title="Subtract (Cut)"
                    >
                        <Scissors size={16} />
                    </button>
                    <button 
                        onClick={() => handleSetOperation('intersect')} 
                        className={`flex-1 p-2 rounded-md flex justify-center ${selectedMesh.operation === 'intersect' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                         title="Intersect"
                    >
                        <Crosshair size={16} />
                    </button>
                </div>
            </>
            )}

            <div className="h-px bg-zinc-700 my-1"></div>
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Generators</h2>

            <button onClick={handleGrow} disabled={meshes.length <= 1 || isGenerating} className="tool-btn">
                <div className="icon-box bg-emerald-500/20 group-hover:bg-emerald-500/30"><Zap size={16} className="text-emerald-400" /></div>
                <span>Organic Grow</span>
            </button>

            <button onClick={handleRingGen} disabled={meshes.length <= 1} className="tool-btn">
                 <div className="icon-box bg-purple-500/20 group-hover:bg-purple-500/30"><GitMerge size={16} className="text-purple-400" /></div>
                <span>Edge Satellite (Cut)</span>
            </button>

            <div className="h-px bg-zinc-700 my-1"></div>
            <button onClick={handleBake} disabled={isGenerating || meshes.length <= 1} className="tool-btn bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 text-orange-200">
                <div className="icon-box bg-orange-500/20"><Save size={16} className="text-orange-400" /></div>
                <span>Bake Procedure</span>
            </button>
         </div>
      </div>

      {/* Bottom Footer */}
      <div className="pointer-events-auto flex items-center justify-between">
          <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 px-4 py-2 rounded-full text-zinc-500 text-xs shadow-xl">
             Mesh Count: <span className="text-zinc-200 font-mono ml-1">{meshes.length}</span>
          </div>

          <button 
            onClick={resetScene}
            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-4 py-2 rounded-lg flex items-center gap-2 text-sm transition-all"
          >
              <Trash2 size={16} />
              Reset Scene
          </button>
      </div>
      
      <style>{`
        .tool-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px;
          background: #27272a;
          color: #e4e4e7;
          font-size: 14px;
          border-radius: 8px;
          transition: all 0.2s;
        }
        .tool-btn:hover { background: #3f3f46; }
        .tool-btn:active { transform: scale(0.96); }
        .tool-btn.disabled { opacity: 0.5; cursor: not-allowed; }
        .icon-box {
          padding: 6px;
          background: rgba(59, 130, 246, 0.2);
          border-radius: 6px;
        }
        .tool-btn:hover .icon-box { background: rgba(59, 130, 246, 0.3); }
      `}</style>
    </div>
  );
};