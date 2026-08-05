export function assertSqlCipherAvailable(
  compiledWithSqlCipher: boolean,
  cipherVersion?: unknown
): void {
  if (!compiledWithSqlCipher) {
    throw new Error('Banco local seguro indisponível neste build.');
  }
  if (typeof cipherVersion !== 'string' || cipherVersion.trim() === '') {
    throw new Error('Não foi possível confirmar a criptografia do banco local.');
  }
}
