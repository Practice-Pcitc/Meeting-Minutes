import { createRouter, createWebHistory } from 'vue-router'

const RouteOutlet = { render: () => null }

const routes = [
  { path: '/', redirect: '/archive' },
  { path: '/login', name: 'login', component: RouteOutlet, meta: { public: true } },
  { path: '/minutes', name: 'minutes', component: RouteOutlet, meta: { tab: 'minutes' } },
  { path: '/recording', name: 'recording', component: RouteOutlet, meta: { tab: 'recording' } },
  { path: '/summary', name: 'summary', component: RouteOutlet, meta: { tab: 'summary' } },
  { path: '/todos', name: 'todos', component: RouteOutlet, meta: { tab: 'todos' } },
  { path: '/seating', name: 'seating', component: RouteOutlet, meta: { tab: 'seating' } },
  { path: '/settings', name: 'settings', component: RouteOutlet, meta: { tab: 'settings' } },
  { path: '/archive', name: 'archive', component: RouteOutlet, meta: { tab: 'archive' } },
  {
    path: '/:pathMatch(.*)*',
    redirect: (to) => {
      const legacyView = /^\/minutes\/(timeline|speaker|topic|mindmap)$/.exec(to.path)?.[1]
      return legacyView === 'timeline' ? '/minutes' : legacyView ? `/minutes?view=${legacyView}` : '/archive'
    },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
