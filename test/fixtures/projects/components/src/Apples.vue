<template>
  <p>{{ $tc('apple', count) }}</p>
  <p>{{ formatter.tc }}</p>
</template>

<script>
export default {
  props: ['count'],
  computed: {
    label() {
      return this.$tc('apple', this.count)
    },
  },
}
</script>
