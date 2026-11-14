import { describe, expect, it } from 'vitest'

import { parseSkillDocument, skillProvider } from '../src/skill/index.ts'

/*
 * 随包 skill provider 的契约：
 *  - frontmatter 只认扁平 key: value，且 LF / CRLF 都要吃（Windows checkout）。
 *  - 正文必须剥掉 frontmatter —— 把 YAML 头当正文喂给模型是历史 bug。
 *  - 卡片字段要满足宿主 validateCandidate：description 非空、invocation 双开、rank 600。
 *  - get() 名字不匹配必须返回 undefined（而不是抛错或回别人的内容）。
 */
describe('parseSkillDocument', () => {
  it('parses flat LF frontmatter and strips it from the body', () => {
    const src = ['---', 'name: demo', 'description: "quoted desc"', '---', '', '# Body'].join('\n')
    const { fields, body } = parseSkillDocument(src)
    expect(fields.name).toBe('demo')
    // 成对引号要被剥掉
    expect(fields.description).toBe('quoted desc')
    expect(body.startsWith('\n# Body')).toBe(true)
  })

  it('parses CRLF frontmatter (Windows checkout must not leak YAML into the body)', () => {
    const src = ['---', 'name: demo', 'description: crlf desc', '---', '', '# Body'].join('\r\n')
    const { fields, body } = parseSkillDocument(src)
    expect(fields.description).toBe('crlf desc')
    expect(body.includes('description:')).toBe(false)
    expect(body.includes('# Body')).toBe(true)
  })

  it('returns the source untouched when there is no frontmatter', () => {
    const src = '# Just a body\n'
    const { fields, body } = parseSkillDocument(src)
    expect(fields).toEqual({})
    expect(body).toBe(src)
  })

  it('tolerates an unterminated frontmatter block', () => {
    const src = '---\nname: demo\n# no closing fence\n'
    const { fields, body } = parseSkillDocument(src)
    expect(fields).toEqual({})
    expect(body).toBe(src)
  })
})

describe('skillProvider', () => {
  it('lists exactly one bundled candidate with the contract fields', async () => {
    const candidates = await skillProvider.list()
    expect(candidates).toHaveLength(1)
    const [c] = candidates as Array<Record<string, unknown>>
    expect(c.name).toBe('bcdp-browser')
    expect(typeof c.description).toBe('string')
    expect((c.description as string).length).toBeGreaterThan(0)
    expect(c.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(c.source).toBe('bundled')
    expect(c.rank).toBe(600)
    expect(c.resourceBase).toMatchObject({ kind: 'directory' })
  })

  it('returns the body without frontmatter for the matching name', async () => {
    const doc = await skillProvider.get({ name: 'bcdp-browser' })
    expect(doc).toBeDefined()
    const content = (doc as { content: string }).content
    expect(content).toContain('# bcdp-browser')
    // frontmatter 不能被当正文带出去
    expect(content.startsWith('---')).toBe(false)
    expect(content.includes('description: Drive a visible agent browser')).toBe(false)
  })

  it('returns undefined for an unknown skill name', async () => {
    await expect(skillProvider.get({ name: 'not-this-skill' })).resolves.toBeUndefined()
  })
})
