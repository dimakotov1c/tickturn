export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type TurnRecord = {
  id: string
  text: string
  seconds: number
  reason: TurnReason
  /** The transcript row of the prompt that started the turn, for scrolling to it. */
  messageId?: string
}

export type RunningTurn = {
  id: string
  text: string
  startedAt: number
  messageId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'tickturn': { turns: TurnRecord[]; running: RunningTurn | null }
  }
}
