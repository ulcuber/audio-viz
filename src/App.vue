<script setup>
import { inject } from 'vue';
import AudioVisualizer from './components/AudioVisualizer.vue';

const { errors, clear } = inject('$errors');
</script>

<template>
  <AudioVisualizer />
  <footer class="footer">
    <div v-if="errors.length">
      <button type="button" @click="clear">
        Clear
      </button>
      <ul>
        <li v-for="error in errors" :key="error">
          <b>{{ error.message }}</b>
          <div>{{ error.context.from }}</div>
          <div><i>{{ error.context.file }}</i></div>
          <div><pre>{{ error.context.stack }}</pre></div>
        </li>
      </ul>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-top: 1rem;
}
</style>
