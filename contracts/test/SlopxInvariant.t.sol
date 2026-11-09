// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/SlopxPools.sol";

/// Random sequences of deposits / proposals / rejections / settles / claims / pauses / voids
/// across 2 markets x several rounds. After every call: the contract can pay everything it owes.
contract Handler is Test {
    SlopxPools public pool;
    address keeper; address guardian;
    address[] public users;
    uint256 public constant MARKETS = 2;
    uint256 public maxRound;
    uint256 public settles; uint256 public claims; uint256 public voids; uint256 public deposits;

    constructor(SlopxPools p, address k, address g) {
        pool = p; keeper = k; guardian = g;
        vm.deal(address(this), 1_000_000 ether); // deposits are paid from the handler (prank only sets msg.sender)
        for (uint256 i; i < 6; i++) { address u = address(uint160(0x1000 + i)); users.push(u); vm.deal(u, 1_000 ether); }
    }

    function _round(uint256 seed) internal view returns (uint256) { return maxRound == 0 ? 0 : seed % (maxRound + 1); }

    function deposit(uint256 u, uint256 m, bool long, uint256 amt) external {
        uint256 r = pool.openRound();
        if (block.timestamp + pool.lockBuffer() >= pool.roundStart(r)) return;
        amt = bound(amt, pool.minDeposit(), pool.maxWalletPerRound() / 3);
        address who = users[u % users.length];
        vm.prank(who);
        try pool.deposit{value: amt}(m % MARKETS, r, long ? SlopxPools.Side.Long : SlopxPools.Side.Short) { deposits++; } catch {}
        if (r > maxRound) maxRound = r;
    }

    function warp(uint256 s) external { vm.warp(block.timestamp + bound(s, 5 minutes, 40 minutes)); }

    function propose(uint256 m, uint256 rs, uint256 result) external {
        result = bound(result, 1, 3e18);
        vm.prank(keeper);
        try pool.proposeResult(m % MARKETS, _round(rs), result, keccak256(abi.encode(result))) {} catch {}
    }

    function reject(uint256 m, uint256 rs) external { vm.prank(guardian); try pool.rejectResult(m % MARKETS, _round(rs)) {} catch {} }
    function settle(uint256 m, uint256 rs) external { try pool.settle(m % MARKETS, _round(rs)) { settles++; } catch {} }
    function voidRound(uint256 m, uint256 rs) external { if (rs % 10 != 0) return; vm.prank(guardian); try pool.emergencyVoid(m % MARKETS, _round(rs)) { voids++; } catch {} }
    function pause(uint256 s) external { vm.prank(guardian); pool.setPaused(s % 8 == 0); } // paused ~1/8 of the time

    function claim(uint256 u, uint256 m, uint256 rs) external {
        vm.prank(users[u % users.length]);
        try pool.claim(m % MARKETS, _round(rs)) { claims++; } catch {}
    }

    function withdrawFees() external { pool.withdrawFees(); }

    /// keeper proposes every ended round, waits the dispute window, settles, then everyone claims
    function settleAndClaimAll(uint256 result) external {
        for (uint256 m; m < MARKETS; m++) for (uint256 r; r <= maxRound; r++) {
            if (block.timestamp < pool.roundEnd(r)) continue;
            vm.prank(keeper);
            try pool.proposeResult(m, r, bound(result + r, 1, 3e18), bytes32(r)) {} catch {}
        }
        vm.warp(block.timestamp + pool.disputeWindow());
        for (uint256 m; m < MARKETS; m++) for (uint256 r; r <= maxRound; r++) {
            try pool.settle(m, r) { settles++; } catch {}
            for (uint256 i; i < users.length; i++) { vm.prank(users[i]); try pool.claim(m, r) { claims++; } catch {} }
        }
    }

    /// sum of everything still claimable right now
    function outstanding() external view returns (uint256 sum) {
        for (uint256 m; m < MARKETS; m++) for (uint256 r; r <= maxRound; r++) for (uint256 i; i < users.length; i++)
            sum += pool.claimable(m, r, users[i]);
    }
}

contract SlopxInvariantTest is Test {
    SlopxPools pool; Handler h;

    function setUp() public {
        vm.warp(1_000_000 - 2_000);
        pool = new SlopxPools(1_000_000, 3600, address(0xBEEF), address(0x6A), address(0x7E));
        pool.addMarket("TRENCH24"); pool.addMarket("PAIR");
        h = new Handler(pool, address(0xBEEF), address(0x6A));
        targetContract(address(h));
    }

    /// The pool always holds at least what it owes (claimable now + unwithdrawn fees).
    function invariant_solvent() public view {
        assertGe(address(pool).balance, h.outstanding() + pool.feesAccrued());
    }

    function afterInvariant() external view {
        console.log('deposits/settles/voids/claims', h.deposits(), h.settles(), h.voids());
        console.log('claims', h.claims());
    }

    /// Accounting: tracked liabilities never exceed balance.
    function invariant_liabilitiesCovered() public view {
        assertGe(address(pool).balance, pool.totalLiabilities() + pool.feesAccrued());
    }
}
