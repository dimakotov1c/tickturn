export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type TurnRecord = {
  id: string
  text: string
  seconds: number
  reason: TurnReason
}

export type RunningTurn = {
  id: string
  text: string
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'tickturn': { turns: TurnRecord[]; running: RunningTurn | null }
  }
}
