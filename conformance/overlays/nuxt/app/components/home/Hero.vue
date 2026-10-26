<script setup lang="ts">
defineProps<{ title: string; lead: string }>()
</script>

<template>
  <section class="hero">
    <h1>{{ title }}</h1>
    <p>{{ lead }}</p>
  </section>
</template>
