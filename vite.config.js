import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// import basicSsl from '@vitejs/plugin-basic-ssl';
import VueDevTools from 'vite-plugin-vue-devtools';

const ASSET_URL = process.env.ASSET_URL || '';

// https://vitejs.dev/config/
export default defineConfig({
  base: `${ASSET_URL}/audio-viz`,
  plugins: [
    vue(),
    VueDevTools(),
    // basicSsl({
    //   /** name of certification */
    //   name: 'test',
    //   /** custom trust domains */
    //   domains: ['localhost'],
    //   /** custom certification directory */
    //   certDir: './certs',
    // }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
