import React from 'react';
import {createRoot} from 'react-dom/client';
import CoreWorkbench from './core/CoreWorkbench';
createRoot(document.getElementById('root')!).render(<React.StrictMode><CoreWorkbench/></React.StrictMode>);
