import { describe, expect, it } from 'vitest';

function matchesPurgeGroupCommand(lower: string): boolean {
  const PURGE_GROUP = '!limparmemoriagrupo';
  return (
    lower === PURGE_GROUP ||
    lower.startsWith(`${PURGE_GROUP} `) ||
    lower === '!resetmemoriagrupo' ||
    lower.startsWith('!resetmemoriagrupo ')
  );
}

describe('comandos opencode (case-insensitive)', () => {
  it('aceita !limparMemoriaGrupo', () => {
    expect(matchesPurgeGroupCommand('!limparmemoriagrupo')).toBe(true);
    expect(matchesPurgeGroupCommand('!limparMemoriaGrupo'.toLowerCase())).toBe(true);
  });
});
