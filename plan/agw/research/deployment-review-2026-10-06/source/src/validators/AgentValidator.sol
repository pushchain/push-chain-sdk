// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { AgentValidatorErrors } from "../libraries/Errors.sol";

import { ISessionValidator } from "smartsessions/interfaces/ISessionValidator.sol";
import { IAgentValidator } from "../interfaces/IAgentValidator.sol";
import { AgentConfigLib } from "../libraries/AgentConfigLib.sol";

/**
 * @title  AgentValidator
 * @notice A stateless ISessionValidator (ERC-7579 module type 7) that authorises a rules set's agent by
 *         WHO SENT THE TRANSACTION, not by a signature. The rules set's config is the agent's Push
 *         address — an EOA, or the UEA of an external key — and the "signature" the engine hands this
 *         contract is the 20-byte sender the wallet wrote into it.
 *
 * @dev    WHY THIS IS SOUND. The engine calls this only from `validateUserOp`, which reverts unless
 *         `userOp.sender == msg.sender == account` — so only the wallet can obtain a verdict for its
 *         own account. The wallet's agent door builds the operation itself and always writes
 *         `USE ‖ rulesId ‖ msg.sender` into the signature field; no caller-supplied bytes reach it.
 *         The wallet also refuses a non-agent sender BEFORE the engine runs (`CallerIsNotAgent`); this
 *         contract is the second, independent layer, and the one the engine requires.
 *
 *         WHY IT STILL EXISTS. SmartSession always ends policy enforcement by calling the permission's
 *         session validator and reverts `SignerNotFound` without one, and a validator never sees the
 *         transaction sender. Removing this contract would mean forking the engine.
 *
 *         External-key verification (secp256k1, Ed25519) is NOT done here. It happens inside the
 *         agent's UEA before the UEA ever calls the wallet.
 *
 *         Holds no storage and calls nothing, so one deployment serves every account.
 */
contract AgentValidator is ISessionValidator, IAgentValidator {
    /// @dev ERC-7579 stateless-validator module type.
    uint256 internal constant MODULE_TYPE_STATELESS_VALIDATOR = 7;

    /**
     * @notice Whether `sig` is the configured agent.
     *
     * @dev    - Reverts `MalformedConfig` if `data` is not a well-formed agent config. Unreachable
     *           through the wallet's grant path, which runs `validateConfig` first; reachable only for
     *           a session the owner enabled on the engine directly.
     *         - Returns false unless `sig` is exactly 20 bytes.
     *         - Returns whether those 20 bytes equal the configured agent.
     *         - `hash` is ignored: there is no signature to check it against.
     *
     * @param sig  The 20-byte sender written by the wallet.
     * @param data The rules set's config, `abi.encode(address agent)`.
     * @return validSig True iff the sender is the agent.
     */
    function validateSignatureWithData(bytes32, bytes calldata sig, bytes calldata data)
        external
        pure
        override
        returns (bool validSig)
    {
        address agent = AgentConfigLib.decode(data);
        if (agent == address(0)) revert AgentValidatorErrors.MalformedConfig();
        if (sig.length != 20) return false;
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(bytes20(sig)) == agent; // `sig` is exactly 20 bytes, checked above
    }

    /**
     * @notice Grant-time config check, used by the wallet's grant path and by tooling.
     *
     * @dev    Two-valued and never reverts: true iff `data` is exactly one ABI word holding a non-zero
     *         address with clean upper bytes. True means `validateSignatureWithData` will not revert on
     *         this config; false means it reverts `MalformedConfig`.
     *
     * @param  data Candidate `sessionValidatorInitData`.
     * @return True iff `data` is a well-formed agent config.
     */
    function validateConfig(bytes calldata data) external pure returns (bool) {
        return AgentConfigLib.decode(data) != address(0);
    }

    // --- IERC7579Module ---

    /// @dev No-op: the validator holds no per-account state.
    function onInstall(bytes calldata) external pure { }

    /// @dev No-op: the validator holds no per-account state.
    function onUninstall(bytes calldata) external pure { }

    /**
     * @notice Whether this module implements an ERC-7579 module type.
     * @param  moduleTypeId  Module type to query.
     * @return True only for the stateless-validator type.
     */
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_STATELESS_VALIDATOR;
    }

    /**
     * @notice Whether this module is initialised for an account.
     * @dev    Always true: the validator is stateless, so there is nothing to initialise.
     * @return Always true.
     */
    function isInitialized(address) external pure returns (bool) {
        return true;
    }
}
