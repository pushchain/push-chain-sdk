#!/usr/bin/env bash
# node-read.sh tx <0xhash> | id <0xrequestId>
# Queries x/ucallback over ABCI and decodes UniversalRead records (raw protobuf walk).
set -euo pipefail
TM=https://donut.rpc.push.org
kind=$1; val=$(echo "$2" | tr 'A-F' 'a-f')
case $kind in
  tx) path="/ucallback.v1.Query/ReadsByTx";;     # QueryReadsByTxRequest{ string tx_hash = 1 }
  id) path="/ucallback.v1.Query/UniversalRead";; # QueryUniversalReadRequest{ string request_id = 1 }
  *) echo "usage: tx|id <hex>"; exit 2;;
esac
# encode: field 1, wire type 2 (0x0a), varint len, utf8 bytes
DATA=$(python3 -c "
import sys
s=sys.argv[1].encode(); n=len(s); out=bytearray([0x0a])
while True:
    b=n&0x7f; n>>=7
    out.append(b|0x80 if n else b)
    if not n: break
print('0x'+(out+s).hex())" "$val")
curl -s -m 25 -G "$TM/abci_query" --data-urlencode "path=\"$path\"" --data-urlencode "data=$DATA" | python3 -c '
import json,sys,base64
r=json.load(sys.stdin)["result"]["response"]
if r.get("code",0)!=0: print("ABCI error", r.get("code"), (r.get("log") or "")[:200]); sys.exit(0)
b=base64.b64decode(r.get("value") or "")
STATUS={0:"UNSPECIFIED",1:"PENDING",2:"VOTING",3:"FULFILLED",4:"EXPIRED",5:"FAILED",6:"ABORTED"}
RSTAT={0:"UNSPECIFIED",1:"SUCCESS",2:"ERROR"}
def varint(b,i):
    v=s=0
    while True:
        c=b[i]; i+=1; v|=(c&0x7f)<<s; s+=7
        if not c&0x80: return v,i
def walk(b):
    i=0; out=[]
    while i<len(b):
        k,i=varint(b,i); f,w=k>>3,k&7
        if w==0: v,i=varint(b,i); out.append((f,"v",v))
        elif w==2:
            n,i=varint(b,i); out.append((f,"b",b[i:i+n])); i+=n
        elif w==1: out.append((f,"f64",b[i:i+8])); i+=8
        elif w==5: out.append((f,"f32",b[i:i+4])); i+=4
        else: raise SystemExit(f"wire {w}")
    return out
def s(x):
    try: return x.decode()
    except: return "0x"+x.hex()
def show_read(ur, ind="  "):
    for f,w,v in walk(ur):
        if f==1: print(ind+"id            ", s(v))
        elif f==2:
            req={ff:vv for ff,ww,vv in walk(v)}
            print(ind+"request.destination_chain", s(req.get(2,b"")))
            print(ind+"request.callback_target  ", s(req.get(9,b"")))
            print(ind+"request.callback_budget  ", s(req.get(16,b"")), " protocol_fee", s(req.get(15,b"")))
            print(ind+"request.created_at_height", req.get(8), " expiry", req.get(7), " dest_block", req.get(6))
        elif f==3:
            res={ff:vv for ff,ww,vv in walk(v)}
            print(ind+"result.status        ", RSTAT.get(res.get(1,0)), " error_code", res.get(6,0))
            rd=res.get(2,b""); print(ind+"result.result_data   ", "0x"+rd.hex() if rd else "(empty)")
        elif f==4: print(ind+"STATUS               ", STATUS.get(v,v))
        elif f==5: print(ind+"ballot_key           ", s(v)[:70])
        elif f==6:
            pc={ff:vv for ff,ww,vv in walk(v)}
            print(ind+"pc_tx                ", "hash", s(pc.get(1,b""))[:66], "gasUsed", pc.get(3), "status", s(pc.get(5,b"")), "err", s(pc.get(6,b""))[:80])
        elif f==7 and v: print(ind+"error_msg            ", s(v)[:200])
        elif f==8: print(ind+"expiry_attempts      ", v)
top=walk(b)
if not top or all(f==2 for f,_,_ in top): print("(no record)"); sys.exit(0)
n=0
for f,w,v in top:
    if f==1 and w=="b":
        n+=1; print(f"--- UniversalRead #{n} ---"); show_read(v)
if n==0: print("(no reads in response)")
'
