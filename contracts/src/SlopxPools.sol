// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title SlopxPools — hourly pari-mutuel long/short pools on index results
/// @notice UNAUDITED. Winners are paid only from losers' deposits (minus fee), so the
///         contract cannot owe more than it holds. Deposits are in native HYPE.
contract SlopxPools {
    // ------------------------------------------------------------------ types
    enum Side { Long, Short }
    enum Status { Open, Settled, Voided }

    struct Params {
        uint16 feeBps;            // fee on value transferred from losers
        uint16 maxProfitBps;      // cap on gross transfer, as bps of winners' effective stake
        uint16 fundingK;          // funding rate bps per 100% skew
        uint16 fundingMaxBps;     // max funding rate (bps of crowded stake)
        uint16 fundingCapBps;     // funding received capped at bps of minority stake
        uint16 tieBps;            // |result-1| below this => refund
    }

    struct Round {
        uint128 longTotal;
        uint128 shortTotal;
        uint128 longPayout;       // amount distributed to long depositors
        uint128 shortPayout;      // amount distributed to short depositors
        Status status;
        bool paramsSet;
        Params p;
    }

    struct Proposal {
        uint256 resultE18;        // 1e18 = flat. long wins if > 1e18
        bytes32 dataHash;         // keccak256 of published round JSON
        uint64 proposedAt;
    }

    struct Market {
        string name;
        bool active;
    }

    // ------------------------------------------------------------------ config
    uint256 public constant ONE = 1e18;
    uint256 public immutable genesis;
    uint256 public immutable roundDuration;

    address public owner;
    address public pendingOwner;
    address public keeper;
    address public guardian;
    address public treasury;
    bool public paused;

    Params public params;
    uint256 public lockBuffer = 60;          // deposits close this many seconds before start
    uint256 public disputeWindow = 600;      // seconds a proposal must sit before finalize
    uint256 public maxPriceDelay = 6 hours;  // after round end, no result => void
    uint256 public minDeposit = 0.01 ether;
    // Deliberately low launch caps: this code is unaudited. Owner can raise within setLimits bounds.
    uint256 public maxWalletPerRound = 1 ether;    // per wallet, per market-round, both sides
    uint256 public maxSidePerRound = 25 ether;     // per side, per market-round

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(uint256 => Round)) public rounds;          // market => round
    mapping(uint256 => mapping(uint256 => Proposal)) public proposals;    // market => round
    mapping(uint256 => mapping(uint256 => mapping(address => uint256[2]))) internal _stakes;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public claimed;
    uint256 public feesAccrued;
    uint256 public totalLiabilities; // deposits not yet paid out or taken as fees

    uint256 private _lock = 1;

    // ------------------------------------------------------------------ events
    event MarketAdded(uint256 indexed marketId, string name);
    event MarketActive(uint256 indexed marketId, bool active);
    event Deposited(uint256 indexed marketId, uint256 indexed roundId, address indexed user, Side side, uint256 amount);
    event ResultProposed(uint256 indexed marketId, uint256 indexed roundId, uint256 resultE18, bytes32 dataHash);
    event ResultRejected(uint256 indexed marketId, uint256 indexed roundId);
    event RoundSettled(uint256 indexed marketId, uint256 indexed roundId, uint256 resultE18, bytes32 dataHash, uint256 longPayout, uint256 shortPayout, uint256 fee);
    event RoundVoided(uint256 indexed marketId, uint256 indexed roundId, string reason);
    event Claimed(uint256 indexed marketId, uint256 indexed roundId, address indexed user, uint256 amount);
    event Paused(bool paused);
    event RoleSet(string role, address who);
    event ParamsSet(Params p);

    // ------------------------------------------------------------------ errors
    error NotAuthorized();
    error IsPaused();
    error BadMarket();
    error DepositsClosed();
    error BadAmount();
    error CapExceeded();
    error BadState();
    error TooEarly();
    error NothingToClaim();
    error Reentrancy();
    error TransferFailed();
    error BadParam();

    modifier onlyOwner() { if (msg.sender != owner) revert NotAuthorized(); _; }
    modifier onlyKeeper() { if (msg.sender != keeper) revert NotAuthorized(); _; }
    modifier onlyGuardian() { if (msg.sender != guardian && msg.sender != owner) revert NotAuthorized(); _; }
    modifier notPaused() { if (paused) revert IsPaused(); _; }
    modifier nonReentrant() { if (_lock != 1) revert Reentrancy(); _lock = 2; _; _lock = 1; }

    constructor(uint256 _genesis, uint256 _roundDuration, address _keeper, address _guardian, address _treasury) {
        if (_roundDuration < 300 || _treasury == address(0)) revert BadParam();
        genesis = _genesis;
        roundDuration = _roundDuration;
        owner = msg.sender;
        keeper = _keeper;
        guardian = _guardian;
        treasury = _treasury;
        params = Params({feeBps: 200, maxProfitBps: 50_000, fundingK: 500, fundingMaxBps: 250, fundingCapBps: 5_000, tieBps: 1});
    }

    // ------------------------------------------------------------------ time helpers
    function roundStart(uint256 roundId) public view returns (uint256) { return genesis + roundId * roundDuration; }
    function roundEnd(uint256 roundId) public view returns (uint256) { return roundStart(roundId + 1); }
    /// @notice the round currently accepting deposits (the next one to start)
    function openRound() public view returns (uint256) {
        if (block.timestamp < genesis) return 0;
        return (block.timestamp - genesis) / roundDuration + 1;
    }

    // ------------------------------------------------------------------ deposits
    function deposit(uint256 marketId, uint256 roundId, Side side) external payable nonReentrant notPaused {
        if (marketId >= marketCount || !markets[marketId].active) revert BadMarket();
        if (block.timestamp + lockBuffer >= roundStart(roundId)) revert DepositsClosed();
        if (roundId > openRound()) revert DepositsClosed(); // only the next round
        if (msg.value < minDeposit) revert BadAmount();

        Round storage r = rounds[marketId][roundId];
        if (!r.paramsSet) { r.p = params; r.paramsSet = true; } // snapshot params on first deposit

        uint256[2] storage s = _stakes[marketId][roundId][msg.sender];
        if (s[0] + s[1] + msg.value > maxWalletPerRound) revert CapExceeded();
        s[uint8(side)] += msg.value;
        if (side == Side.Long) {
            if (r.longTotal + msg.value > maxSidePerRound) revert CapExceeded();
            r.longTotal += uint128(msg.value);
        } else {
            if (r.shortTotal + msg.value > maxSidePerRound) revert CapExceeded();
            r.shortTotal += uint128(msg.value);
        }
        totalLiabilities += msg.value;
        emit Deposited(marketId, roundId, msg.sender, side, msg.value);
    }

    // ------------------------------------------------------------------ results
    function proposeResult(uint256 marketId, uint256 roundId, uint256 resultE18, bytes32 dataHash) external onlyKeeper notPaused {
        if (marketId >= marketCount) revert BadMarket();
        if (block.timestamp < roundEnd(roundId)) revert TooEarly();
        if (rounds[marketId][roundId].status != Status.Open) revert BadState();
        if (proposals[marketId][roundId].proposedAt != 0) revert BadState();
        if (resultE18 == 0) revert BadParam();
        proposals[marketId][roundId] = Proposal(resultE18, dataHash, uint64(block.timestamp));
        emit ResultProposed(marketId, roundId, resultE18, dataHash);
    }

    /// @notice guardian can reject a pending proposal during the dispute window
    function rejectResult(uint256 marketId, uint256 roundId) external onlyGuardian {
        Proposal storage pr = proposals[marketId][roundId];
        if (pr.proposedAt == 0 || rounds[marketId][roundId].status != Status.Open) revert BadState();
        if (block.timestamp >= pr.proposedAt + disputeWindow) revert BadState();
        delete proposals[marketId][roundId];
        emit ResultRejected(marketId, roundId);
    }

    /// @notice anyone can settle once the dispute window passed, or void if the result is missing
    function settle(uint256 marketId, uint256 roundId) external nonReentrant {
        Round storage r = rounds[marketId][roundId];
        if (r.status != Status.Open) revert BadState();
        if (block.timestamp < roundEnd(roundId)) revert TooEarly();

        if (r.longTotal == 0 || r.shortTotal == 0) { _void(marketId, roundId, "one-sided"); return; }

        Proposal memory pr = proposals[marketId][roundId];
        bool ready = pr.proposedAt != 0 && block.timestamp >= pr.proposedAt + disputeWindow && !paused;
        if (!ready) {
            if (block.timestamp > roundEnd(roundId) + maxPriceDelay) { _void(marketId, roundId, "missing-result"); return; }
            revert TooEarly();
        }

        uint256 tie = (ONE * r.p.tieBps) / 10_000;
        uint256 diff = pr.resultE18 > ONE ? pr.resultE18 - ONE : ONE - pr.resultE18;
        if (diff < tie || diff == 0) { _void(marketId, roundId, "tie"); return; }

        (uint256 lp, uint256 sp, uint256 fee) = computePayouts(r.longTotal, r.shortTotal, pr.resultE18 > ONE, r.p);
        r.longPayout = uint128(lp);
        r.shortPayout = uint128(sp);
        r.status = Status.Settled;
        feesAccrued += fee;
        totalLiabilities -= fee;
        emit RoundSettled(marketId, roundId, pr.resultE18, pr.dataHash, lp, sp, fee);
    }

    /// @notice guardian emergency void: only ever refunds, cannot redirect funds
    function emergencyVoid(uint256 marketId, uint256 roundId) external onlyGuardian {
        if (rounds[marketId][roundId].status != Status.Open) revert BadState();
        _void(marketId, roundId, "guardian");
    }

    function _void(uint256 marketId, uint256 roundId, string memory reason) internal {
        Round storage r = rounds[marketId][roundId];
        r.longPayout = r.longTotal;
        r.shortPayout = r.shortTotal;
        r.status = Status.Voided;
        emit RoundVoided(marketId, roundId, reason);
    }

    // ------------------------------------------------------------------ payout math
    /// @notice funding + capped pari-mutuel. Returns the amount each side's depositors share.
    ///         Invariant: lp + sp + fee == L + S (up to rounding which favours the pool).
    function computePayouts(uint256 L, uint256 S, bool longWins, Params memory p)
        public pure returns (uint256 lp, uint256 sp, uint256 fee)
    {
        (uint256 effL, uint256 effS) = applyFunding(L, S, p);
        uint256 effW = longWins ? effL : effS;
        uint256 effLo = longWins ? effS : effL;
        uint256 maxTransfer = (effW * p.maxProfitBps) / 10_000;
        uint256 t = effLo < maxTransfer ? effLo : maxTransfer;
        fee = (t * p.feeBps) / 10_000;
        uint256 winPool = effW + t - fee;
        uint256 losePool = effLo - t;
        (lp, sp) = longWins ? (winPool, losePool) : (losePool, winPool);
    }

    /// @notice crowded side pays the minority side a skew-proportional share of its stake
    function applyFunding(uint256 L, uint256 S, Params memory p) public pure returns (uint256 effL, uint256 effS) {
        uint256 tot = L + S;
        if (tot == 0 || L == S) return (L, S);
        bool shortsCrowded = S > L;
        uint256 crowded = shortsCrowded ? S : L;
        uint256 minority = shortsCrowded ? L : S;
        uint256 skewBps = ((crowded - minority) * 10_000) / tot;
        uint256 rateBps = (skewBps * p.fundingK) / 10_000;
        if (rateBps > p.fundingMaxBps) rateBps = p.fundingMaxBps;
        uint256 f = (crowded * rateBps) / 10_000;
        uint256 capF = (minority * p.fundingCapBps) / 10_000;
        if (f > capF) f = capF;
        return shortsCrowded ? (L + f, S - f) : (L - f, S + f);
    }

    function fundingFor(uint256 marketId, uint256 roundId) external view returns (uint256 effL, uint256 effS) {
        Round storage r = rounds[marketId][roundId];
        return applyFunding(r.longTotal, r.shortTotal, r.paramsSet ? r.p : params);
    }

    // ------------------------------------------------------------------ claims (never pausable)
    function claimable(uint256 marketId, uint256 roundId, address user) public view returns (uint256 amt) {
        Round storage r = rounds[marketId][roundId];
        if (r.status == Status.Open || claimed[marketId][roundId][user]) return 0;
        uint256[2] storage s = _stakes[marketId][roundId][user];
        if (s[0] > 0) amt += (s[0] * r.longPayout) / r.longTotal;
        if (s[1] > 0) amt += (s[1] * r.shortPayout) / r.shortTotal;
    }

    function claim(uint256 marketId, uint256 roundId) external nonReentrant returns (uint256 amt) {
        amt = claimable(marketId, roundId, msg.sender);
        if (amt == 0) revert NothingToClaim();
        claimed[marketId][roundId][msg.sender] = true;
        totalLiabilities -= amt;
        (bool ok,) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
        emit Claimed(marketId, roundId, msg.sender, amt);
    }

    function stakeOf(uint256 marketId, uint256 roundId, address user) external view returns (uint256 longAmt, uint256 shortAmt) {
        uint256[2] storage s = _stakes[marketId][roundId][user];
        return (s[0], s[1]);
    }

    function roundParams(uint256 marketId, uint256 roundId) external view returns (Params memory) {
        return rounds[marketId][roundId].p;
    }

    // ------------------------------------------------------------------ admin
    function withdrawFees() external nonReentrant {
        uint256 a = feesAccrued;
        feesAccrued = 0;
        (bool ok,) = treasury.call{value: a}("");
        if (!ok) revert TransferFailed();
    }

    function addMarket(string calldata name) external onlyOwner returns (uint256 id) {
        id = marketCount++;
        markets[id] = Market(name, true);
        emit MarketAdded(id, name);
    }

    function setMarketActive(uint256 id, bool active) external onlyOwner {
        if (id >= marketCount) revert BadMarket();
        markets[id].active = active;
        emit MarketActive(id, active);
    }

    function setPaused(bool p) external onlyGuardian { paused = p; emit Paused(p); }

    function setParams(Params calldata p) external onlyOwner {
        if (p.feeBps > 500 || p.maxProfitBps < 10_000 || p.maxProfitBps > 200_000 || p.fundingMaxBps > 2_000
            || p.fundingCapBps > 10_000 || p.tieBps > 100) revert BadParam();
        params = p;
        emit ParamsSet(p);
    }

    function setLimits(uint256 _minDeposit, uint256 _maxWallet, uint256 _maxSide) external onlyOwner {
        // hard ceilings so a compromised owner key cannot open the pools wide
        if (_minDeposit == 0 || _maxWallet < _minDeposit || _maxSide < _maxWallet || _maxWallet > 10 ether || _maxSide > 500 ether) revert BadParam();
        minDeposit = _minDeposit; maxWalletPerRound = _maxWallet; maxSidePerRound = _maxSide;
    }

    function setTiming(uint256 _lockBuffer, uint256 _disputeWindow, uint256 _maxPriceDelay) external onlyOwner {
        if (_lockBuffer >= roundDuration || _disputeWindow < 60 || _maxPriceDelay < _disputeWindow + 600 || _maxPriceDelay > 3 days) revert BadParam();
        lockBuffer = _lockBuffer; disputeWindow = _disputeWindow; maxPriceDelay = _maxPriceDelay;
    }

    function setKeeper(address a) external onlyOwner { keeper = a; emit RoleSet("keeper", a); }
    function setGuardian(address a) external onlyOwner { guardian = a; emit RoleSet("guardian", a); }
    function setTreasury(address a) external onlyOwner { if (a == address(0)) revert BadParam(); treasury = a; emit RoleSet("treasury", a); }
    function transferOwnership(address a) external onlyOwner { pendingOwner = a; }
    function acceptOwnership() external { if (msg.sender != pendingOwner) revert NotAuthorized(); owner = pendingOwner; pendingOwner = address(0); emit RoleSet("owner", owner); }

    receive() external payable { revert(); }
}
