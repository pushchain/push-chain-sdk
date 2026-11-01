// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title  AgentConfigLib
 * @notice The one decoder of a rules set's agent config — `sessionValidatorInitData` — shared by the
 *         session validator, which enforces it, and the wallet, which reads it for the agent door's
 *         pre-check and the `agentOf` view. One decoder, so the two can never disagree.
 *
 * @dev    THE FORMAT, FROZEN: `abi.encode(address agent)` — exactly 32 bytes, the upper 12 bytes zero,
 *         the address non-zero. The agent is a Push address: an EOA, or the UEA of an external key.
 *         The config is an input to every permission id (`IdLib`), so changing this format changes
 *         every id; it may never change.
 *
 *         Never reverts. A config that is not exactly that shape decodes to `address(0)`, which no
 *         caller can ever be, so every consumer fails closed on it.
 */
library AgentConfigLib {
    /// @dev Byte length of a well-formed config: one ABI word.
    uint256 internal constant CONFIG_LENGTH = 32;

    /**
     * @notice The agent named by `config`, or `address(0)` if `config` is malformed.
     * @param  config  The rules set's `sessionValidatorInitData`.
     * @return agent   The agent's Push address; zero when the config is not exactly one ABI word
     *                 holding a non-zero address with clean upper bytes.
     */
    function decode(bytes memory config) internal pure returns (address agent) {
        if (config.length != CONFIG_LENGTH) return address(0);
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(config, 0x20))
        }
        if (word >> 160 != 0) return address(0);
        // forge-lint: disable-next-line(unsafe-typecast)
        agent = address(uint160(word)); // the upper 96 bits were just checked zero, nothing truncates
    }
}
