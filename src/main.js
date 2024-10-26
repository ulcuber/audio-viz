/* eslint-disable no-param-reassign */

import './assets/main.css';

import { createApp, ref } from 'vue';
import App from './App.vue';

createApp(App)
  .use({
    install(app) {
      const errors = ref([]);

      function onWindowError(
        message,
        source,
        lineno,
        colno,
        error,
      ) {
      // eslint-disable-next-line no-console
        console.error(message, source, lineno, colno, error);
        errors.value.push({
          error,
          message: `${error.name}: ${message}`,
          context: {
            from: 'window.onerror',
            source,
            lineno,
            colno,
          },
        });
      }

      app.config.errorHandler = (error, vm, info) => {
      // eslint-disable-next-line no-console
        console.error('app.config.errorHandler', error);
        // eslint-disable-next-line no-underscore-dangle
        const name = (vm && vm.$options) ? vm.$options.__name : 'component';
        // eslint-disable-next-line no-underscore-dangle
        const file = (vm && vm.$options) ? vm.$options.__file : null;
        errors.value.push({
          error,
          message: `${name}@${info}: ${error.name}: ${error.message}`,
          context: {
            from: 'app.config.errorHandler',
            file,
            stack: error.stack,
          },
        });
      };

      if (window) {
        window.onerror = onWindowError;
      }

      app.provide('$errors', {
        errors,
        clear() {
          errors.value = [];
        },
      });
    },
  })
  .mount('#app');
