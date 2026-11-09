import { readFileSync, writeFileSync } from 'node:fs';
const abi = JSON.parse(readFileSync('contracts/out/SlopxPools.sol/SlopxPools.json', 'utf8')).abi;
writeFileSync('keeper/src/abi.ts', '// Generated from contracts/out — run `npm run abi` after changing the contract.\nexport const slopxAbi = ' + JSON.stringify(abi, null, 1) + ' as const;\n');
console.log('wrote keeper/src/abi.ts');
