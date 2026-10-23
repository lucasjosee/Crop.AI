import { Redirect } from 'expo-router';

// Analisar é ação, não lugar: o botão central da barra nunca foca esta rota,
// e a câmera mora no Stack da raiz para abrir sem barra. Esta rota só existe
// para hospedar o botão, e só é alcançada por link direto — aí leva à câmera.
export default function Analisar() {
  return <Redirect href="/camera" />;
}
