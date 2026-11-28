<script setup lang="ts">
// 标签式扩展名编辑器(参考稿风格:chip + × + 输入添加)
import { computed, ref } from 'vue'

const props = defineProps<{ modelValue: string; placeholder?: string; presets?: string[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const input = ref('')
const showPresets = ref(false)

const tags = computed(() =>
  props.modelValue.split(/[,;，\s]+/).map((s) => s.trim()).filter(Boolean),
)

function add(raw: string) {
  const t = raw.trim().toLowerCase()
  if (!t) return
  const ext = t.startsWith('.') ? t : '.' + t
  if (!tags.value.includes(ext)) {
    emit('update:modelValue', [...tags.value, ext].join(','))
  }
  input.value = ''
}
function remove(tag: string) {
  emit('update:modelValue', tags.value.filter((t) => t !== tag).join(','))
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    add(input.value)
  } else if (e.key === 'Backspace' && !input.value && tags.value.length) {
    remove(tags.value[tags.value.length - 1])
  }
}
function togglePreset(p: string) {
  if (tags.value.includes(p)) remove(p)
  else add(p)
}
</script>

<template>
  <div class="tags" @click="($refs.tagInput as HTMLInputElement)?.focus()">
    <span v-for="t in tags" :key="t" class="tag">
      {{ t.replace('.', '') }} <button type="button" @click.stop="remove(t)">×</button>
    </span>
    <input
      ref="tagInput"
      v-model="input"
      :placeholder="tags.length ? '' : (placeholder || '输入后回车添加')"
      @keydown="onKeydown"
      @blur="add(input)"
    />
  </div>
  <div v-if="presets?.length" class="row" style="gap:6px;margin-top:6px">
    <button
      v-for="p in presets" :key="p" type="button"
      class="btn ghost small" style="border-radius:999px;padding:2px 10px"
      :style="tags.includes(p) ? 'border-color:var(--primary);color:var(--primary)' : ''"
      @click="togglePreset(p)"
    >{{ p }}</button>
  </div>
</template>
