// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { AGWFactoryErrors } from "./libraries/Errors.sol";

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    AccessControlDefaultAdminRulesUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IAGWFactory } from "./interfaces/IAGWFactory.sol";
import { IAGWInit } from "./interfaces/IAGWInit.sol";
import { OwnerIntent } from "./libraries/Types.sol";
import { OwnerAuthLib } from "./libraries/OwnerAuthLib.sol";

/**
 * @title  AGWFactory
 * @notice Deploys `AGW` clones at addresses computable before deployment, and is the
 *         root of trust for wallet identity.
 *
 * @dev    - Wallet addresses are deterministic and predictable before deployment, so counterfactual
 *           funding is a supported flow.
 *         - This registry is the only proof of a wallet's provenance: anyone can deploy a contract
 *           with a lying `owner()` view. The audit chain is destination account, wallet, this
 *           registry, owner.
 *         - The owner is the caller, or the signer of an `OwnerIntent` naming this owner, index and
 *           wallet, presented by the intent's `executor`. Deploying a wallet owned by someone else
 *           without that owner's signature is impossible.
 *         - Holds no funds, never touches a wallet after deployment, and has no setter for the
 *           wallet implementation.
 *         - Deployed behind an ERC-1967 UUPS proxy; the proxy address is the permanent,
 *           user-facing factory address and never changes across logic upgrades.
 */
contract AGWFactory is
    Initializable,
    AccessControlDefaultAdminRulesUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IAGWFactory
{
    /// @dev Holder may pause wallet deployment.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev Holder may unpause wallet deployment.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /**
     * @dev Delay on the two-step admin transfer.
     *
     *      - The admin's one real power is authorising a UUPS upgrade of this logic, which is the
     *        single action that can permanently strand counterfactually funded addresses.
     *      - The extension makes `grantRole` and `renounceRole` on the admin role revert, forcing
     *        the scheduled flow.
     */
    uint48 internal constant DEFAULT_ADMIN_DELAY = 2 days;

    /// @dev All bases use ERC-7201 namespaced storage, so these three variables occupy slots 0, 1
    ///      and 2. Order is frozen, and a layout test asserts it from `forge inspect` output.

    /// @dev owner => wallets deployed for them, doubling as the next index so a count and an index
    ///      can never drift apart. `uint96` matches `WalletRecord.index`, so no narrowing cast
    ///      exists anywhere in this contract.
    mapping(address => uint96) internal _walletCount;

    /// @dev wallet => its record; a zero owner means not deployed by this factory. This is the
    ///      entire registry: existence, owner and index from one packed slot per wallet.
    mapping(address => IAGWFactory.WalletRecord) internal _records;

    /**
     * @notice The canonical AGW logic contract all clones delegate to.
     *
     * @dev    - Written once, in `initialize`. There is no setter: a function able to rewrite this
     *           would silently move every predicted address and strand counterfactually funded
     *           wallets, with no migration path to recover them.
     *         - Declared last and appended to only. Every future variable goes after it, and nothing
     *           is inserted or reordered before it, or address derivation breaks with no remedy.
     *         - `internal`, exposed only through `walletImplementation()`, so no second
     *           auto-generated getter with a different selector exists.
     */
    address internal _walletImplementation;

    // No storage gap: this is a leaf UUPS implementation, so a future version simply appends after
    // _walletImplementation.

    /// @dev Locks the logic contract so it can never be initialised directly.
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Configures the proxy. Callable once, at deployment.
     *
     * @dev    - Reverts with `ZeroAddress` if either address is zero.
     *         - Sets the admin with the two-day transfer delay, initialises pausable, and records
     *           the wallet implementation.
     *         - Makes no external calls and deploys nothing. Pauser and operator membership are
     *           granted afterwards by the admin through the standard `grantRole`.
     *
     * @param  admin                  Receives the default admin role.
     * @param  walletImplementation_  Logic contract every wallet clone will delegate to.
     */
    function initialize(address admin, address walletImplementation_) external initializer {
        if (admin == address(0) || walletImplementation_ == address(0)) revert AGWFactoryErrors.ZeroAddress();

        __AccessControlDefaultAdminRules_init(DEFAULT_ADMIN_DELAY, admin);
        __Pausable_init();
        // UUPSUpgradeable in OZ 5.7.0 has no initializer; calling one does not compile.

        _walletImplementation = walletImplementation_;
    }

    /**
     * @notice Deploys the caller's next agent wallet and initialises it.
     *
     * @dev    - Reverts while paused, and with `ImplementationNotSet` if the wallet implementation
     *           is unset. The latter is reachable only on a proxy deployed without its atomic init
     *           call; without it, `Clones` would deploy a permanently uninitialisable clone.
     *         - Advances the caller's wallet count and writes the registry record before the single
     *           external call, which is what makes a reentrant deploy unable to reuse an index.
     *           There is deliberately no reentrancy guard; the effect ordering is the protection.
     *         - Salt is the owner and the factory-assigned sequential index only. Nothing
     *           rules-related enters the derivation.
     *         - The owner appears twice, in the salt and in the immutable args, on purpose;
     *           removing either changes every future address.
     *         - Calls `initializeAccount` on the new clone. Any revert bubbles and the whole
     *           deployment unwinds, so an uninitialised wallet can never exist on-chain.
     *         - Emits `WalletDeployed`.
     *
     * @param  label   Free-form label, emitted in the event and stored on the wallet (`AGW.label`).
     * @return wallet  Address of the newly deployed wallet.
     */
    function deployWallet(string calldata label) external whenNotPaused returns (address wallet) {
        address implementation = _walletImplementation;
        if (implementation == address(0)) revert AGWFactoryErrors.ImplementationNotSet();

        address owner = msg.sender;
        wallet = _deploy(implementation, owner, _walletCount[owner], label);
    }

    /**
     * @notice Deploys wallet `intent.index` for `intent.owner`, on the owner's signature.
     *
     * @dev    - The index is EXPLICIT and must equal the owner's current count, and `intent.wallet` must
     *           be the address this call deploys. So a signed intent is idempotent and unmovable: a
     *           replay fails on the index, and nobody can advance an owner's count without the owner's
     *           signature.
     *         - `msg.sender == intent.owner` needs no signature (the caller is the owner, exactly as in
     *           the single-argument form). Any other caller must be `intent.executor` (non-zero) and
     *           must carry the owner's signature, before the deadline.
     *         - Grant and exec fields of the intent are ignored here; the wallet checks those.
     *         - Every check runs before `_deploy`, which advances the count before its one external
     *           call — the same effect ordering the single-argument form relies on.
     *
     * @param  intent  The owner's intent. Only `owner`, `wallet`, `executor`, `index`, `deadline` and
     *                 `signerChainId` are read here.
     * @param  sig     The owner's signature over `intent`; ignored when the caller is the owner.
     * @param  label   Free-form label, emitted, and stored on the wallet (`AGW.label`). Not signed.
     * @return wallet  The deployed wallet.
     */
    function deployWalletWithSig(OwnerIntent calldata intent, bytes calldata sig, string calldata label)
        external
        whenNotPaused
        returns (address wallet)
    {
        address implementation = _walletImplementation;
        if (implementation == address(0)) revert AGWFactoryErrors.ImplementationNotSet();

        address owner = intent.owner;
        if (owner == address(0)) revert AGWFactoryErrors.ZeroAddress();

        uint96 index = intent.index;
        uint96 next = _walletCount[owner];
        if (index != next) revert AGWFactoryErrors.IndexMismatch(next, index);

        address predicted = _predict(implementation, owner, index);
        if (intent.wallet != predicted) revert AGWFactoryErrors.IntentWalletMismatch(predicted, intent.wallet);

        if (msg.sender != owner) {
            if (intent.executor == address(0) || msg.sender != intent.executor) {
                revert AGWFactoryErrors.ExecutorMismatch(intent.executor, msg.sender);
            }
            if (block.timestamp > intent.deadline) revert AGWFactoryErrors.SignatureExpired(intent.deadline);
            if (!OwnerAuthLib.isOwnerSig(owner, OwnerAuthLib.intentDigest(address(this), intent), sig)) {
                revert AGWFactoryErrors.InvalidOwnerSignature();
            }
        }

        wallet = _deploy(implementation, owner, index, label);
    }

    /// @inheritdoc IAGWFactory
    function domainSeparator(uint256 signerChainId) external view returns (bytes32) {
        return OwnerAuthLib.domainSeparator(address(this), signerChainId);
    }

    /**
     * @dev The deployment tail shared by `deployWallet` and `deployWalletWithSig`. BYTE-FOR-BYTE the logic the
     *      single-argument form always had: count advance → salt → args → clone → record →
     *      initializeAccount → event. Every caller has run all of its checks before calling this.
     *
     *      - The count advances and the record is written before the single external call, which is
     *        what makes a reentrant deploy unable to reuse an index.
     *      - Salt and args are frozen forever: counterfactual funding relies on them.
     */
    function _deploy(address implementation, address owner, uint96 index, string calldata label)
        internal
        returns (address wallet)
    {
        _walletCount[owner] = index + 1;

        bytes32 salt = keccak256(abi.encode(owner, index));
        // 40 bytes: owner at 0-19, factory at 20-39. Frozen forever.
        bytes memory args = abi.encodePacked(owner, address(this));

        wallet = Clones.cloneDeterministicWithImmutableArgs(implementation, args, salt);

        _records[wallet] = WalletRecord({ owner: owner, index: index });

        IAGWInit(wallet).initializeAccount(label);

        emit WalletDeployed(owner, index, wallet, label);
    }

    /**
     * @dev The address derivation, shared by `predictWallet` and `deployWalletWithSig`.
     *      Mirrors `_deploy`'s salt and args exactly; any divergence is a critical bug.
     */
    function _predict(address implementation, address owner, uint96 index) internal view returns (address) {
        bytes32 salt = keccak256(abi.encode(owner, index));
        bytes memory args = abi.encodePacked(owner, address(this));
        return Clones.predictDeterministicAddressWithImmutableArgs(implementation, args, salt, address(this));
    }

    /**
     * @notice The address wallet `index` of `owner` has, or will have.
     *
     * @dev    - Reverts with `ImplementationNotSet` if the implementation is unset, and with
     *           `IndexOutOfRange` if `index` is beyond the next deployable one. Funding an address
     *           further out than that would put money in a permanent hole.
     *         - Mirrors `deployWallet`'s salt and args derivation exactly. Any divergence between
     *           the two is a critical bug, because counterfactual funding relies on this answer.
     *         - `deployed` is derived from the sequential index rather than `extcodesize`, which
     *           would misreport during construction and cost more.
     *
     * @param  owner     Wallet owner to predict for.
     * @param  index     Wallet index under that owner.
     * @return wallet    The deterministic address for that owner and index.
     * @return deployed  True if that wallet already exists.
     */
    function predictWallet(address owner, uint256 index) external view returns (address wallet, bool deployed) {
        address implementation = _walletImplementation;
        if (implementation == address(0)) revert AGWFactoryErrors.ImplementationNotSet();

        uint256 next = _walletCount[owner];
        if (index > next) revert AGWFactoryErrors.IndexOutOfRange(index, next);

        wallet = _predict(implementation, owner, uint96(index));
        deployed = index < next;
    }

    /**
     * @notice How many wallets `owner` has; also the index the next deploy will use.
     * @dev    Full enumeration is this call plus `predictWallet(owner, 0..count-1)`, which is why no
     *         per-owner wallet array is stored: it cannot be lost or desynced.
     * @param  owner  Owner to count wallets for.
     * @return The number of wallets deployed for that owner.
     */
    function walletCount(address owner) external view returns (uint256) {
        return _walletCount[owner];
    }

    /**
     * @notice The owner of `wallet`, or address(0) if this factory did not deploy it.
     * @param  wallet  Wallet to look up.
     * @return The recorded owner, or the zero address.
     */
    function ownerOf(address wallet) external view returns (address) {
        return _records[wallet].owner;
    }

    /**
     * @notice True only for wallets this factory deployed.
     * @param  account  Address to test.
     * @return Whether this factory deployed it.
     */
    function isWallet(address account) external view returns (bool) {
        return _records[account].owner != address(0);
    }

    /**
     * @notice The wallet's index under its owner.
     * @dev    Reverts with `NotAWallet` rather than returning zero, because zero is a valid index.
     * @param  wallet  Wallet to look up.
     * @return Its index under its owner.
     */
    function indexOf(address wallet) external view returns (uint256) {
        WalletRecord memory record = _records[wallet];
        if (record.owner == address(0)) revert AGWFactoryErrors.NotAWallet(wallet);
        return record.index;
    }

    /**
     * @notice The canonical wallet logic contract.
     * @dev    The only getter for it; the variable is `internal` precisely so no second,
     *         auto-generated getter exists. Exposed so the SDK can verify its local derivation
     *         mirror before showing a user an address to fund.
     * @return The wallet implementation every clone delegates to.
     */
    function walletImplementation() external view returns (address) {
        return _walletImplementation;
    }

    /**
     * @notice Pauses wallet deployment.
     * @dev    - Gates `deployWallet` only. Views are never gated, and deployed wallets are
     *           unaffected, since the factory has no reach into them.
     *         - While paused, a user who funded a predicted address cannot deploy it. Availability
     *           only; funds are never lost.
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Resumes wallet deployment.
     * @dev    The role split is deliberate: pause is a cheap panic button, unpause a considered
     *         operational act. A pauser cannot unpause, and an operator cannot pause.
     */
    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Authorises a UUPS upgrade of this logic contract.
     *
     *      - Restricted to the default admin role; reverts with `ZeroAddress` on a zero
     *        implementation.
     *      - Every future logic upgrade must leave the salt formula, the immutable-args encoding,
     *        the value of `_walletImplementation` and the storage layout unchanged. Upgrades exist
     *        for logic bugs only; the address derivation is frozen forever.
     *      - New variables are appended after `_walletImplementation`; base contracts are never
     *        added, removed or reordered, and nothing may come to share that slot.
     *      - Not `view` although solc suggests it: the base declares `_authorizeUpgrade` non-view,
     *        and an override cannot add mutability restrictions the base does not have.
     *
     * @param newImplementation  The logic contract being upgraded to.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert AGWFactoryErrors.ZeroAddress();
    }
}
