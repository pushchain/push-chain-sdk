import { ExecuteParams } from "@pushchain/core/src/lib/orchestrator/orchestrator.types";

export const APP_ROUTES = {
  LANDING_PAGE: '/',
  SIMULATE: '/simulate',
};

export const mockTransaction: ExecuteParams = {
  to: '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108',
  value: BigInt(10) ** BigInt(18),
  data: '0x',
}