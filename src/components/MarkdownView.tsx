import type { ReactNode } from 'react'
import { BLOCK_ATTRIBUTE } from '../core/blockSelection'
import {
  imagePlaceholderText,
  type BlockNode,
  type InlineNode,
  type MarkdownDocument,
} from '../core/markdown'
import './MarkdownView.css'

interface MarkdownViewProps {
  document: MarkdownDocument
}

/**
 * Renders the block tree as elements, never as an HTML string. Each
 * top-level block carries `data-block="<ordinal>"`, and the text it emits is
 * exactly `blockPlainText` of the block (checked by its test), which is what
 * block-text anchors index into. Links open in a new tab; images are
 * placeholders, so rendering never fetches anything.
 */
export function MarkdownView({ document }: MarkdownViewProps) {
  return (
    <article className="markdown-view">
      {document.blocks.map((block, i) => (
        <Block key={i} block={block} ordinal={i + 1} />
      ))}
    </article>
  )
}

function Block({ block, ordinal }: { block: BlockNode; ordinal?: number }) {
  const attributes = ordinal === undefined ? {} : { [BLOCK_ATTRIBUTE]: ordinal }
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.depth}` as const
      return (
        <Tag {...attributes}>
          <Inlines nodes={block.children} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p {...attributes}>
          <Inlines nodes={block.children} />
        </p>
      )
    case 'code':
      return (
        <pre {...attributes} data-lang={block.lang ?? undefined}>
          <code>{block.text}</code>
        </pre>
      )
    case 'html':
      return (
        <pre {...attributes} className="markdown-view-html">
          <code>{block.text}</code>
        </pre>
      )
    case 'blockquote':
      return (
        <blockquote {...attributes}>
          <Blocks blocks={block.children} />
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, i) => (
        <li
          key={i}
          className={item.checked === null ? undefined : 'markdown-view-task'}
          data-checked={item.checked === null ? undefined : item.checked}
        >
          <Blocks blocks={item.children} />
        </li>
      ))
      return block.ordered ? (
        <ol {...attributes} start={block.start ?? undefined}>
          {items}
        </ol>
      ) : (
        <ul {...attributes}>{items}</ul>
      )
    }
    case 'table':
      return (
        <table {...attributes}>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i} style={alignStyle(block.align[i])}>
                  <Inlines nodes={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={alignStyle(block.align[c])}>
                    <Inlines nodes={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'hr':
      return <hr {...attributes} />
  }
}

function alignStyle(align: 'left' | 'center' | 'right' | null | undefined) {
  return align ? { textAlign: align } : undefined
}

function Blocks({ blocks }: { blocks: readonly BlockNode[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </>
  )
}

function Inlines({ nodes }: { nodes: readonly InlineNode[] }) {
  return <>{nodes.map((node, i) => inline(node, i))}</>
}

function inline(node: InlineNode, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text
    case 'code':
      return <code key={key}>{node.text}</code>
    case 'strong':
      return (
        <strong key={key}>
          <Inlines nodes={node.children} />
        </strong>
      )
    case 'em':
      return (
        <em key={key}>
          <Inlines nodes={node.children} />
        </em>
      )
    case 'del':
      return (
        <del key={key}>
          <Inlines nodes={node.children} />
        </del>
      )
    case 'link':
      // An unsafe target was dropped by the parser: the text stays, plain.
      return node.href === null ? (
        <span key={key} className="markdown-view-dead-link">
          <Inlines nodes={node.children} />
        </span>
      ) : (
        <a
          key={key}
          href={node.href}
          title={node.title ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Inlines nodes={node.children} />
        </a>
      )
    case 'image':
      return (
        <span
          key={key}
          className="markdown-view-image"
          title={node.title ?? undefined}
        >
          {imagePlaceholderText(node)}
        </span>
      )
    case 'br':
      // A <br> has no text; a newline in a pre-line span breaks the line and
      // keeps textContent equal to the plain text.
      return (
        <span key={key} className="markdown-view-br">
          {'\n'}
        </span>
      )
  }
}
