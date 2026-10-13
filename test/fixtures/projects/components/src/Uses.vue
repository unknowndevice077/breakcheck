<template>
  <p>{{ tc('apple', 2) }} {{ client.cancelQueries() }}</p>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { tc } = useI18n() as any
</script>
