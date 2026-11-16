import { useAuthStore } from '../store/useAuthStore';

/**
 * A única fonte de "quem é o usuário" para o que toca o banco local. Nenhum
 * módulo recebe o id por parâmetro vindo da tela: ler daqui evita que uma tela
 * grave ou leia com um id velho depois de uma troca de conta.
 *
 * Lança sem usuário: depois da v11 não se grava dado sem dono.
 */
export function idDoUsuarioAtual(): string {
  const id = idDoUsuarioAtualOuNulo();
  if (!id) throw new Error('Nenhum usuário autenticado: não há dono para os dados.');
  return id;
}

export function idDoUsuarioAtualOuNulo(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
