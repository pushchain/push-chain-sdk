// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IERC8183Hook} from "../interfaces/IERC8183Hook.sol";
import {IAgenticCommerce} from "../interfaces/IAgenticCommerce.sol";
import {ERC8183HookErrors} from "../libraries/Errors.sol";

/// @title BaseERC8183Hook
/// @notice Abstract helper every hook in this repo inherits. Not part of the ERC.
/// @dev - Only the kernel may call (H-01); no router trust path.
///      - Selectors come from `IAgenticCommerce` (H-02), so a signature change fails to compile.
///      - Unknown selectors are ignored (H-03).
///      - Owns storage slots 0–49: `KERNEL` at slot 0, then a 49-slot gap.
abstract contract BaseERC8183Hook is Initializable, ERC165Upgradeable, IERC8183Hook {
    /// @notice The only address allowed to call this hook. Set once, at initialization.
    address public KERNEL;
    uint256[49] private __gap;

    /// @dev - Reverts `CallerIsNotKernel` for any other caller.
    modifier onlyKernel() {
        if (msg.sender != KERNEL) revert ERC8183HookErrors.CallerIsNotKernel(msg.sender);
        _;
    }

    /// @notice Sets the kernel. Call once from the derived hook's initializer.
    /// @param kernel_ The kernel proxy address.
    function __BaseERC8183Hook_init(address kernel_) internal onlyInitializing {
        __ERC165_init();
        if (kernel_ == address(0)) revert ERC8183HookErrors.ZeroAddress();
        KERNEL = kernel_;
    }

    /// @inheritdoc IERC8183Hook
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyKernel {
        if (selector == IAgenticCommerce.setProvider.selector) {
            (address caller, address provider, bytes memory opt) = abi.decode(data, (address, address, bytes));
            _preSetProvider(jobId, caller, provider, opt);
        } else if (selector == IAgenticCommerce.setBudget.selector) {
            (address caller, uint256 amount, bytes memory opt) = abi.decode(data, (address, uint256, bytes));
            _preSetBudget(jobId, caller, amount, opt);
        } else if (selector == IAgenticCommerce.fund.selector) {
            (address caller, bytes memory opt) = abi.decode(data, (address, bytes));
            _preFund(jobId, caller, opt);
        } else if (selector == IAgenticCommerce.submit.selector) {
            (address caller, bytes32 deliverable, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _preSubmit(jobId, caller, deliverable, opt);
        } else if (selector == IAgenticCommerce.complete.selector) {
            (address caller, bytes32 reason, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _preComplete(jobId, caller, reason, opt);
        } else if (selector == IAgenticCommerce.reject.selector) {
            (address caller, bytes32 reason, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _preReject(jobId, caller, reason, opt);
        }
    }

    /// @inheritdoc IERC8183Hook
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyKernel {
        if (selector == IAgenticCommerce.setProvider.selector) {
            (address caller, address provider, bytes memory opt) = abi.decode(data, (address, address, bytes));
            _postSetProvider(jobId, caller, provider, opt);
        } else if (selector == IAgenticCommerce.setBudget.selector) {
            (address caller, uint256 amount, bytes memory opt) = abi.decode(data, (address, uint256, bytes));
            _postSetBudget(jobId, caller, amount, opt);
        } else if (selector == IAgenticCommerce.fund.selector) {
            (address caller, bytes memory opt) = abi.decode(data, (address, bytes));
            _postFund(jobId, caller, opt);
        } else if (selector == IAgenticCommerce.submit.selector) {
            (address caller, bytes32 deliverable, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _postSubmit(jobId, caller, deliverable, opt);
        } else if (selector == IAgenticCommerce.complete.selector) {
            (address caller, bytes32 reason, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _postComplete(jobId, caller, reason, opt);
        } else if (selector == IAgenticCommerce.reject.selector) {
            (address caller, bytes32 reason, bytes memory opt) = abi.decode(data, (address, bytes32, bytes));
            _postReject(jobId, caller, reason, opt);
        }
    }

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165Upgradeable, IERC165) returns (bool) {
        return interfaceId == type(IERC8183Hook).interfaceId || super.supportsInterface(interfaceId);
    }

    // ───────── handlers — override what you need; all default to no-op ─────────

    /// @dev Before `setProvider`.
    function _preSetProvider(uint256 jobId, address caller, address provider, bytes memory optParams) internal virtual {}
    /// @dev After `setProvider`.
    function _postSetProvider(uint256 jobId, address caller, address provider, bytes memory optParams) internal virtual {}
    /// @dev Before `setBudget`.
    function _preSetBudget(uint256 jobId, address caller, uint256 amount, bytes memory optParams) internal virtual {}
    /// @dev After `setBudget`.
    function _postSetBudget(uint256 jobId, address caller, uint256 amount, bytes memory optParams) internal virtual {}
    /// @dev Before `fund`. `caller` is the job's client.
    function _preFund(uint256 jobId, address caller, bytes memory optParams) internal virtual {}
    /// @dev After `fund`.
    function _postFund(uint256 jobId, address caller, bytes memory optParams) internal virtual {}
    /// @dev Before `submit`.
    function _preSubmit(uint256 jobId, address caller, bytes32 deliverable, bytes memory optParams) internal virtual {}
    /// @dev After `submit`.
    function _postSubmit(uint256 jobId, address caller, bytes32 deliverable, bytes memory optParams) internal virtual {}
    /// @dev Before `complete`.
    function _preComplete(uint256 jobId, address caller, bytes32 reason, bytes memory optParams) internal virtual {}
    /// @dev After `complete`.
    function _postComplete(uint256 jobId, address caller, bytes32 reason, bytes memory optParams) internal virtual {}
    /// @dev Before `reject`.
    function _preReject(uint256 jobId, address caller, bytes32 reason, bytes memory optParams) internal virtual {}
    /// @dev After `reject`.
    function _postReject(uint256 jobId, address caller, bytes32 reason, bytes memory optParams) internal virtual {}
}

