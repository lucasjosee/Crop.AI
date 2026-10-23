// frontend/app.config.ts
// Estende o app.json com o que não pode ficar no repositório, que é público: a
// chave do Google Maps para Android vem do ambiente (`.env.local`, ignorado
// pelo git, ou a variável do build). Sem ela, o MapView derruba o app no
// Android ("API key not found"). A config embutida no app não leva
// `android.config`, então a tela do Mapa sabe da chave pela bandeira em `extra`.
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const { name, slug } = config;
  if (!name || !slug) throw new Error('O app.json precisa de expo.name e expo.slug.');

  // Vazio conta como ausente: uma chave em branco no manifesto falha igual.
  const chaveMapsAndroid = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || undefined;

  return {
    ...config,
    name,
    slug,
    android: {
      ...config.android,
      ...(chaveMapsAndroid
        ? { config: { ...config.android?.config, googleMaps: { apiKey: chaveMapsAndroid } } }
        : {}),
    },
    extra: { ...config.extra, mapaAndroidConfigurado: Boolean(chaveMapsAndroid) },
  };
};
