<script setup lang="ts">
// 细线条图标(与参考稿风格一致):16px viewBox,stroke 1.5
const props = defineProps<{ name: string; size?: number }>()

const paths: Record<string, string> = {
  home: 'M2.5 8.5 8 3.5l5.5 5M4 7.5V13h8V7.5',
  user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 13.5c0-2.5 2.4-4 5.5-4s5.5 1.5 5.5 4',
  folder: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 5h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z',
  sync: 'M13 8a5 5 0 0 1-9.3 2.5M3 8a5 5 0 0 1 9.3-2.5M3.5 13v-3h3M12.5 3v3h-3',
  list: 'M5.5 4.5h8m-8 4h8m-8 4h8M3 4.5h.01M3 8.5h.01M3 12.5h.01',
  transfer: 'M3 5.5h8m0 0L9 3.5m2 2-2 2M13 10.5H5m0 0 2-2m-2 2 2 2',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.2a1 1 0 0 0 1 .8h3.6a1 1 0 0 0 1-.8l.7-8.2',
  spark: 'M8 2.5 9.3 6l3.7.6-2.7 2.6.7 3.8L8 11.2 5 13l.7-3.8L3 6.6 6.7 6 8 2.5Z',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5.3-2a5.3 5.3 0 0 0-.1-1l1.4-1-1.3-2.3-1.7.7c-.3-.2-.6-.4-1-.5L10.3 2H8.7L8.4 3.9c-.4.1-.7.3-1 .5l-1.7-.7L4.4 6l1.4 1a5.3 5.3 0 0 0 0 2l-1.4 1 1.3 2.3 1.7-.7c.3.2.6.4 1 .5l.3 1.9h1.6l.3-1.9c.4-.1.7-.3 1-.5l1.7.7 1.3-2.3-1.4-1c.1-.3.1-.7.1-1Z',
  bell: 'M8 2.5a4 4 0 0 1 4 4V9l1.5 2.5h-11L4 9V6.5a4 4 0 0 1 4-4ZM6.5 13a1.5 1.5 0 0 0 3 0',
  layers: 'M8 2.5 2.5 5.5 8 8.5l5.5-3L8 2.5ZM3 8.5l5 3 5-3M3 11.5l5 3 5-3',
  menu: 'M3 4.5h10m-10 4h10m-10 4h10',
}
</script>

<template>
  <svg :width="props.size || 16" :height="props.size || 16" viewBox="0 0 16 16" fill="none"
       stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path :d="paths[props.name] || paths.list" />
  </svg>
</template>
