// Assets binários resolvidos pelo Metro viram um id numérico no registro de
// assets do Expo — é isso que loadTensorflowModel recebe.
declare module '*.tflite' {
  const asset: number;
  export default asset;
}
