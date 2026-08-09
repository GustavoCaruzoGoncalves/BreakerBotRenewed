import { describe, expect, it } from 'vitest';
import {
  calculateLevel,
  computeMultiplier,
  computeProgress,
  enrichUserInfo,
  getRequiredXP,
  getUserRank,
  maxPrestiges,
  xpForLevel,
} from '../src/services/level.js';
import type { LevelSource } from '../src/services/level.js';

describe('curva de XP', () => {
  it('usa incremento de 10 XP até o nível 9 e de 100 XP a partir do 10', () => {
    expect(getRequiredXP(1)).toBe(100);
    expect(getRequiredXP(9)).toBe(180);
    expect(getRequiredXP(10)).toBe(190);
    expect(getRequiredXP(11)).toBe(290);
  });

  it('calculateLevel é o inverso de xpForLevel', () => {
    for (const level of [1, 2, 5, 10, 25, 60]) {
      expect(calculateLevel(xpForLevel(level))).toBe(level);
      expect(calculateLevel(xpForLevel(level) - 1)).toBe(Math.max(1, level - 1));
    }
  });
});

describe('getUserRank', () => {
  it('mapeia os limites de cada elo', () => {
    expect(getUserRank(1).name).toContain('Bronze');
    expect(getUserRank(5).name).toContain('Bronze');
    expect(getUserRank(6).name).toContain('Prata');
    expect(getUserRank(201).name).toContain('Transcendente');
  });

  it('cai no último elo para níveis fora da tabela', () => {
    expect(getUserRank(99999).name).toContain('Transcendente');
  });
});

describe('multiplicadores e progresso', () => {
  it('soma prestígio e bônus diário', () => {
    expect(computeMultiplier({ prestige: 0, dailyBonusMultiplier: 0 })).toEqual({
      prestige: 1,
      daily: 0,
      total: 1,
    });
    expect(computeMultiplier({ prestige: 2, dailyBonusMultiplier: 1 })).toEqual({
      prestige: 2,
      daily: 1,
      total: 3,
    });
  });

  it('limita o progresso ao XP do próximo nível', () => {
    const progress = computeProgress({ xp: xpForLevel(3) + 50, level: 3 });
    expect(progress.progressXP).toBe(50);
    expect(progress.nextLevelXP).toBe(getRequiredXP(3));
    expect(progress.neededXP).toBe(getRequiredXP(3) - 50);
  });

  it('maxPrestiges libera um a cada 10 níveis', () => {
    expect(maxPrestiges(9)).toBe(0);
    expect(maxPrestiges(10)).toBe(1);
    expect(maxPrestiges(35)).toBe(3);
  });
});

describe('enrichUserInfo', () => {
  it('preserva os campos originais e agrega elo e multiplicadores', () => {
    const user: LevelSource = { xp: 250, level: 3, prestige: 1, dailyBonusMultiplier: 0 };
    const enriched = enrichUserInfo(user);
    expect(enriched.xp).toBe(250);
    expect(enriched.rank.name).toContain('Bronze');
    expect(enriched.prestigeMultiplier).toBe(1.5);
    expect(enriched.totalMultiplier).toBe(1.5);
  });
});
