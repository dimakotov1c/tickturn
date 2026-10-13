import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'tickturn',
  component: 'Pane',
  requestId: 'tickturn',
  props: {
    title: 'tickturn',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

const emptyText = async ($: Parameters<TestBody>[0]) => {
  const texts: string[] = []
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const found = await ui.findAll({ type: 'Text' })
    texts.push(found.map(f => f.text).join(' | '))
    await ui.unmount()
  }
  return texts
}

test('language option ru draws Russian', { options: { language: 'ru' } }, async ($, on) => {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  for (const text of await emptyText($)) {
    expect(text).toContain('Запросов ещё не было.')
    expect(text).toContain('Итого')
  }
})

test('language option en draws English', { options: { language: 'en' } }, async ($, on) => {
  mock.env(on, { LANG: 'ru_RU.UTF-8' })
  for (const text of await emptyText($)) {
    expect(text).toContain('No requests yet.')
    expect(text).toContain('Total')
  }
})

test('auto reads Russian from LANG', async ($, on) => {
  mock.env(on, { LANG: 'ru_RU.UTF-8' })
  for (const text of await emptyText($)) {
    expect(text).toContain('Запросов ещё не было.')
  }
})

test('auto reads English from LANG, LC_ALL winning over it', async ($, on) => {
  mock.env(on, { LANG: 'ru_RU.UTF-8', LC_ALL: 'en_US.UTF-8' })
  for (const text of await emptyText($)) {
    expect(text).toContain('No requests yet.')
  }
})

test('auto with no locale variables falls back to the environment locale', async ($, on) => {
  mock.env(on, {})
  const expected = /^ru/i.test(Intl.DateTimeFormat().resolvedOptions().locale)
    ? 'Запросов ещё не было.'
    : 'No requests yet.'
  for (const text of await emptyText($)) {
    expect(text).toContain(expected)
  }
})
