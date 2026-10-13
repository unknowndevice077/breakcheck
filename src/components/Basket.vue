<template>
  <aside>{{ $tc('apple', 3) }}</aside>
</template>

<script>
export default {
  name: 'Basket',
  methods: {
    label(n) {
      return this.$tc('apple', n)
    },
  },
}
</script>
