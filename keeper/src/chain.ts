import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, cfg } from './config.js';
import { slopxAbi } from './abi.js';

export const publicClient = createPublicClient({ chain, transport: http(undefined, { retryCount: 3, timeout: 15_000 }) });

export function walletClient() {
  if (!cfg.keeperKey) throw new Error('KEEPER_PRIVATE_KEY not set in .env');
  const account = privateKeyToAccount(cfg.keeperKey);
  return createWalletClient({ account, chain, transport: http(undefined, { retryCount: 3 }) });
}

export const contract = () => {
  if (!cfg.contract) throw new Error('CONTRACT_ADDRESS not set');
  return { address: cfg.contract, abi: slopxAbi } as const;
};

export async function timing() {
  const c = contract();
  const [genesis, duration] = await Promise.all([
    publicClient.readContract({ ...c, functionName: 'genesis' }),
    publicClient.readContract({ ...c, functionName: 'roundDuration' }),
  ]);
  return { genesis: Number(genesis), duration: Number(duration) };
}
