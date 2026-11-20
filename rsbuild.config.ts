import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: { title: 'Fernwick Reserve' },
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
