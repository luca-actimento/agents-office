import { StrictMode, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Agents Office] React crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#e06c75', fontFamily: 'monospace', fontSize: 14 }}>
          <b>Agents Office crashed</b>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, padding: '4px 12px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
