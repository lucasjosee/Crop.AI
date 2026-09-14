import { useNetworkStore } from '../../store/useNetworkStore';
import { useChatStore } from '../../store/useChatStore';
import { CloudEngine } from './cloudEngine';
import { LocalEngine } from './localEngine';
import { EngineRouter } from './router';

export const engineRouter = new EngineRouter(new LocalEngine(), new CloudEngine(), useNetworkStore, {
  onModelProgress: (progress) => useChatStore.getState().setModelLoadProgress(progress),
});

engineRouter.start();

export type { EngineError } from './types';
