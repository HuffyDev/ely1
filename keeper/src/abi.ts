// Generated from contracts/out — run `npm run abi` after changing the contract.
export const slopxAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "_genesis",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_roundDuration",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_keeper",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_guardian",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "_treasury",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "receive",
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "ONE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "acceptOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "addMarket",
  "inputs": [
   {
    "name": "name",
    "type": "string",
    "internalType": "string"
   }
  ],
  "outputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "applyFunding",
  "inputs": [
   {
    "name": "L",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "S",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "effL",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "effS",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "claim",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "amt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimable",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "user",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "amt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "claimed",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "computePayouts",
  "inputs": [
   {
    "name": "L",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "S",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "longWins",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "lp",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "sp",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "fee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "deposit",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "side",
    "type": "uint8",
    "internalType": "enum SlopxPools.Side"
   }
  ],
  "outputs": [],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "disputeWindow",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "emergencyVoid",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "feesAccrued",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "fundingFor",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "effL",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "effS",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "genesis",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "guardian",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "keeper",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "lockBuffer",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "marketCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "markets",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "name",
    "type": "string",
    "internalType": "string"
   },
   {
    "name": "active",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "maxPriceDelay",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "maxSidePerRound",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "maxWalletPerRound",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "minDeposit",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "openRound",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "owner",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "params",
  "inputs": [],
  "outputs": [
   {
    "name": "feeBps",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "maxProfitBps",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "fundingK",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "fundingMaxBps",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "fundingCapBps",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "tieBps",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "paused",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pendingOwner",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "proposals",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "resultE18",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "proposedAt",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "proposeResult",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "resultE18",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "rejectResult",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "roundDuration",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "roundEnd",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "roundParams",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "roundStart",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rounds",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "longTotal",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "shortTotal",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "longPayout",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "shortPayout",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "status",
    "type": "uint8",
    "internalType": "enum SlopxPools.Status"
   },
   {
    "name": "paramsSet",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "setGuardian",
  "inputs": [
   {
    "name": "a",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setKeeper",
  "inputs": [
   {
    "name": "a",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setLimits",
  "inputs": [
   {
    "name": "_minDeposit",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_maxWallet",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_maxSide",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setMarketActive",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "active",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setParams",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setPaused",
  "inputs": [
   {
    "name": "p",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setTiming",
  "inputs": [
   {
    "name": "_lockBuffer",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_disputeWindow",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "_maxPriceDelay",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setTreasury",
  "inputs": [
   {
    "name": "a",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "settle",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "stakeOf",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "user",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "longAmt",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "shortAmt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "totalLiabilities",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "transferOwnership",
  "inputs": [
   {
    "name": "a",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "treasury",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "withdrawFees",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "Claimed",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "user",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Deposited",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "user",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "side",
    "type": "uint8",
    "indexed": false,
    "internalType": "enum SlopxPools.Side"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MarketActive",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "active",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MarketAdded",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "name",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ParamsSet",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "indexed": false,
    "internalType": "struct SlopxPools.Params",
    "components": [
     {
      "name": "feeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxProfitBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingK",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingMaxBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "fundingCapBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "tieBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Paused",
  "inputs": [
   {
    "name": "paused",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ResultProposed",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "resultE18",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ResultRejected",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RoleSet",
  "inputs": [
   {
    "name": "role",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   },
   {
    "name": "who",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RoundSettled",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "resultE18",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "dataHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   },
   {
    "name": "longPayout",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "shortPayout",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RoundVoided",
  "inputs": [
   {
    "name": "marketId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "reason",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BadAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadMarket",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadParam",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadState",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CapExceeded",
  "inputs": []
 },
 {
  "type": "error",
  "name": "DepositsClosed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "IsPaused",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotAuthorized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToClaim",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Reentrancy",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooEarly",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TransferFailed",
  "inputs": []
 }
] as const;
