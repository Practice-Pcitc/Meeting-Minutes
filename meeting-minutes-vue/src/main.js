import { createApp } from 'vue'
import App from './App.vue'
import SvgIcon from './components/SvgIcon.vue'
import './assets/global.css'

createApp(App).component('SvgIcon', SvgIcon).mount('#app')
