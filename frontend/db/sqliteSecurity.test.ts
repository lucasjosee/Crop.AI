import { describe, expect, it } from 'vitest';
import { assertSqlCipherAvailable } from './security';

describe('SQLCipher security gate', () => {
  it('aceita somente build SQLCipher com cipher_version confirmado', () => {
    expect(() => assertSqlCipherAvailable(true, '4.6.1 community')).not.toThrow();
  });

  it('falha fechado quando a biblioteca não foi compilada com SQLCipher', () => {
    expect(() => assertSqlCipherAvailable(false, undefined)).toThrow(
      'Banco local seguro indisponível neste build.'
    );
  });

  it('falha fechado quando o PRAGMA não confirma a cifra', () => {
    expect(() => assertSqlCipherAvailable(true, '')).toThrow(
      'Não foi possível confirmar a criptografia do banco local.'
    );
  });
});
