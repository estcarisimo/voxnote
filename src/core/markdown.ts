/**
 * Markdown documents as a restricted block tree. Pure and framework-free.
 *
 * `marked` is used as a lexer only: its tokens are turned into the types
 * below, which a renderer turns into elements itself. No HTML string from the
 * source ever reaches the DOM: raw HTML is kept as visible text, link targets
 * are limited to a few safe schemes, and images are placeholders, never
 * fetched (loading one would send a request the reviewer never agreed to).
 *
 * Anchors point at a top-level block by its 1-based ordinal and at character
 * offsets into that block's plain text (see `blockPlainText`). The renderer
 * must produce elements whose `textContent` equals that plain text, so an
 * anchor can be resolved from stored data alone; `MarkdownView.test.tsx`
 * checks that contract.
 */
import { Lexer, type Token, type Tokens } from 'marked'

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'del'; children: InlineNode[] }
  | {
      type: 'link'
      href: string | null
      title: string | null
      children: InlineNode[]
    }
  /** Shown as a placeholder, never loaded. `alt` is the image's text. */
  | { type: 'image'; alt: string; src: string; title: string | null }
  | { type: 'br' }

export interface ListItem {
  /** `null` for an ordinary item; a GFM task item is checked or not. */
  checked: boolean | null
  children: BlockNode[]
}

export type TableAlign = 'left' | 'center' | 'right' | null

export type BlockNode =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'list'; ordered: boolean; start: number | null; items: ListItem[] }
  | {
      type: 'table'
      align: TableAlign[]
      header: InlineNode[][]
      rows: InlineNode[][][]
    }
  | { type: 'hr' }
  /** Raw HTML from the source, shown verbatim as text. */
  | { type: 'html'; text: string }

export interface MarkdownDocument {
  /** Top-level blocks in source order; `blocks[n - 1]` is block `n`. */
  blocks: BlockNode[]
}

/** Link schemes a rendered link may point at; anything else becomes text. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:']

export function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.type === 'text/markdown' ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  )
}

/**
 * Parses GFM Markdown into the block tree. Throws on an unknown token, so an
 * upgrade of the lexer that adds a token kind shows up as an error, not as
 * silently dropped content.
 */
export function parseMarkdown(source: string): MarkdownDocument {
  const tokens = Lexer.lex(source, { gfm: true, breaks: false })
  return { blocks: blocksOf(tokens) }
}

function blocksOf(tokens: readonly Token[]): BlockNode[] {
  const blocks: BlockNode[] = []
  for (const token of tokens) {
    const block = blockOf(token)
    if (block) blocks.push(block)
  }
  return blocks
}

/** Null for tokens that carry no content: blank lines, link definitions. */
function blockOf(token: Token): BlockNode | null {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'heading': {
      const t = token as Tokens.Heading
      const depth = t.depth
      if (![1, 2, 3, 4, 5, 6].includes(depth)) {
        throw new Error(`Heading depth out of range: ${depth}`)
      }
      return {
        type: 'heading',
        depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
        children: inlinesOf(t.tokens),
      }
    }
    case 'paragraph':
      return {
        type: 'paragraph',
        children: inlinesOf((token as Tokens.Paragraph).tokens),
      }
    // A `text` token at block level is the tight list item's content.
    case 'text':
      return {
        type: 'paragraph',
        children: inlinesOf((token as Tokens.Text).tokens ?? [token]),
      }
    case 'code': {
      const t = token as Tokens.Code
      const lang = t.lang?.trim() ? t.lang.trim() : null
      return { type: 'code', lang, text: t.text }
    }
    case 'blockquote':
      return {
        type: 'blockquote',
        children: blocksOf((token as Tokens.Blockquote).tokens),
      }
    case 'list': {
      const t = token as Tokens.List
      return {
        type: 'list',
        ordered: t.ordered,
        start: t.ordered && typeof t.start === 'number' ? t.start : null,
        items: t.items.map((item) => ({
          checked: item.task ? item.checked === true : null,
          children: blocksOf(
            item.tokens.filter((child) => child.type !== 'checkbox'),
          ),
        })),
      }
    }
    case 'table': {
      const t = token as Tokens.Table
      return {
        type: 'table',
        align: t.align.map((a) => a ?? null),
        header: t.header.map((cell) => inlinesOf(cell.tokens)),
        rows: t.rows.map((row) => row.map((cell) => inlinesOf(cell.tokens))),
      }
    }
    case 'hr':
      return { type: 'hr' }
    case 'html':
      return { type: 'html', text: (token as Tokens.HTML).raw }
    default:
      throw new Error(`Unsupported Markdown block token "${token.type}"`)
  }
}

function inlinesOf(tokens: readonly Token[]): InlineNode[] {
  const nodes: InlineNode[] = []
  for (const token of tokens) nodes.push(inlineOf(token))
  return mergeText(nodes)
}

function inlineOf(token: Token): InlineNode {
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text
      // Nested tokens appear in list items; at inline level `text` is a leaf.
      return { type: 'text', text: decodeEntities(t.text) }
    }
    case 'escape':
      return { type: 'text', text: (token as Tokens.Escape).text }
    case 'codespan':
      return { type: 'code', text: (token as Tokens.Codespan).text }
    case 'strong':
      return {
        type: 'strong',
        children: inlinesOf((token as Tokens.Strong).tokens),
      }
    case 'em':
      return { type: 'em', children: inlinesOf((token as Tokens.Em).tokens) }
    case 'del':
      return { type: 'del', children: inlinesOf((token as Tokens.Del).tokens) }
    case 'link': {
      const t = token as Tokens.Link
      return {
        type: 'link',
        href: safeHref(t.href),
        title: t.title ?? null,
        children: inlinesOf(t.tokens),
      }
    }
    case 'image': {
      const t = token as Tokens.Image
      return {
        type: 'image',
        alt: inlinePlainText(inlinesOf(t.tokens)),
        src: t.href,
        title: t.title ?? null,
      }
    }
    case 'br':
      return { type: 'br' }
    // Inline HTML tags are shown as the text they are.
    case 'html':
      return { type: 'text', text: (token as Tokens.Tag).raw }
    default:
      throw new Error(`Unsupported Markdown inline token "${token.type}"`)
  }
}

/** Adjacent text nodes become one, so offsets never depend on tokenization. */
function mergeText(nodes: readonly InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = []
  for (const node of nodes) {
    const last = merged[merged.length - 1]
    if (node.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: last.text + node.text }
    } else {
      merged.push(node)
    }
  }
  return merged
}

/**
 * Returns `href` when a rendered link may point at it, null otherwise.
 * Relative links are kept: they resolve against this site, not a third party,
 * and the user has to tap them. `javascript:` and `data:` never pass.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '') return null
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (!scheme) return trimmed
  return SAFE_SCHEMES.includes(`${scheme[1]!.toLowerCase()}:`) ? trimmed : null
}

/** How an image placeholder reads, in the document and in its text. */
export function imagePlaceholderText(node: {
  alt: string
  src: string
}): string {
  return node.alt.trim() === ''
    ? `[image: ${node.src}]`
    : `[image: ${node.alt} (${node.src})]`
}

/** The text a reader sees for inline nodes, as the renderer must emit it. */
export function inlinePlainText(nodes: readonly InlineNode[]): string {
  let text = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        text += node.text
        break
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        text += inlinePlainText(node.children)
        break
      case 'image':
        text += imagePlaceholderText(node)
        break
      case 'br':
        text += '\n'
        break
    }
  }
  return text
}

/**
 * The plain text of a block, equal to the `textContent` of its rendered
 * element: every text the renderer emits, nothing else. Nested blocks are
 * concatenated with no separator, as the DOM does. Anchor offsets index
 * into this string.
 */
export function blockPlainText(block: BlockNode): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlinePlainText(block.children)
    case 'code':
    case 'html':
      return block.text
    case 'blockquote':
      return block.children.map(blockPlainText).join('')
    case 'list':
      return block.items
        .map((item) => item.children.map(blockPlainText).join(''))
        .join('')
    case 'table':
      return [block.header, ...block.rows]
        .map((row) => row.map(inlinePlainText).join(''))
        .join('')
    case 'hr':
      return ''
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  times: '×',
  middot: '·',
  deg: '°',
  para: '¶',
  sect: '§',
}

/**
 * Decodes the character references `marked` leaves in text (it expects a
 * browser to decode them). Numeric references and the common named ones are
 * decoded; an unknown name stays as written, visible rather than dropped.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return codePointToString(parseInt(body.slice(2), 16), match)
      }
      if (body.startsWith('#')) {
        return codePointToString(parseInt(body.slice(1), 10), match)
      }
      return NAMED_ENTITIES[body] ?? match
    },
  )
}

function codePointToString(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return fallback
  }
  // Surrogate code points are not characters.
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return fallback
  return String.fromCodePoint(codePoint)
}
