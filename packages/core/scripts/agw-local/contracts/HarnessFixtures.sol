// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// REVIEW-ONLY FIXTURES for the SDK's local AGW harness. None of this is production
// code and none of it is a model of a deployed Push contract beyond the narrow
// behaviour named on each contract. Live gateway/core/TSS/destination behaviour is
// NOT exercised by anything that uses these fixtures.

/// @notice Minimal PRC20 stand-in: transfers, allowances, burn and the
///         SOURCE_CHAIN_NAMESPACE view URP interrogates at universal grant.
contract HarnessPRC20 {
    string public SOURCE_CHAIN_NAMESPACE;
    string private _sourceOverride;
    bool private _hasSourceOverride;
    function setSourceChainNamespace(string calldata chain) external { SOURCE_CHAIN_NAMESPACE = chain; }
    function setSourceTokenAddress(string calldata source) external {
        _sourceOverride = source; _hasSourceOverride = true;
    }
    function SOURCE_TOKEN_ADDRESS() external view returns (string memory) {
        if (_hasSourceOverride) return _sourceOverride;
        bytes memory chars = "0123456789abcdef";
        bytes memory out = new bytes(42); out[0] = "0"; out[1] = "x";
        uint160 v = uint160(address(this));
        for (uint256 i; i < 40; ++i) out[41-i] = chars[(v >> (4*i)) & 15];
        return string(out);
    }
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    error LowBalance();
    error LowAllowance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory sourceChainNamespace, uint8 decimals_) {
        SOURCE_CHAIN_NAMESPACE = sourceChainNamespace;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert LowAllowance();
        allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert LowBalance();
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert LowBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Fixed-quote stand-in for UniversalCore.getOutboundTxGasAndFees.
contract HarnessUniversalCore {
    uint256 public gasFee = 1e15;
    uint256 public protocolFee = 1e14;
    mapping(string => address) public gasTokenPRC20ByChainNamespace;
    function setGasToken(string calldata chain, address token) external { gasTokenPRC20ByChainNamespace[chain] = token; }

    function getOutboundTxGasAndFees(address prc20, uint256 gasLimit)
        external
        view
        returns (address gasToken, uint256 gasFee_, uint256 protocolFee_, uint256 gasPrice, string memory chainNamespace, uint256 gasLimitUsed)
    {
        (bool ok, bytes memory ret) = prc20.staticcall(abi.encodeWithSignature("SOURCE_CHAIN_NAMESPACE()"));
        chainNamespace = ok ? abi.decode(ret, (string)) : "";
        return (prc20, gasFee, protocolFee, 1 gwei, chainNamespace, gasLimit == 0 ? 200_000 : gasLimit);
    }
}

struct HarnessOutboundRequest {
    bytes recipient;
    address token;
    uint256 amount;
    uint256 gasLimit;
    uint256 gasPrice;
    uint256 maxPCForGas;
    bytes payload;
    address revertRecipient;
}

/// @notice Stub of UniversalGatewayPC's outbound pull. Models ONLY: non-zero
///         token/revertRecipient, transferFrom(msg.sender) + burn of `amount`,
///         msg.value >= protocolFee, maxPCForGas <= msg.value - protocolFee with the
///         excess refunded, and a recorded request. No fee swap, routing, TSS or
///         destination execution. Mirrors gateway bcbf7df UniversalGatewayPC.sol:141-237,430-435.
contract HarnessGatewayPC {
    HarnessUniversalCore public immutable universalCore;
    uint256 public outboundCount;
    bytes32 public lastRequestHash;
    address public lastSender;

    error InvalidInput();
    error InsufficientFee();

    event HarnessOutbound(address indexed sender, address indexed token, uint256 amount, uint256 value, bytes32 requestHash);

    constructor(HarnessUniversalCore core_) {
        universalCore = core_;
    }

    function sendUniversalTxOutbound(HarnessOutboundRequest calldata req) external payable {
        if (req.token == address(0) || req.revertRecipient == address(0)) revert InvalidInput();
        if (req.amount == 0 && req.payload.length == 0) revert InvalidInput();
        uint256 protocolFee = universalCore.protocolFee();
        if (msg.value < protocolFee) revert InsufficientFee();
        uint256 pcForSwap = msg.value - protocolFee;
        if (req.maxPCForGas != 0) {
            if (req.maxPCForGas > pcForSwap) revert InsufficientFee();
            uint256 refund = pcForSwap - req.maxPCForGas;
            if (refund > 0) {
                (bool ok,) = msg.sender.call{ value: refund }("");
                require(ok, "refund");
            }
        }
        if (req.amount > 0) {
            HarnessPRC20(req.token).transferFrom(msg.sender, address(this), req.amount);
            HarnessPRC20(req.token).burn(req.amount);
        }
        outboundCount++;
        lastSender = msg.sender;
        lastRequestHash = keccak256(abi.encode(req));
        emit HarnessOutbound(msg.sender, req.token, req.amount, msg.value, lastRequestHash);
    }

    receive() external payable { }
}

/// @notice Native-rule target: records calls so authorization effects are observable.
contract HarnessTarget {
    uint256 public counter;
    address public lastBeneficiary;
    uint256 public lastAmount;
    uint256 public received;

    function increment() external {
        counter++;
    }

    function deposit(address beneficiary, uint256 amount) external payable {
        lastBeneficiary = beneficiary;
        lastAmount = amount;
        received += msg.value;
        counter++;
    }

    receive() external payable {
        received += msg.value;
    }
}

/// @notice Test-only ERC-7821-shaped executor for real Anvil EIP-7702 transactions.
///         Models self-call authorization and atomic CALL dispatch, not the deployed OZ artifact.
contract HarnessAtomicExecutor {
    struct Execution { address target; uint256 value; bytes callData; }
    function execute(bytes32 mode, bytes calldata data) external payable {
        require(msg.sender == address(this), "self call only");
        require(mode == bytes32(uint256(1) << 248), "batch/default only");
        Execution[] memory calls = abi.decode(data, (Execution[]));
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].callData);
            if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        }
    }
    receive() external payable {}
}
