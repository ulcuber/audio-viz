/* eslint-disable no-param-reassign */

import './assets/sass/main.scss';

import { createApp, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';

const i18n = createI18n({
  legacy: false,
  locale: (navigator?.language || navigator?.userLanguage)?.split('-')[0] || 'en',
  fallbackLocale: 'en',
  messages: { en: {}, ru: {} },
});

createApp(App)
  .use(i18n)
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
