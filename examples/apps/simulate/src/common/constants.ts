import { ExecuteParams } from "@pushchain/core/src/lib/orchestrator/orchestrator.types";

export const APP_ROUTES = {
  LANDING_PAGE: '/',
  SIMULATE: '/simulate',
};

export const mockTransaction: ExecuteParams = {
  to: '0x68F8b46e4cD01a7648393911E734d99d34E6f107',
  value: BigInt(1),
  data: '0x',
}