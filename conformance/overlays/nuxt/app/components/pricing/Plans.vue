<script setup lang="ts">
import type { Plan } from '~/data/plans'

defineProps<{ plans: Plan[] }>()
</script>

<template>
  <section class="plans" aria-label="Plans">
    <article v-for="plan in plans" :key="plan.name" class="plan">
      <h2>{{ plan.name }}</h2>
      <p>{{ plan.price }} a week</p>
    </article>
  </section>
</template>

<style scoped>
.plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.plan {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
}
</style>
