import { fileURLToPath, URL } from 'node:url';
import { resolve, dirname } from 'node:path';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
// import basicSsl from '@vitejs/plugin-basic-ssl';
import VueDevTools from 'vite-plugin-vue-devtools';

const VITE_BASE_URL = process.env.VITE_BASE_URL || 'https://ulcuber.github.io';
const baseUrl = `${VITE_BASE_URL}/audio-viz`;

// https://vitejs.dev/config/
export default defineConfig({
  base: baseUrl,
  plugins: [
    vue(),
    VueI18nPlugin({
      // locale messages resource pre-compile option
      include: resolve(
        dirname(fileURLToPath(import.meta.url)),
        './lang/**',
      ),
    }),
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
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        sourcemapBaseUrl: baseUrl,
      },
    },
  },
});
