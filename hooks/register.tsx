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

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

const label = (text: string) => {
  const one = Array.from(norm(text))
  if (one.length === 0) return '(без текста)'
  return one.length > LABEL_CHARS
    ? one.slice(0, LABEL_CHARS - 1).join('') + '…'
    : one.join('')
}

const mark = (reason: TurnRecord['reason']) =>
  reason === 'aborted' ? ' (прервано)' : reason === 'answer' ? '' : ' (ошибка)'

type PromptRow = { uuid: string; text: string }

export const register: Register = on => {
  let isRunning = false
  // The person's prompt row appended before its turn.start arrived.
  let pendingPrompt: PromptRow | null = null

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

  // The prompt's transcript row: its uuid is what the pane scrolls to.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const text = e.message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    const row: PromptRow = { uuid: e.uuid, text }
    const current = await read($, running)
    if (current !== null && current.messageId === undefined && norm(current.text) === norm(text)) {
      await update($, running, r => (r ? { ...r, messageId: row.uuid } : r))
    } else {
      pendingPrompt = row
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const pending = pendingPrompt
    pendingPrompt = null
    const turn: RunningTurn = {
      id: e.turnId,
      text: e.text,
      startedAt: await $.clock.now(),
      ...(pending !== null && norm(pending.text) === norm(e.text) ? { messageId: pending.uuid } : {}),
    }
    await update($, running, () => turn)
    isRunning = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const current = await read($, running)
    const own = current?.id === e.turnId ? current : null
    const record: TurnRecord = {
      id: e.turnId,
      text: own?.text ?? '',
      seconds: Math.round(e.durationMs / 1000),
      reason: e.reason,
      ...(own?.messageId !== undefined ? { messageId: own.messageId } : {}),
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, turns)
    const current = await read($, running)
    const done = list.reduce((sum, t) => sum + t.seconds, 0)
    const now = current ? Math.round(((await $.clock.now()) - current.startedAt) / 1000) : 0

    type Row = { id: string; n: number; text: string; time: string; messageId?: string }
    const rows: Row[] = list.map((t, i) => ({
      id: t.id,
      n: i + 1,
      text: label(t.text) + mark(t.reason),
      time: fmt(t.seconds),
      ...(t.messageId !== undefined ? { messageId: t.messageId } : {}),
    }))
    if (current) {
      rows.push({
        id: current.id,
        n: rows.length + 1,
        text: label(current.text) + ' …',
        time: fmt(now),
        ...(current.messageId !== undefined ? { messageId: current.messageId } : {}),
      })
    }

    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const shown = rows.slice(-room)

    const jumpTo = (messageId: string) => async () => {
      const moved = await $.ui.scroll({ to: { requestId: messageId }, block: 'center' })
      if (moved.deny !== undefined) $.ui.toast(`Не удалось перейти к сообщению: ${moved.deny}`)
    }

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Запросов ещё не было.</Text>}
        {rows.length > shown.length && (
          <Text dimColor>… ещё {rows.length - shown.length} выше</Text>
        )}
        {shown.map(row => (
          <Box key={`row:${row.id}`} justifyContent="space-between" gap={1}>
            {row.messageId !== undefined ? (
              <Button key={`jump:${row.id}`} plain onPress={jumpTo(row.messageId)}>
                {row.n}. {row.text}
              </Button>
            ) : (
              <Text>
                {row.n}. {row.text}
              </Text>
            )}
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
