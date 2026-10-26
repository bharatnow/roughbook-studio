<script setup lang="ts">
import { loadPlans } from '~/data/plans'

const { data: plans } = await useAsyncData('plans', () => loadPlans())
</script>

<template>
  <main class="page">
    <h1>Plans</h1>
    <PricingPlans :plans="plans ?? []" />
    <PricingFaq />
  </main>
</template>
