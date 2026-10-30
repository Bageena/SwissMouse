import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {thirdPartyNotices} from './scripts/third-party-notices';
export default defineConfig({plugins:[react(),thirdPartyNotices()],build:{outDir:'dist/core',emptyOutDir:true,rollupOptions:{input:'core.html'}}});
