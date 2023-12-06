import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'SVGA',
    },
  },
})
