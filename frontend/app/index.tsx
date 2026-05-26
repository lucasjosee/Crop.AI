import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  SafeAreaView, 
  TouchableOpacity, 
  TextInput, 
  Platform,
  Image,
  ActivityIndicator
} from 'react-native';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/useAuthStore';
import { dbDriver } from '../db/sqlite';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { theme } from '../config/theme';

export default function HomeScreen() {
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'diagnostics' | 'encyclopedia'>('diagnostics');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [diseases, setDiseases] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbLoading, setDbLoading] = useState(false);

  // Load database seed data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setDbLoading(true);
      
      // 1. Load diseases for encyclopedia and lookup
      const diseasesRes = await dbDriver.execute('SELECT * FROM doencas;');
      const diseasesList = [];
      for (let i = 0; i < diseasesRes.rows.length; i++) {
        diseasesList.push(diseasesRes.rows.item(i));
      }
      setDiseases(diseasesList);

      // 2. Load diagnostics history from local SQLite queue
      const diagRes = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
      const diagList = [];
      for (let i = 0; i < diagRes.rows.length; i++) {
        diagList.push(diagRes.rows.item(i));
      }
      
      // Sort newest first
      diagList.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setDiagnostics(diagList);

      // Update pending items counter
      const pending = diagList.filter(d => d.sync_status === 'PENDING').length;
      setPendingCount(pending);
    } catch (e) {
      console.error('[HomeScreen] Failed to read local DB:', e);
      Toast.show({
        type: 'error',
        text1: 'Erro de Banco de Dados',
        text2: 'Não foi possível carregar os dados locais.',
      });
    } finally {
      setDbLoading(false);
    }
  };

  const handleAddMockDiagnostic = async () => {
    try {
      const mockId = `local-${Math.random().toString(36).substring(2, 9)}`;
      // Alternate disease for mock items
      const targetDisease = Math.random() > 0.5 ? 'doenca_ferrugem_asiatica' : 'doenca_mancha_alvo';
      const confidence = parseFloat((0.85 + Math.random() * 0.14).toFixed(2));
      
      // Inserir registro mockado na fila local do SQLite (Store & Forward)
      await dbDriver.execute(
        `INSERT INTO fila_diagnosticos (
          local_id, server_id, image_uri, image_s3_key, latitude, longitude, 
          doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms, sync_status, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          mockId,
          null, // server_id pendente
          Math.random() > 0.4 ? 'https://picsum.photos/id/10/64/64' : 'file:///mock/path/diagnostico_folha.jpg',
          null, // s3 key pendente
          -23.55052,
          -46.633309,
          targetDisease,
          confidence,
          'tflite_v1.0',
          Math.floor(25 + Math.random() * 20), // 25-45ms inferência
          'PENDING',
          0
        ]
      );

      await loadData();
      
      Toast.show({
        type: 'success',
        text1: 'Diagnóstico Enfileirado!',
        text2: 'Salvo localmente com sucesso (offline-first).',
      });
    } catch (err) {
      console.error('[HomeScreen] Failed to save mock diagnostic:', err);
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
        text1: 'Sessão Encerrada',
        text2: 'Logout efetuado com sucesso.',
      });
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Erro ao sair',
        text2: 'Não foi possível encerrar a sessão.',
      });
    }
  };

  const getDiseaseName = (doencaId: string) => {
    const disease = diseases.find(d => d.id === doencaId);
    return disease ? disease.nome_comum : 'Diagnóstico Geral';
  };

  const getDiseaseScientific = (doencaId: string) => {
    const disease = diseases.find(d => d.id === doencaId);
    return disease ? disease.nome_cientifico : '';
  };

  const getSeverityColorType = (level: number): 'success' | 'warning' | 'error' => {
    if (level <= 2) return 'success';
    if (level <= 3) return 'warning';
    return 'error';
  };

  const getSeverityLabel = (level: number) => {
    if (level <= 2) return 'Severidade Baixa';
    if (level <= 3) return 'Severidade Média';
    return 'Severidade Alta';
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day}/${month}/${year} às ${hours}:${minutes}`;
    } catch {
      return isoString;
    }
  };

  // Real-time filter logic
  const filteredDiagnostics = diagnostics.filter(item => {
    const diseaseName = getDiseaseName(item.doenca_id).toLowerCase();
    const query = searchQuery.toLowerCase();
    return diseaseName.includes(query) || (item.timestamp && item.timestamp.includes(query));
  });

  const filteredDiseases = diseases.filter(item => {
    const query = searchQuery.toLowerCase();
    return (
      item.nome_comum.toLowerCase().includes(query) ||
      (item.nome_cientifico && item.nome_cientifico.toLowerCase().includes(query)) ||
      (item.sintomas && item.sintomas.toLowerCase().includes(query))
    );
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="leaf" size={26} color={theme.colors.primary} style={styles.logoIcon} />
          <Text style={styles.logo}>Crop.AI</Text>
        </View>
        <View style={styles.headerRight}>
          <ConnectionIndicator />
          <TouchableOpacity 
            onPress={handleLogout} 
            style={styles.logoutBtn} 
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="log-out-outline" size={24} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Pill Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={theme.colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            placeholder={activeTab === 'diagnostics' ? "Buscar diagnósticos..." : "Buscar na enciclopédia..."}
            placeholderTextColor={theme.colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
          {searchQuery ? (
            <TouchableOpacity 
              onPress={() => setSearchQuery('')} 
              style={styles.clearSearchBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Active Tab Menu */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'diagnostics' && styles.tabButtonActive]}
          onPress={() => {
            setActiveTab('diagnostics');
            setSearchQuery('');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabButtonText, activeTab === 'diagnostics' && styles.tabButtonTextActive]}>
            Meus Diagnósticos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'encyclopedia' && styles.tabButtonActive]}
          onPress={() => {
            setActiveTab('encyclopedia');
            setSearchQuery('');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabButtonText, activeTab === 'encyclopedia' && styles.tabButtonTextActive]}>
            Enciclopédia de Doenças
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      {dbLoading && diagnostics.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Acessando base de dados criptografada...</Text>
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'diagnostics' ? (
            // ABA 1: MEUS DIAGNÓSTICOS
            <View>
              {/* Quick Actions Panel */}
              <View style={styles.welcomeBanner}>
                <View>
                  <Text style={styles.welcomeTitle}>Olá, {user?.nome?.split(' ')[0] || 'Produtor'}</Text>
                  <Text style={styles.welcomeSubtitle}>
                    {pendingCount > 0 
                      ? `${pendingCount} diagnóstico(s) pendente(s) de envio` 
                      : 'Todos os diagnósticos sincronizados'}
                  </Text>
                </View>
                <Button
                  title="+ Novo Offline (Mock)"
                  onPress={handleAddMockDiagnostic}
                  variant="primary"
                  style={styles.mockAddBtn}
                  textStyle={styles.mockAddBtnText}
                />
              </View>

              {filteredDiagnostics.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="clipboard-outline" size={48} color={theme.colors.textSecondary} />
                  <Text style={styles.emptyText}>
                    {searchQuery ? 'Nenhum diagnóstico corresponde à busca.' : 'Nenhum diagnóstico registrado localmente.'}
                  </Text>
                </View>
              ) : (
                filteredDiagnostics.map((item) => (
                  <Card key={item.local_id} style={styles.diagnosticCard}>
                    <View style={styles.cardContent}>
                      {/* Thumbnail container */}
                      <View style={styles.thumbnailContainer}>
                        {item.image_uri && item.image_uri.startsWith('http') ? (
                          <Image source={{ uri: item.image_uri }} style={styles.thumbnailImage} />
                        ) : (
                          <Ionicons name="leaf-outline" size={28} color={theme.colors.primary} />
                        )}
                      </View>

                      {/* Middle Details Block */}
                      <View style={styles.cardMiddleBlock}>
                        <Text style={styles.diagnosticTitle}>{getDiseaseName(item.doenca_id)}</Text>
                        <Text style={styles.diagnosticScientific}>{getDiseaseScientific(item.doenca_id)}</Text>
                        <Text style={styles.diagnosticMeta}>
                          {Math.round(item.confianca_ia * 100)}% de precisão • {item.modelo_usado}
                        </Text>
                        <Text style={styles.diagnosticDate}>{formatDate(item.timestamp)}</Text>
                      </View>

                      {/* Right Sync Status Block */}
                      <View style={styles.cardRightBlock}>
                        {item.sync_status === 'SYNCED' ? (
                          <View style={styles.statusWrapper}>
                            <Ionicons name="cloud-done-outline" size={24} color={theme.colors.success} />
                            <Text style={[styles.statusLabel, { color: theme.colors.success }]}>Enviado</Text>
                          </View>
                        ) : (
                          <View style={styles.statusWrapper}>
                            <Ionicons name="cloud-upload-outline" size={24} color={theme.colors.warning} />
                            <Text style={[styles.statusLabel, { color: theme.colors.warning }]}>Pendente</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </Card>
                ))
              )}
            </View>
          ) : (
            // ABA 2: ENCICLOPÉDIA DE DOENÇAS
            <View>
              {filteredDiseases.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="book-outline" size={48} color={theme.colors.textSecondary} />
                  <Text style={styles.emptyText}>Nenhuma patologia encontrada.</Text>
                </View>
              ) : (
                filteredDiseases.map((item) => (
                  <Card key={item.id} style={styles.diseaseCard}>
                    <View style={styles.diseaseHeaderRow}>
                      <View style={styles.diseaseHeaderMain}>
                        <Text style={styles.diseaseTitle}>{item.nome_comum}</Text>
                        <Text style={styles.diseaseScientific}>{item.nome_cientifico}</Text>
                      </View>
                      <Badge 
                        text={getSeverityLabel(item.nivel_severidade)} 
                        type={getSeverityColorType(item.nivel_severidade)} 
                      />
                    </View>
                    
                    <View style={styles.diseaseDivider} />
                    
                    <Text style={styles.symptomsHeader}>Sintomas característicos:</Text>
                    <Text style={styles.symptomsText}>{item.sintomas}</Text>
                  </Card>
                ))
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* Fixed Bottom Tab Navigation Bar */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity 
          style={styles.bottomTabItem} 
          onPress={() => Toast.show({ 
            type: 'info', 
            text1: 'Simulação Câmera', 
            text2: 'Esta aba abre o visor da Câmera (Sprint 3).' 
          })}
          activeOpacity={0.7}
        >
          <Ionicons name="camera-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.bottomTabLabel}>Câmera</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.bottomTabItem}
          onPress={() => Toast.show({ 
            type: 'info', 
            text1: 'Simulação Chat', 
            text2: 'Esta aba abre o Chat com Agrônomo (Sprint 3).' 
          })}
          activeOpacity={0.7}
        >
          <Ionicons name="chatbubbles-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.bottomTabLabel}>Chat</Text>
        </TouchableOpacity>
        
        {/* L12: Esta aba representa a seção consolidada de Histórico & Catálogo (Tela 1 da spec). */}
        <TouchableOpacity style={styles.bottomTabItemActive} activeOpacity={1}>
          <Ionicons name="book" size={24} color={theme.colors.primary} />
          <Text style={styles.bottomTabLabelActive}>Catálogo</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: Platform.OS === 'ios' ? 10 : 15,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    marginRight: 6,
  },
  logo: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '900',
    color: theme.colors.primary,
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoutBtn: {
    marginLeft: theme.spacing.md,
    padding: 4,
  },
  searchContainer: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 100,
    height: 48,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0px 2px 3px rgba(0, 0, 0, 0.08)',
      }
    }),
  },
  searchIcon: {
    marginRight: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm + 1,
  },
  clearSearchBtn: {
    padding: 2,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabButtonText: {
    fontSize: theme.typography.fontSize.md, // M7: fontSize.sm + 1 -> fontSize.md
    color: theme.colors.textSecondary,
    fontWeight: 'normal', // M6: '600' -> 'normal'
  },
  tabButtonTextActive: {
    color: theme.colors.primary,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: theme.spacing.md,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  welcomeBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.primaryLight10, // M8: #E8F5E9 -> theme.colors.primaryLight10
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  welcomeTitle: {
    fontSize: theme.typography.fontSize.md + 2,
    fontWeight: 'bold',
    color: theme.colors.primaryDark,
  },
  welcomeSubtitle: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  mockAddBtn: {
    height: 38,
    paddingHorizontal: theme.spacing.md,
  },
  mockAddBtnText: {
    fontSize: theme.typography.fontSize.xs,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  diagnosticCard: {
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderRadius: 12,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnailContainer: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: theme.colors.primaryLight10, // M8: #E8F5E9 -> theme.colors.primaryLight10
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  thumbnailImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  cardMiddleBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  diagnosticTitle: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  diagnosticScientific: {
    fontSize: theme.typography.fontSize.xs - 1,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: 2,
  },
  diagnosticMeta: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  diagnosticDate: {
    fontSize: theme.typography.fontSize.xs - 1,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  cardRightBlock: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: theme.spacing.sm,
  },
  statusWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  diseaseCard: {
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderRadius: 12,
  },
  diseaseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  diseaseHeaderMain: {
    flex: 1, // M9: Mover inline style {{ flex: 1 }} para StyleSheet
  },
  diseaseTitle: {
    fontSize: theme.typography.fontSize.md + 2,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  diseaseScientific: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  diseaseDivider: {
    height: 1,
    backgroundColor: theme.colors.border, // M8: #E0E0E0 -> theme.colors.border
    marginVertical: theme.spacing.md,
  },
  symptomsHeader: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 4,
  },
  symptomsText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  bottomTabBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: theme.colors.surface, // M8: #FFFFFF -> theme.colors.surface
    borderTopWidth: 1,
    borderTopColor: theme.colors.border, // M8: #E0E0E0 -> theme.colors.border
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 12 : 4,
  },
  bottomTabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  bottomTabItemActive: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  bottomTabLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 3,
  },
  bottomTabLabelActive: {
    fontSize: 11,
    color: theme.colors.primary,
    fontWeight: 'bold',
    marginTop: 3,
  },
});
