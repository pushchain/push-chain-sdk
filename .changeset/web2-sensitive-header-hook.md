---
'@pushchain/core': patch
---

Warn on `Cookie` and `session` headers in a web2 read's progress hook, matching the warning the query envelope already produces.

Headers named `Cookie`, `Set-Cookie` or `X-Session-Id` were written to the public event log with no `READ-TX-103-03` event, even though the returned `warnings` array flagged them. The two lists were separate copies of the same predicate and had drifted. Both now read one exported `SENSITIVE_HEADER`.
