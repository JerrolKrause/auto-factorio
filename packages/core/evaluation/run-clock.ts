export interface RunClock {
  originTick: number; originWallMs: number; gameLimitTicks: number; wallLimitMs: number;
}
/** Persist the origins once per run; pause and controller replacement never replenish limits. */
export function runDeadline(clock: RunClock, tick: number, wallMs: number): string | null {
  if (![clock.originTick, clock.originWallMs, clock.gameLimitTicks, clock.wallLimitMs, tick, wallMs].every(v => Number.isSafeInteger(v) && v >= 0) || !clock.gameLimitTicks || !clock.wallLimitMs || tick < clock.originTick || wallMs < clock.originWallMs) return 'scenario_clock_invalid';
  if (wallMs - clock.originWallMs >= clock.wallLimitMs) return 'scenario_wall_deadline';
  if (tick - clock.originTick > clock.gameLimitTicks) return 'scenario_game_deadline';
  return null;
}
