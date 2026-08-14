<script setup>
defineProps({ items: { type: Array, default: () => [] } })
const emit = defineEmits(['navigate'])
</script>

<template>
  <nav class="breadcrumb" aria-label="面包屑导航">
    <template v-for="(item, index) in items" :key="`${item.key}-${index}`">
      <span v-if="index" class="separator" aria-hidden="true">/</span>
      <button v-if="item.action && index < items.length - 1" class="crumb-link" @click="emit('navigate', item.action)">
        {{ item.label }}
      </button>
      <span v-else class="crumb-current" :aria-current="index === items.length - 1 ? 'page' : undefined">{{ item.label }}</span>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb { height: 38px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 24px; background: var(--surface); border-bottom: 1px solid var(--border-light); color: var(--text-muted); font-size: .78rem; }
.separator { color: var(--text-disabled); }.crumb-link { color: var(--text-secondary); transition: var(--transition); }.crumb-link:hover { color: var(--primary); }.crumb-current { color: var(--text); font-weight: 600; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
