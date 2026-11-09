// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/SlopxPools.sol";

contract Reenter {
    SlopxPools pool; uint256 m; uint256 r; bool tried;
    constructor(SlopxPools p) { pool = p; }
    function dep(uint256 _m, uint256 _r, SlopxPools.Side s) external payable { m = _m; r = _r; pool.deposit{value: msg.value}(_m, _r, s); }
    function doClaim() external { pool.claim(m, r); }
    receive() external payable { if (!tried) { tried = true; pool.claim(m, r); } }
}

contract SlopxPoolsTest is Test {
    SlopxPools pool;
    address keeper = address(0x433);
    address guardian = address(0x6A);
    address treasury = address(0x7E);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address carol = address(0xC0);
    uint256 constant G = 1_000_000;
    uint256 constant D = 3600;
    uint256 mkt;

    function setUp() public {
        vm.warp(G - 1000);
        pool = new SlopxPools(G, D, keeper, guardian, treasury);
        mkt = pool.addMarket("TRENCH24");
        vm.deal(alice, 1000 ether); vm.deal(bob, 1000 ether); vm.deal(carol, 1000 ether);
        // most unit tests exercise the maths with larger sizes; launch defaults are tested separately
        pool.setLimits(0.01 ether, 10 ether, 500 ether);
    }

    function test_launchDefaultsAreLow() public {
        SlopxPools fresh = new SlopxPools(G, D, keeper, guardian, treasury);
        uint256 m = fresh.addMarket("X");
        assertEq(fresh.maxWalletPerRound(), 1 ether);
        assertEq(fresh.maxSidePerRound(), 25 ether);
        vm.prank(alice);
        vm.expectRevert(SlopxPools.CapExceeded.selector);
        fresh.deposit{value: 1.01 ether}(m, 0, SlopxPools.Side.Short);
        vm.prank(alice); fresh.deposit{value: 1 ether}(m, 0, SlopxPools.Side.Short);
    }

    function test_limitCeilings() public {
        vm.expectRevert(SlopxPools.BadParam.selector);
        pool.setLimits(0.01 ether, 11 ether, 500 ether);
        vm.expectRevert(SlopxPools.BadParam.selector);
        pool.setLimits(0.01 ether, 10 ether, 501 ether);
    }

    function _dep(address u, uint256 r, SlopxPools.Side s, uint256 a) internal {
        vm.prank(u); pool.deposit{value: a}(mkt, r, s);
    }

    function _finish(uint256 r, uint256 result) internal {
        vm.warp(pool.roundEnd(r));
        vm.prank(keeper); pool.proposeResult(mkt, r, result, keccak256("data"));
        vm.warp(block.timestamp + pool.disputeWindow());
        pool.settle(mkt, r);
    }

    function _status(uint256 r) internal view returns (SlopxPools.Status st) {
        (,,,, st,,) = pool.rounds(mkt, r);
    }

    // ------------------------------------------------------------- basics
    function test_longWins_noSkewNoFunding() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        _finish(0, 1.05e18);
        uint256 a0 = alice.balance;
        vm.prank(alice); pool.claim(mkt, 0);
        // fee 2% of 1 ether transferred
        assertEq(alice.balance - a0, 1.98 ether);
        assertEq(pool.claimable(mkt, 0, bob), 0);
        assertEq(pool.feesAccrued(), 0.02 ether);
        pool.withdrawFees();
        assertEq(treasury.balance, 0.02 ether);
    }

    function test_shortWins_withFunding() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 3 ether);
        // skew 50% -> rate = 5% * 0.5 = 2.5% (= max 2.5%) of 3 => f = 0.075
        (uint256 eL, uint256 eS) = pool.fundingFor(mkt, 0);
        assertEq(eL, 1.075 ether); assertEq(eS, 2.925 ether);
        _finish(0, 0.9e18);
        // shorts win effL 1.075 ; fee 2% => 0.0215
        assertEq(pool.claimable(mkt, 0, bob), 2.925 ether + 1.075 ether - 0.0215 ether);
        assertEq(pool.claimable(mkt, 0, alice), 0);
    }

    function test_payoutCapReturnsExcessToLosers() public {
        _dep(alice, 0, SlopxPools.Side.Long, 0.1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 10 ether);
        _finish(0, 2e18);
        (uint256 eL,) = pool.fundingFor(mkt, 0);
        uint256 a = pool.claimable(mkt, 0, alice);
        uint256 b = pool.claimable(mkt, 0, bob);
        // gross transfer capped at 5x of effective long stake
        assertLe(a, eL + eL * 5);
        assertGt(b, 0, "losers get excess back");
        assertEq(a + b + pool.feesAccrued(), 10.1 ether);
    }

    function test_oneSidedRefund() public {
        _dep(alice, 0, SlopxPools.Side.Short, 2 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        vm.warp(pool.roundEnd(0));
        pool.settle(mkt, 0);
        assertEq(uint8(_status(0)), uint8(SlopxPools.Status.Voided));
        assertEq(pool.claimable(mkt, 0, alice), 2 ether);
        assertEq(pool.claimable(mkt, 0, bob), 1 ether);
    }

    function test_missingPriceRefund() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        vm.warp(pool.roundEnd(0) + 1);
        vm.expectRevert(SlopxPools.TooEarly.selector);
        pool.settle(mkt, 0);
        vm.warp(pool.roundEnd(0) + pool.maxPriceDelay() + 1);
        pool.settle(mkt, 0);
        assertEq(pool.claimable(mkt, 0, alice), 1 ether);
        vm.prank(alice); pool.claim(mkt, 0);
        vm.prank(bob); pool.claim(mkt, 0);
        assertEq(address(pool).balance, 0);
    }

    function test_tieRefund() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        _finish(0, 1e18);
        assertEq(uint8(_status(0)), uint8(SlopxPools.Status.Voided));
    }

    function test_disputeRejectThenRepropose() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        vm.warp(pool.roundEnd(0));
        vm.prank(keeper); pool.proposeResult(mkt, 0, 5e18, bytes32(0));
        vm.prank(guardian); pool.rejectResult(mkt, 0);
        vm.warp(block.timestamp + pool.disputeWindow());
        vm.expectRevert(SlopxPools.TooEarly.selector);
        pool.settle(mkt, 0);
        vm.prank(keeper); pool.proposeResult(mkt, 0, 0.5e18, bytes32(0));
        vm.expectRevert(SlopxPools.TooEarly.selector);
        pool.settle(mkt, 0);
        vm.warp(block.timestamp + pool.disputeWindow());
        pool.settle(mkt, 0);
        assertGt(pool.claimable(mkt, 0, bob), 1 ether);
    }

    function test_cannotRejectAfterWindow() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        vm.warp(pool.roundEnd(0));
        vm.prank(keeper); pool.proposeResult(mkt, 0, 2e18, bytes32(0));
        vm.warp(block.timestamp + pool.disputeWindow());
        vm.prank(guardian);
        vm.expectRevert(SlopxPools.BadState.selector);
        pool.rejectResult(mkt, 0);
    }

    function test_proposeTooEarlyAndOnlyKeeper() public {
        vm.prank(keeper);
        vm.expectRevert(SlopxPools.TooEarly.selector);
        pool.proposeResult(mkt, 0, 2e18, bytes32(0));
        vm.warp(pool.roundEnd(0));
        vm.prank(alice);
        vm.expectRevert(SlopxPools.NotAuthorized.selector);
        pool.proposeResult(mkt, 0, 2e18, bytes32(0));
    }

    function test_pauseBlocksDepositsButNotClaims() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        vm.prank(guardian); pool.setPaused(true);
        vm.prank(carol);
        vm.expectRevert(SlopxPools.IsPaused.selector);
        pool.deposit{value: 1 ether}(mkt, 0, SlopxPools.Side.Long);
        vm.prank(guardian); pool.emergencyVoid(mkt, 0);
        vm.prank(alice); pool.claim(mkt, 0);
        assertEq(pool.claimable(mkt, 0, bob), 1 ether);
    }

    function test_pausedSettlementFallsBackToRefund() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        vm.warp(pool.roundEnd(0));
        vm.prank(keeper); pool.proposeResult(mkt, 0, 2e18, bytes32(0));
        vm.prank(guardian); pool.setPaused(true);
        vm.warp(pool.roundEnd(0) + pool.maxPriceDelay() + 1);
        pool.settle(mkt, 0);
        assertEq(uint8(_status(0)), uint8(SlopxPools.Status.Voided));
    }

    function test_depositWindow() public {
        // round 1 starts at G+D; currently before genesis only round 0 is open
        vm.prank(alice);
        vm.expectRevert(SlopxPools.DepositsClosed.selector);
        pool.deposit{value: 1 ether}(mkt, 1, SlopxPools.Side.Long);
        // within lock buffer of round 0
        vm.warp(G - 30);
        vm.prank(alice);
        vm.expectRevert(SlopxPools.DepositsClosed.selector);
        pool.deposit{value: 1 ether}(mkt, 0, SlopxPools.Side.Long);
        // after round 0 starts, round 1 is open
        vm.warp(G + 1);
        vm.prank(alice);
        vm.expectRevert(SlopxPools.DepositsClosed.selector);
        pool.deposit{value: 1 ether}(mkt, 0, SlopxPools.Side.Long);
        _dep(alice, 1, SlopxPools.Side.Long, 1 ether);
    }

    function test_caps() public {
        vm.prank(alice);
        vm.expectRevert(SlopxPools.BadAmount.selector);
        pool.deposit{value: 0.001 ether}(mkt, 0, SlopxPools.Side.Long);
        _dep(alice, 0, SlopxPools.Side.Long, 6 ether);
        vm.prank(alice);
        vm.expectRevert(SlopxPools.CapExceeded.selector);
        pool.deposit{value: 5 ether}(mkt, 0, SlopxPools.Side.Short);
        pool.setLimits(0.01 ether, 10 ether, 10 ether);
        _dep(bob, 0, SlopxPools.Side.Long, 4 ether);
        vm.prank(carol);
        vm.expectRevert(SlopxPools.CapExceeded.selector);
        pool.deposit{value: 1 ether}(mkt, 0, SlopxPools.Side.Long);
    }

    function test_doubleClaimReverts() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        _finish(0, 2e18);
        vm.prank(alice); pool.claim(mkt, 0);
        vm.prank(alice);
        vm.expectRevert(SlopxPools.NothingToClaim.selector);
        pool.claim(mkt, 0);
    }

    function test_reentrancyBlocked() public {
        Reenter r = new Reenter(pool);
        vm.deal(address(r), 0);
        r.dep{value: 1 ether}(mkt, 0, SlopxPools.Side.Long);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        _finish(0, 2e18);
        vm.expectRevert(SlopxPools.TransferFailed.selector);
        r.doClaim();
    }

    function test_paramsSnapshotPerRound() public {
        _dep(alice, 0, SlopxPools.Side.Long, 1 ether);
        _dep(bob, 0, SlopxPools.Side.Short, 1 ether);
        pool.setParams(SlopxPools.Params(500, 50_000, 1000, 500, 5000, 1));
        _finish(0, 2e18);
        assertEq(pool.feesAccrued(), 0.02 ether); // old 2% fee
    }

    function test_adminBounds() public {
        vm.expectRevert(SlopxPools.BadParam.selector);
        pool.setParams(SlopxPools.Params(501, 50_000, 1000, 500, 5000, 1));
        vm.prank(alice);
        vm.expectRevert(SlopxPools.NotAuthorized.selector);
        pool.setParams(SlopxPools.Params(100, 50_000, 1000, 500, 5000, 1));
        vm.prank(alice);
        vm.expectRevert(SlopxPools.NotAuthorized.selector);
        pool.setPaused(true);
    }

    function test_rejectsDirectTransfer() public {
        vm.prank(alice);
        (bool ok,) = address(pool).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------- fuzz
    function testFuzz_payoutsConserve(uint128 L, uint128 S, bool longWins, uint16 fee, uint16 maxP, uint16 k, uint16 fmax, uint16 fcap) public pure {
        L = uint128(bound(L, 1, 1e30)); S = uint128(bound(S, 1, 1e30));
        SlopxPools.Params memory p = SlopxPools.Params(
            uint16(bound(fee, 0, 500)), uint16(bound(maxP, 10_000, 60_000)), uint16(bound(k, 0, 10_000)),
            uint16(bound(fmax, 0, 2_000)), uint16(bound(fcap, 0, 10_000)), 1);
        (uint256 lp, uint256 sp, uint256 f) = _compute(L, S, longWins, p);
        assertEq(lp + sp + f, uint256(L) + S, "conservation");
        // winners never get less than their raw stake minus funding paid, losers never more than stake
        uint256 W = longWins ? L : S; uint256 winPool = longWins ? lp : sp; uint256 losePool = longWins ? sp : lp;
        uint256 Lo = longWins ? S : L;
        assertLe(losePool, Lo + (Lo * p.fundingCapBps) / 10_000 + 1);
        // profit cap: win pool <= effW * (1 + maxProfit)
        assertLe(winPool, W + (W * p.fundingCapBps) / 10_000 + ((W + (W * p.fundingCapBps) / 10_000) * p.maxProfitBps) / 10_000 + 1);
    }

    function _compute(uint256 L, uint256 S, bool w, SlopxPools.Params memory p) internal pure returns (uint256, uint256, uint256) {
        // replicate via a fresh instance-free call (pure function on contract code)
        (uint256 eL, uint256 eS) = _applyFunding(L, S, p);
        assertEq(eL + eS, L + S, "funding conserves");
        uint256 effW = w ? eL : eS; uint256 effLo = w ? eS : eL;
        uint256 mt = (effW * p.maxProfitBps) / 10_000;
        uint256 t = effLo < mt ? effLo : mt;
        uint256 f = (t * p.feeBps) / 10_000;
        return w ? (effW + t - f, effLo - t, f) : (effLo - t, effW + t - f, f);
    }

    function _applyFunding(uint256 L, uint256 S, SlopxPools.Params memory p) internal pure returns (uint256, uint256) {
        uint256 tot = L + S;
        if (L == S) return (L, S);
        bool sc = S > L; uint256 c = sc ? S : L; uint256 m = sc ? L : S;
        uint256 rate = (((c - m) * 10_000) / tot * p.fundingK) / 10_000;
        if (rate > p.fundingMaxBps) rate = p.fundingMaxBps;
        uint256 f = (c * rate) / 10_000; uint256 cap = (m * p.fundingCapBps) / 10_000;
        if (f > cap) f = cap;
        return sc ? (L + f, S - f) : (L - f, S + f);
    }

    function testFuzz_contractMatchesReference(uint128 L, uint128 S, bool w) public view {
        L = uint128(bound(L, 1, 1e30)); S = uint128(bound(S, 1, 1e30));
        (uint16 a, uint16 b, uint16 c, uint16 d, uint16 e, uint16 t) = pool.params();
        SlopxPools.Params memory p = SlopxPools.Params(a, b, c, d, e, t);
        (uint256 lp, uint256 sp, uint256 f) = pool.computePayouts(L, S, w, p);
        (uint256 lp2, uint256 sp2, uint256 f2) = _compute(L, S, w, p);
        assertEq(lp, lp2); assertEq(sp, sp2); assertEq(f, f2);
    }

    function testFuzz_fundingFavoursMinority(uint128 L, uint128 S) public view {
        L = uint128(bound(L, 1, 1e30)); S = uint128(bound(S, 1, 1e30));
        (uint16 a, uint16 b, uint16 c, uint16 d, uint16 e, uint16 t) = pool.params();
        (uint256 eL, uint256 eS) = pool.applyFunding(L, S, SlopxPools.Params(a, b, c, d, e, t));
        if (S > L) { assertGe(eL, L); assertLe(eS, S); }
        if (L > S) { assertGe(eS, S); assertLe(eL, L); }
        assertEq(eL + eS, uint256(L) + S);
    }

    /// end-to-end: many wallets, random outcome, sum of claims + fee never exceeds deposits
    function testFuzz_endToEndSolvent(uint256 seed, uint8 n, uint256 result) public {
        n = uint8(bound(n, 2, 30));
        result = bound(result, 1, 10e18);
        address[] memory users = new address[](n);
        for (uint256 i; i < n; i++) {
            users[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1 << 150));
            vm.deal(users[i], 20 ether);
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i, "a"))), 0.01 ether, 10 ether);
            SlopxPools.Side s = uint256(keccak256(abi.encode(seed, i, "s"))) % 4 == 0 ? SlopxPools.Side.Long : SlopxPools.Side.Short;
            vm.prank(users[i]); pool.deposit{value: amt}(mkt, 0, s);
        }
        uint256 total = address(pool).balance;
        vm.warp(pool.roundEnd(0));
        vm.prank(keeper); pool.proposeResult(mkt, 0, result, bytes32(0));
        vm.warp(block.timestamp + pool.disputeWindow());
        pool.settle(mkt, 0);
        uint256 paid;
        for (uint256 i; i < n; i++) {
            uint256 c = pool.claimable(mkt, 0, users[i]);
            if (c > 0) { vm.prank(users[i]); pool.claim(mkt, 0); paid += c; }
        }
        assertLe(paid + pool.feesAccrued(), total);
        assertLe(total - paid - pool.feesAccrued(), n + 2, "dust bounded");
        assertEq(address(pool).balance, total - paid);
        pool.withdrawFees();
        assertGe(address(pool).balance, pool.totalLiabilities());
    }
}
