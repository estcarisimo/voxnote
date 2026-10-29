import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows the open-PDF landing view', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'VoxNote' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a PDF' })).toBeTruthy()
  })
})
