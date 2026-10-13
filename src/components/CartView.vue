<template>
  <section>
    <p>{{ $tc('apple', cart.items.length) }}</p>
    <button @click="cart.add('apple')">Add</button>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs, mapStores, PiniaVuePlugin } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useCart } from '../stores/cart'

const cart = useCart()
const { items } = storeToRefs(cart)
const { t } = useI18n()
void [items, t, mapStores, PiniaVuePlugin]
</script>
