import React from 'react';
import { Scene } from './components/Scene';
import { UI } from './components/UI';
import { ConsoleBridge } from './components/ConsoleBridge';

const App = () => {
  return (
    <div className="relative w-full h-full bg-zinc-950">
      <ConsoleBridge />
      <Scene />
      <UI />
    </div>
  );
};

export default App;