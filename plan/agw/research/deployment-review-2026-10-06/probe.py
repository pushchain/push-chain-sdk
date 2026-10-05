"""Read-only v4 Donut probe. No signing, funding or transaction submission."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

RPC = 'https://evm.donut.rpc.push.org/'
OUT = Path(__file__).parent / 'donut-probe.json'
ADDRESSES = {
    'factory': '0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF',
    'factoryLogic': '0xe138Dc6EfC10233BE1e6c8aF1Caf8cABe599cfC2',
    'walletImplementation': '0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c',
    'policy': '0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af',
    'policyImplementation': '0xA2391eee4C9EA1B32AEB3A460B77296EA709F02F',
    'proxyAdmin': '0x0b7a31ec85117892aEA90AA5cB6514e2F97c2295',
    'validator': '0x068EE2388475A98EE1f5a434C58bFF3444fffFe6',
    'engine': '0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a',
    'gateway': '0x00000000000000000000000000000000000000C1',
    'core': '0x00000000000000000000000000000000000000C0',
    'executor': '0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7',
}

def rpc(method, params):
    data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    req = urllib.request.Request(RPC, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=45) as response:
        value = json.load(response)
    if 'error' in value:
        raise RuntimeError(value['error'])
    return value['result']

chain = int(rpc('eth_chainId', []), 16)
assert chain == 42101, chain
block = rpc('eth_blockNumber', [])
header = rpc('eth_getBlockByNumber', [block, False])

def code(entry):
    name, address = entry
    raw = rpc('eth_getCode', [address, block])
    value = bytes.fromhex(raw[2:])
    return name, {'address': address, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}

impl_slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
admin_slot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'
slots = {}
for name in ['factory', 'policy', 'gateway']:
    slots[name] = {'implementation': rpc('eth_getStorageAt', [ADDRESSES[name], impl_slot, block])}
slots['policy']['admin'] = rpc('eth_getStorageAt', [ADDRESSES['policy'], admin_slot, block])

calls = [('factory', 'walletImplementation()(address)'), ('factory', 'paused()(bool)'),
         ('policy', 'version()(string)'), ('policy', 'pushChainHash()(bytes32)'),
         ('policy', 'UNIVERSAL_GATEWAY_PC()(address)'), ('policy', 'UNIVERSAL_EXECUTOR_MODULE()(address)'),
         ('walletImplementation', 'accountId()(string)')]
calls.extend(('walletImplementation', f'{name}()(address)') for name in
             ['SESSION_ENGINE', 'RULES_POLICY', 'SESSION_VALIDATOR', 'UNIVERSAL_GATEWAY_PC'])

def call(entry):
    name, signature = entry
    result = subprocess.run(['cast', 'call', ADDRESSES[name], signature, '--rpc-url', RPC,
                             '--block', str(int(block, 16))], capture_output=True, text=True, timeout=60)
    return {'contract': name, 'signature': signature, 'exit_code': result.returncode,
            'output': result.stdout.strip(), 'error': result.stderr.strip()}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    codes = dict(pool.map(code, ADDRESSES.items()))
    reads = list(pool.map(call, calls))
result = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'rpc': RPC,
          'chain_id': chain, 'block': int(block, 16), 'block_hash': header['hash'],
          'block_timestamp': int(header['timestamp'], 16), 'code': codes, 'slots': slots, 'reads': reads,
          'limits': 'Code sizes, proxy slots and selected views only; no complete bytecode/source equivalence or transaction execution proof.'}
OUT.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'chain': chain, 'block': result['block'], 'code_sizes': {k: v['bytes'] for k, v in codes.items()},
                  'reads': reads, 'slots': slots, 'saved': str(OUT)}, indent=2))
