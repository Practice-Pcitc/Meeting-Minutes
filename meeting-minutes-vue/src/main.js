import { createApp } from 'vue'
import App from './App.vue'
import SvgIcon from './components/SvgIcon.vue'
import { router } from './router'
import './assets/global.css'

createApp(App).use(router).component('SvgIcon', SvgIcon).mount('#app')
