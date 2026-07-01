// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
// VENDORED REFERENCE COPY — NOT compiled by the SDK build.
//
// The EIP-7702 batch executor the SDK delegates to for native-Push atomic
// multicalls (see `EvmClient.sendBatch7702` and `PUSH_BATCH_EXECUTOR_ADDRESS`
// in constants/chain.ts). It is a thin wrapper over OpenZeppelin's ERC-7821
// implementation (`draft-ERC7821`); ERC-7821's default authorization
// (`caller == address(this)`) is exactly the EIP-7702 self-call.
//
//   Deployed: 0x0106BF2F9B02f32203A83a3bDaD79fE8818f3796
//   Network:  Push Testnet Donut (chain 42101)
//   Deploy tx: 0xbbe4176ae85c7a737ac62df9fa15aa16cb852b9175458fba22d7177c09106277
//
// Canonical / verification source (compiled, tested, deployed from there):
//   push-chain-core-contracts/src/executor/PushBatchExecutor.sol
//   (requires @openzeppelin/contracts >= 5.4 for ERC7821)
//
// Call shape:
//   mode          = 0x01..00 (ERC-7821 single batch, default exec, selector 0)
//   executionData = abi.encode(Execution[])  where
//                   Execution = (address target, uint256 value, bytes callData)
// ============================================================================

import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";

contract PushBatchExecutor is ERC7821 {
    /// @notice Implementation version. 2.x = ERC-7821 (OZ) based.
    string public constant VERSION = "2.0.0";

    /// @notice Accept plain native (PC) transfers. Required under EIP-7702: an
    ///         empty-calldata value transfer to a delegated EOA dispatches here,
    ///         and would revert without a payable `receive()`. ERC7821 has none.
    receive() external payable {}
}
