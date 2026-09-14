import { describe, it, expect, vi } from 'vitest';

vi.mock('./diagnosisDetails', () => ({
  resolveDiseaseName: vi.fn(async (id: string) =>
    id === 'Saudável' ? 'Planta saudável' : id === 'Fitotoxicidade' ? 'Fitotoxicidade' : 'Ferrugem asiática'
  ),
}));

import {
  classificarPino,
  estadoDoMapa,
  montarPinos,
  regiaoInicial,
  resumoDoMapa,
  REGIAO_PADRAO,
  type PinoMapa,
} from './mapPins';
import type { MapSession } from './chatRepository';

function linha(over: Partial<MapSession> = {}): MapSession {
  return {
    sessionId: 's1',
    title: 'Conversa',
    createdAt: '2026-09-14T10:00:00.000Z',
    latitude: -23.5,
    longitude: -46.6,
    doencaId: null,
    confiancaIa: 0.9,
    crossValidationStatus: null,
    imageUri: 'file:///f.jpg',
    attachmentJson: '{"cvResult":{"diseaseId":"Saudável"}}',
    ...over,
  };
}

function pino(lat: number, lng: number): PinoMapa {
  return {
    sessionId: `${lat},${lng}`,
    latitude: lat,
    longitude: lng,
    tipo: 'PROBLEMA',
    doencaNome: 'Ferrugem asiática',
    dataRelativa: 'Ontem',
    imageUri: null,
  };
}

describe('montarPinos', () => {
  const agora = new Date(2026, 8, 14, 15, 0, 0);

  it('Saudável é o único pino verde', async () => {
    const [p] = await montarPinos([linha()], agora);
    expect(p.tipo).toBe('SAUDAVEL');
    expect(p.doencaNome).toBe('Planta saudável');
  });

  it('Fitotoxicidade é problema, não saúde', async () => {
    const [p] = await montarPinos(
      [linha({ attachmentJson: '{"cvResult":{"diseaseId":"Fitotoxicidade"}}' })],
      agora
    );
    expect(p.tipo).toBe('PROBLEMA');
    expect(p.doencaNome).toBe('Fitotoxicidade');
  });

  it('doença do catálogo é problema', async () => {
    const [p] = await montarPinos(
      [linha({ attachmentJson: '{"cvResult":{"diseaseId":"uuid-ferrugem"}}' })],
      agora
    );
    expect(p.tipo).toBe('PROBLEMA');
    expect(p.doencaNome).toBe('Ferrugem asiática');
  });

  it('anexo ausente sinaliza problema em vez de afirmar saúde', async () => {
    const [p] = await montarPinos([linha({ attachmentJson: null })], agora);
    expect(p.tipo).toBe('PROBLEMA');
    expect(p.doencaNome).toBe('Análise sem classe registrada');
  });

  it('JSON inválido não quebra o mapa', async () => {
    const [p] = await montarPinos([linha({ attachmentJson: '{quebrado' })], agora);
    expect(p.tipo).toBe('PROBLEMA');
    expect(p.doencaNome).toBe('Análise sem classe registrada');
  });

  it('leva a data relativa e a foto', async () => {
    const ontem = new Date(2026, 8, 13, 10, 0, 0);
    const [p] = await montarPinos([linha({ createdAt: ontem.toISOString() })], agora);
    expect(p.dataRelativa).toBe('Ontem');
    expect(p.imageUri).toBe('file:///f.jpg');
  });
});

describe('regiaoInicial', () => {
  it('sem pino nenhum devolve a região padrão', () => {
    expect(regiaoInicial([])).toEqual(REGIAO_PADRAO);
  });

  it('um pino só centraliza nele com aproximação fixa', () => {
    const r = regiaoInicial([pino(-23.5, -46.6)]);
    expect(r.latitude).toBeCloseTo(-23.5);
    expect(r.longitude).toBeCloseTo(-46.6);
    expect(r.latitudeDelta).toBe(0.01);
    expect(r.longitudeDelta).toBe(0.01);
  });

  it('vários pinos enquadram todos, com margem de 20%', () => {
    const r = regiaoInicial([pino(-23.0, -46.0), pino(-24.0, -47.0)]);
    expect(r.latitude).toBeCloseTo(-23.5);
    expect(r.longitude).toBeCloseTo(-46.5);
    expect(r.latitudeDelta).toBeCloseTo(1.2);
    expect(r.longitudeDelta).toBeCloseTo(1.2);
  });

  it('pinos no mesmo ponto não colapsam o zoom', () => {
    const r = regiaoInicial([pino(-23.5, -46.6), pino(-23.5, -46.6)]);
    expect(r.latitudeDelta).toBe(0.01);
    expect(r.longitudeDelta).toBe(0.01);
  });
});

describe('classificarPino', () => {
  it('Saudável é o único SAUDAVEL', () => {
    expect(classificarPino('{"cvResult":{"diseaseId":"Saudável"}}')).toBe('SAUDAVEL');
  });

  it('Fitotoxicidade é PROBLEMA, porque é dano químico e não planta sadia', () => {
    expect(classificarPino('{"cvResult":{"diseaseId":"Fitotoxicidade"}}')).toBe('PROBLEMA');
  });

  it('doença do catálogo é PROBLEMA', () => {
    expect(classificarPino('{"cvResult":{"diseaseId":"3f34559c-6a12-4eb2-a42e-cf629ec2e9e6"}}')).toBe(
      'PROBLEMA'
    );
  });

  it('JSON inválido cai em PROBLEMA: na dúvida, sinalizar', () => {
    expect(classificarPino('{isto não é json')).toBe('PROBLEMA');
  });

  it('anexo ausente cai em PROBLEMA', () => {
    expect(classificarPino(null)).toBe('PROBLEMA');
  });
});

describe('resumoDoMapa', () => {
  it('conta total, problemas e saudáveis', () => {
    const linhas = [
      linha({ sessionId: 'a', attachmentJson: '{"cvResult":{"diseaseId":"Saudável"}}' }),
      linha({ sessionId: 'b', attachmentJson: '{"cvResult":{"diseaseId":"Fitotoxicidade"}}' }),
      linha({ sessionId: 'c', attachmentJson: '{"cvResult":{"diseaseId":"Ferrugem"}}' }),
      linha({ sessionId: 'd', attachmentJson: null }),
    ];

    expect(resumoDoMapa(linhas)).toEqual({ total: 4, problemas: 3, saudaveis: 1 });
  });

  it('lista vazia devolve zeros', () => {
    expect(resumoDoMapa([])).toEqual({ total: 0, problemas: 0, saudaveis: 0 });
  });

  it('problemas e saudáveis sempre somam o total', () => {
    const linhas = [linha({ sessionId: 'a' }), linha({ sessionId: 'b', attachmentJson: null })];
    const r = resumoDoMapa(linhas);
    expect(r.problemas + r.saudaveis).toBe(r.total);
  });
});

describe('estadoDoMapa', () => {
  it('PROBING carrega: o app ainda não sabe se há rede', () => {
    expect(estadoDoMapa('PROBING')).toBe('CARREGANDO');
  });

  it('FIELD avisa que o mapa precisa de conexão', () => {
    expect(estadoDoMapa('FIELD')).toBe('SEM_REDE');
  });

  it('ONLINE desenha o mapa', () => {
    expect(estadoDoMapa('ONLINE')).toBe('MAPA');
  });

  it('DEGRADED desenha o mapa: lento ainda é conectado', () => {
    expect(estadoDoMapa('DEGRADED')).toBe('MAPA');
  });
});
