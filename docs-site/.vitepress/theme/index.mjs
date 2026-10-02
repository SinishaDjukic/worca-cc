import { h } from 'vue';
import DefaultTheme, { VPNavBarSearch } from 'vitepress/theme';
import './custom.css';

export default {
  extends: DefaultTheme,
  // Search sits at the top of the sidebar, above the page groups; the navbar's
  // copy is dropped on these pages by NavBarSearch.vue.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () => h('div', { class: 'worca-sidebar-search' }, [h(VPNavBarSearch)]),
    }),
};
