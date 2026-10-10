const configured = process.env.SOLANA_SSH_GATEWAY_PORT ?? '8080';
export const gatewayPort = Number(configured);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535 || [2222, 8899].includes(gatewayPort)) {
  throw new Error('SOLANA_SSH_GATEWAY_PORT must be an integer from 1 to 65535, excluding the SSH/RPC ports 2222 and 8899');
}
export const gatewayOrigin = `http://127.0.0.2:${gatewayPort}`;
