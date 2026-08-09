import { describe, expect, it } from 'vitest';
import {
  MISSIONS,
  MISSION_IDS,
  formatAura,
  getTier,
  resetMissionsIfNeeded,
  toDateStr,
  todayStr,
} from '../src/services/aura.js';
import type { Aura } from '../src/database/types.js';

function makeAura(overrides: Partial<Aura> = {}): Aura {
  return {
    auraPoints: 0,
    stickerHash: null,
    stickerDataUrl: null,
    character: null,
    dailyMissions: {
      lastResetDate: todayStr(),
      drawnMissions: ['duel_win'],
      completedMissionIds: [],
      progress: {},
    },
    lastRitualDate: null,
    lastTreinarAt: null,
    lastDominarAt: null,
    negativeFarmPunished: false,
    ...overrides,
  };
}

describe('getTier', () => {
  it('mapeia pontos para as categorias', () => {
    expect(getTier(0).name).toBe('NPC');
    expect(getTier(499).name).toBe('NPC');
    expect(getTier(500).name).toBe('Presença');
    expect(getTier(50000).name).toBe('Deus do chat');
    expect(getTier(-1).name).toContain('Sugador de aura');
  });

  it('trata valores não numéricos como zero', () => {
    expect(getTier(null).name).toBe('NPC');
    expect(getTier(undefined).name).toBe('NPC');
  });
});

describe('formatAura', () => {
  it('formata no padrão pt-BR sem casas decimais', () => {
    expect(formatAura(1000)).toBe('1.000');
    expect(formatAura('2500')).toBe('2.500');
    expect(formatAura(null)).toBe('0');
  });
});

describe('toDateStr', () => {
  it('normaliza string e Date para YYYY-MM-DD', () => {
    expect(toDateStr('2026-08-09T12:34:56Z')).toBe('2026-08-09');
    expect(toDateStr(new Date(2026, 7, 9))).toBe('2026-08-09');
    expect(toDateStr(null)).toBeNull();
  });
});

describe('resetMissionsIfNeeded', () => {
  it('não reseta quando as missões são de hoje', () => {
    const aura = makeAura();
    expect(resetMissionsIfNeeded(aura)).toBe(false);
    expect(aura.dailyMissions.drawnMissions).toEqual(['duel_win']);
  });

  it('sorteia 3 missões quando a data mudou', () => {
    const aura = makeAura({
      dailyMissions: {
        lastResetDate: '2020-01-01',
        drawnMissions: ['duel_win'],
        completedMissionIds: ['duel_win'],
        progress: { duelWin: 1 },
      },
    });
    expect(resetMissionsIfNeeded(aura)).toBe(true);
    expect(aura.dailyMissions.drawnMissions).toHaveLength(3);
    expect(aura.dailyMissions.completedMissionIds).toEqual([]);
    expect(aura.dailyMissions.lastResetDate).toBe(todayStr());
  });

  it('sorteia missões quando a lista está vazia', () => {
    const aura = makeAura({
      dailyMissions: {
        lastResetDate: todayStr(),
        drawnMissions: [],
        completedMissionIds: [],
        progress: {},
      },
    });
    expect(resetMissionsIfNeeded(aura)).toBe(true);
    expect(aura.dailyMissions.drawnMissions).toHaveLength(3);
  });
});

describe('MISSIONS', () => {
  it('define uma configuração para cada id', () => {
    for (const id of MISSION_IDS) {
      const cfg = MISSIONS[id];
      expect(cfg.target).toBeGreaterThan(0);
      expect(cfg.reward).toBeGreaterThan(0);
      expect(cfg.label).not.toBe('');
    }
  });
});
