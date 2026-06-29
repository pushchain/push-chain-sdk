// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ============================================================================
// VENDORED REFERENCE COPY — NOT compiled by the SDK build.
//
// This is the source of the EIP-7702 batch executor that the SDK delegates to
// for native-Push atomic multicalls (see `EvmClient.sendBatch7702` and
// `PUSH_BATCH_EXECUTOR_ADDRESS` in constants/chain.ts).
//
//   Deployed: 0x776d8031b9caA053d04325Bc2CAc47E5cb673776
//   Network:  Push Testnet Donut (chain 42101)
//   Deploy tx: 0xbeed6f9351212ede19ea644bd034146eaef748fab18f69c77397badbc057c169
//
// Canonical / verification source (compiled, tested, deployed from there):
//   push-chain-core-contracts/src/executor/PushBatchExecutor.sol
//
// The only divergence from the canonical file is that the `Multicall` struct is
// inlined here (canonical imports it from `../libraries/Types.sol`) so this copy
// is self-contained. Logic and storage layout are identical.
// ============================================================================

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Inlined from push-chain-core-contracts `libraries/Types.sol`.
struct Multicall {
    address to; // Target contract address to call
    uint256 value; // Native token amount to send
    bytes data; // Call data for the function execution
}

/**
 * @title   PushBatchExecutor
 * @notice  EIP-7702 delegation target that batch-executes a list of calls atomically.
 * @dev     This contract is NOT deployed-and-called like the UEA proxy. Instead an EVM
 *          EOA on Push Chain delegates its code to this implementation via an EIP-7702
 *          authorization (`SetCodeTx`, tx type 0x04). After delegation, the executor's
 *          code runs in the *EOA's* own storage and balance context, so `address(this)`
 *          IS the user's account.
 *
 *          It replaces the custom `UEA_MULTICALL` selector path for secp256k1 (EVM-origin
 *          and native Push) accounts. SVM (ed25519) accounts cannot sign a 7702
 *          authorization and continue to use the UEA multicall path.
 *
 *          Two entrypoints:
 *            1. {execute(Multicall[])}            — self-sponsored. Only callable when
 *               `msg.sender == address(this)`, i.e. the EOA submits its own type-4 tx.
 *               The transaction's own nonce + signature provide replay protection, so no
 *               extra signature is required.
 *            2. {execute(Multicall[],uint256,bytes)} — sponsored/relayed. A third party
 *               pays gas while the EOA's key authorizes the batch via an EIP-712
 *               signature bound to an internal nonce. Mirrors the existing relayer model.
 *
 *          Because the code executes in the EOA's storage, all persistent state lives in
 *          an ERC-7201 namespaced slot to avoid colliding with other delegate
 *          implementations the same EOA might use over its lifetime.
 */
contract PushBatchExecutor {
    using ECDSA for bytes32;

    // =========================
    //          ERRORS
    // =========================

    /// @notice Caller is neither the account itself nor a valid sponsored signature.
    error Unauthorized();
    /// @notice The supplied batch nonce does not match the stored nonce.
    error InvalidNonce(uint256 expected, uint256 provided);
    /// @notice A call in the batch reverted; the original revert reason is bubbled up.
    error CallReverted(uint256 index);
    /// @notice Reentrant entry into the executor.
    error Reentrancy();

    // =========================
    //          EVENTS
    // =========================

    /// @notice Emitted once per successful batch, after all calls have executed.
    event BatchExecuted(address indexed account, uint256 indexed nonce, uint256 callCount);

    // =========================
    //        CONSTANTS
    // =========================

    /// @notice Implementation version.
    string public constant VERSION = "1.0.0";

    /// @notice EIP-712 type hashes for the sponsored execution path.
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CALL_TYPEHASH = keccak256("Call(address to,uint256 value,bytes data)");
    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256("Execute(Call[] calls,uint256 nonce)Call(address to,uint256 value,bytes data)");

    /// @dev ERC-7201 namespaced storage root:
    ///      keccak256(abi.encode(uint256(keccak256("push.storage.PushBatchExecutor")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_SLOT = 0x0e9e156a7f7c2f9efdb8f9b6cf24ddc7734a3c6bbbd39ddde542536e731f3e00;

    /// @custom:storage-location erc7201:push.storage.PushBatchExecutor
    struct ExecutorStorage {
        uint256 nonce; // monotonic nonce for the sponsored (signed) path
        uint256 locked; // reentrancy flag (1 = entered)
    }

    function _s() private pure returns (ExecutorStorage storage $) {
        assembly {
            $.slot := STORAGE_SLOT
        }
    }

    // =========================
    //        MODIFIERS
    // =========================

    modifier nonReentrant() {
        ExecutorStorage storage $ = _s();
        if ($.locked == 1) revert Reentrancy();
        $.locked = 1;
        _;
        $.locked = 0;
    }

    // =========================
    //        VIEW
    // =========================

    /// @notice Current nonce for the sponsored execution path on this account.
    function nonce() external view returns (uint256) {
        return _s().nonce;
    }

    /// @notice EIP-712 domain separator, bound to this account (`address(this)`) and Push Chain.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("PushBatchExecutor")),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    // =========================
    //        EXECUTION
    // =========================

    /**
     * @notice Self-sponsored batch execution. Only callable by the account itself, i.e.
     *         when the EOA submits its own EIP-7702 type-4 transaction.
     * @param  calls The ordered list of calls to execute. Reverts the whole batch on the
     *         first failing call.
     */
    function execute(Multicall[] calldata calls) external payable nonReentrant {
        if (msg.sender != address(this)) revert Unauthorized();
        _execute(calls);
        emit BatchExecuted(address(this), 0, calls.length);
    }

    /**
     * @notice Sponsored batch execution. Any caller may relay the batch as long as it is
     *         authorized by an EIP-712 signature from this account's key over
     *         `(calls, batchNonce)`. Consumes and increments the stored nonce.
     * @param  calls      The ordered list of calls to execute.
     * @param  batchNonce Must equal the account's current stored nonce.
     * @param  signature  ECDSA signature by `address(this)` over the EIP-712 digest.
     */
    function execute(Multicall[] calldata calls, uint256 batchNonce, bytes calldata signature)
        external
        payable
        nonReentrant
    {
        ExecutorStorage storage $ = _s();
        uint256 current = $.nonce;
        if (batchNonce != current) revert InvalidNonce(current, batchNonce);

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), _hashBatch(calls, batchNonce)));
        address signer = digest.recover(signature);
        // The authorizing key must be this very account (the EOA that delegated to us).
        if (signer != address(this)) revert Unauthorized();

        unchecked {
            $.nonce = current + 1;
        }

        _execute(calls);
        emit BatchExecuted(address(this), batchNonce, calls.length);
    }

    // =========================
    //        INTERNAL
    // =========================

    /// @dev Executes calls sequentially, bubbling up the original revert reason on failure.
    function _execute(Multicall[] calldata calls) private {
        for (uint256 i = 0; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                // Bubble up the underlying revert reason if present; otherwise a typed error.
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 0x20), mload(ret))
                    }
                }
                revert CallReverted(i);
            }
        }
    }

    /// @dev EIP-712 struct hash for the `Execute` payload.
    function _hashBatch(Multicall[] calldata calls, uint256 batchNonce) private pure returns (bytes32) {
        bytes32[] memory callHashes = new bytes32[](calls.length);
        for (uint256 i = 0; i < calls.length; ++i) {
            callHashes[i] =
                keccak256(abi.encode(CALL_TYPEHASH, calls[i].to, calls[i].value, keccak256(calls[i].data)));
        }
        return keccak256(abi.encode(EXECUTE_TYPEHASH, keccak256(abi.encodePacked(callHashes)), batchNonce));
    }

    /// @notice Accept native value (e.g. funding the account before a batch with `value` calls).
    receive() external payable {}
}
