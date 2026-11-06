import { describe, expect, it } from 'vitest'
import {
  blockPlainText,
  decodeEntities,
  imagePlaceholderText,
  inlinePlainText,
  isMarkdownFile,
  parseMarkdown,
  safeHref,
  type BlockNode,
} from './markdown'

const SAMPLE = `# Title

A *para* with \`code\`, **bold [link](https://example.org/x "T")** and ~~gone~~.

- one
- [x] done task
- [ ] open task

1. first
2. second

| a | b |
|---|:-:|
| 1 | 2 |

\`\`\`js
const x = 1
\`\`\`

> quoted
> words

---

<div class="raw">not injected</div>

[ref]: https://example.org/ref

Line one\\
line two with &copy; &#169; &#xA9; and &bogus; here.
`

describe('parseMarkdown', () => {
  const { blocks } = parseMarkdown(SAMPLE)

  it('turns the source into top-level blocks, skipping blank lines and link definitions', () => {
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'table',
      'code',
      'blockquote',
      'hr',
      'html',
      'paragraph',
    ])
  })

  it('keeps inline structure as a tree', () => {
    const paragraph = blocks[1]!
    expect(paragraph.type).toBe('paragraph')
    if (paragraph.type !== 'paragraph') return
    expect(paragraph.children).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'em', children: [{ type: 'text', text: 'para' }] },
      { type: 'text', text: ' with ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ', ' },
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'bold ' },
          {
            type: 'link',
            href: 'https://example.org/x',
            title: 'T',
            children: [{ type: 'text', text: 'link' }],
          },
        ],
      },
      { type: 'text', text: ' and ' },
      { type: 'del', children: [{ type: 'text', text: 'gone' }] },
      { type: 'text', text: '.' },
    ])
  })

  it('reads task items, ordered lists and tables', () => {
    const tasks = blocks[2]!
    expect(tasks).toMatchObject({
      type: 'list',
      ordered: false,
      start: null,
    })
    if (tasks.type !== 'list') return
    expect(tasks.items.map((i) => i.checked)).toEqual([null, true, false])
    expect(blockPlainText(tasks)).toBe('onedone taskopen task')

    const ordered = blocks[3]!
    expect(ordered).toMatchObject({ type: 'list', ordered: true, start: 1 })

    const table = blocks[4]!
    expect(table.type).toBe('table')
    if (table.type !== 'table') return
    expect(table.align).toEqual([null, 'center'])
    expect(table.header.map(inlinePlainText)).toEqual(['a', 'b'])
    expect(table.rows.map((r) => r.map(inlinePlainText))).toEqual([['1', '2']])
  })

  it('keeps code verbatim with its language', () => {
    expect(blocks[5]).toEqual({ type: 'code', lang: 'js', text: 'const x = 1' })
    expect(parseMarkdown('```\nplain\n```').blocks[0]).toEqual({
      type: 'code',
      lang: null,
      text: 'plain',
    })
    expect(parseMarkdown('    indented <b>').blocks[0]).toEqual({
      type: 'code',
      lang: null,
      text: 'indented <b>',
    })
  })

  it('keeps raw HTML as text, never as markup', () => {
    expect(blocks[8]).toEqual({
      type: 'html',
      text: '<div class="raw">not injected</div>',
    })
    const inline = parseMarkdown('a <b>bold</b> tag').blocks[0]!
    expect(blockPlainText(inline)).toBe('a <b>bold</b> tag')
  })

  it('decodes character references and keeps hard line breaks', () => {
    const last = blocks[9]!
    expect(last.type).toBe('paragraph')
    if (last.type !== 'paragraph') return
    expect(last.children[0]).toEqual({ type: 'text', text: 'Line one' })
    expect(last.children[1]).toEqual({ type: 'br' })
    expect(blockPlainText(last)).toBe(
      'Line one\nline two with © © © and &bogus; here.',
    )
  })

  it('drops unsafe link targets and never fetches images', () => {
    const doc = parseMarkdown(
      '[js](javascript:alert(1)) [data](data:text/html,x) [ok](HTTPS://x.y) [mail](mailto:a@b.c) [rel](./doc.md) ![alt text](https://img.example/pic.png "Pic")',
    )
    const p = doc.blocks[0]!
    if (p.type !== 'paragraph') throw new Error('expected a paragraph')
    const links = p.children.filter((n) => n.type === 'link')
    expect(links.map((l) => (l.type === 'link' ? l.href : ''))).toEqual([
      null,
      null,
      'HTTPS://x.y',
      'mailto:a@b.c',
      './doc.md',
    ])
    const image = p.children.find((n) => n.type === 'image')
    expect(image).toEqual({
      type: 'image',
      alt: 'alt text',
      src: 'https://img.example/pic.png',
      title: 'Pic',
    })
    expect(blockPlainText(p)).toContain(
      '[image: alt text (https://img.example/pic.png)]',
    )
  })

  it('refuses a source with no blocks instead of opening an empty document', () => {
    expect(() => parseMarkdown('')).toThrow('no content')
    expect(() => parseMarkdown('\n\n')).toThrow('no content')
    expect(() => parseMarkdown('[ref]: https://example.org')).toThrow(
      'no content',
    )
  })

  it('decodes character references in link and image titles', () => {
    const p = parseMarkdown(
      '[a](https://x.y "Tom &amp; Jerry") ![b](https://x.y/i.png "&copy; me")',
    ).blocks[0]!
    if (p.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(p.children[0]).toMatchObject({ type: 'link', title: 'Tom & Jerry' })
    expect(p.children[2]).toMatchObject({ type: 'image', title: '© me' })
  })

  it('merges adjacent text so offsets do not depend on tokenization', () => {
    const p = parseMarkdown('a \\* b &amp; c').blocks[0]!
    if (p.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(p.children).toEqual([{ type: 'text', text: 'a * b & c' }])
  })
})

describe('blockPlainText', () => {
  it('concatenates nested blocks with no separator, as the DOM does', () => {
    const quote: BlockNode = {
      type: 'blockquote',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'two' }] },
      ],
    }
    expect(blockPlainText(quote)).toBe('onetwo')
    expect(blockPlainText({ type: 'hr' })).toBe('')
  })
})

describe('safeHref', () => {
  it('allows http(s), mailto and relative targets, nothing else', () => {
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c')
    expect(safeHref('  http://a.b ')).toBe('http://a.b')
    expect(safeHref('MAILTO:x@y.z')).toBe('MAILTO:x@y.z')
    expect(safeHref('#section')).toBe('#section')
    expect(safeHref('../other.md')).toBe('../other.md')
    // Protocol-relative: a third party dressed as a relative path.
    expect(safeHref('//attacker.example/p')).toBeNull()
    expect(safeHref(' //attacker.example')).toBeNull()
    expect(safeHref('javascript:void(0)')).toBeNull()
    expect(safeHref('JavaScript:void(0)')).toBeNull()
    expect(safeHref('data:text/html,hi')).toBeNull()
    expect(safeHref('vbscript:x')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('')).toBeNull()
  })
})

describe('decodeEntities', () => {
  it('decodes numeric and common named references, keeps the rest', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &quot;q&quot; &#39;s&#x27;')).toBe(
      '<a> & "q" \'s\'',
    )
    expect(decodeEntities('&mdash;&hellip;&nbsp;')).toBe('—… ')
    expect(decodeEntities('&unknown; &#0; &#xD800; &#1114112;')).toBe(
      '&unknown; &#0; &#xD800; &#1114112;',
    )
    expect(decodeEntities('no refs')).toBe('no refs')
  })
})

describe('imagePlaceholderText', () => {
  it('names the alt text and the address, or the address alone', () => {
    expect(imagePlaceholderText({ alt: 'Figure 1', src: 'f.png' })).toBe(
      '[image: Figure 1 (f.png)]',
    )
    expect(imagePlaceholderText({ alt: '  ', src: 'f.png' })).toBe(
      '[image: f.png]',
    )
  })
})

describe('isMarkdownFile', () => {
  it('accepts .md and .markdown names and the text/markdown type', () => {
    expect(isMarkdownFile(new File([''], 'notes.md'))).toBe(true)
    expect(isMarkdownFile(new File([''], 'NOTES.MARKDOWN'))).toBe(true)
    expect(isMarkdownFile(new File([''], 'x', { type: 'text/markdown' }))).toBe(
      true,
    )
    expect(isMarkdownFile(new File([''], 'paper.pdf'))).toBe(false)
    expect(isMarkdownFile(new File([''], 'readme.txt'))).toBe(false)
  })
})
