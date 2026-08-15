import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/minutes' },
  { path: '/login', name: 'login', meta: { public: true } },
  { path: '/minutes', name: 'minutes', meta: { tab: 'minutes' } },
  { path: '/summary', name: 'summary', meta: { tab: 'summary' } },
  { path: '/todos', name: 'todos', meta: { tab: 'todos' } },
  { path: '/seating', name: 'seating', meta: { tab: 'seating' } },
  { path: '/settings', name: 'settings', meta: { tab: 'settings' } },
  { path: '/archive', name: 'archive', meta: { tab: 'archive' } },
  {
    path: '/:pathMatch(.*)*',
    redirect: (to) => {
      const legacyView = /^\/minutes\/(timeline|speaker|topic|mindmap)$/.exec(to.path)?.[1]
      return legacyView === 'timeline' ? '/minutes' : legacyView ? `/minutes?view=${legacyView}` : '/minutes'
    },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
