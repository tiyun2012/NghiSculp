import React from 'react';
import { useStore, MeshNode, PROCEDURE_MESH_ID } from '../store';
import { 
  Box, 
  Circle, 
  Cylinder, 
  ChevronRight, 
  CornerDownRight, 
  GripVertical, 
  Eye, 
  EyeOff,
  Combine,
  Scissors,
  Crosshair,
  Lock,
  BoxSelect
} from 'lucide-react';

interface GraphNodeProps {
  meshId: string;
  depth: number;
}

const getIcon = (type: string, isProcedure: boolean) => {
  if (isProcedure) return BoxSelect;
  switch (type) {
    case 'cube': return Box;
    case 'capsule': return Cylinder;
    case 'sphere': 
    default: return Circle;
  }
};

const getOpIcon = (op: string) => {
    switch(op) {
        case 'subtract': return Scissors;
        case 'intersect': return Crosshair;
        case 'union':
        default: return Combine;
    }
}

const GraphNode: React.FC<GraphNodeProps> = ({ meshId, depth }) => {
  const meshes = useStore(state => state.meshes);
  const selectedMeshId = useStore(state => state.selectedMeshId);
  const selectMesh = useStore(state => state.selectMesh);
  const setParent = useStore(state => state.setParent);
  const toggleVisibility = useStore(state => state.toggleVisibility);

  const mesh = meshes.find(m => m.id === meshId);
  const children = meshes.filter(m => m.parentId === meshId);
  const isSelected = selectedMeshId === meshId;
  const isProcedure = meshId === PROCEDURE_MESH_ID;

  if (!mesh) return null;

  const Icon = getIcon(mesh.type, isProcedure);
  const OpIcon = getOpIcon(mesh.operation);

  const handleDragStart = (e: React.DragEvent) => {
    if (isProcedure) return; // Cannot drag procedure mesh
    e.dataTransfer.setData('meshId', meshId);
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isProcedure) return; // Cannot drop onto procedure mesh (it is a separate container)

    const draggedId = e.dataTransfer.getData('meshId');
    if (draggedId && draggedId !== meshId) {
      setParent(draggedId, meshId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isProcedure) {
        e.preventDefault(); // Allow drop only if not procedure
    }
  };

  return (
    <div className="flex flex-col">
      <div 
        className={`
          flex items-center gap-2 p-1.5 rounded-md cursor-pointer transition-colors border border-transparent group
          ${isSelected ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200' : 'hover:bg-zinc-800 text-zinc-400'}
        `}
        style={{ marginLeft: `${depth * 16}px` }}
        onClick={() => selectMesh(meshId)}
        draggable={!isProcedure}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {!isProcedure ? (
             <GripVertical size={12} className="opacity-0 group-hover:opacity-50 cursor-grab active:cursor-grabbing" />
        ) : (
             <Lock size={12} className="text-zinc-600" />
        )}

        {depth > 0 && <CornerDownRight size={12} className="text-zinc-600" />}
        
        {/* Operation Indicator or Procedure Icon */}
        {!isProcedure && (
            <div className="w-4 h-4 flex items-center justify-center" title={mesh.operation}>
                <OpIcon size={12} className={mesh.operation === 'subtract' ? 'text-red-400' : (mesh.operation === 'intersect' ? 'text-emerald-400' : 'text-blue-400')} />
            </div>
        )}

        <Icon size={14} className={isSelected ? 'text-indigo-400' : (isProcedure ? 'text-orange-400' : 'text-zinc-500')} />
        
        <span className="text-xs font-medium truncate select-none capitalize flex-1">
           {mesh.name || `${mesh.type} ${meshId.substring(0, 4)}`}
        </span>

        <button 
            onClick={(e) => {
                e.stopPropagation();
                toggleVisibility(meshId);
            }}
            className="p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
            title={mesh.visible ? "Hide" : "Show"}
        >
            {mesh.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>

      <div className="flex flex-col gap-0.5 mt-0.5">
        {children.map(child => (
          <GraphNode key={child.id} meshId={child.id} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
};

export const SceneGraph = () => {
  const meshes = useStore(state => state.meshes);
  const setParent = useStore(state => state.setParent);

  // Filter roots. We want Procedure Mesh at top, then other roots.
  const roots = meshes.filter(m => !m.parentId || !meshes.find(p => p.id === m.parentId));
  
  // Sort: Procedure first
  const sortedRoots = [...roots].sort((a, b) => {
      if (a.id === PROCEDURE_MESH_ID) return -1;
      if (b.id === PROCEDURE_MESH_ID) return 1;
      return 0;
  });

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('meshId');
    if (draggedId) {
      setParent(draggedId, null);
    }
  };

  return (
    <div 
        className="flex flex-col gap-2 h-full overflow-y-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleRootDrop}
    >
      <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-2 px-2">
        Hierarchy
      </div>
      
      {roots.length === 0 && (
          <div className="text-zinc-600 text-xs text-center py-4 italic">
            No meshes
          </div>
      )}

      {sortedRoots.map(mesh => (
        <GraphNode key={mesh.id} meshId={mesh.id} depth={0} />
      ))}
      
      <div className="flex-1 min-h-[50px]" />
    </div>
  );
};