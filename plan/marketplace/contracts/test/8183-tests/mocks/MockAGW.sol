// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerIntent} from "@push-agw/libraries/Types.sol";
import {Session} from "../../../src/agentic-commerce-8183/interfaces/external/IAGW.sol";

/// @notice An AGW stand-in for UniversalMarketplace unit tests. OBSERVER, NOT ORACLE: it records what
///         the marketplace presented and forwards the exec calldata so the REAL kernel runs `createJob`
///         with this contract as `msg.sender`. It checks the presenter and hashes like the real wallet,
///         and verifies no signature. `mode` lets a test make it misbehave in the ways the
///         marketplace must catch.
/// @dev `grantRulesWithSig` decodes the policy envelope as `(uint16, string, bytes)` exactly as the real wallet's
///      policy does, so a session in the pre-v6 two-field format fails here the way it fails there (a decode panic).
contract MockAGW {
    enum Mode {
        Honest,
        TwoJobs,
        ForeignClient,
        OtherEvaluator // rewrites createJob's evaluator argument before calling the kernel
    }

    address public constant OTHER_EVALUATOR = address(0xE7A1);

    address public immutable OWNER;
    Mode public mode;
    uint64 public grantNonce;
    mapping(uint192 => uint64) public getNonce;

    bytes32 public lastSessionHash;
    bytes32 public lastGrantIntentHash;
    bytes32 public lastExecIntentHash;
    bytes32 public lastExecCalldataHash;
    address public lastGrantCaller;
    /// @notice The full policy `initData` of the last grant, for tests and the MI07 invariant to decode.
    bytes public lastPolicyInitData;

    bytes32 public constant RULES_ID = keccak256("mock-rules");

    constructor(address owner_) {
        OWNER = owner_;
    }

    receive() external payable {}

    function setMode(Mode m) external {
        mode = m;
    }

    function grantRulesWithSig(Session calldata session, OwnerIntent calldata intent, bytes calldata)
        external
        returns (bytes32)
    {
        require(msg.sender == intent.executor, "MockAGW: executor");
        require(intent.sessionHash == keccak256(abi.encode(session)), "MockAGW: session hash");
        require(intent.grantNonce == grantNonce, "MockAGW: grant nonce");
        bytes calldata initData = session.actions[0].actionPolicies[0].initData;
        abi.decode(initData, (uint16, string, bytes));
        grantNonce++;
        lastPolicyInitData = initData;
        lastSessionHash = keccak256(abi.encode(session));
        lastGrantIntentHash = keccak256(abi.encode(intent));
        lastGrantCaller = msg.sender;
        return RULES_ID;
    }

    function executeWithSig(bytes32, bytes calldata cd, OwnerIntent calldata intent, bytes calldata) external {
        require(msg.sender == intent.executor, "MockAGW: executor");
        require(intent.execCalldataHash == keccak256(cd), "MockAGW: exec hash");
        require(intent.nonceSeq == getNonce[intent.nonceKey], "MockAGW: nonce");
        getNonce[intent.nonceKey]++;
        lastExecIntentHash = keccak256(abi.encode(intent));
        lastExecCalldataHash = keccak256(cd);

        address target = address(bytes20(cd[0:20]));
        bytes memory callData = cd[52:];
        if (mode == Mode.OtherEvaluator) {
            address other = OTHER_EVALUATOR;
            assembly ("memory-safe") {
                mstore(add(callData, 68), other) // data + 4 (selector) + 32 (provider) = the evaluator word
            }
        }
        if (mode == Mode.ForeignClient) {
            new ForeignCaller().forward(target, callData);
            return;
        }
        _call(target, callData);
        if (mode == Mode.TwoJobs) _call(target, callData);
    }

    function _call(address target, bytes memory data) internal {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @dev Makes the call from a different address, so the kernel's `client` is not the AGW.
contract ForeignCaller {
    function forward(address target, bytes memory data) external {
        (bool ok,) = target.call(data);
        require(ok, "ForeignCaller");
    }
}
