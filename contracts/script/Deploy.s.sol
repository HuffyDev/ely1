// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/SlopxPools.sol";

/// Usage (testnet): forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
/// Reads DEPLOYER_PRIVATE_KEY, KEEPER_ADDRESS, GUARDIAN_ADDRESS, TREASURY_ADDRESS from env.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 duration = vm.envOr("ROUND_DURATION", uint256(3600));
        // genesis aligned to the next full hour
        uint256 genesis = ((block.timestamp / duration) + 1) * duration;
        vm.startBroadcast(pk);
        SlopxPools pool = new SlopxPools(genesis, duration, keeper, guardian, treasury);
        pool.addMarket("TRENCH24");          // 0: every token launched in the past 24h
        pool.addMarket("MONTRA/ASCEND");     // 1: Montra launches vs Ascend launches
        vm.stopBroadcast();
        console.log("SlopxPools", address(pool));
        console.log("genesis", genesis);
    }
}
