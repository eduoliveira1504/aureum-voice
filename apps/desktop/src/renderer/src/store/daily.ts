import { create } from 'zustand'

import { loadSummary, type DailyResult, type DailySummary } from '../lib/daily'

/** Home's "Jogos do dia" card: today's games, my results, the streak and friends who played. */
interface DailyState {
  summary: DailySummary | null
  failed: boolean
  load(): Promise<void>
  /** A game was just solved: shows it right away, then refreshes the streak. */
  solved(result: DailyResult): void
}

export const useDaily = create<DailyState>()((set, get) => ({
  summary: null,
  failed: false,
  load: async () => {
    try {
      const summary = await loadSummary()
      // An API without the games (older, or something in between) answers something else.
      if (!Array.isArray(summary?.games)) throw new Error('No daily games')
      set({ summary, failed: false })
    } catch {
      set({ failed: get().summary === null })
    }
  },
  solved: (result) => {
    set((s) =>
      s.summary && s.summary.day === result.day
        ? { summary: { ...s.summary, results: [...s.summary.results.filter((r) => r.game !== result.game), result] } }
        : s
    )
    void get().load()
  }
}))
