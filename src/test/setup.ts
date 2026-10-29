import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// `globals` is off, so Testing Library cannot register this itself: without
// it, every render in a file piles up in one document.
afterEach(cleanup)
