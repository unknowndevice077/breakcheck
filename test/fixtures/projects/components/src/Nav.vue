<template>
  <nav>
    <router-link to="/">Home</router-link>
  </nav>
</template>

<script setup lang="ts">
import { useRouter, createWebHashHistory as hash } from 'vue-router'
const router = useRouter()
const h = hash()
</script>

<style scoped>
nav { color: red; }
</style>
