import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../store/useAuthStore';
import { dbDriver } from '../db/sqlite';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { theme } from '../config/theme';

export default function HomeScreen() {
  const { user, logout } = useAuthStore();
  const [diseases, setDiseases] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbLoading, setDbLoading] = useState(false);

  // Carrega contadores e dados locais ao montar
  useEffect(() => {
    updateOfflineQueueCount();
  }, []);

  const updateOfflineQueueCount = async () => {
    try {
      const res = await dbDriver.execute(
        "SELECT * FROM fila_diagnosticos WHERE sync_status = 'PENDING';"
      );
      setPendingCount(res.rows.length);
    } catch (e) {
      console.error('[HomeScreen] Failed to read diagnostic queue:', e);
    }
  };

  const handleLoadCatalog = async () => {
    try {
      setDbLoading(true);
      const res = await dbDriver.execute('SELECT * FROM doencas;');
      
      const list = [];
      for (let i = 0; i < res.rows.length; i++) {
        list.push(res.rows.item(i));
      }
      
      setDiseases(list);
      Toast.show({
        type: 'success',
        text1: 'Catálogo Carregado!',
        text2: `${list.length} doenças encontradas na base local.`,
      });
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Erro de Banco de Dados',
        text2: 'Não foi possível ler as doenças locais.',
      });
    } finally {
      setDbLoading(false);
    }
  };

  const handleAddMockDiagnostic = async () => {
    try {
      const mockId = `local-${Math.random().toString(36).substring(2, 9)}`;
      
      // Inserir registro mockado na fila local do SQLite (Store & Forward)
      await dbDriver.execute(
        `INSERT INTO fila_diagnosticos (
          local_id, server_id, image_uri, image_s3_key, latitude, longitude, 
          doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms, sync_status, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          mockId,
          null, // server_id pendente
          'file:///mock/path/diagnostico_folha.jpg',
          null, // s3 key pendente
          -23.55052,
          -46.633309,
          'doenca_ferrugem_asiatica',
          0.94,
          'tflite_v1.0',
          35, // 35ms inferência
          'PENDING',
          0
        ]
      );

      await updateOfflineQueueCount();
      
      Toast.show({
        type: 'success',
        text1: 'Diagnóstico Enfileirado!',
        text2: 'Salvo localmente com sucesso (offline-first).',
      });
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Erro de Banco',
        text2: 'Falha ao salvar diagnóstico localmente.',
      });
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      Toast.show({
        type: 'success',
        text1: 'Desconectado',
        text2: 'Sessão encerrada com sucesso.',
      });
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Erro ao deslogar',
        text2: 'Tente novamente.',
      });
    }
  };

  const severityMapping = (level: number): 'info' | 'warning' | 'error' | 'success' => {
    if (level <= 2) return 'success';
    if (level <= 3) return 'warning';
    return 'error';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Cabeçalho */}
        <View style={styles.header}>
          <Text style={styles.logo}>Crop.AI</Text>
          <ConnectionIndicator />
        </View>

        {/* Card do Usuário */}
        <Card style={styles.userCard}>
          <Text style={styles.welcomeText}>Bem-vindo de volta,</Text>
          <Text style={styles.userName}>{user?.nome || 'Produtor'}</Text>
          <Text style={styles.userRole}>Nível de Acesso: {user?.role || 'Produtor'}</Text>
          <Text style={styles.userEmail}>E-mail: {user?.email}</Text>
          <Button 
            title="Sair da Conta" 
            onPress={handleLogout} 
            variant="secondary" 
            style={styles.logoutBtn} 
          />
        </Card>

        {/* Seção Store & Forward */}
        <Card style={styles.syncCard}>
          <Text style={styles.sectionTitle}>Sincronização Offline (Store & Forward)</Text>
          <View style={styles.queueInfo}>
            <Text style={styles.queueLabel}>Diagnósticos pendentes de rede:</Text>
            <Badge 
              text={`${pendingCount} itens`} 
              type={pendingCount > 0 ? 'warning' : 'success'} 
            />
          </View>
          <Button 
            title="Criar Diagnóstico Offline (Mock)" 
            onPress={handleAddMockDiagnostic} 
            style={styles.actionBtn}
          />
        </Card>

        {/* Seção Banco de Dados Local */}
        <Card style={styles.dbCard}>
          <Text style={styles.sectionTitle}>Base de Conhecimento Local (SQLite)</Text>
          <Text style={styles.dbDescription}>
            Consulte a base de dados de patologias local criptografada com SQLCipher.
          </Text>
          <Button 
            title="Consultar Catálogo Local" 
            onPress={handleLoadCatalog} 
            loading={dbLoading}
            style={styles.actionBtn}
          />

          {diseases.length > 0 && (
            <View style={styles.diseaseList}>
              <Text style={styles.listHeader}>Doenças Encontradas:</Text>
              {diseases.map((d) => (
                <View key={d.id} style={styles.diseaseItem}>
                  <View style={styles.diseaseMeta}>
                    <Text style={styles.diseaseName}>{d.nome_comum}</Text>
                    <Text style={styles.diseaseScientific}>{d.nome_cientifico}</Text>
                  </View>
                  <Badge 
                    text={`Nível ${d.nivel_severidade}`} 
                    type={severityMapping(d.nivel_severidade)} 
                  />
                  <Text style={styles.diseaseSymptoms}>{d.sintomas}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContainer: {
    padding: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.sm,
  },
  logo: {
    fontSize: theme.typography.fontSize.xxl,
    fontWeight: '900',
    color: theme.colors.primary,
  },
  userCard: {
    padding: theme.spacing.lg,
  },
  welcomeText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  userName: {
    fontSize: theme.typography.fontSize.xxl,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginVertical: theme.spacing.xs,
  },
  userRole: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary,
    fontWeight: 'bold',
  },
  userEmail: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  logoutBtn: {
    marginTop: theme.spacing.md,
    height: 40,
  },
  syncCard: {
    padding: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  queueInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  queueLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  actionBtn: {
    width: '100%',
  },
  dbCard: {
    padding: theme.spacing.md,
  },
  dbDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  diseaseList: {
    marginTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  listHeader: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  diseaseItem: {
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  diseaseMeta: {
    marginBottom: theme.spacing.xs,
  },
  diseaseName: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  diseaseScientific: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  diseaseSymptoms: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
});
