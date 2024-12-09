import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'), // Entry point for the library
      name: 'SharedComponents',
      fileName: (format) => `shared-components.${format}.js`, // Output file names
      formats: ['es', 'cjs'], // Generate both ES Module and CommonJS formats
    },
    rollupOptions: {
      external: ['react', 'react-dom'], // Exclude peer dependencies from the bundle
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
});
