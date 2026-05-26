import { db, pool } from '../index';
import { culturas, doencas, defensivos, doencaDefensivo } from '../schema';
import culturasData from './culturas.json';
import doencasData from './doencas.json';
import defensivosData from './defensivos.json';
import relationsData from './doenca_defensivo.json';

async function seed() {
  console.log('🌱 Starting seed...');

  try {
    // 1. Seed culturas
    console.log('Inserting culturas...');
    const mappedCulturas = culturasData.map((c) => ({
      id: c.id,
      nome: c.nome,
      estagioFenologicoPadrao: c.estagioFenologicoPadrao,
      isActive: c.isActive ?? true,
    }));
    await db.insert(culturas).values(mappedCulturas).onConflictDoNothing({ target: culturas.id });

    // 2. Seed doencas
    console.log('Inserting doencas...');
    const mappedDoencas = doencasData.map((d) => ({
      id: d.id,
      idCultura: d.id_cultura,
      nomeComum: d.nome_comum,
      nomeCientifico: d.nome_cientifico || null,
      sintomas: d.sintomas,
      nivelSeveridade: d.nivel_severidade,
      isActive: true,
    }));
    await db.insert(doencas).values(mappedDoencas).onConflictDoNothing({ target: doencas.id });

    // 3. Seed defensivos
    console.log('Inserting defensivos...');
    const mappedDefensivos = defensivosData.map((def) => ({
      id: def.id,
      nomeComercial: def.nome_comercial,
      ingredienteAtivo: def.ingrediente_ativo,
      fabricante: def.fabricante || null,
      classe: def.classe,
      grupoQuimicoFrac: def.grupo_quimico_frac || null,
      bulaResumida: def.bula_resumida,
      isActive: true,
    }));
    await db.insert(defensivos).values(mappedDefensivos).onConflictDoNothing({ target: defensivos.id });

    // 4. Seed doenca_defensivo
    console.log('Inserting doenca_defensivo...');
    const mappedRelations = relationsData.map((rel) => ({
      idDoenca: rel.doenca_id,
      idDefensivo: rel.defensivo_id,
      dosagemRecomendada: rel.dosagem_recomendada,
      carenciaDias: rel.carencia_dias,
      maxAplicacoesCiclo: rel.max_aplicacoes_ciclo,
      observacao: rel.observacao,
    }));
    await db.insert(doencaDefensivo)
      .values(mappedRelations)
      .onConflictDoNothing({ target: [doencaDefensivo.idDoenca, doencaDefensivo.idDefensivo] });

    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Error during seed:', error);
  } finally {
    await pool.end();
  }
}

seed();
