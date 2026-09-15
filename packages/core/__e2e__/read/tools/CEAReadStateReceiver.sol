// SPDX-License-Identifier: MIT
// Manual live E2E receiver; see ./live-read-cea.ts.
pragma solidity 0.8.26;

struct UniversalOutboundTxRequest {
    bytes recipient;
    address token;
    uint256 amount;
    uint256 gasLimit;
    uint256 gasPrice;
    uint256 maxPCForGas;
    bytes payload;
    address revertRecipient;
}

struct UniversalAccountId {
    string chainNamespace;
    string chainId;
    bytes owner;
}

struct ReadSpec {
    UniversalAccountId account;
    bytes query;
    uint16 minConfirmations;
    uint64 blockNumber;
    uint64 expiryPushChainHeight;
    uint256 maxFee;
    address revertRecipient;
}

interface IUniversalGatewayPC {
    function sendUniversalTxOutbound(UniversalOutboundTxRequest calldata req) external payable;
}

interface IUniversalReadRegistry {
    function read(ReadSpec calldata spec, bytes32 queryKey, uint64 callbackGasLimit)
        external
        payable
        returns (uint256 requestId);
}

/// @notice Live N1 probe: Push contract -> its CEA -> Push contract -> registry read.
contract CEAReadStateReceiver {
    address public immutable owner;
    IUniversalGatewayPC public constant UGPC = IUniversalGatewayPC(0x00000000000000000000000000000000000000C1);
    IUniversalReadRegistry public constant REGISTRY =
        IUniversalReadRegistry(0x91b09DAd1774bAfDE679F9ebB5F9046AE2b928C8);

    uint256 public lastRequestId;
    bytes32 public lastInboundTxId;

    event CEAReadCreated(uint256 indexed requestId, bytes32 indexed inboundTxId);

    constructor() {
        owner = msg.sender;
    }

    function triggerOutbound(UniversalOutboundTxRequest calldata req) external payable {
        require(msg.sender == owner, "only owner");
        UGPC.sendUniversalTxOutbound{value: msg.value}(req);
    }

    /// @dev Signature expected by the Push universal executor for CEA-originated inbound calls.
    function executeUniversalTx(string calldata, bytes calldata, bytes calldata payload, uint256, address, bytes32 txId)
        external
        payable
    {
        (ReadSpec memory spec, bytes32 queryKey, uint64 callbackGasLimit, uint256 readValue) =
            abi.decode(payload, (ReadSpec, bytes32, uint64, uint256));
        uint256 requestId = REGISTRY.read{value: readValue}(spec, queryKey, callbackGasLimit);
        lastRequestId = requestId;
        lastInboundTxId = txId;
        emit CEAReadCreated(requestId, txId);
    }

    function sweep() external {
        require(msg.sender == owner, "only owner");
        (bool ok,) = owner.call{value: address(this).balance}("");
        require(ok, "sweep failed");
    }

    receive() external payable {}
}
