import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RunningTurn, TurnRecord } from '../types'

const PANE = 'tickturn'
const COMMAND = 'time'
const MAX_TURNS = 500
const LABEL_CHARS = 25

const turns = atom({ plugin: 'tickturn', key: 'turns' } as const, [])
const running = atom({ plugin: 'tickturn', key: 'running' } as const, null)

const pad = (n: number) => String(n).padStart(2, '0')

const fmt = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const label = (text: string) => {
  const one = Array.from(text.replace(/\s+/g, ' ').trim())
  if (one.length === 0) return '(без текста)'
  return one.length > LABEL_CHARS
    ? one.slice(0, LABEL_CHARS - 1).join('') + '…'
    : one.join('')
}

const mark = (reason: TurnRecord['reason']) =>
  reason === 'aborted' ? ' (прервано)' : reason === 'answer' ? '' : ' (ошибка)'

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Время по запросам этой сессии в панели',
    })
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
    const opened = await $.ui.open({ id: PANE, title: 'Время по запросам' })

    return {
      text: opened.isPlaced
        ? 'Панель времени открыта.'
        : `Не удалось открыть панель: ${opened.reason}`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const list = await read($, turns)
    const current = await read($, running)
    if (list.length === 0 && current === null) return next(e)

    const done = list.reduce((sum, t) => sum + t.seconds, 0)
    const now = current ? Math.round(((await $.clock.now()) - current.startedAt) / 1000) : 0
    const last = list[list.length - 1]
    const head = current
      ? `⏱ Идёт: ${fmt(now)}`
      : last !== undefined
        ? `⏱ Последний: ${fmt(last.seconds)}${mark(last.reason)}`
        : '⏱'
    const count = list.length + (current ? 1 : 0)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        <Text dimColor>
          {head} · Сессия: {fmt(done + now)} · запросов: {count}
        </Text>
        <Button
          key="history"
          label="История"
          onPress={() => $.ui.open({ id: PANE, title: 'Время по запросам' })}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, turns)
    const current = await read($, running)
    const done = list.reduce((sum, t) => sum + t.seconds, 0)
    const now = current ? Math.round(((await $.clock.now()) - current.startedAt) / 1000) : 0

    const rows: { n: number; text: string; time: string }[] = list.map((t, i) => ({
      n: i + 1,
      text: label(t.text) + mark(t.reason),
      time: fmt(t.seconds),
    }))
    if (current) {
      rows.push({ n: rows.length + 1, text: label(current.text) + ' …', time: fmt(now) })
    }

    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const shown = rows.slice(-room)

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Запросов ещё не было.</Text>}
        {rows.length > shown.length && (
          <Text dimColor>… ещё {rows.length - shown.length} выше</Text>
        )}
        {shown.map(row => (
          <Box key={String(row.n)} justifyContent="space-between" gap={1}>
            <Text>
              {row.n}. {row.text}
            </Text>
            <Text>{row.time}</Text>
          </Box>
        ))}
        <Box justifyContent="space-between" gap={1} marginTop={1}>
          <Text bold>Итого ({rows.length})</Text>
          <Text bold>{fmt(done + now)}</Text>
        </Box>
      </Box>
    )
  })
}
