import { render } from '@solidjs/web'
import { App } from './App'
import '@moneyhound/ui/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('root_missing')

render(() => <App />, root)
