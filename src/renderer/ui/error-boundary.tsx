import { Component, Fragment, type ReactNode } from 'react'
import styles from './error-boundary.module.css'

type ErrorBoundaryProps = {
  children: ReactNode
  reload?: () => void
}

type ErrorBoundaryState = {
  failed: boolean
  attempt: number
}

function reloadWindow(): void {
  window.location.reload()
}

/** Keeps a React rendering failure from leaving an otherwise healthy window blank. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    failed: false,
    attempt: 0,
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true }
  }

  private readonly retry = (): void => {
    this.setState((state) => ({
      failed: false,
      attempt: state.attempt + 1,
    }))
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className={styles.screen}>
          <section className={styles.content} role="alert" aria-labelledby="error-title">
            <h1 id="error-title" className={styles.title}>Luna ran into a display problem.</h1>
            <p className={styles.message}>
              Try again to rebuild this window, or reload it if the problem continues.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                autoFocus
                onClick={this.retry}
              >
                Try again
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={this.props.reload ?? reloadWindow}
              >
                Reload window
              </button>
            </div>
          </section>
        </main>
      )
    }

    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
