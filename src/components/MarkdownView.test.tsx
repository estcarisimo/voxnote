import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { blockPlainText, parseMarkdown } from '../core/markdown'
import { MarkdownView } from './MarkdownView'

const SOURCE = `# Title &amp; more

A *para* with \`code\`, **bold [link](https://example.org/x "T")**, ~~gone~~
and a soft break.

Hard break\\
after it. ![Figure 1](https://img.example/f.png) <b>raw</b>

- one
- [x] done
  - nested

1. first

| a | b |
|---|:-:|
| 1 | 2 |

\`\`\`js
const x = "<script>"
\`\`\`

> quoted

---

<div onclick="alert(1)">block html</div>

[unsafe](javascript:alert(1)) and [safe](https://ok.example)
`

describe('MarkdownView', () => {
  it('renders every top-level block with its ordinal in data-block', () => {
    const doc = parseMarkdown(SOURCE)
    const { container } = render(<MarkdownView document={doc} />)
    const blocks = container.querySelectorAll('[data-block]')
    expect(blocks.length).toBe(doc.blocks.length)
    blocks.forEach((element, i) => {
      expect(element.getAttribute('data-block')).toBe(String(i + 1))
      // Only top-level elements carry the attribute.
      expect(element.parentElement?.className).toBe('markdown-view')
    })
  })

  it("keeps each block's textContent equal to blockPlainText, the anchor contract", () => {
    const doc = parseMarkdown(SOURCE)
    const { container } = render(<MarkdownView document={doc} />)
    container.querySelectorAll('[data-block]').forEach((element, i) => {
      expect(element.textContent).toBe(blockPlainText(doc.blocks[i]!))
    })
  })

  it('injects no HTML from the source and loads no image', () => {
    const { container } = render(
      <MarkdownView document={parseMarkdown(SOURCE)} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('div[onclick]')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain(
      '<div onclick="alert(1)">block html</div>',
    )
    expect(container.textContent).toContain(
      '[image: Figure 1 (https://img.example/f.png)]',
    )
  })

  it('links only to safe targets, in a new tab', () => {
    const { container } = render(
      <MarkdownView document={parseMarkdown(SOURCE)} />,
    )
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.org/x',
      'https://ok.example',
    ])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    const dead = container.querySelector('.markdown-view-dead-link')
    expect(dead?.textContent).toBe('unsafe')
  })

  it('renders headings, lists, tasks, tables and code as their elements', () => {
    const { container } = render(
      <MarkdownView document={parseMarkdown(SOURCE)} />,
    )
    expect(container.querySelector('h1')?.textContent).toBe('Title & more')
    expect(container.querySelectorAll('ul').length).toBe(2)
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('1')
    expect(
      container
        .querySelector('li.markdown-view-task')
        ?.getAttribute('data-checked'),
    ).toBe('true')
    expect(container.querySelector('th')?.textContent).toBe('a')
    expect(container.querySelectorAll('td')[1]?.style.textAlign).toBe('center')
    expect(
      container.querySelector('pre[data-lang="js"] code')?.textContent,
    ).toBe('const x = "<script>"')
    expect(container.querySelector('blockquote p')?.textContent).toBe('quoted')
    expect(container.querySelector('hr')).not.toBeNull()
  })
})
