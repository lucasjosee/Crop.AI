import { describe, it, expect } from 'vitest';
import { nomeDoBancoEhDeTeste } from './guarda-banco';

describe('nomeDoBancoEhDeTeste', () => {
  it('aceita os bancos de teste do CI e da receita local', () => {
    expect(nomeDoBancoEhDeTeste('postgres://u:p@localhost:5432/cropai_test')).toBe(true);
    expect(nomeDoBancoEhDeTeste('postgres://teste:teste@127.0.0.1:55432/cropai_teste')).toBe(true);
  });

  it('recusa o banco de desenvolvimento e qualquer outro sem "test" no nome', () => {
    expect(nomeDoBancoEhDeTeste('postgres://u:p@localhost:5432/app_diagnostico')).toBe(false);
    expect(nomeDoBancoEhDeTeste('postgres://u:p@localhost:5432/producao')).toBe(false);
  });

  it('olha o nome do banco, não o usuário nem o host', () => {
    expect(nomeDoBancoEhDeTeste('postgres://test:test@test-host:5432/app_diagnostico')).toBe(false);
  });

  it('recusa URL ausente, vazia ou malformada', () => {
    expect(nomeDoBancoEhDeTeste(undefined)).toBe(false);
    expect(nomeDoBancoEhDeTeste('')).toBe(false);
    expect(nomeDoBancoEhDeTeste('isto nao e uma url')).toBe(false);
  });
});
