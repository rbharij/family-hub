"use client"

/**
 * ErrorBoundary — catches rendering errors in a subtree and shows a
 * contained fallback instead of crashing the whole page.
 *
 * Usage:
 *   <ErrorBoundary label="Calendar grid">
 *     <CalendarGrid ... />
 *   </ErrorBoundary>
 *
 * Error boundaries must be class components (React requirement).
 */

import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
  /** Human-readable name logged alongside the error. */
  label?: string
  /** Custom fallback UI. If omitted, a generic message is shown. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: "" }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` "${this.props.label}"` : ""}]`, error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-destructive">Something went wrong</p>
        {this.state.message && (
          <p className="text-xs text-muted-foreground max-w-xs">{this.state.message}</p>
        )}
        <button
          onClick={() => this.setState({ hasError: false, message: "" })}
          className="text-xs underline text-muted-foreground hover:text-foreground transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }
}
