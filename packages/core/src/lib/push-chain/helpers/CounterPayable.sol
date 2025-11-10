// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

contract Counter {
    uint256 public countPC;
    event CountIncremented(uint256 indexed countPC, address indexed caller, uint256 value);

    function increment() public payable {
        countPC += 1;
        emit CountIncremented(countPC, msg.sender, msg.value);
    }

    function reset() public {
        countPC = 0;
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}

}