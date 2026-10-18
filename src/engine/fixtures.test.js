import { describe, expect, it } from 'vitest'
import { humanize } from './index.js'

const FIXTURES = [
  {
    name: 'AI-style essay',
    text: 'In today’s rapidly evolving world, it is important to note that technology plays a pivotal role. Furthermore, it is essential to leverage a wide range of tools in order to foster meaningful change.',
  },
  {
    name: 'email',
    text: 'Hi Jordan,\n\nI hope this email finds you well. I wanted to reach out and ask if you are able to share the latest report. Thank you in advance!\n\nBest,\nMina',
  },
  {
    name: 'product description',
    text: 'Meet the Nova bottle: a lightweight, durable design that keeps drinks cold for 24 hours. Its leak-proof lid fits most bags, and the wide opening makes it easy to clean.',
  },
  {
    name: 'academic abstract',
    text: 'This study examines how shade cover affects soil moisture in urban gardens. We measured twelve plots over eight weeks and found that shaded plots retained more water after rainfall. The results suggest that small planting changes can reduce summer watering needs.',
  },
  {
    name: 'list-heavy text',
    text: 'Key steps:\n- First, collect the samples.\n- Next, record the temperature.\n- Finally, compare the readings and share the results.',
  },
  {
    name: 'quotes and code',
    text: 'The reviewer wrote, “The change is significant and the approach is crucial.”\n\n```js\nconst result  = 42;\nconsole.log(result);\n```\n\nThe code prints one value.',
  },
  {
    name: 'very short text',
    text: 'Good work.',
  },
  {
    name: 'text with no markers',
    text: 'Mira packed lunch, caught the bus, and read a novel by the window. The afternoon passed quietly.',
  },
  {
    name: 'text with many markers',
    text: 'In today’s fast-paced world, we utilize a comprehensive framework to facilitate meaningful outcomes. Furthermore, this pivotal approach plays a crucial role and serves as a testament to substantial progress.',
  },
  {
    name: 'mixed languages',
    text: 'The team reviewed the draft together. Después, el equipo compartió sus ideas con la comunidad y habló sobre los próximos pasos.',
  },
]

describe('representative writing fixtures', () => {
  it('is deterministic and settles after one pass on the stress sample', () => {
    const input = 'In today’s fast-paced world, we utilize a comprehensive framework to facilitate meaningful outcomes. Furthermore, this pivotal approach plays a crucial role and serves as a testament to substantial progress. It is important to note that the team is able to improve the result.'
    const options = { seed: 2401, intensity: 'strong', synonyms: true }
    const first = humanize(input, options)
    const repeated = humanize(input, options)
    const second = humanize(first.output, options)
    const firstCount = first.changes.filter(change => !change.superseded).length
    const secondCount = second.changes.filter(change => !change.superseded).length
    expect(repeated.output).toBe(first.output)
    expect(repeated.changes).toEqual(first.changes)
    expect(secondCount).toBeLessThan(firstCount * 0.15)
  })
  it.each(FIXTURES)('$name keeps final change coordinates aligned and matches its snapshot', fixture => {
    const result = humanize(fixture.text, { seed: 731, intensity: 'strong', synonyms: true })
    for (const change of result.changes) {
      if (change.superseded) continue
      expect(result.output.slice(change.finalStart, change.finalEnd)).toBe(change.replacement)
    }
    expect(result.output).toMatchSnapshot(fixture.name)
  })
})
