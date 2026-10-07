<script setup>
// Stands in for the default theme's navbar search (aliased in config.mjs).
// On a page with a sidebar, search lives at the top of the sidebar instead
// (index.mjs), so the navbar keeps it only on the home page. One instance per
// page: each one binds ⌘K / Ctrl+K and would open its own search box.
import { VPNavBarSearch, useSidebar } from 'vitepress/theme';

const { hasSidebar } = useSidebar();
</script>

<template>
  <VPNavBarSearch v-if="!hasSidebar" />
</template>
