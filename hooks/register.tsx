import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RunningTurn, TurnRecord } from '../types'

const PANE = 'tickturn'
const COMMAND = 'time'
const MAX_TURNS = 500
const LABEL_CHARS = 25

type Lang = 'ru' | 'en'

const STRINGS = {
  ru: {
    running: 'Идёт',
    last: 'Последний',
    session: 'Сессия',
    requests: 'запросов',
    aborted: ' (прервано)',
    error: ' (ошибка)',
    noText: '(без текста)',
    history: 'История',
    paneTitle: 'Время по запросам',
    empty: 'Запросов ещё не было.',
    more: (n: number) => `… ещё ${n} выше`,
    total: 'Итого',
    command: 'Время по запросам этой сессии в панели',
    opened: 'Панель времени открыта.',
    notOpened: 'Не удалось открыть панель: ',
  },
  en: {
    running: 'Running',
    last: 'Last',
    session: 'Session',
    requests: 'requests',
    aborted: ' (interrupted)',
    error: ' (error)',
    noText: '(no text)',
    history: 'History',
    paneTitle: 'Time per request',
    empty: 'No requests yet.',
    more: (n: number) => `… ${n} more above`,
    total: 'Total',
    command: 'Time per request of this session, in a pane',
    opened: 'Time pane opened.',
    notOpened: 'Could not open the pane: ',
  },
} satisfies Record<Lang, unknown>

type Strings = (typeof STRINGS)[Lang]

const isRussian = (tag: string | undefined) => /^ru(?![a-z])/i.test(tag ?? '')

/** The locale the JS environment runs with: on Windows the user's regional format, on POSIX the LANG-family. */
const intlLocale = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

/**
 * Russian when the mod's `language` option says so, or on `auto` when the
 * first set of `LC_ALL`, `LC_MESSAGES`, `LANG`, `LANGUAGE` names it, or, with
 * none set (Windows), when the environment's own locale is Russian. English otherwise.
 */
const detect = async ($: EngineInterface, option: unknown): Promise<Lang> => {
  if (option === 'ru' || option === 'en') return option

  const posix =
    (await $.env.get('LC_ALL')) ||
    (await $.env.get('LC_MESSAGES')) ||
    (await $.env.get('LANG')) ||
    (await $.env.get('LANGUAGE'))
  if (posix) return isRussian(posix) ? 'ru' : 'en'

  return isRussian(intlLocale()) ? 'ru' : 'en'
}

/** The `language` option as `register` received it, and the detection it led to, once. */
let languageOption: unknown
let language: Promise<Lang> | undefined

const strings = async ($: EngineInterface): Promise<Strings> => {
  language ??= detect($, languageOption)
  return STRINGS[await language]
}

const turns = atom({ plugin: 'tickturn', key: 'turns' } as const, [])
const running = atom({ plugin: 'tickturn', key: 'running' } as const, null)

const pad = (n: number) => String(n).padStart(2, '0')

const fmt = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const label = (text: string, t: Strings) => {
  const one = Array.from(text.replace(/\s+/g, ' ').trim())
  if (one.length === 0) return t.noText
  return one.length > LABEL_CHARS
    ? one.slice(0, LABEL_CHARS - 1).join('') + '…'
    : one.join('')
}

const mark = (reason: TurnRecord['reason'], t: Strings) =>
  reason === 'aborted' ? t.aborted : reason === 'answer' ? '' : t.error

export const register: Register = (on, options) => {
  let isRunning = false
  languageOption = options.language
  language = undefined

  on('session.start', async ($, e, next) => {
    const t = await strings($)
    await $.command.register({ name: COMMAND, description: t.command })
    isRunning = (await read($, running)) !== null
    $.clock.every(1000, () => {
      if (isRunning) $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const turn: RunningTurn = {
      id: e.turnId,
      text: e.text,
      startedAt: await $.clock.now(),
    }
    await update($, running, () => turn)
    isRunning = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const current = await read($, running)
    const record: TurnRecord = {
      id: e.turnId,
      text: current?.id === e.turnId ? current.text : '',
      seconds: Math.round(e.durationMs / 1000),
      reason: e.reason,
    }
    await update($, turns, list => [...list, record].slice(-MAX_TURNS))
    await update($, running, () => null)
    isRunning = false

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, turns, () => [])
      await update($, running, () => null)
      isRunning = false
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const t = await strings($)
    const opened = await $.ui.open({ id: PANE, title: t.paneTitle })

    return { text: opened.isPlaced ? t.opened : `${t.notOpened}${opened.reason}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const list = await read($, turns)
    const current = await read($, running)
    if (list.length === 0 && current === null) return next(e)

    const t = await strings($)
    const done = list.reduce((sum, turn) => sum + turn.seconds, 0)
    const now = current ? Math.round(((await $.clock.now()) - current.startedAt) / 1000) : 0
    const last = list[list.length - 1]
    const head = current
      ? `⏱ ${t.running}: ${fmt(now)}`
      : last !== undefined
        ? `⏱ ${t.last}: ${fmt(last.seconds)}${mark(last.reason, t)}`
        : '⏱'
    const count = list.length + (current ? 1 : 0)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        <Text dimColor>
          {head} · {t.session}: {fmt(done + now)} · {t.requests}: {count}
        </Text>
        <Button
          key="history"
          label={t.history}
          onPress={() => $.ui.open({ id: PANE, title: t.paneTitle })}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await strings($)
    const list = await read($, turns)
    const current = await read($, running)
    const done = list.reduce((sum, turn) => sum + turn.seconds, 0)
    const now = current ? Math.round(((await $.clock.now()) - current.startedAt) / 1000) : 0

    const rows: { n: number; text: string; time: string }[] = list.map((turn, i) => ({
      n: i + 1,
      text: label(turn.text, t) + mark(turn.reason, t),
      time: fmt(turn.seconds),
    }))
    if (current) {
      rows.push({ n: rows.length + 1, text: label(current.text, t) + ' …', time: fmt(now) })
    }

    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const shown = rows.slice(-room)

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>{t.empty}</Text>}
        {rows.length > shown.length && <Text dimColor>{t.more(rows.length - shown.length)}</Text>}
        {shown.map(row => (
          <Box key={String(row.n)} justifyContent="space-between" gap={1}>
            <Text>
              {row.n}. {row.text}
            </Text>
            <Text>{row.time}</Text>
          </Box>
        ))}
        <Box justifyContent="space-between" gap={1} marginTop={1}>
          <Text bold>
            {t.total} ({rows.length})
          </Text>
          <Text bold>{fmt(done + now)}</Text>
        </Box>
      </Box>
    )
  })
}
