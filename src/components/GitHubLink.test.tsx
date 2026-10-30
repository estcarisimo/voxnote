import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GitHubLink, REPOSITORY_URL } from './GitHubLink'

describe('GitHubLink', () => {
  it('links to the repository in a new tab with an accessible name', () => {
    render(<GitHubLink />)
    const link = screen.getByRole('link', { name: 'VoxNote on GitHub' })
    expect(link.getAttribute('href')).toBe(REPOSITORY_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('carries the mark inline, hidden from assistive technology', () => {
    const { container } = render(<GitHubLink />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
    expect(container.querySelector('img')).toBeNull()
  })

  it('appends the placement class to its own', () => {
    render(<GitHubLink className="app-bar-github" />)
    expect(screen.getByRole('link').className).toBe(
      'github-link app-bar-github',
    )
  })
})
