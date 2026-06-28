import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
// Output to ../dist/client so NestJS's ServeStaticModule can pick it up.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // single-source §7 contract (type-only today; alias future-proofs any
            // value import and keeps dev-server resolution correct)
            '@strait/contract': resolve(__dirname, '..', 'packages', 'contract', 'src', 'index.ts'),
        },
    },
    build: {
        outDir: resolve(__dirname, '..', 'dist', 'client'),
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        // allow serving the shared package which lives above the client root
        fs: { allow: ['..'] },
        proxy: {
            '/api': 'http://localhost:3000',
            '/webhooks': 'http://localhost:3000',
        },
    },
});
