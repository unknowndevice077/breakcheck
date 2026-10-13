<script context="module">
  import { QueryClient } from '@tanstack/query-core';
</script>

<script lang="ts">
  const client = new QueryClient();
  client.cancelQueries(['todos']);
</script>

<ul>{#each items as item}<li>{item}</li>{/each}</ul>
