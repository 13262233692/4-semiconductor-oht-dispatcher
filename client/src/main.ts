import { createApp } from 'vue'
import { pinia } from './store/ohtStore'
import App from './App.vue'
import './styles.css'

const app = createApp(App)
app.use(pinia)
app.mount('#app')
