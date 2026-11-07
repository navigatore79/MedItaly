import {defineConfig} from 'vite';
export default defineConfig({base:'./',resolve:{alias:{events:'events/',url:'url/'}},build:{outDir:'../imaging-viewer-dist',emptyOutDir:true,lib:{entry:'src.js',formats:['es'],fileName:'viewer'},rollupOptions:{output:{assetFileNames:'[name][extname]'}}},worker:{format:'es'},optimizeDeps:{exclude:['@cornerstonejs/dicom-image-loader'],include:['dicom-parser']}});
