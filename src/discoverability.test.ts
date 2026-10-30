// The files that search engines and AI agents read are hand-written in
// public/ and at the repository root. These checks keep their URLs pointing
// at the live site and the repository, and context7.json inside the limits
// of https://context7.com/schema/context7.json (fetched 2026-10-30).
import { describe, expect, it } from 'vitest'
import context7 from '../context7.json'
import llmsFull from '../public/llms-full.txt?raw'
import llms from '../public/llms.txt?raw'
import robots from '../public/robots.txt?raw'
import sitemap from '../public/sitemap.xml?raw'

const SITE = 'https://estcarisimo.github.io/voxnote/'
const REPOSITORY = 'https://github.com/estcarisimo/voxnote'
const RAW = 'https://raw.githubusercontent.com/estcarisimo/voxnote/main/'

// Every Markdown and CITATION file at the root and under docs/, keyed by the
// path llms.txt would use after the raw prefix.
const repositoryFiles = new Set(
  [
    ...Object.keys(import.meta.glob('../*.{md,cff,json}')),
    ...Object.keys(import.meta.glob('../docs/**/*.md')),
  ].map((path) => path.replace(/^\.\.\//, '')),
)

function absoluteUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)<>"']+/g) ?? []
}

function isOurs(url: string): boolean {
  return (
    url.startsWith(SITE) || url.startsWith(REPOSITORY) || url.startsWith(RAW)
  )
}

describe('llms.txt', () => {
  it('starts with the project title and a summary blockquote', () => {
    const lines = llms.split('\n')
    expect(lines[0]).toBe('# VoxNote')
    expect(lines[2]).toMatch(/^> /)
  })

  it('links the live site, the full text and the README', () => {
    expect(llms).toContain(SITE)
    expect(llms).toContain(`${SITE}llms-full.txt`)
    expect(llms).toContain(`${RAW}README.md`)
  })

  it('points only at the live site and the repository', () => {
    const foreign = absoluteUrls(llms).filter((url) => !isOurs(url))
    expect(foreign).toEqual([])
  })

  it('every linked raw file exists in the repository', () => {
    const files = absoluteUrls(llms)
      .filter((url) => url.startsWith(RAW))
      .map((url) => url.slice(RAW.length))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(repositoryFiles.has(file), file).toBe(true)
    }
  })
})

describe('llms-full.txt', () => {
  it('names the index, the date it describes and the live site', () => {
    expect(llmsFull).toContain(`${SITE}llms.txt`)
    expect(llmsFull).toMatch(/as of \d{4}-\d{2}-\d{2} \(UTC\)/)
    expect(llmsFull).toContain(SITE)
  })

  it('points only at the live site, the repository and the local preview', () => {
    const foreign = absoluteUrls(llmsFull).filter(
      (url) =>
        !isOurs(url) && !url.startsWith('http://localhost:4173/voxnote/'),
    )
    expect(foreign).toEqual([])
  })

  it('every linked raw file exists in the repository', () => {
    const files = absoluteUrls(llmsFull)
      .filter((url) => url.startsWith(RAW))
      .map((url) => url.slice(RAW.length))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(repositoryFiles.has(file), file).toBe(true)
    }
  })
})

describe('robots.txt and sitemap.xml', () => {
  it('allows every crawler and names the sitemap', () => {
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Disallow:$/m)
    expect(robots).toMatch(
      /^Sitemap: https:\/\/estcarisimo\.github\.io\/voxnote\/sitemap\.xml$/m,
    )
  })

  it('lists the landing under the Pages base path', () => {
    expect(sitemap).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    )
    expect(sitemap.match(/<loc>/g)).toHaveLength(1)
    expect(sitemap).toContain(`<loc>${SITE}</loc>`)
  })
})

describe('context7.json', () => {
  it('declares the official schema and the project', () => {
    expect(context7.$schema).toBe('https://context7.com/schema/context7.json')
    expect(context7.projectTitle).toBe('VoxNote')
    expect(context7.description.length).toBeGreaterThanOrEqual(10)
    expect(context7.description.length).toBeLessThanOrEqual(500)
  })

  it('indexes docs/ and excludes the source and maintainer files', () => {
    expect(context7.folders).toEqual(['docs'])
    expect(context7.excludeFolders).toContain('src')
    for (const file of ['AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md']) {
      expect(context7.excludeFiles).toContain(file)
    }
    // excludeFiles takes file names only, never paths.
    for (const file of context7.excludeFiles) {
      expect(file).not.toContain('/')
    }
  })

  it('keeps every rule within the schema limit of 255 characters', () => {
    expect(context7.rules.length).toBeGreaterThan(0)
    expect(context7.rules.length).toBeLessThanOrEqual(50)
    for (const rule of context7.rules) {
      expect(rule.length, rule).toBeGreaterThan(0)
      expect(rule.length, rule).toBeLessThanOrEqual(255)
    }
  })
})
