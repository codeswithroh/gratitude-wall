// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Leaderboard.sol";

contract DeployLeaderboard is Script {
    function run() external {
        vm.startBroadcast();
        new Leaderboard();
        vm.stopBroadcast();
    }
}
