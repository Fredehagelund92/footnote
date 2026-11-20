# Cube Cloud's fixture

Invented, written by hand: `meta.json` is what Cube's `/v1/meta` would answer for the model of
[Cube's own fixture](../cube/model/model.yml), in the shape its API reference gives, so both Cube
connectors read the same refs. It adds what a real answer may hold and a read must leave alone: a
private cube and member (`public: false`), a time dimension with a custom granularity whose SQL is
planted, and SQL on members as an extended answer would carry it. No real deployment, name or key
is in it.

The kit serves it from a fake Cube Cloud on this machine (`tests/server/connectors/cube-cloud-server.ts`),
which also makes the reordered, changed and partly unreadable forms of it.

`definitions.json` is what a read of it must give. When the connector changes on purpose, write
it again and read the change in review:

```sh
npx vitest run --project server tests/server/connectors/conformance.test.ts -t cube-cloud -u
```
